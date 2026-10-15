// Cards a pasted deck names that the pool doesn't have: fetched from Scryfall by the
// browser, added to the game's cards, scripted by the Oracle text parser, and cached.
// A card the parser refuses stays known (so the paste screen can say why) but can't be
// played: `unsupported` names the clause, and the deck can't be saved until it is replaced.
import type { CardData } from '../engine/types';
import { clearCached, loadCached, saveCached } from './cache';
import { cardData, isCardName, registerCards } from './db';
import { refusalOf, scriptCards } from './oracle';
import type { CardRequest } from './requests';
import { fetchCollection } from './scryfall';
import type { FetchResult } from './scryfall';
import { unsupported } from './support';

/** Names (and first-face names) of cards that came from Scryfall rather than the pool. */
const FETCHED = new Set<string>();

/** Did this card come from Scryfall, not the built-in pool? */
export const isFetched = (name: string) => FETCHED.has(name);

/** How many fetched cards the game has. */
export const fetchedCount = () => new Set([...FETCHED].map((n) => cardData(n).name)).size;

/**
 * Adds fetched cards to the game and scripts them. A card the pool already has is skipped:
 * the pool's data, and its hand script, always win.
 */
export function addCards(list: CardData[]) {
  const fresh = list.filter((c) => !isCardName(c.name) || FETCHED.has(c.name));
  if (!fresh.length) return;
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
    addCards(res.cards);
    await saveCached(res.cards);
  }
  return res;
}

/** Adds the cards cached by earlier visits. Returns how many there were. */
export async function loadFetchedCards(): Promise<number> {
  const cards = await loadCached();
  addCards(cards);
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
  if (!isFetched(name)) return null;
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
