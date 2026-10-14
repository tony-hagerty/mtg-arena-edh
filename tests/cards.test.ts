import { describe, expect, it } from 'vitest';
import { ALL_CARD_NAMES, DECKS, cardData, deckLibrary } from '../src/cards/db';
import { SUPPORTED_KEYWORDS, hasScript } from '../src/engine';

// Ability words: they label a rule that the card's script implements.
const ABILITY_WORDS = ['landfall'];

/** Oracle text split into abilities, with reminder text removed. */
const abilities = (text: string) =>
  text
    .replace(/\([^)]*\)/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

const isKeywordLine = (line: string) =>
  line
    .toLowerCase()
    .split(',')
    .every((part) => SUPPORTED_KEYWORDS.includes(part.trim()));

describe('card pool', () => {
  it('every deck is a 60-card singleton list around a legendary commander', () => {
    for (const deck of DECKS) {
      const library = deckLibrary(deck);
      expect(library.length + 1, deck.id).toBe(60);
      const nonBasic = library.filter((n) => n !== deck.basic);
      expect(new Set(nonBasic).size, `${deck.id} has duplicates`).toBe(nonBasic.length);
      expect(cardData(deck.commander).typeLine).toContain('Legendary Creature');
      for (const name of library) {
        const identity = cardData(name).colorIdentity;
        expect(identity.every((c) => c === deck.color), `${name} is outside ${deck.id}'s colour identity`).toBe(true);
      }
    }
  });

  it('every card is fully implemented: supported keywords only, or a script', () => {
    const problems: string[] = [];
    for (const name of ALL_CARD_NAMES) {
      const d = cardData(name);
      if (d.typeLine.startsWith('Basic Land')) continue;
      for (const k of d.keywords.map((x) => x.toLowerCase())) {
        if (!SUPPORTED_KEYWORDS.includes(k) && !ABILITY_WORDS.includes(k)) problems.push(`${name}: unsupported keyword "${k}"`);
      }
      const needsScript = abilities(d.oracleText).some((line) => !isKeywordLine(line));
      if (needsScript && !hasScript(name)) problems.push(`${name}: has rules text but no script`);
      if (!d.image || !d.art) problems.push(`${name}: missing image`);
    }
    expect(problems).toEqual([]);
  });
});
