// The host's table: who sits where, with which deck, who is ready, and starting the game
// on the host's GameHost. It knows nothing of connections: the host's own window and each
// friend's connection (hosting.ts) are a `Person` here.
import { DECKS, deckProblems, isCardName, registerCards } from '../../src/cards/db';
import type { DeckDef } from '../../src/cards/db';
import { scriptCards } from '../../src/cards/oracle';
import { unsupported } from '../../src/cards/support';
import type { DeckChoice, LobbySeat, LobbyState } from '../../src/net/lobby';
import type { StartRequest } from '../../src/net/protocol';
import type { GameHost } from '../game';
import { Refused } from '../game';

export interface Person {
  name: string;
  deck: DeckChoice | null;
  ready: boolean;
  /** They left, or lost their connection, during a game: the seat waits for them. */
  gone?: boolean;
}

/** A table has 2 to 4 seats (phase 1 of multiplayer). */
export const MIN_SEATS = 2;
export const MAX_SEATS = 4;

/** The part of `LobbyState` the table knows; the lobby adds the rest. */
export type TableState = Pick<LobbyState, 'seatCount' | 'fillBots' | 'seats' | 'yourSeat' | 'started'>;

export class Table {
  /** The seats in turn order: a person, or null for one no one has taken. The host is seats[0]. */
  private seats: (Person | null)[];
  private started = false;
  /** Once started, the deck of each seat a bot plays. */
  private bots: (DeckDef | null)[] = [];

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
   * A friend sits at the first free seat. During a game, a friend who left can come back
   * to their own seat by joining again under the same name.
   */
  join(name: string, deck: DeckChoice | null): Person {
    if (this.started) {
      const back = this.seats.find((p) => p?.gone && p.name.toLowerCase() === name.trim().toLowerCase());
      if (!back) throw new Refused('The game at this table has already started.');
      back.gone = false;
      this.changed();
      return back;
    }
    const free = this.seats.indexOf(null);
    if (free < 0) throw new Refused('This table is full.');
    const person: Person = { name: name.trim() || `Player ${free + 1}`, deck: null, ready: false };
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
   * A friend leaves. Before the game their seat opens again. During it, it stays theirs,
   * and the game waits for them to come back: handing it to a bot when the table agrees
   * is still to come (phase 5 of multiplayer).
   */
  leave(person: Person) {
    const seat = this.seats.indexOf(person);
    if (seat <= 0) return;
    if (this.started) person.gone = true;
    else this.seats[seat] = null;
    this.changed();
  }

  /** Picks a person's deck. A deck that can't be played is refused, with the first reason. */
  setDeck(person: Person, choice: DeckChoice, tell = true) {
    if (this.started && !this.over()) throw new Refused('Decks can’t change during a game.');
    const issues = deckIssues(choice);
    if (issues.length) throw new Refused(`That deck can’t be played here: ${issues[0]}.`);
    person.deck = choice;
    if (tell) this.changed();
  }

  setReady(person: Person, ready: boolean) {
    if (ready && !person.deck) throw new Refused('Pick a deck first.');
    person.ready = ready;
    this.changed();
  }

  /** The host changes the table's size or the bots checkbox. */
  setTable(seatCount: number, fillBots: boolean) {
    if (this.started && !this.over()) throw new Refused('The table can’t change during a game.');
    const n = clampSeats(seatCount);
    const people = this.seats.filter(Boolean) as Person[];
    if (people.length > n) throw new Refused(`${people.length} people are at the table, so it needs at least ${people.length} seats.`);
    // People keep their order; free seats go at the end.
    this.seats = [...this.seats.slice(0, n).filter(Boolean), ...this.seats.slice(n).filter(Boolean)] as (Person | null)[];
    while (this.seats.length < n) this.seats.push(null);
    this.seatCount = n;
    this.fillBots = fillBots;
    this.changed();
  }

  /**
   * Starts the game, or a new one after the last ended. Free seats get bots when the
   * checkbox is ticked; otherwise the table closes up to the seats people took.
   */
  start() {
    if (this.started && !this.over()) throw new Refused('A game is already under way.');
    const people = this.seats.filter(Boolean) as Person[];
    const waiting = people.find((p) => !p.ready || !p.deck);
    if (waiting) throw new Refused(`Waiting for ${waiting === this.host ? 'you' : waiting.name} to be ready.`);
    const seats = this.fillBots ? this.seats : people;
    if (seats.length < MIN_SEATS) throw new Refused('A game needs at least 2 players. Wait for a friend, or tick “Fill empty seats with bots”.');
    this.seats = seats;
    this.seatCount = seats.length;
    const decks = botDecks(people.map((p) => p.deck!.deck), seats.length);
    this.bots = seats.map((p, i) => (p ? null : decks[i]));
    const req: StartRequest = {
      seats: seats.map((p, i) => (p ? { deck: p.deck!.deck, human: true, name: p.name } : { deck: this.bots[i]!, human: false })),
      prefs: {},
      cards: people.flatMap((p) => p.deck!.cards),
    };
    this.started = true;
    this.game.start(req);
    this.changed();
  }

  /** The game seat `person` plays, or null if they have none. */
  seatOf(person: Person): number | null {
    const seat = this.seats.indexOf(person);
    return seat < 0 ? null : seat;
  }

  /** The table as `person` sees it. */
  stateFor(person: Person): TableState {
    const g = this.started ? this.game.full : null;
    const seats: LobbySeat[] = this.seats.map((p, i) => {
      const common = { you: p === person, host: i === 0, away: false, standIn: false };
      if (p) return { kind: 'person', name: p.name, deck: p.deck && summary(p.deck.deck), ready: p.ready, ...common };
      const bot = g?.players[i];
      const deck = this.bots[i];
      if (bot && deck) return { kind: 'bot', name: bot.name, deck: summary(deck), ready: true, ...common };
      return this.fillBots
        ? { kind: 'bot', name: 'Bot', deck: null, ready: true, ...common }
        : { kind: 'open', name: '', deck: null, ready: false, ...common };
    });
    return { seatCount: this.seatCount, fillBots: this.fillBots, seats, yourSeat: this.seatOf(person), started: this.started };
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

const summary = (deck: DeckDef) => ({ title: deck.title, commanders: deck.commanders });

/** `count` decks for the bots: built-in decks no person brought, in a random order, repeating if there aren't enough. */
function botDecks(taken: DeckDef[], count: number): DeckDef[] {
  const free = DECKS.filter((d) => !taken.some((t) => t.id === d.id));
  const pool = (free.length ? free : DECKS).map((d) => ({ d, r: Math.random() })).sort((a, b) => a.r - b.r).map((x) => x.d);
  return Array.from({ length: count }, (_, i) => pool[i % pool.length]);
}
