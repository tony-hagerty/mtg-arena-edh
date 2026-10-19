// The game server (server/game, phase 3 of multiplayer): it holds the whole game, plays the
// bots, takes each person's moves, and gives each seat only its own view.
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import './fixtures';
import { DECKS } from '../src/cards/db';
import { botAction, isHidden } from '../src/engine';
import type { Game, PlayerId } from '../src/engine';
import type { StartRequest, ViewMessage } from '../src/net/protocol';
import { GameHost, errorLine, handleErrorReport, handleGameApi } from '../server/game';
import { listen, makeServer } from '../launcher/serve';

/** A scheduler the test runs by hand: bots act only when `next` is called. */
function manualClock() {
  const queue: { fn: () => void; ms: number }[] = [];
  return {
    queue,
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

const seats = (...humans: boolean[]): StartRequest['seats'] => humans.map((human, i) => ({ deck: DECKS[i], human }));

function setup(req: Partial<StartRequest> = {}) {
  const clock = manualClock();
  const host = new GameHost(clock.schedule);
  host.start({ seed: 7, seats: seats(true, false, true, false), prefs: {}, cards: [], ...req });
  return { clock, host };
}

/** Plays out the game: people's moves are the bot's choices, sent as they would be. */
function playToEnd(host: GameHost, clock: ReturnType<typeof manualClock>) {
  const seq: Record<number, number> = {};
  for (let i = 0; host.full!.step !== 'gameOver'; i++) {
    if (i > 20_000) throw new Error(`no winner by turn ${host.full!.turn}`);
    const g = host.full!;
    if (!g.players[g.priority].isBot) {
      const seat = g.priority;
      seq[seat] = (seq[seat] ?? 0) + 1;
      if (!host.act(seat, seq[seat], botAction(g, seat))) throw new Error(`refused a move at step ${g.step}`);
    } else if (!clock.next()) throw new Error('a bot has the decision but nothing is scheduled');
  }
}

describe('the game host', () => {
  it('sends each seat its own view, now and after every change', () => {
    const { host } = setup();
    const got: ViewMessage[] = [];
    host.watch(0, (m) => got.push(m));
    expect(got).toHaveLength(1);
    const v = got[0].game!;
    expect(v.players[0].hand.some(isHidden)).toBe(false);
    expect(v.players[1].hand.every(isHidden)).toBe(true);
    expect(v.players[2].hand.every(isHidden)).toBe(true);
    expect(v.rng).toBe(0);
    expect(got[0]).toMatchObject({ seat: 0, ack: 0 });
  });

  it('takes a move only from the person the game is waiting on', () => {
    const { host, clock } = setup();
    while (host.full!.players[host.full!.priority].isBot) clock.next();
    const g = host.full!;
    const other = ([0, 2] as PlayerId[]).find((p) => p !== g.priority)!;
    const got: ViewMessage[] = [];
    host.watch(other, (m) => got.push(m));
    expect(host.act(other, 1, { type: 'keep' })).toBe(false);
    expect(host.full).toBe(g);
    // The refused move is still acknowledged, so that window takes the next view.
    expect(got.at(-1)!.ack).toBe(1);
    expect(host.act(g.priority, 1, botAction(g, g.priority))).toBe(true);
  });

  it('never lets a seat move for a bot', () => {
    const { host, clock } = setup();
    while (!host.full!.players[host.full!.priority].isBot) {
      const g = host.full!;
      host.act(g.priority, 1, botAction(g, g.priority));
    }
    const g = host.full!;
    expect(host.act(g.priority, 1, botAction(g, g.priority))).toBe(false);
    expect(clock.queue.length).toBe(1);
  });

  it('plays a whole game with two people and two bots', () => {
    const { host, clock } = setup();
    const last: Record<number, ViewMessage> = {};
    for (const seat of [0, 2]) host.watch(seat, (m) => (last[seat] = m));
    playToEnd(host, clock);
    expect(host.full!.winner).not.toBe(null);
    expect(last[0].game!.step).toBe('gameOver');
    expect(last[2].game!.winner).toBe(host.full!.winner);
  });

  it('plays the bots after a pause, faster at a higher speed', () => {
    const { host, clock } = setup({ seats: seats(false, false) });
    expect(clock.queue.length).toBe(1);
    const slow = clock.queue[0].ms;
    host.setSpeed(4);
    expect(clock.queue).toHaveLength(1);
    expect(clock.queue[0].ms).toBe(slow / 4);
  });

  it('applies a person’s settings to the game', () => {
    const { host } = setup();
    host.setPrefs(2, { manualDamage: true });
    expect(host.full!.players[2].manualDamage).toBe(true);
    host.setPrefs(1, { manualDamage: true });
    expect(host.full!.players[1].manualDamage).toBeFalsy();
  });

  it('starts each game with a new id, and says when there is none', () => {
    const { host } = setup();
    const got: ViewMessage[] = [];
    host.watch(0, (m) => got.push(m));
    const first = got[0].gameId;
    host.start({ seats: seats(true, false), prefs: {}, cards: [] });
    expect(got.at(-1)!.gameId).toBeGreaterThan(first);
    expect(got.at(-1)!.game!.players).toHaveLength(2);
    host.end();
    expect(got.at(-1)!.game).toBe(null);
  });
});

describe('the game server over HTTP', () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  async function serve() {
    const host = new GameHost(manualClock().schedule);
    server = makeServer({
      files: () => undefined,
      pages: { pageOpened() {}, pageClosed() {} },
      hello: { app: 'arena-edh', data: '' },
      api: (req, res, path) => handleGameApi(host, req, res, path),
    });
    expect(await listen(server, 0)).toBe(true);
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;
    const post = (route: string, body: unknown, origin: string | null = base) =>
      fetch(`${base}/api/game/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
    return { host, base, post };
  }

  /** The first event of a seat's stream. */
  async function firstView(base: string, seat: string): Promise<ViewMessage> {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/game/events?seat=${seat}`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    let text = '';
    while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value);
    ctrl.abort();
    return JSON.parse(text.slice(text.indexOf('data: ') + 6, text.indexOf('\n\n')));
  }

  it('says hello, starts a game, streams a seat’s view and takes its moves', async () => {
    const { host, base, post } = await serve();
    expect(await (await fetch(`${base}/api/game/hello`)).json()).toEqual({ server: true });
    expect((await post('start', { seed: 3, seats: seats(true, true), prefs: {}, cards: [] })).status).toBe(204);
    const g: Game = host.full!;
    const seat = g.priority;
    const view = await firstView(base, String(seat));
    expect(view.game!.players[seat].hand.some(isHidden)).toBe(false);
    expect(view.game!.players[1 - seat].hand.every(isHidden)).toBe(true);
    const res = await post('act', { seat, seq: 1, action: { type: 'keep' } });
    expect(await res.json()).toEqual({ ok: true });
    expect(host.full).not.toBe(g);
    expect((await firstView(base, 'watch')).game!.players.every((p) => p.hand.every(isHidden))).toBe(true);
  });

  it('refuses moves from other web pages', async () => {
    const { host, post } = await serve();
    expect((await post('start', { seats: seats(true, true), prefs: {}, cards: [] }, 'http://evil.example')).status).toBe(403);
    expect((await post('start', { seats: seats(true, true), prefs: {}, cards: [] }, null)).status).toBe(403);
    expect(host.full).toBe(null);
  });
});

describe('errors in the game window, written to the program’s log', () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  it('writes one line per error with the build, the turn and step, and the stack trace', async () => {
    const lines: string[] = [];
    const host = new GameHost(manualClock().schedule);
    server = makeServer({
      files: () => undefined,
      pages: { pageOpened() {}, pageClosed() {} },
      hello: { app: 'arena-edh', data: '' },
      api: (req, res, path) => handleErrorReport(req, res, path, (l) => lines.push(l), 'v9') || handleGameApi(host, req, res, path),
    });
    expect(await listen(server, 0)).toBe(true);
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const post = (body: unknown, origin: string | null = base) =>
      fetch(`${base}/api/game/error`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
    const report = { kind: 'render', message: 'Unknown card: Wizard', stack: 'Error: Unknown card: Wizard\n    at cardData (db.ts:59)\n    at SpellFlash (Hud.tsx:863)', turn: 7, step: 'main1' };
    const res = await post(report);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 'v9' });
    expect(lines).toEqual(['Page error (render) v9 turn 7 main1: Error: Unknown card: Wizard | at cardData (db.ts:59) | at SpellFlash (Hud.tsx:863)']);
    // Only from the program's own pages (launcher/serve.ts), and only a real report.
    expect((await post(report, 'http://evil.example')).status).toBe(403);
    expect((await post({ kind: 'error' })).status).toBe(400);
    expect(lines).toHaveLength(1);
    // The game's endpoints still answer beside it.
    expect(await (await fetch(`${base}/api/game/hello`)).json()).toEqual({ server: true });
  });

  it('keeps a report to one line, and says the message when the stack doesn’t', () => {
    expect(errorLine({ kind: 'rejection', message: 'Lobby: 500\nretry' }, 'dev')).toBe('Page error (rejection) dev: Lobby: 500 | retry');
    expect(errorLine({ kind: 'error', message: 'boom', stack: 'at f (x.ts:1)\n  at g (y.ts:2)' }, 'dev')).toBe('Page error (error) dev: boom | at f (x.ts:1) | at g (y.ts:2)');
    expect(errorLine({ kind: 'error', message: 'x', stack: 'y'.repeat(9000) }, 'dev').length).toBeLessThan(4100);
  });
});
