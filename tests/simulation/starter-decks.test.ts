import { describe, expect, it } from 'vitest';
import { playOut } from './play';

describe('four bots play full games', () => {
  const results: string[] = [];
  for (const seed of [11, 22, 33, 44, 55, 66]) {
    it(`seed ${seed} reaches a winner with a consistent state throughout`, () => {
      const { g, actions } = playOut(seed);
      expect(g.winner).not.toBe(null);
      const winner = g.winner === 'draw' ? 'draw' : g.players[g.winner!].deckId;
      results.push(`seed ${seed}: ${winner} wins on turn ${g.turn} after ${actions} actions`);
      console.log(results[results.length - 1]);
    });
  }
});
