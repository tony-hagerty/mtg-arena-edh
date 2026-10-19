import { describe, expect, it } from 'vitest';
import { ALL_CARD_NAMES, ALL_DECKS, DECKS, cardData, deckColors, deckProblems, isCardName } from '../src/cards/db';
import type { DeckDef } from '../src/cards/db';
import type { CardData } from '../src/engine';
import { unsupported } from '../src/cards/support';
import { MANA_ROCKS } from './helpers';

describe('card pool', () => {
  it('every deck is legal (903.5), unfinished ones too', () => {
    for (const deck of ALL_DECKS) expect(deckProblems(deck), deck.id).toEqual([]);
  });

  it('keeps the Kraum and Tymna deck off the menu, with its cards still in the pool for pasted decks', () => {
    const kraum = ALL_DECKS.find((d) => d.id === 'kraum-tymna')!;
    expect(DECKS.map((d) => d.id)).not.toContain('kraum-tymna');
    for (const name of [...kraum.commanders, ...kraum.cards]) expect(isCardName(name), name).toBe(true);
  });

  it('every card is fully implemented: supported keywords only, or a script', () => {
    const problems: string[] = [];
    for (const name of ALL_CARD_NAMES) {
      problems.push(...unsupported(name).map((p) => `${name}: ${p}`));
      const d = cardData(name);
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

/** 28 nonland cards of exactly this colour identity from the pool. */
const mono = (color: string) =>
  ALL_CARD_NAMES.filter((n) => {
    const d = cardData(n);
    return d.colorIdentity.join('') === color && !d.typeLine.includes('Land');
  }).slice(0, 28);

/** A legal 100-card Naya deck: two partners, 28 cards of each colour, seven artifacts and seven basics. */
function naya(): DeckDef {
  return {
    id: 'naya',
    title: 'Naya',
    blurb: '',
    pilot: '',
    commanders: ['Red-White Partner', 'Green Partner'],
    basics: { Plains: 3, Mountain: 2, Forest: 2 },
    cards: [...mono('W'), ...mono('R'), ...mono('G'), ...MANA_ROCKS],
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

  it('allows a planeswalker that says it can be your commander (903.3a)', () => {
    const teferi = { ...FIXTURES['Green Loner'], name: 'Teferi', typeLine: 'Legendary Planeswalker — Teferi', oracleText: 'Teferi can be your commander.' };
    const look = (name: string) => (name === 'Teferi' ? teferi : lookup(name));
    expect(deckProblems({ ...naya(), commanders: ['Teferi'], basics: { Plains: 3, Mountain: 2, Forest: 3 } }, look)).not.toContain("Teferi isn't a legendary creature");
    const plain = { ...teferi, oracleText: '' };
    expect(deckProblems({ ...naya(), commanders: ['Teferi'] }, (n) => (n === 'Teferi' ? plain : lookup(n)))).toContain("Teferi isn't a legendary creature");
  });
});
