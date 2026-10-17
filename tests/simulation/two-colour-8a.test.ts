import { describe, expect, it } from 'vitest';
import { DECKS } from '../../src/cards/db';
import { playOut } from './play';

describe('the two-colour starter decks (session 8a)', () => {
  const [wb, br] = DECKS;
  const kraum = DECKS.find((d) => d.id === 'kraum-tymna')!;
  for (const seed of [71, 72]) {
    it(`seed ${seed}: white-black and black-red play to a finish`, () => {
      const { g } = playOut(seed, [wb, br, kraum, DECKS[3]]);
      expect(g.winner).not.toBe(null);
    });
  }
});
