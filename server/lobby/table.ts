// The host's table: who sits where, with which deck, who is ready, and starting the game
// on the host's GameHost. During a game it keeps track of who has gone, the table's votes
// on letting a bot play their seats, and pausing. A table can also carry on a saved game
// (`Table.resume`). It knows nothing of connections: the host's own window and each
// friend's connection (hosting.ts) are a `Person` here.
import { DECKS, deckProblems, isCardName, registerCards } from '../../src/cards/db';
import type { DeckDef } from '../../src/cards/db';
import { scriptCards } from '../../src/cards/oracle';
import { unsupported } from '../../src/cards/support';
import { produce } from 'immer';
import type { DeckChoice, LobbySeat, LobbyState, SavedGame, SeatVote } from '../../src/net/lobby';
import type { StartRequest } from '../../src/net/protocol';
import type { GameHost } from '../game';
import { Refused } from '../game';
import { newSaveId, scramble } from './saves';
import type { SaveCopy, SaveData } from './saves';

export interface Person {
  name: string;
  deck: DeckChoice | null;
  ready: boolean;
  /**
   * They left, or lost their connection, during a game (or haven't come back yet to a
   * resumed one): the seat waits for them.
   */
  gone?: boolean;
  /** The table voted for a bot to play their seat while they're gone. */
  standIn?: boolean;
}

/** A table has 2 to 4 seats (phase 1 of multiplayer). */
export const MIN_SEATS = 2;
export const MAX_SEATS = 4;

type DeckSummary = { title: string; commanders: string[] };

/** The part of `LobbyState` the table knows; the lobby adds the rest. */
export type TableState = Pick<LobbyState, 'seatCount' | 'fillBots' | 'seats' | 'yourSeat' | 'started' | 'votes' | 'paused' | 'resuming'>;

export class Table {
  /** The seats in turn order: a person, or null for a seat no one has taken (or a bot's, once started). */
  private seats: (Person | null)[];
  private started = false;
  /** Once started (or resuming), the deck of each seat a bot plays. */
  private bots: (DeckSummary | null)[] = [];
  /** For each person who has gone, how each person still here voted on a bot playing their seat. */
  private votes = new Map<Person, Map<Person, boolean>>();
  private pausedBy: string | null = null;
  /** The saved game this table carries on, until it has (`start`). */
  private saved: SaveData | null = null;
  /** The id this table's game is saved under, on every player's computer. */
  saveId: string | null = null;

  constructor(
    private game: GameHost,
    readonly host: Person,
    private seatCount: number,
    private fillBots: boolean,
    /** Called after every change, for the lobby to tell everyone. */
    private changed: () => void,
  ) {
    this.seatCount = clampSeats(seatCount);
    this.seats = [host, ...Array(this.seatCount - 1).fill(null)];
    if (host.deck) this.setDeck(host, host.deck, false);
  }

  /**
   * A table that carries on saved game `save`, with this computer's player as its host in
   * their own seat. The others are away until they join again under the same names.
   */
  static resume(game: GameHost, save: SavedGame & { data: SaveData }, changed: () => void): Table {
    const people = save.players.map((p, i) => (p.bot ? null : { name: p.name, deck: null, ready: true, gone: i !== save.yourSeat }));
    const host = people[save.yourSeat];
    if (!host) throw new Refused('That saved game has no seat for you.');
    const table = new Table(game, host, people.length, false, changed);
    table.seats = people;
    table.seatCount = people.length;
    table.bots = save.data.decks.map((d, i) => (people[i] ? null : d));
    table.saved = save.data;
    table.saveId = save.id;
    return table;
  }

  get resuming() {
    return !!this.saved;
  }

  /**
   * A friend sits at the first free seat. During a game, or at a table carrying on a saved
   * one, a person who has gone comes back to their own seat by joining under the same name.
   */
  join(name: string, deck: DeckChoice | null): Person {
    const clean = name.trim();
    if (this.started || this.saved) {
      const back = this.seats.find((p) => p?.gone && p.name.toLowerCase() === clean.toLowerCase());
      if (!back) {
        const away = this.away().map((p) => p.name);
        if (!this.saved) throw new Refused('The game at this table has already started.');
        throw new Refused(`This table carries on a saved game. Join under the name you played as${away.length ? `: ${away.join(' or ')}` : ''}.`);
      }
      back.gone = false;
      this.votes.delete(back);
      if (back.standIn) {
        back.standIn = false;
        if (this.started) this.game.setBot(this.seats.indexOf(back), false);
      }
      this.changed();
      return back;
    }
    const free = this.seats.indexOf(null);
    if (free < 0) throw new Refused('This table is full.');
    if (this.people().some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
      throw new Refused(`Someone at this table is already called ${clean}. Join under another name.`);
    }
    const person: Person = { name: clean || `Player ${free + 1}`, deck: null, ready: false };
    this.seats[free] = person;
    if (deck) {
      try {
        this.setDeck(person, deck, false);
      } catch {
        // They can pick another deck at the table; the problem shows when they do.
      }
    }
    this.changed();
    return person;
  }

  /**
   * A friend leaves. Before the game their seat opens again. During it (or at a table
   * carrying on a saved game), it stays theirs: the game waits for them to come back,
   * and the people still here vote on letting a bot play it meanwhile.
   */
  leave(person: Person) {
    const seat = this.seats.indexOf(person);
    if (seat < 0 || person === this.host) return;
    if (this.started || this.saved) {
      person.gone = true;
      // Their votes on others' seats no longer count; the rest may now pass.
      this.settleVotes();
    } else this.seats[seat] = null;
    this.changed();
  }

  /** Picks a person's deck. A deck that can't be played is refused, with the first reason. */
  setDeck(person: Person, choice: DeckChoice, tell = true) {
    if (this.saved) throw new Refused('A saved game carries on with the decks it had.');
    if (this.started && !this.over()) throw new Refused('Decks can’t change during a game.');
    const issues = deckIssues(choice);
    if (issues.length) throw new Refused(`That deck can’t be played here: ${issues[0]}.`);
    person.deck = choice;
    if (tell) this.changed();
  }

  setReady(person: Person, ready: boolean) {
    if (this.saved) return;
    if (ready && !person.deck) throw new Refused('Pick a deck first.');
    person.ready = ready;
    this.changed();
  }

  /** The host changes the table's size or the bots checkbox. */
  setTable(seatCount: number, fillBots: boolean) {
    if (this.saved) throw new Refused('A saved game carries on with the seats it had.');
    if (this.started && !this.over()) throw new Refused('The table can’t change during a game.');
    const n = clampSeats(seatCount);
    const people = this.people();
    if (people.length > n) throw new Refused(`${people.length} people are at the table, so it needs at least ${people.length} seats.`);
    // People keep their order; free seats go at the end.
    this.seats = [...this.seats.slice(0, n).filter(Boolean), ...this.seats.slice(n).filter(Boolean)] as (Person | null)[];
    while (this.seats.length < n) this.seats.push(null);
    this.seatCount = n;
    this.fillBots = fillBots;
    this.changed();
  }

  /** `voter`'s vote on letting a bot play the seat of the away person in `seat`. */
  vote(voter: Person, seat: number, yes: boolean) {
    const away = this.seats[seat];
    if (!away?.gone || away.standIn) throw new Refused('There’s no vote on that seat.');
    if (voter.gone || voter === away) return;
    let votes = this.votes.get(away);
    if (!votes) this.votes.set(away, (votes = new Map()));
    votes.set(voter, yes);
    this.settleVotes();
    this.changed();
  }

  /** Pauses the game, or carries on. Anyone at the table may. */
  setPaused(person: Person, paused: boolean) {
    if (!this.started || this.over()) throw new Refused('There’s no game to pause.');
    this.pausedBy = paused ? person.name : null;
    this.game.setPaused(paused);
    this.changed();
  }

  /**
   * Starts the game, or a new one after the last ended. Free seats get bots when the
   * checkbox is ticked; otherwise the table closes up to the seats people took. At a
   * table carrying on a saved game, carries on with it instead.
   */
  start() {
    if (this.saved) return this.carryOn(this.saved);
    if (this.started && !this.over()) throw new Refused('A game is already under way.');
    // Anyone who went during the last game gives up their seat for the next.
    this.seats = this.seats.map((p) => (p?.gone ? null : p));
    this.votes.clear();
    for (const p of this.people()) p.standIn = false;
    const people = this.people();
    const waiting = people.find((p) => !p.ready || !p.deck);
    if (waiting) throw new Refused(`Waiting for ${waiting === this.host ? 'you' : waiting.name} to be ready.`);
    const seats = this.fillBots ? this.seats : people;
    if (seats.length < MIN_SEATS) throw new Refused('A game needs at least 2 players. Wait for a friend, or tick “Fill empty seats with bots”.');
    this.seats = seats;
    this.seatCount = seats.length;
    const decks = botDecks(people.map((p) => p.deck!.deck), seats.length);
    const req: StartRequest = {
      seats: seats.map((p, i) => (p ? { deck: p.deck!.deck, human: true, name: p.name } : { deck: decks[i], human: false })),
      prefs: {},
      cards: people.flatMap((p) => p.deck!.cards),
    };
    this.bots = seats.map((p, i) => (p ? null : summary(decks[i])));
    this.started = true;
    this.pausedBy = null;
    this.saveId = newSaveId();
    this.game.start(req);
    this.changed();
  }

  /** The game seat `person` plays, or null if they have none. */
  seatOf(person: Person): number | null {
    const seat = this.seats.indexOf(person);
    return seat < 0 ? null : seat;
  }

  /** The game as it stands, to save on every player's computer. Null when there's nothing to carry on. */
  saveCopy(): SaveCopy | null {
    const snap = this.started && !this.over() ? this.game.snapshot() : null;
    if (!snap || !this.saveId) return null;
    const decks = this.seats.map((p, i) => (p?.deck ? summary(p.deck.deck) : (this.bots[i] ?? null)));
    return {
      id: this.saveId,
      savedAt: Date.now(),
      turn: snap.game.turn,
      players: this.seats.map((p, i) => ({ name: p?.name ?? snap.game.players[i].name, bot: !p })),
      data: scramble({ ...snap, decks }),
    };
  }

  /** The table as `person` sees it. */
  stateFor(person: Person): TableState {
    const g = this.started ? this.game.full : null;
    const seats: LobbySeat[] = this.seats.map((p, i) => {
      const common = { you: p === person, host: p === this.host, away: !!p?.gone, standIn: !!p?.standIn };
      const deck = p?.deck ? summary(p.deck.deck) : (this.saved?.decks[i] ?? null);
      if (p) return { kind: 'person', name: p.name, deck, ready: p.ready, ...common };
      const bot = this.bots[i];
      if (bot) return { kind: 'bot', name: g?.players[i]?.name ?? this.saved?.game.players[i]?.name ?? 'Bot', deck: bot, ready: true, ...common };
      return this.fillBots
        ? { kind: 'bot', name: 'Bot', deck: null, ready: true, ...common }
        : { kind: 'open', name: '', deck: null, ready: false, ...common };
    });
    return {
      seatCount: this.seatCount,
      fillBots: this.fillBots,
      seats,
      yourSeat: this.seatOf(person),
      started: this.started,
      votes: this.votesFor(person),
      paused: this.pausedBy !== null && this.started && !this.over() ? { by: this.pausedBy } : null,
      resuming: !!this.saved,
    };
  }

  private carryOn(save: SaveData) {
    const waiting = this.away().find((p) => !p.standIn);
    if (waiting) throw new Refused(`Waiting for ${waiting.name} to join again, or for the table to let a bot play their seat.`);
    // People play their own seats again, unless a bot stands in for one still away.
    const game = produce(save.game, (d) => {
      this.seats.forEach((p, i) => {
        if (p) d.players[i].isBot = !!p.standIn;
      });
    });
    this.saved = null;
    this.started = true;
    this.pausedBy = null;
    this.game.load(game, save.prefs, save.cards);
    this.changed();
  }

  private people(): Person[] {
    return this.seats.filter((p): p is Person => !!p);
  }

  private away(): Person[] {
    return this.people().filter((p) => p.gone);
  }

  /** Votes need more than half the people still at the table (Tony's rule for a bot taking a seat). */
  private needed() {
    return Math.floor(this.people().filter((p) => !p.gone).length / 2) + 1;
  }

  private yesVotes(away: Person) {
    return [...(this.votes.get(away) ?? [])].filter(([voter, yes]) => yes && !voter.gone).length;
  }

  /** Lets a bot play each away person's seat whose vote has passed. */
  private settleVotes() {
    for (const p of this.away()) {
      if (p.standIn || this.yesVotes(p) < this.needed()) continue;
      p.standIn = true;
      this.votes.delete(p);
      if (this.started) this.game.setBot(this.seats.indexOf(p), true);
    }
  }

  private votesFor(person: Person): SeatVote[] {
    return this.away()
      .filter((p) => !p.standIn)
      .map((p) => {
        const votes = [...(this.votes.get(p) ?? [])].filter(([voter]) => !voter.gone);
        return {
          seat: this.seats.indexOf(p),
          name: p.name,
          yes: votes.filter(([, yes]) => yes).length,
          no: votes.filter(([, yes]) => !yes).length,
          needed: this.needed(),
          yours: this.votes.get(p)?.get(person) ?? null,
        };
      });
  }

  private over() {
    return this.game.full?.step === 'gameOver' || !this.game.full;
  }
}

/**
 * Why a deck can't be played at this table: a card the engine can't play, or the deck
 * rules (`deckProblems`). Cards the player's program fetched from Scryfall come with the
 * deck and are added here; that program already refused any Scryfall says isn't legal in
 * Commander, so legality isn't checked again.
 */
function deckIssues({ deck, cards }: DeckChoice): string[] {
  const fresh = cards.filter((c) => !isCardName(c.name));
  if (fresh.length) {
    registerCards(Object.fromEntries(fresh.map((c) => [c.name, c])));
    scriptCards(fresh.map((c) => c.name));
  }
  const names = [...new Set([...deck.commanders, ...Object.keys(deck.basics), ...deck.cards])];
  const cant = names.flatMap((n) => unsupported(n).map((p) => `${n}: ${p}`));
  return cant.length ? cant : deckProblems(deck);
}

const clampSeats = (n: number) => Math.min(MAX_SEATS, Math.max(MIN_SEATS, Math.floor(n) || MIN_SEATS));

const summary = (deck: DeckDef): DeckSummary => ({ title: deck.title, commanders: deck.commanders });

/** `count` decks for the bots: built-in decks no person brought, in a random order, repeating if there aren't enough. */
function botDecks(taken: DeckDef[], count: number): DeckDef[] {
  const free = DECKS.filter((d) => !taken.some((t) => t.id === d.id));
  const pool = (free.length ? free : DECKS).map((d) => ({ d, r: Math.random() })).sort((a, b) => a.r - b.r).map((x) => x.d);
  return Array.from({ length: count }, (_, i) => pool[i % pool.length]);
}
