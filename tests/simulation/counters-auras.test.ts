import { describe, expect, it } from 'vitest';
import { DECKS } from '../../src/cards/db';
import { twoCommanderDeck } from '../helpers';
import { playOut } from './play';

describe('decks with counters, Auras, Equipment and Vehicles', () => {
  const deck = twoCommanderDeck();
  deck.cards.push('Pacifism', 'Holy Strength', 'Bonesplitter', 'Loxodon Warhammer', 'Untethered Express');
  deck.basics = { Plains: 16, Mountain: 14 };
  const black = { ...DECKS[1], cards: [...DECKS[1].cards.slice(1), "Black Sun's Zenith"] };
  for (const seed of [21, 22, 23]) {
    it(`seed ${seed}: bots play them to a finish`, () => {
      const { g } = playOut(seed, [deck, black, { ...deck, id: 'boros2' }, DECKS[3]]);
      expect(g.winner).not.toBe(null);
    });
  }
});
