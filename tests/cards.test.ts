import { describe, expect, it } from 'vitest';
import { ALL_CARD_NAMES, DECKS, SHARED, cardData, deckColors, deckProblems } from '../src/cards/db';
import type { DeckDef } from '../src/cards/db';
import type { CardData } from '../src/engine';
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
  it('every deck on the menu is legal (903.5)', () => {
    for (const deck of DECKS) expect(deckProblems(deck), deck.id).toEqual([]);
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

// Commanders that aren't in the card pool, so the deck rules can be tried on partners.
const legend = (name: string, colorIdentity: CardData['colors'], oracleText: string, keywords: string[]): CardData => ({
  name,
  manaCost: '',
  cmc: 3,
  colors: colorIdentity,
  colorIdentity,
  typeLine: 'Legendary Creature — Test',
  oracleText,
  power: '3',
  toughness: '3',
  keywords,
  image: '',
  art: '',
});
const FIXTURES: Record<string, CardData> = {
  'Red-White Partner': legend('Red-White Partner', ['R', 'W'], 'Partner', ['Partner']),
  'Green Partner': legend('Green Partner', ['G'], 'Partner', ['Partner']),
  'Green Loner': legend('Green Loner', ['G'], '', []),
  'Pair A': legend('Pair A', ['R', 'W'], 'Partner with Pair B', ['Partner with']),
  'Pair B': legend('Pair B', ['G'], 'Partner with Pair A', ['Partner with']),
};
const lookup = (name: string) => FIXTURES[name] ?? cardData(name);

/** A legal 100-card Naya deck: two partners, three starter decks' cards and seven basics. */
function naya(): DeckDef {
  const [white, , red, green] = DECKS;
  return {
    id: 'naya',
    title: 'Naya',
    blurb: '',
    pilot: '',
    commanders: ['Red-White Partner', 'Green Partner'],
    basics: { Plains: 3, Mountain: 2, Forest: 2 },
    cards: [...white.cards, ...red.cards, ...green.cards, ...SHARED],
  };
}

describe('Commander deck rules (903.5)', () => {
  it('accepts 100 singleton cards inside two partners\' colour identity', () => {
    expect(deckProblems(naya(), lookup)).toEqual([]);
    expect(deckColors(naya(), lookup)).toEqual(['W', 'R', 'G']);
  });

  it('needs exactly 100 cards, commanders included (903.5a, 702.124b)', () => {
    const deck = { ...naya(), basics: { Plains: 3, Mountain: 2, Forest: 1 } };
    expect(deckProblems(deck, lookup)).toEqual(['has 99 cards, not 100']);
  });

  it('allows only one copy of each card except basic lands (903.5b)', () => {
    const deck = naya();
    deck.cards[0] = deck.cards[1];
    expect(deckProblems(deck, lookup)).toEqual([`has more than one ${deck.cards[1]}`]);
  });

  it('rejects cards outside the commanders\' colour identity (903.5c)', () => {
    const deck = naya();
    deck.cards[0] = DECKS[1].cards[0]; // a black card
    expect(deckProblems(deck, lookup)).toEqual([`${DECKS[1].cards[0]} is outside the commanders' colour identity`]);
  });

  it('allows two commanders only if they are partners (702.124)', () => {
    const loner = { ...naya(), commanders: ['Red-White Partner', 'Green Loner'] };
    expect(deckProblems(loner, lookup)).toEqual(["Red-White Partner and Green Loner aren't partners"]);
    // "Partner with" pairs only with the card it names (702.124j), never with plain partner (702.124f).
    expect(deckProblems({ ...naya(), commanders: ['Pair A', 'Pair B'] }, lookup)).toEqual([]);
    expect(deckProblems({ ...naya(), commanders: ['Pair A', 'Green Partner'] }, lookup)).toEqual(["Pair A and Green Partner aren't partners"]);
  });

  it('needs legendary creatures as commanders (903.3)', () => {
    const deck = { ...naya(), commanders: ['Red-White Partner', 'Llanowar Elves'] };
    expect(deckProblems(deck, lookup)).toContain("Llanowar Elves isn't a legendary creature");
  });
});
