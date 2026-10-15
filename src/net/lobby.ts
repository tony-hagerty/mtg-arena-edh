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

// POST `${LOBBY_API}/start` (host only, empty body): start the game. Refused (409, with
// the reason) unless every person is ready and, without the checkbox, at least 2 seats
// are filled. Open seats become bots when the checkbox is ticked; otherwise the table
// shrinks to the filled seats.
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
}
