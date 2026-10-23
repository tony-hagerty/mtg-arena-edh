// Scripts from Oracle text. A parser for common, regular wording: each ability is matched
// clause by clause against a list of templates, each a regular expression and the helper
// that builds what it does, and the script is built from the helpers in rules.ts. One
// clause it can't read refuses the whole card, naming the clause: it never guesses. Hand
// scripts always win; this is only for cards without one.
//
// The sections below follow a card's text: the words (numbers, keywords, ability words),
// objects and targets (115), tokens (111), amounts, conditions, effects, how an ability's
// effects run in order (with "you may" and choices made partway), costs and mana abilities,
// static and card lines, triggers, modal spells, and reading a whole card or each of its
// faces. To add a template, find the list for its kind of line, add the expression and its
// helper with the wording quoted and the rule cited, and add a `fake` card test, a game test
// and a near-miss test to tests/oracle.test.ts.
//
// Plain TypeScript with no Node-only parts, so it can run in the browser.
import { registerScripts, hasScript } from '../engine/registry';
import {
  addCounters,
  addEffect,
  addMana,
  ask,
  attachedBonus,
  battlefield,
  bounce,
  CANT_ATTACK,
  CANT_BE_BLOCKED,
  CANT_BLOCK,
  counter,
  counterCount,
  copySpell,
  createToken,
  createTokens,
  creaturesOf,
  crew,
  cycling,
  damageCard,
  damagePlayer,
  dealDamage,
  destroyMany,
  devotion,
  dieMany,
  discard,
  discardAtRandom,
  discardHand,
  draw,
  enterBattlefield,
  equip,
  exileAll,
  extort,
  extraTurn,
  fight,
  finishEnter,
  gainLife,
  has,
  hasType,
  isColor,
  isCreature,
  isLand,
  isPermanentCard,
  isPlaneswalker,
  jobSelect,
  landColors,
  living,
  log,
  loseLife,
  manaValue,
  mill,
  MUST_ATTACK,
  moveCard,
  nameCard,
  opponentsOf,
  permanent,
  pickCards,
  populate,
  proliferate,
  proliferated,
  counterKinds,
  moveCounter,
  protectionFrom,
  prowess,
  pump,
  putOnTop,
  refCard,
  refGraveyard,
  refPlayer,
  refStack,
  says,
  search,
  shuffle,
  simultaneously,
  stats,
  tap,
  their,
  timesResolved,
  turnOrder,
  typecycling,
  untap,
  amass,
  partnerWith,
  temptWithRing,
  timesTempted,
  isRingBearer,
  tokenCopy,
  SUPPORTED_KEYWORDS,
} from '../engine/rules';
import type {
  Action,
  ActivatedAbility,
  Card,
  CardData,
  CardScript,
  Choice,
  Color,
  Ctx,
  Find,
  Game,
  LayerParts,
  ManaAbility,
  ManaSym,
  Mode,
  PlayerId,
  StackItem,
  StaticBonus,
  TargetRef,
  TargetSpec,
  ThenCtx,
  Trigger,
  TriggerHook,
} from '../engine/types';
import { ALL_CARD_NAMES, CREATURE_TYPES, SUBTYPES, cardData, registerToken } from './db';
import lists from './decklists.json';

/**
 * The parser's answer for one card: a script, or the clause it couldn't read and why. A card
 * with faces has one script for each face, by the face's name (`faces`), as hand scripts do.
 */
export type Parsed = { ok: true; script: CardScript; faces?: Record<string, CardScript> } | { ok: false; clause: string; reason: string };

class Refusal extends Error {
  constructor(
    readonly clause: string,
    reason: string,
  ) {
    super(reason);
  }
}
const refuse = (clause: string, reason: string): never => {
  throw new Refusal(clause, reason);
};

type Then = NonNullable<CardScript['then']>;
type Bots = NonNullable<CardScript['botChoice']>;
type Test = (g: Game, c: Card, source: Card, x: number) => boolean;

// ---------- words ----------

/**
 * Keywords a line may consist of without a script: the ones the engine enforces by itself
 * (702), plus partner, which only the deck rules read (702.124).
 */
const BARE_KEYWORDS = [
  'flying', 'reach', 'deathtouch', 'lifelink', 'trample', 'vigilance', 'haste', 'first strike', 'double strike', 'menace', 'defender', 'hexproof', 'indestructible', 'flash', 'partner',
  // Fear (702.36), shadow (702.28) and landwalk (702.14) are checked as blockers are declared,
  // changeling (702.73) and devoid (702.114) by the layer system, convoke (702.51) and storm
  // (702.40) as the spell is cast, from the card's keywords.
  'fear', 'shadow', 'plainswalk', 'islandwalk', 'swampwalk', 'mountainwalk', 'forestwalk', 'changeling', 'devoid', 'convoke', 'storm',
];

/** Keywords an effect may give a creature: the ones `StaticBonus.keywords` carries and the engine checks. */
const GRANTABLE = [...BARE_KEYWORDS.filter((k) => !['partner', 'flash', 'changeling', 'devoid', 'convoke', 'storm'].includes(k)), 'shroud'];

/** "Flying", "haste and shroud", "protection from black", "can't be blocked": keywords and restrictions to give. */
function keywordList(text: string): string[] | null {
  const out: string[] = [];
  let afterProtection = false;
  for (const k of text.replace(/,? and (?=protection|[a-z])/g, ', ').split(', ')) {
    // "Protection from white and from black" is two protection abilities (702.16g).
    const prot: RegExpExecArray | null = /^protection from (white|blue|black|red|green)$/.exec(k) ?? (afterProtection ? /^from (white|blue|black|red|green)$/.exec(k) : null);
    afterProtection = !!prot;
    if (prot) out.push(protectionFrom(COLOR_WORDS[prot[1]]));
    else if (k === "can't be blocked") out.push(CANT_BE_BLOCKED);
    else if (GRANTABLE.includes(k)) out.push(k);
    else return null;
  }
  return out;
}

const NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const NUM = '(\\d+|x|a|an|one|two|three|four|five|six|seven|eight|nine|ten)';
const COLOR_WORDS: Record<string, Color> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const capital = (w: string) => w[0].toUpperCase() + w.slice(1);
/** "Equipment", "Time Lord": a subtype's proper name from its lower-case words. */
const properName = (w: string) => w.split(/([ -])/).map((p) => (/^[a-z]/.test(p) ? capital(p) : p)).join('');

/**
 * Ability words (207.2c) and flavor words (207.2d): a label with no rules meaning, taken off
 * the front of a line ("Landfall — Whenever a land you control enters, ...").
 */
const ABILITY_WORDS = [
  'adamant', 'addendum', 'alliance', 'battalion', 'bloodrush', 'celebration', 'channel', 'chroma', 'cohort', 'constellation', 'converge', "council's dilemma", 'coven', 'delirium',
  'descend 4', 'descend 8', 'disappear', 'domain', 'eerie', 'eminence', 'enrage', 'fateful hour', 'fathomless descent', 'ferocious', 'flurry', 'formidable', 'grandeur', 'hellbent',
  'heroic', 'imprint', 'infusion', 'inspired', 'join forces', 'kinship', 'landfall', 'lieutenant', 'magecraft', 'metalcraft', 'morbid', 'opus', 'pack tactics', 'paradox', 'parley',
  'radiance', 'raid', 'rally', 'renew', 'repartee', 'revolt', 'secret council', 'spell mastery', 'strive', 'survival', 'sweep', 'tempting offer', 'threshold', 'undergrowth', 'valiant',
  'vivid', 'void', 'will of the council',
];
/**
 * Keywords with rules meaning that are written "[Keyword] — [ability]", so they aren't labels to
 * take off: forecast (702.57a), boast (702.142a), visit (702.159a), solved and "to solve"
 * (702.169a, 719.2), exhaust (702.177a), max speed (702.178a) and power-up (702.193a).
 */
export const LABEL_KEYWORDS = ['forecast', 'boast', 'visit', 'solved', 'to solve', 'exhaust', 'max speed', 'power-up'];

/**
 * Is `word` (lower case) only a label at the front of one of the card's lines, an ability word
 * (207.2c) or a flavor word (207.2d)? The rules list every ability word; flavor words aren't
 * listed (207.2d), but Scryfall lists them among the card's keywords ("Master Tactician —").
 */
export function isLabelWord(word: string, keywords: string[]): boolean {
  if (LABEL_KEYWORDS.includes(word) || SUPPORTED_KEYWORDS.includes(word)) return false;
  return ABILITY_WORDS.includes(word) || keywords.some((k) => k.toLowerCase() === word);
}

/** A line with its ability word or flavor word taken off ("Three Autostubs — Whenever ..." reads "Whenever ..."). */
const stripAbilityWord = (line: string, keywords: string[] = []) => {
  const m = /^([a-z' ,0-9-]+) — (.+)$/.exec(line);
  return m && isLabelWord(m[1], keywords) ? m[2] : line;
};

/** Every subtype by its lower-case name, singular and plural ("dragon", "dragons", "elves"). */
let subtypeWords: Map<string, string> | null = null;
function subtypeOf(word: string): string | null {
  if (!subtypeWords) {
    subtypeWords = new Map();
    for (const t of new Set(Object.values(SUBTYPES).flat())) {
      const w = t.toLowerCase();
      subtypeWords.set(w, t);
      const plural = /(?:[^aeiou]y)$/.test(w) ? `${w.slice(0, -1)}ies` : /(?:elf|olf|arf)$/.test(w) ? `${w.slice(0, -1)}ves` : /(?:s|x|ch|sh)$/.test(w) ? `${w}es` : `${w}s`;
      if (!subtypeWords.has(plural)) subtypeWords.set(plural, t);
    }
  }
  return subtypeWords.get(word) ?? null;
}

// ---------- what an ability's effects share ----------

/**
 * What one run of an ability remembers from clause to clause, kept with any choice it waits
 * on: X, what the triggering event was ("that player", "that much"), the object the last
 * effect acted on as it was just before ("its controller", "its power", 608.2h), and the life
 * lost and damage dealt so far ("you gain life equal to the life lost this way").
 */
interface Memo {
  x: number;
  /** Where this ability's targets start in its stack object's: a mode's share of a modal spell's (700.2). */
  base: number;
  /** The event's object as it was then (603.10a): "that creature", "it deals damage". */
  ev: { player: PlayerId | null; amount: number; id: string | null; card?: Card };
  last: Last | null;
  lost: number;
  dealt: number;
  /** The permanents the last group effect acted on: "tap those creatures" (608.2c). */
  group?: string[];
  /** The power of the creature sacrificed to cast it or activate it, as it last was (608.2h). */
  sacPower?: number;
  /** "Unless [player] pays": whether they paid (118.12a). */
  paid?: boolean;
}
interface Last {
  id: string;
  controller: PlayerId;
  owner: PlayerId;
  power: number;
  toughness: number;
  mv: number;
}
type Num = (g: Game, ctx: Ctx, m: Memo) => number;

/** What a clause is read in. */
interface Env {
  /** A permanent's ability, where "it" can mean the permanent, or a spell. */
  permanent: boolean;
  /** "X": the ability's own (107.3a, 107.3k), a spell's (cast with X), or "where X is ...". */
  x: Num | null;
  /** The trigger's event names a player ("that player", "they") or an amount ("that much"), or an object ("that creature"). */
  ev?: { player?: boolean; amount?: boolean; object?: boolean };
  /** The card's type line, for "this Aura", "equipped creature" and so on. */
  typeLine: string;
}

/** What earlier clauses of the sentence said: the subject carried on, and what "it" means. */
interface State {
  who: Subject | null;
  /** The last object acted on: a card, a spell, or none. "It" and "its controller" refer to it. */
  last: 'card' | 'spell' | 'group' | null;
  /** That object was the ability's last target, so "it" is the same target. */
  lastTarget: boolean;
  /** The last clause destroyed something ("They can't be regenerated"). */
  destroyed?: boolean;
}

// ---------- objects and targets (109, 115) ----------

/** A permanent noun, singular and plural: the card type it asks for, or none for "permanent". */
const NOUNS: Record<string, { type: string; plural: boolean }> = {};
for (const t of ['creature', 'artifact', 'enchantment', 'land', 'planeswalker', 'battle', 'permanent']) {
  NOUNS[t] = { type: t === 'permanent' ? '' : capital(t), plural: false };
  NOUNS[`${t}s`] = { type: t === 'permanent' ? '' : capital(t), plural: true };
}

/**
 * A word in front of a noun, as a test: a colour or "non[colour]", a card type or supertype
 * or "non[type]", a subtype or "non-[subtype]" (205), "token", "tapped", "attacking" and so on.
 */
function modifier(word: string): Test | null {
  if (word === 'attacking-or-blocking') return (g, c) => (g.combat?.attacks ?? []).some((a) => a.id === c.id || a.blockers.includes(c.id));
  if (word === 'attacking') return (g, c) => (g.combat?.attacks ?? []).some((a) => a.id === c.id);
  if (word === 'blocking') return (g, c) => (g.combat?.attacks ?? []).some((a) => a.blockers.includes(c.id));
  if (word === 'tapped') return (_g, c) => c.tapped;
  if (word === 'untapped') return (_g, c) => !c.tapped;
  if (word === 'token') return (_g, c) => !!c.isToken;
  if (word === 'nontoken') return (_g, c) => !c.isToken;
  if (word === 'colorless') return (g, c) => !Object.values(COLOR_WORDS).some((x) => isColor(g, c, x));
  if (word === 'multicolored') return (g, c) => Object.values(COLOR_WORDS).filter((x) => isColor(g, c, x)).length > 1;
  const not = /^non-?/.exec(word);
  const base = not ? word.slice(not[0].length) : word;
  let test: Test | null = null;
  if (base in COLOR_WORDS) test = (g, c) => isColor(g, c, COLOR_WORDS[base]);
  else if (['basic', 'legendary', 'snow', 'land', 'artifact', 'creature', 'enchantment', 'planeswalker', 'instant', 'sorcery', 'battle'].includes(base)) test = (g, c) => hasType(g, c, capital(base));
  else if (subtypeOf(base) && !NOUNS[base]) {
    const sub = subtypeOf(base)!;
    test = (g, c) => hasType(g, c, sub);
  }
  if (!test) return null;
  return not ? (g, c, s, x) => !test!(g, c, s, x) : test;
}

/** What an object phrase names: permanents, spells or cards in graveyards, which ones, and whose. */
interface Obj {
  zone: 'battlefield' | 'stack' | 'graveyard';
  /** For permanents: what kind, as a target spec's `type` names it. */
  type: 'creature' | 'permanent' | 'creature or planeswalker';
  test: Test;
  /** For spells and abilities: which kinds of stack object. */
  stack?: 'spell' | 'ability' | 'spell or ability';
  who?: 'you' | 'opponent';
  plural: boolean;
}

/** "With flying", "with power 4 or greater", "you control": what a phrase may end with. */
const SUFFIXES: [RegExp, (m: RegExpExecArray, o: { tests: Test[]; who?: 'you' | 'opponent'; zone?: 'graveyard'; x: Num | null }) => boolean][] = [
  [/ you control$/, (_m, o) => !o.who && !!(o.who = 'you')],
  [/ (?:you don't control|an opponent controls|your opponents control|opponents control)$/, (_m, o) => !o.who && !!(o.who = 'opponent')],
  [/ (?:from|in) your graveyard$/, (_m, o) => !o.who && !!((o.who = 'you'), (o.zone = 'graveyard'))],
  [/ (?:from|in) an opponent's graveyard$/, (_m, o) => !o.who && !!((o.who = 'opponent'), (o.zone = 'graveyard'))],
  [/ (?:from|in) a graveyard$/, (_m, o) => !!(o.zone = 'graveyard')],
  [/ with (flying|reach|deathtouch|lifelink|trample|vigilance|haste|defender|menace|first strike|double strike|hexproof|indestructible)$/, (m, o) => !!o.tests.push((g, c) => has(g, c, m[1]))],
  [/ without (flying|reach|defender)$/, (m, o) => !!o.tests.push((g, c) => !has(g, c, m[1]))],
  [
    / with (power|toughness) (\d+) or (greater|less)$/,
    (m, o) => {
      const n = parseInt(m[2], 10);
      const key = m[1] as 'power' | 'toughness';
      return !!o.tests.push((g, c) => (m[3] === 'greater' ? stats(g, c)[key] >= n : stats(g, c)[key] <= n));
    },
  ],
  [
    / with mana value (\d+|x)(?: or (greater|less))?$/,
    (m, o) => {
      if (m[1] === 'x' && !o.x) return false;
      const n = m[1] === 'x' ? null : parseInt(m[1], 10);
      // An activated ability's X is the filter's `x` (107.3a); a spell's is its own (202.3e).
      return !!o.tests.push((_g, c, source, x) => {
        const v = n ?? (x || source.cast?.x || 0);
        const mv = manaValue(c);
        return m[2] === 'greater' ? mv >= v : m[2] === 'less' ? mv <= v : mv === v;
      });
    },
  ],
  [/ with a \+1\/\+1 counter on (?:it|them)$/, (_m, o) => !!o.tests.push((_g, c) => counterCount(c) > 0)],
];

/** The kinds of card a spell or card phrase may name: "instant or sorcery", "noncreature", "permanent". */
const CARD_TYPE_WORDS = ['creature', 'artifact', 'enchantment', 'land', 'planeswalker', 'instant', 'sorcery', 'battle', 'legendary'];

/** A list of alternatives: "artifact, creature, or planeswalker", "artifacts and enchantments". */
const LIST = /,? (?:and\/or|or|and) |, /;

/**
 * Reads an object phrase: "creature", "nonland permanent an opponent controls", "attacking or
 * blocking creature", "artifact, enchantment, or nonbasic land", "instant or sorcery spell",
 * "creature card from your graveyard", "creatures with power 4 or greater". `number` says
 * whether one object ("target creature") or several ("all creatures") is meant. Null if it
 * isn't one the parser knows.
 */
function object(phrase: string, number: 'one' | 'many' | 'either', x: Num | null): Obj | null {
  const o: { tests: Test[]; who?: 'you' | 'opponent'; zone?: 'graveyard'; x: Num | null } = { tests: [], x };
  let p = phrase;
  for (let again = true; again; ) {
    again = false;
    for (const [re, add] of SUFFIXES) {
      const m = re.exec(p);
      if (!m) continue;
      if (!add(m, o)) return null;
      p = p.slice(0, m.index);
      again = true;
      break;
    }
  }
  let other = false;
  if (/^(?:other|another) /.test(p)) {
    other = true;
    p = p.replace(/^(?:other|another) /, '');
  }
  p = p.replace(/\battacking or blocking\b/g, 'attacking-or-blocking');
  // Spells on the stack, and abilities.
  const spell = /^(?:(.+) )?(spells?|abilit(?:y|ies))$/.exec(p);
  const card = /^(?:(.+) )?(cards?)$/.exec(p);
  const plural = (w: string) => /s$|ies$/.test(w);
  const wantPlural = (w: string) => (number === 'one' && plural(w)) || (number === 'many' && !plural(w));
  const all: Test[] = [...o.tests, ...(other ? [(_g: Game, c: Card, s: Card) => c.id !== s.id] : [])];
  if (spell || (card && o.zone === 'graveyard')) {
    const m = (spell ?? card)!;
    if (wantPlural(m[2])) return null;
    if (card && o.who === undefined && o.zone !== 'graveyard') return null;
    let stack: Obj['stack'] = 'spell';
    let head = m[1] ?? '';
    if (spell && /^abilit/.test(m[2])) {
      if (head !== 'activated or triggered' && head !== '') return null;
      stack = 'ability';
      head = '';
    } else if (spell && /^(.*?) ?spell or$/.test(head)) return null;
    if (spell && head === '' && /^spell or abilit/.test(p)) stack = 'spell or ability';
    const alts = head ? head.split(LIST) : [];
    const altTests: Test[] = [];
    for (const alt of alts) {
      const words = alt.split(/,? /);
      const tests: Test[] = [];
      for (const w of words) {
        if (w === 'permanent') tests.push((g, c) => isPermanentCard(g, c));
        else if (CARD_TYPE_WORDS.includes(w)) tests.push((g, c) => hasType(g, c, capital(w)));
        else {
          const mod = modifier(w);
          if (!mod) return null;
          tests.push(mod);
        }
      }
      altTests.push((g, c, s, xx) => tests.every((t) => t(g, c, s, xx)));
    }
    if (altTests.length) all.push((g, c, s, xx) => altTests.some((t) => t(g, c, s, xx)));
    return {
      zone: spell ? 'stack' : 'graveyard',
      type: 'permanent',
      stack: spell ? stack : undefined,
      who: o.who,
      plural: plural((spell ?? card)![2]),
      test: (g, c, s, xx) => all.every((t) => t(g, c, s, xx)),
    };
  }
  if (o.zone === 'graveyard') return null;
  // Permanents: one noun, or a list of them, each with its own words in front.
  const alts = / (?:and\/or|or|and) /.test(p) ? p.split(LIST) : [p];
  const nouns: string[] = [];
  const altTests: Test[] = [];
  let isPlural: boolean | null = null;
  for (const alt of alts) {
    const words = alt.split(/,? /);
    const noun = words[words.length - 1];
    const known = NOUNS[noun];
    const sub = known ? null : subtypeOf(noun);
    if (!known && !sub) return null;
    const pl = known ? known.plural : plural(noun) && noun !== sub!.toLowerCase();
    if (isPlural !== null && pl !== isPlural && alts.length > 1 && !/,? and /.test(p)) return null;
    isPlural = pl;
    const mods = words.slice(0, -1).map(modifier);
    if (mods.some((t) => !t)) return null;
    const type = known ? known.type : sub!;
    nouns.push(known ? (known.type || 'Permanent') : 'Sub');
    const tests = [...(type ? [(g: Game, c: Card) => hasType(g, c, type)] : []), ...(mods as Test[])];
    altTests.push((g, c, s, xx) => tests.every((t) => t(g, c, s, xx)));
  }
  if (number !== 'either' && (number === 'many') !== isPlural) return null;
  const onlyCreatures = nouns.every((n) => n === 'Creature');
  const type: Obj['type'] = onlyCreatures ? 'creature' : nouns.length === 2 && nouns.includes('Creature') && nouns.includes('Planeswalker') && alts.every((a) => !a.includes(' ')) ? 'creature or planeswalker' : 'permanent';
  if (!(type === 'creature or planeswalker')) all.push((g, c, s, xx) => altTests.some((t) => t(g, c, s, xx)));
  return { zone: 'battlefield', type, who: o.who, plural: !!isPlural, test: (g, c, s, xx) => all.every((t) => t(g, c, s, xx)) };
}

/** A target spec for an object phrase. */
function specFor(o: Obj, label: string, extra: Partial<TargetSpec> = {}): TargetSpec {
  const who = o.who ? { who: o.who } : {};
  if (o.zone === 'stack') return { type: o.stack!, label, ...who, filter: o.test, ...extra };
  if (o.zone === 'graveyard') return { type: 'graveyard card', label, ...who, filter: o.test, ...extra };
  return { type: o.type, label, ...who, filter: o.test, ...extra };
}

/**
 * Reads a target phrase into its target specs (115.1): "any target", "target player",
 * "target nonblack creature an opponent controls", "up to two target creatures", "another
 * target creature you control", "any number of target creatures" (115.1d), "target spell",
 * "target creature card from your graveyard". Null if it isn't one.
 */
function targetPhrase(phrase: string, x: Num | null): TargetSpec[] | null {
  const label = phrase;
  if (phrase === 'any target') return [{ type: 'any', label }];
  if (phrase === 'target player') return [{ type: 'player', label }];
  if (phrase === 'target opponent') return [{ type: 'player', who: 'opponent', label }];
  if (phrase === 'target player or planeswalker') return [{ type: 'player or planeswalker', label }];
  if (phrase === 'target opponent or planeswalker') return [{ type: 'player or planeswalker', who: 'opponent', label }];
  if (phrase === 'two target players') return [{ type: 'player', label }, { type: 'player', label, distinctFrom: 0 }];
  if (phrase === 'target spell or nonland permanent' || /^target spell or nonland permanent (an opponent controls|you don't control)$/.test(phrase)) {
    const who = / (an opponent controls|you don't control)$/.test(phrase) ? { who: 'opponent' as const } : {};
    return [{ type: 'spell or permanent', label, ...who, filter: (g, c) => c.zone === 'stack' || !isLand(g, c) }];
  }
  const m = /^(up to (one|two|three|four|five) |any number of |one or two |two |three |four |five )?(another |other )?target (.+)$/.exec(phrase);
  if (!m) return null;
  const count = m[1]?.trim();
  const many = !!count && count !== 'up to one';
  // "Another target creature", "up to two other target creatures": not this object (115.1, 109.1).
  const o = object(`${m[3] ? 'other ' : ''}${m[4]}`, many ? 'many' : 'one', x);
  if (!o) return null;
  const one = specFor(o, label);
  if (!count) return [one];
  if (count === 'up to one') return [{ ...one, optional: true }];
  // Different objects (115.3): the second can't be the first.
  if (count === 'up to two') return [{ ...one, optional: true }, { ...one, optional: true, distinctFrom: 0 }];
  if (count === 'one or two') return [one, { ...one, optional: true, distinctFrom: 0 }];
  if (count === 'two') return [one, { ...one, distinctFrom: 0 }];
  if (count === 'any number of') return [{ ...one, any: true }];
  // Three or more can't all be kept apart: the engine's `distinctFrom` names one other target.
  return refuse(phrase, 'three or more targets that must all be different');
}

/** The permanents a group phrase names as an effect starts: "all creatures", "each creature you don't control". */
type Group = (g: Game, ctx: Ctx) => Card[];

function groupPhrase(phrase: string, x: Num | null): Group | null {
  const m =
    /^(?:each|all) (.+)$/.exec(phrase) ??
    /^((?:other )?(?:[a-z-]+,? )*?(?:creatures|permanents|artifacts|lands|enchantments|planeswalkers|[a-z]+s) (?:you control|your opponents control|you don't control))$/.exec(phrase) ??
    // "Attacking creatures", "tapped creatures": at least one word in front of the noun.
    /^((?:[a-z-]+ )+creatures)$/.exec(phrase);
  if (!m) return null;
  const o = object(m[1], phrase.startsWith('each ') ? 'one' : 'many', x);
  if (!o || o.zone !== 'battlefield') return null;
  return groupOf(o);
}

function groupOf(o: Obj): Group {
  return (g, ctx) =>
    battlefield(g).filter((c) => {
      if (o.who === 'you' && c.controller !== ctx.you) return false;
      if (o.who === 'opponent' && (c.controller === ctx.you || g.players[c.controller].lost)) return false;
      if (o.type === 'creature' && !isCreature(g, c)) return false;
      if (o.type === 'creature or planeswalker' && !isCreature(g, c) && !isPlaneswalker(g, c)) return false;
      return o.test(g, c, ctx.self, ctx.x ?? 0);
    });
}

// ---------- tokens (111) ----------

interface TokenDef {
  name: string;
  power?: string;
  toughness?: string;
  colors: string[];
  typeLine: string;
  oracleText?: string;
  keywords: string[];
}

const colorText = (colors: string[]) => {
  const names = colors.map((c) => Object.keys(COLOR_WORDS).find((w) => COLOR_WORDS[w] === c)!);
  return names.length ? names.join(' and ') : 'colorless';
};

/** Each listed token as Oracle text words it: "1/1 white soldier creature", "treasure". */
let tokenWords: Map<string, string> | null = null;
function tokenKey(desc: string): string | null {
  if (!tokenWords) {
    tokenWords = new Map();
    for (const [key, t] of Object.entries(lists.tokens as Record<string, TokenDef>)) {
      if (t.typeLine.startsWith('Legendary')) continue;
      const types = t.typeLine.replace('Token ', '').split(' — ');
      const quoted = t.oracleText && !t.keywords.length ? ` with "${t.oracleText.replace(/^This token/, 'this token')}"` : '';
      const words = t.power
        ? `${t.power}/${t.toughness} ${colorText(t.colors)} ${types[1]} ${types[0]}${t.keywords.length ? ` with ${t.keywords.join(' and ')}` : quoted}`
        : t.name;
      if (!tokenWords.has(words.toLowerCase())) tokenWords.set(words.toLowerCase(), key);
    }
  }
  return tokenWords.get(desc) ?? null;
}

/**
 * A creature token the text describes (111.4): "2/2 black Zombie creature", "1/1 colorless
 * Thopter artifact creature with flying", "0/1 colorless Eldrazi Spawn creature with
 * "Sacrifice this token: Add {C}."" Its name is its creature types (111.4). The listed token
 * with the same words wins, so its art shows; otherwise it is registered under a key like
 * the listed ones ("Zombie 2/2 B"). A quoted ability must be one the parser reads itself.
 */
function tokenFor(desc: string, clause: string): string {
  const listed = tokenKey(desc);
  if (listed) return listed;
  const m = /^(\d+)\/(\d+) ((?:white|blue|black|red|green|colorless)(?:(?:,|,? and) (?:white|blue|black|red|green))*) ((?:[a-z-]+ )+?)(artifact )?(enchantment )?creature(?: with (.+))?$/.exec(desc);
  if (!m) return refuse(clause, `no token the parser can make is "${desc}"`);
  const colors = m[3] === 'colorless' ? [] : m[3].split(/,? and |, /).map((w) => COLOR_WORDS[w]);
  const subtypes = m[4].trim().split(' ').map(properName);
  // Its subtypes go with its card types (205.3d): creature types, and artifact or enchantment types if it is one ("a 1/1 colorless Shrine enchantment creature token").
  const allowed = [...CREATURE_TYPES, ...(m[5] ? SUBTYPES.Artifact : []), ...(m[6] ? SUBTYPES.Enchantment : [])];
  if (subtypes.some((t) => !allowed.includes(t))) return refuse(clause, `"${m[4].trim()}" isn't a creature type`);
  let keywords: string[] = [];
  let ability = '';
  if (m[7]) {
    const quoted = /^"(.+)"$/.exec(m[7]);
    if (quoted) ability = quoted[1];
    else {
      const k = keywordList(m[7]);
      if (!k || k.some((x) => !BARE_KEYWORDS.includes(x))) return refuse(clause, `a token with "${m[7]}"`);
      keywords = k;
    }
  }
  const name = subtypes.join(' ');
  const types = `Token ${m[5] ? 'Artifact ' : ''}${m[6] ? 'Enchantment ' : ''}Creature — ${name}`;
  const key = `${name} ${m[1]}/${m[2]}${keywords.length ? ` ${keywords.join(' ')}` : ''}${ability ? ` "${ability}"` : ''} ${colors.join('') || 'C'}${m[5] ? ' artifact' : ''}${m[6] ? ' enchantment' : ''}`;
  const text = ability ? capital(ability.replace(/\bthis token\b/g, 'This token').replace(/^this token/, 'This token')) : keywords.map(capital).join(', ');
  const data: CardData = {
    name,
    manaCost: '',
    cmc: 0,
    colors: colors as Color[],
    colorIdentity: colors as Color[],
    typeLine: types,
    oracleText: text,
    power: m[1],
    toughness: m[2],
    keywords: keywords.map(capital),
    image: '',
    art: '',
  };
  if (ability) {
    // "It has '...'": the token's own ability, read like any card's (111.4).
    const p = parseCard({ ...data, name: key, oracleText: ability.replace(/\bthis token\b/gi, key) });
    if (!p.ok) return refuse(clause, `a token with "${ability}" (${p.reason})`);
    registerToken(key, data);
    if (!hasScript(key)) registerScripts({ [key]: p.script });
  } else registerToken(key, data);
  return key;
}

/** "a 1/1 white Soldier creature token, a Treasure token, and two Food tokens": each kind of token and how many. */
function tokenList(text: string, x: Num | null, clause: string): { key: string; n: Num }[] {
  // "Karox Bladewing, a legendary 4/4 red Dragon creature token with flying": a listed legendary token by its name.
  const named = /^([a-z' -]+), a legendary .+ token(?: with .+)?$/.exec(text);
  if (named) {
    const key = Object.entries(lists.tokens as Record<string, TokenDef>).find(([, t]) => t.typeLine.startsWith('Legendary') && t.name.toLowerCase() === named[1])?.[0];
    if (!key) return refuse(clause, `no listed token is "${named[1]}"`);
    return [{ key, n: () => 1 }];
  }
  const parts = text.split(/,? and (?=(?:a|an|one|two|three|four|five|x|\d+) )|, (?=(?:a|an|one|two|three|four|five|x|\d+) )/);
  return parts.map((part) => {
    const m = new RegExp(`^${NUM} (.+?) tokens?( with .+)?$`).exec(part) ?? new RegExp(`^${NUM} (.+?) tokens?$`).exec(part);
    if (!m) return refuse(clause, `"${part}" isn't a token`);
    return { key: tokenFor(m[2] + (m[3] ?? ''), clause), n: count(m[1], x, clause) };
  });
}

// ---------- amounts ----------

/** "3", "three", "a"; "X" where the ability or spell has an X. */
function count(word: string, x: Num | null, clause: string): Num {
  if (/^\d+$/.test(word)) {
    const n = parseInt(word, 10);
    return () => n;
  }
  if (word in NUMBERS) return () => NUMBERS[word];
  if (word === 'x' && x) return x;
  return refuse(clause, word === 'x' ? 'X outside a cost' : `"${word}" isn't a number`);
}

/** What a "for each" or "the number of" counts: permanents ("creature you control"), cards in a zone, or opponents. */
function counted(phrase: string, x: Num | null): Num | null {
  if (/^opponents? you have$/.test(phrase)) return (g, ctx) => opponentsOf(g, ctx.you).length;
  // "For each +1/+1 counter on this creature" (Animar): on the permanent while it is on the battlefield (122.1).
  const kind = /^([+-]1\/[+-]1|[a-z]+) counter on ~$/.exec(phrase);
  if (kind) {
    return (g, ctx) => {
      const c = permanent(g, ctx.self.id);
      return c && c.moves === ctx.self.moves ? counterCount(c, kind[1]) : 0;
    };
  }
  let m = /^cards? in your (hand|graveyard)$/.exec(phrase);
  if (m) {
    const zone = m[1] as 'hand' | 'graveyard';
    return (g, ctx) => g.players[ctx.you][zone].length;
  }
  m = /^(.+) cards? in your graveyard$/.exec(phrase);
  if (m) {
    const o = object(`${m[1]} card in your graveyard`, 'one', x) ?? object(`${m[1]} cards in your graveyard`, 'many', x);
    if (!o) return null;
    return (g, ctx) => g.players[ctx.you].graveyard.filter((c) => o.test(g, c, ctx.self, 0)).length;
  }
  const onField = /^(.+) on the battlefield$/.exec(phrase);
  const o = object(onField ? onField[1] : phrase, 'either', x);
  if (!o || o.zone !== 'battlefield' || (!o.who && !onField)) return null;
  const group = groupOf(o);
  return (g, ctx) => group(g, ctx).length;
}

/**
 * An amount in words: a number, "that much" (the triggering event's), "the life lost this
 * way", "its power" (the object the last effect acted on, as it last was: 608.2h), "the
 * number of creatures you control", "your devotion to black" (700.5).
 */
function amountPhrase(phrase: string, env: Env, st: State, clause: string): Num {
  if (new RegExp(`^${NUM}$`).test(phrase)) return count(phrase, env.x, clause);
  if (phrase === 'that much' && env.ev?.amount) return (_g, _c, m) => m.ev.amount;
  if (phrase === 'the life lost this way') return (_g, _c, m) => m.lost;
  if (phrase === 'the damage dealt this way') return (_g, _c, m) => m.dealt;
  let m = /^(?:its|that creature's|that spell's) (power|toughness|mana value)$/.exec(phrase);
  if (m && st.last) {
    // As it is now if it is still on the battlefield, or as it last was (608.2h).
    const key = m[1] === 'mana value' ? 'mv' : (m[1] as 'power' | 'toughness');
    return (g, _c, memo) => {
      const c = key !== 'mv' && memo.last ? permanent(g, memo.last.id) : undefined;
      return c ? stats(g, c)[key as 'power' | 'toughness'] : (memo.last?.[key] ?? 0);
    };
  }
  // "That creature's toughness" in a trigger about another creature: as it was as the event happened (603.10a).
  m = /^that creature's (power|toughness)$/.exec(phrase);
  if (m && env.ev?.object) {
    const key = m[1] as 'power' | 'toughness';
    return (g, _c, memo) => {
      const c = memo.ev.id ? permanent(g, memo.ev.id) : undefined;
      return c ? stats(g, c)[key] : memo.ev.card ? (parseInt(cardData(memo.ev.card.name)[key] ?? '0', 10) || 0) : 0;
    };
  }
  m = /^(?:that card's|that permanent's) mana value$/.exec(phrase);
  if (m && st.last) return (_g, _c, memo) => memo.last?.mv ?? 0;
  if (phrase === "the sacrificed creature's power") return (_g, _c, memo) => memo.sacPower ?? 0;
  m = /^the total power of (.+)$/.exec(phrase);
  const total = m && groupPhrase(m[1], env.x);
  if (total) return (g, ctx) => total(g, ctx).reduce((n, c) => n + Math.max(0, stats(g, c).power), 0);
  m = /^~'s (power|toughness)$/.exec(phrase);
  if (m && env.permanent) {
    const key = m[1] as 'power' | 'toughness';
    return (g, ctx) => {
      const c = permanent(g, ctx.self.id);
      return c ? stats(g, c)[key] : 0;
    };
  }
  m = /^your devotion to (white|blue|black|red|green)$/.exec(phrase);
  if (m) {
    const color = COLOR_WORDS[m[1]];
    return (g, ctx) => devotion(g, ctx.you, color);
  }
  m = /^the number of (.+)$/.exec(phrase);
  const n = m && counted(m[1], env.x);
  if (n) return n;
  m = /^the greatest power among (.+)$/.exec(phrase);
  const group = m && groupPhrase(m[1], env.x);
  if (group) return (g, ctx) => Math.max(0, ...group(g, ctx).map((c) => stats(g, c).power));
  return refuse(clause, `the amount "${phrase}"`);
}

// ---------- conditions ----------

/** A condition as it stands now, from `you`'s side: an intervening "if" (603.4), "activate only if" (602.5b), "as long as". */
type Cond = (g: Game, self: Card, you: PlayerId) => boolean;

const CONDITIONS: [RegExp, (m: RegExpExecArray) => Cond | null][] = [
  [
    /^you control an? ([a-z]+) or an? ([a-z]+)$/,
    (m) => {
      const types = [subtypeOf(m[1]), subtypeOf(m[2])];
      if (types.some((t) => !t)) return null;
      return (g, _self, you) => g.players[you].battlefield.some((c) => types.some((t) => hasType(g, c, t!)));
    },
  ],
  [
    new RegExp(`^you control ${NUM} or more (.+)$`),
    (m) => {
      const n = NUMBERS[m[1]] ?? parseInt(m[1], 10);
      const o = object(m[2], 'many', null);
      if (!o || o.zone !== 'battlefield' || Number.isNaN(n)) return null;
      const group = groupOf({ ...o, who: 'you' });
      return (g, self, you) => group(g, { self, you, targets: [] }).length >= n;
    },
  ],
  [
    /^you control (?:a|an|another) (.+)$/,
    (m) => {
      const o = object(m[1], 'one', null);
      if (!o || o.zone !== 'battlefield') return null;
      const other = /^you control another /.test(m[0]);
      const group = groupOf({ ...o, who: 'you' });
      return (g, self, you) => group(g, { self, you, targets: [] }).some((c) => !other || c.id !== self.id);
    },
  ],
  [
    /^you control no (.+)$/,
    (m) => {
      const o = object(m[1], 'many', null);
      if (!o || o.zone !== 'battlefield') return null;
      const group = groupOf({ ...o, who: 'you' });
      return (g, self, you) => group(g, { self, you, targets: [] }).length === 0;
    },
  ],
  [/^you have (\d+) or more life$/, (m) => (g, _s, you) => g.players[you].life >= parseInt(m[1], 10)],
  [/^you have (\d+) or less life$/, (m) => (g, _s, you) => g.players[you].life <= parseInt(m[1], 10)],
  [new RegExp(`^(?:there are ${NUM} or more cards in your graveyard|${NUM} or more cards are in your graveyard)$`), (m) => (g, _s, you) => g.players[you].graveyard.length >= (NUMBERS[m[1] ?? m[2]] ?? parseInt(m[1] ?? m[2], 10))],
  [/^you have no cards in hand$/, () => (g, _s, you) => g.players[you].hand.length === 0],
  // "If you cast it from your hand", "if it was kicked": how the permanent was cast (601.2, 702.33d).
  [/^you cast it from your hand$/, () => (_g, self) => self.cast?.from === 'hand'],
  [/^it was kicked$/, () => (_g, self) => !!self.cast?.kicked],
  [/^it's your turn$/, () => (g, _s, you) => g.active === you],
  [/^it's not your turn$/, () => (g, _s, you) => g.active !== you],
  [/^~ is tapped$/, () => (g, self) => !!permanent(g, self.id)?.tapped],
  [/^~ is untapped$/, () => (g, self) => permanent(g, self.id)?.tapped === false],
  [/^an opponent controls more lands than you$/, () => (g, _s, you) => opponentsOf(g, you).some((o) => o.battlefield.filter((c) => isLand(g, c)).length > g.players[you].battlefield.filter((c) => isLand(g, c)).length)],
  // Life gained this turn (119.3): "if you gained life this turn", "if you gained 3 or more life this turn".
  [/^you gained life this turn$/, () => (g, _s, you) => (g.players[you].lifeGained ?? 0) > 0],
  [new RegExp(`^you gained ${NUM} or more life this turn$`), (m) => (g, _s, you) => (g.players[you].lifeGained ?? 0) >= (NUMBERS[m[1]] ?? parseInt(m[1], 10))],
  // The Ring (701.54c, 701.54e): "if this creature is your Ring-bearer", "the Ring has tempted you two or more times this game".
  [/^~ is your ring-bearer$/, () => (g, self, you) => isRingBearer(g, permanent(g, self.id) ?? self, you)],
  [new RegExp(`^the ring has tempted you ${NUM} or more times this game$`), (m) => (g, _s, you) => timesTempted(g, you) >= (NUMBERS[m[1]] ?? parseInt(m[1], 10))],
];

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const ORDINAL = `(${Object.keys(ORDINALS).join('|')})`;

/**
 * "If this is the second time this ability has resolved this turn" (Ms. Bumbleflower, Omnath):
 * checked as that part of the ability resolves, this resolution counted. A copy of the ability
 * counts as the ability (707.10b); the same ability of a new object is another ability (400.7).
 */
const resolvedTime =
  (n: number): Cond =>
  (g) =>
    timesResolved(g) === n;

function condition(text: string): Cond | null {
  for (const [re, make] of CONDITIONS) {
    const m = re.exec(text);
    if (m) return make(m);
  }
  // "A and B": both, each read on its own ("if Frodo is your Ring-bearer and the Ring has tempted you two or more times this game").
  for (let at = text.indexOf(' and '); at >= 0; at = text.indexOf(' and ', at + 1)) {
    const a = condition(text.slice(0, at));
    const b = a && condition(text.slice(at + ' and '.length));
    if (a && b) return (g, self, you) => a(g, self, you) && b(g, self, you);
  }
  return null;
}

// ---------- effects ----------

/** How a waiting effect's choice continues: the continuation's key, and what it carries. */
interface Resume {
  then: string;
  data: Record<string, unknown> & { m: Memo };
}

/** One effect: its targets and what it does. `i` is its first target's index in the ability's target list. */
interface Effect {
  targets: TargetSpec[];
  run?: (g: Game, ctx: Ctx, i: number, m: Memo) => void;
  /**
   * An effect that waits for a player's choice (a search, a discard, scry): `choose` asks it
   * with `q` as the continuation and returns true, or returns false if there was nothing to
   * choose. `after` carries out the answer; it returns false if it asked again with `q`.
   * `last`: nothing follows it, so a helper with the engine's own continuation may be used.
   */
  choose?: (g: Game, ctx: Ctx, i: number, m: Memo, q: Resume, last: boolean) => boolean;
  after?: (g: Game, c: ThenCtx, i: number, m: Memo, q: Resume) => boolean | void;
  /** How a bot answers its choice. */
  bot?: (g: Game, pid: PlayerId, choice: Choice) => Action;
  /** The clause as written, for a "you may" question. */
  text: string;
  /** Starts a "you may" part; `joined` clauses ("you may A and B") belong to the one before. */
  may?: boolean;
  /** Who is asked "may": the controller unless it says another player ("its controller may search"). */
  asker?: (g: Game, ctx: Ctx, i: number, m: Memo) => PlayerId | null;
  joined?: boolean;
  /** Its target is the previous clause's ("it", "that creature", the carried target player). */
  reuse?: boolean;
  /** It happens only if the player asked in the step before didn't pay (118.12a). */
  unlessPaid?: boolean;
  /** "If [condition], [effect]": it happens only if the condition holds as it resolves (608.2c). */
  onlyIf?: Cond;
  /** "You may pay {N}. If you do, ...": the "may" is a payment (118.12). */
  mayPay?: { cost?: string; life?: number };
  /** A bot hint the card's script takes from it (`CardScript.ai`). */
  ai?: CardScript['ai'];
}
type Read = Omit<Effect, 'text'>;

type Subject = 'you' | 'target player' | 'target opponent' | 'each opponent' | 'each player' | 'each other player' | 'its controller' | 'its owner' | 'that player';

/** The players a subject means as the effect happens, in APNAP order where there are several (101.4). */
function players(g: Game, ctx: Ctx, i: number, who: Subject, m: Memo): PlayerId[] {
  if (who === 'you') return [ctx.you];
  if (who === 'each opponent') return turnOrder(g, g.active).filter((p) => p !== ctx.you);
  if (who === 'each player') return turnOrder(g, g.active);
  if (who === 'each other player') return turnOrder(g, g.active).filter((p) => p !== ctx.you);
  if (who === 'its controller') return m.last && !g.players[m.last.controller].lost ? [m.last.controller] : [];
  if (who === 'its owner') return m.last && !g.players[m.last.owner].lost ? [m.last.owner] : [];
  if (who === 'that player' && i < 0) return m.ev.player !== null && !g.players[m.ev.player].lost ? [m.ev.player] : [];
  const p = refPlayer(g, ctx.targets[i]);
  return p ? [p.id] : [];
}

/** Remembers an object as it is now, for "its controller" and "its power" after it is gone (608.2h). */
function remember(g: Game, m: Memo, c: Card | undefined, controller?: PlayerId) {
  if (!c) return;
  const s = c.zone === 'battlefield' ? stats(g, c) : { power: 0, toughness: 0 };
  m.last = { id: c.id, controller: controller ?? c.controller, owner: c.owner, power: s.power, toughness: s.toughness, mv: manaValue(c) };
}

/** A clause's object: a target, a group, this permanent, or "it". `cards` finds them as the effect happens. */
interface Objects {
  targets: TargetSpec[];
  reuse?: boolean;
  zone: 'battlefield' | 'stack' | 'graveyard';
  /** The objects now. Stack objects are found through `items`. */
  cards: (g: Game, ctx: Ctx, i: number, m: Memo) => Card[];
  items?: (g: Game, ctx: Ctx, i: number) => { ref: TargetRef; item: StackItem }[];
  group?: boolean;
  /** One target or "it": "its controller" can follow. */
  single: boolean;
}

/** The targets an effect's specs chose, from `i` on: one per spec, or all of them for "any number of". */
const chosen = (ctx: Ctx, i: number, specs: TargetSpec[]) => (specs.some((s) => s.any) ? ctx.targets.slice(i) : ctx.targets.slice(i, i + specs.length));

function objects(phrase: string, env: Env, st: State, clause: string): Objects | null {
  if (phrase === '~') {
    if (!env.permanent) return refuse(clause, 'a spell acting on itself');
    return { targets: [], zone: 'battlefield', single: true, cards: (g, ctx) => [permanent(g, ctx.self.id)].filter((c): c is Card => !!c) };
  }
  if (/^(?:it|that creature|that permanent|that card|that land)$/.test(phrase)) {
    if (st.last === 'card' && st.lastTarget) return { targets: [], reuse: true, zone: 'battlefield', single: true, cards: (g, ctx, i) => [refCard(g, ctx.targets[i])].filter((c): c is Card => !!c) };
    if (st.last === 'card') return { targets: [], zone: 'battlefield', single: true, cards: (g, _c, _i, m) => [m.last && permanent(g, m.last.id)].filter((c): c is Card => !!c) };
    // In a trigger about another object ("whenever a creature you control enters"), "it" is that object.
    if (env.ev?.object) return { targets: [], zone: 'battlefield', single: true, cards: (g, _c, _i, m) => [m.ev.id ? permanent(g, m.ev.id) : undefined].filter((c): c is Card => !!c) };
    if (env.permanent && phrase === 'it') return objects('~', env, st, clause);
    return null;
  }
  if (/^(?:those creatures|those permanents|them)$/.test(phrase) && st.last === 'group') {
    return { targets: [], zone: 'battlefield', group: true, single: false, cards: (g, _c, _i, m) => (m.group ?? []).map((id) => permanent(g, id)).filter((c): c is Card => !!c) };
  }
  const specs = targetPhrase(phrase, env.x);
  if (specs) {
    const zone = specs[0].type === 'graveyard card' ? 'graveyard' : specs[0].type === 'spell' || specs[0].type === 'ability' || specs[0].type === 'spell or ability' ? 'stack' : 'battlefield';
    if (specs[0].type === 'player' || specs[0].type === 'any' || specs[0].type === 'player or planeswalker' || specs[0].type === 'spell or permanent') return { targets: specs, zone: 'battlefield', single: specs.length === 1, cards: () => [] };
    return {
      targets: specs,
      zone,
      single: specs.length === 1,
      cards: (g, ctx, i) =>
        chosen(ctx, i, specs)
          .map((r) => (zone === 'graveyard' ? refGraveyard(g, r) : refCard(g, r)))
          .filter((c): c is Card => !!c),
      items: (g, ctx, i) =>
        chosen(ctx, i, specs).flatMap((r) => {
          const item = refStack(g, r);
          return item && r ? [{ ref: r, item }] : [];
        }),
    };
  }
  const group = groupPhrase(phrase, env.x);
  if (group) return { targets: [], zone: 'battlefield', group: true, single: false, cards: (g, ctx) => group(g, ctx) };
  return null;
}

/** An object phrase the clause must have: refuses the clause if it isn't one. */
const mustObjects = (phrase: string, env: Env, st: State, clause: string) => objects(phrase, env, st, clause) ?? refuse(clause, `"${phrase}" isn't a target or group the parser knows`);

/** Notes what the clause acted on, for "it" and "its controller" in the clauses after it. */
function acted(st: State, o: Objects) {
  st.last = o.single ? (o.zone === 'stack' ? 'spell' : 'card') : o.group ? 'group' : null;
  st.lastTarget = o.single && (o.targets.length > 0 || !!o.reuse);
  st.destroyed = false;
}

/** The objects an effect acts on now, remembered for "it", "its controller" and "those creatures" after it. */
function actOn(g: Game, ctx: Ctx, i: number, m: Memo, o: Objects): Card[] {
  const cards = o.cards(g, ctx, i, m);
  if (o.single) remember(g, m, cards[0]);
  if (o.group) m.group = cards.map((c) => c.id);
  return cards;
}

/** "Flying and lifelink", "+2/+2 and gains trample": a pump's parts. */
function signed(s: string, env: Env, clause: string): Num {
  const sign = s[0] === '-' ? -1 : 1;
  const n = count(s.slice(1), env.x, clause);
  return (g, ctx, m) => sign * n(g, ctx, m);
}

/** A search's card: "a basic land card", "a Forest card", "a creature card", "an instant or sorcery card", "a card". */
function findOf(phrase: string): Find | null {
  if (phrase === 'a card') return { label: 'a card' };
  // "An instant card or a card with flash": a card type or a keyword, either will do.
  if (phrase === 'an instant card or a card with flash') return { types: ['Instant'], keywords: ['flash'], label: phrase };
  if (phrase === 'a land card with a basic land type') return { types: ['Land'], subtypes: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'], label: phrase };
  const m0 = /^(?:an?|up to \S+|\S+) (.+?) cards?( with mana value (?:\d+|x) or less)?$/.exec(phrase);
  if (!m0) return null;
  const what = m0[1] + (m0[2] ?? '');
  if (what === 'basic land') return { basic: true, types: ['Land'], label: phrase };
  let m = /^((?:plains|island|swamp|mountain|forest)(?:(?:,|,? or) (?:plains|island|swamp|mountain|forest))*)$/.exec(what);
  if (m) return { subtypes: m[1].split(/,? or |, /).map(capital), label: phrase };
  m = /^basic (plains|island|swamp|mountain|forest)$/.exec(what);
  if (m) return { basic: true, subtypes: [capital(m[1])], label: phrase };
  m = /^((?:creature|artifact|enchantment|land|instant|sorcery|planeswalker|legendary)(?: or (?:creature|artifact|enchantment|land|instant|sorcery|planeswalker))?)(?: with mana value (\d+|x) or less)?$/.exec(what);
  if (m) return { types: m[1].split(' or ').map(capital), ...(m[2] ? { maxMv: m[2] === 'x' ? -1 : parseInt(m[2], 10) } : {}), label: phrase };
  // "An artifact or Dragon card" (Magda): card types and subtypes, any one of them will do (205.2a, 205.3).
  const alts = what.split(/,? or |, /);
  if (alts.length > 1) {
    const kinds = { types: [] as string[], subtypes: [] as string[] };
    for (const w of alts) {
      if (['creature', 'artifact', 'enchantment', 'land', 'instant', 'sorcery', 'planeswalker', 'battle'].includes(w)) kinds.types.push(capital(w));
      else if (subtypeOf(w) && subtypeOf(w)!.toLowerCase() === w) kinds.subtypes.push(subtypeOf(w)!);
      else return null;
    }
    if (kinds.subtypes.length) return { kinds, label: phrase };
  }
  return null;
}

/**
 * "Search [your / their] library for [a card], [reveal it,] put it [onto the battlefield
 * (tapped) / into your hand / into your graveyard], then shuffle", "... then shuffle and put
 * that card on top" (701.23). Several cards: "up to two basic land cards, ... put them ...".
 * A search for a card with a stated quality may find nothing (701.23b).
 */
function searchEffect(rest: string, searcher: (g: Game, ctx: Ctx, i: number, m: Memo) => PlayerId | undefined, env: Env, st: State, clause: string): Read | null {
  let m = /^search(?:es)? (?:your|their) library for (.+?), (reveal (?:it|that card|them|those cards), )?put (?:it|that card|them|those cards) (onto the battlefield( tapped)?|into (?:your|their) hand|into (?:your|their) graveyard), then shuffle$/.exec(rest);
  let to: 'battlefield' | 'hand' | 'top' | 'none';
  if (m) to = m[3].startsWith('onto') ? 'battlefield' : /hand$/.test(m[3]) ? 'hand' : 'none';
  else if ((m = /^search(?:es)? (?:your|their) library for (.+?), (reveal it, )?then shuffle and put (?:that|the) card on top$/.exec(rest))) to = 'top';
  else return null;
  const find = findOf(m[1]) ?? refuse(clause, `a search for "${m[1]}"`);
  // "With mana value X or less": X as the search starts (107.3a).
  if (find.maxMv === -1 && !env.x) return refuse(clause, 'X outside a cost');
  const many = /^up to (\S+) /.exec(m[1]);
  if (!many && !/^(?:a|an) /.test(m[1])) return refuse(clause, `a search for "${m[1]}"`);
  const n = many ? count(many[1], env.x, clause) : () => 1;
  const tapped = !!m[4];
  const reveal = !!m[2];
  // "Then ... untap that land": the card found is what the next clause calls "that land" or "it".
  st.last = many ? null : 'card';
  st.lastTarget = false;
  return {
    targets: [],
    choose: (g, ctx, i, memo, q) => {
      const p = searcher(g, ctx, i, memo);
      if (p === undefined) return false;
      const k = n(g, ctx, memo);
      const f = find.maxMv === -1 ? { ...find, maxMv: env.x!(g, ctx, memo) } : find;
      search(g, p, to, f, { tapped, reveal, then: q.then, data: q.data, ...(k > 1 ? { count: k } : {}) });
      return true;
    },
    // "Put it into your graveyard": the engine leaves what it found in the library.
    after: (g, c, _i, memo) => {
      if (to === 'none') simultaneously(g, () => c.picked.forEach((x) => moveCard(g, x, 'graveyard')));
      if (c.picked.length === 1) remember(g, memo, permanent(g, c.picked[0].id) ?? c.picked[0]);
    },
  };
}

/**
 * What a player does: draw, gain or lose life, mill, discard, sacrifice, create tokens, take
 * an extra turn (121, 119, 701.17, 701.9, 701.21, 111.2, 500.7). `who` is the subject, `t`
 * whether the subject is a target of this clause (`targets`) or carried (`reuse`).
 */
function playerEffect(rest: string, who: Subject, env: Env, st: State, clause: string, sub: { targets: TargetSpec[]; reuse?: boolean; i?: number }): Read | null {
  let m: RegExpExecArray | null;
  const each = (run: (g: Game, ctx: Ctx, p: PlayerId, m: Memo) => void) => ({
    ...sub,
    run: (g: Game, ctx: Ctx, i: number, memo: Memo) => simultaneously(g, () => players(g, ctx, sub.i ?? i, who, memo).forEach((p) => run(g, ctx, p, memo))),
  });
  const forEach = (t: string | undefined, n: Num): Num => {
    if (!t) return n;
    const k = counted(t, env.x) ?? refuse(clause, `"for each ${t}"`);
    return (g, ctx, memo) => n(g, ctx, memo) * k(g, ctx, memo);
  };
  if ((m = new RegExp(`^draws? ${NUM} cards?(?: for each (.+))?$`).exec(rest))) {
    const n = forEach(m[2], count(m[1], env.x, clause));
    // Each player draws in turn order (121.2c), one at a time.
    return { ...sub, run: (g, ctx, i, memo) => players(g, ctx, sub.i ?? i, who, memo).forEach((p) => draw(g, p, n(g, ctx, memo))) };
  }
  if ((m = /^draws? cards equal to (.+)$/.exec(rest))) {
    const n = amountPhrase(m[1], env, st, clause);
    return { ...sub, run: (g, ctx, i, memo) => players(g, ctx, sub.i ?? i, who, memo).forEach((p) => draw(g, p, n(g, ctx, memo))) };
  }
  // "Gains 3 life", "gains that much life", "loses life equal to its power", "gains 1 life for each creature you control" (119).
  if ((m = /^(gain|lose)s? life equal to (.+)()$/.exec(rest)) || (m = /^(gain|lose)s? (.+?) life(?: for each (.+))?$/.exec(rest))) {
    const n = /life equal to/.test(rest) ? amountPhrase(m[2], env, st, clause) : forEach(m[3] || undefined, amountPhrase(m[2], env, st, clause));
    if (m[1] === 'gain') return each((g, ctx, p, memo) => gainLife(g, p, n(g, ctx, memo)));
    return each((g, ctx, p, memo) => void (memo.lost += loseLife(g, p, n(g, ctx, memo))));
  }
  // "Can't cast spells this turn", "can't cast noncreature spells this turn" (101.2).
  if ((m = /^can't cast (noncreature )?spells this turn$/.exec(rest))) {
    const noncreature = !!m[1];
    return each((g, _ctx, p) => addEffect(g, { kind: 'cantCast', player: p, ...(noncreature ? { noncreature } : {}) }));
  }
  if ((m = new RegExp(`^mills? ${NUM} cards?$`).exec(rest))) {
    const n = count(m[1], env.x, clause);
    return each((g, ctx, p, memo) => void mill(g, p, n(g, ctx, memo)));
  }
  if (/^discards? (?:their|your) hand$/.test(rest)) return each((g, _ctx, p) => discardHand(g, p));
  if (/^discards? a card at random$/.test(rest)) return each((g, _ctx, p) => discardAtRandom(g, p));
  // "Discards N cards" (701.9a): each player chooses, in APNAP order (101.4).
  if ((m = new RegExp(`^discards? ${NUM} cards?$`).exec(rest))) {
    const n = count(m[1], env.x, clause);
    return {
      ...sub,
      ...askEach(
        (g, ctx, i, memo) => players(g, ctx, sub.i ?? i, who, memo),
        (g, ctx, p, memo) => {
          const hand = g.players[p].hand;
          const k = Math.min(n(g, ctx, memo), hand.length);
          return k ? { cards: hand, min: k, max: k, text: `discard ${k === 1 ? 'a card' : `${k} cards`}`, button: 'Discard', bot: 'discard' } : null;
        },
        (g, picked) => picked.forEach((c) => discard(g, c)),
        '@discard',
      ),
    };
  }
  // "Sacrifices a creature" (701.21a): each player chooses one they control, in APNAP order (101.4).
  if ((m = /^sacrifices? (a|an|two|three) (.+?)(?: of their choice)?$/.exec(rest))) {
    const n = NUMBERS[m[1]];
    const o = object(m[2], n === 1 ? 'one' : 'many', env.x);
    if (!o || o.zone !== 'battlefield') return refuse(clause, `can't sacrifice "${m[2]}"`);
    const label = `${m[1]} ${m[2]}`;
    return {
      ...sub,
      ...askEach(
        (g, ctx, i, memo) => players(g, ctx, sub.i ?? i, who, memo),
        (g, ctx, p) => {
          const fits = groupOf({ ...o, who: undefined })(g, ctx).filter((c) => c.controller === p);
          const k = Math.min(n, fits.length);
          return k ? { cards: fits, min: k, max: k, text: `sacrifice ${label}`, button: 'Sacrifice', bot: 'sacrifice' } : null;
        },
        (g, picked) => dieMany(g, picked.map((c) => permanent(g, c.id)).filter((c): c is Card => !!c), 'is sacrificed'),
      ),
    };
  }
  // "Create a token that's a copy of it[, except the token isn't legendary]" (707.2, 707.9b): "it" is the trigger's object,
  // with its copiable values as it is now, or as it last was on the battlefield if it has left (608.2h).
  if ((m = /^creates? a token that's a copy of it(, except the token isn't legendary)?$/.exec(rest)) && env.ev?.object && !st.last) {
    const nonlegendary = !!m[1];
    return each((g, _ctx, p, memo) => {
      const was = memo.ev.card;
      if (!was) return;
      const now = permanent(g, was.id);
      tokenCopy(g, p, now && now.moves === was.moves ? now : was, nonlegendary ? { nonlegendary } : {});
    });
  }
  if ((m = /^creates? (.+)$/.exec(rest)) && !/ for each /.test(rest)) {
    const made = tokenList(m[1], env.x, clause);
    // Every kind at once: one event (111.2, 614.1a).
    return each((g, ctx, p, memo) => void createTokens(g, p, made.map((t) => ({ key: t.key, count: t.n(g, ctx, memo) }))));
  }
  if (/^takes? an extra turn after this one$/.test(rest)) return each((g, _ctx, p) => extraTurn(g, p));
  // "Search their library for a basic land card, put it onto the battlefield tapped, then shuffle."
  const searching = searchEffect(rest, (g, ctx, i, memo) => players(g, ctx, sub.i ?? i, who, memo)[0], env, st, clause);
  if (searching) return { ...sub, ...searching, targets: sub.targets };
  return null;
}

/**
 * A choice each of several players makes, in APNAP order (101.4): `pick` says what each
 * picks from, or null if they have nothing to pick. Every pick but the last is carried out by
 * the engine's own continuation if there is one (`engineThen`) or by this one; the last one
 * continues the ability.
 */
function askEach(
  who: (g: Game, ctx: Ctx, i: number, m: Memo) => PlayerId[],
  pick: (g: Game, ctx: Ctx, p: PlayerId, m: Memo) => { cards: Card[]; min: number; max: number; text: string; button: string; bot: string } | null,
  done: (g: Game, picked: Card[]) => void,
  engineThen?: string,
): Pick<Effect, 'choose' | 'after'> {
  return {
    choose: (g, ctx, i, m, q, last) => {
      const asks = who(g, ctx, i, m)
        .map((p) => ({ p, q: pick(g, ctx, p, m) }))
        .filter((x): x is { p: PlayerId; q: NonNullable<ReturnType<typeof pick>> } => !!x.q);
      if (!asks.length) return false;
      asks.forEach(({ p, q: a }, k) => {
        const final = k === asks.length - 1;
        const then = final ? (last && engineThen ? engineThen : q.then) : (engineThen ?? q.then);
        pickCards(g, p, a.cards, { min: a.min, max: a.max, text: a.text, button: a.button, then, data: { ...(then === q.then ? q.data : {}), bot: a.bot, ...(final ? {} : { more: true }) } });
      });
      return true;
    },
    after: (g, c) => {
      done(g, c.picked);
      // An earlier player's pick: the ability goes on after the last one.
      return !c.data.more;
    },
  };
}

/** "Scry N" (701.22a): the player looks at the top N, puts any number on the bottom in any order and the rest on top in any order. */
function scryEffect(n: Num): Pick<Effect, 'choose' | 'after' | 'bot'> {
  return {
    choose: (g, ctx, _i, m, q) => {
      const top = g.players[ctx.you].library.slice(0, n(g, ctx, m));
      if (!top.length) return false;
      log(g, `${says(g.players[ctx.you], 'scries')} ${top.length}.`, ctx.you);
      pickCards(g, ctx.you, top, { max: top.length, text: `scry ${top.length}: put any on the bottom of your library`, button: 'Done', then: q.then, data: { ...q.data, phase: 'bottom', n: top.length } });
      return true;
    },
    after: (g, c, _i, _m, q) => {
      const p = g.players[c.chooser];
      const lib = p.library;
      const phase = c.data.phase as string;
      const n = c.data.n as number;
      if (phase === 'bottom') {
        const bottom = c.picked.map((x) => x.id);
        const rest = lib.slice(0, n).filter((x) => !bottom.includes(x.id));
        if (bottom.length) log(g, `${says(p, 'puts')} ${bottom.length === 1 ? 'a card' : `${bottom.length} cards`} on the bottom of ${their(p)} library.`, p.id);
        // Those on the bottom, in the order chosen (401.4): asked only for two or more.
        if (bottom.length > 1) {
          pickCards(g, p.id, c.picked, { min: bottom.length, max: bottom.length, ordered: true, text: 'put these on the bottom of your library in any order', button: 'Put on Bottom', then: q.then, data: { ...q.data, phase: 'order bottom', rest: rest.map((x) => x.id), n } });
          return false;
        }
        for (const id of bottom) lib.push(...lib.splice(lib.findIndex((x) => x.id === id), 1));
        return orderTop(g, p.id, rest, q);
      }
      if (phase === 'order bottom') {
        for (const x of c.picked) lib.push(...lib.splice(lib.findIndex((y) => y.id === x.id), 1));
        const rest = (c.data.rest as string[]).map((id) => lib.find((x) => x.id === id)!).filter(Boolean);
        return orderTop(g, p.id, rest, q);
      }
      // The rest back on top in the order chosen, the first picked on top.
      const ids = c.picked.map((x) => x.id);
      const cards = ids.map((id) => lib.splice(lib.findIndex((x) => x.id === id), 1)[0]);
      lib.unshift(...cards);
      return true;
    },
    // A bot keeps every card on top, in the order it found them.
    bot: (_g, _pid, choice) => ({ type: 'chooseCards', cards: choice.kind === 'pick' && (choice.data?.phase === 'bottom' ? [] : choice.cards) ? (choice.data?.phase === 'bottom' ? [] : choice.cards) : [] }),
  };
}

/** Asks the order of the cards left on top (two or more), the first picked on top; true if there was nothing to ask. */
function orderTop(g: Game, pid: PlayerId, rest: Card[], q: Resume): boolean {
  if (rest.length < 2) return true;
  pickCards(g, pid, rest, { min: rest.length, max: rest.length, ordered: true, text: 'put these back on top of your library in any order, the first on top', button: 'Put on Top', then: q.then, data: { ...q.data, phase: 'order top' } });
  return false;
}

/**
 * "Look at the top N cards of your library. Put K of them into your hand and the rest on the
 * bottom of your library in any order / in a random order." The rest go on the bottom (401.4)
 * before anything after it happens.
 */
function lookEffect(n: Num, k: Num, random: boolean, filter: Test | null, label: string): Pick<Effect, 'choose' | 'after'> {
  return {
    choose: (g, ctx, _i, m, q) => {
      const top = g.players[ctx.you].library.slice(0, n(g, ctx, m));
      if (!top.length) return false;
      const pickable = filter ? top.filter((c) => filter(g, c, ctx.self, 0)) : top;
      const want = Math.min(k(g, ctx, m), pickable.length);
      pickCards(g, ctx.you, top, { min: filter ? 0 : want, max: want, pickable, text: label, button: 'Put in Hand', then: q.then, data: { ...q.data, phase: 'hand', top: top.map((c) => c.id) } });
      return true;
    },
    after: (g, c, _i, _m, q) => {
      const p = g.players[c.chooser];
      if (c.data.phase === 'hand') {
        for (const x of c.picked) {
          const card = p.library.find((y) => y.id === x.id);
          if (card) moveCard(g, card, 'hand');
        }
        if (c.picked.length) log(g, `${says(p, 'puts')} ${c.picked.length === 1 ? 'a card' : `${c.picked.length} cards`} into ${their(p)} hand.`, p.id, filter ? c.picked : []);
        const rest = (c.data.top as string[]).map((id) => p.library.find((y) => y.id === id)).filter((x): x is Card => !!x);
        if (random || rest.length < 2) {
          const order = [...rest];
          if (random) shuffle(g, order);
          for (const x of order) p.library.push(...p.library.splice(p.library.findIndex((y) => y.id === x.id), 1));
          return true;
        }
        pickCards(g, p.id, rest, { min: rest.length, max: rest.length, ordered: true, text: 'put these on the bottom of your library in any order', button: 'Put on Bottom', then: q.then, data: { ...q.data, phase: 'bottom' } });
        return false;
      }
      for (const x of c.picked) p.library.push(...p.library.splice(p.library.findIndex((y) => y.id === x.id), 1));
      return true;
    },
  };
}

/**
 * Reads one clause ("draw two cards", "~ deals 3 damage to any target"). The subject may be
 * carried from an earlier clause of the sentence (`st.who`).
 */
function effect(clause0: string, env: Env, st: State): Read {
  // "The Ring tempts you" (701.54a): choosing a Ring-bearer among two or more creatures waits, and the rest of the ability with it.
  if (clause0 === 'the ring tempts you') return { targets: [], choose: (g, ctx, _i, _m, q) => temptWithRing(g, ctx.you, q.then, q.data), after: () => {} };
  // "That creature's controller" and "that permanent's controller" are "its controller".
  // "That player" after a permanent an opponent controls, with no player before it, is that permanent's controller (Boseiju).
  const clause = clause0
    .replace(/^(?:that creature's|that permanent's|that spell's|that land's) (controller|owner) /, 'its $1 ')
    .replace(/^that player /, !env.ev?.player && st.last === 'card' && st.who !== 'target player' && st.who !== 'target opponent' ? 'its controller ' : 'that player ');
  const subj = /^(you|target player|target opponent|each opponent|each player|each other player|its controller|its owner|that player|they) (.+)$/.exec(clause);
  let subject = (subj?.[1] as Subject | 'they' | undefined) ?? st.who;
  const rest = subj ? subj[2] : clause;
  if (subject === 'they' && /^can't be regenerated$/.test(rest)) return youEffect(clause, env, st, clause);
  if (subject === 'they') {
    // "They": the player the trigger names, or the players named just before.
    if (env.ev?.player) subject = 'that player';
    else if (st.who && st.who !== 'you') subject = st.who;
    else return refuse(clause, '"they" without a player to refer to');
  }
  if ((subject === 'its controller' || subject === 'its owner') && !st.last) return refuse(clause, `"${subject}" without an object before it`);
  const me: Subject = (subject as Subject | null) ?? 'you';
  // "That player": the triggering event's player (i = -1), or the target player before.
  const eventPlayer = me === 'that player' && env.ev?.player;
  if (me === 'that player' && !eventPlayer && !(st.who === 'target player' || st.who === 'target opponent')) return refuse(clause, '"that player" without a player to refer to');
  // A target subject carried from an earlier clause is the same target, not a new one.
  const sub = eventPlayer
    ? { targets: [], i: -1 }
    : me.startsWith('target') && !subj
      ? { targets: [], reuse: true }
      : me === 'that player'
        ? { targets: [], reuse: true }
        : { targets: me.startsWith('target') ? targetPhrase(me, null)! : [] };
  const asSubject = me === 'that player' && !eventPlayer ? (st.who as Subject) : me;
  st.who = (subject as Subject | null) ?? null;
  const pl = playerEffect(rest, asSubject, env, st, clause, sub);
  if (pl) return pl;
  if (subj && me !== 'you') return refuse(clause, `no template for what ${subject} does`);
  return youEffect(rest, env, st, clause);
}

/** What "you" do, or a clause with no subject: an instruction to the ability's controller. */
function youEffect(rest: string, env: Env, st: State, clause: string): Read {
  let m: RegExpExecArray | null;
  // Scry N (701.22), surveil N (701.25).
  if ((m = new RegExp(`^scry ${NUM}$`).exec(rest))) return { targets: [], ...scryEffect(count(m[1], env.x, clause)) };
  if ((m = new RegExp(`^surveil ${NUM}$`).exec(rest))) {
    const n = count(m[1], env.x, clause);
    return {
      targets: [],
      choose: (g, ctx, _i, memo, q) => {
        const top = g.players[ctx.you].library.slice(0, n(g, ctx, memo));
        if (!top.length) return false;
        pickCards(g, ctx.you, top, { max: top.length, text: `surveil ${top.length}: put any into your graveyard`, button: 'Done', then: q.then, data: q.data });
        return true;
      },
      after: (g, c) => {
        const p = g.players[c.chooser];
        simultaneously(g, () => c.picked.forEach((x) => moveCard(g, x, 'graveyard')));
        log(g, c.picked.length ? `${says(p, 'surveils')} and ${says(p, 'puts').split(' ').slice(1).join(' ')} ${c.picked.map((x) => cardData(x.name).name).join(', ')} into ${their(p)} graveyard.` : `${says(p, 'surveils')}.`, p.id, c.picked);
      },
      // A bot keeps what it finds.
      bot: () => ({ type: 'chooseCards', cards: [] }),
    };
  }
  // "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped
  // and the other into your hand, then shuffle" (Cultivate): one search (701.23h); the player then picks which one goes onto the battlefield.
  if (rest === 'search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle') {
    return {
      targets: [],
      choose: (g, ctx, _i, _m, q) => {
        search(g, ctx.you, 'none', { basic: true, types: ['Land'], label: 'up to two basic land cards' }, { reveal: true, count: 2, then: q.then, data: { ...q.data, phase: 'found' } });
        return true;
      },
      after: (g, c, _i, _m, q) => {
        const lib = g.players[c.chooser].library;
        if (c.data.phase === 'found') {
          const found = c.picked.map((x) => lib.find((y) => y.id === x.id)).filter((x): x is Card => !!x);
          if (found.length < 2) {
            found.forEach((x) => enterBattlefield(g, x, { tapped: true }));
            return true;
          }
          pickCards(g, c.chooser, found, { min: 1, max: 1, text: 'put one onto the battlefield tapped (the other goes into your hand)', button: 'Onto Battlefield', then: q.then, data: { ...q.data, phase: 'split', found: found.map((x) => x.id) } });
          return false;
        }
        const ids = c.data.found as string[];
        const field = lib.find((y) => y.id === c.picked[0]?.id);
        const hand = lib.find((y) => ids.includes(y.id) && y.id !== field?.id);
        if (field) enterBattlefield(g, field, { tapped: true });
        if (hand) moveCard(g, hand, 'hand');
        return true;
      },
    };
  }
  // "Draw N cards, then discard N cards" (121, 701.9a): the discards are chosen after the draw.
  if ((m = new RegExp(`^draw ${NUM} cards?, then discard ${NUM} cards?$`).exec(rest))) {
    const [d, k] = [count(m[1], env.x, clause), count(m[2], env.x, clause)];
    const disc = askEach(
      (_g, ctx) => [ctx.you],
      (g, ctx, p, memo) => {
        const hand = g.players[p].hand;
        const n = Math.min(k(g, ctx, memo), hand.length);
        return n ? { cards: hand, min: n, max: n, text: `discard ${n === 1 ? 'a card' : `${n} cards`}`, button: 'Discard', bot: 'discard' } : null;
      },
      (g, picked) => picked.forEach((c) => discard(g, c)),
      '@discard',
    );
    return {
      targets: [],
      choose: (g, ctx, i, memo, q, last) => {
        draw(g, ctx.you, d(g, ctx, memo));
        return disc.choose!(g, ctx, i, memo, q, last);
      },
      after: disc.after,
    };
  }
  // "Look at the top N cards of your library. Put one of them into your hand and the rest on the bottom ..." (401.4)
  if ((m = new RegExp(`^look at the top ${NUM} cards of your library\\. put ${NUM} of them into your hand and the rest on the bottom of your library in (any|a random) order$`).exec(rest))) {
    const [n, k] = [count(m[1], env.x, clause), count(m[2], env.x, clause)];
    return { targets: [], ...lookEffect(n, k, m[3] === 'a random', null, 'put into your hand') };
  }
  if ((m = new RegExp(`^look at the top ${NUM} cards of your library\\. you may reveal an? (.+?) card from among them and put it into your hand\\. put the rest on the bottom of your library in (any|a random) order$`).exec(rest))) {
    const n = count(m[1], env.x, clause);
    const o = object(`${m[2]} card in your graveyard`, 'one', null) ?? refuse(clause, `"${m[2]} card"`);
    return { targets: [], ...lookEffect(n, () => 1, m[3] === 'a random', o.test, `you may reveal ${/^[aeiou]/.test(m[2]) ? 'an' : 'a'} ${m[2]} card and put it into your hand`) };
  }
  // "[This] deals N damage to [targets / groups / players]" (120), several at once as one event.
  if ((m = /^~ deals (\S+) damage to (.+)$/.exec(rest)) || (m = /^~ deals damage equal to (.+?) to (.+)$/.exec(rest))) {
    const n = /^~ deals damage equal/.test(rest) ? amountPhrase(m[1], env, st, clause) : count(m[1], env.x, clause);
    return damageTo(m[2], n, (_g, ctx) => ctx.self, env, st, clause);
  }
  // "Rin and Seri deals damage to any target equal to the number of Dogs you control": the amount as it resolves (608.2h).
  if ((m = /^~ deals damage to (.+?) equal to (.+)$/.exec(rest))) return damageTo(m[1], amountPhrase(m[2], env, st, clause), (_g, ctx) => ctx.self, env, st, clause);
  // "Whenever a Dragon you control enters, it deals X damage to any target": the triggering object deals it, as it last was if it left (608.2h).
  if ((m = /^(?:it|that creature) deals (\S+) damage to (.+)$/.exec(rest)) && env.ev?.object && !st.last) {
    const n = count(m[1], env.x, clause);
    const dmg = damageTo(m[2], n, () => undefined, env, st, clause);
    return { ...dmg, run: (g, ctx, i, memo) => dmg.run!(g, { ...ctx, self: (memo.ev.id && permanent(g, memo.ev.id)) || memo.ev.card || ctx.self }, i, memo) };
  }
  // "Target creature you control deals damage equal to its power to target creature you don't control" (Rabid Bite).
  if ((m = /^(target .+?) deals damage equal to its power to (.+)$/.exec(rest))) {
    const from = targetPhrase(m[1], env.x);
    if (!from || from.length !== 1 || from[0].type !== 'creature') return refuse(clause, `"${m[1]}" isn't a target creature`);
    const to = damageTo(m[2], (g, ctx) => {
      const c = refCard(g, ctx.targets[0]);
      return c ? stats(g, c).power : 0;
    }, (g, ctx, i) => refCard(g, ctx.targets[i - 1]), env, st, clause);
    if (to.targets.length !== 1) return refuse(clause, 'damage from a target to more than one');
    return {
      targets: [from[0], ...to.targets],
      run: (g, ctx, i, memo) => {
        const c = refCard(g, ctx.targets[i]);
        if (c) memo.dealt += dealDamage(g, c, ctx.targets[i + 1], stats(g, c).power);
      },
    };
  }
  // Fight (701.14): "[This / target creature you control] fights [target creature]".
  if ((m = /^(~|target .+?) fights (target .+|another target .+)$/.exec(rest))) {
    const a = m[1] === '~' ? null : targetPhrase(m[1], env.x);
    const b = targetPhrase(m[2], env.x);
    if ((m[1] !== '~' && (!a || a.length !== 1 || a[0].type !== 'creature')) || !b || b.length !== 1 || b[0].type !== 'creature') return refuse(clause, 'a fight the parser can\'t read');
    if (m[1] === '~' && !env.permanent) return refuse(clause, 'a spell fighting');
    const specs = [...(a ?? []), ...b];
    return {
      targets: specs,
      run: (g, ctx, i) => {
        // If either creature is no longer a legal target, no damage is dealt (701.14b).
        const x = a ? refCard(g, ctx.targets[i]) : permanent(g, ctx.self.id);
        const y = refCard(g, ctx.targets[i + (a ? 1 : 0)]);
        if (x && y && isCreature(g, x) && isCreature(g, y)) fight(g, x, y);
      },
    };
  }
  // Counter (701.6): "counter target spell", "... unless its controller pays {N}" (118.12a).
  if ((m = /^counter (.+? spell)\. if that spell is countered this way, exile it instead of putting it into its owner's graveyard$/.exec(rest))) {
    // "Exile it instead" (614.6): a countered spell goes to exile rather than the graveyard.
    const o = mustObjects(m[1], env, st, clause);
    if (o.zone !== 'stack' || !o.single || !o.items) return refuse(clause, `can't counter "${m[1]}"`);
    acted(st, o);
    return {
      targets: o.targets,
      run: (g, ctx, i, memo) => {
        const [hit] = o.items!(g, ctx, i);
        if (!hit) return;
        remember(g, memo, hit.item.card, hit.item.controller);
        counter(g, hit.ref, { exile: true });
      },
    };
  }
  if ((m = /^counter (.+?)(?: unless its controller pays (\{\d+\}|\{x\}))?$/.exec(rest))) {
    const o = mustObjects(m[1], env, st, clause);
    if (o.zone !== 'stack' || !o.single || !o.items) return refuse(clause, `can't counter "${m[1]}"`);
    acted(st, o);
    const tax = m[2];
    if (tax === '{x}' && !env.x) return refuse(clause, 'X outside a cost');
    if (!tax)
      return {
        targets: o.targets,
        reuse: o.reuse,
        run: (g, ctx, i, memo) => {
          const [hit] = o.items!(g, ctx, i);
          if (!hit) return;
          remember(g, memo, hit.item.card, hit.item.controller);
          counter(g, hit.ref);
        },
      };
    return {
      targets: o.targets,
      choose: (g, ctx, i, memo, q) => {
        const [hit] = o.items!(g, ctx, i);
        if (!hit) return false;
        remember(g, memo, hit.item.card, hit.item.controller);
        const cost = tax === '{x}' ? `{${memo.x}}` : tax.toUpperCase();
        ask(g, hit.item.controller, { text: `Pay ${cost}, or ${cardData(hit.item.card.name).name} is countered.`, cost, yes: `Pay ${cost}`, no: "Don't Pay", then: q.then, data: { ...q.data, item: hit.ref } });
        return true;
      },
      after: (g, c) => {
        if (!c.yes) counter(g, c.data.item as TargetRef);
      },
    };
  }
  // "Copy target instant or sorcery spell. You may choose new targets for the copy." (707.10, 707.10c)
  if ((m = /^copy (target .+ spell)\. you may choose new targets for the copy$/.exec(rest))) {
    const specs = targetPhrase(m[1], env.x);
    if (!specs || specs.length !== 1 || specs[0].type !== 'spell') return refuse(clause, `"${m[1]}" isn't a target spell`);
    return { targets: specs, run: (g, ctx, i) => copySpell(g, ctx.targets[i], ctx.you) };
  }
  // "Untap up to N lands": any lands, chosen as it resolves.
  if ((m = new RegExp(`^untap up to ${NUM} lands$`).exec(rest))) {
    const n = count(m[1], env.x, clause);
    return {
      targets: [],
      choose: (g, ctx, _i, memo, q) => {
        const tapped = battlefield(g).filter((c) => c.tapped && isLand(g, c));
        if (!tapped.length) return false;
        pickCards(g, ctx.you, tapped, { max: Math.min(n(g, ctx, memo), tapped.length), text: `untap up to ${n(g, ctx, memo)} lands`, button: 'Untap', then: q.then, data: q.data });
        return true;
      },
      after: (g, c) => c.picked.forEach((x) => untap(g, permanent(g, x.id))),
      // A bot untaps its own lands.
      bot: (g, pid, choice) => ({ type: 'chooseCards', cards: choice.kind === 'pick' ? choice.cards.filter((id) => permanent(g, id)?.controller === pid).slice(0, choice.max) : [] }),
    };
  }
  // "Return a land you control to its owner's hand": no target, the player chooses one as it resolves (608.2c).
  if ((m = /^return (a|an) (.+?) you control to its owner's hand$/.exec(rest))) {
    const o = object(m[2], 'one', env.x);
    if (!o || o.zone !== 'battlefield') return refuse(clause, `can't return "${m[2]}"`);
    const label = `${m[1]} ${m[2]} you control`;
    return {
      targets: [],
      choose: (g, ctx, _i, _m, q) => {
        const fits = groupOf({ ...o, who: 'you' })(g, ctx);
        if (!fits.length) return false;
        pickCards(g, ctx.you, fits, { min: 1, max: 1, text: `return ${label} to its owner's hand`, button: 'Return', then: q.then, data: { ...q.data, bot: 'sacrifice' } });
        return true;
      },
      after: (g, c) => c.picked.forEach((x) => bounce(g, permanent(g, x.id))),
    };
  }
  // "Return a creature card from your graveyard to your hand", "put a land card from your hand onto the battlefield": chosen as it resolves.
  if ((m = /^(?:return (a|an) (.+?) card from your graveyard to your hand|put (a|an) (.+?) card from your hand onto the battlefield( tapped)?)$/.exec(rest))) {
    const fromGraveyard = !!m[1];
    const words = fromGraveyard ? m[2] : m[4];
    const o = object(`${words} card in your graveyard`, 'one', env.x);
    if (!o) return refuse(clause, `"${words} card"`);
    const tapped = !!m[5];
    return {
      targets: [],
      choose: (g, ctx, _i, _m, q) => {
        const zone = g.players[ctx.you][fromGraveyard ? 'graveyard' : 'hand'];
        const fits = zone.filter((c) => o.test(g, c, ctx.self, 0));
        if (!fits.length) return false;
        pickCards(g, ctx.you, fits, { min: 1, max: 1, text: fromGraveyard ? `return ${m![1]} ${words} card to your hand` : `put ${m![3]} ${words} card onto the battlefield`, button: fromGraveyard ? 'Return' : 'Put Onto Battlefield', then: q.then, data: q.data });
        return true;
      },
      after: (g, c) => {
        for (const x of c.picked) {
          const card = g.players[c.you][fromGraveyard ? 'graveyard' : 'hand'].find((y) => y.id === x.id);
          if (!card) continue;
          if (fromGraveyard) moveCard(g, card, 'hand');
          else enterBattlefield(g, card, { tapped });
        }
      },
    };
  }
  // "Put target artifact card from your graveyard on top of your library" (401.2).
  if ((m = /^put (target .+? card from (?:your|a) graveyard) on top of (?:your|its owner's) library$/.exec(rest))) {
    const o = mustObjects(m[1], env, st, clause);
    if (o.zone !== 'graveyard') return refuse(clause, `"${m[1]}" isn't a card in a graveyard`);
    if (/from a graveyard/.test(m[1]) && /your library$/.test(rest)) return refuse(clause, "a card on top of a library that isn't its owner's");
    return { targets: o.targets, run: (g, ctx, i, memo) => o.cards(g, ctx, i, memo).forEach((c) => putOnTop(g, c)) };
  }
  // "Put target creature card from a graveyard onto the battlefield under your control" (Reanimate), or "under its
  // owner's control" (Kenrith): it enters under the control of the player the effect names (110.2a).
  if ((m = /^put (target .+? card from (?:your|a|an opponent's) graveyard) onto the battlefield( tapped)? under (your|its owner's) control$/.exec(rest))) {
    const o = mustObjects(m[1], env, st, clause);
    if (o.zone !== 'graveyard') return refuse(clause, `"${m[1]}" isn't a card in a graveyard`);
    acted(st, o);
    const tapped = !!m[2];
    const owners = m[3] === "its owner's";
    return {
      targets: o.targets,
      run: (g, ctx, i, memo) => {
        const [c] = o.cards(g, ctx, i, memo);
        if (!c) return;
        remember(g, memo, c);
        enterBattlefield(g, c, { tapped, controller: owners ? c.owner : ctx.you });
      },
    };
  }
  // "Look at the top N cards of your library, then put them back in any order" (Ponder).
  if ((m = new RegExp(`^look at the top ${NUM} cards of your library, then put them back in any order$`).exec(rest))) {
    const n = count(m[1], env.x, clause);
    return {
      targets: [],
      choose: (g, ctx, _i, memo, q) => {
        const top = g.players[ctx.you].library.slice(0, n(g, ctx, memo));
        return !orderTop(g, ctx.you, top, q);
      },
      after: (g, c) => {
        const lib = g.players[c.chooser].library;
        const cards = c.picked.map((x) => lib.splice(lib.findIndex((y) => y.id === x.id), 1)[0]);
        lib.unshift(...cards);
      },
    };
  }
  // "Put this artifact on top of its owner's library" (Sensei's Divining Top).
  if (rest === "put ~ on top of its owner's library" && env.permanent) return { targets: [], run: (g, ctx) => void (permanent(g, ctx.self.id) && putOnTop(g, permanent(g, ctx.self.id)!)) };
  // "Shuffle your library" (701.24), as in "You may shuffle."
  if (rest === 'shuffle' || rest === 'shuffle your library') return { targets: [], run: (g, ctx) => shuffle(g, g.players[ctx.you].library) };
  // "Take an extra turn after this one. At the beginning of that turn's end step, you lose the game." (500.7)
  if (rest === "take an extra turn after this one. at the beginning of that turn's end step, you lose the game") return { targets: [], ai: 'extraTurn', run: (g, ctx) => extraTurn(g, ctx.you, { loseAtEnd: ctx.self }) };
  // "Add {R}{R}{R}. Until end of turn, you don't lose this mana as steps and phases end." (500.5)
  if ((m = /^add ((?:\{[wubrgc]\})+)\. until end of turn, you don't lose this mana as steps and phases end$/.exec(rest))) {
    const syms = m[1].slice(1, -1).split('}{').map((x) => x.toUpperCase() as ManaSym);
    return { targets: [], run: (g, ctx) => addMana(g, ctx.you, syms, ctx.self, { keep: true }) };
  }
  // "That creature deals damage equal to its power to target creature you don't control" (Domri's Ambush).
  if ((m = /^(?:that creature|it) deals damage equal to its power to (.+)$/.exec(rest)) && st.last === 'card' && st.lastTarget) {
    const to = targetPhrase(m[1], env.x);
    if (!to || to.length !== 1) return refuse(clause, `"${m[1]}" isn't one target`);
    return {
      targets: to,
      run: (g, ctx, i, memo) => {
        // Its own target comes after the creature's, which the clause before chose.
        const c = memo.last ? permanent(g, memo.last.id) : undefined;
        if (c && isCreature(g, c)) memo.dealt += dealDamage(g, c, ctx.targets[i], stats(g, c).power);
      },
    };
  }
  // "Exile target player's graveyard": every card in it (406.2), as one event (603.2c).
  if (rest === "exile target player's graveyard" || rest === 'exile all graveyards' || rest === "exile each opponent's graveyard") {
    const targeted = rest.includes('target');
    return {
      targets: targeted ? [{ type: 'player', label: 'target player' }] : [],
      run: (g, ctx, i) => {
        const whose = targeted ? [refPlayer(g, ctx.targets[i])].filter((p) => !!p).map((p) => p!.id) : rest.includes('each opponent') ? opponentsOf(g, ctx.you).map((p) => p.id) : living(g).map((p) => p.id);
        const cards = whose.flatMap((p) => g.players[p].graveyard);
        if (whose.length === 1) exileAll(g, [...cards], `${says(g.players[whose[0]], 'exiles')} ${their(g.players[whose[0]])} graveyard.`, whose[0]);
        else exileAll(g, [...cards]);
      },
    };
  }
  // Destroy (701.8), exile (701.13), return to its owner's hand (400.6), tap and untap (701.26).
  if ((m = /^(destroy|exile|tap|untap) (.+)$/.exec(rest)) || (m = /^(return) (.+) to (?:its|their) owners?'s? hands?$/.exec(rest))) {
    const verb = m[1];
    const o = mustObjects(m[2], env, st, clause);
    if (o.targets.some((t) => t.type === 'player' || t.type === 'any' || t.type === 'player or planeswalker')) return refuse(clause, `can't ${verb} a player`);
    if (o.zone === 'stack' && verb !== 'return') return refuse(clause, `can't ${verb} a spell`);
    if (o.zone === 'graveyard' && verb !== 'exile') return refuse(clause, `can't ${verb} a card in a graveyard`);
    if (o.targets.some((t) => t.type === 'spell or permanent') && verb !== 'return') return refuse(clause, `can't ${verb} a spell`);
    acted(st, o);
    if (verb === 'destroy') st.destroyed = true;
    const mixed = o.targets.some((t) => t.type === 'spell or permanent');
    return {
      targets: o.targets,
      reuse: o.reuse,
      run: (g, ctx, i, memo) => {
        if (mixed || o.zone === 'stack') {
          // "Return target spell or nonland permanent to its owner's hand": a spell returned isn't countered; a copy ceases to exist (707.10a).
          const r = ctx.targets[i];
          const item = refStack(g, r);
          if (item) {
            remember(g, memo, item.card, item.controller);
            log(g, `${cardData(item.card.name).name} returns to its owner's hand.`, item.controller, [item.card]);
            moveCard(g, item.card, 'hand');
            return;
          }
          const c = refCard(g, r);
          remember(g, memo, c);
          bounce(g, c);
          return;
        }
        const cards = actOn(g, ctx, i, memo, o);
        if (verb === 'destroy') destroyMany(g, cards);
        else if (verb === 'exile') exileAll(g, cards);
        else if (verb === 'return') simultaneously(g, () => cards.forEach((c) => bounce(g, c)));
        else if (verb === 'tap') cards.forEach((c) => tap(g, c));
        else cards.forEach((c) => untap(g, c));
      },
    };
  }
  // "Return target creature card from your graveyard to your hand / to the battlefield [tapped]" (400.6).
  if ((m = /^return (.+?) (?:from your graveyard )?to (?:your hand|the battlefield( tapped)?(?: under your control)?)$/.exec(rest)) && /card/.test(m[1])) {
    const phrase = /graveyard/.test(m[1]) ? m[1] : `${m[1]} from your graveyard`;
    const o = mustObjects(phrase, env, st, clause);
    if (o.zone !== 'graveyard') return refuse(clause, `"${m[1]}" isn't a card in a graveyard`);
    const toHand = /to your hand$/.test(rest);
    const tapped = !!m[2];
    const yours = / under your control$/.test(rest) || o.targets.every((t) => t.who === 'you');
    if (!toHand && !yours) return refuse(clause, 'returning a card to the battlefield under its owner\'s control');
    acted(st, o);
    return {
      targets: o.targets,
      run: (g, ctx, i, memo) => {
        const cards = o.cards(g, ctx, i, memo);
        if (toHand) for (const c of cards) moveCard(g, c, 'hand');
        else for (const c of cards) enterBattlefield(g, c, { tapped, controller: ctx.you });
      },
    };
  }
  // +1/+1 and -1/-1 counters (122).
  if ((m = new RegExp(`^put ${NUM} ([+-]1/[+-]1) counters? on (.+)$`).exec(rest))) {
    const n = count(m[1], env.x, clause);
    const kind = m[2];
    if (kind !== '+1/+1' && kind !== '-1/-1') return refuse(clause, `a ${kind} counter`);
    const o = mustObjects(m[3], env, st, clause);
    if (o.zone !== 'battlefield' || o.targets.some((t) => t.type !== 'creature' && t.type !== 'permanent')) return refuse(clause, `"${m[3]}" isn't a target or group of permanents`);
    acted(st, o);
    return { targets: o.targets, reuse: o.reuse, run: (g, ctx, i, memo) => actOn(g, ctx, i, memo, o).forEach((c) => addCounters(g, c, n(g, ctx, memo), kind)) };
  }
  // "Target creature you control gains protection from the color of your choice until end of turn" (702.16): the colour is chosen as it resolves.
  if ((m = /^(target .+?) gains protection from the color of your choice until end of turn$/.exec(rest))) {
    const o = mustObjects(m[1], env, st, clause);
    if (!o.single || o.targets.some((t) => t.type !== 'creature')) return refuse(clause, `"${m[1]}" isn't one target creature`);
    acted(st, o);
    return {
      targets: o.targets,
      choose: (g, ctx, i, memo, q) => {
        const [c] = actOn(g, ctx, i, memo, o);
        if (!c) return false;
        nameCard(g, ctx.you, { text: `Choose a colour: ${cardData(c.name).name} gains protection from it until end of turn.`, of: 'color', then: q.then, data: { ...q.data, id: c.id, moves: c.moves } });
        return true;
      },
      after: (g, c) => {
        const card = permanent(g, c.data.id as string);
        if (!card || card.moves !== c.data.moves) return;
        pump(g, card, 0, 0, [protectionFrom(c.name as Color)]);
        log(g, `${cardData(card.name).name} gains ${protectionFrom(c.name as Color)} until end of turn.`, card.controller, [card]);
      },
    };
  }
  // "Gain trample and get +X/+X until end of turn" (Craterhoof Behemoth): the same, the other way round.
  if ((m = /^(.+?) gains? (.+?) and gets? ([+-](?:\d+|x))\/([+-](?:\d+|x)) until end of turn$/.exec(rest))) {
    const keywords = keywordList(m[2]) ?? refuse(clause, `can't grant "${m[2]}"`);
    return pumpEffect(m[1], signed(m[3], env, clause), signed(m[4], env, clause), keywords, env, st, clause);
  }
  // "[Target creature / this / group] gets +N/+N [and gains K] until end of turn" (611.2a, 611.2c).
  if ((m = /^(?:until end of turn, )?(.+?) gets? ([+-](?:\d+|x))\/([+-](?:\d+|x))(?: and gains? (.+?))?(?: until end of turn)?$/.exec(rest)) && (/until end of turn/.test(rest))) {
    const [p, t] = [signed(m[2], env, clause), signed(m[3], env, clause)];
    const keywords = m[4] ? (keywordList(m[4]) ?? refuse(clause, `can't grant "${m[4]}"`)) : [];
    return pumpEffect(m[1], p, t, keywords, env, st, clause);
  }
  if ((m = /^(?:until end of turn, )?(.+?) gains? (.+?)(?: until end of turn)?$/.exec(rest)) && /until end of turn/.test(rest)) {
    const keywords = keywordList(m[2]) ?? refuse(clause, `can't grant "${m[2]}"`);
    return pumpEffect(m[1], zero, zero, keywords, env, st, clause);
  }
  if ((m = /^(.+?) can't block this turn$/.exec(rest))) return pumpEffect(m[1], zero, zero, [CANT_BLOCK], env, st, clause);
  if ((m = /^(.+?) can't be blocked this turn$/.exec(rest))) return pumpEffect(m[1], zero, zero, [CANT_BE_BLOCKED], env, st, clause);
  // Create tokens (111.2): listed ones, or ones the text describes.
  if ((m = /^create (.+?)(?: for each (.+))?$/.exec(rest))) {
    const made = tokenList(m[1], env.x, clause);
    const each = m[2] ? (counted(m[2], env.x) ?? refuse(clause, `"for each ${m[2]}"`)) : null;
    return { targets: [], run: (g, ctx, _i, memo) => void createTokens(g, ctx.you, made.map((t) => ({ key: t.key, count: t.n(g, ctx, memo) * (each ? each(g, ctx, memo) : 1) }))) };
  }
  // Mana from a spell or ability that isn't a mana ability (Dark Ritual, 106.1, 605.1).
  if ((m = /^add ((?:\{[wubrgc]\})+)$/.exec(rest))) {
    const syms = m[1].slice(1, -1).split('}{').map((s) => s.toUpperCase() as ManaSym);
    return { targets: [], run: (g, ctx) => addMana(g, ctx.you, syms, ctx.self) };
  }
  // Populate (701.36).
  if (rest === 'populate') return { targets: [], run: (g, ctx) => void populate(g, ctx.you) };
  // Amass [subtype] N (701.47a): with several Armies the player chooses one, and the rest of the ability waits.
  if ((m = new RegExp(`^amass ([a-z]+) ${NUM}$`).exec(rest)) && subtypeOf(m[1]) && CREATURE_TYPES.includes(subtypeOf(m[1])!)) {
    const subtype = subtypeOf(m[1])!;
    const n = count(m[2], env.x, clause);
    return { targets: [], choose: (g, ctx, _i, memo, q) => amass(g, ctx.you, subtype, n(g, ctx, memo), q.then, q.data), after: () => {} };
  }
  // "Move a counter from target permanent you control onto a second target permanent" (122.5): two
  // instances of "target", so the same one may be chosen twice (115.3), and then nothing moves.
  // Its controller chooses the kind as it resolves when the first has several.
  if ((m = /^move a counter from (target .+?) onto a second (target .+)$/.exec(rest))) {
    const [from, to] = [targetPhrase(m[1], env.x), targetPhrase(m[2], env.x)];
    const permanentSpec = (s: TargetSpec[] | null) => s?.length === 1 && !s[0].optional && (s[0].type === 'creature' || s[0].type === 'permanent');
    if (!permanentSpec(from) || !permanentSpec(to)) return refuse(clause, 'moving a counter between anything but two target permanents');
    return {
      targets: [from![0], to![0]],
      choose: (g, ctx, i, _m, q) => {
        const [a, b] = [refCard(g, ctx.targets[i]), refCard(g, ctx.targets[i + 1])];
        const kinds = a && b && a.id !== b.id ? counterKinds(a.counters) : [];
        if (kinds.length === 1) moveCounter(g, a, b, kinds[0]);
        if (kinds.length <= 1) return false;
        nameCard(g, ctx.you, { text: `Choose the kind of counter to move from ${cardData(a!.name).name} onto ${cardData(b!.name).name}.`, of: 'counter', options: kinds, then: q.then, data: { ...q.data, from: a!.id, to: b!.id } });
        return true;
      },
      after: (g, c) => void moveCounter(g, permanent(g, c.data.from as string), permanent(g, c.data.to as string), c.name),
    };
  }
  // Proliferate (701.34a): the player chooses any number of permanents and/or players with counters as it resolves.
  if (rest === 'proliferate') {
    return {
      targets: [],
      choose: (g, ctx, _i, _m, q) => proliferate(g, ctx.you, { then: q.then, data: q.data }),
      after: (g, c) => proliferated(g, c.chooser, c.picked, c.pickedPlayers ?? []),
    };
  }
  if (rest === 'investigate') return { targets: [], run: (g, ctx) => void createToken(g, ctx.you, 'Clue') };
  if (/^take an extra turn after this one$/.test(rest)) return { targets: [], run: (g, ctx) => extraTurn(g, ctx.you) };
  // "You may cast spells this turn as though they had flash."
  if (rest === 'cast spells this turn as though they had flash') return { targets: [], run: (g, ctx) => addEffect(g, { kind: 'flash', player: ctx.you }) };
  // "Your opponents can't cast spells this turn."
  if (rest === "your opponents can't cast spells this turn") return { targets: [], run: (g, ctx) => opponentsOf(g, ctx.you).forEach((p) => addEffect(g, { kind: 'cantCast', player: p.id })) };
  // "It can't be regenerated" (701.19c): nothing in the game regenerates, so there is nothing to stop.
  if (/^(?:it|they|that creature|those creatures) can't be regenerated$/.test(rest) && st.destroyed) return { targets: [], run: () => {} };
  return refuse(clause, 'no template matches');
}

const zero: Num = () => 0;

/** "Gets +N/+N and gains K until end of turn" on a target, this, "it", or a group (611.2c: the group as it starts). */
function pumpEffect(phrase: string, p: Num, t: Num, keywords: string[], env: Env, st: State, clause: string): Read {
  const o = mustObjects(phrase, env, st, clause);
  // A permanent that isn't a creature may gain a keyword ("target permanent you control gains hexproof"), but not +N/+N.
  const keywordsOnly = keywords.length && p === zero && t === zero;
  if (o.zone !== 'battlefield' || o.targets.some((x) => x.type !== 'creature' && !(keywordsOnly && x.type === 'permanent'))) return refuse(clause, `"${phrase}" isn't a target creature or group`);
  acted(st, o);
  return {
    targets: o.targets,
    reuse: o.reuse,
    run: (g, ctx, i, memo) => actOn(g, ctx, i, memo, o).filter((c) => keywordsOnly || isCreature(g, c)).forEach((c) => pump(g, c, p(g, ctx, memo), t(g, ctx, memo), keywords)),
  };
}

/** Damage to a target, a group, players, or several of them at once, as one event (120, 603.2c). */
function damageTo(phrase: string, n: Num, source: (g: Game, ctx: Ctx, i: number) => Card | undefined, env: Env, st: State, clause: string): Read {
  // "each opponent", "each player", "each creature and each player", "each creature you don't control and each opponent".
  const parts = phrase.split(/ and (?=each )/);
  const groups: ((g: Game, ctx: Ctx) => { players: PlayerId[]; cards: Card[] })[] = [];
  let targets: TargetSpec[] = [];
  let single = false;
  for (const part of parts) {
    if (part === 'each opponent') groups.push((g, ctx) => ({ players: opponentsOf(g, ctx.you).map((p) => p.id), cards: [] }));
    else if (part === 'you' && parts.length === 1) groups.push((_g, ctx) => ({ players: [ctx.you], cards: [] }));
    else if (part === 'each player') groups.push((g) => ({ players: living(g).map((p) => p.id), cards: [] }));
    else if (part === 'each other player') groups.push((g, ctx) => ({ players: living(g).map((p) => p.id).filter((p) => p !== ctx.you), cards: [] }));
    else if (parts.length === 1 && targetPhrase(part, env.x)) {
      targets = targetPhrase(part, env.x)!;
      single = targets.length === 1;
    } else {
      const group = groupPhrase(part, env.x) ?? refuse(clause, `"${part}" isn't a target or group the parser knows`);
      groups.push((g, ctx) => ({ players: [], cards: group(g, ctx) }));
    }
  }
  if (targets.some((t) => t.type === 'graveyard card' || t.type === 'spell' || t.type === 'spell or permanent')) return refuse(clause, `can't deal damage to "${phrase}"`);
  if (single) {
    st.last = targets[0].type === 'creature' ? 'card' : null;
    st.lastTarget = st.last === 'card';
  } else if (groups.length) st.last = 'group';
  return {
    targets,
    run: (g, ctx, i, memo) => {
      const src = source(g, ctx, i);
      if (!src) return;
      const amount = n(g, ctx, memo);
      if (targets.length) {
        simultaneously(g, () => chosen(ctx, i, targets).forEach((r) => void (memo.dealt += dealDamage(g, src, r, amount))));
        return;
      }
      const all = groups.map((f) => f(g, ctx));
      memo.group = all.flatMap((x) => x.cards.map((c) => c.id));
      simultaneously(g, () => {
        for (const x of all) {
          for (const c of x.cards) memo.dealt += damageCard(g, src, permanent(g, c.id), amount);
          for (const p of x.players) memo.dealt += damagePlayer(g, src, p, amount);
        }
      });
    },
  };
}

/** Verbs that start a new clause after "and": "you draw a card and you lose 1 life", "gain 1 life and draw a card". */
const CLAUSE_START =
  /\s+and\s+(?=(?:you |target |each opponent |each player |its controller |that player |they |draws? |gains? (?:\d+|x|life|that much|one|two|three|four|five|six|seven|eight|nine|ten)\b|loses? |mills? |discards? |sacrifices? |creates? |create |put |destroy |exile |return |surveil |scry |search |tap |untap |~ deals |it deals |(?:[a-z-]+ )*creatures (?:you|your opponents) control get ))/;

/** "X, where X is the number of creatures you control": the sentence's X. */
function whereX(sentence: string, env: Env, clause: string): { sentence: string; env: Env } {
  const m = /^(.*), where x is (.+)$/.exec(sentence);
  if (!m) return { sentence, env };
  const n = amountPhrase(m[2], { ...env, x: null }, { who: null, last: null, lastTarget: false }, clause);
  return { sentence: m[1], env: { ...env, x: n } };
}

/**
 * Reads an ability's effect text, sentence by sentence and clause by clause. "You may"
 * starts an optional part that the player is asked about each time (608.2d): the rest of
 * the ability waits for the answer. "Then" starts a new step of the same sentence.
 */
function effects(text: string, env: Env): Effect[] {
  const out: Effect[] = [];
  const st: State = { who: null, last: null, lastTarget: false };
  /** An earlier sentence said "if this is the first time this ability has resolved this turn": "if it's the second time" follows on. */
  let counting = false;
  // "Draw N cards, then discard N cards" is one template; other ", then" join two clauses.
  const sentences = text
    .replace(/\.$/, '')
    .split(/\.\s+/)
    .map((x) => x.replace(/^then /, ''));
  // "Look at the top N cards ... . Put ..." is one template across two sentences.
  for (let k = 0; k < sentences.length - 1; k++) {
    if (/^look at the top \S+ cards of your library$/.test(sentences[k]) && /^(put|you may reveal)/.test(sentences[k + 1])) {
      const more = /^you may reveal/.test(sentences[k + 1]) && /^put the rest/.test(sentences[k + 2] ?? '') ? 2 : 1;
      sentences.splice(k, more + 1, sentences.slice(k, k + more + 1).join('. '));
    }
    if (/^copy target .+ spell$/.test(sentences[k]) && sentences[k + 1] === 'you may choose new targets for the copy') sentences.splice(k, 2, `${sentences[k]}. ${sentences[k + 1]}`);
    // Sentences that finish the one before: the extra turn's end, a token's ability, mana that stays.
    const next = sentences[k + 1];
    if (next === "at the beginning of that turn's end step, you lose the game" && sentences[k] === 'take an extra turn after this one') sentences.splice(k, 2, `${sentences[k]}. ${next}`);
    else if (/^create .+ token$/.test(sentences[k]) && /^it has "[^"]+"$/.test(next ?? '')) sentences.splice(k, 2, `${sentences[k]} with ${next.slice('it has '.length)}`);
    else if (next === "until end of turn, you don't lose this mana as steps and phases end" && /(?:^| and )add (?:\{[wubrgc]\})+$/.test(sentences[k])) sentences.splice(k, 2, `${sentences[k]}. ${next}`);
    else if (/^you may pay (?:(?:\{[^}]+\})+|\d+ life)$/.test(sentences[k]) && /^if you do, /.test(next ?? '')) sentences.splice(k, 2, `${sentences[k]}. ${next}`);
    // "You may discard your hand. If you do, draw four cards" (Sauron): discarding a hand can always be done once chosen, even an empty one, so "if you do" is the same "you may".
    else if (sentences[k] === 'you may discard your hand' && /^if you do, /.test(next ?? '')) sentences.splice(k, 2, `you may discard your hand and ${next.slice('if you do, '.length)}`);
    else if (/^counter target .+ spell$/.test(sentences[k]) && next === "if that spell is countered this way, exile it instead of putting it into its owner's graveyard") sentences.splice(k, 2, `${sentences[k]}. ${next}`);
    else if (/^(?:that player|its controller) may pay (?:\{[^}]+\})+$/.test(sentences[k]) && /^if (?:the player|they|that player) (?:doesn't|don't), /.test(next ?? '')) {
      // "That player may pay {2}. If the player doesn't, you create a Treasure token" is "... unless that player pays {2}" (118.12a).
      const pay = /^(that player|its controller) may pay ((?:\{[^}]+\})+)$/.exec(sentences[k])!;
      sentences.splice(k, 2, `${next.replace(/^if (?:the player|they|that player) (?:doesn't|don't), /, '')} unless ${pay[1]} pays ${pay[2]}`);
    }
  }
  for (const raw of sentences) {
    const read = whereX(raw, env, raw);
    let sentence = read.sentence;
    // "If you control four or more lands, untap that land": checked as it resolves (608.2c). Only a condition the parser reads.
    let onlyIf: Cond | undefined;
    const iff = /^if (.+?), (.+)$/.exec(sentence);
    // "If this is the second time this ability has resolved this turn, you draw two cards", "You gain 4 life if this is the
    // first time ...", and then "If it's the second time, add {R}{G}{W}{U}" (Omnath): only an ability resolves (608.2).
    const time = ' time this ability has resolved this turn';
    let nth: RegExpExecArray | null;
    if ((nth = new RegExp(`^if this is the ${ORDINAL}${time}, (.+)$`).exec(sentence)) || (counting && (nth = new RegExp(`^if it's the ${ORDINAL} time, (.+)$`).exec(sentence)))) {
      onlyIf = resolvedTime(ORDINALS[nth[1]]);
      sentence = nth[2];
    } else if ((nth = new RegExp(`^(.+) if this is the ${ORDINAL}${time}$`).exec(sentence))) {
      onlyIf = resolvedTime(ORDINALS[nth[2]]);
      sentence = nth[1];
    } else if (iff && condition(iff[1]) && !/ instead$/.test(iff[2])) {
      onlyIf = condition(iff[1])!;
      sentence = iff[2];
    }
    if (nth) {
      if (!env.permanent) refuse(raw, 'a spell counting how many times "this ability" has resolved');
      counting = true;
    }
    let may = false;
    let asker: Effect['asker'];
    let mayPay: { cost?: string; life?: number } | undefined;
    // "You may pay {4}. If you do, untap this artifact" (608.2d, 118.12): the payment is the "may".
    const pay = /^you may pay (?:((?:\{[^}]+\})+)|(\d+) life)\. if you do, (.+)$/.exec(sentence);
    if (pay) {
      if (pay[1] && !/^(\{(\d+|[wubrgc])\})+$/.test(pay[1])) refuse(raw, `the payment "${pay[1]}"`);
      may = true;
      mayPay = pay[1] ? { cost: pay[1].toUpperCase() } : { life: parseInt(pay[2], 10) };
      sentence = pay[3];
    }
    const mayWho = pay ? null : /^(you|its controller|that player|that land's controller) may (.+)$/.exec(sentence.replace(/^that land's controller may /, 'its controller may '));
    if (mayWho) {
      may = true;
      sentence = mayWho[2];
      if (mayWho[1] === 'its controller') {
        if (!st.last) refuse(raw, '"its controller" without an object before it');
        asker = (g, _c, _i, m) => (m.last && !g.players[m.last.controller].lost ? m.last.controller : null);
        sentence = `its controller ${sentence}`;
      } else if (mayWho[1] === 'that player' && !read.env.ev?.player && st.last === 'card') {
        // "That player may search" after "destroy target ... an opponent controls": its controller.
        asker = (g, _c, _i, m) => (m.last && !g.players[m.last.controller].lost ? m.last.controller : null);
        sentence = `its controller ${sentence}`;
      } else if (mayWho[1] === 'that player') {
        if (!read.env.ev?.player) refuse(raw, '"that player" without a player to refer to');
        asker = (g, _c, _i, m) => (m.ev.player !== null && !g.players[m.ev.player].lost ? m.ev.player : null);
        sentence = `that player ${sentence}`;
      }
    }
    st.who = null;
    // "Until end of turn, A and B": each part lasts until end of turn (611.2a).
    const eot = /^until end of turn, (?!you don't lose)/.test(sentence);
    if (eot) sentence = sentence.slice('until end of turn, '.length);
    // Clauses join with "and", or with ", then" (one after the other); the subject carries on.
    // "Draw N cards, then discard N cards", searches ("..., then shuffle") and looks at the top of a library are one template each.
    const whole = /^look at the top|^search (?:your|their) library|mana as steps and phases end$|^take an extra turn/.test(sentence);
    const clauses = whole ? [sentence] : sentence.split(CLAUSE_START).flatMap((c) => (/^draw \S+ cards?, then discard/.test(c) || /then shuffle/.test(c) ? [c] : c.split(/, then /)));
    clauses.forEach((written, k) => {
      const clause = eot && !/until end of turn/.test(written) ? `${written} until end of turn` : written;
      // In a permanent's ability, "it deals" and "it gets" mean the permanent when nothing else came before.
      const c = read.env.permanent && !st.last && !read.env.ev?.object ? clause.replace(/^it (deals|gets|gains|fights) /, '~ $1 ') : clause;
      const mayPart = may && k === 0 ? { may, ...(asker ? { asker } : {}), ...(mayPay ? { mayPay } : {}) } : may && k > 0 ? { joined: true } : {};
      // "[Effect] unless [that player / its controller] pays {N}": the player is asked first (118.12a); the effect, a "you may" too, only if they don't pay.
      const unless = /^(?!counter )(.+) unless (that player|its controller) pays ((?:\{[0-9x]+\})+)$/.exec(c);
      if (unless) {
        if (unless[2] === 'that player' && !read.env.ev?.player) refuse(clause, '"that player" without a player to refer to');
        if (unless[2] === 'its controller' && !st.last) refuse(clause, '"its controller" without an object before it');
        if (unless[3].includes('{x}') && !read.env.x) refuse(clause, 'X outside a cost');
        const inner = effect(unless[1], read.env, st);
        const payer = unless[2];
        const cost = unless[3];
        const asked = unless[1];
        out.push({
          targets: [],
          text: clause,
          choose: (g, ctx, _i, memo, q) => {
            const who = payer === 'that player' ? memo.ev.player : (memo.last?.controller ?? null);
            if (who === null || g.players[who].lost) return !!(memo.paid = false);
            const mana = cost === '{x}' ? `{${memo.x}}` : cost.toUpperCase();
            const name = cardData(ctx.self.name).name;
            ask(g, who, { text: `Pay ${mana} for ${name}? If you don't: ${asked.replace(/~/g, name)}.`, cost: mana, yes: `Pay ${mana}`, no: "Don't Pay", then: q.then, data: q.data });
            return true;
          },
          after: (_g, c2, _i, memo) => void (memo.paid = c2.yes),
        });
        out.push({ ...inner, text: unless[1], unlessPaid: true, ...(may && k === 0 ? { may, ...(asker ? { asker } : {}) } : may && k > 0 ? { joined: true } : {}) });
        return;
      }
      const e = effect(c, read.env, st);
      out.push({ ...e, text: clause, ...mayPart, ...(onlyIf ? { onlyIf } : {}) });
    });
  }
  return out;
}

/** Built ability: its targets, in order, and what it does. */
interface Built {
  targets: TargetSpec[];
  /** `base`: where `ctx.targets` start in the stack object's targets, for a mode of a modal spell or ability. */
  run: (g: Game, ctx: Ctx, base?: number) => void;
}

/** What a trigger's event tells its ability: "that player", "that much", "that creature". */
type EventOf = (ctx: Ctx) => Memo['ev'];
const noEvent: EventOf = () => ({ player: null, amount: 0, id: null });

/**
 * Builds what an ability does from its effects: its targets, in order, and a function that
 * runs them. A "you may" effect asks first, and an effect that waits for a choice asks it;
 * either way the rest of the ability goes on in a continuation (`then[key...]`) once the
 * answer comes, so everything happens in printed order (608.2c).
 */
/** A continuation's context with this ability's own share of the targets, and its memo. */
const c0 = (whole: ThenCtx): { c: ThenCtx; m: Memo } => {
  const m = whole.data.m as Memo;
  return { m, c: m.base ? { ...whole, targets: whole.targets.slice(m.base) } : whole };
};

function build(list: Effect[], key: string, name: string, then: Then, bots: Bots, ev: EventOf = noEvent): Built {
  const targets: TargetSpec[] = [];
  let lastTarget = -1;
  const steps = list.map((e) => {
    const base = targets.length;
    const i = e.reuse ? lastTarget : base;
    if (e.reuse && lastTarget < 0) refuse(e.text, '"it" without a target before it');
    targets.push(...e.targets.map((t) => (t.distinctFrom !== undefined ? { ...t, distinctFrom: t.distinctFrom + base } : t)));
    if (e.targets.length) lastTarget = base;
    return { ...e, i };
  });
  // "Any number of target ..." must be the ability's last target (TargetSpec.any).
  if (targets.slice(0, -1).some((t) => t.any)) refuse(list[0].text, 'targets after "any number of target"');
  const endOf = (s: number) => {
    let end = s + 1;
    while (end < steps.length && steps[end].joined) end++;
    return end;
  };
  const questions: string[] = [];
  const runFrom = (from: number, g: Game, ctx: Ctx, m: Memo, answered = -1): void => {
    for (let s = from; s < steps.length; s++) {
      const step = steps[s];
      if (step.onlyIf && !step.onlyIf(g, ctx.self, ctx.you)) {
        if (step.may) s = endOf(s) - 1;
        continue;
      }
      // "[Effect] unless [player] pays [cost]": the effect only if they didn't (118.12a).
      if (step.unlessPaid && m.paid) {
        if (step.may) s = endOf(s) - 1;
        continue;
      }
      if (step.may && s !== answered) {
        const who = step.asker ? step.asker(g, ctx, step.i, m) : ctx.you;
        if (who === null) {
          s = endOf(s) - 1;
          continue;
        }
        const pay = step.mayPay;
        const price = pay?.cost ?? (pay?.life ? `${pay.life} life` : '');
        ask(g, who, { text: questions[s], ...(pay?.cost ? { cost: pay.cost } : {}), ...(pay?.life ? { life: pay.life } : {}), yes: price ? `Pay ${price}` : 'Yes', no: price ? "Don't Pay" : 'No', then: `${key}.${s}`, data: { m } });
        return;
      }
      if (step.choose) {
        if (step.choose(g, ctx, step.i, m, { then: `${key}.c${s}`, data: { m } }, s === steps.length - 1)) return;
        continue;
      }
      step.run!(g, ctx, step.i, m);
    }
  };
  steps.forEach((step, s) => {
    if (step.choose) {
      then[`${key}.c${s}`] = (g, whole) => {
        const m = c0(whole).m;
        const c = c0(whole).c;
        const q: Resume = { then: `${key}.c${s}`, data: { ...whole.data, m } };
        if (step.after!(g, c, step.i, m, q) !== false) runFrom(s + 1, g, c, m);
      };
      if (step.bot) bots[`${key}.c${s}`] = step.bot;
    }
    if (!step.may) return;
    const end = endOf(s);
    const text = steps.slice(s, end).map((x) => x.text).join(' and ').replace(/~/g, name);
    const pay = step.mayPay;
    questions[s] = pay ? `Pay ${pay.cost ?? `${pay.life} life`} to ${text}?` : `${text[0].toUpperCase()}${text.slice(1)}?`;
    then[`${key}.${s}`] = (g, whole) => {
      const { c, m } = c0(whole);
      if (c.yes) runFrom(s, g, c, m, s);
      else runFrom(end, g, c, m);
    };
  });
  return {
    targets,
    run: (g, ctx, base = 0) => runFrom(0, g, ctx, { x: ctx.x ?? ctx.self.cast?.x ?? 0, base, ev: ev(ctx), last: null, lost: 0, dealt: 0, ...(ctx.sacrificedPower?.length ? { sacPower: ctx.sacrificedPower[0] } : {}) }),
  };
}

// ---------- costs and mana abilities ----------

/** "{T}", "{2}{R}", "Pay 2 life", "Sacrifice this creature", "Sacrifice a creature", "Discard a card", "Exile this", "Remove a counter" (602.1a, 118). */
function cost(text: string, line: string): { cost: ActivatedAbility['cost']; x: boolean; fromHand: boolean } {
  const out: ActivatedAbility['cost'] = {};
  let x = false;
  let fromHand = false;
  for (const part of text.split(/,\s*/)) {
    let m: RegExpExecArray | null;
    if (part === '{t}' && !out.tap) out.tap = true;
    else if ((m = /^pay (\d+) life$/.exec(part)) && !out.life) out.life = parseInt(m[1], 10); // paid only with that much life (119.4)
    else if (/^(\{([0-9]+|[wubrgcx]|[wubrg]\/[wubrg])\})+$/.test(part) && !out.mana) {
      out.mana = part.toUpperCase();
      x = part.includes('{x}');
    } else if (part === 'sacrifice ~') out.sacrifice = true;
    else if (part === 'exile ~') out.exileSelf = true;
    else if (part === 'discard ~') {
      out.discardSelf = true;
      fromHand = true;
    } else if ((m = /^discard (a|two|three) cards?$/.exec(part)) && !out.discard) out.discard = NUMBERS[m[1]];
    else if ((m = /^exile (a|two|three) cards? from your graveyard$/.exec(part)) && !out.exileGraveyard) out.exileGraveyard = NUMBERS[m[1]];
    else if ((m = /^remove (a|an|one|two|three) ([+-]1\/[+-]1|[a-z]+) counters? from ~$/.exec(part)) && !out.counters) out.counters = { kind: m[2], n: NUMBERS[m[1]] };
    else if ((m = /^sacrifice (a|an|another|two|three|four|five|six|seven|eight|nine|ten) (.+)$/.exec(part)) && !out.sacrificeOne) {
      const n = NUMBERS[m[1]] ?? 1;
      const o = object(m[2], n > 1 ? 'many' : 'one', null);
      if (!o || o.zone !== 'battlefield') return refuse(line, `the cost "${part}"`);
      const another = m[1] === 'another';
      out.sacrificeOne = {
        type: o.type,
        who: 'you',
        label: part.replace('sacrifice ', ''),
        filter: (g, c, self) => (!another || c.id !== self.id) && o.test(g, c, self, 0),
      };
      if (n > 1) out.sacrificeCount = n;
    } else if ((m = /^exile (a|an|another) (.+) you control$/.exec(part)) && !out.exileOne) {
      const o = object(m[2], 'one', null);
      if (!o || o.zone !== 'battlefield') return refuse(line, `the cost "${part}"`);
      const another = m[1] === 'another';
      out.exileOne = { type: o.type, who: 'you', label: part.replace('exile ', ''), filter: (g, c, self) => (!another || c.id !== self.id) && o.test(g, c, self, 0) };
    } else return refuse(line, `the cost "${part}"`);
  }
  return { cost: out, x, fromHand };
}

const BASIC_TYPES = ['plains', 'island', 'swamp', 'mountain', 'forest'];

/** "One mana of any color that a land an opponent controls could produce" (106.7): worked out each time. */
const opponentLandColors = (g: Game, self: Card): ManaSym[] => {
  const out = new Set<ManaSym>();
  for (const o of opponentsOf(g, self.controller)) for (const c of o.battlefield) if (isLand(g, c)) landColors(g, c).forEach((x) => x !== 'C' && out.add(x));
  return [...out];
};

/**
 * "Add {G}.", "Add {C}{C}.", "Add {W} or {B}.", "Add {W}, {U}, or {B}.", "Add one mana of
 * any color.", "Add three mana of any one color." (106, 605), then optionally "This deals 1
 * damage to you." (a pain land or Talisman) or "Activate only if [condition]." (602.5b).
 */
function manaEffect(text: string): ManaAbility | null {
  let rest = text;
  const extra: Partial<ManaAbility> = {};
  let m = / ~ deals (\d+) damage to you\.$/.exec(rest);
  if (m) {
    extra.damage = parseInt(m[1], 10);
    rest = rest.slice(0, m.index) + (rest[m.index - 1] === '.' ? '' : '.');
  }
  m = / activate only if you control an? (\w+) or an? (\w+)\.$/.exec(rest);
  if (m && BASIC_TYPES.includes(m[1]) && BASIC_TYPES.includes(m[2])) {
    const types = [m[1], m[2]].map(capital);
    extra.when = (g, self) => g.players[self.controller].battlefield.some((c) => types.some((t) => hasType(g, c, t)));
    rest = rest.slice(0, m.index + 1);
  } else if ((m = / activate only if (.+)\.$/.exec(rest))) {
    const cond = condition(m[1]);
    if (!cond) return null;
    extra.when = (g, self) => cond(g, self, self.controller);
    rest = rest.slice(0, m.index + 1);
  }
  if ((m = / activate only as an instant\.$/.exec(rest))) {
    extra.instant = true;
    rest = rest.slice(0, m.index + 1);
  }
  // "Spend this mana only to cast a legendary spell[, and that spell can't be countered]", "... instant and sorcery spells" (106.6).
  if ((m = / spend this mana only to cast a legendary spell(, and that spell can't be countered)?\.$/.exec(rest))) {
    extra.legendary = true;
    if (m[1]) extra.uncounterable = true;
    rest = rest.slice(0, m.index + 1);
  } else if ((m = / spend this mana only to cast (instant and sorcery|creature|artifact) spells\.$/.exec(rest))) {
    extra.types = m[1] === 'instant and sorcery' ? ['Instant', 'Sorcery'] : [capital(m[1])];
    rest = rest.slice(0, m.index + 1);
  }
  const base = baseMana(rest.trim());
  return base && { ...base, ...extra };
}

function baseMana(text: string): ManaAbility | null {
  if (text === 'add one mana of any color.') return { amount: 1, colors: 'any' };
  if (text === "add one mana of any color in your commander's color identity.") return { amount: 1, colors: 'identity' };
  if (text === 'add one mana of any color that a land an opponent controls could produce.') return { amount: 1, colors: opponentLandColors };
  // "Any one color": all of it the same colour (106.1b), as a ManaAbility makes it.
  let m = new RegExp(`^add ${NUM} mana of any one color\\.$`).exec(text);
  if (m && m[1] !== 'x') return { amount: /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : NUMBERS[m[1]], colors: 'any' };
  m = /^add ((?:\{[wubrgc]\})+)\.$/.exec(text);
  if (m) {
    const syms = m[1].slice(1, -1).split('}{').map((x) => x.toUpperCase() as ManaSym);
    if (syms.every((x) => x === syms[0])) return { amount: syms.length, colors: [syms[0]] };
    // "Add {W}{U}." (a Signet): exactly that mana.
    return { amount: syms.length, colors: [...new Set(syms)], produces: [syms] };
  }
  // "Add {W}{W}, {W}{B}, or {B}{B}." (a filter land): one of those lists.
  m = /^add ((?:\{[wubrgc]\})+(?:, (?:\{[wubrgc]\})+)*,? or (?:\{[wubrgc]\})+)\.$/.exec(text);
  if (m) {
    const produces = m[1].split(/,? or |, /).map((o) => o.slice(1, -1).split('}{').map((x) => x.toUpperCase() as ManaSym));
    if (produces.some((o) => o.length !== produces[0].length)) return null;
    if (produces[0].length > 1) return { amount: produces[0].length, colors: [...new Set(produces.flat())], produces };
  }
  m = /^add \{([wubrgc])\} or \{([wubrgc])\}\.$/.exec(text);
  if (m) return { amount: 1, colors: [m[1].toUpperCase(), m[2].toUpperCase()] as ManaSym[] };
  m = /^add \{([wubrg])\}, \{([wubrg])\}, or \{([wubrg])\}\.$/.exec(text);
  if (m) return { amount: 1, colors: [m[1], m[2], m[3]].map((x) => x.toUpperCase()) as ManaSym[] };
  return null;
}

/**
 * A mana ability's cost (605.1a): "{T}", mana and "{T}" (a Signet's "{1}, {T}"), "{T}, Pay
 * 1 life", "{T}, Sacrifice this", "Sacrifice this", "Tap an untapped creature you control",
 * "Discard a card", "{T}, Sacrifice a creature", "Exile this card from your hand". Null if
 * it is none of these.
 */
function manaCost(text: string): Partial<ManaAbility> | null {
  const parts = text.split(/, /);
  const out: Partial<ManaAbility> = { noTap: true };
  for (const part of parts) {
    let m: RegExpExecArray | null;
    if (part === '{t}' && out.noTap) delete out.noTap;
    else if ((m = /^((?:\{(?:\d+|[wubrgc]|[wubrg]\/[wubrg])\})+)$/.exec(part)) && !out.cost) out.cost = m[1].toUpperCase();
    else if ((m = /^pay (\d+) life$/.exec(part)) && !out.life) out.life = parseInt(m[1], 10);
    else if (part === 'sacrifice ~') out.sacrifice = true;
    else if (part === 'tap an untapped creature you control' && out.noTap) out.tapCreature = {};
    else if (part === 'tap an untapped legendary creature you control' && out.noTap) out.tapCreature = { legendary: true };
    else if (part === 'discard a card') out.discard = 1;
    else if (part === 'sacrifice a creature') out.sacrificeCreature = true;
    else if (part === 'exile ~ from your hand' && parts.length === 1) out.fromHand = true;
    else return null;
  }
  // "Tap an untapped creature" replaces {T}; nothing else may go without a tap but these (605.1a).
  if (out.noTap && !out.sacrifice && !out.tapCreature && !out.discard && !out.fromHand && !out.sacrificeCreature) return null;
  if (out.tapCreature) delete out.noTap;
  return out;
}

// ---------- static abilities and lines about the card itself ----------

type StaticFn = (g: Game, self: Card, c: Card) => StaticBonus | null;

/** "Other Elf creatures you control", "creatures you control", "other creatures you control": who a lord's line is about. */
function lordGroup(text: string): ((g: Game, self: Card, c: Card) => boolean) | null {
  const m = /^(other )?(.+?) you control$/.exec(text);
  if (!m) return null;
  const o = object(m[2], 'many', null);
  if (!o || o.zone !== 'battlefield') return null;
  const other = !!m[1];
  return (g, self, c) =>
    (!other || c.id !== self.id) &&
    c.controller === self.controller &&
    (o.type !== 'creature' || isCreature(g, c)) &&
    (o.type !== 'creature or planeswalker' || isCreature(g, c) || isPlaneswalker(g, c)) &&
    o.test(g, c, self, 0);
}

/** "Gets +N/+N", "has flying", "gets +1/+1 and has trample", "can't block": a static bonus. */
function bonusOf(text: string): StaticBonus | null {
  let m = /^gets? ([+-]\d+)\/([+-]\d+)(?:,? and (?:has|have) (.+))?$/.exec(text);
  if (m) {
    const keywords = m[3] ? keywordList(m[3]) : [];
    if (!keywords) return null;
    return { power: parseInt(m[1], 10), toughness: parseInt(m[2], 10), ...(keywords.length ? { keywords } : {}) };
  }
  // 'Lands you control have "{T}: Add one mana of any color."': a mana ability from another permanent (613.1f).
  if ((m = /^(?:has|have) "(\{t\}): (add .+\.)"$/.exec(text))) {
    const add = manaEffect(m[2]);
    return add && !add.when ? { mana: add } : null;
  }
  // "Have 'Ward—Pay 2 life.'", "has ward {2}": ward from another permanent (702.21, 613.1f).
  if ((m = /^(?:has|have) "ward—pay (\d+) life\."$/.exec(text))) return { ward: { life: parseInt(m[1], 10) } };
  if ((m = /^(?:has|have) ward (\{\d+\})$/.exec(text))) return { ward: { mana: m[1] } };
  if ((m = /^(?:has|have) (.+)$/.exec(text))) {
    const keywords = keywordList(m[1]);
    return keywords && { keywords };
  }
  if ((m = /^can't be blocked(?: and has (.+))?$/.exec(text))) {
    const keywords = m[1] ? keywordList(m[1]) : [];
    return keywords && { keywords: [CANT_BE_BLOCKED, ...keywords] };
  }
  if (text === "can't block" || text === "can't attack or block" || text === "can't attack") {
    return { keywords: text === "can't block" ? [CANT_BLOCK] : text === "can't attack" ? [CANT_ATTACK] : [CANT_ATTACK, CANT_BLOCK] };
  }
  return null;
}

/**
 * Static abilities that change permanents (611.3a, 613): "[Other] [Elf] creatures you control
 * get +N/+N [and have K]", "Enchanted creature gets ...", "Equipped creature has ...", "This
 * creature can't be blocked", "This creature gets +1/+1 for each artifact you control".
 */
function staticLine(line: string, d: CardData): StaticFn | null {
  let m = /^(.+?) (gets? .+|ha(?:s|ve) "[^"]+"|ha(?:s|ve) .+|can't be blocked(?: and has .+)?|can't block|can't attack(?: or block)?)\.$/.exec(line) ?? /^(.+?) (ha(?:s|ve) "[^"]+\.")$/.exec(line);
  if (m) {
    const bonus = bonusOf(m[2]);
    if (bonus) {
      if (m[1] === 'enchanted creature' && d.typeLine.includes('Aura')) return (g, self, c) => (isCreature(g, c) ? attachedBonus(bonus)(g, self, c) : null);
      if (m[1] === 'equipped creature' && d.typeLine.includes('Equipment')) return attachedBonus(bonus);
      if (m[1] === '~' && d.typeLine.includes('Creature')) return (_g, self, c) => (c.id === self.id ? bonus : null);
      const who = lordGroup(m[1]);
      if (who) return (g, self, c) => (who(g, self, c) ? bonus : null);
    }
  }
  // "Protection from white and from black" (702.16a, 702.16g): the permanent's own protection abilities.
  if (/^protection from /.test(line) && !d.typeLine.includes('Instant') && !d.typeLine.includes('Sorcery')) {
    const keywords = keywordList(line);
    if (keywords?.length && keywords.every((k) => k.startsWith('protection from '))) return (_g, self, c) => (c.id === self.id ? { keywords } : null);
  }
  // "This creature can't be blocked", "... attacks each combat if able" (509.1b, 508.1d).
  if ((line === "~ can't be blocked." || line === '~ attacks each combat if able.') && d.typeLine.includes('Creature')) {
    const kw = line === "~ can't be blocked." ? CANT_BE_BLOCKED : MUST_ATTACK;
    return (_g, self, c) => (c.id === self.id ? { keywords: [kw] } : null);
  }
  // "This creature gets +1/+1 for each [permanent] you control" (613.4c), counted as the layer applies.
  if ((m = /^~ gets \+(\d+)\/\+(\d+) for each (.+)\.$/.exec(line)) && d.typeLine.includes('Creature')) {
    const [p, t] = [parseInt(m[1], 10), parseInt(m[2], 10)];
    const n = counted(m[3], null);
    if (!n) return null;
    return (g, self, c) => {
      if (c.id !== self.id) return null;
      const k = n(g, { self, you: self.controller, targets: [] }, blankMemo());
      return { power: p * k, toughness: t * k };
    };
  }
  // "Each land is a Swamp in addition to its other land types" (305.7, 613.1d).
  if ((m = /^each land is an? (plains|island|swamp|mountain|forest) in addition to its other land types\.$/.exec(line))) {
    const type = capital(m[1]);
    return (g, _self, c) => (isLand(g, c) ? { subtypes: [type] } : null);
  }
  return null;
}

/** "Other creatures", "artifacts you control", "creatures": who a type-changing line is about, every player's unless it says whose. */
function typesGroup(text: string): ((g: Game, self: Card, c: Card) => boolean) | null {
  const lord = lordGroup(text);
  if (lord) return lord;
  const m = /^(other )?(.+)$/.exec(text)!;
  const o = object(m[2], 'many', null);
  if (!o || o.zone !== 'battlefield' || o.who) return null;
  const other = !!m[1];
  return (g, self, c) => (!other || c.id !== self.id) && (o.type !== 'creature' || isCreature(g, c)) && o.test(g, c, self, 0);
}

/** "Food artifacts", "Foods", "an artifact": the card types and subtypes a type-changing line adds (205.1b). */
function addedTypes(phrase: string, plural: boolean): { types: string[]; subtypes: string[] } | null {
  const words = phrase.split(' ');
  const last = words.pop()!;
  const noun = NOUNS[last];
  const types: string[] = [];
  const subtypes: string[] = [];
  if (noun) {
    if (!noun.type || noun.plural !== plural) return null;
    types.push(noun.type);
  } else {
    const sub = subtypeOf(last);
    if (!sub || (last === sub.toLowerCase()) === plural) return null;
    subtypes.push(sub);
  }
  // Words in front: subtypes ("Food artifacts") or card types ("artifact creatures"), singular.
  for (const w of words) {
    const sub = subtypeOf(w);
    if (NOUNS[w] && NOUNS[w].type && !NOUNS[w].plural) types.unshift(NOUNS[w].type);
    else if (sub && w === sub.toLowerCase()) subtypes.unshift(sub);
    else return null;
  }
  return { types, subtypes };
}

/** The lines of a card's Oracle text as printed, reminder text gone: the words a granted ability shows. */
const printedLines = (d: CardData) =>
  d.oracleText
    .replace(/\([^)]*\)/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * An activated ability a static ability gives other permanents, in quotes (113.1a, 613.1f):
 * "have '{2}, {T}, Sacrifice this permanent: You gain 3 life.'" Its script is registered under
 * a name of its own, which the static ability's `activatedOf` names; "this permanent" in it is
 * the permanent that has it. Returns that name.
 */
function grantedActivated(quote: string, original: string, d: CardData, n: number): string {
  const act = /^([^:"]+): (.+)$/.exec(quote);
  if (!act || /^(when|whenever|at) /.test(quote)) return refuse(original, `the ability "${quote}"`);
  const r = restrictions(act[2], original);
  if (manaEffect(r.body)) return refuse(original, 'a mana ability given this way');
  const paid = cost(act[1], original);
  if (paid.fromHand) return refuse(original, `the cost "${act[1]}"`);
  const name = `${d.name} (ability ${n + 1})`;
  const then: Then = {};
  const bots: Bots = {};
  const { targets, run } = build(effects(r.body, { permanent: true, x: paid.x ? (_g, ctx) => ctx.x ?? 0 : null, typeLine: '' }), `g${n}`, d.name, then, bots);
  const text = /"([^"]+)"/.exec(printedLines(d)[n] ?? '')?.[1] ?? quote;
  registerScripts({
    [name]: {
      activated: { cost: paid.cost, ...(r.sorcery ? { sorcery: true } : {}), ...(r.when ? { when: r.when } : {}), ...(targets.length ? { targets } : {}), text, resolve: run },
      ...(Object.keys(then).length ? { then } : {}),
      ...(Object.keys(bots).length ? { botChoice: bots } : {}),
    },
  });
  return name;
}

/**
 * "Other creatures are Food artifacts in addition to their other types and have '{2}, {T},
 * Sacrifice this permanent: You gain 3 life.'", "Artifacts you control are Foods in addition to
 * their other types ...": card types and subtypes added in layer 4 (205.1b, 613.1d), and an
 * activated ability in layer 6 (613.1f), to the same set of objects (613.6).
 */
function typesLine(text: string, original: string, d: CardData, n: number): StaticFn | null {
  const m = /^(.+?) (is|are) (?:an? )?(.+?) in addition to (?:its|their) other types(?:\.| and (?:has|have) "([^"]+)")$/.exec(text);
  if (!m) return null;
  const who = typesGroup(m[1]);
  const added = addedTypes(m[3], m[2] === 'are');
  if (!who || !added) return null;
  const lent = m[4] ? grantedActivated(m[4], original, d, n) : undefined;
  const parts: LayerParts = {
    ...(added.types.length ? { types: added.types } : {}),
    ...(added.subtypes.length ? { subtypes: added.subtypes } : {}),
    ...(lent ? { activatedOf: [lent] } : {}),
  };
  return (g, self, c) => (who(g, self, c) ? parts : null);
}

const landsOf = (g: Game, pid: PlayerId) => g.players[pid].battlefield.filter((x) => isLand(g, x));

/**
 * "This land enters tapped unless [condition]": the conditions, checked as it enters
 * (614.1c), from the side of the player it enters under. It is on the battlefield by then,
 * so "other lands" leaves it out.
 */
const UNLESS: [RegExp, (m: RegExpExecArray) => (g: Game, c: Card, you: PlayerId) => boolean][] = [
  [
    new RegExp(`^you control ${NUM} or more other (lands|plains|islands|swamps|mountains|forests)$`),
    (m) => {
      const n = NUMBERS[m[1]] ?? parseInt(m[1], 10);
      const type = m[2] === 'lands' ? 'Land' : subtypeOf(m[2])!;
      return (g, c, you) => g.players[you].battlefield.filter((x) => x.id !== c.id && hasType(g, x, type)).length >= n;
    },
  ],
  [/^you control two or more basic lands$/, () => (g, c, you) => landsOf(g, you).filter((x) => x.id !== c.id && hasType(g, x, 'Basic')).length >= 2],
  [/^you control a basic land$/, () => (g, c, you) => landsOf(g, you).some((x) => x.id !== c.id && hasType(g, x, 'Basic'))],
  // Players who have left the game aren't opponents any more (800.4a).
  [/^you have two or more opponents$/, () => (g, _c, you) => opponentsOf(g, you).length >= 2],
  [/^your opponents control eight or more lands$/, () => (g, _c, you) => opponentsOf(g, you).reduce((n, o) => n + landsOf(g, o.id).length, 0) >= 8],
  [
    /^you control an? (plains|island|swamp|mountain|forest)(?: or an? (plains|island|swamp|mountain|forest))?$/,
    (m) => (g, c, you) => g.players[you].battlefield.some((x) => x.id !== c.id && [m[1], m[2]].filter(Boolean).some((t) => hasType(g, x, capital(t)))),
  ],
  [/^you control a legendary creature$/, () => (g, c, you) => g.players[you].battlefield.some((x) => x.id !== c.id && isCreature(g, x) && hasType(g, x, 'Legendary'))],
];

/**
 * "As this land enters, you may pay N life. If you don't, it enters tapped." A replacement
 * effect with a choice (614.12a): the player can pay only with that much life (119.4).
 */
const payLifeEnter = (n: number): Pick<CardScript, 'replaceEnter' | 'then' | 'botChoice'> => ({
  replaceEnter: (g, c, controller) => {
    ask(g, controller, { text: `Pay ${n} life, or ${cardData(c.name).faces ? 'it' : c.name} enters tapped.`, life: n, yes: `Pay ${n} Life`, no: 'Enter Tapped', then: 'shock', script: c.id });
    return true;
  },
  then: { shock: (g, { self, yes, data }) => finishEnter(g, self, data, { tapped: !yes }) },
  // A bot pays on its own turn while it has life to spare.
  botChoice: { shock: (g, pid) => ({ type: 'answer', yes: g.active === pid && g.players[pid].life > 15 }) },
});

/**
 * "As this land enters, you may reveal a Forest or Island card from your hand. If you
 * don't, this land enters tapped." (614.12a)
 */
const revealEnter = (types: string[]): Pick<CardScript, 'replaceEnter' | 'then' | 'entersTapped'> => ({
  // With no such card to reveal, it just enters tapped.
  entersTapped: (g, c, you) => !g.players[you].hand.some((x) => x.id !== c.id && types.some((t) => hasType(g, x, t))),
  replaceEnter: (g, c, controller) => {
    const fits = g.players[controller].hand.filter((x) => x.id !== c.id && types.some((t) => hasType(g, x, t)));
    if (!fits.length) return false;
    pickCards(g, controller, fits, { min: 0, max: 1, text: `you may reveal ${types.map((t) => `a ${t}`).join(' or ')} card, or this land enters tapped`, button: 'Reveal', then: 'reveal', script: c.id });
    return true;
  },
  then: {
    reveal: (g, { self, picked, data, chooser }) => {
      if (picked.length) log(g, `${says(g.players[chooser], 'reveals')} ${picked.map((x) => cardData(x.name).name).join(', ')}.`, chooser, picked);
      finishEnter(g, self, data, { tapped: !picked.length });
    },
  },
});

/** A memo for an amount counted outside an ability (a static ability, a cost). */
const blankMemo = (): Memo => ({ x: 0, base: 0, ev: { player: null, amount: 0, id: null }, last: null, lost: 0, dealt: 0 });

/** Adds a replacement effect to the card's `replaces`, each line its own effect (614.1, 616.1). */
function addReplacement(script: CardScript, r: NonNullable<CardScript['replaces']>) {
  const had = script.replaces;
  script.replaces = had
    ? (g, self, ev) => {
        const out = [had(g, self, ev), r(g, self, ev)].flatMap((x) => (Array.isArray(x) ? x : x ? [x] : []));
        return out.length ? out : null;
      }
    : r;
}

const addActivated = (script: CardScript, ab: ActivatedAbility) => {
  const had = script.activated ? (Array.isArray(script.activated) ? script.activated : [script.activated]) : [];
  script.activated = [...had, ab];
};

/** "Artifact spells", "creature spells", "instant and sorcery spells", "Dragon spells", "red spells": the spells a cost line is about. */
function spellKind(words: string): ((g: Game, c: Card) => boolean) | null {
  if (words === '') return () => true;
  if (words === 'instant and sorcery') return (g, c) => hasType(g, c, 'Instant') || hasType(g, c, 'Sorcery');
  const tests = words.split(' ').map((w) => (w in COLOR_WORDS ? (g: Game, c: Card) => isColor(g, c, COLOR_WORDS[w]) : modifier(w)));
  if (tests.some((t) => !t)) return null;
  return (g, c) => tests.every((t) => (t as (g: Game, c: Card) => boolean)(g, c));
}

/**
 * Lines that change how the card is cast or enters, or that apply while it is on the
 * battlefield: they add to the script and return true. Lines it doesn't know return false.
 */
function cardLine(text: string, original: string, d: CardData, script: CardScript, then: Then): boolean {
  let m: RegExpExecArray | null;
  // "As an additional cost to cast this spell, discard a card / pay N life / sacrifice a creature." (118.8, 119.4)
  if ((m = /^as an additional cost to cast ~, (discard (a|two|three) cards?|pay (\d+) life|sacrifice (a|an) (.+?))\.$/.exec(text))) {
    if (m[2]) script.additionalCost = { discard: NUMBERS[m[2]] };
    else if (m[3]) script.additionalCost = { life: parseInt(m[3], 10) };
    else {
      const o = object(m[5], 'one', null);
      if (!o || o.zone !== 'battlefield') return refuse(original, `the additional cost "sacrifice ${m[4]} ${m[5]}"`);
      script.additionalCost = { sacrifice: { type: o.type, who: 'you', label: `${m[4]} ${m[5]}`, filter: o.test } };
    }
    return true;
  }
  // "This land enters tapped." (614.1c)
  if (text === '~ enters tapped.') {
    script.entersTapped = true;
    return true;
  }
  if ((m = /^~ enters tapped unless (.+)\.$/.exec(text))) {
    const unless = m[1];
    for (const [re, make] of UNLESS) {
      const hit = re.exec(unless);
      if (!hit) continue;
      const ok = make(hit);
      script.entersTapped = (g, c, you) => !ok(g, c, you);
      return true;
    }
    return refuse(original, `no template for "unless ${unless}"`);
  }
  if ((m = /^as ~ enters, you may pay (\d+) life\. if you don't, it enters tapped\.$/.exec(text))) {
    const pay = payLifeEnter(parseInt(m[1], 10));
    script.replaceEnter = pay.replaceEnter;
    Object.assign(then, pay.then);
    script.botChoice = { ...script.botChoice, ...pay.botChoice };
    return true;
  }
  if ((m = /^as ~ enters, you may reveal an? (plains|island|swamp|mountain|forest) or (plains|island|swamp|mountain|forest) card from your hand\. if you don't, ~ enters tapped\.$/.exec(text))) {
    const reveal = revealEnter([capital(m[1]), capital(m[2])]);
    script.replaceEnter = reveal.replaceEnter;
    script.entersTapped = reveal.entersTapped;
    Object.assign(then, reveal.then);
    return true;
  }
  // "This creature enters with N +1/+1 counters on it." (614.1c, 122.6)
  if ((m = new RegExp(`^~ enters with ${NUM} ([+-]1/[+-]1|[a-z]+) counters? on it\\.$`).exec(text)) && m[1] !== 'x') {
    script.entersWith = { ...script.entersWith, [m[2]]: NUMBERS[m[1]] ?? parseInt(m[1], 10) };
    return true;
  }
  // "You have no maximum hand size." (402.2)
  if (text === 'you have no maximum hand size.') {
    script.noMaxHandSize = true;
    return true;
  }
  // "This spell can't be countered." (101.2)
  if (text === "~ can't be countered.") {
    script.uncounterable = true;
    return true;
  }
  // "This doesn't untap during your untap step." (502.3)
  if (text === "~ doesn't untap during your untap step.") {
    script.noUntap = true;
    return true;
  }
  // "Skip your draw step." (614.1b, 614.10)
  if (text === 'skip your draw step.') {
    script.skipDrawStep = true;
    return true;
  }
  // "Red spells you cast cost {1} less to cast", "Artifact spells you cast cost {1} less", "Noncreature spells cost {1} more" (601.2f): generic mana only.
  // "... cost {1} less to cast for each +1/+1 counter on this creature" (Animar): counted as the cost is worked out.
  if ((m = /^(?:(.+?) )?spells (you cast|your opponents cast|) ?cost \{(\d+)\} (less|more) to cast(?: for each (.+))?\.$/.exec(text))) {
    const kind = spellKind(m[1] ?? '');
    if (!kind) return refuse(original, `no template for "${m[1]} spells"`);
    const whose = m[2];
    const n = parseInt(m[3], 10) * (m[4] === 'less' ? -1 : 1);
    const per = m[5] ? (counted(m[5], null) ?? refuse(original, `"for each ${m[5]}"`)) : null;
    script.costModifier = (g, self, spell, caster) =>
      (whose === 'you cast' ? caster === self.controller : whose === 'your opponents cast' ? caster !== self.controller : true) && kind(g, spell)
        ? n * (per ? per(g, { self, you: self.controller, targets: [] }, blankMemo()) : 1)
        : 0;
    return true;
  }
  // "If you control a commander, you may cast this spell without paying its mana cost." An alternative cost (118.9).
  if (text === 'if you control a commander, you may cast ~ without paying its mana cost.') {
    const alt = { label: 'free: you control a commander', mana: '', when: (g: Game, self: Card) => g.players[self.controller].battlefield.some((c) => c.isCommander) };
    script.alternativeCosts = [...(script.alternativeCosts ?? []), alt];
    return true;
  }
  // Cycling [cost] (702.29a), or basic land typecycling (702.29e), activated from the hand.
  if ((m = /^(plains|island|swamp|mountain|forest)?cycling ((?:\{[0-9wubrgc]\})+)$/.exec(text))) {
    const mana = m[2].toUpperCase();
    addActivated(script, m[1] ? typecycling(capital(m[1]), mana) : cycling(mana));
    return true;
  }
  // Kicker [cost] (702.33a): an optional additional cost. What it changes is read with "if this spell was kicked".
  if ((m = /^(multi)?kicker ((?:\{[0-9wubrgcx]\})+)$/.exec(text))) {
    script.kicker = { mana: m[2].toUpperCase(), ...(m[1] ? { multi: true } : {}) };
    return true;
  }
  // Offspring (702.175a), dash (702.109a), evoke (702.74a), plot (702.170a): costs the engine applies.
  if ((m = /^offspring ((?:\{[0-9wubrgc]\})+)$/.exec(text))) {
    script.offspring = m[1].toUpperCase();
    return true;
  }
  if ((m = /^(dash|evoke) ((?:\{[0-9wubrgc]\})+)$/.exec(text))) {
    const mana = m[2].toUpperCase();
    script.alternativeCosts = [...(script.alternativeCosts ?? []), { label: `${capital(m[1])} ${mana}`, mana, ...(m[1] === 'dash' ? { dash: true } : { evoke: true }) }];
    return true;
  }
  if ((m = /^plot ((?:\{[0-9wubrgc]\})+)$/.exec(text))) {
    script.plot = m[1].toUpperCase();
    return true;
  }
  // Overload [cost] (702.96a): an alternative cost; the spell's text is read again with "each" for "target" (702.96b).
  if ((m = /^overload ((?:\{[0-9wubrgc]\})+)$/.exec(text)) && (d.typeLine.includes('Instant') || d.typeLine.includes('Sorcery'))) {
    const mana = m[1].toUpperCase();
    script.alternativeCosts = [...(script.alternativeCosts ?? []), { label: `Overload ${mana}`, mana, overload: true }];
    return true;
  }
  // Basic landcycling [cost] (702.29e): "[Cost], Discard this card: Search your library for a basic land card, reveal it, put it into your hand, then shuffle."
  if ((m = /^basic landcycling ((?:\{[0-9wubrgc]\})+)$/.exec(text))) {
    const mana = m[1].toUpperCase();
    addActivated(script, {
      cost: { mana, discardSelf: true },
      fromHand: true,
      text: `Basic landcycling ${mana}`,
      resolve: (g, { you }) => search(g, you, 'hand', { basic: true, types: ['Land'], label: 'a basic land card' }, { reveal: true }),
    });
    return true;
  }
  // Flashback [cost] (702.34a): mana only.
  if ((m = /^flashback ((?:\{[0-9wubrgc]\})+)$/.exec(text))) {
    script.flashback = m[1].toUpperCase();
    return true;
  }
  // "Escape—{cost}, Exile N other cards from your graveyard." (702.138a)
  if ((m = new RegExp(`^escape—((?:\\{[0-9wubrgc]\\})+), exile ${NUM} other cards from your graveyard\\.$`).exec(text)) && m[2] !== 'x') {
    script.escape = { mana: m[1].toUpperCase(), exile: NUMBERS[m[2]] ?? parseInt(m[2], 10) };
    return true;
  }
  // Ward {N}, "Ward—Pay N life." (702.21a)
  if ((m = /^ward (\{\d+\})$/.exec(text)) || (m = /^ward—pay (\d+) life\.$/.exec(text))) {
    script.ward = m[1].startsWith('{') ? { mana: m[1] } : { life: parseInt(m[1], 10) };
    return true;
  }
  // "Ward—Sacrifice a Food.", "Ward—Sacrifice a legendary artifact or legendary creature." (702.21a): a permanent of the payer's.
  if ((m = /^ward—sacrifice (a|an) (.+?)\.$/.exec(text))) {
    const o = object(m[2], 'one', null);
    if (!o || o.zone !== 'battlefield' || o.who || o.type === 'creature or planeswalker') return refuse(original, `the ward cost "sacrifice ${m[1]} ${m[2]}"`);
    script.ward = { sacrifice: { type: o.type, label: original.slice('Ward—Sacrifice '.length).replace(/\.$/, ''), filter: o.test } };
    return true;
  }
  // "Partner with [name]" (702.124j): the deck rule pairs the two; the card also gets the ability "When this permanent enters, target player may search their library for a card named [name] ...".
  if ((m = /^partner with (.+)$/.exec(text)) && d.typeLine.includes('Legendary')) {
    const name = original.slice('Partner with '.length);
    if (name.toLowerCase() !== m[1]) return refuse(original, 'partner with a name the parser can\'t read');
    const p = partnerWith(name);
    addTrigger(script, 'onEnter', { ...(p.onEnter as AnyTrigger), targets: p.targets });
    Object.assign(then, p.then);
    script.botChoice = { ...script.botChoice, ...p.botChoice };
    return true;
  }
  // "Activated abilities of Foods you control cost {1} less to activate." (602.2b, 601.2f): generic mana only, never below {0}.
  if ((m = /^activated abilities of (.+?) you control cost \{(\d+)\} (less|more) to activate\.$/.exec(text))) {
    const o = object(m[1], 'many', null);
    if (!o || o.zone !== 'battlefield' || o.who) return refuse(original, `"activated abilities of ${m[1]}"`);
    const n = parseInt(m[2], 10) * (m[3] === 'less' ? -1 : 1);
    script.abilityCostModifier = (g, self, src, pid) => (src.controller === self.controller && pid === self.controller && (o.type !== 'creature' || isCreature(g, src)) && o.test(g, src, self, 0) ? n : 0);
    return true;
  }
  // "Ward—Blight N." (702.21a, 701.68a): paid by putting N -1/-1 counters on a creature the player controls.
  if ((m = /^ward—blight (\d+)\.?$/.exec(text))) {
    script.ward = { blight: parseInt(m[1], 10) };
    return true;
  }
  // Equip [cost] (702.6a), crew N (702.122a).
  if ((m = /^equip ((?:\{[0-9wubrgc]\})+)$/.exec(text)) && d.typeLine.includes('Equipment')) {
    addActivated(script, equip(m[1].toUpperCase()));
    return true;
  }
  if ((m = /^crew (\d+)$/.exec(text)) && d.typeLine.includes('Vehicle')) {
    addActivated(script, crew(parseInt(m[1], 10)));
    return true;
  }
  // Enchant [object] (702.5a, 303.4a): the Aura spell's target, and what it may be attached to.
  if ((m = /^enchant (.+)$/.exec(text)) && d.typeLine.includes('Aura')) {
    const o = object(m[1], 'one', null);
    if (!o || o.zone !== 'battlefield') return refuse(original, `"enchant ${m[1]}"`);
    script.enchant = specFor(o, `target ${m[1]}`);
    return true;
  }
  // Afterlife N (702.135a): "When this permanent dies, create N 1/1 white and black Spirit creature tokens with flying."
  if ((m = /^afterlife (\d+)$/.exec(text))) {
    const n = parseInt(m[1], 10);
    addTrigger(script, 'onDies', { resolve: (g, { you }) => void createToken(g, you, 'Spirit 1/1 flying WB', n), targets: [], text: original });
    return true;
  }
  // "Creatures your opponents control enter tapped", "Artifacts and creatures your opponents control enter tapped." (614.1c)
  if ((m = /^(.+) your opponents control enter tapped\.$/.exec(text))) {
    const o = object(m[1], 'many', null);
    if (!o || o.zone !== 'battlefield') return false;
    script.entersTappedFor = (g, self, c) => c.controller !== self.controller && (o.type !== 'creature' || isCreature(g, c)) && o.test(g, c, self, 0);
    return true;
  }
  // "You may cast spells as though they had flash." / "... creature spells ..." (601.3e)
  if ((m = /^you may cast (?:(.+?) )?spells as though they had flash\.$/.exec(text))) {
    const kind = spellKind(m[1] ?? '');
    if (!kind) return false;
    script.grantsFlash = (g, self, pid, spell) => pid === self.controller && kind(g, spell);
    return true;
  }
  // "Spells you control can't be countered", "Creature spells you control can't be countered."
  if ((m = /^(?:(.+?) )?spells you control can't be countered\.$/.exec(text))) {
    const kind = spellKind(m[1] ?? '');
    if (!kind) return false;
    script.protectsSpell = (g, self, spell, caster) => caster === self.controller && kind(g, spell);
    return true;
  }
  // "Untap this during each other player's untap step", "Untap all artifacts you control during each other player's untap step." (502.3)
  if (text === "untap ~ during each other player's untap step.") {
    script.untapsOthersTurn = (_g, self, c) => c.id === self.id;
    return true;
  }
  if ((m = /^untap all (.+) you control during each other player's untap step\.$/.exec(text))) {
    const o = object(m[1], 'many', null);
    if (!o || o.zone !== 'battlefield') return false;
    script.untapsOthersTurn = (g, self, c) => c.controller === self.controller && (o.type !== 'creature' || isCreature(g, c)) && o.test(g, c, self, 0);
    return true;
  }
  // "This creature's power and toughness are each equal to the number of Swamps you control" (604.3, 613.4a).
  if ((m = /^~'s power and toughness are each equal to (.+)\.$/.exec(text)) || (m = /^~'s power is equal to (.+)\.$/.exec(text))) {
    const both = /are each equal/.test(text);
    const n = amountPhrase(m[1], { permanent: true, x: null, typeLine: d.typeLine }, { who: null, last: null, lastTarget: false }, original);
    const printed = parseInt(d.toughness ?? '0', 10) || 0;
    script.basePT = (g, self) => {
      const k = n(g, { self, you: self.controller, targets: [] }, blankMemo());
      return { power: k, toughness: both ? k : printed };
    };
    return true;
  }
  // "This spell costs {1} less to cast for each creature on the battlefield", "... {X} less to cast, where X is ..." (601.2f).
  if ((m = /^~ costs \{(\d+)\} less to cast for each (.+)\.$/.exec(text)) || (m = /^~ costs \{(x)\} less to cast, where x is (.+)\.$/.exec(text))) {
    const per = m[1] === 'x' ? 1 : parseInt(m[1], 10);
    const n = m[1] === 'x' ? amountPhrase(m[2], { permanent: false, x: null, typeLine: d.typeLine }, { who: null, last: null, lastTarget: false }, original) : (counted(m[2], null) ?? refuse(original, `"for each ${m[2]}"`));
    script.costReduction = (g, self) => per * n(g, { self, you: self.controller, targets: [] }, blankMemo());
    return true;
  }
  // "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you" (508.1g).
  // Attacking your planeswalker isn't attacking you (506.3).
  if ((m = /^creatures can't attack you unless their controller pays (\{\d+\}) for each creature they control that's attacking you\.$/.exec(text))) {
    const tax = m[1];
    script.attackTax = (_g, self, _attacker, defender, target) => (defender === self.controller && target === null ? tax : null);
    return true;
  }
  // "During your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments." (101.2)
  if (text === "during your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments.") {
    script.forbids = (g, self, pid, act) => g.active === self.controller && pid !== self.controller && (act.kind === 'cast' || ['Artifact', 'Creature', 'Enchantment'].some((x) => hasType(g, act.card, x)));
    return true;
  }
  if (text === "your opponents can't cast spells during your turn.") {
    script.forbids = (g, self, pid, act) => g.active === self.controller && pid !== self.controller && act.kind === 'cast';
    return true;
  }
  // Alternative costs (118.9): "[If condition, ]you may [pay N life / exile a blue card from your hand / sacrifice a ...] rather than pay this spell's mana cost."
  if ((m = /^(?:if (.+?), )?you may (.+) rather than pay ~'s mana cost\.$/.exec(text))) {
    const cond = m[1] ? condition(m[1]) : null;
    if (m[1] && !cond) return refuse(original, `the condition "if ${m[1]}"`);
    const alt: NonNullable<CardScript['alternativeCosts']>[number] = { label: capital(m[2]), mana: '', ...(cond ? { when: (g: Game, self: Card) => cond(g, self, self.controller) } : {}) };
    for (const part of m[2].split(' and ')) {
      let k: RegExpExecArray | null;
      if ((k = /^pay (\d+) life$/.exec(part)) && !alt.life) alt.life = parseInt(k[1], 10);
      else if ((k = /^exile an? (.+?) card from your hand$/.exec(part)) && !alt.exile) {
        const o = object(`${k[1]} card in your graveyard`, 'one', null);
        if (!o) return refuse(original, `the alternative cost "${part}"`);
        alt.exile = { label: `a ${k[1]} card`, filter: (g, c, self) => c.id !== self.id && o.test(g, c, self, 0) };
      } else if ((k = /^sacrifice an? (.+)$/.exec(part)) && !alt.sacrifice) {
        const o = object(k[1], 'one', null);
        if (!o || o.zone !== 'battlefield') return refuse(original, `the alternative cost "${part}"`);
        alt.sacrifice = { type: o.type, who: 'you', label: `a ${k[1]}`, filter: o.test };
      } else return refuse(original, `the alternative cost "${part}"`);
    }
    script.alternativeCosts = [...(script.alternativeCosts ?? []), alt];
    return true;
  }
  // Counters put on permanents you control, doubled or one more (614.1a, 122.6).
  if (text === 'if an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.') {
    addReplacement(script, (_g, self, ev) => (ev.kind === 'counters' && !ev.by && ev.card.controller === self.controller ? { instead: { ...ev, n: ev.n * 2 } } : null));
    return true;
  }
  if (text === 'if one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.') {
    addReplacement(script, (g, self, ev) => (ev.kind === 'counters' && ev.counter === '+1/+1' && ev.card.controller === self.controller && isCreature(g, ev.card) ? { instead: { ...ev, n: ev.n + 1 } } : null));
    return true;
  }
  // "If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead." (614.1a)
  if (text === 'if an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.' || text === 'if one or more tokens would be created under your control, twice that many of those tokens are created instead.') {
    addReplacement(script, (_g, self, ev) => (ev.kind === 'tokens' && ev.player === self.controller ? { instead: { ...ev, tokens: ev.tokens.map((t) => ({ ...t, count: t.count * 2 })) } } : null));
    return true;
  }
  return false;
}

// ---------- triggers (603) ----------

type AnyTrigger = Exclude<Trigger<object>, (...a: never[]) => unknown>;

/** Adds a triggered ability to a hook, making a list when the card has several for one event (603.2). */
function addTrigger(script: CardScript, hook: TriggerHook, t: AnyTrigger) {
  const s = script as Record<string, unknown>;
  const had = s[hook] as AnyTrigger | AnyTrigger[] | undefined;
  s[hook] = had ? [...(Array.isArray(had) ? had : [had]), t] : t;
}

/** What a trigger's event phrase means: the hook, which events count, and what "that player" and "that much" refer to. */
interface TrigEvent {
  hook: TriggerHook;
  when?: (g: Game, e: Record<string, unknown> & { self: Card }) => boolean;
  ev?: EventOf;
  env?: Env['ev'];
}

const yours = (pick: (e: Record<string, unknown>) => unknown) => (_g: Game, e: Record<string, unknown> & { self: Card }) => pick(e) === e.self.controller;
const playerEv =
  (key: string, amount?: string): EventOf =>
  (ctx) => ({ player: ((ctx as unknown as Record<string, unknown>)[key] as PlayerId) ?? null, amount: amount ? (((ctx as unknown as Record<string, unknown>)[amount] as number) ?? 0) : 0, id: null });
const objectEv =
  (key: string): EventOf =>
  (ctx) => {
    const c = (ctx as unknown as Record<string, unknown>)[key] as Card | undefined;
    return { player: c ? c.controller : null, amount: 0, id: c?.id ?? null, ...(c ? { card: c } : {}) };
  };
const isOpp = (g: Game, you: PlayerId, p: unknown) => typeof p === 'number' && p !== you && !g.players[p].lost;

/** "A creature", "another nontoken creature you control", "a creature an opponent controls": which object an event is about. */
function aboutObject(phrase: string): ((g: Game, c: Card, self: Card) => boolean) | null {
  const m = /^(?:a|an|another) (.+)$/.exec(phrase);
  if (!m) return null;
  const o = object(m[1], 'one', null);
  if (!o || o.zone !== 'battlefield') return null;
  const another = phrase.startsWith('another ');
  return (g, c, self) =>
    (!another || c.id !== self.id) &&
    (o.who !== 'you' || c.controller === self.controller) &&
    (o.who !== 'opponent' || c.controller !== self.controller) &&
    (o.type !== 'creature' || isCreature(g, c)) &&
    (o.type !== 'creature or planeswalker' || isCreature(g, c) || isPlaneswalker(g, c)) &&
    o.test(g, c, self, 0);
}

/** "Whenever you cast a noncreature spell", "an instant or sorcery spell", "a creature spell": which spells. */
function castKind(words: string): ((g: Game, c: Card) => boolean) | null {
  if (!words) return () => true;
  const o = object(`${words} spell`, 'one', null);
  return o && o.zone === 'stack' ? (g, c) => o.test(g, c, c, 0) : null;
}

/**
 * Trigger events (603.1): "When this enters", "Whenever this attacks", "At the beginning of
 * your upkeep", "Whenever another creature you control dies", "Whenever you gain life",
 * "Whenever an opponent draws a card", "Whenever a land you control enters" (landfall)...
 * Each reads to the hooks the engine fires (`Triggers` in types.ts); "When this enters or
 * attacks" is one ability on two events.
 */
const TRIGGERS: [RegExp, (m: RegExpExecArray) => TrigEvent[] | null][] = [
  [/^when(?:ever)? ~ enters$/, () => [{ hook: 'onEnter' }]],
  [/^when(?:ever)? ~ dies$/, () => [{ hook: 'onDies' }]],
  [/^when(?:ever)? ~ leaves the battlefield$/, () => [{ hook: 'onLeave' }]],
  [/^whenever ~ attacks$/, () => [{ hook: 'onAttack' }]],
  [/^whenever ~ blocks$/, () => [{ hook: 'onBlock' }]],
  [/^whenever ~ enters or attacks$/, () => [{ hook: 'onEnter' }, { hook: 'onAttack' }]],
  [/^whenever ~ attacks or blocks$/, () => [{ hook: 'onAttack' }, { hook: 'onBlock' }]],
  [/^when(?:ever)? ~ enters or dies$/, () => [{ hook: 'onEnter' }, { hook: 'onDies' }]],
  [/^whenever ~ becomes tapped$/, () => [{ hook: 'onTapped' }]],
  [/^whenever ~ deals combat damage to a player$/, () => [{ hook: 'onCombatDamageToPlayer', ev: playerEv('player', 'amount'), env: { player: true, amount: true } }]],
  // Steps and phases (503.1, 505.1, 507.1, 513.1): "your" is the active player's turn.
  [/^at the beginning of your upkeep$/, () => [{ hook: 'onUpkeep', when: yours((e) => e.player) }]],
  [/^at the beginning of each upkeep$/, () => [{ hook: 'onUpkeep', ev: playerEv('player'), env: { player: true } }]],
  [/^at the beginning of each opponent's upkeep$/, () => [{ hook: 'onUpkeep', when: (g, e) => isOpp(g, e.self.controller, e.player), ev: playerEv('player'), env: { player: true } }]],
  [/^at the beginning of your end step$/, () => [{ hook: 'onEndStep', when: yours((e) => e.player) }]],
  [/^at the beginning of each end step$/, () => [{ hook: 'onEndStep', ev: playerEv('player'), env: { player: true } }]],
  [/^at the beginning of each opponent's end step$/, () => [{ hook: 'onEndStep', when: (g, e) => isOpp(g, e.self.controller, e.player), ev: playerEv('player'), env: { player: true } }]],
  [/^at the beginning of combat on your turn$/, () => [{ hook: 'onBeginCombat', when: yours((e) => e.player) }]],
  [/^at the beginning of your (?:precombat|first) main phase$/, () => [{ hook: 'onPrecombatMain', when: yours((e) => e.player) }]],
  [/^at the beginning of each of your postcombat main phases$/, () => [{ hook: 'onPostcombatMain', when: yours((e) => e.player) }]],
  [/^at the beginning of your draw step$/, () => [{ hook: 'onDrawStep', when: yours((e) => e.player) }]],
  // Objects entering and dying (603.6a, 603.6c, 603.10a).
  [
    /^whenever (a|an|another) (.+?) enters$/,
    (m) => {
      const about = aboutObject(`${m[1]} ${m[2]}`);
      if (!about) return null;
      const land = /^lands?\b|\bland you control$/.test(m[2]) || /^land/.test(m[2]);
      if (land && /^land(?: you control)?$/.test(m[2])) return [{ hook: 'onLandfall', when: (g, e) => about(g, e.land as Card, e.self), ev: objectEv('land'), env: { object: true } }];
      if (/creature/.test(m[2]) || subtypeOf(m[2].split(' ')[0]) && CREATURE_TYPES.includes(subtypeOf(m[2].split(' ')[0])!)) return [{ hook: 'onCreatureEnters', when: (g, e) => about(g, e.entered as Card, e.self), ev: objectEv('entered'), env: { object: true, player: true } }];
      return [{ hook: 'onPermanentEnters', when: (g, e) => about(g, e.entered as Card, e.self), ev: objectEv('entered'), env: { object: true, player: true } }];
    },
  ],
  [
    /^whenever (~ or )?(a|an|another) (.+?) dies$/,
    (m) => {
      const about = aboutObject(`${m[2]} ${m[3]}`);
      if (!about || !/^(?:\S+ )*?(?:creature|planeswalker|creature or planeswalker)(?: you control| an opponent controls| you don't control)?$/.test(m[3].replace(/^(?:non)?token /, ''))) return null;
      const self = !!m[1];
      // "This or another creature" includes it dying itself (603.10a: it looks back in time).
      const when = (g: Game, e: Record<string, unknown> & { self: Card }) => (self && (e.dead as Card).id === e.self.id) || about(g, e.dead as Card, e.self);
      const env = { object: true, player: true };
      return [
        ...(/creature/.test(m[3]) ? [{ hook: 'onCreatureDies' as const, when, ev: objectEv('dead'), env }] : []),
        // A planeswalker that isn't also a creature dying is its own event (Cruel Celebrant).
        ...(/planeswalker/.test(m[3]) ? [{ hook: 'onPlaneswalkerDies' as const, when, ev: objectEv('dead'), env }] : []),
      ];
    },
  ],
  // "Whenever this or another nontoken Shrine you control enters" (Go-Shintai): any permanent entering, itself included (603.6a).
  [
    /^whenever ~ or (another .+?) enters$/,
    (m) => {
      const about = aboutObject(m[1]);
      return about && [{ hook: 'onPermanentEnters', when: (g, e) => (e.entered as Card).id === e.self.id || about(g, e.entered as Card, e.self), ev: objectEv('entered'), env: { object: true, player: true } }];
    },
  ],
  // "Whenever one or more tokens you control enter" (Marneus Calgar): once for each event, however many enter (603.2c).
  [
    /^whenever one or more (.+?) enter$/,
    (m) => {
      const about = aboutObject(`a ${m[1].replace(/^(?:([a-z-]+) )?tokens\b/, (_w, mod) => `${mod ? `${mod} ` : ''}token permanent`).replace(/s\b(?= you control| an opponent controls| you don't control|$)/, '')}`);
      return about && [{ hook: 'onPermanentsEnter', when: (g, e) => (e.entered as Card[]).some((c) => about(g, c, e.self)) }];
    },
  ],
  // "Whenever a Dwarf you control becomes tapped" (Magda): any permanent becoming tapped.
  [
    /^whenever (a|an|another) (.+?) becomes tapped$/,
    (m) => {
      const about = aboutObject(`${m[1]} ${m[2]}`);
      return about && [{ hook: 'onPermanentTapped', when: (g, e) => about(g, e.tapped as Card, e.self), ev: objectEv('tapped'), env: { object: true, player: true } }];
    },
  ],
  [/^whenever a land you control enters$/, () => [{ hook: 'onLandfall', when: (_g, e) => (e.land as Card).controller === e.self.controller, ev: objectEv('land'), env: { object: true } }]],
  // "Whenever a Food is put into a graveyard from the battlefield": a leaves-the-battlefield ability, so it looks back in time (603.6c, 603.10a). Tokens go there too before they cease to exist (111.7).
  [
    /^whenever (a|an|another) (.+?) is put into a graveyard from the battlefield$/,
    (m) => {
      const about = aboutObject(`${m[1]} ${m[2]}`);
      return about && [{ hook: 'onPermanentLeaves', when: (g, e) => e.to === 'graveyard' && about(g, e.left as Card, e.self), ev: objectEv('left'), env: { object: true, player: true } }];
    },
  ],
  // Players (119.9, 121, 601.2i).
  [/^whenever you gain life$/, () => [{ hook: 'onLifeGain', when: yours((e) => e.player), ev: playerEv('player', 'amount'), env: { amount: true } }]],
  [/^whenever an opponent loses life$/, () => [{ hook: 'onLifeLoss', when: (g, e) => isOpp(g, e.self.controller, e.player), ev: playerEv('player', 'amount'), env: { player: true, amount: true } }]],
  // Only the first life they lose in their own turn (Valgavoth): later losses that turn, or losses on other turns, don't count.
  [
    /^whenever an opponent loses life for the first time during each of their turns$/,
    () => [{ hook: 'onLifeLoss', when: (g, e) => isOpp(g, e.self.controller, e.player) && !!e.firstThisTurn && g.active === e.player, ev: playerEv('player', 'amount'), env: { player: true, amount: true } }],
  ],
  // "Whenever the Ring tempts you" (701.54d).
  [/^whenever the ring tempts you$/, () => [{ hook: 'onRingTempts', when: yours((e) => e.player) }]],
  [/^whenever you draw a card$/, () => [{ hook: 'onDraw', when: yours((e) => e.player) }]],
  [/^whenever an opponent draws a card$/, () => [{ hook: 'onDraw', when: (g, e) => isOpp(g, e.self.controller, e.player), ev: playerEv('player'), env: { player: true } }]],
  [/^whenever a player draws a card$/, () => [{ hook: 'onDraw', ev: playerEv('player'), env: { player: true } }]],
  // "When this creature enters and whenever an opponent draws a card except the first one they draw in each of their draw steps" (Orcish Bowmasters):
  // one ability on two events. The card just drawn was the first in their draw step if it is their draw step and it is the only one they drew in it (504.1).
  [
    /^when ~ enters and whenever an opponent draws a card except the first one they draw in each of their draw steps$/,
    () => [
      { hook: 'onEnter' },
      {
        hook: 'onDraw',
        when: (g, e) => {
          const p = e.player as PlayerId;
          const first = g.step === 'draw' && g.active === p && g.players[p].drawn === (g.players[p].drawnBeforeDrawStep ?? -1) + 1;
          return isOpp(g, e.self.controller, p) && !first;
        },
      },
    ],
  ],
  [/^whenever you discard a card$/, () => [{ hook: 'onDiscard', when: yours((e) => e.player) }]],
  [/^whenever a player sacrifices a permanent$/, () => [{ hook: 'onSacrifice', ev: playerEv('player'), env: { player: true } }]],
  [/^whenever you sacrifice a permanent$/, () => [{ hook: 'onSacrifice', when: yours((e) => e.player) }]],
  [
    /^whenever you cast an? (.*?) ?spell$/,
    (m) => {
      const kind = castKind(m[1]);
      return kind && [{ hook: 'onCast', when: (g, e) => e.caster === e.self.controller && kind(g, e.card as Card) }];
    },
  ],
  [
    /^whenever an opponent casts an? (.*?) ?spell$/,
    (m) => {
      const kind = castKind(m[1]);
      return kind && [{ hook: 'onCast', when: (g, e) => isOpp(g, e.self.controller, e.caster) && kind(g, e.card as Card), ev: playerEv('caster'), env: { player: true } }];
    },
  ],
  [
    /^whenever (a|an|another) (.+?) attacks$/,
    (m) => {
      const about = aboutObject(`${m[1]} ${m[2]}`);
      return about && [{ hook: 'onCreatureAttacks', when: (g, e) => about(g, e.attacker as Card, e.self), ev: objectEv('attacker'), env: { object: true } }];
    },
  ],
  // An Aura's or Equipment's creature (303.4b, 301.5a): the one it is attached to as the event happens.
  [/^whenever (?:equipped|enchanted) creature attacks$/, () => [{ hook: 'onCreatureAttacks', when: (_g, e) => (e.attacker as Card).id === e.self.attachedTo, ev: objectEv('attacker'), env: { object: true } }]],
  [/^whenever (?:equipped|enchanted) creature dies$/, () => [{ hook: 'onCreatureDies', when: (_g, e) => (e.dead as Card).id === e.self.attachedTo, ev: objectEv('dead'), env: { object: true } }]],
  [
    /^whenever (equipped creature|enchanted creature|(?:a|an|another) .+?) deals combat damage to a player$/,
    (m) => {
      const attached = /^(?:equipped|enchanted) creature$/.test(m[1]);
      const about = attached ? null : aboutObject(m[1]);
      if (!attached && !about) return null;
      return [
        {
          hook: 'onDamage',
          when: (g, e) => !!e.combat && e.player !== null && (attached ? (e.source as Card).id === e.self.attachedTo : about!(g, e.source as Card, e.self)),
          ev: (ctx) => {
            const e = ctx as unknown as { player: PlayerId; amount: number; source: Card };
            return { player: e.player, amount: e.amount, id: e.source.id, card: e.source };
          },
          env: { player: true, amount: true, object: true },
        },
      ];
    },
  ],
  [
    /^whenever enchanted creature deals damage to (an opponent|a player)$/,
    (m) => [
      {
        hook: 'onDamage',
        when: (g, e) => (e.source as Card).id === e.self.attachedTo && e.player !== null && (m[1] === 'a player' || isOpp(g, e.self.controller, e.player)),
        ev: playerEv('player', 'amount'),
        env: { player: true, amount: true },
      },
    ],
  ],
  [/^whenever an opponent searches their library$/, () => [{ hook: 'onSearch', when: (g, e) => isOpp(g, e.self.controller, e.player), ev: playerEv('player'), env: { player: true } }]],
  // Magecraft: "whenever you cast or copy an instant or sorcery spell" (207.2c): two events.
  [
    /^whenever you cast or copy an? (.+?) spell$/,
    (m) => {
      const kind = castKind(m[1]);
      return (
        kind && [
          { hook: 'onCast', when: (g, e) => e.caster === e.self.controller && kind(g, e.card as Card) },
          { hook: 'onCopy', when: (g, e) => e.controller === e.self.controller && kind(g, e.card as Card) },
        ]
      );
    },
  ],
];

/** "[When / Whenever / At] [event], [if condition,] [effect]": the parts, at the first comma that leaves an event the parser knows. */
function splitTrigger(text: string): [string, string, string | undefined, string] | null {
  if (!/^(?:when|whenever|at) /.test(text)) return null;
  for (let at = text.indexOf(', '); at >= 0; at = text.indexOf(', ', at + 1)) {
    const head = text.slice(0, at);
    if (!triggerEvent(head)) continue;
    const m = /^(?:if (.+?), )?(.+)$/.exec(text.slice(at + 2))!;
    return [text, head, m[1], m[2]];
  }
  return [text, text.slice(0, Math.max(0, text.indexOf(', '))), undefined, text.slice(text.indexOf(', ') + 2)];
}

/** Reads a trigger's event phrase, or null if it isn't one the parser knows. */
function triggerEvent(phrase: string): TrigEvent[] | null {
  for (const [re, make] of TRIGGERS) {
    const m = re.exec(phrase);
    if (m) return make(m);
  }
  return null;
}

// ---------- modal spells and abilities (700.2) ----------

/** "Choose one —", "Choose two —", "Choose one or more —", "Choose one or both —", "Choose up to two —", "Spree": how many modes. */
function modeCount(head: string): { min: number; max: number | null } | null {
  let m = /^choose (one|two|three) —$/.exec(head);
  if (m) return { min: NUMBERS[m[1]], max: NUMBERS[m[1]] };
  if (head === 'choose one or both —') return { min: 1, max: 2 };
  if (head === 'choose one or more —' || head === 'choose any number —') return { min: head === 'choose any number —' ? 0 : 1, max: null };
  m = /^choose up to (one|two|three) —$/.exec(head);
  if (m) return { min: 0, max: NUMBERS[m[1]] };
  if (head === 'spree') return { min: 1, max: null };
  return null;
}

/** The modes, each read by the clause reader: "• Destroy target artifact.", or a spree mode "+ {1} — Draw a card." (702.172a). */
function modesOf(bullets: string[], key: string, name: string, env: Env, then: Then, bots: Bots, spree: boolean, ev?: EventOf): { mode: Omit<Mode, 'resolve'>; run: Built['run'] }[] {
  return bullets.map((b, k) => {
    const m = spree ? /^\+ ((?:\{[0-9wubrgc]\})+) — (.+)$/.exec(b) : /^• (?:[a-z' ]+ — )?(.+)$/.exec(b);
    if (!m) return refuse(b, spree ? 'a spree mode without a cost' : 'a mode the parser can\'t read');
    const text = spree ? m[2] : m[1];
    const { targets, run } = build(effects(text, env), `${key}.m${k}`, name, then, bots, ev);
    return { mode: { text: capital(text), ...(spree ? { cost: m[1].toUpperCase() } : {}), ...(targets.length ? { targets } : {}) }, run };
  });
}

/** Where mode `k`'s targets start among a modal object's: the chosen modes before it each take their own (700.2). */
const modeBase = (modes: { mode: Omit<Mode, 'resolve'> }[], chosen: number[], k: number) =>
  chosen.filter((j) => j < k).reduce((n, j) => n + (modes[j].mode.targets?.length ?? 0), 0);

// ---------- reading a card ----------

/** The card's text, one ability per line, lower case, with reminder text gone and "~" for the card itself. */
function lines(d: CardData): { text: string; original: string }[] {
  let t = d.oracleText.replace(/\([^)]*\)/g, '').replace(/−/g, '-');
  const short = d.name.split(',')[0];
  for (const n of short !== d.name ? [d.name, short] : [d.name]) t = t.split(n).join('~');
  t = t.replace(/\bthis (creature|artifact|enchantment|land|permanent|spell|aura|equipment|vehicle|card|saga)\b/gi, '~');
  return t
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((original) => ({ text: original.toLowerCase(), original: original.replace(/~/g, d.name) }));
}

const isKeywordLine = (line: string) => line.split(',').every((part) => BARE_KEYWORDS.includes(part.trim()));

/** Keywords that change how a spell is cast or where it goes, which the engine applies from the card's keywords. */
const CAST_KEYWORDS = ['delve', 'rebound', 'paradigm'];

/** "Activate only as a sorcery", "Activate only during your turn", "Activate only if ...": an activated ability's restrictions (602.5). */
function restrictions(body: string, line: string): { body: string; sorcery: boolean; when?: ActivatedAbility['when'] } {
  let rest = body;
  let sorcery = false;
  let when: ActivatedAbility['when'];
  for (let again = true; again; ) {
    again = false;
    let m: RegExpExecArray | null;
    if ((m = / activate only as a sorcery\.$/.exec(rest))) {
      sorcery = true;
      rest = rest.slice(0, m.index);
      again = true;
    } else if ((m = / activate only during your turn\.$/.exec(rest))) {
      const was = when;
      when = (g, self) => g.active === self.controller && (!was || was(g, self));
      rest = rest.slice(0, m.index);
      again = true;
    } else if ((m = / activate only if (.+?)(?: and only as a sorcery)?\.$/.exec(rest))) {
      const cond = condition(m[1]) ?? refuse(line, `the restriction "activate only if ${m[1]}"`);
      if (/and only as a sorcery\.$/.test(m[0])) sorcery = true;
      const was = when;
      when = (g, self) => cond(g, self, self.controller) && (!was || was(g, self));
      rest = rest.slice(0, m.index);
      again = true;
    }
  }
  return { body: rest, sorcery, when };
}

/**
 * Reads a card's Oracle text into a script, or refuses it with the clause it couldn't
 * read. A card with only keywords the engine knows gets an empty script. A card with faces
 * gets a script for each face (712, 709, 715).
 */
export function parseCard(d: CardData): Parsed {
  if (d.faces) {
    if (d.layout === 'split' && /\bfuse\b/i.test(d.oracleText)) return { ok: false, clause: 'Fuse', reason: 'fuse (702.102)' };
    // Each face is read on its own, with its own name for "~" (712, 709, 715).
    const faces: Record<string, CardScript> = {};
    for (const f of d.faces) {
      const p = parseCard({ ...f, faces: undefined, layout: undefined });
      if (!p.ok) return p;
      faces[f.name] = p.script;
    }
    return { ok: true, script: {}, faces };
  }
  try {
    return { ok: true, script: readCard(d) };
  } catch (e) {
    // Clauses are read in lower case with "~" for the card; give them back with its name.
    if (e instanceof Refusal) return { ok: false, clause: e.clause.replace(/~/g, d.name), reason: e.message.replace(/~/g, d.name) };
    throw e;
  }
}

function readCard(d: CardData): CardScript {
  const spell = d.typeLine.includes('Instant') || d.typeLine.includes('Sorcery');
  const script: CardScript = {};
  const then: Then = {};
  const bots: Bots = {};
  const statics: StaticFn[] = [];
  const mana: ManaAbility[] = [];
  const activated: ActivatedAbility[] = [];
  const spellEffects: Effect[] = [];
  /** The spell's effect lines, for overload's "each" for "target" (702.96b). */
  const spellTexts: string[] = [];
  /** "If this spell was kicked, ...": what kicking adds (702.33d). */
  const kicked: Effect[] = [];
  const xSpell = /\{X\}/.test(d.manaCost);
  const all = lines(d);
  for (let n = 0; n < all.length; n++) {
    const { original } = all[n];
    const text = stripAbilityWord(all[n].text, d.keywords);
    // A modal line takes the bullet lines after it (700.2).
    const bullets: string[] = [];
    while (n + 1 < all.length && /^(•|\+ \{)/.test(all[n + 1].text)) bullets.push(all[++n].text.replace(/\.$/, ''));
    if (isKeywordLine(text)) continue;
    // Prowess (702.108a) is a triggered ability, alone or with other keywords ("Flying, prowess").
    const parts = text.split(',').map((p) => p.trim());
    if (parts.includes('prowess') && parts.every((p) => p === 'prowess' || BARE_KEYWORDS.includes(p))) {
      addTrigger(script, 'onCast', { ...prowess, text: 'Prowess' } as AnyTrigger);
      continue;
    }
    // Ward {N} among other keywords: "Flying, ward {2}", "Vigilance, trample, ward {3}" (702.21a).
    const wardAt = parts.findIndex((p) => /^ward \{\d+\}$/.test(p));
    if (wardAt >= 0 && parts.length > 1 && parts.every((p, i) => i === wardAt || BARE_KEYWORDS.includes(p))) {
      if (script.ward) return refuse(original, 'two ward abilities');
      script.ward = { mana: parts[wardAt].slice('ward '.length) };
      continue;
    }
    // Casting rules the engine applies itself: delve (702.66), rebound (702.88), paradigm (702.192).
    if (CAST_KEYWORDS.includes(text)) continue;
    // Extort (702.101a) and job select (702.182a) are triggered abilities.
    if (text === 'extort') {
      addTrigger(script, 'onCast', { ...(extort.onCast as AnyTrigger), text: 'Extort' });
      Object.assign(then, extort.then);
      script.botChoice = { ...script.botChoice, ...extort.botChoice };
      continue;
    }
    if (text === 'job select') {
      addTrigger(script, 'onEnter', { ...(jobSelect as AnyTrigger), text: 'Job select' });
      continue;
    }
    if (cardLine(text, original, d, script, then)) continue;
    const head = modeCount(text);
    if (head && bullets.length) {
      if (!spell) return refuse(original, 'a modal ability of a permanent');
      const modes = modesOf(bullets, `s${n}`, d.name, { permanent: false, x: null, typeLine: d.typeLine }, then, bots, text === 'spree');
      if (head.max !== null && head.max > modes.length) return refuse(original, 'more modes to choose than there are');
      script.modal = {
        min: head.min,
        max: head.max ?? modes.length,
        modes: modes.map(({ mode, run }, k) => ({ ...mode, resolve: (g, ctx) => run(g, ctx, modeBase(modes, ctx.self.cast?.modes ?? [], k)) })),
      };
      continue;
    }
    if (bullets.length) {
      // "When this enters, choose one —" (700.2b, 603.3c): a modal triggered ability.
      const tm = /^(.+?), (choose .+ —)$/.exec(text);
      const count = tm && modeCount(tm[2]);
      const events = tm && triggerEvent(tm[1]);
      if (!count || !events) return refuse(original, 'no template matches');
      for (const e of events) {
        const modes = modesOf(bullets, `t${n}${e.hook}`, d.name, { permanent: true, x: null, ev: e.env, typeLine: d.typeLine }, then, bots, false, e.ev);
        // Each chosen mode in printed order, with its own share of the targets (700.2, 603.3c).
        const resolve = (g: Game, ctx: Ctx) => {
          const chosenModes = ctx.modes ?? [];
          for (const k of chosenModes) {
            const base = modeBase(modes, chosenModes, k);
            modes[k].run(g, { ...ctx, targets: ctx.targets.slice(base, base + (modes[k].mode.targets?.length ?? 0)) }, base);
          }
        };
        const list = modes.map(({ mode, run }) => ({ ...mode, resolve: run }));
        addTrigger(script, e.hook, { ...(e.when ? { when: e.when as AnyTrigger['when'] } : {}), resolve, text: original, modes: { min: count.min, max: count.max ?? modes.length, modes: list } });
      }
      continue;
    }
    if (spell) {
      // "If this spell was kicked, [effect]" (702.33d): a second part that happens only if it was.
      const k = /^if ~ was kicked, (.+)$/.exec(text);
      if (k) {
        if (!script.kicker) return refuse(original, '"if this spell was kicked" without kicker');
        kicked.push(...effects(k[1], { permanent: false, x: xSpell ? (_g, ctx) => ctx.self.cast?.x ?? 0 : null, typeLine: d.typeLine }));
        continue;
      }
      spellEffects.push(...effects(text, { permanent: false, x: xSpell ? (_g, ctx) => ctx.self.cast?.x ?? 0 : null, typeLine: d.typeLine }));
      spellTexts.push(text);
      continue;
    }
    // Triggered abilities (603.1): "[When / Whenever / At] [event], [if condition,] [effect]".
    // The event may have commas of its own ("an Aura, Equipment, or Vehicle spell"): the first split it reads wins.
    const trig = splitTrigger(text);
    const events = trig && triggerEvent(trig[1]);
    if (trig && events) {
      // An intervening "if" (603.4): checked as it triggers and again as it resolves.
      const cond = trig[2] ? (condition(trig[2]) ?? refuse(original, `the condition "if ${trig[2]}"`)) : null;
      for (const e of events) {
        // An "enters" ability of a permanent that was a spell with X in its cost uses that X (107.3m).
        const x: Env['x'] = xSpell && e.hook === 'onEnter' ? (_g, ctx) => ctx.self.cast?.x ?? 0 : null;
        const env: Env = { permanent: true, x, ev: e.env, typeLine: d.typeLine };
        const { targets, run } = build(effects(trig[3], env), `t${n}${e.hook}`, d.name, then, bots, e.ev);
        const when = cond ? (g: Game, ev: Record<string, unknown> & { self: Card }) => (!e.when || e.when(g, ev)) && cond(g, ev.self, ev.self.controller) : e.when;
        const resolve = cond ? (g: Game, ctx: Ctx) => cond(g, ctx.self, ctx.you) && run(g, ctx) : run;
        addTrigger(script, e.hook, { ...(when ? { when: when as AnyTrigger['when'] } : {}), resolve: (g, ctx) => void resolve(g, ctx as Ctx), targets, text: original });
      }
      continue;
    }
    if (trig && /^(when|whenever|at) /.test(text)) return refuse(original, 'no template matches');
    // Activated abilities, mana abilities among them: "[Cost]: [Effect]" (602.1, 605.1a).
    const act = /^([^:"]+): (.+)$/.exec(text);
    if (act && !/^(when|whenever|at) /.test(text)) {
      const r = restrictions(act[2], original);
      const add = manaEffect(r.body);
      if (add) {
        const paid = manaCost(act[1]);
        if (!paid) return refuse(original, 'a mana ability with a cost the parser can\'t pay');
        if (r.sorcery) return refuse(original, 'a mana ability activated only as a sorcery');
        const when = r.when;
        mana.push({ ...add, ...paid, ...(when ? { when: add.when ? (g: Game, self: Card) => add.when!(g, self) && when(g, self) : when } : {}) });
        continue;
      }
      // "This ability costs {1} less to activate for each legendary creature you control" (channel lands).
      let body = r.body;
      let reduction: ActivatedAbility['reduction'];
      const less = / ~ costs \{1\} less to activate for each legendary creature you control\.$| this ability costs \{1\} less to activate for each legendary creature you control\.$/.exec(body);
      if (less) {
        body = body.slice(0, less.index);
        reduction = (g, self) => creaturesOf(g, self.controller).filter((c) => hasType(g, c, 'Legendary')).length;
      }
      const paid = cost(act[1], original);
      // An activated ability that adds mana and does something else is still a mana ability (605.1a): ManaAbility can't carry the rest.
      if (/(?:^|\. |, | and )add (?:\{[wubrgcx]\}|one mana|two mana|\w+ mana)/.test(body)) return refuse(original, 'a mana ability that does more than add mana');
      const { targets, run } = build(effects(body, { permanent: true, x: paid.x ? (_g, ctx) => ctx.x ?? 0 : null, typeLine: d.typeLine }), `a${n}`, d.name, then, bots);
      activated.push({
        cost: paid.cost,
        ...(r.sorcery ? { sorcery: true } : {}),
        ...(r.when ? { when: r.when } : {}),
        ...(paid.fromHand ? { fromHand: true } : {}),
        ...(reduction ? { reduction } : {}),
        ...(targets.length ? { targets } : {}),
        text: original,
        resolve: run,
      });
      continue;
    }
    const typed = typesLine(text, original, d, n);
    if (typed) {
      statics.push(typed);
      continue;
    }
    const st = staticLine(text, d);
    if (st) {
      statics.push(st);
      continue;
    }
    return refuse(original, 'no template matches');
  }
  if (spell && (spellEffects.length || kicked.length)) {
    const { targets, run } = build(spellEffects, 's', d.name, then, bots);
    if (kicked.length) {
      // The kicked part's targets exist whether it is kicked or not: kicker targets aren't supported (702.33g).
      const extra = build(kicked, 'k', d.name, then, bots);
      if (extra.targets.length) return refuse(d.name, 'a target only when kicked');
      script.onResolve = (g, ctx) => {
        run(g, ctx);
        if (ctx.self.cast?.kicked) extra.run(g, ctx);
      };
      if (spellEffects.some((e) => e.choose || e.may)) return refuse(d.name, 'a kicked part after a choice');
    } else script.onResolve = run;
    if (targets.length) {
      if (script.modal) return refuse(d.name, 'a modal spell with other effects');
      script.targets = targets;
    }
  }
  if (spell && script.modal && spellEffects.length) return refuse(d.name, 'a modal spell with other effects');
  const overload = script.alternativeCosts?.findIndex((a) => a.overload) ?? -1;
  if (overload >= 0) {
    // Overloaded, it has no targets (702.96b): every "target" reads "each".
    const each = spellTexts.flatMap((t) => effects(t.replace(/\btarget\b/g, 'each'), { permanent: false, x: null, typeLine: d.typeLine }));
    const over = build(each, 'o', d.name, then, bots);
    if (over.targets.length || !script.onResolve) return refuse(d.name, 'an overload the parser can\'t read');
    const normal = script.onResolve;
    script.onResolve = (g, ctx) => (ctx.self.cast?.alt === overload ? over.run(g, ctx) : normal(g, ctx));
  }
  if (spell && script.onResolve && /^add /.test(spellEffects[0]?.text ?? '') && spellEffects.length === 1) script.ai = 'ritual';
  const hint = spellEffects.find((e) => e.ai)?.ai;
  if (spell && hint) script.ai = hint;
  // A lone "enters" ability's targets are the script's own (CardScript.targets).
  const enter = script.onEnter;
  if (enter && !Array.isArray(enter) && typeof enter !== 'function') {
    if (enter.targets?.length) script.targets = enter.targets;
  }
  if (mana.length) script.mana = mana.length === 1 ? mana[0] : mana;
  // Cycling, equip and crew, read as card lines, come after the card's other activated abilities.
  const had = script.activated ? (Array.isArray(script.activated) ? script.activated : [script.activated]) : [];
  const allAbilities = [...activated, ...had];
  if (allAbilities.length) script.activated = allAbilities.length === 1 ? allAbilities[0] : allAbilities;
  if (statics.length) {
    // Each line is its own ability, and its own effect (613.7a: they share the card's timestamp).
    script.static = statics.length === 1 ? statics[0] : (g, self, c) => statics.map((s) => s(g, self, c));
  }
  if (Object.keys(then).length) script.then = then;
  if (Object.keys(bots).length) script.botChoice = { ...script.botChoice, ...bots };
  if (d.typeLine.includes('Aura') && !script.enchant) return refuse(d.name, 'an Aura without an enchant line');
  return script;
}

/** Does this card need a script at all: does any line, on any face, say more than keywords the engine knows? */
export const needsScript = (d: CardData) => (d.faces ?? [d]).some((f) => lines(f).some((l) => !isKeywordLine(l.text)));

const REFUSALS = new Map<string, { clause: string; reason: string }>();

/** The clause `scriptCards` couldn't read on this card (or face), and why, or undefined if it didn't refuse it. */
export const refusalOf = (name: string) => REFUSALS.get(name);

/**
 * Registers a parsed script for each of these cards that has rules text but no hand
 * script, one for each face of a card with faces. Returns the ones it refused, with the
 * clause. Hand scripts always win.
 */
export function scriptCards(names: string[]): { name: string; clause: string; reason: string }[] {
  const refused: { name: string; clause: string; reason: string }[] = [];
  const scripts: Record<string, CardScript> = {};
  for (const name of names) {
    const d = cardData(name);
    const faces = d.faces ?? [d];
    if (faces.some((f) => hasScript(f.name)) || hasScript(name) || !needsScript(d)) continue;
    const p = parseCard(d);
    if (p.ok) {
      if (p.faces) Object.assign(scripts, p.faces);
      else scripts[name] = p.script;
    } else {
      refused.push({ name, clause: p.clause, reason: p.reason });
      for (const n of new Set([name, ...faces.map((f) => f.name)])) REFUSALS.set(n, { clause: p.clause, reason: p.reason });
    }
  }
  registerScripts(scripts);
  return refused;
}

// Every pool card without a hand script gets a parsed one, if the parser can read it.
scriptCards(ALL_CARD_NAMES);
