import { describe, expect, it } from 'vitest';
import { DECKS } from '../../src/cards/db';
import { twoCommanderDeck } from '../helpers';
import { playOut } from './play';

describe('a 100-card two-commander deck', () => {
  for (const seed of [7, 8, 9]) {
    it(`seed ${seed}: bots play it to a finish against the starter decks`, () => {
      const { g } = playOut(seed, [twoCommanderDeck(), DECKS[1], DECKS[3], DECKS[0]]);
      expect(g.winner).not.toBe(null);
    });
  }
});
