/// <reference types="node" />
// Hosting a table: the TLS server friends' programs connect to, the join code, and the
// check of whether friends outside this home can reach it (server/net). Each friend's
// connection is a person at the `Table`; once the game starts, it carries their seat's view.
import type { AddressInfo } from 'node:net';
import { networkInterfaces } from 'node:os';
import { createServer, type Server, type TLSSocket } from 'node:tls';
import type { DeckChoice, HostRequest, LobbyState } from '../../src/net/lobby';
import type { GameHost } from '../game';
import { Refused } from '../game';
import { createHostIdentity, encodeJoinCode, explainHostCheck, newJoinPassword, passwordsMatch, tlsServerOptions } from '../net';
import type { HostCheck } from '../net';
import { Table } from './table';
import type { Person } from './table';
import { receive, send } from './wire';
import type { GuestMessage } from './wire';

/** Friends connect to this port, or one of the next few if another program holds it. */
export const HOST_PORT = 47190;
const TRIES = 10;
/** How long a new connection has to say hello with the right password. */
const HELLO_MS = 10_000;

export interface HostingOptions {
  /** Opens the router's port and finds the public address (server/net `checkHost`). Tests pass their own. */
  checkHost: (port: number) => Promise<HostCheck>;
  /** The first port to try. */
  port?: number;
  /** The address to listen on: every network ('0.0.0.0') unless a test says otherwise. */
  bind?: string;
}

interface Guest {
  socket: TLSSocket;
  person: Person;
  unwatch: (() => void) | null;
}

export class Hosting {
  readonly table: Table;
  private identity = createHostIdentity();
  private password = newJoinPassword();
  private server: Server | null = null;
  private guests = new Set<Guest>();
  private check: HostCheck | null = null;
  private code: string | null = null;
  private reach: LobbyState['reach'] = { kind: 'checking', message: 'Checking whether friends can reach this computer…' };
  private closed = false;

  constructor(
    private game: GameHost,
    req: HostRequest,
    private opts: HostingOptions,
    /** Called after every change, for the host's own window. */
    private onChange: () => void,
  ) {
    const host: Person = { name: String(req.name ?? '').trim() || 'Host', deck: req.deck, ready: false };
    this.table = new Table(game, host, req.seatCount, req.fillBots, () => this.changed());
  }

  /** Starts listening for friends, then works out the code. Resolves once friends can connect. */
  async open() {
    const first = this.opts.port ?? HOST_PORT;
    for (let port = first; port < first + TRIES; port++) {
      const server = createServer(tlsServerOptions(this.identity), (socket) => this.welcome(socket));
      const ok = await new Promise<boolean>((resolve) => {
        server.once('error', () => resolve(false));
        server.listen(port, this.opts.bind ?? '0.0.0.0', () => resolve(true));
      });
      if (!ok) continue;
      this.server = server;
      // The port it got: the one asked for, or any free one for a test that asks for 0.
      void this.findAddress((server.address() as AddressInfo).port);
      return;
    }
    throw new Refused(`Couldn’t host: ports ${first} to ${first + TRIES - 1} are all in use.`);
  }

  /** The table as the host's window sees it. */
  state(): LobbyState {
    return { role: 'hosting', code: this.code, reach: this.reach, error: null, ...this.table.stateFor(this.table.host) };
  }

  /** Ends the table: friends are told, the router's port is closed. */
  close() {
    this.closed = true;
    for (const g of this.guests) {
      send(g.socket, { t: 'refused', error: 'The host closed the table.' });
      g.unwatch?.();
      g.socket.end();
    }
    this.guests.clear();
    this.server?.close();
    void this.check?.mapping?.close().catch(() => {});
  }

  private async findAddress(port: number) {
    let check: HostCheck | null = null;
    try {
      check = await this.opts.checkHost(port);
    } catch {
      // Treated as a router that didn't answer: the code still works on this network.
    }
    if (this.closed) return void check?.mapping?.close().catch(() => {});
    this.check = check;
    const local = check?.localAddress ?? lanAddress();
    const pub = check && (check.kind === 'open' || check.kind === 'manual') ? check.publicAddress : null;
    const address = pub ?? local;
    this.code = encodeJoinCode({ address, port: check && 'port' in check ? check.port : port, password: this.password, fingerprint: this.identity.fingerprint });
    let message = check ? explainHostCheck(check) : 'Couldn’t reach your router to open a port for friends outside your home.';
    if (!pub && check?.kind !== 'cgnat') message += ' For now, the code works for players on your own network.';
    this.reach = { kind: check?.kind ?? 'manual', message };
    this.onChange();
  }

  private changed() {
    for (const g of this.guests) {
      send(g.socket, { t: 'lobby', state: this.guestState(g.person) });
      this.follow(g);
    }
    this.onChange();
  }

  /** Once the game starts, each friend's connection carries their seat's view. */
  private follow(g: Guest) {
    const seat = this.table.seatOf(g.person);
    if (!g.unwatch && this.table.stateFor(g.person).started && seat !== null) {
      g.unwatch = this.game.watch(seat, (view) => send(g.socket, { t: 'view', view }));
    }
  }

  private guestState(person: Person): LobbyState {
    return { role: 'joined', code: null, reach: null, error: null, ...this.table.stateFor(person) };
  }

  /** A friend's program connected: it must say hello with the code's password before anything else. */
  private welcome(socket: TLSSocket) {
    let guest: Guest | null = null;
    const timer = setTimeout(() => socket.destroy(), HELLO_MS);
    const refuse = (error: string) => {
      send(socket, { t: 'refused', error });
      socket.end();
    };
    socket.on('error', () => {});
    socket.on('close', () => {
      clearTimeout(timer);
      if (!guest) return;
      guest.unwatch?.();
      this.guests.delete(guest);
      this.table.leave(guest.person);
    });
    receive<GuestMessage>(socket, (m) => {
      if (!guest) {
        if (m.t !== 'hello' || !passwordsMatch(fromHex(m.password), this.password)) return refuse('That code is wrong or out of date. Ask the host for the code again.');
        clearTimeout(timer);
        try {
          const person = this.table.join(String(m.name ?? ''), null);
          guest = { socket, person, unwatch: null };
          this.guests.add(guest);
          send(socket, { t: 'lobby', state: this.guestState(person) });
          this.follow(guest);
          // A deck the table can't play leaves them seated, told why, to pick another.
          if (m.deck) this.guestDeck(guest, m.deck);
        } catch (err) {
          refuse(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      this.request(guest, m);
    });
  }

  private request(g: Guest, m: GuestMessage) {
    const seat = this.table.seatOf(g.person);
    try {
      switch (m.t) {
        case 'deck':
          return this.guestDeck(g, m.deck);
        case 'ready':
          return this.table.setReady(g.person, !!m.ready);
        case 'act':
          if (seat !== null) this.game.act(seat, m.seq, m.action);
          return;
        case 'prefs':
          if (seat !== null) this.game.setPrefs(seat, m.prefs);
          return;
        case 'speed':
          return this.game.setSpeed(m.speed);
        case 'leave':
          return void g.socket.end();
      }
    } catch (err) {
      send(g.socket, { t: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  private guestDeck(g: Guest, deck: DeckChoice) {
    try {
      this.table.setDeck(g.person, deck);
    } catch (err) {
      send(g.socket, { t: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }
}

const fromHex = (hex: unknown) => new Uint8Array(Buffer.from(typeof hex === 'string' ? hex : '', 'hex'));

/** This computer's address on its home network, for a code when the router says nothing. */
function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return '127.0.0.1';
}
