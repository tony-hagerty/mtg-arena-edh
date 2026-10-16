// Scripts from Oracle text. A parser for common, regular wording: each ability is matched
// clause by clause against a short list of templates, and the script is built from the
// helpers in rules.ts. One clause it can't read refuses the whole card, naming the clause:
// it never guesses. Hand scripts always win; this is only for cards without one.
//
// Plain TypeScript with no Node-only parts, so it can run in the browser.
import { registerScripts, hasScript } from '../engine/registry';
import {
  addCounters,
  ask,
  bounce,
  chooseToDiscard,
  createToken,
  creaturesOf,
  damagePlayer,
  dealDamage,
  destroy,
  draw,
  exile,
  finishEnter,
  gainLife,
  hasType,
  isColor,
  isCreature,
  isLand,
  isPlaneswalker,
  log,
  loseLife,
  mill,
  moveCard,
  opponentsOf,
  prowess,
  extort,
  jobSelect,
  pump,
  refCard,
  refPlayer,
  says,
  search,
  searchBasic,
  surveil,
  their,
  simultaneously,
} from '../engine/rules';
import type { ActivatedAbility, Card, CardData, CardScript, Color, Ctx, Game, ManaAbility, ManaSym, PlayerId, StaticBonus, TargetSpec, ThenCtx } from '../engine/types';
import { ALL_CARD_NAMES, cardData } from './db';
import lists from './decklists.json';

/** The parser's answer for one card: a script, or the clause it couldn't read and why. */
export type Parsed = { ok: true; script: CardScript } | { ok: false; clause: string; reason: string };

/**
 * Keywords a line may consist of without a script: the ones the engine enforces by itself
 * (702), plus partner, which only the deck rules read (702.124).
 */
const BARE_KEYWORDS = ['flying', 'reach', 'deathtouch', 'lifelink', 'trample', 'vigilance', 'haste', 'first strike', 'double strike', 'menace', 'defender', 'hexproof', 'indestructible', 'flash', 'partner'];

/** Keywords a "creatures you control have ..." line may grant: the ones `StaticBonus` can carry. */
const GRANTABLE = BARE_KEYWORDS.filter((k) => k !== 'partner' && k !== 'flash');

const NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const COLOR_WORDS: Record<string, Color> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

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

/** "3", "three", "a"; "X" only where the ability's cost has {X} (107.3a, 107.3k). */
type Amount = number | 'X';
const amountOf = (ctx: Ctx, n: Amount) => (n === 'X' ? (ctx.x ?? 0) : n);

/** What a clause is read in: a spell, or a permanent's ability (where "it" can mean the permanent). */
interface Env {
  permanent: boolean;
  /** The ability's cost has {X}, so "X" in its effect is that X. */
  x: boolean;
}

function amount(word: string, env: Env, clause: string): Amount {
  if (/^\d+$/.test(word)) return parseInt(word, 10);
  if (word in NUMBERS) return NUMBERS[word];
  if (word === 'x' && env.x) return 'X';
  return refuse(clause, word === 'x' ? 'X outside a cost' : `"${word}" isn't a number`);
}

// ---------- targets (115) ----------

/** The parts of a target phrase the parser knows: "target nonblack creature an opponent controls". */
const NOUNS: Record<string, { type: TargetSpec['type']; filter?: (g: Game, c: Card) => boolean }> = {
  creature: { type: 'creature' },
  permanent: { type: 'permanent' },
  artifact: { type: 'permanent', filter: (g, c) => hasType(g, c, 'Artifact') },
  enchantment: { type: 'permanent', filter: (g, c) => hasType(g, c, 'Enchantment') },
  land: { type: 'permanent', filter: isLand },
  planeswalker: { type: 'permanent', filter: isPlaneswalker },
  'artifact or enchantment': { type: 'permanent', filter: (g, c) => hasType(g, c, 'Artifact') || hasType(g, c, 'Enchantment') },
  'creature or planeswalker': { type: 'creature or planeswalker' },
  'creature or enchantment': { type: 'permanent', filter: (g, c) => isCreature(g, c) || hasType(g, c, 'Enchantment') },
};

/** "non[type]", a colour word, "non[colour]", or "basic" / "nonbasic" (205.4a), as a test on a card. */
function modifier(word: string): ((g: Game, c: Card) => boolean) | null {
  const not = word.startsWith('non');
  const base = not ? word.slice(3) : word;
  let test: ((g: Game, c: Card) => boolean) | null = null;
  if (base in COLOR_WORDS) test = (g, c) => isColor(g, c, COLOR_WORDS[base]);
  else if (not && base === 'token') test = (_g, c) => !!c.isToken;
  else if (base === 'basic') test = (g, c) => hasType(g, c, 'Basic');
  else if (not && ['land', 'artifact', 'creature', 'enchantment'].includes(base)) test = (g, c) => hasType(g, c, base[0].toUpperCase() + base.slice(1));
  if (!test) return null;
  return not ? (g, c) => !test!(g, c) : test;
}

/** Reads a target phrase into a target spec, or returns null if it isn't one. */
function targetSpec(phrase: string): TargetSpec | null {
  const label = phrase;
  if (phrase === 'any target') return { type: 'any', label };
  if (phrase === 'target player') return { type: 'player', label };
  if (phrase === 'target opponent') return { type: 'player', who: 'opponent', label };
  if (phrase === 'target player or planeswalker') return { type: 'player or planeswalker', label };
  const m = /^target (.+?)(?: (an opponent controls|you control|you don't control))?$/.exec(phrase);
  if (!m) return null;
  const words = m[1].split(/,? /);
  // The noun is the longest tail the parser knows ("artifact or enchantment" before "enchantment").
  for (let i = 0; i < words.length; i++) {
    const noun = NOUNS[words.slice(i).join(' ')];
    if (!noun) continue;
    const mods = words.slice(0, i).map(modifier);
    if (mods.some((x) => !x)) return null;
    const tests = [noun.filter, ...mods].filter((x): x is (g: Game, c: Card) => boolean => !!x);
    const who = m[2] === 'you control' ? 'you' : m[2] ? 'opponent' : undefined;
    return { type: noun.type, label, ...(who ? { who } : {}), ...(tests.length ? { filter: (g: Game, c: Card) => tests.every((t) => t(g, c)) } : {}) };
  }
  return null;
}

// ---------- tokens (111) ----------

interface TokenDef {
  name: string;
  power?: string;
  toughness?: string;
  colors: string[];
  typeLine: string;
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
      const words = t.power
        ? `${t.power}/${t.toughness} ${colorText(t.colors)} ${types[1]} ${types[0]}${t.keywords.length ? ` with ${t.keywords.join(' and ')}` : ''}`
        : t.name;
      tokenWords.set(words.toLowerCase(), key);
    }
  }
  return tokenWords.get(desc) ?? null;
}

// ---------- effects ----------

/** One effect: its targets (0 or 1) and what it does. `i` is its first target's index in the ability's target list. */
interface Effect {
  targets: TargetSpec[];
  run: (g: Game, ctx: Ctx, i: number) => void;
  /** The clause as written, for a "you may" question. */
  text: string;
  /** Starts a "you may" part; `joined` clauses ("you may A and B") belong to the one before. */
  may?: boolean;
  joined?: boolean;
  /** Its subject is the previous clause's target player ("target player draws two cards and loses 2 life"). */
  reuse?: boolean;
  /**
   * It asks a player to choose (a search, a discard, surveil), and the choice is made after
   * the ability's other effects have run. Only a "you may", which waits too, can follow it.
   */
  waits?: boolean;
}

type Subject = 'you' | 'target player' | 'target opponent' | 'each opponent';

/** The players a subject means: you, the target player (if still legal, 608.2b), or each opponent. */
function players(g: Game, ctx: Ctx, i: number, who: Subject): PlayerId[] {
  if (who === 'you') return [ctx.you];
  if (who === 'each opponent') return opponentsOf(g, ctx.you).map((p) => p.id);
  const p = refPlayer(g, ctx.targets[i]);
  return p ? [p.id] : [];
}

const playerSpec = (who: Subject): TargetSpec[] => (who.startsWith('target') ? [targetSpec(who)!] : []);

const NUM = '(\\d+|x|a|an|one|two|three|four|five|six|seven|eight|nine|ten)';

/** Reads one clause ("draw two cards", "~ deals 3 damage to any target"). `who` is the subject carried from an earlier clause. */
function effect(clause: string, env: Env, who: Subject | null): { effect: Effect; who: Subject | null } {
  const subj = /^(you|target player|target opponent|each opponent) (.+)$/.exec(clause);
  const subject = (subj?.[1] as Subject | undefined) ?? who;
  const rest = subj ? subj[2] : clause;
  const me = subject ?? 'you';
  // The subject's target, if it has one. A subject carried from an earlier clause is the same target, not a new one.
  const subjectTargets = !subj && subject?.startsWith('target') ? { targets: [], reuse: true } : { targets: playerSpec(me) };
  const done = (e: Omit<Effect, 'text'>) => ({ effect: { ...e, text: clause }, who: subject });
  let m: RegExpExecArray | null;

  // Players: draw, gain and lose life, mill (121, 119, 701.17).
  if ((m = new RegExp(`^draws? ${NUM} cards?$`).exec(rest)) && me !== 'each opponent') {
    const n = amount(m[1], env, clause);
    return done({ ...subjectTargets, run: (g, ctx, i) => players(g, ctx, i, me).forEach((p) => draw(g, p, amountOf(ctx, n))) });
  }
  if ((m = new RegExp(`^gains? ${NUM} life$`).exec(rest)) && me === 'you') {
    const n = amount(m[1], env, clause);
    return done({ targets: [], run: (g, ctx) => void gainLife(g, ctx.you, amountOf(ctx, n)) });
  }
  if ((m = new RegExp(`^loses? ${NUM} life$`).exec(rest))) {
    const n = amount(m[1], env, clause);
    return done({ ...subjectTargets, run: (g, ctx, i) => simultaneously(g, () => players(g, ctx, i, me).forEach((p) => void loseLife(g, p, amountOf(ctx, n)))) });
  }
  if ((m = new RegExp(`^mills? ${NUM} cards?$`).exec(rest)) && me !== 'each opponent') {
    const n = amount(m[1], env, clause);
    return done({ ...subjectTargets, run: (g, ctx, i) => players(g, ctx, i, me).forEach((p) => void mill(g, p, amountOf(ctx, n))) });
  }
  if (subj && subject !== 'you') return refuse(clause, `no template for what ${subject} does`);

  // Surveil N (701.25).
  if ((m = new RegExp(`^surveil ${NUM}$`).exec(rest))) {
    const n = amount(m[1], env, clause);
    return done({ targets: [], waits: true, run: (g, ctx) => surveil(g, ctx.you, amountOf(ctx, n)) });
  }
  // "Draw N cards, then discard N cards" (121, 701.9a): the discards are chosen after the draw.
  if ((m = new RegExp(`^draw ${NUM} cards?, then discard ${NUM} cards?$`).exec(rest))) {
    const [d, k] = [amount(m[1], env, clause), amount(m[2], env, clause)];
    return done({
      targets: [],
      waits: true,
      run: (g, ctx) => {
        draw(g, ctx.you, amountOf(ctx, d));
        chooseToDiscard(g, ctx.you, amountOf(ctx, k));
      },
    });
  }
  // "[This] deals N damage to each opponent" (120): no target, so every opponent, in APNAP order (101.4).
  if ((m = new RegExp(`^~ deals ${NUM} damage to each opponent$`).exec(rest))) {
    const n = amount(m[1], env, clause);
    return done({ targets: [], run: (g, ctx) => simultaneously(g, () => opponentsOf(g, ctx.you).forEach((o) => void damagePlayer(g, ctx.self, o.id, amountOf(ctx, n)))) });
  }
  // "Exile target player's graveyard": every card in it (406.2).
  if (rest === "exile target player's graveyard") {
    return done({
      targets: [targetSpec('target player')!],
      run: (g, ctx, i) => {
        const p = refPlayer(g, ctx.targets[i]);
        if (!p || !p.graveyard.length) return;
        log(g, `${says(p, 'exiles')} ${their(p)} graveyard.`, p.id, [...p.graveyard]);
        for (const c of [...p.graveyard]) moveCard(g, c, 'exile');
      },
    });
  }
  // "Put a +1/+1 counter on each creature you control": the ones you control as it resolves.
  if ((m = new RegExp(`^put ${NUM} \\+1/\\+1 counters? on each creature you control$`).exec(rest))) {
    const n = amount(m[1], env, clause);
    return done({ targets: [], run: (g, ctx) => creaturesOf(g, ctx.you).forEach((c) => addCounters(g, c, amountOf(ctx, n))) });
  }
  // "Creatures you control gain indestructible until end of turn": those you control now (611.2c).
  if ((m = /^creatures you control gain (.+) until end of turn$/.exec(rest))) {
    const keywords = m[1].replace(/,? and /g, ', ').split(', ');
    if (keywords.some((k) => !GRANTABLE.includes(k))) return refuse(clause, `can't grant "${m[1]}"`);
    return done({ targets: [], run: (g, ctx) => creaturesOf(g, ctx.you).forEach((c) => pump(g, c, 0, 0, keywords)) });
  }
  // "[This] deals N damage to [target]" (120).
  if ((m = new RegExp(`^~ deals ${NUM} damage to (.+)$`).exec(rest))) {
    const n = amount(m[1], env, clause);
    const spec = targetSpec(m[2]) ?? refuse(clause, `"${m[2]}" isn't a target the parser knows`);
    return done({ targets: [spec], run: (g, ctx, i) => void dealDamage(g, ctx.self, ctx.targets[i], amountOf(ctx, n)) });
  }
  // Destroy, exile, return to hand (701.8, 701.13, 400.6).
  if ((m = /^(destroy|exile) (.+)$/.exec(rest)) || (m = /^(return) (.+) to its owner's hand$/.exec(rest))) {
    const verb = m[1];
    const spec = targetSpec(m[2]) ?? refuse(clause, `"${m[2]}" isn't a target the parser knows`);
    if (spec.type === 'player' || spec.type === 'any' || spec.type === 'player or planeswalker') refuse(clause, `can't ${verb} a player`);
    const act = verb === 'destroy' ? destroy : verb === 'exile' ? exile : bounce;
    return done({ targets: [spec], run: (g, ctx, i) => void act(g, refCard(g, ctx.targets[i])) });
  }
  // Create tokens (111.2), only ones decklists.json lists.
  if ((m = new RegExp(`^create ${NUM} (.+?) tokens?( with .+)?$`).exec(rest))) {
    const n = amount(m[1], env, clause);
    const desc = m[2] + (m[3] ?? '');
    const key = tokenKey(desc) ?? refuse(clause, `no listed token is "${desc}"`);
    return done({ targets: [], run: (g, ctx) => void createToken(g, ctx.you, key, amountOf(ctx, n)) });
  }
  // +1/+1 counters (122).
  if ((m = new RegExp(`^put ${NUM} \\+1/\\+1 counters? on (.+)$`).exec(rest))) {
    const n = amount(m[1], env, clause);
    if (m[2] === '~') {
      if (!env.permanent) refuse(clause, 'a spell putting counters on itself');
      return done({ targets: [], run: (g, ctx) => addCounters(g, ctx.self, amountOf(ctx, n)) });
    }
    const spec = targetSpec(m[2]);
    if (!spec || spec.type !== 'creature') return refuse(clause, `"${m[2]}" isn't a target creature`);
    return done({ targets: [spec], run: (g, ctx, i) => addCounters(g, refCard(g, ctx.targets[i]), amountOf(ctx, n)) });
  }
  // "[Target creature / this] gets +N/+N until end of turn" (611.2a).
  if ((m = /^(.+?) gets? ([+-]\d+|[+-]x)\/([+-]\d+|[+-]x) until end of turn$/.exec(rest))) {
    const sign = (s: string): Amount => {
      const a = amount(s.slice(1), env, clause);
      return s[0] === '-' ? (a === 'X' ? refuse(clause, '-X') : -a) : a;
    };
    const [p, t] = [sign(m[2]), sign(m[3])];
    if (m[1] === '~') {
      if (!env.permanent) refuse(clause, 'a spell pumping itself');
      return done({ targets: [], run: (g, ctx) => pump(g, ctx.self, amountOf(ctx, p), amountOf(ctx, t)) });
    }
    const spec = targetSpec(m[1]);
    if (!spec || spec.type !== 'creature') return refuse(clause, `"${m[1]}" isn't a target creature`);
    return done({ targets: [spec], run: (g, ctx, i) => pump(g, refCard(g, ctx.targets[i]), amountOf(ctx, p), amountOf(ctx, t)) });
  }
  // Searching for a basic land (701.23). A search for a card with a stated quality may find nothing (701.23b).
  if ((m = /^search your library for a basic land card, put (?:it|that card) onto the battlefield( tapped)?, then shuffle$/.exec(rest))) {
    const tapped = !!m[1];
    return done({ targets: [], waits: true, run: (g, ctx) => searchBasic(g, ctx.you, 'battlefield', { tapped }) });
  }
  if (/^search your library for a basic land card, reveal (?:it|that card), put (?:it|that card) into your hand, then shuffle$/.test(rest)) {
    return done({ targets: [], waits: true, run: (g, ctx) => searchBasic(g, ctx.you, 'hand') });
  }
  // "A land card", or "a Mountain or Forest card" (a fetch land): found cards aren't revealed (701.23e).
  if ((m = /^search your library for an? (land|(plains|island|swamp|mountain|forest) or (plains|island|swamp|mountain|forest)) card, put (?:it|that card) onto the battlefield( tapped)?, then shuffle$/.exec(rest))) {
    const cap = (w: string) => w[0].toUpperCase() + w.slice(1);
    const find = m[2] ? { subtypes: [cap(m[2]), cap(m[3])], label: `a ${cap(m[2])} or ${cap(m[3])} card` } : { types: ['Land'], label: 'a land card' };
    const tapped = !!m[4];
    return done({ targets: [], waits: true, run: (g, ctx) => search(g, ctx.you, 'battlefield', find, { tapped }) });
  }
  // "Search your library for a card, put that card into your hand, then shuffle": it must find one if it can (701.23d).
  if (/^search your library for a card, put (?:it|that card) into your hand, then shuffle$/.test(rest)) {
    return done({ targets: [], waits: true, run: (g, ctx) => search(g, ctx.you, 'hand') });
  }
  return refuse(clause, 'no template matches');
}

/** Verbs that start a new clause after "and": "you draw a card and you lose 1 life", "gain 1 life and draw a card". */
const CLAUSE_START = /\s+and\s+(?=(?:you |target |each opponent |draws? |gains? |loses? |mills? |create |put |destroy |exile |return |surveil |search |~ deals ))/;

/**
 * Reads an ability's effect text, sentence by sentence and clause by clause. "You may"
 * starts an optional part that the player is asked about each time (608.2d): the rest of
 * the ability waits for the answer.
 */
function effects(text: string, env: Env): Effect[] {
  const out: Effect[] = [];
  for (let sentence of text.replace(/\.$/, '').split(/\.\s+/)) {
    let may = false;
    if (sentence.startsWith('you may ')) {
      may = true;
      sentence = sentence.slice('you may '.length);
    }
    let who: Subject | null = null;
    sentence.split(CLAUSE_START).forEach((clause, k) => {
      // In a permanent's ability, "it deals" and "it gets" mean the permanent.
      const read = effect(env.permanent ? clause.replace(/^it (deals|gets) /, '~ $1 ') : clause, env, who);
      who = read.who;
      // "You may A and B" asks once, for both.
      out.push({ ...read.effect, ...(may && k === 0 ? { may } : {}), ...(may && k > 0 ? { joined: true } : {}) });
    });
  }
  return out;
}

/**
 * Builds what an ability does from its effects: its targets, in order, and a function
 * that runs them. A "you may" effect asks first; the continuation (`then[key]`) does it if
 * the answer is yes, then the rest of the ability.
 */
function build(list: Effect[], key: string, name: string, then: NonNullable<CardScript['then']>): { targets: TargetSpec[]; run: (g: Game, ctx: Ctx) => void } {
  // A choice is made after the effects that don't wait have run: refuse anything that would
  // then happen out of order, unless a "you may" (which waits too) comes between.
  let waiting = false;
  for (const e of list) {
    if (e.may) waiting = false;
    else if (waiting && !e.waits && !e.joined) refuse(e.text, 'an effect after a choice');
    if (e.waits) waiting = true;
  }
  const targets: TargetSpec[] = [];
  const steps = list.map((e) => {
    const i = e.reuse ? targets.length - 1 : targets.length;
    targets.push(...e.targets);
    return { ...e, i };
  });
  // Runs the steps from `from` on, stopping at a "you may" to ask.
  const questions: string[] = [];
  const runFrom = (from: number) => (g: Game, ctx: Ctx) => {
    for (let s = from; s < steps.length; s++) {
      const step = steps[s];
      if (!step.may) {
        step.run(g, ctx, step.i);
        continue;
      }
      ask(g, ctx.you, { text: questions[s], yes: 'Yes', no: 'No', then: `${key}.${s}` });
      return;
    }
  };
  // Each "you may" gets its continuation now, so the script has it when the answer comes.
  // Joined steps ("you may A and B") belong to the "you may" before them.
  steps.forEach((step, s) => {
    if (!step.may) return;
    let end = s + 1;
    while (end < steps.length && steps[end].joined) end++;
    const text = steps.slice(s, end).map((x) => x.text).join(' and ').replace(/~/g, name);
    questions[s] = `${text[0].toUpperCase()}${text.slice(1)}?`;
    then[`${key}.${s}`] = (g: Game, c: ThenCtx) => {
      if (c.yes) for (let j = s; j < end; j++) steps[j].run(g, c, steps[j].i);
      runFrom(end)(g, c);
    };
  });
  return { targets, run: runFrom(0) };
}

// ---------- abilities ----------

/** "{T}", "{2}{R}", "Sacrifice this creature", "Sacrifice a creature" (602.1a, 118). */
function cost(text: string, line: string): { cost: ActivatedAbility['cost']; x: boolean } {
  const out: ActivatedAbility['cost'] = {};
  let x = false;
  for (const part of text.split(/,\s*/)) {
    const life = /^pay (\d+) life$/.exec(part);
    if (part === '{t}') out.tap = true;
    else if (life && !out.life) out.life = parseInt(life[1], 10); // paid only with that much life (119.4)
    else if (/^(\{([0-9]+|[wubrgcx])\})+$/.test(part) && !out.mana) {
      out.mana = part.toUpperCase();
      x = part.includes('{x}');
    } else if (part === 'sacrifice ~') out.sacrifice = true;
    else if (/^discard (a|two|three) cards?$/.test(part) && !out.discard) out.discard = NUMBERS[part.split(' ')[1]];
    else if (/^sacrifice (a|an|another) (creature|artifact|land|permanent)$/.test(part)) {
      const [, article, noun] = /^sacrifice (a|an|another) (\w+)$/.exec(part)!;
      const tests: ((g: Game, c: Card, self: Card) => boolean)[] = [];
      if (noun !== 'creature' && noun !== 'permanent') tests.push((g, c) => hasType(g, c, noun[0].toUpperCase() + noun.slice(1)));
      if (article === 'another') tests.push((_g, c, self) => c.id !== self.id);
      out.sacrificeOne = {
        type: noun === 'creature' ? 'creature' : 'permanent',
        who: 'you',
        label: part.replace('sacrifice ', ''),
        ...(tests.length ? { filter: (g, c, self) => tests.every((t) => t(g, c, self)) } : {}),
      };
    } else refuse(line, `the cost "${part}"`);
  }
  return { cost: out, x };
}

const BASIC_TYPES = ['plains', 'island', 'swamp', 'mountain', 'forest'];

/**
 * "Add {G}.", "Add {C}{C}.", "Add {W} or {B}.", "Add {W}, {U}, or {B}.", "Add one mana of
 * any color.", "Add three mana of any one color." (106, 605), then optionally "This
 * deals 1 damage to you." (a pain land or Talisman) or "Activate only if you control a
 * Plains or a Swamp." (602.5b).
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
    const types = [m[1], m[2]].map((t) => t[0].toUpperCase() + t.slice(1));
    extra.when = (g, self) => g.players[self.controller].battlefield.some((c) => types.some((t) => hasType(g, c, t)));
    rest = rest.slice(0, m.index);
  }
  const base = baseMana(rest);
  return base && { ...base, ...extra };
}

function baseMana(text: string): ManaAbility | null {
  if (text === 'add one mana of any color.') return { amount: 1, colors: 'any' };
  if (text === "add one mana of any color in your commander's color identity.") return { amount: 1, colors: 'identity' };
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
  m = /^add \{([wubrg])\} or \{([wubrg])\}\.$/.exec(text);
  if (m) return { amount: 1, colors: [m[1].toUpperCase(), m[2].toUpperCase()] as ManaSym[] };
  m = /^add \{([wubrg])\}, \{([wubrg])\}, or \{([wubrg])\}\.$/.exec(text);
  if (m) return { amount: 1, colors: [m[1], m[2], m[3]].map((x) => x.toUpperCase()) as ManaSym[] };
  return null;
}

/** "[Other] [Soldier] creatures you control get +N/+N [and have K]" / "... have K" (611.3a, 613.4c). */
function staticLine(line: string): ((g: Game, self: Card, c: Card) => StaticBonus | null) | null {
  const m = /^(other )?(?:([a-z]+) )?creatures you control (?:get ([+-]\d+)\/([+-]\d+)(?: and have (.+))?|have (.+))\.$/.exec(line);
  if (!m) return null;
  const kwText = m[5] ?? m[6];
  const keywords = kwText ? kwText.replace(/,? and /g, ', ').split(', ') : [];
  if (keywords.some((k) => !GRANTABLE.includes(k))) return null;
  const type = m[2] ? m[2][0].toUpperCase() + m[2].slice(1) : null;
  const bonus: StaticBonus = { ...(m[3] ? { power: parseInt(m[3], 10), toughness: parseInt(m[4], 10) } : {}), ...(keywords.length ? { keywords } : {}) };
  const other = !!m[1];
  return (g, self, c) => ((!other || c.id !== self.id) && c.controller === self.controller && isCreature(g, c) && (!type || hasType(g, c, type)) ? bonus : null);
}

/** The card's text, one ability per line, lower case, with reminder text gone and "~" for the card itself. */
function lines(d: CardData): { text: string; original: string }[] {
  let t = d.oracleText.replace(/\([^)]*\)/g, '').replace(/−/g, '-');
  const short = d.name.split(',')[0];
  for (const n of short !== d.name ? [d.name, short] : [d.name]) t = t.split(n).join('~');
  t = t.replace(/\bthis (creature|artifact|enchantment|land|permanent|spell)\b/gi, '~');
  return t
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((original) => ({ text: original.toLowerCase(), original: original.replace(/~/g, d.name) }));
}

const isKeywordLine = (line: string) => line.split(',').every((part) => BARE_KEYWORDS.includes(part.trim()));

/** Keywords that change how a spell is cast or where it goes, which the engine applies from the card's keywords. */
const CAST_KEYWORDS = ['delve', 'rebound', 'paradigm'];

const HOOKS: Record<string, 'onEnter' | 'onDies' | 'onAttack'> = { 'when ~ enters': 'onEnter', 'when ~ dies': 'onDies', 'whenever ~ attacks': 'onAttack' };

const landsOf = (g: Game, pid: PlayerId) => g.players[pid].battlefield.filter((x) => isLand(g, x));
const capital = (w: string) => w[0].toUpperCase() + w.slice(1);

/**
 * "This land enters tapped unless [condition]": the conditions, checked as it enters
 * (614.1c), from the side of the player it enters under. It is on the battlefield by then,
 * so "other lands" leaves it out.
 */
const UNLESS: [RegExp, (m: RegExpExecArray) => (g: Game, c: Card, you: PlayerId) => boolean][] = [
  [/^you control two or more other lands$/, () => (g, c, you) => landsOf(g, you).filter((x) => x.id !== c.id).length >= 2],
  [/^you control two or more basic lands$/, () => (g, c, you) => landsOf(g, you).filter((x) => x.id !== c.id && hasType(g, x, 'Basic')).length >= 2],
  [/^you control a basic land$/, () => (g, c, you) => landsOf(g, you).some((x) => x.id !== c.id && hasType(g, x, 'Basic'))],
  // Players who have left the game aren't opponents any more (800.4a).
  [/^you have two or more opponents$/, () => (g, _c, you) => opponentsOf(g, you).length >= 2],
  [/^your opponents control eight or more lands$/, () => (g, _c, you) => opponentsOf(g, you).reduce((n, o) => n + landsOf(g, o.id).length, 0) >= 8],
  [
    /^you control an? (plains|island|swamp|mountain|forest) or an? (plains|island|swamp|mountain|forest)$/,
    (m) => (g, c, you) => g.players[you].battlefield.some((x) => x.id !== c.id && [m[1], m[2]].some((t) => hasType(g, x, capital(t)))),
  ],
];

/**
 * "As this land enters, you may pay 2 life. If you don't, it enters tapped." A replacement
 * effect with a choice (614.12a): the player can pay only with 2 life to pay (119.4).
 */
const shockEnter: Pick<CardScript, 'replaceEnter' | 'then' | 'botChoice'> = {
  replaceEnter: (g, c, controller) => {
    ask(g, controller, { text: `Pay 2 life, or ${c.name} enters tapped.`, life: 2, yes: 'Pay 2 Life', no: 'Enter Tapped', then: 'shock', script: c.id });
    return true;
  },
  then: { shock: (g, { self, yes, data }) => finishEnter(g, self, data, { tapped: !yes }) },
  // A bot pays on its own turn while it has life to spare.
  botChoice: { shock: (g, pid) => ({ type: 'answer', yes: g.active === pid && g.players[pid].life > 15 }) },
};

/**
 * Lines that change how the card is cast or enters, or that apply while it is on the
 * battlefield: they add to the script and return true. Lines it doesn't know return false.
 */
function cardLine(text: string, original: string, script: CardScript, then: NonNullable<CardScript['then']>): boolean {
  let m: RegExpExecArray | null;
  // "As an additional cost to cast this spell, discard a card / pay N life." (118.8, 119.4)
  if ((m = /^as an additional cost to cast ~, (discard (a|two|three) cards?|pay (\d+) life)\.$/.exec(text))) {
    script.additionalCost = m[2] ? { discard: NUMBERS[m[2]] } : { life: parseInt(m[3], 10) };
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
  if (text === "as ~ enters, you may pay 2 life. if you don't, it enters tapped.") {
    script.replaceEnter = shockEnter.replaceEnter;
    Object.assign(then, shockEnter.then);
    script.botChoice = shockEnter.botChoice;
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
  // "Red spells you cast cost {1} less to cast." Only generic mana is taken off (601.2f).
  if ((m = /^(white|blue|black|red|green) spells you cast cost \{(\d+)\} less to cast\.$/.exec(text))) {
    const color = COLOR_WORDS[m[1]];
    const n = parseInt(m[2], 10);
    script.costModifier = (g, self, spell, caster) => (caster === self.controller && isColor(g, spell, color) ? -n : 0);
    return true;
  }
  // "If you control a commander, you may cast this spell without paying its mana cost." An alternative cost (118.9).
  if (text === 'if you control a commander, you may cast ~ without paying its mana cost.') {
    const alt = { label: 'free: you control a commander', mana: '', when: (g: Game, self: Card) => g.players[self.controller].battlefield.some((c) => c.isCommander) };
    script.alternativeCosts = [...(script.alternativeCosts ?? []), alt];
    return true;
  }
  // Cycling [cost] (702.29a): "[Cost], Discard this card: Draw a card", activated from the hand.
  if ((m = /^cycling ((?:\{[0-9wubrgc]\})+)$/.exec(text))) {
    const mana = m[1].toUpperCase();
    const ab: ActivatedAbility = { cost: { mana, discardSelf: true }, fromHand: true, text: `Cycling ${mana}`, resolve: (g, ctx) => draw(g, ctx.you) };
    const had = script.activated ? (Array.isArray(script.activated) ? script.activated : [script.activated]) : [];
    script.activated = [...had, ab];
    return true;
  }
  return false;
}

/** "Whenever you cast a spell", "Whenever you cast a noncreature spell" (603.2, 601.2i). */
const CAST_TRIGGER = /^whenever you cast an? (noncreature )?spell, (.+)$/;

/**
 * Reads a card's Oracle text into a script, or refuses it with the clause it couldn't
 * read. A card with only keywords the engine knows gets an empty script.
 */
export function parseCard(d: CardData): Parsed {
  try {
    return { ok: true, script: readCard(d) };
  } catch (e) {
    // Clauses are read in lower case with "~" for the card; give them back with its name.
    if (e instanceof Refusal) return { ok: false, clause: e.clause.replace(/~/g, d.name), reason: e.message.replace(/~/g, d.name) };
    throw e;
  }
}

function readCard(d: CardData): CardScript {
  if (d.faces) refuse(d.name, 'a card with more than one face');
  const spell = d.typeLine.includes('Instant') || d.typeLine.includes('Sorcery');
  const script: CardScript = {};
  const then: NonNullable<CardScript['then']> = {};
  const statics: ((g: Game, self: Card, c: Card) => StaticBonus | null)[] = [];
  const mana: ManaAbility[] = [];
  const activated: ActivatedAbility[] = [];
  const spellEffects: Effect[] = [];
  lines(d).forEach(({ text, original }, n) => {
    if (isKeywordLine(text)) return;
    // Prowess (702.108a) is a triggered ability, alone or with other keywords ("Flying, prowess").
    const parts = text.split(',').map((p) => p.trim());
    if (parts.includes('prowess') && parts.every((p) => p === 'prowess' || BARE_KEYWORDS.includes(p))) {
      if (script.onCast) refuse(original, 'two abilities that trigger on the same event');
      script.onCast = prowess;
      return;
    }
    // Casting rules the engine applies itself: delve (702.66), rebound (702.88), paradigm (702.192).
    if (CAST_KEYWORDS.includes(text)) return;
    // Extort (702.101a) and job select (702.182a) are triggered abilities.
    if (text === 'extort') {
      if (script.onCast) refuse(original, 'two abilities that trigger on the same event');
      script.onCast = extort.onCast;
      Object.assign(then, extort.then);
      script.botChoice = { ...script.botChoice, ...extort.botChoice };
      return;
    }
    if (text === 'job select') {
      if (script.onEnter) refuse(original, 'two abilities that trigger on the same event');
      script.onEnter = jobSelect;
      return;
    }
    if (cardLine(text, original, script, then)) return;
    if (spell) {
      spellEffects.push(...effects(text, { permanent: false, x: false }));
      return;
    }
    // Triggered abilities: "When this enters", "When this dies", "Whenever this attacks" (603.1).
    const trig = /^(when ~ enters|when ~ dies|whenever ~ attacks), (.+)$/.exec(text);
    if (trig) {
      const hook = HOOKS[trig[1]];
      if (script[hook]) refuse(original, 'two abilities that trigger on the same event');
      const { targets, run } = build(effects(trig[2], { permanent: true, x: false }), `t${n}`, d.name, then);
      if (hook === 'onEnter') {
        // A lone "enters" ability's targets are the script's own.
        if (targets.length) script.targets = targets;
        script.onEnter = (g, ctx) => run(g, ctx);
      } else script[hook] = { resolve: (g: Game, ctx: Ctx) => run(g, ctx), targets, text: original };
      return;
    }
    const cast = CAST_TRIGGER.exec(text);
    if (cast) {
      if (script.onCast) refuse(original, 'two abilities that trigger on the same event');
      const noncreature = !!cast[1];
      const { targets, run } = build(effects(cast[2], { permanent: true, x: false }), `t${n}`, d.name, then);
      script.onCast = {
        when: (g, e) => e.caster === e.self.controller && (!noncreature || !isCreature(g, e.card)),
        resolve: (g: Game, ctx: Ctx) => run(g, ctx),
        targets,
        text: original,
      };
      return;
    }
    // Activated abilities, mana abilities among them: "[Cost]: [Effect]" (602.1, 605.1a).
    const act = /^([^:]+): (.+)$/.exec(text);
    if (act && !/^(when|whenever|at) /.test(text)) {
      const sorcery = / activate only as a sorcery\.$/.test(act[2]);
      const body = act[2].replace(/ activate only as a sorcery\.$/, '');
      const add = manaEffect(body);
      if (add) {
        // "{T}", or mana and "{T}" like a Signet's "{1}, {T}" or a filter land's "{W/B}, {T}" (605.1a).
        const paid = /^((?:\{(?:\d+|[wubrgc]|[wubrg]\/[wubrg])\})+), \{t\}$/.exec(act[1]);
        if (act[1] !== '{t}' && !paid) refuse(original, 'a mana ability with a cost other than {T}');
        mana.push(paid ? { ...add, cost: paid[1].toUpperCase() } : add);
        return;
      }
      const paid = cost(act[1], original);
      const { targets, run } = build(effects(body, { permanent: true, x: paid.x }), `a${n}`, d.name, then);
      activated.push({ cost: paid.cost, ...(sorcery ? { sorcery } : {}), ...(targets.length ? { targets } : {}), text: original, resolve: run });
      return;
    }
    const lord = staticLine(text);
    if (lord) {
      statics.push(lord);
      return;
    }
    refuse(original, 'no template matches');
  });
  if (spell && spellEffects.length) {
    const { targets, run } = build(spellEffects, 's', d.name, then);
    if (targets.length) script.targets = targets;
    script.onResolve = run;
  }
  if (mana.length) script.mana = mana.length === 1 ? mana[0] : mana;
  // Cycling, read as a card line, comes after the card's other activated abilities.
  const had = script.activated ? (Array.isArray(script.activated) ? script.activated : [script.activated]) : [];
  const all = [...activated, ...had];
  if (all.length) script.activated = all.length === 1 ? all[0] : all;
  if (statics.length) {
    // Each line is its own ability, and its own effect (613.7a: they share the card's timestamp).
    script.static = (g, self, c) => statics.map((s) => s(g, self, c));
  }
  if (Object.keys(then).length) script.then = then;
  return script;
}

/** Does this card need a script at all: does any line say more than keywords the engine knows? */
export const needsScript = (d: CardData) => !d.faces && lines(d).some((l) => !isKeywordLine(l.text));

const REFUSALS = new Map<string, { clause: string; reason: string }>();

/** The clause `scriptCards` couldn't read on this card, and why, or undefined if it didn't refuse it. */
export const refusalOf = (name: string) => REFUSALS.get(name);

/**
 * Registers a parsed script for each of these cards that has rules text but no hand
 * script. Returns the ones it refused, with the clause. Hand scripts always win.
 */
export function scriptCards(names: string[]): { name: string; clause: string; reason: string }[] {
  const refused: { name: string; clause: string; reason: string }[] = [];
  const scripts: Record<string, CardScript> = {};
  for (const name of names) {
    const d = cardData(name);
    if (hasScript(name) || !needsScript(d)) continue;
    const p = parseCard(d);
    if (p.ok) scripts[name] = p.script;
    else {
      refused.push({ name, clause: p.clause, reason: p.reason });
      REFUSALS.set(name, { clause: p.clause, reason: p.reason });
    }
  }
  registerScripts(scripts);
  return refused;
}

// Every pool card without a hand script gets a parsed one, if the parser can read it.
scriptCards(ALL_CARD_NAMES);
