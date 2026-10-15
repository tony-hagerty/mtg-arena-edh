// Cards the game refused, written down for Claude to script later (docs/card-requests.json,
// read by the /script-requested-cards skill). The app adds to it while `npm run dev` runs
// (the dev server's endpoint in vite.config.ts), a built version offers the same entries
// as a download, and `npm run parse-report` adds the pool's own. Self-contained on
// purpose: Node and the Vite config run this file directly, so it imports nothing.

/** One refused card. */
export interface CardRequest {
  name: string;
  oracleText: string;
  /** The clause the Oracle text parser couldn't read, or what else stops the card. */
  clause: string;
  /** The parser's reason ("no template matches"), or a plain description. */
  reason: string;
  /** How many times it was refused: once per deck-paste screen that met it. */
  count: number;
  /** When it was last refused, as an ISO date and time. */
  last: string;
}

export interface RequestFile {
  cards: CardRequest[];
}

/** Reads a request file's text, keeping only well-formed entries. Bad or empty text is an empty file. */
export function readRequests(text: string): RequestFile {
  try {
    const data = JSON.parse(text);
    const cards = Array.isArray(data?.cards) ? data.cards : [];
    return {
      cards: cards.filter(
        (c: CardRequest) =>
          c && typeof c.name === 'string' && typeof c.oracleText === 'string' && typeof c.clause === 'string' && typeof c.reason === 'string' && typeof c.count === 'number' && typeof c.last === 'string',
      ),
    };
  } catch {
    return { cards: [] };
  }
}

/**
 * Adds entries to a request file. A card already there is merged, not added twice: the
 * counts add up, and the newer entry's text, clause and date win. With `count: false` an
 * entry already there keeps its count (the parse report, run any number of times, isn't
 * a new request). Sorted by count, most first, then by name.
 */
export function mergeRequests(file: RequestFile, add: CardRequest[], opts: { count?: boolean } = {}): RequestFile {
  const byName = new Map(file.cards.map((c) => [c.name, { ...c }]));
  for (const c of add) {
    const old = byName.get(c.name);
    if (!old) {
      byName.set(c.name, { ...c });
      continue;
    }
    const newer = c.last >= old.last ? c : old;
    byName.set(c.name, { ...newer, count: opts.count === false ? old.count : old.count + c.count, last: newer.last });
  }
  return { cards: [...byName.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) };
}

/** A request file as it is saved: two-space JSON with a final newline, so git diffs stay small. */
export const writeRequests = (file: RequestFile) => `${JSON.stringify(file, null, 2)}\n`;

/** Takes these cards out of a request file, once they are scripted. */
export const removeRequests = (file: RequestFile, names: string[]): RequestFile => ({ cards: file.cards.filter((c) => !names.includes(c.name)) });
