import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import './fixtures';
import type { Game } from '../src/engine';
import { gameSound } from '../src/ui/game-sounds';
import { emptyGame, put } from './helpers';

const change = (g: Game, edit: (d: Game) => void) => produce(g, edit);

describe('game sounds', () => {
  const g = emptyGame();

  it('shuffles for a new game, and is quiet when nothing changed', () => {
    expect(gameSound(null, g, 0)).toBe('shuffle');
    expect(gameSound(g, g, 0)).toBe(null);
  });

  it('hears your turn start, but not someone else’s', () => {
    const theirs = change(g, (d) => void ((d.active = 1), (d.turn = 2)));
    expect(gameSound(g, theirs, 0)).toBe(null);
    expect(gameSound(theirs, change(theirs, (d) => void ((d.active = 0), (d.turn = 3))), 0)).toBe('turn');
  });

  it('hears life lost over a spell resolving', () => {
    // Only the stack's size matters here.
    const cast = change(g, (d) => void d.stack.push({} as Game['stack'][number]));
    expect(gameSound(g, cast, 0)).toBe('cast');
    const resolved = change(cast, (d) => void ((d.stack = []), (d.players[1].life -= 3)));
    expect(gameSound(cast, resolved, 0)).toBe('damage');
    expect(gameSound(cast, change(cast, (d) => void (d.stack = [])), 0)).toBe('resolve');
  });

  it('hears a permanent arrive and your own draws', () => {
    expect(gameSound(g, change(g, (d) => void put(d, 2, 'Forest')), 0)).toBe('enter');
    const drew = change(g, (d) => void d.players[0].hand.push(d.players[0].library.shift()!));
    expect(gameSound(g, drew, 0)).toBe('draw');
    expect(gameSound(g, drew, 1)).toBe(null);
  });

  it('tells winning from losing', () => {
    const over = change(g, (d) => void (d.winner = 1));
    expect(gameSound(g, over, 1)).toBe('win');
    expect(gameSound(g, over, 0)).toBe('lose');
  });
});
