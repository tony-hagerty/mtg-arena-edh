/// <reference types="node" />
// The lobby's server side (phase 4 of multiplayer): one program hosts, another joins with the
// code over TLS, and they play a game whose whole state only the host has. Both programs
// run in this process, connected through 127.0.0.1.
import { afterEach, describe, expect, it } from 'vitest';
import './fixtures';
import { DECKS, cardData } from '../src/cards/db';
import type { DeckDef } from '../src/cards/db';
import { botAction, isHidden } from '../src/engine';
import type { CardData } from '../src/engine';
import type { DeckChoice, LobbyState } from '../src/net/lobby';
import type { ViewMessage } from '../src/net/protocol';
import { GameHost, Refused } from '../server/game';
import { Lobby } from '../server/lobby';
import type { HostCheck } from '../server/net';
import { decodeJoinCode, encodeJoinCode, newJoinPassword } from '../server/net';

/** A scheduler the test runs by hand: bots act only when `next` is called. */
function manualClock() {
  const queue: { fn: () => void; ms: number }[] = [];
  return {
    schedule: (fn: () => void, ms: number) => {
      const item = { fn, ms };
      queue.push(item);
      return () => void queue.splice(queue.indexOf(item), 1);
    },
    next() {
      const item = queue.shift();
      item?.fn();
      return !!item;
    },
  };
}

/** A router that opened nothing: the code carries this computer's address on the home network. */
const noRouter = async (port: number): Promise<HostCheck> => ({ kind: 'manual', publicAddress: null, port, localAddress: '127.0.0.1', failures: [], mapping: null });

const choice = (deck: DeckDef, cards: CardData[] = []): DeckChoice => ({ deck, cards });

/** Waits until `ok` holds, giving the connections time to deliver. */
async function until(ok: () => boolean, what = 'the other program') {
  for (let i = 0; i < 400; i++) {
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const open: Lobby[] = [];
afterEach(() => open.splice(0).forEach((l) => l.leave()));

/** A program: its game, its lobby, and the lobby its window last heard. */
function program() {
  const clock = manualClock();
  const game = new GameHost(clock.schedule);
  const lobby = new Lobby(game, { checkHost: noRouter, port: 0, bind: '127.0.0.1' });
  open.push(lobby);
  let last!: LobbyState;
  lobby.watch((s) => (last = s));
  return { clock, game, lobby, state: () => last };
}

async function hostAndJoin(seatCount = 2, fillBots = false) {
  const host = program();
  await host.lobby.host({ name: 'Ana', deck: choice(DECKS[0]), seatCount, fillBots });
  await until(() => !!host.state().code, 'the code');
  const guest = program();
  await guest.lobby.join({ code: host.state().code!, name: 'Ben', deck: choice(DECKS[1]) });
  await until(() => !!host.state().seats[1]?.deck && !!guest.state().seats[1]?.deck);
  return { host, guest };
}

describe('a table of friends', () => {
  it('gives the host a code, and seats a friend who joins with it', async () => {
    const { host, guest } = await hostAndJoin(3);
    expect(host.state()).toMatchObject({ role: 'hosting', yourSeat: 0, seatCount: 3, started: false });
    expect(host.state().reach!.message).toMatch(/own network/);
    expect(decodeJoinCode(host.state().code!).address).toBe('127.0.0.1');
    expect(host.state().seats.map((s) => [s.kind, s.name, s.you])).toEqual([
      ['person', 'Ana', true],
      ['person', 'Ben', false],
      ['open', '', false],
    ]);
    expect(guest.state()).toMatchObject({ role: 'joined', yourSeat: 1, code: null });
    expect(guest.state().seats[1]).toMatchObject({ you: true, deck: { title: DECKS[1].title } });
  });

  it('turns away a code with the wrong password', async () => {
    const host = program();
    await host.lobby.host({ name: 'Ana', deck: choice(DECKS[0]), seatCount: 2, fillBots: false });
    await until(() => !!host.state().code);
    const wrong = encodeJoinCode({ ...decodeJoinCode(host.state().code!), password: newJoinPassword() });
    const guest = program();
    await expect(guest.lobby.join({ code: wrong, name: 'Eve', deck: null })).rejects.toThrow(/wrong or out of date/);
    expect(guest.state()).toMatchObject({ role: 'none', error: expect.stringMatching(/wrong/) });
    expect(host.state().seats.filter((s) => s.kind === 'person')).toHaveLength(1);
  });

  it('says plainly when a code is mistyped', async () => {
    const guest = program();
    await expect(guest.lobby.join({ code: 'ARENA-1234', name: 'Eve', deck: null })).rejects.toThrow(/too short/);
  });

  it('starts only when everyone is ready, and closes up the empty seats', async () => {
    const { host, guest } = await hostAndJoin(4);
    expect(() => host.lobby.start()).toThrow(/Waiting for you/);
    host.lobby.ready({ ready: true });
    expect(() => host.lobby.start()).toThrow(/Waiting for Ben/);
    expect(() => guest.lobby.start()).toThrow(Refused);
    guest.lobby.ready({ ready: true });
    await until(() => host.state().seats[1].ready);
    host.lobby.start();
    await until(() => guest.state().started);
    expect(host.state().seatCount).toBe(2);
    expect(host.game.full!.players.map((p) => [p.name, p.isBot])).toEqual([
      ['Ana', false],
      ['Ben', false],
    ]);
  });

  it('fills empty seats with bots when the host ticks the box', async () => {
    const { host, guest } = await hostAndJoin(4, true);
    expect(host.state().seats.map((s) => s.kind)).toEqual(['person', 'person', 'bot', 'bot']);
    host.lobby.ready({ ready: true });
    guest.lobby.ready({ ready: true });
    await until(() => host.state().seats[1].ready);
    host.lobby.start();
    expect(host.game.full!.players.map((p) => p.isBot)).toEqual([false, false, true, true]);
    expect(host.state().seats[2]).toMatchObject({ kind: 'bot', deck: { title: expect.any(String) } });
  });

  it('plays a whole game, each program seeing only its own seat’s hand', async () => {
    const { host, guest } = await hostAndJoin(3, true);
    host.lobby.ready({ ready: true });
    guest.lobby.ready({ ready: true });
    await until(() => host.state().seats[1].ready);
    host.lobby.start();
    await until(() => guest.state().started);

    const views: Record<number, ViewMessage> = {};
    host.lobby.games().watch(0, (m) => (views[0] = m));
    // The friend's window asks for its own seat through its own program.
    guest.lobby.games().watch(1, (m) => (views[1] = m));
    await until(() => !!views[1]?.game);
    expect(views[0].game!.players[1].hand.every(isHidden)).toBe(true);
    expect(views[1].game!.players[0].hand.every(isHidden)).toBe(true);
    expect(views[1].game!.players[1].hand.some(isHidden)).toBe(false);

    const seq = [0, 0];
    const programs = [host, guest];
    for (let i = 0; host.game.full!.step !== 'gameOver'; i++) {
      if (i > 20_000) throw new Error(`no winner by turn ${host.game.full!.turn}`);
      const g = host.game.full!;
      const seat = g.priority;
      if (g.players[seat].isBot) {
        expect(host.clock.next()).toBe(true);
        continue;
      }
      // Each person's move is the bot's choice, sent from their own program.
      const version = views[seat].version;
      expect(programs[seat].lobby.games().act(seat, ++seq[seat], botAction(g, seat))).toBe(true);
      await until(() => views[seat].version > version, `the host's answer to seat ${seat}`);
      expect(host.game.full).not.toBe(g);
    }
    await until(() => views[1].game!.step === 'gameOver');
    expect(views[1].game!.winner).toBe(host.game.full!.winner);
  });

  it('keeps the host’s window to the host’s own seat', async () => {
    const { host, guest } = await hostAndJoin();
    host.lobby.ready({ ready: true });
    guest.lobby.ready({ ready: true });
    await until(() => host.state().seats[1].ready);
    host.lobby.start();
    const games = host.lobby.games();
    expect(() => games.start({ seats: [], prefs: {}, cards: [] })).toThrow(/table starts/);
    let seen: ViewMessage | null = null;
    games.watch(1, (m) => (seen = m));
    expect(seen!.seat).toBe(0);
    const g = host.game.full!;
    if (g.priority === 1) expect(games.act(1, 1, botAction(g, 1))).toBe(false);
  });

  it('sends each player the data of a friend’s Scryfall cards once they can see them', async () => {
    // A commander the host's pool doesn't have, as a friend's program fetched it.
    const base = cardData(DECKS[1].commanders[0]);
    const fetched: CardData = { ...base, name: 'Ben’s Fetched Commander', oracleText: '', keywords: [] };
    const deck: DeckDef = { ...DECKS[1], id: 'ben', commanders: [fetched.name] };
    const host = program();
    await host.lobby.host({ name: 'Ana', deck: choice(DECKS[0]), seatCount: 2, fillBots: false });
    await until(() => !!host.state().code);
    const guest = program();
    await guest.lobby.join({ code: host.state().code!, name: 'Ben', deck: choice(deck, [fetched]) });
    await until(() => !!host.state().seats[1].deck);
    host.lobby.ready({ ready: true });
    guest.lobby.ready({ ready: true });
    await until(() => host.state().seats[1].ready);
    host.lobby.start();
    const got: ViewMessage[] = [];
    host.lobby.games().watch(0, (m) => got.push(m));
    // The commander starts in the command zone, where everyone sees it (903.6).
    expect(got[0].cards?.map((c) => c.name)).toEqual([fetched.name]);
    host.game.setSpeed(2);
    host.clock.next();
    expect(got.slice(1).some((m) => m.cards?.length)).toBe(false);
  });

  it('seats a friend whose deck the table can’t play, and says why', async () => {
    const host = program();
    await host.lobby.host({ name: 'Ana', deck: choice(DECKS[0]), seatCount: 2, fillBots: false });
    await until(() => !!host.state().code);
    const guest = program();
    const short: DeckDef = { ...DECKS[1], cards: DECKS[1].cards.slice(1) };
    await guest.lobby.join({ code: host.state().code!, name: 'Ben', deck: choice(short) });
    await until(() => !!guest.state().error);
    expect(guest.state()).toMatchObject({ role: 'joined', yourSeat: 1, error: expect.stringMatching(/can’t be played here/) });
    expect(guest.state().seats[1].deck).toBe(null);
  });

  it('lets a friend who lost their connection come back to their seat', async () => {
    const { host, guest } = await hostAndJoin();
    host.lobby.ready({ ready: true });
    guest.lobby.ready({ ready: true });
    await until(() => host.state().seats[1].ready);
    host.lobby.start();
    await until(() => guest.state().started);
    guest.lobby.leave();
    await new Promise((r) => setTimeout(r, 50));
    const other = program();
    await expect(other.lobby.join({ code: host.state().code!, name: 'Eve', deck: null })).rejects.toThrow(/already started/);
    await other.lobby.join({ code: host.state().code!, name: 'ben', deck: null });
    expect(other.state()).toMatchObject({ role: 'joined', yourSeat: 1, started: true });
    let view: ViewMessage | null = null;
    other.lobby.games().watch(1, (m) => (view = m));
    await until(() => !!view?.game);
    expect(view!.game!.players[1].hand.some(isHidden)).toBe(false);
  });

  it('tells a friend when the host closes the table', async () => {
    const { host, guest } = await hostAndJoin();
    host.lobby.leave();
    await until(() => guest.state().role === 'none');
    expect(guest.state().error).toMatch(/host closed the table/);
  });

  it('opens a friend’s seat again when they leave before the game', async () => {
    const { host, guest } = await hostAndJoin();
    guest.lobby.leave();
    await until(() => host.state().seats[1].kind === 'open');
    expect(guest.state().role).toBe('none');
  });
});

describe('the lobby over HTTP', () => {
  it('hosts from the window, streams the lobby, and answers a bad code with the reason', async () => {
    const { makeServer, listen } = await import('../launcher/serve');
    const { handleApi } = await import('../server/lobby');
    const lobby = new Lobby(new GameHost(manualClock().schedule), { checkHost: noRouter, port: 0, bind: '127.0.0.1' });
    open.push(lobby);
    const server = makeServer({
      files: () => undefined,
      pages: { pageOpened() {}, pageClosed() {} },
      hello: { app: 'arena-edh', data: '' },
      api: (req, res, path) => handleApi(lobby, req, res, path),
    });
    try {
      expect(await listen(server, 0)).toBe(true);
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const post = (route: string, body: unknown) =>
        fetch(`${base}/api/lobby/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) });
      expect((await post('host', { name: 'Ana', deck: choice(DECKS[0]), seatCount: 2, fillBots: true })).status).toBe(204);
      const ctrl = new AbortController();
      const reader = (await fetch(`${base}/api/lobby/events`, { signal: ctrl.signal })).body!.getReader();
      let text = '';
      while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value);
      ctrl.abort();
      const state: LobbyState = JSON.parse(text.slice(text.indexOf('data: ') + 6, text.indexOf('\n\n')));
      expect(state).toMatchObject({ role: 'hosting', yourSeat: 0, seatCount: 2 });
      // The game endpoints now play the table's game, which the window can't start itself.
      expect((await fetch(`${base}/api/game/start`, { method: 'POST', headers: { Origin: base }, body: '{}' })).status).toBe(409);
      const bad = await post('join', { code: 'ARENA-0000', name: 'Ana', deck: null });
      expect(bad.status).toBe(409);
      expect((await bad.json()).error).toMatch(/too short/);
      expect(lobby.state().role).toBe('hosting');
    } finally {
      server.close();
    }
  });
});
