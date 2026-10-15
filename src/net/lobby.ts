// The lobby (phase 4 of multiplayer): hosting a table, joining one with a code, and
// starting the game. The game window only ever talks to the program on its own computer;
// that program is the host, or it relays to the host over TLS for a friend who joined.
// Once the lobby says the game has started, the window plays it through `API`
// (protocol.ts) as the seat `LobbyState.yourSeat`, exactly as on one computer.
import type { DeckDef } from '../cards/db';
import type { CardData } from '../engine';

/** Where the lobby's endpoints live, on the window's own computer. */
export const LOBBY_API = 'api/lobby';

/** A deck sent to the table, with the data of any of its cards that aren't built in (fetched from Scryfall). */
export interface DeckChoice {
  deck: DeckDef;
  cards: CardData[];
}

/** One seat at the table, in turn order. */
export interface LobbySeat {
  /** No one yet; a friend who joined; a bot (the host's checkbox, or a seat a person left). */
  kind: 'open' | 'person' | 'bot';
  /** The person's name, or the bot's. Empty for an open seat. */
  name: string;
  /** The deck's title and commanders, once picked. Bots' decks are picked at the start. */
  deck: { title: string; commanders: string[] } | null;
  /** The person has picked a legal deck and is ready to play. Always true for a bot. */
  ready: boolean;
  /** This window's own seat. */
  you: boolean;
  /** The host's seat. */
  host: boolean;
  /**
   * A person who left or lost their connection during a game, or who hasn't come back yet
   * to a resumed one. Their seat waits for them: they come back by joining with the
   * table's code under the same name.
   */
  away: boolean;
  /** A bot plays this away person's seat, because the table voted for it, until they come back. */
  standIn: boolean;
}

/**
 * The table's vote on letting a bot play an away person's seat (Tony's rule: only when a
 * majority of the people still at the table agree). It opens when they go and stays open,
 * with no time limit, until it passes or they come back. A vote can be changed.
 */
export interface SeatVote {
  seat: number;
  name: string;
  yes: number;
  no: number;
  /** Yes votes it takes to pass: more than half the people at the table now. */
  needed: number;
  /** This window's vote, or null if it hasn't voted. */
  yours: boolean | null;
}

/** A game saved on this computer, which this player can resume by hosting it again. */
export interface SavedGame {
  id: string;
  /** When it was last saved, in ms since 1970. */
  savedAt: number;
  turn: number;
  /** The players in turn order. */
  players: { name: string; bot: boolean }[];
  /** This computer's player's seat in it. */
  yourSeat: number;
}

export interface LobbyState {
  /**
   * none: not at a table. hosting: this computer hosts. connecting: reaching the host
   * after a code was entered. joined: at a friend's table.
   */
  role: 'none' | 'hosting' | 'connecting' | 'joined';
  /** The code to send friends (hosting only, once the address is known). */
  code: string | null;
  /**
   * Whether friends outside this home can reach the host, in plain words for the host to
   * read (`explainHostCheck`). `open` means the code works over the internet; anything else
   * means only players on the same network can join, or the host must change a router
   * setting, as the message says. Null while checking, and for anyone but the host.
   */
  reach: { kind: 'checking' | 'open' | 'cgnat' | 'double-nat' | 'manual'; message: string } | null;
  /** How many seats the table has (2 to 4). Only the host changes it. */
  seatCount: number;
  /** The host's "Fill empty seats with bots" checkbox. */
  fillBots: boolean;
  seats: LobbySeat[];
  /** This window's seat, or null when not at a table. */
  yourSeat: number | null;
  /** The game is under way: play it through `API` as `yourSeat`. */
  started: boolean;
  /** The last thing that went wrong, in plain words (a bad code, the host left), or null. */
  error: string | null;
  /** Open votes, one for each away person whose seat no bot plays. */
  votes: SeatVote[];
  /** The game is paused, and who paused it. Nobody can move, the bots wait, until someone resumes it. */
  paused: { by: string } | null;
  /**
   * This table resumes a saved game: its seats are the game's, and people come back by
   * joining under the names they played as. `start` resumes the game once nobody is away
   * without a stand-in.
   */
  resuming: boolean;
  /**
   * Games saved on this computer, newest first, in every role. Every player's program
   * keeps a copy of the table's game, updated as it's played and when it's paused, so if
   * the host goes, anyone can resume it (`resume`) as the new host.
   */
  saves: SavedGame[];
}

/** POST `${LOBBY_API}/host`: open a table on this computer and sit at its first seat. */
export interface HostRequest {
  name: string;
  deck: DeckChoice | null;
  seatCount: number;
  fillBots: boolean;
}

/** POST `${LOBBY_API}/join`: join the table a code names. */
export interface JoinRequest {
  code: string;
  name: string;
  deck: DeckChoice | null;
}

/** POST `${LOBBY_API}/deck`: pick (or change) this seat's deck. */
export interface DeckRequest {
  deck: DeckChoice;
}

/** POST `${LOBBY_API}/ready`: say this seat is ready, or not. */
export interface ReadyRequest {
  ready: boolean;
}

/** POST `${LOBBY_API}/table` (host only): the table's size and the bots checkbox. */
export interface TableRequest {
  seatCount: number;
  fillBots: boolean;
}

/** POST `${LOBBY_API}/vote`: this window's vote on letting a bot play `seat` (an away person's). */
export interface VoteRequest {
  seat: number;
  yes: boolean;
}

/** POST `${LOBBY_API}/pause`: pause the table's game, or carry on. Anyone at the table may. */
export interface PauseRequest {
  paused: boolean;
}

/**
 * POST `${LOBBY_API}/resume`: host a new table for saved game `save` (from `saves`), with a
 * new code, sitting in this player's own seat. Leaves any table this computer is at.
 */
export interface ResumeRequest {
  save: string;
}

/** POST `${LOBBY_API}/forget`: delete saved game `save` from this computer. */
export interface ForgetRequest {
  save: string;
}

// POST `${LOBBY_API}/start` (host only, empty body): start the game. Refused (409, with
// the reason) unless every person is ready and, without the checkbox, at least 2 seats
// are filled. Open seats become bots when the checkbox is ticked; otherwise the table
// shrinks to the filled seats. At a resuming table, `start` resumes the saved game
// instead, refused while someone is away and no bot plays their seat.
// POST `${LOBBY_API}/leave` (empty body): leave the table. For the host, this ends it.
// GET `${LOBBY_API}/events`: a stream of `LobbyState` (server-sent events), sent when it
// opens and after every change.
// A refused request answers with a 4xx status and `{ error: string }` in plain words.

/** The window's side of the lobby. `connectLobby` (src/ui/lobby.ts) makes the real one; tests make their own. */
export interface LobbyConnection {
  /** Calls `on` with the lobby now and after every change, until the returned function is called. */
  watch(on: (state: LobbyState) => void): () => void;
  host(req: HostRequest): Promise<void>;
  join(req: JoinRequest): Promise<void>;
  deck(req: DeckRequest): Promise<void>;
  ready(req: ReadyRequest): Promise<void>;
  table(req: TableRequest): Promise<void>;
  start(): Promise<void>;
  leave(): Promise<void>;
  vote(req: VoteRequest): Promise<void>;
  pause(req: PauseRequest): Promise<void>;
  resume(req: ResumeRequest): Promise<void>;
  forget(req: ForgetRequest): Promise<void>;
}
