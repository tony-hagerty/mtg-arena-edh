// What a friend's program and the host's program say to each other over their TLS
// connection (server/net/identity.ts): one JSON message per line. The friend's program
// passes its window's lobby requests and moves on, and its window's lobby and views back.
import type { Socket } from 'node:net';
import type { Action } from '../../src/engine';
import type { DeckChoice, LobbyState } from '../../src/net/lobby';
import type { SeatPrefs, ViewMessage } from '../../src/net/protocol';
import type { SaveCopy } from './saves';

/** The most one message may hold: a deck with every card fetched, or a view of a big board. */
export const MAX_LINE = 8 * 1024 * 1024;

/** From a friend's program to the host. `hello` comes first; nothing else counts before the host answers it. */
export type GuestMessage =
  /** `version` is the friend's program's `APP_VERSION`: the host turns away any other. */
  | { t: 'hello'; password: string; name: string; deck: DeckChoice | null; version: string }
  | { t: 'deck'; deck: DeckChoice }
  | { t: 'ready'; ready: boolean }
  | { t: 'act'; seq: number; action: Action }
  | { t: 'prefs'; prefs: SeatPrefs }
  | { t: 'speed'; speed: number }
  | { t: 'vote'; seat: number; yes: boolean }
  | { t: 'pause'; paused: boolean }
  | { t: 'leave' };

/** From the host to a friend's program. */
export type HostMessage =
  /** The table as this friend sees it. The first one answers `hello`. */
  | { t: 'lobby'; state: LobbyState }
  /** Their seat's view of the game (protocol.ts), once it has started. */
  | { t: 'view'; view: ViewMessage }
  /** The game as it stands, for this player's program to keep (saves.ts). */
  | { t: 'save'; copy: SaveCopy }
  /** The game is over: its saved copy can go. */
  | { t: 'forget'; id: string }
  /** A request the host turned down, in plain words. */
  | { t: 'error'; error: string }
  /** The host won't have them (a wrong code, a full table); the connection closes next. */
  | { t: 'refused'; error: string };

/** Sends one message. */
export function send(socket: Socket, message: GuestMessage | HostMessage) {
  if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
}

/**
 * Calls `on` with each message that arrives, in order. A line that isn't a JSON object, or
 * is longer than MAX_LINE, ends the connection: only a broken or hostile program sends one.
 */
export function receive<M>(socket: Socket, on: (message: M) => void) {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        return void socket.destroy();
      }
      // The handlers read the message's fields: `null` or a number would throw in this event, and take the program down.
      if (typeof message !== 'object' || message === null) return void socket.destroy();
      on(message as M);
      if (socket.destroyed) return;
    }
    if (buffer.length > MAX_LINE) socket.destroy();
  });
}
