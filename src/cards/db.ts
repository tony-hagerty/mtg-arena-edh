import type { CardData, Color } from '../engine/types';
import generated from './cards.generated.json';
import lists from './decklists.json';
import creatureTypes from './creature-types.json';

export interface DeckDef {
  id: string;
  title: string;
  blurb: string;
  pilot: string; // name of the bot that plays this deck
  /** One commander, or two that both have partner (702.124). */
  commanders: string[];
  /** Basic lands by name, e.g. { "Forest": 18, "Island": 17 }. */
  basics: Record<string, number>;
  /** Every other card, once each (903.5b). */
  cards: string[];
  /** Still being built: kept off the menu, and its cards may not all have scripts yet. */
  wip?: boolean;
}

/** Every deck in decklists.json, unfinished ones included. */
export const ALL_DECKS = lists.decks as unknown as DeckDef[];
/** The decks on the menu. */
export const DECKS = ALL_DECKS.filter((d) => !d.wip);

const cards = generated.cards as Record<string, CardData>;
const tokenImages = generated.tokens as Record<string, { art: string; image: string }>;

/** A token's definition in decklists.json. `query` finds its art on Scryfall. */
interface TokenDef {
  name: string;
  power?: string;
  toughness?: string;
  colors: string[];
  typeLine: string;
  oracleText?: string;
  keywords: string[];
  query: string;
}

// Tokens are keyed by e.g. "Beast 3/3" so two different Beast tokens can coexist.
const tokens: Record<string, CardData> = {};
for (const [key, t] of Object.entries(lists.tokens as Record<string, TokenDef>)) {
  tokens[key] = {
    name: t.name,
    manaCost: '',
    cmc: 0,
    colors: t.colors as Color[],
    colorIdentity: t.colors as Color[],
    typeLine: t.typeLine,
    oracleText: t.oracleText ?? '',
    power: t.power,
    toughness: t.toughness,
    keywords: t.keywords,
    image: tokenImages[key]?.image ?? '',
    art: tokenImages[key]?.art ?? '',
  };
}

/**
 * Face names that aren't keys. A deck may list a double-faced, split or adventurer card by
 * its first face's name ("Delver of Secrets"), which finds the whole card. Any other face's
 * name finds that face, so a log line or tile naming it can show it.
 */
const faceNames = new Map<string, CardData>();
function indexFaces(all: Record<string, CardData>) {
  for (const d of Object.values(all)) {
    d.faces?.forEach((f, i) => faceNames.set(f.name, i === 0 ? d : f));
  }
}
indexFaces(cards);

/**
 * A token whose power and toughness are set as it is made, like "an X/X blue Illusion": the
 * key "Illusion 3/3" is the "Illusion X/X" token with X = 3. Made once per size and kept.
 */
const sizedTokens = new Map<string, CardData>();
function sizedToken(name: string): CardData | undefined {
  const m = /^(.*) (\d+)\/(\d+)$/.exec(name);
  const base = m ? tokens[`${m[1]} X/X`] : undefined;
  if (!m || !base) return undefined;
  if (!sizedTokens.has(name)) sizedTokens.set(name, { ...base, power: m[2], toughness: m[3] });
  return sizedTokens.get(name);
}

export function cardData(name: string): CardData {
  const d = cards[name] ?? tokens[name] ?? faceNames.get(name) ?? sizedToken(name);
  if (!d) throw new Error(`Unknown card: ${name}`);
  return d;
}

export const ALL_CARD_NAMES = Object.keys(cards);

/** Is this the name of a card (not a token)? Any face's name counts. */
export const isCardName = (name: string) => name in cards || faceNames.has(name);

/** Every creature type (205.3m), from the rules by `npm run fetch-rules`. */
export const CREATURE_TYPES: string[] = creatureTypes;

/** Every card name the game knows, faces included, for naming a card (201.3). */
export const cardNames = () => [...new Set([...Object.keys(cards), ...faceNames.keys()])].sort();

/** Goes up each time cards are added, so whatever indexes card names knows to look again. */
let version = 0;
export const cardsVersion = () => version;

/** Every card the game knows by its key: the pool's, plus any added with `registerCards`. */
export const knownCardNames = () => Object.keys(cards);

/**
 * Adds cards that aren't in cards.generated.json: cards fetched from Scryfall for a pasted
 * deck (`fetched.ts`), and cards tests use to try out rules. `ALL_CARD_NAMES` doesn't list them.
 */
export function registerCards(extra: Record<string, CardData>) {
  Object.assign(cards, extra);
  indexFaces(extra);
  version++;
}

const WUBRG: Color[] = ['W', 'U', 'B', 'R', 'G'];

/**
 * A deck's colours: its commanders' combined colour identity (903.4, 702.124c), in WUBRG
 * order. Empty for a colourless commander.
 */
export function deckColors(deck: DeckDef, lookup = cardData): Color[] {
  const all = new Set(deck.commanders.flatMap((n) => lookup(n).colorIdentity));
  return WUBRG.filter((c) => all.has(c));
}

/** Every card name in a deck's library (commanders excluded). */
export function deckLibrary(deck: DeckDef): string[] {
  const basics = Object.entries(deck.basics).flatMap(([name, n]) => Array<string>(n).fill(name));
  return [...basics, ...deck.cards];
}

/**
 * Can this card be a commander? A legendary creature (Vehicles and Spacecraft aren't
 * supported yet), or a card that says it can be your commander, like some planeswalkers
 * (903.3, 903.3a).
 */
export const canBeCommander = (c: CardData) => c.typeLine.includes('Legendary Creature') || c.oracleText.includes('can be your commander');

/** Can these two cards be commanders together? Plain partner (702.124h) or partner with (702.124j). */
function partners(a: CardData, b: CardData): boolean {
  const partnerWith = (x: CardData, y: CardData) => x.oracleText.includes(`Partner with ${y.name}`);
  if (partnerWith(a, b) || partnerWith(b, a)) return partnerWith(a, b) && partnerWith(b, a);
  // "Partner with" is a different partner ability, so it can't pair with plain partner (702.124f).
  const plain = (x: CardData) => x.keywords.includes('Partner') && !x.oracleText.includes('Partner with');
  return plain(a) && plain(b);
}

/**
 * Why a deck isn't a legal Commander deck, or an empty list if it is (903.3, 903.5).
 * `lookup` finds a card's data; tests pass their own to try out cards outside the pool.
 */
export function deckProblems(deck: DeckDef, lookup = cardData): string[] {
  const out: string[] = [];
  const commanders = deck.commanders.map(lookup);
  if (commanders.length < 1 || commanders.length > 2) out.push(`has ${commanders.length} commanders`);
  for (const c of commanders) if (!canBeCommander(c)) out.push(`${c.name} isn't a legendary creature`);
  if (commanders.length === 2 && !partners(commanders[0], commanders[1])) {
    out.push(`${commanders[0].name} and ${commanders[1].name} aren't partners`);
  }
  // 903.5a, 702.124b: 100 cards, commanders included.
  const library = deckLibrary(deck);
  const size = library.length + commanders.length;
  if (size !== 100) out.push(`has ${size} cards, not 100`);
  // 903.5b: one of each card except basic lands.
  const seen = new Set<string>();
  for (const name of [...deck.commanders, ...library]) {
    if (lookup(name).typeLine.startsWith('Basic Land')) continue;
    if (seen.has(name)) out.push(`has more than one ${name}`);
    seen.add(name);
  }
  for (const name of Object.keys(deck.basics)) {
    if (!lookup(name).typeLine.startsWith('Basic Land')) out.push(`${name} is listed as a basic land but isn't one`);
  }
  // 903.5c: every card's colour identity is inside the commanders'.
  const colors = deckColors(deck, lookup);
  for (const name of new Set(library)) {
    if (!lookup(name).colorIdentity.every((c) => colors.includes(c))) out.push(`${name} is outside the commanders' colour identity`);
  }
  return out;
}
