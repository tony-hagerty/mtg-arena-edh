// Two copies of the Hashaton deck, in their own file so Vitest plays them alongside the others: their late games are long.
import { describe, expect, it } from 'vitest';
import { DECKS } from '../../src/cards/db';
import { playOut } from './play';

describe('two Hashaton decks', () => {
  const hashaton = DECKS.find((d) => d.id === 'hashaton')!;
  const ketramose = DECKS.find((d) => d.id === 'ketramose')!;
  for (const seed of [94, 95]) {
    it(`seed ${seed}: two copies of it play to a finish`, () => {
      const { g } = playOut(seed, [hashaton, DECKS[3], { ...hashaton, id: 'hashaton2' }, ketramose]);
      expect(g.winner).not.toBe(null);
    });
  }
});
