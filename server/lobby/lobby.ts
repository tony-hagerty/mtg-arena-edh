// This computer's lobby (src/net/lobby.ts): not at a table, hosting one (hosting.ts), or at
// a friend's (guest.ts). It keeps this computer's copies of its tables' games (saves.ts),
// which its player can carry on by hosting them again. It also says which game the
// window's game endpoints play: the one on this computer, or the friend's host's.
import type { Action, PlayerId } from '../../src/engine';
import type {
  DeckRequest,
  ForgetRequest,
  HostRequest,
  JoinRequest,
  LobbyState,
  PauseRequest,
  ReadyRequest,
  ResumeRequest,
  SavedGame,
  TableRequest,
  VoteRequest,
} from '../../src/net/lobby';
import type { SeatPrefs, StartRequest, ViewMessage } from '../../src/net/protocol';
import { Refused } from '../game';
import type { GameHost, GameService } from '../game';
import { decodeJoinCode, JoinCodeError } from '../net';
import type { JoinInfo } from '../net';
import { GuestLink } from './guest';
import { Hosting } from './hosting';
import type { HostingEvents, HostingOptions } from './hosting';
import { SaveStore } from './saves';
import { APP_VERSION } from './version';
import { Table } from './table';
import type { Person } from './table';

export interface LobbyOptions extends HostingOptions {
  /** The folder saved games are kept in (ArenaEDH-data/saves beside the .exe). */
  saves: string;
}

const NONE: LobbyState = { role: 'none', code: null, reach: null, seatCount: 0, fillBots: true, seats: [], yourSeat: null, started: false, error: null, votes: [], paused: null, resuming: false, saves: [] };

export class Lobby {
  private hosting: Hosting | null = null;
  private guest: GuestLink | null = null;
  private connecting = false;
  /** The last thing that went wrong, until the next change. */
  private error: string | null = null;
  private watchers = new Set<(s: LobbyState) => void>();
  private store: SaveStore;
  private saves: SavedGame[];

  constructor(
    private game: GameHost,
    private opts: LobbyOptions,
  ) {
    this.store = new SaveStore(opts.saves, this.version);
    this.saves = this.store.list();
  }

  private get version() {
    return this.opts.version ?? APP_VERSION;
  }

  state(): LobbyState {
    const s = this.hosting?.state() ?? this.guest?.state ?? (this.connecting ? { ...NONE, role: 'connecting' as const } : NONE);
    return { ...s, saves: this.saves, error: this.error ?? s.error };
  }

  /** Calls `on` with the lobby now and after every change, until the returned function is called. */
  watch(on: (s: LobbyState) => void): () => void {
    this.watchers.add(on);
    on(this.state());
    return () => this.watchers.delete(on);
  }

  async host(req: HostRequest) {
    const host: Person = { name: String(req.name ?? '').trim() || 'Host', deck: req.deck ?? null, ready: false };
    await this.open((changed) => new Table(this.game, host, req.seatCount, !!req.fillBots, changed));
  }

  /** Hosts a new table for a game saved here, with this computer's player in their own seat. */
  async resume({ save }: ResumeRequest) {
    const saved = this.store.read(String(save ?? ''));
    if (!saved) throw new Refused('That saved game can’t be read any more.');
    await this.open((changed) => Table.resume(this.game, saved, changed));
  }

  forget({ save }: ForgetRequest) {
    this.store.remove(String(save ?? ''));
    this.savesChanged();
  }

  vote({ seat, yes }: VoteRequest) {
    if (this.hosting) return this.hosting.table.vote(this.hosting.table.host, Number(seat), !!yes);
    this.atTable().request({ t: 'vote', seat: Number(seat), yes: !!yes });
  }

  pause({ paused }: PauseRequest) {
    if (this.hosting) return this.hosting.table.setPaused(this.hosting.table.host, !!paused);
    this.atTable().request({ t: 'pause', paused: !!paused });
  }

  private async open(table: (changed: () => void) => Table) {
    this.close();
    // A game played at this screen before ends: the table's game takes its place.
    this.game.end();
    const events: HostingEvents = {
      changed: () => this.changed(),
      save: (copy, seat) => this.keep(() => this.store.write(copy, seat)),
      forget: (id) => this.keep(() => this.store.remove(id)),
    };
    const hosting = new Hosting(this.game, table, this.opts, events);
    await hosting.open();
    this.hosting = hosting;
    this.changed();
  }

  async join(req: JoinRequest) {
    // A mistyped code leaves any table this computer is at as it was.
    let info: JoinInfo;
    try {
      info = decodeJoinCode(String(req.code ?? ''));
    } catch (err) {
      throw new Refused(err instanceof JoinCodeError ? err.message : 'That doesn’t look like a code.');
    }
    this.close();
    this.connecting = true;
    this.changed();
    try {
      this.guest = await GuestLink.join(info, String(req.name ?? ''), req.deck ?? null, this.version, {
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
        save: (copy, seat) => this.keep(() => this.store.write(copy, seat)),
        forget: (id) => this.keep(() => this.store.remove(id)),
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

  /** Writes or removes a saved game. A full or read-only disk shouldn't stop the game. */
  private keep(change: () => void) {
    try {
      change();
    } catch {
      return;
    }
    this.savesChanged();
  }

  private savesChanged() {
    const before = JSON.stringify(this.saves);
    this.saves = this.store.list();
    if (JSON.stringify(this.saves) !== before) this.changed(false);
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
