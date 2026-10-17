import { describe, expect, it } from 'vitest';
import { DECKS } from '../../src/cards/db';
import { playOut } from './play';

describe('the Kraum and Tymna deck', () => {
  const kraum = DECKS.find((d) => d.id === 'kraum-tymna')!;
  for (const seed of [61, 62, 63]) {
    it(`seed ${seed}: bots play it to a finish against the starter decks`, () => {
      const { g } = playOut(seed, [kraum, DECKS[1], DECKS[0], DECKS[2]]);
      expect(g.winner).not.toBe(null);
    });
  }
  for (const seed of [64, 65]) {
    it(`seed ${seed}: two copies of it play to a finish`, () => {
      const { g } = playOut(seed, [kraum, DECKS[3], { ...kraum, id: 'kraum2' }, DECKS[1]]);
      expect(g.winner).not.toBe(null);
    });
  }
});
