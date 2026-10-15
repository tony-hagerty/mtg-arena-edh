// Cards a pasted deck names that the pool doesn't have: fetched from Scryfall by the
// browser, added to the game's cards, scripted by the Oracle text parser, and cached.
// A card the parser refuses stays known (so the paste screen can say why) but can't be
// played: `unsupported` names the clause, and the deck can't be saved until it is replaced.
// A card Scryfall says isn't legal in Commander (`commanderLegality`) is refused the same way.
import type { CardData } from '../engine/types';
import { clearCached, loadCached, saveCached } from './cache';
import { cardData, isCardName, registerCards } from './db';
import { refusalOf, scriptCards } from './oracle';
import type { CardRequest } from './requests';
import { fetchCollection } from './scryfall';
import type { FetchResult, Legality } from './scryfall';
import { unsupported } from './support';

/** Names (and first-face names) of cards that came from Scryfall rather than the pool. */
const FETCHED = new Set<string>();

/** Did this card come from Scryfall, not the built-in pool? */
export const isFetched = (name: string) => FETCHED.has(name);

/** Each fetched card's Commander legality, by its full name. */
const LEGALITY = new Map<string, Legality>();

/**
 * Whether card `name` may be in a Commander deck: Scryfall's word for a fetched card, or
 * null if it isn't known (a card cached before legality was kept, until it is fetched
 * again). Pool cards are all legal: `npm run fetch-cards` refuses any that isn't.
 */
export function commanderLegality(name: string): Legality | null {
  if (!isFetched(name)) return 'legal';
  return LEGALITY.get(cardData(name).name) ?? null;
}

/** A card as the cache keeps it: its data plus its Commander legality. */
type CachedCard = CardData & { legality?: Legality };

/** How many fetched cards the game has. */
export const fetchedCount = () => new Set([...FETCHED].map((n) => cardData(n).name)).size;

/**
 * Adds fetched cards to the game and scripts them, with their Commander legality by name.
 * A card the pool already has is skipped: the pool's data, and its hand script, always win.
 */
export function addCards(list: CardData[], legality: Record<string, Legality> = {}) {
  const fresh = list.filter((c) => !isCardName(c.name) || FETCHED.has(c.name));
  if (!fresh.length) return;
  for (const c of fresh) {
    if (legality[c.name]) LEGALITY.set(c.name, legality[c.name]);
    else LEGALITY.delete(c.name);
  }
  registerCards(Object.fromEntries(fresh.map((c) => [c.name, c])));
  for (const c of fresh) {
    FETCHED.add(c.name);
    if (c.faces) FETCHED.add(c.faces[0].name);
  }
  scriptCards(fresh.map((c) => c.name));
}

/**
 * Fetches these names from Scryfall, adds the cards it has and caches them. `fetch` and
 * `pause` are for tests.
 */
export async function fetchCards(names: string[], opts: { fetch?: typeof fetch; pause?: number } = {}): Promise<FetchResult> {
  const res = await fetchCollection(names, opts);
  if (res.cards.length) {
    addCards(res.cards, res.legality);
    await saveCached(res.cards.map((c): CachedCard => ({ ...c, legality: res.legality[c.name] })));
  }
  return res;
}

/**
 * Adds the cards cached by earlier visits, then fetches again the ones cached without their
 * Commander legality, so it can be checked. Returns how many cards there were. `load`,
 * `fetch` and `pause` are for tests.
 */
export async function loadFetchedCards(opts: { load?: () => Promise<CardData[]>; fetch?: typeof fetch; pause?: number } = {}): Promise<number> {
  const cards = (await (opts.load ?? loadCached)()) as CachedCard[];
  const legality: Record<string, Legality> = {};
  for (const c of cards) if (c.legality) legality[c.name] = c.legality;
  addCards(
    cards.map(({ legality: _, ...c }) => c),
    legality,
  );
  const unknown = cards.filter((c) => !c.legality).map((c) => c.name);
  // Offline, these stay unknown and their decks wait; the next visit tries again.
  if (unknown.length) await fetchCards(unknown, opts);
  return cards.length;
}

/** Empties the cache. Cards already added stay until the page reloads. */
export const clearFetchedCards = clearCached;

/**
 * A fetched card the game can't play, as an entry for docs/card-requests.json: the clause
 * the parser couldn't read, or failing that what else stops it (a keyword the engine
 * doesn't know, a card with faces). Null for a card that can be played, or a pool card.
 */
export function requestFor(name: string, now = new Date()): CardRequest | null {
  // A card the deck can't have anyway isn't worth scripting.
  if (!isFetched(name) || commanderLegality(name) !== 'legal') return null;
  const problems = unsupported(name);
  if (!problems.length) return null;
  const d = cardData(name);
  const refused = refusalOf(d.name);
  return {
    name: d.name,
    oracleText: d.oracleText,
    clause: refused?.clause ?? problems.join('; '),
    reason: refused?.reason ?? 'not supported',
    count: 1,
    last: now.toISOString(),
  };
}
