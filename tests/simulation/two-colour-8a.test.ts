import { describe, expect, it } from 'vitest';
import { ALL_DECKS, DECKS } from '../../src/cards/db';
import { playOut } from './play';

describe('the two-colour starter decks (session 8a)', () => {
  const [wb, br] = DECKS;
  // Off the menu, but its cards are in the pool and the bots still play it.
  const kraum = ALL_DECKS.find((d) => d.id === 'kraum-tymna')!;
  for (const seed of [71, 72]) {
    it(`seed ${seed}: white-black and black-red play to a finish`, () => {
      const { g } = playOut(seed, [wb, br, kraum, DECKS[3]]);
      expect(g.winner).not.toBe(null);
    });
  }
});
