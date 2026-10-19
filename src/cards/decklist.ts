// Reading a pasted deck list: plain names ("1 Sol Ring", "Sol Ring", "Sol Ring x1") and the
// exports of MTG Arena, Moxfield, Archidekt, MTGO and TappedOut ("1 Sol Ring (C21) 263",
// "Commander" and "Deck" sections, "Creatures (12)" headings, "*CMDR*" marks, Archidekt's
// "[Commander{top}]" categories, "SB:" lines, a "Commander: Name" line). Plain TypeScript,
// so it runs in the browser and in tests alike.
import { canBeCommander, cardData, cardsVersion, deckProblems, knownCardNames } from './db';
import { commanderLegality } from './fetched';
import { problemsOf, textlessRefusal, playsWithoutText } from './support';
import type { CardProblem } from './support';
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
   * From a "Commander" section, a "Commander: Name" line, a "*CMDR*" mark or an Archidekt
   * "[Commander]" category. Failing those, a sideboard of one or two cards, which is where
   * MTGO-style exports put the commander. Empty when the list doesn't say.
   */
  commanders: ListEntry[];
  /** Every other card in the deck. Sideboard, maybeboard and companion lines are left out. */
  cards: ListEntry[];
  /**
   * A list with no headings at all whose last block (after a blank line) is one or two
   * cards, as Moxfield's plain export puts the commanders: they may be the commanders.
   * `checkList` takes them if they can be (903.3). They are in `cards` too.
   */
  trailing: ListEntry[];
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
  'main deck': 'deck',
  library: 'deck',
  sideboard: 'side',
  side: 'side',
  maybeboard: 'skip',
  maybe: 'skip',
  considering: 'skip',
  companion: 'skip',
  tokens: 'skip',
  token: 'skip',
  attractions: 'skip',
  stickers: 'skip',
  about: 'about',
};

/**
 * Category headings that exporters (Moxfield, TappedOut, Archidekt, deckstats) put above
 * a group of the deck's cards: card types and common roles, singular or plural. Their
 * cards are in the deck.
 */
const CATEGORIES = new Set(
  ['creature', 'planeswalker', 'instant', 'sorcery', 'sorceries', 'artifact', 'enchantment', 'land', 'battle', 'kindred', 'tribal', 'spell', 'other', 'ramp', 'draw', 'card draw', 'removal', 'board wipe', 'board wipes', 'wipe', 'wipes', 'protection', 'recursion', 'tutor', 'counterspell', 'interaction', 'win condition', 'win conditions', 'finisher', 'utility', 'mana rock', 'mana rocks', 'mana', 'nonbasic land', 'nonbasic lands', 'basic land', 'basic lands'].flatMap((w) => [w, `${w}s`]),
);

/** A heading's words, without a count or colon: "Creatures (12)" and "CREATURES:" are "creatures". */
const headingWords = (s: string) =>
  s
    .replace(/\s*[([]\s*\d+\s*[)\]]\s*:?$/, '')
    .replace(/\s+-\s+\d+$/, '')
    .replace(/:$/, '')
    .trim()
    .toLowerCase();

/**
 * Reads a pasted list line by line. A line is "[SB:] [count][x] Name [xN] [(SET) number]
 * [*marks*] [[Category]] [#tag]"; the count defaults to 1, and set codes, collector numbers
 * and marks other than "*CMDR*" are ignored. "//" and "#" start comments.
 */
export function parseDeckList(text: string): ParsedList {
  const out: ParsedList = { commanders: [], cards: [], trailing: [], title: null, unreadable: [] };
  let section: Section = 'deck';
  const side: ListEntry[] = [];
  /** Any heading or mark that says where cards go: then a trailing block is just cards. */
  let marked = false;
  /** The deck's cards in blocks between blank lines, for `trailing`. */
  const blocks: ListEntry[][] = [[]];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    let s = raw.trim();
    if (!s) {
      if (blocks[blocks.length - 1].length) blocks.push([]);
      return;
    }
    if (s.startsWith('//') || (s.startsWith('#') && !/^#\d/.test(s))) return;
    const words = headingWords(s);
    const heading = SECTIONS[words];
    if (heading) {
      section = heading;
      marked = true;
      return;
    }
    if (CATEGORIES.has(words)) {
      // A category heading inside the deck; after a Commander section it goes back to the deck.
      if (section === 'commander' || section === 'about') section = 'deck';
      marked = true;
      return;
    }
    if (section === 'about') {
      const name = /^name\s+(.+)$/i.exec(s);
      if (name) out.title = name[1].trim();
      return;
    }
    // Headings with more words, like "Sideboard (1)" or "Maybeboard - 3", from other exporters.
    const long = /^(sideboard|maybeboard)\b/i.exec(s);
    if (long) {
      section = long[1].toLowerCase() === 'sideboard' ? 'side' : 'skip';
      marked = true;
      return;
    }
    // "Commander: Name" (TappedOut and hand-written lists); a partner can have its own line.
    const named = /^commanders?\s*:\s*(.+)$/i.exec(s);
    // "SB: 1 Name", the sideboard in MTGO and MWS-style lists.
    const sb = /^sb:\s*(.+)$/i.exec(s);
    if (named) s = named[1];
    if (sb) s = sb[1];
    if (section === 'skip' && !named) return;
    const m = /^(?:(\d+)\s*x?\s+|x(\d+)\s+)?(.+?)(?:\s+x\s*(\d+))?$/i.exec(s)!;
    const count = parseInt(m[1] ?? m[2] ?? m[4] ?? '1', 10);
    let name = m[3];
    // Archidekt's categories: "[Commander{top}]" is the commander, "{noDeck}" isn't in the deck.
    const categories = [...name.matchAll(/\[([^\]]*)\]/g)].map((c) => c[1]);
    const inCategory = (word: string) => categories.some((c) => c.split(',').some((part) => part.replace(/\{[^}]*\}/g, '').trim().toLowerCase() === word));
    if (categories.some((c) => /\{nodeck\}/i.test(c)) || inCategory('maybeboard') || inCategory('sideboard') || inCategory('considering')) return;
    const commander = !!named || /\*CMDR\*/i.test(name) || inCategory('commander');
    name = name
      .replace(/\*[^*]*\*/g, '') // *CMDR*, *F* (foil), *E* (etched)
      .replace(/\[[^\]]*\]/g, '') // [Category] tags
      .replace(/\^[^^]*\^/g, '') // Archidekt's ^Tag,#colour^ labels
      .replace(/\s+#\S.*$/, '') // TappedOut's #tags
      .replace(/\s+\([A-Za-z0-9]{2,6}\)(\s+[\w★-]+)?\s*$/, '') // (SET) and collector number
      .replace(/\s+x\s*\d+$/i, '') // a count after the set code: "Sol Ring (C21) 263 x1"
      .trim();
    if (!name || count < 1) {
      out.unreadable.push({ line, text: raw.trim() });
      return;
    }
    if (commander) marked = true;
    const entry = { name, count, line };
    if (section === 'commander' || commander) out.commanders.push(entry);
    else if (section === 'side' || sb) side.push(entry);
    else {
      out.cards.push(entry);
      blocks[blocks.length - 1].push(entry);
    }
  });
  if (!out.commanders.length && side.length >= 1 && side.length <= 2) out.commanders = side;
  const filled = blocks.filter((b) => b.length);
  const last = filled[filled.length - 1];
  if (!marked && !side.length && filled.length >= 2 && last.length <= 2 && last.every((e) => e.count === 1)) out.trailing = last;
  return out;
}

/** A name in a comparable form: lower case, one kind of apostrophe and spacing, "A // B" spaced one way. */
export const norm = (name: string) =>
  name
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s*\/\/?\s*/g, ' // ')
    .replace(/\s+/g, ' ')
    .trim();

let index: Map<string, string> | null = null;
let indexed = -1;

/**
 * The card-pool name for a name as written, or null if the pool has no such card. Cards
 * fetched from Scryfall count as in the pool once added. Case doesn't matter. A card with
 * faces is found by its full name ("Fire // Ice") or its first face's ("Delver of
 * Secrets"), and is listed by its first face's name, as the built-in decks list it.
 */
export function poolName(name: string): string | null {
  if (!index || indexed !== cardsVersion()) {
    index = new Map();
    indexed = cardsVersion();
    for (const key of knownCardNames()) {
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
export function makeDeck(id: string, title: string, commanders: string[], parts: ListDeck, textless: string[] = []): DeckDef {
  const cards = [...parts.cards];
  for (const c of commanders) {
    const i = cards.indexOf(c);
    if (i >= 0) cards.splice(i, 1);
  }
  // A commander is never played without its text: its text is the deck.
  const plain = textless.filter((n) => !commanders.includes(n));
  return { id, title, blurb: 'A pasted deck.', pilot: pilotName(commanders), commanders, basics: parts.basics, cards, ...(plain.length ? { textless: plain } : {}) };
}

/** Why card `name` can't be in a Commander deck at all, or null if it may be: banned, not legal, or its legality not known yet. */
export function legalityProblem(name: string): string | null {
  switch (commanderLegality(name)) {
    case 'legal':
      return null;
    case 'banned':
      return 'banned in Commander';
    case null:
      return "its Commander legality isn't known yet; it is checked once Scryfall can be reached";
    default:
      return 'not legal in Commander';
  }
}

/**
 * Why card `name` can't be in a deck, one reason per problem, or an empty list if it can:
 * it isn't legal in Commander (banned, say), or the engine can't play it (`unsupported`).
 * A card that isn't legal gets only that reason, since scripting it wouldn't help.
 */
export function cardProblems(name: string): string[] {
  const illegal = legalityProblem(name);
  return illegal ? [illegal] : problemsOf(name).map((p) => p.text);
}

/** What stops a saved deck being played, sorted for the menu. */
export interface DeckState {
  /** Cards a newer card pool lacks or that aren't legal in Commander, then broken deck rules: the deck can't be fixed by playing a card without its text. */
  issues: string[];
  /** Cards the game can't play yet and the deck doesn't play without their text (refused cards left over at saving). */
  unplayable: string[];
  /** Cards the deck plays without their rules text (`playsWithoutText`). */
  textless: string[];
}

/** A saved deck's state for the menu: what stops it, and which cards play without their text. */
export function savedDeckState(deck: DeckDef): DeckState {
  const issues: string[] = [];
  const unplayable: string[] = [];
  const textless: string[] = [];
  for (const n of names(deck)) {
    const problems = problemsOf(n);
    const illegal = problems.some((p) => p.kind === 'pool') ? 'not in the card pool' : legalityProblem(n);
    if (illegal) issues.push(`${n}: ${illegal}`);
    else if (!problems.length) continue;
    else if (playsWithoutText(deck, n)) textless.push(n);
    else unplayable.push(n);
  }
  // The deck rules need every card's data, so they are checked once the pool has them all.
  if (!issues.length) issues.push(...deckProblems(deck));
  return { issues, unplayable, textless };
}

/**
 * Why a saved deck can't be played, or an empty list if it can: cards a newer card pool
 * doesn't have, that aren't legal in Commander, or that the game can't play (and the deck
 * doesn't play without their text), each with its reason; failing those, the deck rules
 * (`deckProblems`). It reads no browser storage, so the game server can check decks with it too.
 */
export function savedDeckIssues(deck: DeckDef): string[] {
  const { issues, unplayable } = savedDeckState(deck);
  const cant = unplayable.flatMap((n) => cardProblems(n).map((p) => `${n}: ${p}`));
  const cards = issues.filter((i) => names(deck).some((n) => i.startsWith(`${n}: `)));
  return cards.length || cant.length ? [...cards, ...cant] : issues;
}

const names = (deck: DeckDef) => [...new Set([...deck.commanders, ...Object.keys(deck.basics), ...deck.cards])];

/**
 * A saved deck written out as a list for the paste screen, with the cards in `first` (the
 * ones the game can't play yet) at the top of the deck, so they are the first thing a friend sees.
 */
export function deckAsList(deck: DeckDef, first: string[] = []): string {
  const top = deck.cards.filter((c) => first.includes(c));
  const rest = deck.cards.filter((c) => !first.includes(c));
  const basics = Object.entries(deck.basics).map(([name, n]) => `${n} ${name}`);
  return ['Commander', ...deck.commanders.map((c) => `1 ${c}`), '', 'Deck', ...[...top, ...rest].map((c) => `1 ${c}`), ...basics].join('\n');
}

/** A card in a pasted list that the game can't play yet, and what can be done about it. */
export interface RefusedCard {
  /** Its card-pool name. */
  name: string;
  problems: CardProblem[];
  /** The refused list groups cards by this: the clause's shape, or the reason when the whole card was refused. */
  group: string;
  /** The heading the group shows: the clause the game can't read (with "this card" for the card's name), or the reason. */
  heading: string;
  /** The line of its Oracle text the game can't read. */
  line: string;
  /** `heading` already says all of `line` (the clause is the whole line), so the screen needn't show it twice. */
  lineInHeading: boolean;
  /** It is one of the deck's commanders. */
  commander: boolean;
  /** Why it can't be played without its rules text, or null if it can (`textlessRefusal`; a commander never can). */
  noTextless: string | null;
  /** The player chose to play it without its rules text, and it can be. */
  textless: boolean;
}

/** `clause` with the card's name (and its short name, before a comma) as "this card", so cards that stumble on the same wording group together. */
function clauseShape(clause: string, name: string): string {
  let out = clause;
  const short = name.split(',')[0];
  for (const n of short !== name ? [name, short] : [name]) out = out.split(n).join('this card');
  return out;
}

/** A refused card's entry in the refused list. */
function refusedCard(name: string, problems: CardProblem[], commanders: string[], chosen: string[]): RefusedCard {
  const d = cardData(name);
  const text = problems.find((p) => p.kind === 'text');
  const first = text ?? problems[0];
  const whole = !text?.clause || text.clause.toLowerCase() === d.name.toLowerCase() || text.clause.toLowerCase() === name.toLowerCase();
  const heading = text && !whole ? `“${clauseShape(text.clause!, d.name)}”` : first.kind === 'text' ? (first.reason ?? first.text) : first.text;
  const commander = commanders.includes(name);
  const noTextless = commander ? "it's the commander, and a commander's text is the deck" : textlessRefusal(name);
  const line = text?.line ?? d.oracleText;
  // Compared as the parser reads them: "this creature" is the card itself, like its name.
  const same = (t: string) =>
    clauseShape(t, d.name)
      .toLowerCase()
      .replace(/\bthis (creature|artifact|enchantment|land|permanent|spell)\b/g, 'this card')
      .replace(/[“”".]/g, '')
      .trim();
  return {
    name,
    problems,
    group: heading.toLowerCase(),
    heading,
    line,
    lineInHeading: same(heading) === same(line),
    commander,
    noTextless,
    textless: noTextless === null && chosen.includes(name),
  };
}

/** The paste screen's view of a list: what it read, who leads it, and what stops it being saved. */
export interface ListCheck {
  list: ParsedList;
  parts: ListDeck;
  /** Cards the screen offers as commanders: the list's own, then every card that can be one. */
  candidates: string[];
  /** The commanders in use: the human's pick, else the list's, else its only candidate. */
  commanders: string[];
  /**
   * Every reason the deck can't be saved, as sentences: lines that aren't cards, names the
   * pool lacks, cards not legal in Commander, the commander, the deck rules. Empty when it
   * can. Cards the game can't play yet are in `refused` instead: they don't stop saving.
   */
  problems: string[];
  /** Cards the game can't play yet, in list order, each with its choice. */
  refused: RefusedCard[];
  /** The refused cards not played without their text: saved, the deck waits for them. */
  leftover: RefusedCard[];
  /** The deck, ready to save, when there are no `problems`. It may still have `leftover` cards. */
  deck: DeckDef | null;
  /** The deck can be played once saved: no problems and nothing left over. */
  ready: boolean;
}

/** A `deckProblems` line as a sentence: "has 99 cards, not 100" becomes "The deck has 99 cards, not 100." */
const sentence = (p: string) => `${p.startsWith('has ') ? `The deck ${p}` : p}.`;

/**
 * Checks pasted text for the paste screen. `picked` is the commanders the human chose on
 * the screen, or null to use the list's. `title` is the name typed on the screen, if any.
 * `unknown` says why a name isn't in the pool, after the name ("isn't in the card pool"):
 * the screen says whether it is being fetched, or why it couldn't be. `textless` is the
 * cards the human chose to play without their rules text.
 */
export function checkList(
  text: string,
  picked: string[] | null,
  title: string,
  id: string,
  unknown = (_name: string) => "isn't in the card pool",
  textless: string[] = [],
): ListCheck {
  const list = parseDeckList(text);
  const parts = listDeck(list);
  const trailing = list.trailing.map((e) => poolName(e.name)).filter((n): n is string => !!n);
  // Moxfield's plain export puts the commanders last, after a blank line (903.3).
  const fromTrailing = !parts.commanders.length && trailing.length === list.trailing.length && trailing.length > 0 && trailing.every((n) => canBeCommander(cardData(n))) ? trailing : [];
  const listed = parts.commanders.length ? parts.commanders : fromTrailing;
  const candidates = [...new Set([...listed, ...commanderCandidates(parts)])];
  const commanders = picked ?? (listed.length ? listed : candidates.length === 1 ? candidates : []);
  const problems: string[] = [];
  for (const u of list.unreadable) problems.push(`Line ${u.line} isn't a card: "${u.text}".`);
  for (const name of parts.unknown) problems.push(`${name} ${unknown(name)}.`);
  const refused: RefusedCard[] = [];
  for (const name of new Set([...parts.commanders, ...parts.cards])) {
    const illegal = legalityProblem(name);
    if (illegal) {
      problems.push(`${name}: ${illegal}.`);
      continue;
    }
    const cant = problemsOf(name);
    if (cant.length) refused.push(refusedCard(name, cant, commanders, textless));
  }
  if (!list.commanders.length && !list.cards.length) problems.push('Paste a deck list to start.');
  else if (!commanders.length) problems.push('Pick the commander below.');
  const named = title.trim() || list.title || commanders.join(' & ') || 'Pasted deck';
  const chosen = refused.filter((r) => r.textless).map((r) => r.name);
  const deck = makeDeck(id, named, commanders, parts, chosen);
  if (commanders.length) problems.push(...deckProblems(deck).map(sentence));
  const leftover = refused.filter((r) => !r.textless);
  return { list, parts, candidates, commanders, problems, refused, leftover, deck: problems.length ? null : deck, ready: !problems.length && !leftover.length };
}
