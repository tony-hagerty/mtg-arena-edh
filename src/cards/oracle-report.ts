// The parse report (`npm run parse-report`): what the Oracle text parser can script on its
// own across the card pool, and why it refused the rest.
// First, so the engine registers the hand scripts before the parser scripts the rest.
import { unsupported } from './support';
import { ALL_CARD_NAMES, cardData } from './db';
import { needsScript, parseCard, refusalOf } from './oracle';
import type { CardRequest } from './requests';

export interface ReportLine {
  name: string;
  clause: string;
  reason: string;
}

/** Every pool card with rules text, sorted into the ones the parser scripts and the ones it refuses. */
export function parseResults(names = ALL_CARD_NAMES): { scripted: string[]; refused: ReportLine[] } {
  const scripted: string[] = [];
  const refused: ReportLine[] = [];
  for (const name of names) {
    const d = cardData(name);
    if (d.typeLine.startsWith('Basic Land') || !needsScript(d)) continue;
    const p = parseCard(d);
    if (p.ok) scripted.push(name);
    else refused.push({ name, clause: p.clause, reason: p.reason });
  }
  return { scripted, refused };
}

/** The report as text: counts, the cards it scripts, and each refusal grouped by reason. */
export function parseReport(): string {
  const { scripted, refused } = parseResults();
  const total = scripted.length + refused.length;
  const pct = total ? Math.round((100 * scripted.length) / total) : 0;
  const byReason = new Map<string, ReportLine[]>();
  for (const r of refused) byReason.set(r.reason, [...(byReason.get(r.reason) ?? []), r]);
  const out = [
    `Cards with rules text: ${total}. The parser scripts ${scripted.length} (${pct}%) and refuses ${refused.length}.`,
    '',
    `Scripted (${scripted.length}):`,
    ...scripted.map((n) => `  ${n}`),
    '',
    `Refused, by reason (${refused.length}):`,
  ];
  for (const [reason, lines] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
    out.push('', `  ${reason} (${lines.length})`);
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
