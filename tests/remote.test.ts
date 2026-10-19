// The game window playing through the game server (phase 3): the store with a server
// connection shows the server's views, sends its moves, and passes the screen by seat.
import { afterEach, describe, expect, it } from 'vitest';
import './fixtures';
import { DECKS } from '../src/cards/db';
import { isHidden, permanent } from '../src/engine';
import type { Game, PlayerId } from '../src/engine';
import type { ActRequest, StartRequest, ViewMessage } from '../src/net/protocol';
import { GameHost } from '../server/game';
import type { Connection } from '../src/ui/remote';
import { onView, useStore } from '../src/ui/store';
import { buildView, clickPermanent, clickPlayer, playHandCard } from '../src/ui/view';
import { byName, emptyGame, put } from './helpers';

/**
 * A connection straight to a GameHost in the same process, with the server's replies held
 * until `deliver` so the test can look between a move and its answer.
 */
function loopback(host: GameHost, { reversed = false } = {}) {
  const sent: ActRequest[] = [];
  /** With `reversed`, moves wait for `deliver` and reach the server last first, as two POSTs on separate connections may. */
  const moves: ActRequest[] = [];
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
      if (reversed) moves.unshift(req);
      else host.act(req.seat, req.seq, req.action);
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
    /** Hands the server the moves still on their way, then the window every view the server has sent so far. */
    deliver: () => {
      for (const m of moves.splice(0)) host.act(m.seat, m.seq, m.action);
      held.splice(0).forEach((f) => f());
    },
  };
}

const S = () => useStore.getState();
const settle = () => new Promise((r) => setTimeout(r, 0));

function connect(host: GameHost, opts?: { reversed?: boolean }) {
  const link = loopback(host, opts);
  useStore.setState({ server: link.conn, game: null, human: null, humans: [], handoff: null });
  return link;
}

afterEach(() => useStore.setState({ server: null, game: null, human: null, humans: [], handoff: null }));

describe('a window playing through the game server', () => {
  it('starts the game on the server and shows its own seat’s view', async () => {
    const host = new GameHost(() => () => {});
    const link = connect(host);
    useStore.setState({ settings: { manualDamage: false, opponents: [null, null, null], players: ['bot', 'empty', 'empty'], volume: 0.5, muted: false, music: 0.4, musicMuted: false } });
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

  describe('a move the screen can only show once the server answers', () => {
    /** Player 0 is the person at this window, in main 1 of their turn. */
    function table(setup: (d: Game) => void, opts?: { reversed?: boolean }) {
      const host = new GameHost(() => () => {});
      const link = connect(host, opts);
      host.load(
        emptyGame((d) => {
          d.players[0].isBot = false;
          setup(d);
        }),
      );
      useStore.setState({ humans: [0], human: 0 });
      link.conn.watch(0, onView);
      link.deliver();
      return { host, link };
    }
    const press = () => buildView().primary!.onClick();

    it('takes no second move until the server answers: a second click on Pay is not a pass (117.3b)', () => {
      const { host, link } = table((d) => {
        put(d, 0, 'Mountain');
        put(d, 0, 'Shock', 'hand');
      });
      playHandCard(byName(S().game!, 0, 'Shock', 'hand')!);
      clickPlayer(1);
      press(); // Pay
      // The screen still shows main 1 from before the cast, where the big button is Next.
      expect(buildView().primary?.label).toBe('Next');
      press();
      expect(link.sent.map((r) => r.action.type)).toEqual(['cast']);
      link.deliver();
      const g = host.full!;
      // Shock resolved and the human has priority in main 1 again.
      expect([g.players[1].life, g.step, g.priority]).toEqual([38, 'main1', 0]);
      // Answered: the window moves again.
      press();
      expect(link.sent.map((r) => r.action.type)).toEqual(['cast', 'pass']);
    });

    it('a fetch land: after the search the human still has priority in main 1, even if the moves cross on the way (117.3b)', () => {
      const { host, link } = table(
        (d) => {
          put(d, 0, 'Polluted Delta');
          d.players[0].library = [];
          put(d, 0, 'Island', 'library');
          put(d, 0, 'Plains', 'library');
        },
        { reversed: true },
      );
      clickPermanent(byName(S().game!, 0, 'Polluted Delta')!);
      press(); // Pay 1 life
      press(); // a double click, or Space pressed twice
      link.deliver();
      expect(host.full!.decision?.type).toBe('chooseCards');
      S().act({ type: 'chooseCards', cards: [host.full!.players[0].library.find((c) => c.name === 'Island')!.id] });
      link.deliver();
      const g = host.full!;
      expect([g.turn, g.step, g.priority, g.decision]).toEqual([1, 'main1', 0, null]);
      expect(byName(g, 0, 'Island')).toBeDefined();
      expect(S().game!.step).toBe('main1');
    });
  });
});
