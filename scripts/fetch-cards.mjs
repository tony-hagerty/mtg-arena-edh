// Fetches card data for every card named in src/cards/decklists.json from Scryfall
// and writes src/cards/cards.generated.json. Also fetches the test-only cards listed in
// tests/fixture-cards.json into tests/fixtures.generated.json. Run: npm run fetch-cards
// (behind an HTTPS proxy: NODE_USE_ENV_PROXY=1 npm run fetch-cards).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lists = JSON.parse(readFileSync(join(root, 'src/cards/decklists.json'), 'utf8'));
const outPath = join(root, 'src/cards/cards.generated.json');
const fixtureNames = JSON.parse(readFileSync(join(root, 'tests/fixture-cards.json'), 'utf8')).cards;
const fixturePath = join(root, 'tests/fixtures.generated.json');

const HEADERS = {
  'User-Agent': 'mtg-arena-edh-prototype/0.1',
  Accept: 'application/json',
  'Content-Type': 'application/json',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const names = new Set(lists.shared);
for (const d of lists.decks) {
  d.commanders.forEach((n) => names.add(n));
  Object.keys(d.basics).forEach((n) => names.add(n));
  d.cards.forEach((n) => names.add(n));
}

// Layouts whose faces the engine uses: double-faced (712), split (709) and adventurer (715) cards.
const FACED = ['transform', 'modal_dfc', 'split', 'adventure'];
/** Mana value of a mana cost like "{2}{R}" or "{W/U}" (202.3). */
const manaValue = (cost) =>
  [...cost.matchAll(/\{([^}]+)\}/g)].reduce((n, [, sym]) => n + (/^\d+$/.test(sym) ? Number(sym) : sym === 'X' ? 0 : sym.startsWith('2/') ? 2 : 1), 0);
const colorsOf = (cost) => ['W', 'U', 'B', 'R', 'G'].filter((x) => new RegExp(`\\{[^}]*${x}[^}]*\\}`).test(cost));

/** One face's characteristics. Scryfall keeps keywords for the whole card, so a face gets the ones its own text names. */
function toFace(c, f) {
  const img = f.image_uris ?? c.image_uris;
  const text = f.oracle_text ?? '';
  return {
    name: f.name,
    manaCost: f.mana_cost ?? '',
    // A transformed permanent's mana value is its front face's (712.8e); other faces have their own.
    cmc: c.layout === 'transform' ? c.cmc : manaValue(f.mana_cost ?? ''),
    colors: f.colors ?? colorsOf(f.mana_cost ?? ''),
    colorIdentity: c.color_identity ?? [],
    typeLine: f.type_line,
    oracleText: text,
    power: f.power,
    toughness: f.toughness,
    loyalty: f.loyalty,
    defense: f.defense,
    keywords: (c.keywords ?? []).filter((k) => text.toLowerCase().includes(k.toLowerCase())),
    image: img.normal.split('?')[0],
    art: img.art_crop.split('?')[0],
  };
}

function toCard(c) {
  if (FACED.includes(c.layout) && c.card_faces) {
    const faces = c.card_faces.map((f) => toFace(c, f));
    // A split card has both halves' characteristics combined everywhere but the stack (709.4).
    // The others have their front face's, or their normal (non-Adventure) ones (712.8a, 715.4).
    const top =
      c.layout === 'split'
        ? { ...faces[0], manaCost: c.mana_cost, cmc: c.cmc, colors: c.colors ?? [], typeLine: c.type_line, oracleText: faces.map((f) => f.oracleText).join('\n//\n') }
        : faces[0];
    return { ...top, name: c.name, colorIdentity: c.color_identity ?? [], keywords: c.keywords ?? [], layout: c.layout, faces };
  }
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
    loyalty: c.loyalty,
    defense: c.defense,
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

/**
 * Fetches cards by name. They are keyed by their full Scryfall name ("Delver of Secrets //
 * Insectile Aberration"); a list may use just the front face's name.
 */
async function fetchCards(all) {
  const cards = {};
  for (let i = 0; i < all.length; i += 70) {
    const j = await fetchCollection(all.slice(i, i + 70));
    for (const c of j.data) cards[c.name] = toCard(c);
    if (j.not_found?.length) {
      console.error('NOT FOUND:', j.not_found.map((x) => x.name).join(', '));
      process.exitCode = 1;
    }
    await sleep(150);
  }
  const found = (n) => cards[n] || Object.values(cards).some((c) => c.faces?.[0].name === n);
  const missing = all.filter((n) => !found(n));
  if (missing.length) {
    console.error('Missing after fetch (name mismatch?):', missing.join(', '));
    process.exitCode = 1;
  }
  return cards;
}

const cards = await fetchCards([...names]);

const tokens = {};
for (const [key, t] of Object.entries(lists.tokens)) {
  const img = await fetchTokenArt(t.query);
  if (!img) console.warn(`no token art for ${key}`);
  tokens[key] = img ?? { art: '', image: '' };
  await sleep(150);
}

writeFileSync(outPath, JSON.stringify({ cards, tokens }, null, 1));
console.log(`Wrote ${Object.keys(cards).length} cards, ${Object.keys(tokens).length} tokens to ${outPath}`);

const fixtures = await fetchCards(fixtureNames);
writeFileSync(fixturePath, JSON.stringify({ cards: fixtures }, null, 1));
console.log(`Wrote ${Object.keys(fixtures).length} test cards to ${fixturePath}`);
