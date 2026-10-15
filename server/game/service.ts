// What the game endpoints (http.ts) play: the game held on this computer (`GameHost`), or,
// for a friend who joined a table, the host's game reached through the lobby.
import type { Action, PlayerId } from '../../src/engine';
import type { SeatPrefs, StartRequest, ViewMessage } from '../../src/net/protocol';

export interface GameService {
  /** Starts a new game on this computer. Throws `Refused` when a table's game is played here instead. */
  start(req: StartRequest): void;
  /** A move from the person in `seat`; true if it was taken. */
  act(seat: PlayerId, seq: number, action: Action): boolean;
  setPrefs(seat: PlayerId, prefs: SeatPrefs): void;
  setSpeed(speed: number): void;
  /** Ends the game. Throws `Refused` when this window may not. */
  end(): void;
  /** Sends `seat`'s view (null: an onlooker's) now and after every change, until the returned function is called. */
  watch(seat: PlayerId | null, send: (m: ViewMessage) => void): () => void;
}

/** A request this computer won't carry out, with the reason in plain words. Answered with 409. */
export class Refused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Refused';
  }
}
