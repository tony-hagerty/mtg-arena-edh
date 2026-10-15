// The game window playing through the game server (phase 3): the store with a server
// connection shows the server's views, sends its moves, and passes the screen by seat.
import { afterEach, describe, expect, it } from 'vitest';
import './fixtures';
import { DECKS } from '../src/cards/db';
import { isHidden, permanent } from '../src/engine';
import type { PlayerId } from '../src/engine';
import type { ActRequest, StartRequest, ViewMessage } from '../src/net/protocol';
import { GameHost } from '../server/game';
import type { Connection } from '../src/ui/remote';
import { onView, useStore } from '../src/ui/store';
import { emptyGame, put } from './helpers';

/**
 * A connection straight to a GameHost in the same process, with the server's replies held
 * until `deliver` so the test can look between a move and its answer.
 */
function loopback(host: GameHost) {
  const sent: ActRequest[] = [];
  const held: (() => void)[] = [];
  const watching: { seat: PlayerId | null; on: (m: ViewMessage) => void }[] = [];
  const conn: Connection = {
    start: async (req: StartRequest) => host.start(req),
    watch(seat, on) {
      const w = { seat, on };
      watching.push(w);
      const stop = host.watch(seat, (m) => {
        gameId = m.gameId;
        held.push(() => watching.includes(w) && on(m));
      });
      return () => {
        watching.splice(watching.indexOf(w), 1);
        stop();
      };
    },
    act(req) {
      sent.push(req);
      host.act(req.seat, req.seq, req.action);
    },
    prefs: (req) => host.setPrefs(req.seat, req.prefs),
    speed: (n) => host.setSpeed(n),
    end: () => host.end(),
  };
  let gameId = 0;
  return {
    conn,
    sent,
    lastGameId: () => gameId,
    watching,
    /** Hands the window every view the server has sent so far. */
    deliver: () => held.splice(0).forEach((f) => f()),
  };
}

const S = () => useStore.getState();
const settle = () => new Promise((r) => setTimeout(r, 0));

function connect(host: GameHost) {
  const link = loopback(host);
  useStore.setState({ server: link.conn, game: null, human: null, humans: [], handoff: null });
  return link;
}

afterEach(() => useStore.setState({ server: null, game: null, human: null, humans: [], handoff: null }));

describe('a window playing through the game server', () => {
  it('starts the game on the server and shows its own seat’s view', async () => {
    const host = new GameHost(() => () => {});
    const link = connect(host);
    useStore.setState({ settings: { manualDamage: false, opponents: [null, null, null], players: ['bot', 'empty', 'empty'] } });
    S().start(DECKS[0]);
    expect(S().game).toBe(null);
    await settle();
    link.deliver();
    const g = S().game!;
    expect(g.players).toHaveLength(2);
    expect(S().human).toBe(0);
    expect(g.players[0].hand.some(isHidden)).toBe(false);
    expect(g.players[1].hand.every(isHidden)).toBe(true);
    expect(g.players.every((p) => p.library.every(isHidden))).toBe(true);
  });

  it('shows mana taps at once, and waits for the server on anything else', () => {
    const host = new GameHost(() => () => {});
    const link = connect(host);
    // A game already under way, past the mulligans, with player 0 a person.
    host.load(
      emptyGame((d) => {
        d.players[0].isBot = false;
        put(d, 0, 'Forest');
        put(d, 0, 'Llanowar Elves', 'hand');
      }),
    );
    useStore.setState({ humans: [0], human: 0 });
    link.conn.watch(0, onView);
    link.deliver();
    const forest = S().game!.players[0].battlefield[0];
    expect(S().act({ type: 'tapMana', card: forest.id })).toBe(true);
    expect(permanent(S().game!, forest.id)!.tapped).toBe(true);
    expect(link.sent.map((r) => [r.seq, r.action.type])).toEqual([[1, 'tapMana']]);
    const elves = S().game!.players[0].hand[0];
    expect(S().act({ type: 'cast', card: elves.id })).toBe(true);
    // Not shown until the server says what happened: here, it was cast and resolved.
    expect(S().game!.players[0].hand.map((c) => c.name)).toEqual(['Llanowar Elves']);
    link.deliver();
    expect(S().game!.players[0].battlefield.map((c) => c.name)).toEqual(['Forest', 'Llanowar Elves']);
  });

  it('ignores a view from before its own moves reached the server', () => {
    const host = new GameHost(() => () => {});
    const link = connect(host);
    host.load(
      emptyGame((d) => {
        d.players[0].isBot = false;
        put(d, 0, 'Forest');
      }),
    );
    useStore.setState({ humans: [0], human: 0 });
    link.conn.watch(0, onView);
    link.deliver();
    const forest = S().game!.players[0].battlefield[0];
    // A view sent before the tap arrives, as if it crossed the move on the way.
    const gameId = link.lastGameId();
    S().act({ type: 'tapMana', card: forest.id });
    onView({ gameId, version: 100, seat: 0, ack: 0, game: emptyGame() });
    expect(permanent(S().game!, forest.id)!.tapped).toBe(true);
  });

  it('checks a move without looking at other players’ hidden cards', () => {
    const host = new GameHost(() => () => {});
    const link = connect(host);
    host.load(
      emptyGame((d) => {
        d.players[0].isBot = false;
        d.players[1].isBot = false;
        put(d, 1, 'Shock', 'hand');
        put(d, 1, 'Mountain');
      }),
    );
    useStore.setState({ humans: [0, 1], human: 0 });
    link.conn.watch(0, onView);
    link.deliver();
    expect(S().game!.players[1].hand.every(isHidden)).toBe(true);
    // Passing would hand priority to player 1, whose Shock this view can't see.
    expect(S().act({ type: 'pass' })).toBe(true);
    expect(link.sent.map((r) => r.action.type)).toEqual(['pass']);
  });

  it('sends a move whose effects reach cards this view hides', () => {
    const host = new GameHost(() => () => {});
    const link = connect(host);
    host.start({ seed: 7, seats: [0, 1].map((i) => ({ deck: DECKS[i], human: true })), prefs: {}, cards: [] });
    // The other player keeps first. When the last player keeps, every opening hand is
    // looked at for actions taken from it (103.6), and this window can't see theirs.
    const first = host.full!.priority;
    host.act(first, 1, { type: 'keep' });
    const last = host.full!.priority;
    useStore.setState({ humans: [0, 1], human: last });
    link.conn.watch(last, onView);
    link.deliver();
    expect(S().act({ type: 'keep' })).toBe(true);
    expect(host.full!.mulligan).toBe(null);
  });

  it('refuses at once a move this seat’s view says is illegal', () => {
    const host = new GameHost(() => () => {});
    const link = connect(host);
    useStore.setState({ game: emptyGame(), human: 1, humans: [1] });
    expect(S().act({ type: 'pass' })).toBe(false);
    expect(link.sent).toEqual([]);
  });
});
