import { describe, expect, it } from 'vitest';
import { DECKS } from '../../src/cards/db';
import { playOut } from './play';

describe('the Kuja deck', () => {
  const kuja = DECKS.find((d) => d.id === 'kuja')!;
  const yshtola = DECKS.find((d) => d.id === 'yshtola')!;
  const ketramose = DECKS.find((d) => d.id === 'ketramose')!;
  for (const seed of [71, 72, 73]) {
    it(`seed ${seed}: bots play it to a finish`, () => {
      const { g } = playOut(seed, [kuja, yshtola, ketramose, DECKS[2]]);
      expect(g.winner).not.toBe(null);
    });
  }
  for (const seed of [74, 75]) {
    it(`seed ${seed}: two copies of it play to a finish`, () => {
      const { g } = playOut(seed, [kuja, DECKS[3], { ...kuja, id: 'kuja2' }, yshtola]);
      expect(g.winner).not.toBe(null);
    });
  }
});
