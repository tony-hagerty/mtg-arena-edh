/// <reference types="node" />
// The lobby's server side (phase 4 of multiplayer): one program hosts, another joins with the
// code over TLS, and they play a game whose whole state only the host has. Both programs
// run in this process, connected through 127.0.0.1.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import './fixtures';
import { DECKS, cardData, isCardName } from '../src/cards/db';
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

/**
 * Waits until `ok` holds, giving the connections time to deliver: two seconds at most. It
 * looks again every millisecond, since a whole game waits like this for every move.
 */
async function until(ok: () => boolean, what = 'the other program') {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  if (ok()) return;
  throw new Error(`timed out waiting for ${what}`);
}

const open: Lobby[] = [];
afterEach(() => open.splice(0).forEach((l) => l.leave()));

/** A program: its game, its lobby, and the lobby its window last heard. */
function program(version = 'test', saves = mkdtempSync(join(tmpdir(), 'arena-saves-'))) {
  const clock = manualClock();
  const game = new GameHost(clock.schedule);
  const lobby = new Lobby(game, { checkHost: noRouter, port: 0, bind: '127.0.0.1', saves, saveEvery: 0, version });
  open.push(lobby);
  let last!: LobbyState;
  lobby.watch((s) => (last = s));
  return { clock, game, lobby, saves, state: () => last };
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

/** Everyone at the table says they're ready, and the host starts. */
async function startGame(...programs: ReturnType<typeof program>[]) {
  const [host] = programs;
  for (const p of programs) p.lobby.ready({ ready: true });
  await until(() => host.state().seats.every((s) => s.ready));
  host.lobby.start();
  await until(() => programs.every((p) => p.state().started));
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

  it('turns away a friend whose program is a different version', async () => {
    const host = program('0.1.0-aaaa');
    await host.lobby.host({ name: 'Ana', deck: choice(DECKS[0]), seatCount: 2, fillBots: false });
    await until(() => !!host.state().code);
    const guest = program('0.1.0-bbbb');
    await expect(guest.lobby.join({ code: host.state().code!, name: 'Ben', deck: null })).rejects.toThrow(
      /different version of Arena EDH \(0\.1\.0-aaaa; yours is 0\.1\.0-bbbb\)/,
    );
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

  it('plays a whole game, each program seeing only its own seat’s hand', { tags: ['game'] }, async () => {
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
    // A finished game can't be carried on, so no one keeps a copy of it.
    await until(() => !host.state().saves.length && !guest.state().saves.length, 'the copies to go');
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

  it('adds only the fetched cards a friend’s deck names to the pool', async () => {
    const base = cardData(DECKS[1].commanders[0]);
    const fetched: CardData = { ...base, name: 'Ben’s Named Commander', oracleText: '', keywords: [] };
    const stowaway: CardData = { ...base, name: 'Ben’s Stowaway', oracleText: '', keywords: [] };
    const deck: DeckDef = { ...DECKS[1], id: 'ben', commanders: [fetched.name] };
    const host = program();
    await host.lobby.host({ name: 'Ana', deck: choice(DECKS[0]), seatCount: 3, fillBots: false });
    await until(() => !!host.state().code);
    const guest = program();
    await guest.lobby.join({ code: host.state().code!, name: 'Ben', deck: choice(deck, [fetched, stowaway]) });
    await until(() => !!host.state().seats[1].deck);
    expect(isCardName(fetched.name)).toBe(true);
    expect(isCardName(stowaway.name)).toBe(false);
    // A list longer than any deck is refused before a card it brings is added.
    const many = Array.from({ length: 150 }, (_, i): CardData => ({ ...base, name: `Eve’s Card ${i}`, oracleText: '', keywords: [] }));
    const huge: DeckDef = { ...DECKS[2], id: 'eve', cards: many.map((c) => c.name) };
    const other = program();
    await other.lobby.join({ code: host.state().code!, name: 'Eve', deck: choice(huge, many) });
    await until(() => !!other.state().error);
    expect(other.state().error).toMatch(/more than a deck holds/);
    expect(many.some((c) => isCardName(c.name))).toBe(false);
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
    await other.lobby.join({ code: host.state().code!, name: 'ben', deck: choice(DECKS[2]) });
    await new Promise((r) => setTimeout(r, 50));
    expect(other.state()).toMatchObject({ role: 'joined', yourSeat: 1, started: true, error: null });
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

describe('when someone goes, and saved games', () => {
  it('lets a bot play a gone friend’s seat once most of the table votes for it, until they come back', async () => {
    const { host, guest } = await hostAndJoin(3);
    const cat = program();
    await cat.lobby.join({ code: host.state().code!, name: 'Cat', deck: choice(DECKS[2]) });
    await until(() => !!host.state().seats[2]?.deck);
    await startGame(host, guest, cat);
    cat.lobby.leave();
    await until(() => host.state().seats[2].away);
    expect(host.state().votes).toEqual([{ seat: 2, name: 'Cat', yes: 0, no: 0, needed: 2, yours: null }]);

    host.lobby.vote({ seat: 2, yes: true });
    expect(host.state().votes[0]).toMatchObject({ yes: 1, yours: true });
    guest.lobby.vote({ seat: 2, yes: false });
    await until(() => guest.state().votes[0]?.yours === false);
    expect(host.game.full!.players[2].isBot).toBe(false);
    // A vote can be changed: now two of the two people here say yes.
    guest.lobby.vote({ seat: 2, yes: true });
    await until(() => host.state().seats[2].standIn);
    expect(host.state().votes).toEqual([]);
    expect(host.game.full!.players[2].isBot).toBe(true);
    expect(host.game.full!.log.at(-1)?.text).toMatch(/A bot plays for Cat/);

    const back = program();
    await back.lobby.join({ code: host.state().code!, name: 'Cat', deck: null });
    expect(back.state()).toMatchObject({ yourSeat: 2, started: true });
    expect(host.state().seats[2]).toMatchObject({ away: false, standIn: false });
    expect(host.game.full!.players[2].isBot).toBe(false);
  });

  it('pauses the game for everyone until someone carries on', async () => {
    const { host, guest } = await hostAndJoin(3, true);
    await startGame(host, guest);
    guest.lobby.pause({ paused: true });
    await until(() => !!host.state().paused);
    expect(host.state().paused).toEqual({ by: 'Ben' });
    // Nobody moves and the bots wait.
    expect(host.clock.next()).toBe(false);
    const g = host.game.full!;
    expect(host.game.act(g.priority, 1, botAction(g, g.priority))).toBe(false);
    expect(host.game.full).toBe(g);
    host.lobby.pause({ paused: false });
    await until(() => !guest.state().paused);
    expect(host.game.isPaused).toBe(false);
  });

  it('keeps a copy of the game on every player’s computer, in their own seat', async () => {
    const { host, guest } = await hostAndJoin();
    await startGame(host, guest);
    await until(() => host.state().saves.length === 1 && guest.state().saves.length === 1, 'the copies');
    const [mine, theirs] = [host.state().saves[0], guest.state().saves[0]];
    expect(mine.id).toBe(theirs.id);
    expect(mine).toMatchObject({ yourSeat: 0, players: [{ name: 'Ana', bot: false }, { name: 'Ben', bot: false }] });
    expect(theirs.yourSeat).toBe(1);
    // A copy can be thrown away.
    guest.lobby.forget({ save: theirs.id });
    expect(guest.state().saves).toEqual([]);
  });

  it('lets a friend carry the game on as the new host after the host goes', async () => {
    const { host, guest } = await hostAndJoin();
    await startGame(host, guest);
    await until(() => guest.state().saves.length === 1, 'the copy');
    const game = host.game.full!;
    host.lobby.leave();
    await until(() => guest.state().role === 'none');

    await guest.lobby.resume({ save: guest.state().saves[0].id });
    await until(() => !!guest.state().code);
    expect(guest.state()).toMatchObject({ role: 'hosting', resuming: true, started: false, yourSeat: 1 });
    expect(guest.state().seats.map((s) => [s.name, s.away, s.host])).toEqual([
      ['Ana', true, false],
      ['Ben', false, true],
    ]);
    expect(() => guest.lobby.start()).toThrow(/Waiting for Ana/);

    // The old host comes back as a friend, under the name they played as.
    await expect(host.lobby.join({ code: guest.state().code!, name: 'Eve', deck: null })).rejects.toThrow(/name you played as: Ana/);
    // Their window sends the deck they picked, not knowing the table carries on a saved game.
    await host.lobby.join({ code: guest.state().code!, name: 'Ana', deck: choice(DECKS[2]) });
    await new Promise((r) => setTimeout(r, 50));
    expect(host.state()).toMatchObject({ role: 'joined', yourSeat: 0, resuming: true, error: null });
    guest.lobby.start();
    expect(guest.game.full).toEqual(game);
    await until(() => host.state().started);
    let view: ViewMessage | null = null;
    host.lobby.games().watch(0, (m) => (view = m));
    await until(() => !!view?.game);
    expect(view!.game!.players[0].hand).toEqual(game.players[0].hand);
  });

  it('resumes a saved game only with the version of the program it was played with', async () => {
    const { host, guest } = await hostAndJoin();
    await startGame(host, guest);
    await until(() => guest.state().saves.length === 1, 'the copy');
    host.lobby.leave();
    // The same folder, after the friend got a newer copy of the program.
    const newer = program('newer', guest.saves);
    await expect(newer.lobby.resume({ save: newer.state().saves[0].id })).rejects.toThrow(/saved by a different version of Arena EDH \(test; this is newer\)/);
    expect(newer.state().role).toBe('none');
  });

  it('carries a saved game on with a bot for someone who doesn’t come back, if the table agrees', async () => {
    const { host, guest } = await hostAndJoin();
    await startGame(host, guest);
    await until(() => host.state().saves.length === 1, 'the copy');
    guest.lobby.leave();
    host.lobby.leave();
    await host.lobby.resume({ save: host.state().saves[0].id });
    host.lobby.vote({ seat: 1, yes: true });
    expect(host.state().seats[1]).toMatchObject({ away: true, standIn: true });
    host.lobby.start();
    expect(host.game.full!.players.map((p) => p.isBot)).toEqual([false, true]);
  });
});

describe('the lobby over HTTP', () => {
  it('hosts from the window, streams the lobby, and answers a bad code with the reason', async () => {
    const { makeServer, listen } = await import('../launcher/serve');
    const { handleApi } = await import('../server/lobby');
    const lobby = new Lobby(new GameHost(manualClock().schedule), { checkHost: noRouter, port: 0, bind: '127.0.0.1', saves: mkdtempSync(join(tmpdir(), 'arena-saves-')) });
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
