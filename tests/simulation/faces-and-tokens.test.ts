import { describe, expect, it } from 'vitest';
import { DECKS } from '../../src/cards/db';
import { twoCommanderDeck } from '../helpers';
import { playOut } from './play';

describe('decks with double-faced, split and adventurer cards, Sagas, Classes, flashback and tokens', () => {
  const deck = twoCommanderDeck();
  deck.cards.push('Invasion of Dominaria', 'Dead', 'Strike It Rich', 'Thraben Inspector', 'History of Benalia', 'Needleverge Pathway', 'Delver of Secrets', 'Think Twice', 'Wizard Class');
  deck.basics = { Plains: 14, Mountain: 13, Island: 4 };
  const black = { ...DECKS[1], cards: [...DECKS[1].cards.slice(2), 'Murderous Rider', 'Bake into a Pie'] };
  const green = { ...DECKS[3], cards: [...DECKS[3].cards.slice(1), 'Kazandu Mammoth'] };
  // Seeds where a lot of it comes up: 43 and 47 use flashback, Adventures and Treasure; 50 levels up Wizard Class.
  for (const seed of [43, 47, 50]) {
    it(`seed ${seed}: bots play them to a finish`, () => {
      const { g } = playOut(seed, [deck, black, { ...deck, id: 'boros2' }, green]);
      expect(g.winner).not.toBe(null);
    });
  }
});
