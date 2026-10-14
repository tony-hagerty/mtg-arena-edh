import type { CardData, Color } from '../engine/types';
import generated from './cards.generated.json';
import lists from './decklists.json';

export interface DeckDef {
  id: string;
  title: string;
  blurb: string;
  pilot: string; // name of the bot that plays this deck
  color: Color;
  commander: string;
  basic: string;
  basics: number;
  cards: string[];
}

export const DECKS = lists.decks as DeckDef[];
export const SHARED: string[] = lists.shared;

const cards = generated.cards as Record<string, CardData>;
const tokenImages = generated.tokens as Record<string, { art: string; image: string }>;

// Tokens are keyed by e.g. "Beast 3/3" so two different Beast tokens can coexist.
const tokens: Record<string, CardData> = {};
for (const [key, t] of Object.entries(lists.tokens)) {
  tokens[key] = {
    name: t.name,
    manaCost: '',
    cmc: 0,
    colors: t.colors as Color[],
    colorIdentity: t.colors as Color[],
    typeLine: t.typeLine,
    oracleText: '',
    power: t.power,
    toughness: t.toughness,
    keywords: t.keywords,
    image: tokenImages[key]?.image ?? '',
    art: tokenImages[key]?.art ?? '',
  };
}

export function cardData(name: string): CardData {
  const d = cards[name] ?? tokens[name];
  if (!d) throw new Error(`Unknown card: ${name}`);
  return d;
}

export const ALL_CARD_NAMES = Object.keys(cards);

/** Every card name in a deck's library (commander excluded). */
export function deckLibrary(deck: DeckDef): string[] {
  return [...Array<string>(deck.basics).fill(deck.basic), ...deck.cards, ...SHARED];
}
