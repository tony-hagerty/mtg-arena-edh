// Made-up cards whose rules text the Oracle text parser can't read, added the way a card
// fetched from Scryfall for a pasted deck is (`addCards`), legal in Commander. Tests of
// playing a card without its rules text use them. Importing this file adds them.
import { addCards } from '../src/cards/fetched';
import type { CardData } from '../src/engine';

const card = (name: string, extra: Partial<CardData>): CardData => ({
  name,
  manaCost: '{1}{B}',
  cmc: 2,
  colors: ['B'],
  colorIdentity: ['B'],
  typeLine: 'Creature — Horror',
  oracleText: '',
  power: '2',
  toughness: '2',
  keywords: [],
  image: '',
  art: '',
  ...extra,
});

/** Wording no template reads: refused, with the clause. */
const ODD = 'becomes the target of a spell an opponent controls, that spell’s controller reveals their hand and you choose a nonland card from it. That player may cast it this turn.';

export const REFUSED_CARDS = {
  /** A 2/2 with menace (a keyword the engine knows) and a line the parser can't read. */
  hound: card('Testing Gloom Hound', { keywords: ['Menace'], oracleText: `Menace\nWhenever Testing Gloom Hound ${ODD}` }),
  /** Another card that stumbles on the same wording, for grouping. */
  wisp: card('Testing Gloom Wisp', { manaCost: '{B}', cmc: 1, power: '1', toughness: '1', oracleText: `Whenever Testing Gloom Wisp ${ODD}` }),
  /** A legendary creature the parser can't read: as a commander it can't go without its text. */
  lord: card('Testing Gloom Lord', { typeLine: 'Legendary Creature — Horror Noble', manaCost: '{3}{B}', cmc: 4, power: '4', toughness: '4', oracleText: `Whenever Testing Gloom Lord ${ODD}` }),
  /** A keyword the engine doesn't know, which changes how the card is played: it can't go without its text either. */
  ninja: card('Testing Gloom Ninja', { typeLine: 'Creature — Human Ninja', keywords: ['Ninjutsu'], oracleText: `Ninjutsu {1}{B}\nWhenever Testing Gloom Ninja ${ODD}` }),
};

addCards(
  Object.values(REFUSED_CARDS),
  Object.fromEntries(Object.values(REFUSED_CARDS).map((c) => [c.name, 'legal' as const])),
);
