// Is a card fully implemented? A card works if every ability it has is a keyword the engine
// knows, or it has a script. The card-pool test checks every pool card with this, and the
// deck paste screen uses it to refuse cards the engine can't play.
import { SUPPORTED_KEYWORDS, hasScript } from '../engine';
import { cardData, isCardName } from './db';
import { refusalOf } from './oracle';

/** Ability words and keyword actions: they label a rule that the card's script implements. */
export const ABILITY_WORDS = ['landfall', 'treasure', 'mill', 'threshold', 'metalcraft', 'recruit', "scions' secretary", 'delirium', 'surveil', 'imprint', 'channel', 'ferocious', 'bloodrush', 'populate', 'food', 'throw wide the gates', 'flare star', 'double', 'magecraft', 'role token', 'sell contraband', 'buy information', 'hire a mercenary'];

/** Oracle text split into abilities, with reminder text removed. */
export const abilities = (text: string) =>
  text
    .replace(/\([^)]*\)/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** Is this line only keywords the engine knows ("Flying, vigilance")? */
const isKeywordLine = (line: string) =>
  line
    .toLowerCase()
    .split(',')
    .every((part) => SUPPORTED_KEYWORDS.includes(part.trim()));

/**
 * Why the engine can't play card `name`, one reason per problem, or an empty list if it
 * can: a keyword it doesn't know, or rules text on a face with no script (712, 709). When
 * the Oracle text parser refused the card, the reason names the clause it couldn't read.
 */
export function unsupported(name: string): string[] {
  if (!isCardName(name)) return ['not in the card pool'];
  const d = cardData(name);
  if (d.typeLine.startsWith('Basic Land')) return [];
  const out: string[] = [];
  for (const k of d.keywords.map((x) => x.toLowerCase())) {
    if (!SUPPORTED_KEYWORDS.includes(k) && !ABILITY_WORDS.includes(k)) out.push(`unsupported keyword "${k}"`);
  }
  for (const face of d.faces ?? [d]) {
    if (!abilities(face.oracleText).some((line) => !isKeywordLine(line)) || hasScript(face.name)) continue;
    const refused = refusalOf(face.name);
    out.push(refused ? `the game can't read "${refused.clause}" yet` : `${face.name} has rules text but no script`);
  }
  return out;
}
