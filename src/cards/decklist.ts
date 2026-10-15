// Reading a pasted deck list: plain names ("1 Sol Ring", "Sol Ring") and the exports of
// MTG Arena and Moxfield ("1 Sol Ring (C21) 263", "Commander" and "Deck" sections,
// "*CMDR*" marks). Plain TypeScript, so it runs in the browser and in tests alike.
import { ALL_CARD_NAMES, canBeCommander, cardData, deckProblems } from './db';
import { unsupported } from './support';
import type { DeckDef } from './db';

/** One line of a list: a card name as written, how many, and where it is. */
export interface ListEntry {
  name: string;
  count: number;
  /** 1-based line number in the pasted text. */
  line: number;
}

export interface ParsedList {
  /**
   * From a "Commander" section or a "*CMDR*" mark. Failing those, a sideboard of one or
   * two cards, which is where MTGO-style exports put the commander. Empty when the list
   * doesn't say.
   */
  commanders: ListEntry[];
  /** Every other card in the deck. Sideboard, maybeboard and companion lines are left out. */
  cards: ListEntry[];
  /** A deck name from the list ("Name ..." in an Arena export's "About" section), or null. */
  title: string | null;
  /** Lines that aren't a card or a section heading, by line number. */
  unreadable: { line: number; text: string }[];
}

type Section = 'commander' | 'deck' | 'side' | 'skip' | 'about';

/** Section headings, lower case, and whether their cards are in the deck. */
const SECTIONS: Record<string, Section> = {
  commander: 'commander',
  commanders: 'commander',
  deck: 'deck',
  mainboard: 'deck',
  main: 'deck',
  sideboard: 'side',
  maybeboard: 'skip',
  considering: 'skip',
  companion: 'skip',
  tokens: 'skip',
  about: 'about',
};

/**
 * Reads a pasted list line by line. A line is "[count][x] Name [(SET) number] [*marks*]";
 * the count defaults to 1, and set codes, collector numbers and marks other than
 * "*CMDR*" are ignored. "//" and "#" start comments.
 */
export function parseDeckList(text: string): ParsedList {
  const out: ParsedList = { commanders: [], cards: [], title: null, unreadable: [] };
  let section: Section = 'deck';
  const side: ListEntry[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const s = raw.trim();
    if (!s || s.startsWith('//') || s.startsWith('#')) return;
    const heading = SECTIONS[s.replace(/:$/, '').toLowerCase()];
    if (heading) {
      section = heading;
      return;
    }
    if (section === 'about') {
      const name = /^name\s+(.+)$/i.exec(s);
      if (name) out.title = name[1].trim();
      return;
    }
    // Headings with a count or more words, like "Sideboard (1)", from other exporters.
    const long = /^(sideboard|maybeboard)\b/i.exec(s);
    if (long) {
      section = long[1].toLowerCase() === 'sideboard' ? 'side' : 'skip';
      return;
    }
    if (section === 'skip') return;
    const m = /^(?:(\d+)\s*x?\s+)?(.+)$/i.exec(s)!;
    const count = m[1] ? parseInt(m[1], 10) : 1;
    let name = m[2];
    const commander = /\*CMDR\*/i.test(name);
    name = name
      .replace(/\*[^*]*\*/g, '') // *CMDR*, *F* (foil), *E* (etched)
      .replace(/\[[^\]]*\]/g, '') // [Category] tags
      .replace(/\s+\([A-Za-z0-9]{2,6}\)(\s+[\w★-]+)?\s*$/, '') // (SET) and collector number
      .trim();
    if (!name || count < 1) {
      out.unreadable.push({ line, text: s });
      return;
    }
    (section === 'commander' || commander ? out.commanders : section === 'side' ? side : out.cards).push({ name, count, line });
  });
  if (!out.commanders.length && side.length >= 1 && side.length <= 2) out.commanders = side;
  return out;
}

/** A name in a comparable form: lower case, one kind of apostrophe and spacing, "A // B" spaced one way. */
const norm = (name: string) =>
  name
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s*\/\/?\s*/g, ' // ')
    .replace(/\s+/g, ' ')
    .trim();

let index: Map<string, string> | null = null;

/**
 * The card-pool name for a name as written, or null if the pool has no such card.
 * Case doesn't matter. A card with faces is found by its full name ("Fire // Ice") or its
 * first face's ("Delver of Secrets"), and is listed by its first face's name, as the
 * built-in decks list it.
 */
export function poolName(name: string): string | null {
  if (!index) {
    index = new Map();
    for (const key of ALL_CARD_NAMES) {
      const d = cardData(key);
      const listed = d.faces ? d.faces[0].name : key;
      index.set(norm(key), listed);
      index.set(norm(listed), listed);
    }
  }
  return index.get(norm(name)) ?? null;
}

/** What a parsed list becomes: the deck, plus the names the pool doesn't have. */
export interface ListDeck {
  /** Commanders and cards by their pool names. Unknown names are left out. */
  commanders: string[];
  basics: Record<string, number>;
  cards: string[];
  /** Names the card pool doesn't have, as written, once each. */
  unknown: string[];
}

/**
 * Turns a parsed list into a deck's parts. Basic lands go in `basics`; every other card is
 * listed as many times as the list says, so `deckProblems` can report a second copy (903.5b).
 */
export function listDeck(list: ParsedList): ListDeck {
  const out: ListDeck = { commanders: [], basics: {}, cards: [], unknown: [] };
  const unknown = new Set<string>();
  for (const e of list.commanders) {
    const name = poolName(e.name);
    if (name) out.commanders.push(name);
    else unknown.add(e.name);
  }
  for (const e of list.cards) {
    const name = poolName(e.name);
    if (!name) {
      unknown.add(e.name);
      continue;
    }
    if (cardData(name).typeLine.startsWith('Basic Land')) out.basics[name] = (out.basics[name] ?? 0) + e.count;
    else for (let k = 0; k < e.count; k++) out.cards.push(name);
  }
  out.unknown = [...unknown];
  return out;
}

/**
 * The cards in a list that could lead it, for the paste screen to offer when the list
 * doesn't name its commanders: each card that can be a commander (903.3).
 */
export const commanderCandidates = (parts: ListDeck) => [...new Set([...parts.commanders, ...parts.cards])].filter((n) => canBeCommander(cardData(n)));

/** A short name for the bot that plays a pasted deck: its first commander's, up to the comma. */
export const pilotName = (commanders: string[]) => (commanders[0] ?? 'Pilot').split(',')[0].trim();

/** Builds a deck from its parts, with the commanders taken out of the cards if the list had them there too. */
export function makeDeck(id: string, title: string, commanders: string[], parts: ListDeck): DeckDef {
  const cards = [...parts.cards];
  for (const c of commanders) {
    const i = cards.indexOf(c);
    if (i >= 0) cards.splice(i, 1);
  }
  return { id, title, blurb: 'A pasted deck.', pilot: pilotName(commanders), commanders, basics: parts.basics, cards };
}

/**
 * Why a saved deck can't be played: names a newer card pool doesn't have or can't play,
 * then the deck rules (`deckProblems`). Empty if it can be played.
 */
export function savedDeckIssues(deck: DeckDef): string[] {
  const names = [...new Set([...deck.commanders, ...Object.keys(deck.basics), ...deck.cards])];
  const missing = names.flatMap((n) => unsupported(n).map((p) => `${n}: ${p}`));
  return missing.length ? missing : deckProblems(deck);
}

/** The paste screen's view of a list: what it read, who leads it, and what stops it being saved. */
export interface ListCheck {
  list: ParsedList;
  parts: ListDeck;
  /** Cards the screen offers as commanders: the list's own, then every card that can be one. */
  candidates: string[];
  /** The commanders in use: the human's pick, else the list's, else its only candidate. */
  commanders: string[];
  /** Every reason the deck can't be saved, as sentences. Empty when it can. */
  problems: string[];
  /** The deck, ready to save, when there are no problems. */
  deck: DeckDef | null;
}

/** A `deckProblems` line as a sentence: "has 99 cards, not 100" becomes "The deck has 99 cards, not 100." */
const sentence = (p: string) => `${p.startsWith('has ') ? `The deck ${p}` : p}.`;

/**
 * Checks pasted text for the paste screen. `picked` is the commanders the human chose on
 * the screen, or null to use the list's. `title` is the name typed on the screen, if any.
 */
export function checkList(text: string, picked: string[] | null, title: string, id: string): ListCheck {
  const list = parseDeckList(text);
  const parts = listDeck(list);
  const candidates = [...new Set([...parts.commanders, ...commanderCandidates(parts)])];
  const commanders = picked ?? (parts.commanders.length ? parts.commanders : candidates.length === 1 ? candidates : []);
  const problems: string[] = [];
  for (const u of list.unreadable) problems.push(`Line ${u.line} isn't a card: "${u.text}".`);
  for (const name of parts.unknown) problems.push(`${name} isn't in the card pool.`);
  for (const name of new Set([...parts.commanders, ...parts.cards])) {
    for (const p of unsupported(name)) problems.push(`${name}: ${p}.`);
  }
  if (!list.commanders.length && !list.cards.length) problems.push('Paste a deck list to start.');
  else if (!commanders.length) problems.push('Pick the commander below.');
  const named = title.trim() || list.title || commanders.join(' & ') || 'Pasted deck';
  const deck = makeDeck(id, named, commanders, parts);
  if (commanders.length) problems.push(...deckProblems(deck).map(sentence));
  return { list, parts, candidates, commanders, problems, deck: problems.length ? null : deck };
}
