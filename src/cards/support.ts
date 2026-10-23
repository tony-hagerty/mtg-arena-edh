// Is a card fully implemented? A card works if every ability it has is a keyword the engine
// knows, or it has a script. The card-pool test checks every pool card with this, and the
// deck paste screen uses it to refuse cards the engine can't play, or, by the player's
// choice, to play one without its rules text (`textlessRefusal`, `playsWithoutText`).
import { SUPPORTED_KEYWORDS, hasScript } from '../engine';
import { cardData, isCardName } from './db';
import type { DeckDef } from './db';
import { refusalOf } from './oracle';

/** Ability words and keyword actions: they label a rule that the card's script implements. */
export const ABILITY_WORDS = ['landfall', 'treasure', 'mill', 'threshold', 'metalcraft', 'recruit', "scions' secretary", 'delirium', 'surveil', 'imprint', 'channel', 'ferocious', 'bloodrush', 'populate', 'food', 'throw wide the gates', 'flare star', 'double', 'magecraft', 'role token', 'sell contraband', 'buy information', 'hire a mercenary', 'connive', 'medicus ministorum', 'monstrosity', 'madness', 'miracle', 'eminence'];

/**
 * Keywords the engine applies from a card's keyword list alone, with no script, and that
 * change nothing about how the card is cast or enters: a card with only these can be
 * played without its rules text (`textlessRefusal`). Every other supported keyword is spelt
 * out by the card's script (kicker, equip, crew, cycling ...) or changes how it is cast.
 */
export const PLAIN_KEYWORDS = ['flying', 'reach', 'deathtouch', 'lifelink', 'trample', 'vigilance', 'haste', 'first strike', 'double strike', 'menace', 'fear', 'defender', 'hexproof', 'indestructible', 'flash', 'shadow', 'landwalk', 'plainswalk', 'islandwalk', 'swampwalk', 'mountainwalk', 'forestwalk', 'changeling', 'devoid', 'partner'];

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

/** One reason the engine can't play a card. */
export interface CardProblem {
  /** `pool`: not in the card pool; `keyword`: a keyword the engine doesn't know; `text`: rules text the game can't read. */
  kind: 'pool' | 'keyword' | 'text';
  /** The reason as a phrase, after the card's name: `unsupported keyword "x"`, `the game can't read "..." yet`. */
  text: string;
  /** For `text`: the clause the Oracle text parser couldn't read, as it names it, and why. */
  clause?: string;
  reason?: string;
  /** For `text`: the line of the card's Oracle text the clause is in. */
  line?: string;
}

/** The line of `oracleText` that holds `clause`, reminder text left out; the whole text if none does. */
function lineOf(oracleText: string, clause: string): string {
  const lines = abilities(oracleText);
  const key = clause.toLowerCase();
  return lines.find((l) => l.toLowerCase().includes(key)) ?? lines.join(' ');
}

/**
 * Why the engine can't play card `name`, one problem each, or an empty list if it can: a
 * keyword it doesn't know, or rules text on a face with no script (712, 709). When the Oracle
 * text parser refused the card, the problem names the clause it couldn't read.
 */
export function problemsOf(name: string): CardProblem[] {
  if (!isCardName(name)) return [{ kind: 'pool', text: 'not in the card pool' }];
  const d = cardData(name);
  if (d.typeLine.startsWith('Basic Land')) return [];
  const out: CardProblem[] = [];
  for (const k of d.keywords.map((x) => x.toLowerCase())) {
    if (!SUPPORTED_KEYWORDS.includes(k) && !ABILITY_WORDS.includes(k)) out.push({ kind: 'keyword', text: `unsupported keyword "${k}"` });
  }
  for (const face of d.faces ?? [d]) {
    if (!abilities(face.oracleText).some((line) => !isKeywordLine(line)) || hasScript(face.name)) continue;
    // The parser refuses a card with faces as a whole, under its full name.
    const refused = refusalOf(face.name) ?? refusalOf(d.name);
    if (refused) out.push({ kind: 'text', text: `the game can't read "${refused.clause}" yet`, clause: refused.clause, reason: refused.reason, line: lineOf(face.oracleText, refused.clause) });
    else out.push({ kind: 'text', text: `${face.name} has rules text but no script`, reason: 'no script', line: abilities(face.oracleText).join(' ') });
  }
  return out;
}

/** `problemsOf` as phrases, one per problem, or an empty list if the engine can play the card. */
export const unsupported = (name: string): string[] => problemsOf(name).map((p) => p.text);

/**
 * Why card `name` can't be played without its rules text either, or null if it can: the
 * engine must be able to frame the card as a vanilla one, so it must have one face and no
 * keyword beyond `PLAIN_KEYWORDS` (one the engine knows only through a script, like equip,
 * or one that changes how the card is cast, like spree). A card with no problems at all is
 * played with its text and never needs this.
 */
export function textlessRefusal(name: string): string | null {
  if (!isCardName(name)) return 'not in the card pool';
  const d = cardData(name);
  if (d.faces) return 'a card with more than one face';
  const odd = d.keywords.map((k) => k.toLowerCase()).find((k) => !PLAIN_KEYWORDS.includes(k) && !ABILITY_WORDS.includes(k));
  return odd ? `its keyword "${odd}" changes how it is played` : null;
}

/**
 * Does this deck play card `name` without its rules text: it is listed in `deck.textless`,
 * isn't a commander (a commander's text is the deck), the game still can't read it, and it
 * can be framed as a vanilla card (`textlessRefusal`)? Once a newer game reads the card, it
 * plays with its text again.
 */
export const playsWithoutText = (deck: DeckDef, name: string) =>
  !!deck.textless?.includes(name) && !deck.commanders.includes(name) && isCardName(name) && problemsOf(name).length > 0 && textlessRefusal(name) === null;

/** `deck` with its `textless` list cut to the cards it plays without their text now (`playsWithoutText`), for the engine. */
export function playedDeck(deck: DeckDef): DeckDef {
  const textless = (deck.textless ?? []).filter((n) => playsWithoutText(deck, n));
  if (!deck.textless) return deck;
  return textless.length ? { ...deck, textless } : (({ textless: _, ...rest }) => rest)(deck);
}
