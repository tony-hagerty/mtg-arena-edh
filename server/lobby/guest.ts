/// <reference types="node" />
// A friend's side of a table: the TLS connection to the host that a join code names. It
// passes this computer's window's lobby requests and moves to the host, and the host's
// lobby and this seat's views back. To the window it is a game like any other
// (`GameService`), played as the seat the host gave.
import type { TLSSocket } from 'node:tls';
import type { Action, CardData, PlayerId } from '../../src/engine';
import type { DeckChoice, LobbyState } from '../../src/net/lobby';
import type { SeatPrefs, ViewMessage } from '../../src/net/protocol';
import { Refused } from '../game';
import type { GameService } from '../game';
import { connectToHost, decodeJoinCode, HostIdentityError, JoinCodeError } from '../net';
import type { SaveCopy } from './saves';
import { receive, send } from './wire';
import type { GuestMessage, HostMessage } from './wire';

/** How long to wait for the host to answer hello. */
const ANSWER_MS = 10_000;

export interface GuestEvents {
  /** The table changed, or the host turned down a request (`error`). */
  lobby(state: LobbyState): void;
  /** The connection is gone, with the reason in plain words. */
  closed(reason: string): void;
  /** The game as it stands, for this computer to keep as `seat`'s (saves.ts). */
  save(copy: SaveCopy, seat: number): void;
  /** The game is over: its saved copy can go. */
  forget(id: string): void;
}

export class GuestLink implements GameService {
  /** The table as the host last described it. */
  state: LobbyState;
  private view: ViewMessage | null = null;
  /** Every fetched card's data the host has sent, for a window that opens its stream later. */
  private cards = new Map<string, CardData>();
  private watchers = new Set<(m: ViewMessage) => void>();
  private leaving = false;

  private constructor(
    private socket: TLSSocket,
    first: LobbyState,
    private events: GuestEvents,
  ) {
    this.state = first;
    socket.on('close', () => {
      this.endGame();
      if (!this.leaving) events.closed(this.closing ?? 'Lost the connection to the host.');
    });
  }

  /** The reason the host gave before closing, if it gave one. */
  private closing: string | null = null;

  /** Connects to the host a code names and takes a seat. Throws `Refused` with the reason in plain words. */
  static async join(code: string, name: string, deck: DeckChoice | null, version: string, events: GuestEvents): Promise<GuestLink> {
    let info;
    try {
      info = decodeJoinCode(code);
    } catch (err) {
      throw new Refused(err instanceof JoinCodeError ? err.message : 'That doesn’t look like a code.');
    }
    let socket: TLSSocket;
    try {
      socket = await connectToHost(info.address, info.port, info.fingerprint);
    } catch (err) {
      throw new Refused(
        err instanceof HostIdentityError
          ? 'The computer at that address isn’t the host the code is for. Ask the host for the code again.'
          : 'Couldn’t reach the host. Check the code, and that the host still has the table open.',
      );
    }
    socket.on('error', () => {});
    // Messages that come before the link is made (right behind the first) wait here.
    const early: HostMessage[] = [];
    let heard: (m: HostMessage) => void = (m) => early.push(m);
    receive<HostMessage>(socket, (m) => heard(m));
    const gone = () => heard({ t: 'refused', error: 'The host closed the connection.' });
    socket.once('close', gone);
    const first = await new Promise<HostMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Refused('The host didn’t answer.')), ANSWER_MS);
      heard = (m) => {
        clearTimeout(timer);
        heard = (m) => early.push(m);
        resolve(m);
      };
      send(socket, { t: 'hello', password: Buffer.from(info.password).toString('hex'), name, deck, version });
    }).catch((err) => {
      socket.destroy();
      throw err;
    });
    if (first.t !== 'lobby') {
      socket.destroy();
      throw new Refused(first.t === 'refused' || first.t === 'error' ? first.error : 'The host didn’t answer.');
    }
    socket.off('close', gone);
    const link = new GuestLink(socket, first.state, events);
    heard = (m) => link.heard(m);
    early.forEach(heard);
    return link;
  }

  request(m: GuestMessage) {
    send(this.socket, m);
  }

  /** Leaves the table. */
  leave() {
    this.leaving = true;
    send(this.socket, { t: 'leave' });
    this.socket.end();
    this.endGame();
  }

  // GameService: the window's game, which is the host's.

  start(): void {
    throw new Refused('The host starts the game.');
  }

  end(): void {
    throw new Refused('Only the host can end the game.');
  }

  act(seat: PlayerId, seq: number, action: Action): boolean {
    if (seat !== this.state.yourSeat) return false;
    send(this.socket, { t: 'act', seq, action });
    // The host's next view says whether it was taken.
    return true;
  }

  setPrefs(seat: PlayerId, prefs: SeatPrefs) {
    if (seat === this.state.yourSeat) send(this.socket, { t: 'prefs', prefs });
  }

  setSpeed(speed: number) {
    send(this.socket, { t: 'speed', speed });
  }

  /** This seat's view, whichever seat is asked for: the host sends no other. */
  watch(_seat: PlayerId | null, on: (m: ViewMessage) => void): () => void {
    this.watchers.add(on);
    const cards = [...this.cards.values()];
    on({ ...(this.view ?? this.none()), ...(cards.length ? { cards } : {}) });
    return () => this.watchers.delete(on);
  }

  private heard(m: HostMessage) {
    switch (m.t) {
      case 'lobby':
        this.state = m.state;
        return this.events.lobby(m.state);
      case 'error':
        return this.events.lobby({ ...this.state, error: m.error });
      case 'refused':
        this.closing = m.error;
        return;
      case 'save':
        if (this.state.yourSeat !== null) this.events.save(m.copy, this.state.yourSeat);
        return;
      case 'forget':
        return this.events.forget(m.id);
      case 'view':
        this.view = { ...m.view, cards: undefined };
        for (const c of m.view.cards ?? []) this.cards.set(c.name, c);
        for (const on of this.watchers) on(m.view);
    }
  }

  /** "No game" for a window that hasn't one, or whose table is gone. */
  private none(): ViewMessage {
    return { gameId: (this.view?.gameId ?? 0) + (this.view ? 1 : 0), version: 0, seat: this.state.yourSeat, ack: 0, game: null };
  }

  private endGame() {
    if (!this.view) return;
    const none = this.none();
    this.view = none;
    for (const on of this.watchers) on(none);
  }
}
