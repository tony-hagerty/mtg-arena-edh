import { describe, expect, it } from 'vitest';
import { DECKS } from '../../src/cards/db';
import { playOut } from './play';

describe('the two-colour starter decks (session 8b)', () => {
  const [wb, br, rg, gw] = DECKS;
  for (const seed of [81, 82]) {
    it(`seed ${seed}: red-green and green-white play to a finish`, () => {
      const { g } = playOut(seed, [rg, gw, wb, br]);
      expect(g.winner).not.toBe(null);
    });
  }
});
