/**
 * The layer system (613): an object's characteristics worked out from its copiable values
 * and every continuous effect that applies to it, layer by layer, in timestamp order.
 *
 * Every effect is an `Entry` with a timestamp (613.7) and its parts by layer (`LayerParts`):
 *  - effects of resolved spells and abilities, locked in on the permanent (`Card.continuous`, 611.2c);
 *  - effects of static abilities (`CardScript.static`), which apply to whatever they say at
 *    any moment (611.3a). Each is asked, with the object as it is at that point, in every
 *    layer until one of its parts applies there; from then on it keeps that answer, so it
 *    applies to the same set of objects in its later layers (613.6);
 *  - rules that act like effects: counters (613.4c, 613.1f), dash's haste (702.109a) and a
 *    reconfigured Equipment not being a creature (702.151b);
 *  - characteristic-defining abilities (`CardScript.basePT`, 604.3), first in their layer (613.3).
 *
 * Layer 6 also works out which abilities it has (613.1f): an effect can take them away
 * (`LayerParts.loseAll`, `lose`). A static ability's effect, or a characteristic-defining
 * ability's, applies only if its object still has the ability when the effect would start to
 * apply (113.3d); once started, it goes on in later layers even if the ability is lost (613.6).
 * Before layer 6 every object has the abilities of its copiable values. In layer 6 an effect
 * that would come from an ability another permanent loses doesn't apply, whatever the
 * timestamps: it depends on the effect that takes the ability away (613.8a).
 *
 * A static ability may look at the object it is deciding about (`isCreature(g, c)`): while an
 * object is being worked out, a question about it gets the answer so far. A question about
 * another object works that one out in full first. Dependency (613.8) isn't applied yet:
 * effects in one layer apply in timestamp order.
 */
import { CREATURE_TYPES, cardData } from '../cards/db';
import { hasStaticScript } from './registry';
import { CANT_ATTACK, CANT_BLOCK, MUST_ATTACK, SUPPORTED_KEYWORDS, battlefield, data, hasReconfigure, permanent, scriptFor } from './rules';
import type { Card, CardScript, Characteristics, ContinuousEffect, Game, LayerParts } from './types';

/** The layers that change characteristics this engine has effects for, in order (613.1, 613.4). Layers 1-3 come first: see `LayerParts`. */
export const LAYERS = ['4', '5', '6', '7a', '7b', '7c', '7d'] as const;
export type Layer = (typeof LAYERS)[number];

/** The layer each part of an effect applies in. */
const LAYER_OF: Record<keyof LayerParts, Layer> = {
  types: '4',
  notTypes: '4',
  subtypes: '4',
  colors: '5',
  loseAll: '6',
  lose: '6',
  keywords: '6',
  ward: '6',
  mana: '6',
  grant: '6',
  activatedOf: '6',
  flags: '6',
  setPower: '7b',
  setToughness: '7b',
  power: '7c',
  toughness: '7c',
  switchPT: '7d',
};

/** Does effect `p` have a part that applies in layer `l`? */
function appliesIn(p: LayerParts, l: Layer): boolean {
  for (const k in p) if (LAYER_OF[k as keyof LayerParts] === l && p[k as keyof LayerParts] !== undefined) return true;
  return false;
}

/** One continuous effect that may apply to the object being worked out. */
interface Entry {
  ts: number;
  /** Order among entries with the same timestamp: several abilities of one object, in printed order. */
  seq: number;
  /** From a characteristic-defining ability that defines power and toughness: applied in layer 7a (613.4a). */
  cda?: boolean;
  /** Its parts, once known: locked in (611.2c), or fixed once a static ability's effect started to apply (613.6). */
  parts?: LayerParts;
  /** A static ability's effect, not yet applying: its ability number `i` of `source`. */
  source?: Source;
  i?: number;
  /** The permanent whose static ability it is. */
  from?: Card;
}

/**
 * A permanent's static abilities, as they bear on the object being worked out. Asked again
 * only if that object changed since the last answer (`Working.version`): nothing else changes
 * while it is worked out.
 */
interface Source {
  ask: () => LayerParts | (LayerParts | null)[] | null;
  version: number;
  answer: (LayerParts | null)[];
}

function answerOf(s: Source, version: number, i: number): LayerParts | null {
  if (s.version !== version) {
    const r = s.ask();
    s.answer = Array.isArray(r) ? r : [r];
    s.version = version;
  }
  return s.answer[i] ?? null;
}

/** An object partway through the layers. */
interface Working extends Characteristics {
  /** Goes up each time an effect changes it. */
  version: number;
}

const num = (s?: string) => {
  const n = parseInt(s ?? '', 10);
  return Number.isNaN(n) ? 0 : n;
};

/** Its copiable values (707.2), the starting point for layers 2 and on (613.2c). */
function start(c: Card): Working {
  const d = data(c);
  return {
    typeLine: changeling(d.typeLine, d.keywords),
    colors: d.colors,
    keywords: d.keywords.map((k) => k.toLowerCase()),
    power: num(d.power),
    toughness: num(d.toughness),
    own: true,
    lost: [],
    wards: [],
    mana: [],
    grants: [],
    activatedOf: [],
    flags: [],
    version: 0,
  };
}

/**
 * Changeling: "This object is every creature type" (702.73a). A characteristic-defining
 * ability (604.3), so it applies in every zone, before other layer 4 effects (613.3).
 */
function changeling(typeLine: string, keywords: string[]): string {
  if (!keywords.includes('Changeling')) return typeLine;
  const [left, right] = typeLine.split(' — ');
  const own = right ? right.split(' ') : [];
  return `${left} — ${[...own, ...CREATURE_TYPES.filter((t) => !own.includes(t))].join(' ')}`;
}

/** Can a "keywords" part carry this without it being an ability, so it isn't lost with them: a restriction (113.12)? */
const notAbility = (k: string) => k === CANT_ATTACK || k === CANT_BLOCK || k === MUST_ATTACK;
/** Flags that are designations, not abilities (701.64b). */
const DESIGNATIONS = ['harnessed'];
/** Keyword abilities the engine reads from the keyword list alone, so losing one is taking it off the list (`LayerParts.lose`). */
const LISTED = ['flying', 'reach', 'deathtouch', 'lifelink', 'trample', 'vigilance', 'haste', 'first strike', 'double strike', 'menace', 'defender', 'hexproof', 'indestructible', 'flash'];
/** Keyword abilities its script carries, which `lose` takes from the script too (`Characteristics.lost`). */
const SCRIPTED = ['ward', 'enchant'];

const addAll = (to: string[], xs: string[] | undefined) => {
  for (const x of xs ?? []) if (!to.includes(x)) to.push(x);
};

/** Does entry `e`, with parts `p`, apply in layer `l`? */
const appliesAt = (e: Entry, p: LayerParts, l: Layer) =>
  e.cda ? l === '7a' && (p.setPower !== undefined || p.setToughness !== undefined) : appliesIn(p, l);

/** Applies the parts of effect `p` that belong to layer `l`. */
function apply(w: Working, p: LayerParts, l: Layer) {
  switch (l) {
    case '4': {
      const [left, right] = w.typeLine.split(' — ');
      let words = left.split(' ');
      let subs = right ? right.split(' ') : [];
      for (const t of p.notTypes ?? []) {
        words = words.filter((x) => x !== t);
        // It loses its creature types too, unless it is still a kindred (205.3m, 702.151b).
        if (t === 'Creature' && !words.includes('Kindred')) subs = subs.filter((s) => !CREATURE_TYPES.includes(s));
      }
      for (const t of p.types ?? []) if (!words.includes(t)) words.push(t);
      const creature = words.includes('Creature') || words.includes('Kindred');
      // An object can't gain a subtype that doesn't go with one of its types (205.3d).
      for (const s of p.subtypes ?? []) if (!subs.includes(s) && (creature || !CREATURE_TYPES.includes(s))) subs.push(s);
      w.typeLine = subs.length ? `${words.join(' ')} — ${subs.join(' ')}` : words.join(' ');
      break;
    }
    case '6':
      // An effect that takes abilities away and gives others (Animate Dead's) takes them first.
      if (p.loseAll) {
        w.own = false;
        w.keywords = w.keywords.filter(notAbility);
        w.flags = w.flags.filter((f) => DESIGNATIONS.includes(f));
        w.wards = [];
        w.mana = [];
        w.grants = [];
        w.activatedOf = [];
      }
      if (p.lose) {
        for (const k of p.lose) {
          if (!LISTED.includes(k) && !SCRIPTED.includes(k) && !k.startsWith('protection from')) throw new Error(`Losing "${k}" isn't supported: its script carries it.`);
        }
        // Every instance of it (113.10b).
        w.keywords = w.keywords.filter((k) => !p.lose!.includes(k));
        if (p.lose.includes('ward')) w.wards = [];
        const scripted = p.lose.filter((k) => SCRIPTED.includes(k) && !w.lost.includes(k));
        if (scripted.length) w.lost = [...w.lost, ...scripted];
      }
      if (p.keywords) addAll((w.keywords = [...w.keywords]), p.keywords);
      if (p.ward) w.wards = [...w.wards, p.ward];
      if (p.mana) w.mana = [...w.mana, p.mana];
      if (p.grant) w.grants = [...w.grants, p.grant];
      if (p.activatedOf) addAll((w.activatedOf = [...w.activatedOf]), p.activatedOf);
      if (p.flags) addAll((w.flags = [...w.flags]), p.flags);
      break;
    case '7a':
    case '7b':
      if (p.setPower !== undefined) w.power = p.setPower;
      if (p.setToughness !== undefined) w.toughness = p.setToughness;
      break;
    case '7c':
      w.power += p.power ?? 0;
      w.toughness += p.toughness ?? 0;
      break;
    case '7d':
      // Each switch takes the values it finds (613.4d), so two cancel out.
      if (p.switchPT) [w.power, w.toughness] = [w.toughness, w.power];
      break;
    case '5':
      if (p.colors) w.colors = [...p.colors];
      break;
  }
  w.version++;
}

/**
 * Is there anything on the battlefield that can take abilities away: an effect from a resolved
 * spell or ability, or a static ability that says it can (`CardScript.removesAbilities`)? While
 * there isn't, every permanent has its own abilities, and nothing needs working out.
 */
export function removesAbilities(g: Game): boolean {
  const isHeld = held?.g === g;
  const isFrozen = !isHeld && Object.isFrozen(g) && Object.isFrozen(g.players);
  const known = isHeld ? held!.removing : isFrozen ? removing.get(g) : undefined;
  if (known !== undefined) return known;
  const any = battlefield(g).some((c) => scriptFor(c).removesAbilities || c.continuous.some((e) => e.loseAll || e.lose));
  if (isHeld) held!.removing = any;
  else if (isFrozen) removing.set(g, any);
  return any;
}
const removing = new WeakMap<Game, boolean>();

/** Does permanent `c` have the abilities of its copiable values now (`Characteristics.own`)? */
export const hasOwnAbilities = (g: Game, c: Card) => (c.lki ? c.lki.own !== false : c.zone !== 'battlefield' || !removesAbilities(g) || characteristics(g, c, '6').own);

/**
 * Does the ability entry `e` comes from exist as it would start to apply in layer `l` to `c`,
 * worked out as far as `w`? See the top of this file.
 */
function exists(g: Game, c: Card, w: Working, e: Entry, l: Layer): boolean {
  if (e.cda || e.from?.id === c.id) return w.own;
  if (!e.from || LAYERS.indexOf(l) < LAYERS.indexOf('6')) return true;
  return hasOwnAbilities(g, e.from);
}

/** Does a locked-in effect still apply: has its "for as long as" object stayed (611.2b)? */
const lasts = (g: Game, e: ContinuousEffect) => !e.while || permanent(g, e.while.id)?.moves === e.while.moves;

/** Its ability that defines power and toughness (604.3), unless a copy effect set them instead (707.9d). */
const definesPT = (c: Card) => (c.copy?.power === undefined && c.copy?.toughness === undefined ? scriptFor(c).basePT : undefined);

/** Every effect that may apply to permanent `c`, in the order they apply in each layer (613.3, 613.7). `temporary`: include effects with a duration. */
function entries(g: Game, c: Card, temporary: boolean): Entry[] {
  const out: Entry[] = [];
  let seq = 0;
  // Its characteristic-defining ability that defines power and toughness, first (613.4a).
  const basePT = definesPT(c);
  if (basePT) {
    const ask = () => {
      const { power, toughness } = basePT(g, c);
      return { setPower: power, setToughness: toughness };
    };
    out.push({ ts: -Infinity, seq: seq++, cda: true, source: { ask, version: -1, answer: [] }, i: 0 });
  }
  // A reconfigured Equipment isn't a creature from the moment it was attached (702.151b, 613.7e).
  if (c.attachedTo && hasReconfigure(c)) out.push({ ts: c.ts, seq: seq++, parts: { notTypes: ['Creature'] } });
  // A permanent whose dash cost was paid has haste (702.109a).
  if (c.cast?.dash) out.push({ ts: c.ts, seq: seq++, parts: { keywords: ['haste'] } });
  // +1/+1 and -1/-1 counters (122.1a, 613.4c), and keyword counters (122.1b, 613.1f), each kind from when it was last put on (613.7c).
  for (const [kind, n] of Object.entries(c.counters)) {
    if (n <= 0) continue;
    const ts = c.counterTs?.[kind] ?? c.ts;
    if (kind === '+1/+1') out.push({ ts, seq: seq++, parts: { power: n, toughness: n } });
    else if (kind === '-1/-1') out.push({ ts, seq: seq++, parts: { power: -n, toughness: -n } });
    else if (SUPPORTED_KEYWORDS.includes(kind)) out.push({ ts, seq: seq++, parts: { keywords: [kind] } });
  }
  for (const e of c.continuous) if ((temporary || e.until === 'leaves') && lasts(g, e)) out.push({ ts: e.ts, seq: seq++, parts: e });
  // Static abilities of permanents on the battlefield (611.3), with their source's timestamp (613.7a).
  for (const { src, fn } of staticSources(g)) {
    const source: Source = { ask: () => fn(g, src, c), version: -1, answer: [] };
    answerOf(source, 0, 0);
    source.answer.forEach((_, i) => out.push({ ts: src.ts, seq: seq++, source, i, from: src }));
  }
  return out.sort((a, b) => (a.cda === b.cda ? 0 : a.cda ? -1 : 1) || a.ts - b.ts || a.seq - b.seq);
}

/** The names a card's scripts are under: its own, and each face's. */
const scriptNames = new Map<string, string[]>();

/** Could permanent `c` have a static ability? A quick check before looking up its script. */
function mayHaveStatic(c: Card): boolean {
  if (c.copy) return true;
  let names = scriptNames.get(c.name);
  if (!names) {
    const d = cardData(c.name);
    scriptNames.set(c.name, (names = [d.name, c.name, ...(d.faces ?? []).map((f) => f.name)]));
  }
  return names.some(hasStaticScript);
}

type StaticFn = NonNullable<CardScript['static']>;
type Sources = { src: Card; fn: StaticFn }[];
const frozenSources = new WeakMap<Game, Sources>();

/** The permanents with static abilities (611.3), in battlefield order. */
function staticSources(g: Game): Sources {
  const isHeld = held?.g === g;
  const isFrozen = !isHeld && Object.isFrozen(g) && Object.isFrozen(g.players);
  const known = isHeld ? held!.sources : isFrozen ? frozenSources.get(g) : undefined;
  if (known) return known;
  const out: Sources = [];
  for (const p of g.players) {
    if (p.lost) continue;
    for (const src of p.battlefield) {
      const fn = mayHaveStatic(src) && scriptFor(src).static;
      if (fn) out.push({ src, fn });
    }
  }
  if (isHeld) held!.sources = out;
  else if (isFrozen) frozenSources.set(g, out);
  return out;
}

/**
 * Objects partway through the layers now, by id, so a question about one gets its state so
 * far, with how deep in the questions it was asked (`depth`: 0 for the first).
 */
const working = new Map<string, { w: Working; depth: number }>();
/** For each object partway, from the first asked: has its answer seen an object below it partway? */
const tainted: boolean[] = [];
/** Answers for games that can't change any more: Immer freezes every state it makes. */
const frozen = new WeakMap<Game, WeakMap<Card, Result>>();
/** Answers kept while a game doesn't change (`settled`). */
let held: { g: Game; answers: WeakMap<Card, Result>; sources?: Sources; removing?: boolean } | null = null;

interface Result {
  chars: Characteristics;
  /** The last layer it was worked out to. */
  upTo: Layer;
}

/**
 * Runs `fn`, which only asks about `g` and doesn't change it: each object's characteristics
 * are worked out once in it, not once for each question.
 */
export function settled<T>(g: Game, fn: () => T): T {
  if (held) return fn();
  held = { g, answers: new WeakMap() };
  try {
    return fn();
  } finally {
    held = null;
  }
}

/** Where answers about `g` are kept, if they can be. */
function storeFor(g: Game): WeakMap<Card, Result> | null {
  if (held?.g === g) return held.answers;
  if (!Object.isFrozen(g) || !Object.isFrozen(g.players)) return null;
  let store = frozen.get(g);
  if (!store) frozen.set(g, (store = new WeakMap()));
  return store;
}

/**
 * The characteristics of `c` with every continuous effect applied (613.1), up to layer
 * `upTo` (later layers don't change what earlier ones decided). On the battlefield that is
 * every effect; elsewhere, only its characteristic-defining abilities (604.3). A copy that
 * remembers a permanent as it last was (`Card.lki`) has the characteristics it had then.
 * `temporary: false` leaves out effects with a duration, for the bots' sense of what lasts.
 */
export function characteristics(g: Game, c: Card, upTo: Layer = '7d', temporary = true): Characteristics {
  if (c.lki) return c.lki;
  const partial = working.get(c.id);
  if (partial) {
    // Every answer being worked out above it now depends on it partway.
    for (let d = partial.depth + 1; d < tainted.length; d++) tainted[d] = true;
    return partial.w;
  }
  if (c.zone !== 'battlefield') return offBattlefield(g, c);
  const store = temporary ? storeFor(g) : null;
  // A kept answer is used only for a first question: asked while another object is partway,
  // the answer could depend on that object as it is so far.
  const known = !working.size ? store?.get(c) : undefined;
  if (known && LAYERS.indexOf(known.upTo) >= LAYERS.indexOf(upTo)) return known.chars;
  const { chars, clean } = layers(g, c, upTo, temporary);
  // An answer is kept only if it saw no other object partway: it is the same as a first question's.
  if (clean) store?.set(c, { chars, upTo });
  return chars;
}

/** A card off the battlefield: its copiable values, with its characteristic-defining abilities applied (604.3). */
function offBattlefield(g: Game, c: Card): Characteristics {
  const { version: _, ...w } = start(c);
  const basePT = definesPT(c);
  if (basePT) ({ power: w.power, toughness: w.toughness } = basePT(g, c));
  return w;
}

function layers(g: Game, c: Card, upTo: Layer, temporary: boolean): { chars: Characteristics; clean: boolean } {
  const w = start(c);
  const depth = tainted.length;
  working.set(c.id, { w, depth });
  tainted.push(false);
  let clean = false;
  try {
    const all = entries(g, c, temporary);
    for (const l of LAYERS) {
      for (const e of all) {
        // A static ability's effect that hasn't started to apply: does it now?
        const p = e.parts ?? answerOf(e.source!, w.version, e.i!);
        if (!p || !appliesAt(e, p, l)) continue;
        if (!e.parts && !exists(g, c, w, e, l)) continue;
        if (e.from && (p.loseAll || p.lose) && !scriptFor(e.from).removesAbilities) throw new Error(`${e.from.name}'s static ability removes abilities: its script needs removesAbilities.`);
        e.parts = p;
        apply(w, p, l);
      }
      if (l === upTo) break;
    }
  } finally {
    working.delete(c.id);
    clean = !tainted.pop();
  }
  const { version: _, ...chars } = w;
  return { chars, clean };
}
