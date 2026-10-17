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
 * A static ability may look at the object it is deciding about (`isCreature(g, c)`): while an
 * object is being worked out, a question about it gets the answer so far. A question about
 * another object works that one out in full first.
 *
 * Within a layer, effects apply in timestamp order unless one depends on another (613.8):
 * applying the other would change whether it exists, what it applies to or what it does
 * (613.8a). Each static ability's answer is asked again with the other effect applied, and
 * if the answer changes, it waits until just after that effect (613.8b). Effects that
 * depend on each other in a loop apply in timestamp order, and the order is worked out
 * again after each effect applies (613.8c). Only an ability that looked at a characteristic
 * this layer can change can depend on anything, so most layers need no extra asking.
 */
import { CREATURE_TYPES, SUBTYPES, cardData } from '../cards/db';
import { hasStaticScript } from './registry';
import { SUPPORTED_KEYWORDS, counterCount, data, hasReconfigure, permanent, scriptFor } from './rules';
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
  keywords: '6',
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
  /** The permanent whose static abilities these are; none for a characteristic-defining ability, which only defines its own object. */
  id?: string;
  /** The characteristics the last answer looked at. */
  reads: Read[];
}

/** A question an ability's answer asked about a permanent's characteristics. */
interface Read {
  id: string;
  /** Index in `LAYERS` of the last layer it asked to have applied. */
  upTo: number;
  temporary: boolean;
}

/** The questions the ability being asked now has asked, or null when none is being asked. */
let reading: Read[] | null = null;

/** Asks `s` now, noting what its answer looked at. */
function askNow(s: Source): { answer: (LayerParts | null)[]; reads: Read[] } {
  const outer = reading;
  const reads: Read[] = (reading = []);
  try {
    const r = s.ask();
    return { answer: Array.isArray(r) ? r : [r], reads };
  } finally {
    reading = outer;
  }
}

function answerOf(s: Source, version: number, i: number): LayerParts | null {
  if (s.version !== version) {
    ({ answer: s.answer, reads: s.reads } = askNow(s));
    s.version = version;
  }
  return s.answer[i] ?? null;
}

/** An object partway through the layers. */
interface Working extends Characteristics {
  /** Goes up each time an effect changes it. */
  version: number;
  /** Subtypes it lost with a card type an effect removed, back if a later effect gives that card type back (205.1a). */
  suspended?: string[];
}

/** A type line split up (205): the words before the dash (supertypes and card types) and its subtypes. */
export interface TypeWords {
  readonly types: readonly string[];
  readonly subtypes: readonly string[];
  /** Both, for looking one up. */
  readonly all: ReadonlySet<string>;
}

const TWO_WORD = new Set(CREATURE_TYPES.filter((t) => t.includes(' ')));
const typeWords = new Map<string, TypeWords>();

/**
 * Splits type line `line` into its types and subtypes. Each word after the dash is a subtype,
 * except a two-word creature type like Time Lord (205.3b). Remembered: there are few type lines.
 */
export function typesOf(line: string): TypeWords {
  let t = typeWords.get(line);
  if (t) return t;
  const [left, right] = line.split(' — ');
  const words = right ? right.split(' ') : [];
  const subtypes: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const two = `${words[i]} ${words[i + 1]}`;
    if (TWO_WORD.has(two)) subtypes.push(two), i++;
    else subtypes.push(words[i]);
  }
  const types = left.split(' ').filter(Boolean);
  t = { types, subtypes, all: new Set([...types, ...subtypes]) };
  if (typeWords.size > 5000) typeWords.clear();
  typeWords.set(line, t);
  return t;
}

const typeLineOf = (types: readonly string[], subtypes: readonly string[]) => (subtypes.length ? `${types.join(' ')} — ${subtypes.join(' ')}` : types.join(' '));

/** The card types each subtype goes with (205.3g-q). */
const TYPES_OF_SUBTYPE = new Map<string, string[]>();
for (const [type, subs] of Object.entries(SUBTYPES)) for (const s of subs) TYPES_OF_SUBTYPE.set(s, [...(TYPES_OF_SUBTYPE.get(s) ?? []), type]);

/**
 * Does subtype `s` go with one of card types `types` (205.3c)? A subtype the rules here don't
 * list yet (a newer set's) is taken to go with the object's types as printed.
 */
const correlated = (s: string, types: readonly string[]) => !TYPES_OF_SUBTYPE.has(s) || TYPES_OF_SUBTYPE.get(s)!.some((t) => types.includes(t));

const num = (s?: string) => {
  const n = parseInt(s ?? '', 10);
  return Number.isNaN(n) ? 0 : n;
};

/** Its copiable values (707.2), the starting point for layers 2 and on (613.2c). */
function start(c: Card): Working {
  const d = data(c);
  return {
    typeLine: changeling(d.typeLine, d.keywords),
    // Devoid: "This object is colorless" (702.114a), a characteristic-defining ability that works in every zone, first in layer 5 (613.3).
    colors: d.keywords.includes('Devoid') ? [] : d.colors,
    keywords: d.keywords.map((k) => k.toLowerCase()),
    power: num(d.power),
    toughness: num(d.toughness),
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
  const { types, subtypes } = typesOf(typeLine);
  return typeLineOf(types, [...subtypes, ...CREATURE_TYPES.filter((t) => !subtypes.includes(t))]);
}

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
      const t = typesOf(w.typeLine);
      let types = t.types;
      let subs = t.subtypes;
      if (p.notTypes) {
        types = types.filter((x) => !p.notTypes!.includes(x));
        // The subtypes that went only with a card type it lost go too, for as long as that
        // card type is removed (205.1a): a creature that stops being one loses its creature
        // types, unless it is still a kindred (205.3m).
        const lost = subs.filter((s) => !correlated(s, types));
        if (lost.length) {
          subs = subs.filter((s) => !lost.includes(s));
          w.suspended = [...(w.suspended ?? []), ...lost];
        }
      }
      if (p.types) {
        types = [...types, ...p.types.filter((x) => !types.includes(x))];
        // A card type it gets back brings back the subtypes it lost with it (205.1a).
        const back = w.suspended?.filter((s) => correlated(s, types)) ?? [];
        if (back.length) {
          subs = [...subs, ...back.filter((s) => !subs.includes(s))];
          w.suspended = w.suspended!.filter((s) => !back.includes(s));
        }
      }
      // An object can't gain a subtype that doesn't go with one of its card types (205.3d).
      const gained = p.subtypes?.filter((s) => !subs.includes(s) && correlated(s, types)) ?? [];
      if (gained.length) subs = [...subs, ...gained];
      w.typeLine = typeLineOf(types, subs);
      break;
    }
    case '6':
      if (p.keywords) addAll((w.keywords = [...w.keywords]), p.keywords);
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
    out.push({ ts: -Infinity, seq: seq++, cda: true, source: { ask, version: -1, answer: [], reads: [] }, i: 0 });
  }
  // A reconfigured Equipment isn't a creature from the moment it was attached (702.151b, 613.7e).
  if (c.attachedTo && hasReconfigure(c)) out.push({ ts: c.ts, seq: seq++, parts: { notTypes: ['Creature'] } });
  // Impending: "As long as this permanent's impending cost was paid and it has a time counter
  // on it, it's not a creature" (702.176a). A static ability of its own: its timestamp (613.7a).
  if (c.cast?.impending && counterCount(c, 'time') > 0 && data(c).keywords.includes('Impending')) out.push({ ts: c.ts, seq: seq++, parts: { notTypes: ['Creature'] } });
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
  // Static abilities of permanents on the battlefield (611.3), with their source's timestamp,
  // or that of the copy effect that gave them, whichever is later (613.7a).
  for (const { src, fn } of staticSources(g)) {
    const source: Source = { ask: () => fn(g, src, c), version: -1, answer: [], reads: [], id: src.id };
    answerOf(source, 0, 0);
    const ts = Math.max(src.ts, src.copyTs ?? -Infinity);
    source.answer.forEach((_, i) => {
      if (!without.some((x) => x.id === src.id && x.i === i)) out.push({ ts, seq: seq++, source, i });
    });
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
let held: { g: Game; answers: WeakMap<Card, Result>; sources?: Sources } | null = null;

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
  if (reading && c.zone === 'battlefield') reading.push({ id: c.id, upTo: LAYERS.indexOf(upTo), temporary });
  const partial = working.get(c.id);
  if (partial) {
    // Every answer being worked out above it now depends on it partway.
    for (let d = partial.depth + 1; d < tainted.length; d++) tainted[d] = true;
    return partial.w;
  }
  if (c.zone !== 'battlefield') return offBattlefield(g, c);
  // Nor is one worked out for a game without some effect, to see what depends on it (613.8a).
  const store = temporary && !without.length ? storeFor(g) : null;
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
      // Characteristic-defining abilities first (613.3, 613.4a), each group in its own order:
      // one can depend only on another of its kind (613.8a).
      applyLayer(g, c, w, l, all.filter((e) => e.cda), temporary);
      applyLayer(g, c, w, l, all.filter((e) => !e.cda), temporary);
      if (l === upTo) break;
    }
  } finally {
    working.delete(c.id);
    clean = !tainted.pop();
  }
  const { version: _, suspended: __, ...chars } = w;
  return { chars, clean };
}

/** Could applying an effect in layer `l` change entry `e`'s answer? Only if it asked about a characteristic that layer changes. */
const watches = (e: Entry, l: number) => !e.parts && e.source!.reads.some((r) => r.upTo >= l);

/** Applies to `w` the effects in `group` that apply in layer `l`, in timestamp order changed by dependency (613.8). */
function applyLayer(g: Game, c: Card, w: Working, l: Layer, group: Entry[], temporary: boolean) {
  const li = LAYERS.indexOf(l);
  let pending = group;
  for (let first = true; ; first = false) {
    const live: { e: Entry; p: LayerParts }[] = [];
    let watching = false;
    for (const e of pending) {
      // Asked again with the object as it is now, unless nothing applied in this layer can have changed the answer.
      const again = first || watches(e, li);
      const p = e.parts ?? (again ? answerOf(e.source!, w.version, e.i!) : (e.source!.answer[e.i!] ?? null));
      if (p && appliesAt(e, p, l)) live.push({ e, p });
      watching ||= watches(e, li);
    }
    if (!live.length) return;
    // With no answer that applying an effect here could change, nothing depends on anything:
    // timestamp order, and nothing starts or stops applying along the way.
    if (!watching) {
      for (const { e, p } of live) {
        e.parts = p;
        apply(w, p, l);
      }
      return;
    }
    const next = live.length > 1 ? firstReady(g, c, w, l, li, live, temporary) : { ...live[0], loop: [] };
    pending = pending.filter((e) => e !== next.e);
    // Going first in a loop, it sees other permanents as they are before the rest of the loop applies (613.8b).
    const left = next.loop.flatMap((d) => (d.source?.id === undefined ? [] : [{ id: d.source.id, i: d.i! }]));
    const then = left.length ? askWithout(g, c, next.e.source!, li, left, temporary) : undefined;
    const p = then ? (then[next.e.i!] ?? null) : next.p;
    if (p && appliesAt(next.e, p, l)) {
      next.e.parts = p;
      apply(w, p, l);
    }
  }
}

/**
 * The effect to apply next among those that apply now (`live`, in timestamp order): the
 * first that depends on none of the others, or only on ones in a loop with it (613.8b),
 * with the ones in that loop it goes before (`loop`).
 * Effects that don't apply now can't be depended on: applying one would change nothing here.
 */
function firstReady(g: Game, c: Card, w: Working, l: Layer, li: number, live: { e: Entry; p: LayerParts }[], temporary: boolean) {
  const on = new Map<Entry, Entry[]>();
  for (const b of live) {
    if (!watches(b.e, li)) continue;
    const deps = live.filter((a) => a !== b && dependsOn(g, c, w, l, li, b.e, a, temporary));
    if (deps.length) on.set(b.e, deps.map((a) => a.e));
  }
  if (!on.size) return { ...live[0], loop: [] };
  /** Does `from` depend on `to`, directly or through others? */
  const reaches = (from: Entry, to: Entry) => {
    const seen = new Set<Entry>([from]);
    const stack = [from];
    while (stack.length) {
      for (const d of on.get(stack.pop()!) ?? []) {
        if (d === to) return true;
        if (seen.has(d)) continue;
        seen.add(d);
        stack.push(d);
      }
    }
    return false;
  };
  const next = live.find(({ e }) => (on.get(e) ?? []).every((d) => reaches(d, e)))!;
  return { ...next, loop: on.get(next.e) ?? [] };
}

/**
 * Does static ability effect `b` depend on effect `a` (613.8a): would applying `a` change
 * whether `b` applies to `c` or what it does? Asked of `b` again with `a` applied to `c`, and,
 * for a static ability `a`, with every other permanent `b` looked at worked out without `a`.
 */
function dependsOn(g: Game, c: Card, w: Working, l: Layer, li: number, b: Entry, a: { e: Entry; p: LayerParts }, temporary: boolean): boolean {
  const s = b.source!;
  const now = s.answer[b.i!] ?? null;
  const relevant = s.reads.filter((r) => r.upTo >= li);
  if (relevant.some((r) => r.id === c.id)) {
    const me = working.get(c.id)!;
    const tried = { ...w };
    apply(tried, a.p, l);
    working.set(c.id, { w: tried, depth: me.depth });
    try {
      if (!same(askNow(s).answer[b.i!] ?? null, now)) return true;
    } finally {
      working.set(c.id, me);
    }
  }
  const other = a.e.source?.id;
  if (other === undefined) return false;
  // Another permanent it looked at, as it would be without `a` (613.8a: "applying the other").
  const then = askWithout(g, c, s, li, [{ id: other, i: a.e.i! }], temporary);
  return then !== undefined && !same(then[b.i!] ?? null, now);
}

/**
 * Asks `s` again with every other permanent it looked at in layer `li` or later worked out
 * as if the static ability effects in `left` didn't exist: undefined if it looked at none.
 * Permanents partway through the layers keep their state so far.
 */
function askWithout(g: Game, c: Card, s: Source, li: number, left: { id: string; i: number }[], temporary: boolean) {
  const others = new Map<string, Read>();
  for (const r of s.reads) if (r.upTo >= li && r.id !== c.id && !working.has(r.id) && (others.get(r.id)?.upTo ?? -1) < r.upTo) others.set(r.id, r);
  if (!others.size) return undefined;
  const outer = without;
  without = [...outer, ...left];
  const shown: string[] = [];
  try {
    for (const r of others.values()) {
      const x = permanent(g, r.id);
      if (!x) continue;
      const { chars } = layers(g, x, LAYERS[r.upTo], r.temporary && temporary);
      // Shown as partway through `c`'s question, so no answer that saw it is kept.
      working.set(x.id, { w: { ...chars, version: 0 }, depth: tainted.length - 1 });
      shown.push(x.id);
    }
    return askNow(s).answer;
  } finally {
    for (const id of shown) working.delete(id);
    without = outer;
  }
}

/** Static ability effects left out while working out what the game would be without them. */
let without: { id: string; i: number }[] = [];

/** Do two answers do the same thing? A function in one (a mana ability's colours) is worked out when used, so the same code counts as the same. */
function same(x: unknown, y: unknown): boolean {
  if (x === y) return true;
  if (typeof x === 'function' && typeof y === 'function') return String(x) === String(y);
  if (!x || !y || typeof x !== 'object' || typeof y !== 'object') return false;
  if (Array.isArray(x) !== Array.isArray(y)) return false;
  const kx = Object.keys(x).filter((k) => (x as Record<string, unknown>)[k] !== undefined);
  const ky = Object.keys(y).filter((k) => (y as Record<string, unknown>)[k] !== undefined);
  return kx.length === ky.length && kx.every((k) => same((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k]));
}
