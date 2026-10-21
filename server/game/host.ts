// The game server's referee: it alone holds the whole game, plays the bots' seats, takes
// each person's moves, and gives every seat its own view of the game (`viewFor`).
// Nothing here knows about HTTP; see http.ts.
import { produce } from 'immer';
import { isCardName, registerCards } from '../../src/cards/db';
import { scriptCards } from '../../src/cards/oracle';
import { applyAction, applyBotAction, log, newGame, realSchedule, scheduleBot, viewFor } from '../../src/engine';
import type { Action, ApplyOptions, CardData, Game, PlayerId, Schedule } from '../../src/engine';
import type { SeatPrefs, StartRequest, ViewMessage } from '../../src/net/protocol';
import type { GameService } from './service';

export type { Schedule };

interface Watcher {
  seat: PlayerId | null;
  send: (m: ViewMessage) => void;
  /** The fetched cards this watcher has been sent the data of. */
  sent: Set<string>;
}

/**
 * A new game's id: higher than the last, and than any from before the server restarted, so
 * a window left open never mistakes a new game for the one it was playing.
 */
const nextGameId = (last: number) => Math.max(last + 1, Date.now());

export class GameHost implements GameService {
  private game: Game | null = null;
  /** The game's cards that aren't built in, by name (and each face's name), for the windows that see them. */
  private fetched = new Map<string, CardData>();
  private gameId = 0;
  private version = 0;
  private prefs: Partial<Record<PlayerId, SeatPrefs>> = {};
  /** The last move number heard from each seat in this game. */
  private acks = new Map<PlayerId, number>();
  private watchers = new Set<Watcher>();
  private cancelBot: (() => void) | null = null;
  private speed = 1;
  private paused = false;
  private listeners = new Set<() => void>();

  constructor(private schedule: Schedule = realSchedule) {}

  /** The whole game, hidden cards and all. Only the server and tests see it. */
  get full(): Game | null {
    return this.game;
  }

  /** Starts a new game, ending any game in progress. */
  start(req: StartRequest) {
    // Cards from Scryfall that a pasted deck uses: the server needs their rules text too.
    this.addCards(req.cards);
    this.prefs = { ...req.prefs };
    this.acks.clear();
    this.paused = false;
    this.gameId = nextGameId(this.gameId);
    this.game = newGame({
      seed: req.seed ?? (Math.random() * 2 ** 31) | 0,
      seats: req.seats.map((s, i) => ({ ...s, manualDamage: s.human ? !!req.prefs[i]?.manualDamage : undefined })),
      stops: this.stops(),
    });
    this.changed();
  }

  /**
   * Carries on with a game already under way, such as a saved one, as a new game for the
   * windows. `cards` are the fetched cards it uses (`snapshot`).
   */
  load(game: Game, prefs: Partial<Record<PlayerId, SeatPrefs>> = {}, cards: CardData[] = []) {
    this.addCards(cards);
    this.prefs = { ...prefs };
    this.acks.clear();
    this.paused = false;
    this.gameId = nextGameId(this.gameId);
    this.game = game;
    this.changed();
  }

  /** Ends the game in progress. Every window hears that there is no game. */
  end() {
    this.game = null;
    this.acks.clear();
    this.paused = false;
    this.changed();
  }

  /** What it takes to carry on with this game later (`load`): the game, everyone's settings, and its fetched cards. */
  snapshot(): { game: Game; prefs: Partial<Record<PlayerId, SeatPrefs>>; cards: CardData[] } | null {
    if (!this.game) return null;
    // Without the games kept to take back mana abilities (`Game.manaRewind`): saved, they'd be copies of the whole game each.
    const { manaRewind: _, ...game } = this.game;
    return { game, prefs: this.prefs, cards: [...new Set(this.fetched.values())] };
  }

  get isPaused() {
    return this.paused;
  }

  /** Pauses the game: no moves are taken and the bots wait, until it's unpaused. */
  setPaused(paused: boolean) {
    if (this.paused === paused) return;
    this.paused = paused;
    this.changed();
  }

  /**
   * A bot plays `seat` (`bot`), standing in for a person who has gone, or the person is
   * back. The game's log says so.
   */
  setBot(seat: PlayerId, bot: boolean) {
    const g = this.game;
    if (!g?.players[seat] || g.players[seat].isBot === bot) return;
    this.game = produce(g, (d) => {
      d.players[seat].isBot = bot;
      log(d, bot ? `A bot plays for ${d.players[seat].name} until they're back.` : `${d.players[seat].name} is back.`, seat);
    });
    this.changed();
  }

  /** Calls `on` after every change to the game, until the returned function is called. */
  listen(on: () => void): () => void {
    this.listeners.add(on);
    return () => this.listeners.delete(on);
  }

  /**
   * A move from the person in `seat`. It counts only if the game is waiting on them
   * (117, `Game.priority`) and the engine accepts it; either way their view is sent again
   * with `seq` acknowledged, so a window that guessed wrong learns what really happened.
   */
  act(seat: PlayerId, seq: number, action: Action): boolean {
    const g = this.game;
    // `seq` comes over the wire: anything but a number would leave the ack NaN, and the window would drop every view after.
    this.acks.set(seat, Math.max(Number.isFinite(seq) ? seq : 0, this.acks.get(seat) ?? 0));
    const ok = !!g && !this.paused && g.step !== 'gameOver' && g.priority === seat && !g.players[seat].isBot;
    const next = ok ? applyAction(g, action, this.options()) : g;
    if (next !== g) this.game = next;
    this.changed();
    return next !== g;
  }

  /** A player's stops or settings changed. The game keeps `manualDamage` on their player. */
  setPrefs(seat: PlayerId, prefs: SeatPrefs) {
    this.prefs[seat] = { ...this.prefs[seat], ...prefs };
    const g = this.game;
    if (g && prefs.manualDamage !== undefined && g.players[seat] && !g.players[seat].isBot) {
      this.game = { ...g, players: g.players.map((p) => (p.id === seat ? { ...p, manualDamage: prefs.manualDamage } : p)) };
      this.changed();
    }
  }

  /** How fast the bots play: 1, 2 or 4 times normal. */
  setSpeed(speed: number) {
    this.speed = [1, 2, 4].includes(speed) ? speed : 1;
    this.driveBots();
  }

  /** Sends `seat`'s view (null: an onlooker's) now and after every change, until the returned function is called. */
  watch(seat: PlayerId | null, send: (m: ViewMessage) => void): () => void {
    const w: Watcher = { seat, send, sent: new Set() };
    this.watchers.add(w);
    send(this.message(w));
    return () => this.watchers.delete(w);
  }

  private stops(): ApplyOptions['stops'] {
    return Object.fromEntries(Object.entries(this.prefs).flatMap(([seat, p]) => (p?.stops ? [[seat, p.stops]] : [])));
  }

  private options(): ApplyOptions {
    // Only people are in full control: a bot standing in for one plays as bots do.
    const fullControl = Object.entries(this.prefs).flatMap(([seat, p]) => (p?.fullControl && !this.game?.players[+seat]?.isBot ? [+seat] : []));
    return { stops: this.stops(), fullControl };
  }

  private message({ seat, sent }: Watcher): ViewMessage {
    const g = this.game;
    const game = g && (seat === null || g.players[seat]) ? viewFor(g, seat) : null;
    const cards = game ? fetchedIn(game, this.fetched, sent) : [];
    return {
      gameId: this.gameId,
      version: this.version,
      seat,
      ack: seat === null ? 0 : (this.acks.get(seat) ?? 0),
      game,
      ...(cards.length ? { cards } : {}),
    };
  }

  private changed() {
    this.version++;
    for (const w of this.watchers) w.send(this.message(w));
    this.driveBots();
    for (const on of this.listeners) on();
  }

  private addCards(cards: CardData[]) {
    // Cards from Scryfall that a pasted deck uses: the server needs their rules text too.
    const fresh = cards.filter((c) => !isCardName(c.name));
    if (fresh.length) {
      registerCards(Object.fromEntries(fresh.map((c) => [c.name, c])));
      scriptCards(fresh.map((c) => c.name));
    }
    this.fetched = new Map(cards.flatMap((c) => [c, ...(c.faces ?? [])].map((f) => [f.name, c] as const)));
  }

  /** Whenever a bot has the decision, it acts after a short, readable pause. */
  private driveBots() {
    this.cancelBot?.();
    this.cancelBot = null;
    const g = this.game;
    if (!g || this.paused || g.step === 'gameOver' || !g.players[g.priority].isBot) return;
    // The server has no frame to keep smooth, so the bot thinks at once (see `scheduleBot`).
    this.cancelBot = scheduleBot(
      g,
      this.speed,
      (action) => {
        this.cancelBot = null;
        if (this.game !== g) return;
        this.game = applyBotAction(g, action, this.options());
        this.changed();
      },
      this.schedule,
      false,
    );
  }
}

/**
 * The data of the fetched cards `view` names that `sent` doesn't have yet, which it then
 * does. Any string in the view that is a card's name counts: a card, a copy, a choice.
 */
function fetchedIn(view: Game, fetched: Map<string, CardData>, sent: Set<string>): CardData[] {
  if (!fetched.size) return [];
  const out = new Map<string, CardData>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      const d = fetched.get(v);
      if (d && !sent.has(d.name)) out.set(d.name, d);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(view);
  for (const name of out.keys()) sent.add(name);
  return [...out.values()];
}
