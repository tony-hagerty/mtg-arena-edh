import { describe, expect, it } from 'vitest';
import { DECKS } from '../../src/cards/db';
import { twoCommanderDeck } from '../helpers';
import { playOut } from './play';

describe('decks with counterspells, modal spells and copies', () => {
  // Cards from tests/fixtures.ts, with Islands to cast the blue ones.
  const deck = twoCommanderDeck();
  deck.cards.push('Counterspell', 'Negate', 'Essence Scatter', 'Stifle', 'Cryptic Command', 'Boros Charm', 'Fiery Confluence', 'Reverberate');
  deck.basics = { Plains: 12, Mountain: 12, Island: 3 };
  for (const seed of [12, 13, 14]) {
    it(`seed ${seed}: bots play them to a finish`, () => {
      const { g } = playOut(seed, [deck, DECKS[1], { ...deck, id: 'boros2' }, DECKS[3]]);
      expect(g.winner).not.toBe(null);
    });
  }
});
