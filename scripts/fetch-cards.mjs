// Fetches card data for every card named in src/cards/decklists.json from Scryfall
// and writes src/cards/cards.generated.json. Also fetches the test-only cards listed in
// tests/fixture-cards.json into tests/fixtures.generated.json. Run: npm run fetch-cards
// (behind an HTTPS proxy: NODE_USE_ENV_PROXY=1 npm run fetch-cards).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// The same Scryfall field mapping the deck-paste screen uses (Node strips its types).
import { fetchCollection } from '../src/cards/scryfall.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lists = JSON.parse(readFileSync(join(root, 'src/cards/decklists.json'), 'utf8'));
const outPath = join(root, 'src/cards/cards.generated.json');
const fixtureNames = JSON.parse(readFileSync(join(root, 'tests/fixture-cards.json'), 'utf8')).cards;
const fixturePath = join(root, 'tests/fixtures.generated.json');

const HEADERS = { 'User-Agent': 'mtg-arena-edh-prototype/0.1', Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const names = new Set();
for (const d of lists.decks) {
  d.commanders.forEach((n) => names.add(n));
  Object.keys(d.basics).forEach((n) => names.add(n));
  d.cards.forEach((n) => names.add(n));
}

async function fetchTokenArt(query) {
  const url = `https://api.scryfall.com/cards/search?include_extras=true&unique=art&order=released&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return null;
  const j = await res.json();
  const hit = j.data?.find((c) => c.image_uris?.art_crop);
  return hit ? { art: hit.image_uris.art_crop.split('?')[0], image: hit.image_uris.normal.split('?')[0] } : null;
}

/**
 * Fetches cards by name. They are keyed by their full Scryfall name ("Delver of Secrets //
 * Insectile Aberration"); a list may use just the front face's name. With `legalOnly`, a
 * card that isn't legal in Commander fails the run: the game takes every pool card as legal.
 */
async function fetchCards(all, { legalOnly = false } = {}) {
  const res = await fetchCollection(all, { pause: 500, headers: { 'User-Agent': HEADERS['User-Agent'] } });
  if (res.error) throw new Error(`${res.error} (${res.failed.length} cards not fetched)`);
  const illegal = Object.entries(res.legality).filter(([, l]) => l !== 'legal');
  if (legalOnly && illegal.length) {
    console.error('NOT LEGAL IN COMMANDER:', illegal.map(([n, l]) => `${n} (${l})`).join(', '));
    process.exitCode = 1;
  }
  const cards = {};
  for (const c of res.cards) cards[c.name] = c;
  if (res.notFound.length) {
    console.error('NOT FOUND:', res.notFound.join(', '));
    process.exitCode = 1;
  }
  const found = (n) => cards[n] || Object.values(cards).some((c) => c.faces?.[0].name === n);
  const missing = all.filter((n) => !found(n));
  if (missing.length) {
    console.error('Missing after fetch (name mismatch?):', missing.join(', '));
    process.exitCode = 1;
  }
  return cards;
}

const cards = await fetchCards([...names], { legalOnly: true });

const tokens = {};
for (const [key, t] of Object.entries(lists.tokens)) {
  const img = await fetchTokenArt(t.query);
  if (!img) console.warn(`no token art for ${key}`);
  tokens[key] = img ?? { art: '', image: '' };
  // Scryfall rate-limits searches more tightly than card lookups; faster than this, they fail.
  await sleep(500);
}

writeFileSync(outPath, JSON.stringify({ cards, tokens }, null, 1));
console.log(`Wrote ${Object.keys(cards).length} cards, ${Object.keys(tokens).length} tokens to ${outPath}`);

const fixtures = await fetchCards(fixtureNames);
writeFileSync(fixturePath, JSON.stringify({ cards: fixtures }, null, 1));
console.log(`Wrote ${Object.keys(fixtures).length} test cards to ${fixturePath}`);
