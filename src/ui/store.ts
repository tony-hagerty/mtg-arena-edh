import { produce } from 'immer';
import { create } from 'zustand';
import { HIDDEN, applyAction, applyBotAction, defaultStops, newGame } from '../engine';
import type { Action, ApplyOptions, AttackOption, CastChoices, Game, ManaSym, PlayerId, SeatDef, Step, StopKind, Stops, TargetRef, TargetSpec, Zone } from '../engine';
import { DECKS, cardData, isCardName } from '../cards/db';
import type { DeckDef } from '../cards/db';
import { savedDeckIssues } from '../cards/decklist';
import { addCards, fetchCards, isFetched, loadFetchedCards } from '../cards/fetched';
import type { StartRequest, ViewMessage } from '../net/protocol';
import type { DeckChoice, LobbyConnection, LobbyState } from '../net/lobby';
import type { Connection } from './remote';

/**
 * A spell or ability the human is part-way through. `cast` and `activate` are proposals
 * (601.2): X, kicker and the alternative cost are announced first, then targets are
 * chosen, then anything to sacrifice, then the cost is paid. Until it is paid nothing
 * has reached the game. `trigger` is a triggered ability the game is already waiting on
 * for targets (see `targetingOf` in view.ts).
 */
export interface Targeting {
  /** `retarget`: new targets for a spell or ability the game is waiting on (115.7d). */
  mode: 'cast' | 'activate' | 'trigger' | 'retarget';
  cardId: string;
  specs: TargetSpec[];
  chosen: (TargetRef | null)[];
  /** Mana sources tapped by hand while paying, so cancelling can untap them again (733.1). */
  tapped: string[];
  /** What the human has announced for a spell so far (601.2b). */
  choices: CastChoices;
  /** Still announcing X, kicker or the alternative cost: targets come next. */
  announcing: boolean;
  /** Creatures picked to crew a Vehicle (702.122a), and whether the human is done picking. */
  crew?: string[];
  crewDone?: boolean;
  /** The loyalty ability (606) or Class level bar being activated, by index, or undefined for one of the card's `activated` abilities. */
  ability?: number;
  /** Which of the card's `activated` abilities, by index (left out, the first). */
  activated?: number;
  /** Still choosing which ability: targets come next. */
  pickingAbility?: boolean;
  /** The X announced for an ability with {X} or −X in its cost (107.3a), and whether the human is still choosing it: targets come next. */
  x?: number;
  choosingX?: boolean;
  /** Cards picked to discard for a "Discard a card" cost. */
  discard?: string[];
  /** The human chose not to pay an optional sacrifice, like bargain (702.166a). */
  sacrificeDone?: boolean;
}

const STOPS_KEY = 'arena-edh.stops';

/**
 * The human's stops from the last session, or the defaults. Storage can be missing or blocked.
 * They are kept by seat counted from the human's own: index 0 is their own turn, 1 the next
 * player's, and so on, so they hold wherever the human sits.
 */
function loadStops(): Stops {
  try {
    const saved = JSON.parse(localStorage.getItem(STOPS_KEY) ?? 'null');
    if (Array.isArray(saved) && saved.length === 4) return saved;
  } catch {
    // fall through to the defaults
  }
  return defaultStops(0);
}

function saveStops(stops: Stops) {
  try {
    localStorage.setItem(STOPS_KEY, JSON.stringify(stops));
  } catch {
    // stops just won't outlast the page
  }
}

/** The human's stops (`loadStops`) turned into the engine's, by whose turn it is, for `seat` at a table of `players`. */
export const absoluteStops = (stops: Stops, seat: PlayerId, players: number): Stops =>
  Array.from({ length: players }, (_, turn) => stops[(turn - seat + players) % players] ?? {});

const SETTINGS_KEY = 'arena-edh.settings';

/** Choices the human makes once, not every game. Each defaults to the automatic way. */
export interface Settings {
  /** Divide combat damage by hand when an attacker has a choice (510.1c, 702.19b). Off: split automatically. */
  manualDamage: boolean;
  /** The deck each bot seat plays, by deck id, one per opponent; null picks one automatically (see `seatDecks`). */
  opponents: (string | null)[];
  /** Who plays each opponent seat: a bot, another person at this screen, or nobody (a smaller table). */
  players: SeatPlayer[];
}

export type SeatPlayer = 'bot' | 'person' | 'empty';
const SEAT_PLAYERS: SeatPlayer[] = ['bot', 'person', 'empty'];

const DEFAULT_SETTINGS: Settings = { manualDamage: false, opponents: [null, null, null], players: ['bot', 'bot', 'bot'] };

/** The human's settings from the last session, or the defaults. Storage can be missing or blocked. */
function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (saved && typeof saved === 'object') {
      const opponents = DEFAULT_SETTINGS.opponents.map((_, i) => (typeof saved.opponents?.[i] === 'string' ? (saved.opponents[i] as string) : null));
      const players = DEFAULT_SETTINGS.players.map((d, i) => (SEAT_PLAYERS.includes(saved.players?.[i]) ? (saved.players[i] as SeatPlayer) : d));
      return { ...DEFAULT_SETTINGS, manualDamage: saved.manualDamage === true, opponents, players };
    }
  } catch {
    // fall through to the defaults
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // settings just won't outlast the page
  }
}

const DECKS_KEY = 'arena-edh.decks';

/**
 * Decks the human pasted, from the last session. A saved deck is kept even if a newer card
 * pool lacks one of its cards; the menu shows why it can't be played (`savedDeckIssues`).
 */
function loadDecks(): DeckDef[] {
  try {
    const saved = JSON.parse(localStorage.getItem(DECKS_KEY) ?? '[]');
    if (Array.isArray(saved)) {
      return saved.filter(
        (d): d is DeckDef =>
          d && typeof d.id === 'string' && typeof d.title === 'string' && Array.isArray(d.commanders) && Array.isArray(d.cards) && typeof d.basics === 'object',
      );
    }
  } catch {
    // fall through to none
  }
  return [];
}

function saveDecks(decks: DeckDef[]) {
  try {
    localStorage.setItem(DECKS_KEY, JSON.stringify(decks));
  } catch {
    // pasted decks just won't outlast the page
  }
}

/**
 * The deck in each seat: the human's in seat 0 (or a bot's, when watching), then one per
 * opponent. A seat set to a deck id plays that deck, even one another seat plays too: it's
 * the player's choice. An automatic seat (null, or a deck that has since been deleted)
 * takes the first built-in deck no seat has yet.
 */
export function seatDecks(human: DeckDef | null, opponents: (string | null)[], saved: DeckDef[], playable = (_: DeckDef) => true): DeckDef[] {
  const all = [...DECKS, ...saved].filter(playable);
  const picked = [human, ...opponents.map((id) => all.find((d) => d.id === id) ?? null)];
  const used = new Set(picked.flatMap((d) => (d ? [d.id] : [])));
  return picked.map((d) => {
    if (d) return d;
    const next = DECKS.find((x) => !used.has(x.id)) ?? DECKS[0];
    used.add(next.id);
    return next;
  });
}

export interface Hover {
  name: string;
  el: HTMLElement;
}

interface Store {
  game: Game | null;
  /** Counts games started. The game screen is keyed on it, so a new game starts with fresh UI state. */
  gameNo: number;
  /** The seat at the bottom of the screen, whose cards are shown: the human's, or null when watching bots. */
  human: PlayerId | null;
  /** Every seat a person at this screen plays. With more than one, they pass the screen between them. */
  humans: PlayerId[];
  /** The person at this screen who must act next, while the screen waits to be passed to them. */
  handoff: PlayerId | null;
  /** The person `handoff` names has the screen now. */
  takeOver: () => void;
  /**
   * The game server this window plays through, or null to run the game in the page. With a
   * server, `game` is the view of the seat at the bottom of the screen (`viewFor`).
   */
  server: Connection | null;
  /** Looks for the game server the page came from. */
  connect: (find: () => Promise<Connection | null>) => Promise<void>;
  /** The lobby of the program this page came from, for hosting and joining tables, or null if there is none. */
  lobby: LobbyConnection | null;
  /** The lobby as it last said it was: the table this window sits at, if any. */
  table: LobbyState | null;
  /** Looks for the lobby, then follows it. Connect the game server first: a started table plays through it. */
  connectLobby: (find: () => Promise<LobbyConnection | null>) => Promise<void>;
  /**
   * The game on screen is a table's (the lobby started it): this window plays only its own
   * seat, and leaving the game leaves the table instead of ending the server's game.
   */
  tableGame: boolean;
  /** Changes how fast the bots play. */
  setSpeed: (speed: number) => void;
  targeting: Targeting | null;
  /** Keep priority after the spell or ability being paid for, to respond to it yourself (117.3c). One use. */
  hold: boolean;
  /** What the human's attackers go after: an opponent, or a planeswalker or battle (508.1b). */
  attackTarget: AttackOption | null;
  /** Blockers the human picked that could block more than one attacker: the next attacker they click gets them all. */
  pickedBlockers: string[];
  hover: Hover | null;
  /** Card ids in the order the human arranged their hand. Display only: the engine never sees it. */
  handOrder: string[];
  viewer: { pid: PlayerId; zone: Zone } | null;
  /** A mana ability with a choice of colour that the human is about to use, like Lion's Eye Diamond's. */
  colorPick: { cardId: string; ability: number; colors: ManaSym[] } | null;
  showLog: boolean;
  /** The "leave this game?" dialog is open. */
  confirmExit: boolean;
  speed: number;
  /** Where the game stops for the human, by seat counted from theirs (see `loadStops`). A UI preference passed to the engine. */
  stops: Stops;
  setStop: (turn: PlayerId, step: Step, kind: StopKind | undefined) => void;
  settings: Settings;
  /** Changes a setting, saves it, and applies it to the game in progress. */
  setSetting: (change: Partial<Settings>) => void;
  /** Starts a game with the human playing `deck`, or four bots when null. The opponents come from the settings. */
  start: (deck: DeckDef | null) => void;
  /** The deck the human played in the last game started, for Play Again. */
  deck: DeckDef | null;
  /** Decks the human pasted, saved in the browser. */
  savedDecks: DeckDef[];
  saveDeck: (deck: DeckDef) => void;
  deleteDeck: (id: string) => void;
  /** Goes up when cards fetched from Scryfall are added, so screens that check card names look again. */
  cardsVersion: number;
  cardsChanged: () => void;
  /**
   * Adds the cards cached by earlier visits, then fetches any a saved deck still names that
   * the game doesn't have (the cache was cleared). Offline, those decks just stay greyed out.
   */
  loadCards: () => Promise<void>;
  quit: () => void;
  act: (a: Action) => boolean;
  botAct: (a: Action) => void;
}

export const useStore = create<Store>()((set, get) => ({
  game: null,
  gameNo: 0,
  human: null,
  humans: [],
  handoff: null,
  server: null,
  lobby: null,
  table: null,
  tableGame: false,
  targeting: null,
  hold: false,
  attackTarget: null,
  pickedBlockers: [],
  hover: null,
  handOrder: [],
  viewer: null,
  colorPick: null,
  showLog: true,
  confirmExit: false,
  speed: 1,
  stops: loadStops(),
  settings: loadSettings(),
  deck: null,
  savedDecks: loadDecks(),
  cardsVersion: 0,

  setStop: (turn, step, kind) => {
    const stops = get().stops.map((t, i) => (i === turn ? { ...t, [step]: kind } : t));
    if (!kind) delete stops[turn][step];
    saveStops(stops);
    set({ stops });
    sendPrefs();
  },

  setSpeed: (speed) => {
    set({ speed });
    get().server?.speed(speed);
  },

  connect: async (find) => {
    const server = await find();
    if (server) set({ server });
  },

  connectLobby: async (find) => {
    const lobby = await find();
    if (!lobby) return;
    set({ lobby });
    lobby.watch(onLobby);
  },

  setSetting: (change) => {
    const settings = { ...get().settings, ...change };
    saveSettings(settings);
    const { game, humans } = get();
    // The game keeps the setting on the human's player, where the engine reads it.
    const next = game && humans.length && !get().server ? produce(game, (d) => void humans.forEach((h) => (d.players[h].manualDamage = settings.manualDamage))) : game;
    set({ settings, game: next });
    sendPrefs();
  },

  saveDeck: (deck) => {
    const savedDecks = [...get().savedDecks.filter((d) => d.id !== deck.id), deck];
    saveDecks(savedDecks);
    set({ savedDecks });
  },

  deleteDeck: (id) => {
    const savedDecks = get().savedDecks.filter((d) => d.id !== id);
    saveDecks(savedDecks);
    set({ savedDecks });
  },

  cardsChanged: () => set({ cardsVersion: get().cardsVersion + 1 }),

  loadCards: async () => {
    if (await loadFetchedCards()) get().cardsChanged();
    const names = get().savedDecks.flatMap((d) => [...d.commanders, ...Object.keys(d.basics), ...d.cards]);
    const missing = [...new Set(names)].filter((n) => !isCardName(n));
    if (missing.length && (await fetchCards(missing)).cards.length) get().cardsChanged();
  },

  start: (deck) => {
    const { settings, savedDecks, stops, server } = get();
    // A table's game is the host's to start: a new game here would end it for everyone.
    if (get().tableGame) return;
    const seats = tableOf(deck, settings, savedDecks);
    const humans = seats.flatMap((s, i) => (s.human ? [i] : []));
    const seed = (Math.random() * 2 ** 31) | 0;
    const seatStops = Object.fromEntries(humans.map((h) => [h, absoluteStops(stops, h, seats.length)]));
    // With a server, the game starts there and the screen changes once its first view arrives.
    const game = server ? get().game : newGame({ seed, seats, stops: seatStops });
    if (server) {
      const prefs = Object.fromEntries(humans.map((h) => [h, { stops: seatStops[h], manualDamage: settings.manualDamage }]));
      const req: StartRequest = { seed, seats: seats.map(({ deck, human }) => ({ deck, human: !!human })), prefs, cards: fetchedCardsOf(seats.map((s) => s.deck)) };
      // Stop listening to the old game's seat first: its next view would be of the new game.
      remote.unwatch?.();
      remote.unwatch = null;
      server
        .start(req)
        .then(() => watchSeat(humans[0] ?? null))
        .catch((err) => console.warn('Game server:', err));
    }
    set({
      game,
      gameNo: server ? get().gameNo : get().gameNo + 1,
      human: humans[0] ?? null,
      humans,
      ...(game && !server ? follow(game, humans[0] ?? null, humans) : { handoff: null }),
      deck,
      targeting: null,
      attackTarget: null,
      pickedBlockers: [],
      hover: null,
      handOrder: [],
      viewer: null,
      colorPick: null,
      confirmExit: false,
    });
  },

  takeOver: () => {
    const { handoff, server } = get();
    if (handoff === null) return;
    // With a server, the screen stays covered until the next person's view arrives (`onView`).
    if (server) return watchSeat(handoff);
    set({ human: handoff, ...freshSeat });
  },

  quit: () => {
    if (get().tableGame) {
      remote.unwatch?.();
      remote.unwatch = null;
      // Until the lobby hears it, it still says the game is on: that mustn't seat this window again.
      remote.leaving = true;
      get().lobby?.leave().catch((err) => console.warn('Lobby:', err));
      set({ game: null, tableGame: false, hover: null, targeting: null, viewer: null, confirmExit: false });
      return;
    }
    if (get().server) {
      remote.unwatch?.();
      remote.unwatch = null;
      get().server!.end();
    }
    set({ game: null, hover: null, targeting: null, viewer: null, confirmExit: false });
  },

  act: (a) => {
    const { game: g, server, human, tableGame, table } = get();
    // The server takes moves only from the player the game is waiting on, and none while a table's game is paused.
    if (!g || (server && g.priority !== human) || (tableGame && table?.paused)) return false;
    // Declaring attackers/blockers and tapping for mana keep the current selection; anything else resets it.
    const mana = a.type === 'tapMana' || a.type === 'untapMana';
    const keep = mana || a.type.includes('declare');
    // A land is still under the pointer after it is tapped, so its preview stays up too.
    const ui = { ...(mana ? {} : { hover: null }), ...(keep ? {} : { targeting: null, pickedBlockers: [] }) };
    if (!server || human === null) {
      const next = applyAction(g, a, engineOptions());
      if (next === g) return false;
      set({ game: next, ...ui, ...follow(next, human, get().humans) });
      return true;
    }
    // With a server, the move is checked against this seat's view first, so a click the
    // engine refuses still says so at once. The server then has the last word.
    const next = checkOnView(g, a);
    if (next === g) return false;
    const seq = (remote.seq[human] ?? 0) + 1;
    remote.seq[human] = seq;
    server.act({ seat: human, seq, action: a });
    // Those same moves touch nothing hidden, so the window shows them at once and the
    // server's view agrees. Anything else waits for the server: it may draw a card, or
    // reveal one, that this view can't know.
    set({ ...(keep && next ? { game: next } : {}), ...ui });
    return true;
  },

  botAct: (a) => {
    const g = get().game;
    if (!g || get().server) return;
    const next = applyBotAction(g, a, engineOptions());
    set({ game: next, ...follow(next, get().human, get().humans) });
  },
}));

/** What a new person at the screen starts with: nothing the last one was doing carries over. */
const freshSeat = { handoff: null, targeting: null, attackTarget: null, pickedBlockers: [], handOrder: [], viewer: null, colorPick: null, hover: null };

/** The connection's moving parts, outside the store's state: they don't change what's drawn. */
const remote: { gameId: number; seq: Partial<Record<PlayerId, number>>; unwatch: (() => void) | null; leaving: boolean } = {
  gameId: 0,
  seq: {},
  unwatch: null,
  /** This window left a table's game and the lobby hasn't said so yet. */
  leaving: false,
};

/** Streams `seat`'s view from the server, in place of the seat streamed before. */
function watchSeat(seat: PlayerId | null) {
  const server = useStore.getState().server;
  if (!server) return;
  remote.unwatch?.();
  remote.unwatch = server.watch(seat, onView);
}

/**
 * A view from the server. It is shown unless this window has sent moves the server hasn't
 * dealt with yet: the window already shows those, and a later view will include them.
 */
export function onView(m: ViewMessage) {
  const s = useStore.getState();
  // Another player's cards from Scryfall, which this window may not have. One it already
  // has is left alone, so what this window knows of it (its legality) stays.
  const fresh = m.cards?.filter((c) => !isCardName(c.name)) ?? [];
  if (fresh.length) addCards(fresh);
  if (m.gameId !== remote.gameId) {
    // A new game: the screen starts afresh, and moves count from 1 again.
    remote.gameId = m.gameId;
    remote.seq = {};
    if (!m.game) return;
    useStore.setState({ game: m.game, gameNo: s.gameNo + 1, human: m.seat, ...freshSeat, ...follow(m.game, m.seat, s.humans) });
    // The host started a table's game without this person's stops and settings.
    if (s.tableGame) sendPrefs();
    return;
  }
  if (m.seat !== null && m.ack < (remote.seq[m.seat] ?? 0)) return;
  if (!m.game) {
    // The game ended elsewhere (another window left it).
    if (s.game) useStore.setState({ game: null, hover: null, targeting: null, viewer: null, confirmExit: false });
    return;
  }
  // The first view of the next person at the screen: their seat goes to the bottom.
  const seat = m.seat !== s.human ? { human: m.seat, ...freshSeat } : {};
  useStore.setState({ game: m.game, ...seat, ...follow(m.game, m.seat, s.humans) });
}

/**
 * The lobby changed. When the table's game starts, this window plays it as its own seat
 * through the game server, alone at its screen; when the game is over for the table (the
 * host left, say), the window goes back to the menu.
 */
export function onLobby(table: LobbyState) {
  const s = useStore.getState();
  useStore.setState({ table });
  if (!table.started) remote.leaving = false;
  const seat = table.started && !remote.leaving ? table.yourSeat : null;
  if (seat !== null && !s.tableGame && s.server) {
    useStore.setState({ tableGame: true, game: null, human: seat, humans: [seat], ...freshSeat, confirmExit: false });
    watchSeat(seat);
  } else if (seat === null && s.tableGame) {
    remote.unwatch?.();
    remote.unwatch = null;
    useStore.setState({ tableGame: false, game: null, hover: null, targeting: null, viewer: null, confirmExit: false });
  }
}

/** A deck to send to a table, with the fetched cards the host can't know. */
export const deckChoice = (deck: DeckDef): DeckChoice => ({ deck, cards: fetchedCardsOf([deck]) });

/** The cards fetched from Scryfall that these decks use, for the server, which can't fetch them itself. */
function fetchedCardsOf(decks: DeckDef[]) {
  const names = new Set(decks.flatMap((d) => [...d.commanders, ...d.cards, ...Object.keys(d.basics)]));
  return [...names].filter(isFetched).map((n) => cardData(n));
}

/** Tells the server each person's stops and settings, when there is a server. */
function sendPrefs() {
  const { server, game, humans, stops, settings } = useStore.getState();
  if (!server || !game) return;
  for (const h of humans) server.prefs({ seat: h, prefs: { stops: absoluteStops(stops, h, game.players.length), manualDamage: settings.manualDamage } });
}

/**
 * Runs a move on this seat's view of the game, to refuse an illegal one at once. Priority
 * isn't passed on: whether another player would want it depends on their hand. The engine
 * checks a move before carrying it out, so if carrying it out reaches a card this view
 * hides (the opening hands' actions after the last mulligan, say), the move was legal
 * and the server works out the rest: the result is null, meaning nothing to show yet.
 */
function checkOnView(g: Game, a: Action): Game | null {
  try {
    return applyAction(g, a, { ...engineOptions(), autoPass: false });
  } catch (err) {
    if (err instanceof Error && err.message === `Unknown card: ${HIDDEN}`) return null;
    throw err;
  }
}

/** The human's stops go to the engine with every action, bots' included: those decide when the human is asked too. */
function engineOptions(): ApplyOptions {
  const { game, humans, stops } = useStore.getState();
  const n = game?.players.length ?? 4;
  return { stops: Object.fromEntries(humans.map((h) => [h, absoluteStops(stops, h, n)])) };
}

/**
 * The seats for a new game: the human's deck in seat 0 (a bot's, when watching), then each
 * opponent seat the settings fill, played by a bot or by another person at this screen.
 * A table needs two players, so the first opponent seat is a bot if the settings leave none.
 */
export function tableOf(deck: DeckDef | null, settings: Settings, saved: DeckDef[]): SeatDef[] {
  const decks = seatDecks(deck, settings.opponents, saved, (d) => savedDeckIssues(d).length === 0);
  const players = settings.players.every((p) => p === 'empty') ? (['bot', ...settings.players.slice(1)] as SeatPlayer[]) : settings.players;
  const opponents = decks.slice(1).flatMap((d, i) => (players[i] === 'empty' ? [] : [{ deck: d, human: deck !== null && players[i] === 'person' }]));
  return [{ deck: decks[0], human: deck !== null }, ...opponents].map((s) => (s.human ? { ...s, manualDamage: settings.manualDamage } : s));
}

/**
 * Passing the screen: when a person at this screen other than the one at the bottom must act,
 * the screen waits to be handed to them, so nobody sees another's hand. One person never waits.
 */
function follow(g: Game, human: PlayerId | null, humans: PlayerId[]): Pick<Store, 'handoff'> {
  const next = g.step === 'gameOver' ? null : g.priority;
  return { handoff: next !== null && next !== human && humans.includes(next) ? next : null };
}
