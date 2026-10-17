import { describe, expect, it } from 'vitest';
import { DECKS } from '../../src/cards/db';
import { twoCommanderDeck } from '../helpers';
import { playOut } from './play';

describe('decks with X, hybrid, Phyrexian, kicker, sacrifice and alternative costs', () => {
  // Cards from tests/fixtures.ts, swapped in for basic lands and one black card.
  const boros = twoCommanderDeck();
  boros.cards.push('Blaze', 'Boros Recruit', 'Gut Shot', 'Burst Lightning', 'Flawless Maneuver', 'Thalia, Guardian of Thraben', 'Ruby Medallion');
  boros.basics = { Plains: 14, Mountain: 14 };
  const black = { ...DECKS[1], cards: [...DECKS[1].cards.slice(1), 'Bone Splinters'] };
  for (const seed of [4, 5, 6]) {
    it(`seed ${seed}: bots play them to a finish`, () => {
      const { g } = playOut(seed, [boros, black, DECKS[3], DECKS[0]]);
      expect(g.winner).not.toBe(null);
    });
  }
});
