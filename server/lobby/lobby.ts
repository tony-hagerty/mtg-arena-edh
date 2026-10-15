// This computer's lobby (src/net/lobby.ts): not at a table, hosting one (hosting.ts), or at
// a friend's (guest.ts). It also says which game the window's game endpoints play: the
// one on this computer, or the friend's host's.
import type { Action, PlayerId } from '../../src/engine';
import type { DeckRequest, HostRequest, JoinRequest, LobbyState, ReadyRequest, TableRequest } from '../../src/net/lobby';
import type { SeatPrefs, StartRequest, ViewMessage } from '../../src/net/protocol';
import { Refused } from '../game';
import type { GameHost, GameService } from '../game';
import { decodeJoinCode, JoinCodeError } from '../net';
import { GuestLink } from './guest';
import { Hosting } from './hosting';
import type { HostingOptions } from './hosting';

const NONE: LobbyState = { role: 'none', code: null, reach: null, seatCount: 0, fillBots: true, seats: [], yourSeat: null, started: false, error: null, votes: [], paused: null, resuming: false, saves: [] };

export class Lobby {
  private hosting: Hosting | null = null;
  private guest: GuestLink | null = null;
  private connecting = false;
  /** The last thing that went wrong, until the next change. */
  private error: string | null = null;
  private watchers = new Set<(s: LobbyState) => void>();

  constructor(
    private game: GameHost,
    private opts: HostingOptions,
  ) {}

  state(): LobbyState {
    const s = this.hosting?.state() ?? this.guest?.state ?? (this.connecting ? { ...NONE, role: 'connecting' as const } : NONE);
    return { ...s, error: this.error ?? s.error };
  }

  /** Calls `on` with the lobby now and after every change, until the returned function is called. */
  watch(on: (s: LobbyState) => void): () => void {
    this.watchers.add(on);
    on(this.state());
    return () => this.watchers.delete(on);
  }

  async host(req: HostRequest) {
    this.close();
    // A game played at this screen before ends: the table's game takes its place.
    this.game.end();
    const hosting = new Hosting(this.game, req, this.opts, () => this.changed());
    await hosting.open();
    this.hosting = hosting;
    this.changed();
  }

  async join(req: JoinRequest) {
    // A mistyped code leaves any table this computer is at as it was.
    try {
      decodeJoinCode(String(req.code ?? ''));
    } catch (err) {
      throw new Refused(err instanceof JoinCodeError ? err.message : 'That doesn’t look like a code.');
    }
    this.close();
    this.connecting = true;
    this.changed();
    try {
      this.guest = await GuestLink.join(String(req.code ?? ''), String(req.name ?? ''), req.deck ?? null, {
        lobby: (state) => {
          this.error = state.error;
          this.changed(false);
        },
        closed: (reason) => {
          this.guest = null;
          this.changed();
          this.error = reason;
          this.changed(false);
        },
      });
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      this.connecting = false;
      this.changed(false);
    }
  }

  deck({ deck }: DeckRequest) {
    if (this.hosting) return this.hosting.table.setDeck(this.hosting.table.host, deck);
    this.atTable().request({ t: 'deck', deck });
  }

  ready({ ready }: ReadyRequest) {
    if (this.hosting) return this.hosting.table.setReady(this.hosting.table.host, !!ready);
    this.atTable().request({ t: 'ready', ready: !!ready });
  }

  table({ seatCount, fillBots }: TableRequest) {
    if (!this.hosting) throw new Refused('Only the host can change the table.');
    this.hosting.table.setTable(seatCount, !!fillBots);
  }

  start() {
    if (!this.hosting) throw new Refused('Only the host can start the game.');
    this.hosting.table.start();
  }

  leave() {
    this.close();
    this.changed();
  }

  /** The game the window's game endpoints play. */
  games(): GameService {
    if (this.guest) return this.guest;
    if (this.hosting) return new HostSeat(this.game, () => this.hosting?.table.seatOf(this.hosting.table.host) ?? null);
    return this.game;
  }

  private atTable(): GuestLink {
    if (!this.guest) throw new Refused('You aren’t at a table.');
    return this.guest;
  }

  /** Leaves any table, without telling the window. */
  private close() {
    if (this.hosting) {
      this.hosting.close();
      // The table's game ends with it.
      this.game.end();
    }
    this.hosting = null;
    this.guest?.leave();
    this.guest = null;
    this.error = null;
  }

  /** Tells the window. A change clears the last error unless `clear` is false. */
  private changed(clear = true) {
    if (clear) this.error = null;
    const s = this.state();
    for (const on of this.watchers) on(s);
  }
}

/**
 * The host's own window at a table it hosts: it plays its own seat and no other, and the
 * game starts from the table, not from the window. (Cheating is no great worry here, but
 * there's no reason for the host's window to see anyone else's hand.)
 */
class HostSeat implements GameService {
  constructor(
    private game: GameHost,
    private seat: () => PlayerId | null,
  ) {}

  start(_req: StartRequest): void {
    throw new Refused('The table starts the game.');
  }

  end(): void {
    throw new Refused('Leave the table to end the game.');
  }

  act(seat: PlayerId, seq: number, action: Action): boolean {
    return seat === this.seat() && this.game.act(seat, seq, action);
  }

  setPrefs(seat: PlayerId, prefs: SeatPrefs) {
    if (seat === this.seat()) this.game.setPrefs(seat, prefs);
  }

  setSpeed(speed: number) {
    this.game.setSpeed(speed);
  }

  watch(_seat: PlayerId | null, send: (m: ViewMessage) => void): () => void {
    return this.game.watch(this.seat(), send);
  }
}
