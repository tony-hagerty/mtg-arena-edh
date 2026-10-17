import { describe, expect, it } from 'vitest';
import { DECKS } from '../../src/cards/db';
import { twoCommanderDeck } from '../helpers';
import { playOut } from './play';

describe('decks with planeswalkers and battles', () => {
  const deck = twoCommanderDeck();
  deck.cards.push('Jace Beleren', 'Invasion of Dominaria');
  deck.basics = { Plains: 16, Mountain: 14, Island: 3 };
  const green = { ...DECKS[3], cards: [...DECKS[3].cards.slice(1), 'Garruk Wildspeaker'] };
  // Seeds where they come up: 36 uses Garruk until he runs out of loyalty, 38 attacks and defeats a battle.
  for (const seed of [35, 36, 38]) {
    it(`seed ${seed}: bots play them to a finish`, () => {
      const { g } = playOut(seed, [deck, DECKS[1], { ...deck, id: 'boros2' }, green]);
      expect(g.winner).not.toBe(null);
    });
  }
});
