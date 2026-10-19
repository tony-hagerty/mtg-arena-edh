import { describe, expect, it } from 'vitest';
import { DECKS } from '../../src/cards/db';
import { playOut } from './play';

describe('the Hashaton deck', () => {
  const hashaton = DECKS.find((d) => d.id === 'hashaton')!;
  const kuja = DECKS.find((d) => d.id === 'kuja')!;
  const yshtola = DECKS.find((d) => d.id === 'yshtola')!;
  const ketramose = DECKS.find((d) => d.id === 'ketramose')!;
  for (const seed of [91, 92, 93]) {
    it(`seed ${seed}: bots play it to a finish`, () => {
      const { g } = playOut(seed, [hashaton, kuja, yshtola, ketramose]);
      expect(g.winner).not.toBe(null);
    });
  }
});
