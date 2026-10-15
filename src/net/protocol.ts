// What the game window and the game server say to each other (phase 3 of multiplayer).
// The server keeps the whole game; each window gets only its own player's view of it
// (`viewFor`), as a stream of server-sent events, and sends its moves as POSTs.
import type { DeckDef } from '../cards/db';
import type { Action, CardData, Game, PlayerId, Stops } from '../engine';

/** Where the server's endpoints live. */
export const API = 'api/game';

/** A player's own settings, which the server needs to run the game for them. */
export interface SeatPrefs {
  /** Their stops, by whose turn it is (`ApplyOptions.stops`). */
  stops?: Stops;
  /** They divide combat damage by hand (`Player.manualDamage`). */
  manualDamage?: boolean;
}

/** POST `${API}/start`: a new game, in place of any game in progress. */
export interface StartRequest {
  seed?: number;
  /** The seats in turn order: each a deck, and whether a person plays it. */
  seats: { deck: DeckDef; human: boolean; name?: string }[];
  prefs: Partial<Record<PlayerId, SeatPrefs>>;
  /** Cards the decks use that aren't built in (fetched from Scryfall), so the server knows them. */
  cards: CardData[];
}

/** POST `${API}/act`: a move by the person in `seat`. `seq` counts their moves in this game, from 1. */
export interface ActRequest {
  seat: PlayerId;
  seq: number;
  action: Action;
}

/** POST `${API}/prefs`: a player changed their stops or settings. */
export interface PrefsRequest {
  seat: PlayerId;
  prefs: SeatPrefs;
}

/** POST `${API}/speed`: how fast the bots play, as a multiple (1, 2, 4). */
export interface SpeedRequest {
  speed: number;
}

/**
 * One event of GET `${API}/events?seat=N` (or `seat=watch` for an onlooker): the game as
 * that seat sees it now. Sent when the stream opens and after every change.
 */
export interface ViewMessage {
  /** Goes up with each new game, so a window knows its move count starts again. */
  gameId: number;
  /** Goes up with each change to the game. */
  version: number;
  seat: PlayerId | null;
  /** The `seq` of the last move from this seat the server has dealt with, accepted or not. */
  ack: number;
  /** The seat's view, or null when there is no game. */
  game: Game | null;
}
