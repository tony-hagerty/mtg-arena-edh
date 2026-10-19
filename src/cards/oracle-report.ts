// The parse report (`npm run parse-report`): what the Oracle text parser can script on its
// own across the card pool, and why it refused the rest.
// First, so the engine registers the hand scripts before the parser scripts the rest.
import { unsupported } from './support';
import { ALL_CARD_NAMES, cardData } from './db';
import { needsScript, parseCard, refusalOf } from './oracle';
import type { CardRequest } from './requests';
import type { CardData } from '../engine/types';
import corpus from '../../tests/parser-corpus.generated.json';

export interface ReportLine {
  name: string;
  clause: string;
  reason: string;
}

/** Every pool card with rules text, sorted into the ones the parser scripts and the ones it refuses. */
export function parseResults(names = ALL_CARD_NAMES): { scripted: string[]; refused: ReportLine[] } {
  return parseAll(names.map(cardData));
}

function parseAll(cards: CardData[]): { scripted: string[]; refused: ReportLine[] } {
  const scripted: string[] = [];
  const refused: ReportLine[] = [];
  for (const d of cards) {
    if (d.typeLine.startsWith('Basic Land') || !needsScript(d)) continue;
    const p = parseCard(d);
    if (p.ok) scripted.push(d.name);
    else refused.push({ name: d.name, clause: p.clause, reason: p.reason });
  }
  return { scripted, refused };
}

/** The 600 most-played Commander cards (tests/parser-corpus.generated.json, `npm run fetch-corpus`). */
export const CORPUS = corpus.cards as unknown as (CardData & { rank: number })[];

/** The corpus, sorted the same way. */
export const corpusResults = () => parseAll(CORPUS);

/**
 * A refused clause's shape: the card's name, numbers and mana symbols set aside, so clauses
 * that differ only in them count as one wording ("whenever ~ attacks, draw N cards").
 */
export function shapeOf(line: ReportLine): string {
  const short = line.name.split(',')[0];
  let s = line.clause;
  for (const n of short !== line.name ? [line.name, short] : [line.name]) s = s.split(n).join('~');
  return s
    .toLowerCase()
    .replace(/\{[^}]+\}/g, '{M}')
    .replace(/[+-]\d+\/[+-]\d+/g, '+N/+N')
    .replace(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, 'N');
}

/** Refused lines grouped by shape, biggest group first. */
export function byShape(refused: ReportLine[]): [string, ReportLine[]][] {
  const groups = new Map<string, ReportLine[]>();
  for (const r of refused) {
    const key = `${shapeOf(r)} | ${r.reason.replace(r.name, '~')}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

/**
 * Refused lines grouped by how the clause opens (its first three words), biggest group
 * first: the kinds of ability the parser lacks most, whatever follows.
 */
export function byOpening(refused: ReportLine[]): [string, number][] {
  const groups = new Map<string, number>();
  for (const r of refused) {
    const key = shapeOf(r).split(/[ ,:]+/).slice(0, 3).join(' ');
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const score = (scripted: string[], refused: ReportLine[]) => {
  const total = scripted.length + refused.length;
  return `${total} cards with rules text: the parser scripts ${scripted.length} (${total ? Math.round((100 * scripted.length) / total) : 0}%) and refuses ${refused.length}.`;
};

/**
 * The report as text: the pool's score, the cards it scripts and each refusal grouped by
 * reason; then the corpus's score with its refusals grouped by shape and by opening, biggest
 * groups first. The groups are the to-do list: work from the biggest down.
 */
export function parseReport(): string {
  const { scripted, refused } = parseResults();
  const byReason = new Map<string, ReportLine[]>();
  for (const r of refused) byReason.set(r.reason, [...(byReason.get(r.reason) ?? []), r]);
  const out = [`Pool. ${score(scripted, refused)}`, '', `Scripted (${scripted.length}):`, ...scripted.map((n) => `  ${n}`), '', `Refused, by reason (${refused.length}):`];
  for (const [reason, lines] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
    out.push('', `  ${reason} (${lines.length})`);
    for (const r of lines) out.push(`    ${r.name}: ${r.clause}`);
  }
  const c = corpusResults();
  out.push('', `Corpus (the ${CORPUS.length} most-played Commander cards, ${corpus.fetched}). ${score(c.scripted, c.refused)}`, '', 'Refused, by opening words:');
  for (const [opening, n] of byOpening(c.refused)) out.push(`  ${String(n).padStart(3)}  ${opening}`);
  out.push('', 'Refused, by shape:');
  for (const [shape, lines] of byShape(c.refused)) {
    out.push('', `  ${shape} (${lines.length})`);
    for (const r of lines) out.push(`    ${r.name}: ${r.clause}`);
  }
  return out.join('\n');
}

/**
 * Pool cards the game can't play, with neither a hand script nor a parsed one (cards of
 * unfinished decks), as entries for docs/card-requests.json.
 */
export function poolRequests(now = new Date()): CardRequest[] {
  return ALL_CARD_NAMES.flatMap((name) => {
    const problems = unsupported(name);
    if (!problems.length) return [];
    const refused = refusalOf(name);
    const d = cardData(name);
    return [{ name, oracleText: d.oracleText, clause: refused?.clause ?? problems.join('; '), reason: refused?.reason ?? 'not supported', count: 1, last: now.toISOString() }];
  });
}
