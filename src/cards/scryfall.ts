// Card data from Scryfall's API, for `npm run fetch-cards` (Node) and the deck-paste screen
// (the browser) alike. Self-contained on purpose: Node runs this file directly, with its
// types stripped, so it imports nothing but types.
import type { CardData } from '../engine/types';

/** The parts of a Scryfall card object this reads (https://scryfall.com/docs/api/cards). */
interface ScryfallFace {
  name: string;
  mana_cost?: string;
  type_line: string;
  oracle_text?: string;
  colors?: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  image_uris?: { normal: string; art_crop: string };
}
export interface ScryfallCard extends ScryfallFace {
  layout: string;
  cmc?: number;
  color_identity?: string[];
  keywords?: string[];
  card_faces?: ScryfallFace[];
}

// Layouts whose faces the engine uses: double-faced (712), split (709) and adventurer (715) cards.
const FACED = ['transform', 'modal_dfc', 'split', 'adventure'];

/** Mana value of a mana cost like "{2}{R}" or "{W/U}" (202.3). */
const manaValue = (cost: string) =>
  [...cost.matchAll(/\{([^}]+)\}/g)].reduce((n, [, sym]) => n + (/^\d+$/.test(sym) ? Number(sym) : sym === 'X' ? 0 : sym.startsWith('2/') ? 2 : 1), 0);
const colorsOf = (cost: string) => ['W', 'U', 'B', 'R', 'G'].filter((x) => new RegExp(`\\{[^}]*${x}[^}]*\\}`).test(cost));
const bare = (url: string) => url.split('?')[0];

/** One face's characteristics. Scryfall keeps keywords for the whole card, so a face gets the ones its own text names. */
function toFace(c: ScryfallCard, f: ScryfallFace): CardData {
  const img = (f.image_uris ?? c.image_uris)!;
  const text = f.oracle_text ?? '';
  return {
    name: f.name,
    manaCost: f.mana_cost ?? '',
    // A transformed permanent's mana value is its front face's (712.8e); other faces have their own.
    cmc: c.layout === 'transform' ? (c.cmc ?? 0) : manaValue(f.mana_cost ?? ''),
    colors: (f.colors ?? colorsOf(f.mana_cost ?? '')) as CardData['colors'],
    colorIdentity: (c.color_identity ?? []) as CardData['colorIdentity'],
    typeLine: f.type_line,
    oracleText: text,
    power: f.power,
    toughness: f.toughness,
    loyalty: f.loyalty,
    defense: f.defense,
    keywords: (c.keywords ?? []).filter((k) => text.toLowerCase().includes(k.toLowerCase())),
    image: bare(img.normal),
    art: bare(img.art_crop),
  };
}

/** A Scryfall card as the game's `CardData`. */
export function toCard(c: ScryfallCard): CardData {
  if (FACED.includes(c.layout) && c.card_faces) {
    const faces = c.card_faces.map((f) => toFace(c, f));
    // A split card has both halves' characteristics combined everywhere but the stack (709.4).
    // The others have their front face's, or their normal (non-Adventure) ones (712.8a, 715.4).
    const top =
      c.layout === 'split'
        ? {
            ...faces[0],
            manaCost: c.mana_cost ?? '',
            cmc: c.cmc ?? 0,
            colors: (c.colors ?? []) as CardData['colors'],
            typeLine: c.type_line,
            oracleText: faces.map((f) => f.oracleText).join('\n//\n'),
          }
        : faces[0];
    return { ...top, name: c.name, colorIdentity: (c.color_identity ?? []) as CardData['colorIdentity'], keywords: c.keywords ?? [], layout: c.layout as CardData['layout'], faces };
  }
  const face = c.image_uris ? c : c.card_faces![0];
  return {
    name: c.name,
    manaCost: c.mana_cost ?? '',
    cmc: c.cmc ?? 0,
    colors: (c.colors ?? []) as CardData['colors'],
    colorIdentity: (c.color_identity ?? []) as CardData['colorIdentity'],
    typeLine: c.type_line,
    oracleText: c.oracle_text ?? '',
    power: c.power,
    toughness: c.toughness,
    loyalty: c.loyalty,
    defense: c.defense,
    keywords: c.keywords ?? [],
    image: bare(face.image_uris!.normal),
    art: bare(face.image_uris!.art_crop),
  };
}

/** What fetching a list of names came to. `error` is a plain-language reason the rest couldn't be fetched. */
export interface FetchResult {
  cards: CardData[];
  /** Names Scryfall doesn't know. */
  notFound: string[];
  /** Names not fetched because Scryfall couldn't be reached or refused, and why. */
  failed: string[];
  error: string | null;
}

/** Scryfall's limit on names per /cards/collection request. */
export const BATCH = 75;

/**
 * Fetches cards by name from Scryfall's /cards/collection, `BATCH` names a request and
 * `pause` ms between requests (Scryfall asks for 50-100 ms). Stops at the first request
 * that fails and reports the names left, so the caller can offer to retry them.
 */
export async function fetchCollection(
  names: string[],
  opts: { fetch?: typeof fetch; pause?: number; headers?: Record<string, string> } = {},
): Promise<FetchResult> {
  const get = opts.fetch ?? fetch;
  const out: FetchResult = { cards: [], notFound: [], failed: [], error: null };
  for (let i = 0; i < names.length; i += BATCH) {
    if (i > 0) await new Promise((r) => setTimeout(r, opts.pause ?? 100));
    const batch = names.slice(i, i + BATCH);
    let res: Response;
    try {
      res = await get('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...opts.headers },
        body: JSON.stringify({ identifiers: batch.map((name) => ({ name })) }),
      });
    } catch {
      out.error = "Couldn't reach Scryfall. Check the internet connection, or whether something blocks scryfall.com.";
    }
    if (!out.error && !res!.ok) {
      out.error =
        res!.status === 429
          ? 'Scryfall is limiting requests right now. Wait a minute, then retry.'
          : `Scryfall answered with an error (HTTP ${res!.status}). Try again later.`;
    }
    let body: { data?: ScryfallCard[]; not_found?: { name?: string }[] } | null = null;
    if (!out.error) {
      try {
        body = await res!.json();
      } catch {
        out.error = "Scryfall's answer couldn't be read. Try again later.";
      }
    }
    if (out.error || !body) {
      out.failed = names.slice(i);
      return out;
    }
    for (const c of body.data ?? []) out.cards.push(toCard(c));
    out.notFound.push(...(body.not_found ?? []).map((x) => x.name ?? '').filter(Boolean));
  }
  return out;
}
