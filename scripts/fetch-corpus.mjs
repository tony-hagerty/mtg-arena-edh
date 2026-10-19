// Fetches the Oracle text of the 600 most-played Commander cards from Scryfall (ordered
// by EDHREC rank) into tests/parser-corpus.generated.json: the corpus `npm run parse-report`
// scores the Oracle text parser against. Data only, no images. Run: npm run fetch-corpus
// (behind an HTTPS proxy: NODE_USE_ENV_PROXY=1 npm run fetch-corpus).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// The same Scryfall field mapping the deck-paste screen uses (Node strips its types).
import { toCard } from '../src/cards/scryfall.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'tests/parser-corpus.generated.json');
const WANTED = 600;

const HEADERS = { 'User-Agent': 'mtg-arena-edh-prototype/0.1', Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A card's data without its images: what the parser reads. */
function strip(card) {
  const { image: _image, art: _art, faces, ...rest } = card;
  return { ...rest, ...(faces ? { faces: faces.map(strip) } : {}) };
}

const cards = [];
for (let page = 1; cards.length < WANTED; page++) {
  const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent('format:commander')}&order=edhrec&page=${page}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Scryfall answered HTTP ${res.status} for page ${page}`);
  const j = await res.json();
  for (const c of j.data ?? []) {
    if (cards.length >= WANTED) break;
    cards.push({ rank: cards.length + 1, ...strip(toCard(c)) });
  }
  if (!j.has_more) break;
  // Scryfall asks for 50-100 ms between requests; searches are rate-limited more tightly.
  await sleep(500);
}

writeFileSync(outPath, JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), cards }, null, 1));
console.log(`Wrote ${cards.length} cards to ${outPath}`);
