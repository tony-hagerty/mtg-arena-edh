// Fetches card data for every card named in src/cards/decklists.json from Scryfall
// and writes src/cards/cards.generated.json. Run: npm run fetch-cards
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lists = JSON.parse(readFileSync(join(root, 'src/cards/decklists.json'), 'utf8'));
const outPath = join(root, 'src/cards/cards.generated.json');

const HEADERS = {
  'User-Agent': 'mtg-arena-edh-prototype/0.1',
  Accept: 'application/json',
  'Content-Type': 'application/json',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const names = new Set(lists.shared);
for (const d of lists.decks) {
  names.add(d.commander);
  names.add(d.basic);
  d.cards.forEach((n) => names.add(n));
}

function toCard(c) {
  const face = c.image_uris ? c : c.card_faces?.[0];
  return {
    name: c.name,
    manaCost: c.mana_cost ?? '',
    cmc: c.cmc ?? 0,
    colors: c.colors ?? [],
    colorIdentity: c.color_identity ?? [],
    typeLine: c.type_line,
    oracleText: c.oracle_text ?? '',
    power: c.power,
    toughness: c.toughness,
    keywords: c.keywords ?? [],
    image: face.image_uris.normal.split('?')[0],
    art: face.image_uris.art_crop.split('?')[0],
  };
}

async function fetchCollection(batch) {
  const res = await fetch('https://api.scryfall.com/cards/collection', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ identifiers: batch.map((name) => ({ name })) }),
  });
  if (!res.ok) throw new Error(`Scryfall HTTP ${res.status}`);
  return res.json();
}

async function fetchTokenArt(query) {
  const url = `https://api.scryfall.com/cards/search?include_extras=true&unique=art&order=released&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return null;
  const j = await res.json();
  const hit = j.data?.find((c) => c.image_uris?.art_crop);
  return hit ? { art: hit.image_uris.art_crop.split('?')[0], image: hit.image_uris.normal.split('?')[0] } : null;
}

const cards = {};
const all = [...names];
for (let i = 0; i < all.length; i += 70) {
  const j = await fetchCollection(all.slice(i, i + 70));
  for (const c of j.data) cards[c.name] = toCard(c);
  if (j.not_found?.length) {
    console.error('NOT FOUND:', j.not_found.map((x) => x.name).join(', '));
    process.exitCode = 1;
  }
  await sleep(150);
}
const missing = all.filter((n) => !cards[n]);
if (missing.length) {
  console.error('Missing after fetch (name mismatch?):', missing.join(', '));
  process.exitCode = 1;
}

const tokens = {};
for (const [key, t] of Object.entries(lists.tokens)) {
  const img = await fetchTokenArt(t.query);
  if (!img) console.warn(`no token art for ${key}`);
  tokens[key] = img ?? { art: '', image: '' };
  await sleep(150);
}

writeFileSync(outPath, JSON.stringify({ cards, tokens }, null, 1));
console.log(`Wrote ${Object.keys(cards).length} cards, ${Object.keys(tokens).length} tokens to ${outPath}`);
