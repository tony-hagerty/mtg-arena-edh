// The lobby's window side (phase 4): its connection to the program on this computer, the
// screens, and a started table played through the game server as this window's own seat.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import './fixtures';
import { DECKS } from '../src/cards/db';
import { isHidden } from '../src/engine';
import type { PlayerId } from '../src/engine';
import type { LobbyConnection, LobbySeat, LobbyState } from '../src/net/lobby';
import type { StartRequest, ViewMessage } from '../src/net/protocol';
import { GameHost } from '../server/game';
import { connectLobby } from '../src/ui/lobby';
import { HostTable, WaitingRoom } from '../src/ui/LobbyScreen';
import type { Connection } from '../src/ui/remote';
import { onLobby, useStore } from '../src/ui/store';

const S = () => useStore.getState();

/** A lobby that records what the window asks of it; `say` is the lobby changing. */
function fakeLobby() {
  const calls: [string, unknown?][] = [];
  const watchers = new Set<(s: LobbyState) => void>();
  const record =
    (name: string) =>
    async (req?: unknown) =>
      void calls.push(req === undefined ? [name] : [name, req]);
  const conn: LobbyConnection = {
    watch(on) {
      watchers.add(on);
      return () => watchers.delete(on);
    },
    host: record('host'),
    join: record('join'),
    deck: record('deck'),
    ready: record('ready'),
    table: record('table'),
    start: record('start'),
    leave: record('leave'),
  };
  return { conn, calls, say: (s: LobbyState) => watchers.forEach((on) => on(s)) };
}

/** A game connection straight to a GameHost, recording which seats were watched and whether a game was started or ended. */
function loopback(host: GameHost) {
  const log: string[] = [];
  const conn: Connection = {
    start: async (req: StartRequest) => {
      log.push('start');
      host.start(req);
    },
    watch(seat: PlayerId | null, on: (m: ViewMessage) => void) {
      log.push(`watch ${seat}`);
      return host.watch(seat, on);
    },
    act: (req) => host.act(req.seat, req.seq, req.action),
    prefs: (req) => host.setPrefs(req.seat, req.prefs),
    speed: (n) => host.setSpeed(n),
    end: () => {
      log.push('end');
      host.end();
    },
  };
  return { conn, log };
}

const seat = (over: Partial<LobbySeat>): LobbySeat => ({ kind: 'person', name: '', deck: null, ready: false, you: false, host: false, ...over });

const lobbyState = (over: Partial<LobbyState> = {}): LobbyState => ({
  role: 'joined',
  code: null,
  reach: null,
  seatCount: 2,
  fillBots: true,
  seats: [
    seat({ name: 'Ann', host: true, ready: true, deck: { title: 'Elves', commanders: ['Lathril'] } }),
    seat({ name: 'Bo', you: true, deck: { title: 'Dragons', commanders: ['Miirym'] } }),
  ],
  yourSeat: 1,
  started: false,
  error: null,
  ...over,
});

/** The host's program started the table's game: two people, Ann in seat 0 and this window in seat 1. */
function startedTable() {
  const host = new GameHost(() => () => {});
  host.start({ seed: 3, seats: [0, 1].map((i) => ({ deck: DECKS[i], human: true })), prefs: {}, cards: [] });
  const game = loopback(host);
  const lobby = fakeLobby();
  useStore.setState({ server: game.conn, lobby: lobby.conn });
  return { host, game, lobby };
}

afterEach(() => {
  useStore.setState({ server: null, lobby: null, table: null, tableGame: false, game: null, human: null, humans: [], handoff: null });
  vi.unstubAllGlobals();
});

describe('a table’s game', () => {
  it('is played as this window’s own seat, alone at the screen', () => {
    const { host, game, lobby } = startedTable();
    lobby.conn.watch(onLobby);
    lobby.say(lobbyState({ started: true }));
    expect(game.log).toEqual(['watch 1']);
    expect(S().tableGame).toBe(true);
    expect(S().humans).toEqual([1]);
    expect(S().human).toBe(1);
    const g = S().game!;
    expect(g.players[1].hand.some(isHidden)).toBe(false);
    expect(g.players[0].hand.every(isHidden)).toBe(true);
    // Even when Ann must decide, nobody is asked to pass the screen to her.
    expect(host.full!.players[0].isBot).toBe(false);
    expect(S().handoff).toBe(null);
  });

  it('waits in the lobby until the game has started', () => {
    const { game, lobby } = startedTable();
    lobby.conn.watch(onLobby);
    lobby.say(lobbyState());
    expect(game.log).toEqual([]);
    expect(S().game).toBe(null);
    expect(S().table?.role).toBe('joined');
  });

  it('leaves the table when leaving the game, and the server’s game goes on', () => {
    const { host, game, lobby } = startedTable();
    lobby.conn.watch(onLobby);
    lobby.say(lobbyState({ started: true }));
    S().quit();
    expect(lobby.calls).toEqual([['leave']]);
    expect(game.log).not.toContain('end');
    expect(host.full).not.toBe(null);
    expect(S().game).toBe(null);
    expect(S().tableGame).toBe(false);
  });

  it('never starts a game of its own over the table’s', () => {
    const { game, lobby } = startedTable();
    lobby.conn.watch(onLobby);
    lobby.say(lobbyState({ started: true }));
    S().start(DECKS[0]);
    expect(game.log).toEqual(['watch 1']);
  });

  it('goes back to the menu when the table’s game is over for everyone', () => {
    const { lobby } = startedTable();
    lobby.conn.watch(onLobby);
    lobby.say(lobbyState({ started: true }));
    expect(S().game).not.toBe(null);
    lobby.say(lobbyState({ role: 'none', seats: [], yourSeat: null, error: 'The host closed the table.' }));
    expect(S().game).toBe(null);
    expect(S().tableGame).toBe(false);
    expect(S().table?.error).toBe('The host closed the table.');
  });
});

describe('the lobby screens', () => {
  const render = <P extends object>(el: (props: P) => ReturnType<typeof HostTable>, props: P) => renderToStaticMarkup(createElement(el, props));

  it('open a table of 4 with empty seats filled by bots, unless the host says otherwise', () => {
    const html = render(HostTable, { close: () => {} });
    expect(html).toMatch(/<button role="radio" aria-checked="true" class="chip on">4<\/button>/);
    expect(html).toMatch(/<input type="checkbox" checked=""\/>Fill empty seats with bots/);
    // No name yet (nothing remembered), so Host waits for one.
    expect(html).toMatch(/<button class="btn btn-go small" disabled="">/);
  });

  it('show the host the code, whether friends can reach them, and Start once everyone is ready', () => {
    useStore.setState({ lobby: fakeLobby().conn });
    const reach = { kind: 'cgnat' as const, message: 'Only friends on your own network can join.' };
    const hosting = lobbyState({
      role: 'hosting',
      code: 'ABCD-1234',
      reach,
      yourSeat: 0,
      seats: [seat({ name: 'Ann', you: true, host: true, ready: true, deck: { title: 'Elves', commanders: ['Lathril'] } }), seat({ name: 'Bo' })],
    });
    let html = render(WaitingRoom, { table: hosting });
    expect(html).toContain('value="ABCD-1234"');
    expect(html).toContain('Copy');
    expect(html).toContain(reach.message);
    expect(html).toContain('Waiting for Bo to be ready.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*><span class="btn-label">Start<\/span>/);
    expect(html).toContain('Fill empty seats with bots');
    html = render(WaitingRoom, { table: { ...hosting, seats: hosting.seats.map((s) => ({ ...s, ready: true })) } });
    expect(html).toMatch(/<button class="btn btn-go small"><span class="btn-label">Start<\/span>/);
  });

  it('show a friend who joined the seats and Ready, but not the host’s settings', () => {
    useStore.setState({ lobby: fakeLobby().conn });
    const html = render(WaitingRoom, { table: lobbyState({ error: 'The host left the table.' }) });
    expect(html).toContain('Ann');
    expect(html).toContain('Dragons (Miirym)');
    expect(html).toContain('>Ready<');
    expect(html).toContain('The host left the table.');
    expect(html).not.toContain('Start');
    expect(html).not.toContain('Fill empty seats');
    expect(html).not.toContain('Copy');
  });
});

describe('connectLobby', () => {
  const answer = (status: number, type: string, body = '') => new Response(body, { status, headers: { 'Content-Type': type } });

  it('finds no lobby when the page came from disk, or from a server without one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await connectLobby()).toBe(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(200, 'text/html', '<!doctype html>')));
    expect(await connectLobby()).toBe(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(404, 'text/plain')));
    expect(await connectLobby()).toBe(null);
  });

  it('passes on a refusal in the server’s own words', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(answer(200, 'text/event-stream'));
    vi.stubGlobal('fetch', fetch);
    const lobby = (await connectLobby())!;
    expect(lobby).not.toBe(null);
    fetch.mockResolvedValueOnce(answer(409, 'application/json', JSON.stringify({ error: 'Bo isn’t ready yet.' })));
    await expect(lobby.start()).rejects.toThrow('Bo isn’t ready yet.');
    expect(fetch.mock.calls[1][0]).toBe('/api/lobby/start');
    fetch.mockResolvedValueOnce(answer(500, 'text/plain', 'oops'));
    await expect(lobby.ready({ ready: true })).rejects.toThrow('error 500');
    fetch.mockResolvedValueOnce(answer(200, 'text/plain'));
    await expect(lobby.join({ code: 'X', name: 'Bo', deck: null })).resolves.toBeUndefined();
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ code: 'X', name: 'Bo', deck: null });
  });
});
