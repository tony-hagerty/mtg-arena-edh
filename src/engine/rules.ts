// Queries and effect primitives. Everything here either reads a Game or mutates an
// Immer draft of one; turn structure and action handling live in engine.ts.
import { cardData } from '../cards/db';
import { scriptOf } from './registry';
import type {
  BroadcastHook,
  Card,
  CardData,
  Color,
  Game,
  Mana,
  ManaSym,
  Player,
  PlayerId,
  StackItem,
  TargetRef,
  TargetSpec,
  Trigger,
  TriggerEvents,
  TriggerHook,
  Zone,
} from './types';

export const STARTING_LIFE = 40;
export const COMMANDER_DAMAGE = 21;
export const MAX_HAND = 7;

/** Keywords the engine actually enforces. tests/cards.test.ts fails on anything else. */
export const SUPPORTED_KEYWORDS = [
  'flying',
  'reach',
  'deathtouch',
  'lifelink',
  'trample',
  'vigilance',
  'haste',
  'first strike',
  'double strike',
  'menace',
  'defender',
  'hexproof',
  'indestructible',
  'flash',
];

// ---------- card queries ----------

export const data = (c: Card): CardData => cardData(c.name);
/** Display name (token keys like "Beast 3/3" differ from the printed name). */
export const label = (c: Card) => data(c).name;
export const hasType = (c: Card, t: string) => data(c).typeLine.includes(t);
export const isCreature = (c: Card) => hasType(c, 'Creature');
export const isLand = (c: Card) => hasType(c, 'Land');
export const isPermanentCard = (c: Card) => !hasType(c, 'Instant') && !hasType(c, 'Sorcery');
export const isInstantSpeed = (c: Card) => hasType(c, 'Instant') || data(c).keywords.includes('Flash');
export const isColor = (c: Card, color: Color) => data(c).colors.includes(color);

const num = (s?: string) => {
  const n = parseInt(s ?? '', 10);
  return Number.isNaN(n) ? 0 : n;
};

// ---------- player / zone queries ----------

export const living = (g: Game) => g.players.filter((p) => !p.lost);
export const opponentsOf = (g: Game, pid: PlayerId) => g.players.filter((p) => !p.lost && p.id !== pid);
export const battlefield = (g: Game): Card[] => g.players.flatMap((p) => (p.lost ? [] : p.battlefield));
export const creaturesOf = (g: Game, pid: PlayerId) => g.players[pid].battlefield.filter(isCreature);
export const allCreatures = (g: Game) => battlefield(g).filter(isCreature);

export function nextLiving(g: Game, pid: PlayerId): PlayerId {
  const n = g.players.length;
  for (let i = 1; i <= n; i++) {
    const q = (pid + i) % n;
    if (!g.players[q].lost) return q;
  }
  return pid;
}

/**
 * Living players in turn order, starting with `from`. From the active player this is
 * APNAP order: the order players make choices that come up at the same time (101.4).
 */
export function turnOrder(g: Game, from: PlayerId): PlayerId[] {
  const n = g.players.length;
  return Array.from({ length: n }, (_, i) => (from + i) % n).filter((pid) => !g.players[pid].lost);
}

export function permanent(g: Game, id: string): Card | undefined {
  for (const p of g.players) {
    const c = p.battlefield.find((x) => x.id === id);
    if (c) return c;
  }
  return undefined;
}

export function findCard(g: Game, id: string): Card | undefined {
  for (const p of g.players) {
    for (const zone of [p.battlefield, p.hand, p.command, p.graveyard, p.exile, p.library]) {
      const c = zone.find((x) => x.id === id);
      if (c) return c;
    }
  }
  // A spell on the stack, or the remembered source of an ability whose source is gone.
  return g.stack.find((x) => x.card.id === id)?.card;
}

export const refCard = (g: Game, ref: TargetRef | null | undefined) =>
  ref && ref.kind === 'card' ? permanent(g, ref.id) : undefined;
export const refPlayer = (g: Game, ref: TargetRef | null | undefined) =>
  ref && ref.kind === 'player' && !g.players[ref.id].lost ? g.players[ref.id] : undefined;

// ---------- power / toughness / keywords ----------

export interface Stats {
  power: number;
  toughness: number;
  keywords: Set<string>;
}

/**
 * Current characteristics of a card. `base` leaves out until-end-of-turn modifiers
 * (the bots use it so temporary pumps don't look like permanent value).
 */
export function stats(g: Game, c: Card, opts: { base?: boolean } = {}): Stats {
  const d = data(c);
  let power = num(d.power);
  let toughness = num(d.toughness);
  const keywords = new Set(d.keywords.map((k) => k.toLowerCase()));
  const basePT = scriptOf(c.name).basePT;
  if (basePT) ({ power, toughness } = basePT(g, c));
  if (c.zone !== 'battlefield' || !isCreature(c)) return { power, toughness, keywords };

  power += c.counters;
  toughness += c.counters;
  if (!opts.base) {
    for (const m of c.mods) {
      power += m.power;
      toughness += m.toughness;
      for (const k of m.keywords) keywords.add(k);
    }
  }
  for (const p of g.players) {
    if (p.lost) continue;
    for (const src of p.battlefield) {
      const fn = scriptOf(src.name).static;
      if (!fn) continue;
      const b = fn(g, src, c);
      if (!b) continue;
      power += b.power ?? 0;
      toughness += b.toughness ?? 0;
      for (const k of b.keywords ?? []) keywords.add(k);
    }
  }
  return { power, toughness, keywords };
}

export const has = (g: Game, c: Card, keyword: string) => stats(g, c).keywords.has(keyword);

export function canAttack(g: Game, c: Card): boolean {
  if (c.zone !== 'battlefield' || !isCreature(c) || c.tapped) return false;
  const kw = stats(g, c).keywords;
  return !kw.has('defender') && (!c.sick || kw.has('haste'));
}

export function canBlock(g: Game, blocker: Card, attacker: Card): boolean {
  if (blocker.zone !== 'battlefield' || !isCreature(blocker) || blocker.tapped) return false;
  if (has(g, attacker, 'flying')) {
    const kw = stats(g, blocker).keywords;
    return kw.has('flying') || kw.has('reach');
  }
  return true;
}

/** Would `a` and `b` kill each other in combat? Used by the bots and for UI hints. */
export function fight(g: Game, a: Card, b: Card): { aDies: boolean; bDies: boolean } {
  const A = stats(g, a);
  const B = stats(g, b);
  const first = (s: Stats) => s.keywords.has('first strike') || s.keywords.has('double strike');
  const kills = (S: Stats, T: Stats, t: Card) =>
    S.power > 0 &&
    !T.keywords.has('indestructible') &&
    (S.keywords.has('deathtouch') || S.power >= T.toughness - t.damage);
  let bDies = kills(A, B, b);
  let aDies = kills(B, A, a);
  if (first(A) && !first(B) && bDies) aDies = false;
  if (first(B) && !first(A) && aDies) bDies = false;
  return { aDies, bDies };
}

// ---------- mana ----------

export interface Cost {
  generic: number;
  pips: ManaSym[];
}

export function parseCost(cost: string): Cost {
  const out: Cost = { generic: 0, pips: [] };
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
    const sym = m[1];
    if (/^\d+$/.test(sym)) out.generic += parseInt(sym, 10);
    else if ('WUBRGC'.includes(sym) && sym.length === 1) out.pips.push(sym as ManaSym);
  }
  return out;
}

/** What it costs `c` to be cast right now: printed cost + commander tax - cost reductions. */
export function castCost(g: Game, c: Card): Cost {
  const cost = parseCost(data(c).manaCost);
  if (c.zone === 'command') cost.generic += 2 * g.players[c.owner].commanderCasts;
  const reduction = scriptOf(c.name).costReduction?.(g, c) ?? 0;
  cost.generic = Math.max(0, cost.generic - reduction);
  return cost;
}

const BASIC_MANA: Record<string, ManaSym> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };

/** What a permanent taps for, or null if it isn't a mana source. */
export function manaOf(g: Game, c: Card): { amount: number; colors: ManaSym[] } | null {
  if (isLand(c)) {
    for (const [type, sym] of Object.entries(BASIC_MANA)) if (hasType(c, type)) return { amount: 1, colors: [sym] };
  }
  const m = scriptOf(c.name).mana;
  if (!m) return null;
  if (m.colors === 'any') return { amount: m.amount, colors: ['W', 'U', 'B', 'R', 'G'] };
  if (m.colors === 'identity') {
    const identity = cardData(g.players[c.owner].commander).colorIdentity;
    return { amount: m.amount, colors: identity.length ? identity : ['C'] };
  }
  return { amount: m.amount, colors: m.colors };
}

interface Source {
  id: string;
  amount: number;
  colors: ManaSym[];
}

export function manaSources(g: Game, pid: PlayerId): Source[] {
  const out: Source[] = [];
  for (const c of g.players[pid].battlefield) {
    if (c.tapped) continue;
    const m = manaOf(g, c);
    if (!m) continue;
    if (isCreature(c) && c.sick && !has(g, c, 'haste')) continue;
    out.push({ id: c.id, ...m });
  }
  return out;
}

/** Can the player tap this permanent for mana right now? */
export const canTapForMana = (g: Game, pid: PlayerId, c: Card) => manaSources(g, pid).some((s) => s.id === c.id);

/**
 * Taps a permanent for mana by hand. A source with a choice of colours makes its owner's
 * commander colour when it can (the decks are mono-coloured, so that is the one they want).
 */
export function tapForMana(g: Game, pid: PlayerId, c: Card) {
  const m = manaOf(g, c)!;
  const identity: ManaSym[] = cardData(g.players[pid].commander).colorIdentity;
  const sym = m.colors.find((x) => identity.includes(x)) ?? m.colors[0];
  c.tapped = true;
  for (let k = 0; k < m.amount; k++) g.players[pid].pool.push({ sym, source: c.id });
}

/** Tapping for mana can be undone while every mana it made is still unspent in the pool. */
export function canUntapMana(g: Game, pid: PlayerId, c: Card): boolean {
  const m = manaOf(g, c);
  if (!m || c.owner !== pid || c.zone !== 'battlefield' || !c.tapped) return false;
  return g.players[pid].pool.filter((x) => x.source === c.id).length === m.amount;
}

export function untapMana(g: Game, pid: PlayerId, c: Card) {
  const p = g.players[pid];
  p.pool = p.pool.filter((x) => x.source !== c.id);
  c.tapped = false;
}

/** Total mana the player could produce right now (for display). */
export const availableMana = (g: Game, pid: PlayerId) =>
  manaSources(g, pid).reduce((n, s) => n + s.amount, 0) + g.players[pid].pool.length;

/**
 * Works out how to pay `cost`, or null if it can't be paid. Mana already in the pool is
 * spent first; permanents are tapped (Arena-style auto-pay) only for what the pool can't
 * cover. Coloured pips are paid first from the least flexible source; mana left over from
 * a multi-mana source (e.g. Sol Ring) stays in the pool until the step ends.
 */
export function planPayment(g: Game, pid: PlayerId, cost: Cost): { tap: string[]; pool: Mana[] } | null {
  const pool = [...g.players[pid].pool];
  const sources = manaSources(g, pid);
  const tap: string[] = [];

  const use = (i: number, paying: ManaSym | null) => {
    const s = sources.splice(i, 1)[0];
    tap.push(s.id);
    const extra = s.colors.length === 1 ? s.colors[0] : (paying ?? s.colors[0]);
    for (let k = 1; k < s.amount; k++) pool.push({ sym: extra, source: s.id });
  };

  for (const pip of cost.pips) {
    const inPool = pool.findIndex((m) => m.sym === pip);
    if (inPool >= 0) {
      pool.splice(inPool, 1);
      continue;
    }
    let best = -1;
    const rank = (s: Source) => s.amount * 10 + s.colors.length;
    sources.forEach((s, i) => {
      if (s.colors.includes(pip) && (best < 0 || rank(s) < rank(sources[best]))) best = i;
    });
    if (best < 0) return null;
    use(best, pip);
  }

  let remaining = cost.generic;
  while (remaining > 0) {
    if (pool.length) {
      const c = pool.findIndex((m) => m.sym === 'C');
      pool.splice(c >= 0 ? c : 0, 1);
      remaining--;
      continue;
    }
    if (!sources.length) return null;
    // Prefer the biggest source that doesn't overpay, colourless before coloured.
    const score = (s: Source) =>
      (s.amount <= remaining ? 100 + s.amount * 10 : 50 - s.amount * 10) + (s.colors[0] === 'C' ? 5 : 0) - s.colors.length;
    let best = 0;
    sources.forEach((s, i) => {
      if (score(s) > score(sources[best])) best = i;
    });
    use(best, null);
    remaining--;
  }
  return { tap, pool };
}

export function pay(g: Game, pid: PlayerId, cost: Cost): boolean {
  const plan = planPayment(g, pid, cost);
  if (!plan) return false;
  for (const id of plan.tap) permanent(g, id)!.tapped = true;
  g.players[pid].pool = plan.pool;
  return true;
}

/** Number of `color` pips among mana costs of permanents the player controls. */
export function devotion(g: Game, pid: PlayerId, color: Color): number {
  let n = 0;
  for (const c of g.players[pid].battlefield) n += parseCost(data(c).manaCost).pips.filter((p) => p === color).length;
  return n;
}

// ---------- targeting ----------

export function legalTargets(g: Game, pid: PlayerId, spec: TargetSpec, source: Card): TargetRef[] {
  const out: TargetRef[] = [];
  const whoOk = (owner: PlayerId) =>
    !spec.who || spec.who === 'any' || (spec.who === 'you' ? owner === pid : owner !== pid);
  for (const p of living(g)) {
    if ((spec.type === 'player' || spec.type === 'any') && whoOk(p.id)) out.push({ kind: 'player', id: p.id });
    if (spec.type === 'player' || !whoOk(p.id)) continue;
    for (const c of p.battlefield) {
      if (spec.type !== 'permanent' && !isCreature(c)) continue;
      if (c.owner !== pid && isCreature(c) && has(g, c, 'hexproof')) continue;
      if (spec.filter && !spec.filter(g, c, source)) continue;
      out.push({ kind: 'card', id: c.id });
    }
  }
  return out;
}

export const sameRef = (a: TargetRef, b: TargetRef) => a.kind === b.kind && a.id === b.id;

/** The targets a spell or ability on the stack has to choose. */
export function targetSpecs(item: StackItem): TargetSpec[] {
  const script = scriptOf(item.card.name);
  if (item.kind === 'activated') return script.activated?.targets ?? [];
  if (item.kind === 'triggered') return item.hook === 'onEnter' ? (script.targets ?? []) : [];
  // A permanent spell has no targets of its own: `targets` belongs to its enters ability.
  return isPermanentCard(item.card) ? [] : (script.targets ?? []);
}

export function describeRef(g: Game, ref: TargetRef): string {
  if (ref.kind === 'player') return g.players[ref.id].name;
  const c = permanent(g, ref.id);
  return c ? label(c) : '?';
}

// ---------- randomness (seeded, so games can be replayed in tests) ----------

export function rand(g: Game): number {
  g.rng = (g.rng + 0x6d2b79f5) | 0;
  let t = g.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function shuffle<T>(g: Game, arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(g) * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

// ---------- effect primitives (mutate a draft) ----------

const SECOND_PERSON: Record<string, string> = {
  plays: 'play',
  casts: 'cast',
  activates: 'activate',
  attacks: 'attack',
  discards: 'discard',
  fetches: 'fetch',
  gains: 'gain',
  loses: 'lose',
  wins: 'win',
  is: 'are',
};

/** Subject + verb for the log: "Cinder casts" for a bot, "You cast" for the human. */
export const says = (p: Player, verb: string) => `${p.name} ${p.isBot ? verb : (SECOND_PERSON[verb] ?? verb)}`;

export function log(g: Game, text: string, player?: PlayerId) {
  g.log.push({ turn: g.turn, text, player });
  if (g.log.length > 400) g.log.splice(0, g.log.length - 400);
}

export function makeCard(g: Game, name: string, owner: PlayerId, zone: Zone, extra: Partial<Card> = {}): Card {
  return {
    id: `c${g.nextId++}`,
    name,
    owner,
    zone,
    isCommander: false,
    isToken: false,
    tapped: false,
    sick: false,
    damage: 0,
    deathtouched: false,
    counters: 0,
    mods: [],
    ...extra,
  };
}

export function removeFromCombat(g: Game, id: string) {
  if (!g.combat) return;
  g.combat.attacks = g.combat.attacks.filter((a) => a.id !== id);
  for (const a of g.combat.attacks) a.blockers = a.blockers.filter((b) => b !== id);
}

/** Moves a card between zones. Tokens vanish; a commander goes to the command zone instead of dying. */
export function moveCard(g: Game, c: Card, to: Zone) {
  if (c.zone === 'stack') {
    g.stack = g.stack.filter((x) => x.kind !== 'spell' || x.card.id !== c.id);
  } else {
    const from = g.players[c.owner][c.zone];
    const i = from.findIndex((x) => x.id === c.id);
    if (i >= 0) from.splice(i, 1);
  }
  if (c.zone === 'battlefield') removeFromCombat(g, c.id);
  c.tapped = false;
  c.sick = false;
  c.damage = 0;
  c.deathtouched = false;
  c.counters = 0;
  c.mods = [];
  if (c.isCommander && (to === 'graveyard' || to === 'exile')) to = 'command';
  c.zone = to;
  if (c.isToken && to !== 'battlefield') return;
  g.players[c.owner][to].push(c);
}

/** A copy of a card as it is right now, for an ability or event to remember (113.7a, 603.10a). */
export const snapshot = (c: Card): Card => ({ ...c, mods: c.mods.map((m) => ({ ...m, keywords: [...m.keywords] })) });

const isCard = (v: unknown): v is Card => typeof v === 'object' && v !== null && 'zone' in v && 'owner' in v;

/**
 * Checks whether `source`'s ability triggers on an event (603.2). If it does, the ability
 * waits in `g.triggers` and goes on the stack the next time a player would get priority (603.3).
 */
export function trigger<H extends TriggerHook>(g: Game, source: Card, hook: H, event: TriggerEvents[H]) {
  const t = scriptOf(source.name)[hook] as Trigger<object> | undefined;
  if (!t) return;
  if (typeof t !== 'function' && !t.when(g, { self: source, ...event })) return;
  const remembered = Object.fromEntries(Object.entries(event).map(([k, v]) => [k, isCard(v) ? snapshot(v) : v]));
  g.triggers.push({
    id: `s${g.nextId++}`,
    kind: 'triggered',
    controller: source.owner,
    card: snapshot(source),
    hook,
    event: remembered,
    targets: [],
  });
}

/** Offers an event to every permanent on the battlefield. */
export function broadcast<H extends BroadcastHook>(g: Game, hook: H, event: TriggerEvents[H]) {
  for (const c of battlefield(g)) trigger(g, c, hook, event);
}

/** Sets up a permanent that was just put onto the battlefield, and triggers "enters" abilities (603.6a). */
function arrive(g: Game, c: Card, opts: { tapped?: boolean }) {
  c.sick = true;
  c.tapped = !!opts.tapped || !!scriptOf(c.name).entersTapped;
  trigger(g, c, 'onEnter', {});
  if (isCreature(c)) broadcast(g, 'onCreatureEnters', { entered: c });
  if (isLand(c)) broadcast(g, 'onLandfall', { land: c });
}

export function enterBattlefield(g: Game, c: Card, opts: { tapped?: boolean } = {}) {
  moveCard(g, c, 'battlefield');
  arrive(g, c, opts);
}

export function createToken(g: Game, pid: PlayerId, key: string, count = 1) {
  if (g.players[pid].lost) return;
  for (let i = 0; i < count; i++) {
    const c = makeCard(g, key, pid, 'battlefield', { isToken: true });
    g.players[pid].battlefield.push(c);
    // Re-read through the draft so later mutations hit the stored object.
    arrive(g, g.players[pid].battlefield[g.players[pid].battlefield.length - 1], {});
  }
}

/**
 * Puts permanents into their owners' graveyards at the same time, then triggers "dies"
 * abilities. These look back in time (603.10a): the dying cards and the permanents
 * watching are copied first, so creatures that die together see each other die.
 */
export function dieMany(g: Game, cards: Card[], verb = 'dies') {
  const dying = cards.filter((c) => c.zone === 'battlefield');
  if (!dying.length) return;
  const listeners = battlefield(g)
    .filter((c) => scriptOf(c.name).onCreatureDies)
    .map(snapshot);
  const dead = dying.filter(isCreature).map(snapshot);
  for (const c of dying) {
    log(g, `${label(c)} ${verb}.`, c.owner);
    moveCard(g, c, 'graveyard');
  }
  for (const c of dead) {
    trigger(g, c, 'onDies', {});
    for (const l of listeners) trigger(g, l, 'onCreatureDies', { dead: c });
  }
}

export function destroyMany(g: Game, cards: Card[]) {
  dieMany(
    g,
    cards.filter((c) => !has(g, c, 'indestructible')),
    'is destroyed',
  );
}
export const destroy = (g: Game, c: Card | undefined) => c && destroyMany(g, [c]);
export const sacrifice = (g: Game, c: Card) => dieMany(g, [c], 'is sacrificed');

export function exile(g: Game, c: Card | undefined) {
  if (!c || c.zone !== 'battlefield') return;
  log(g, `${label(c)} is exiled.`, c.owner);
  moveCard(g, c, 'exile');
}

export function gainLife(g: Game, pid: PlayerId, n: number) {
  const p = g.players[pid];
  if (n <= 0 || p.lost) return;
  p.life += n;
  log(g, `${says(p, 'gains')} ${n} life.`, pid);
  broadcast(g, 'onLifeGain', { player: pid, amount: n });
}

/** Returns the life actually lost. */
export function loseLife(g: Game, pid: PlayerId, n: number): number {
  const p = g.players[pid];
  if (n <= 0 || p.lost) return 0;
  p.life -= n;
  log(g, `${says(p, 'loses')} ${n} life.`, pid);
  return n;
}

export function draw(g: Game, pid: PlayerId, n = 1) {
  const p = g.players[pid];
  for (let i = 0; i < n; i++) {
    if (p.lost) return;
    const top = p.library[0];
    if (!top) {
      p.drewFromEmpty = true;
      return;
    }
    moveCard(g, top, 'hand');
    broadcast(g, 'onDraw', { player: pid });
  }
}

function damageBonus(g: Game, source: Card, targetOwner: PlayerId): number {
  let bonus = 0;
  for (const c of g.players[source.owner].battlefield) {
    bonus += scriptOf(c.name).damageBonus?.(g, c, source, targetOwner) ?? 0;
  }
  return bonus;
}

export function damagePlayer(g: Game, source: Card, pid: PlayerId, n: number, combat = false): number {
  const p = g.players[pid];
  if (n <= 0 || p.lost) return 0;
  n += damageBonus(g, source, pid);
  p.life -= n;
  log(g, `${label(source)} deals ${n} damage to ${p.name}.`, source.owner);
  if (combat && source.isCommander) p.commanderDamage[source.owner] += n;
  if (has(g, source, 'lifelink')) gainLife(g, source.owner, n);
  if (combat) trigger(g, source, 'onCombatDamageToPlayer', { player: pid, amount: n });
  return n;
}

export function damageCard(g: Game, source: Card, target: Card | undefined, n: number): number {
  if (!target || n <= 0 || target.zone !== 'battlefield') return 0;
  n += damageBonus(g, source, target.owner);
  target.damage += n;
  if (has(g, source, 'deathtouch')) target.deathtouched = true;
  if (has(g, source, 'lifelink')) gainLife(g, source.owner, n);
  return n;
}

export function dealDamage(g: Game, source: Card, ref: TargetRef | null | undefined, n: number): number {
  if (!ref) return 0;
  if (ref.kind === 'player') return damagePlayer(g, source, ref.id, n);
  const c = permanent(g, ref.id);
  if (c) log(g, `${label(source)} deals ${n + damageBonus(g, source, c.owner)} damage to ${label(c)}.`, source.owner);
  return damageCard(g, source, c, n);
}

export function pump(_g: Game, c: Card | undefined, power: number, toughness: number, keywords: string[] = []) {
  if (c && c.zone === 'battlefield') c.mods.push({ power, toughness, keywords });
}

export function addCounters(_g: Game, c: Card | undefined, n = 1) {
  if (c && c.zone === 'battlefield') c.counters += n;
}

/** Finds a basic land in the library (optionally of one subtype), moves it, then shuffles. */
export function searchBasic(
  g: Game,
  pid: PlayerId,
  to: 'battlefield' | 'hand',
  opts: { tapped?: boolean; subtype?: string } = {},
): boolean {
  const p = g.players[pid];
  if (p.lost) return false;
  const land = p.library.find((c) => hasType(c, 'Basic Land') && (!opts.subtype || hasType(c, opts.subtype)));
  if (land) {
    log(g, `${says(p, 'fetches')} ${label(land)}.`, pid);
    if (to === 'battlefield') enterBattlefield(g, land, { tapped: opts.tapped ?? true });
    else moveCard(g, land, 'hand');
  }
  shuffle(g, p.library);
  return !!land;
}

// ---------- state-based actions ----------

/** A player leaves the game, and everything they own or control goes with them (800.4a). */
function eliminate(g: Game, p: Player, reason: string) {
  p.lost = true;
  log(g, `${says(p, 'is')} eliminated (${reason}).`, p.id);
  const theirs = (x: StackItem) => x.controller === p.id || x.card.owner === p.id;
  g.stack = g.stack.filter((x) => !theirs(x));
  g.triggers = g.triggers.filter((x) => !theirs(x));
  if (g.combat) {
    const theirs = new Set(p.battlefield.map((c) => c.id));
    g.combat.attacks = g.combat.attacks.filter((a) => !theirs.has(a.id) && a.defender !== p.id);
    for (const a of g.combat.attacks) a.blockers = a.blockers.filter((b) => !theirs.has(b));
    g.combat.toBlock = g.combat.toBlock.filter((id) => id !== p.id);
  }
  p.battlefield = [];
  p.hand = [];
  p.library = [];
  p.graveyard = [];
  p.exile = [];
  p.command = [];
  p.pool = [];
}

/**
 * State-based actions (704): kills what should be dead, eliminates players who have lost,
 * and sets the winner. Each pass does everything that applies at once, and passes repeat
 * until nothing changes (704.3).
 */
export function checkState(g: Game) {
  for (let guard = 0; guard < 50; guard++) {
    let changed = false;
    for (const p of g.players) {
      if (p.lost) continue;
      const reason =
        p.life <= 0
          ? 'life total 0' // 704.5a
          : p.commanderDamage.some((d) => d >= COMMANDER_DAMAGE)
            ? `${COMMANDER_DAMAGE} commander damage` // 903.10a
            : p.drewFromEmpty
              ? 'drew from an empty library' // 704.5b
              : null;
      if (reason) {
        eliminate(g, p, reason);
        changed = true;
      }
    }
    // Toughness 0 or less (704.5f) ignores indestructible; lethal and deathtouch damage (704.5g-h) destroy.
    const dying: Card[] = [];
    for (const c of allCreatures(g)) {
      const s = stats(g, c);
      const lethal = c.damage >= s.toughness || (c.deathtouched && c.damage > 0);
      if (s.toughness <= 0 || (lethal && !s.keywords.has('indestructible'))) dying.push(c);
    }
    if (dying.length) {
      dieMany(g, dying);
      changed = true;
    }
    if (!changed) break;
  }
  if (g.winner === null) {
    const alive = living(g);
    if (alive.length === 1) {
      g.winner = alive[0].id;
      log(g, `${says(alive[0], 'wins')} the game!`, alive[0].id);
    } else if (alive.length === 0) {
      g.winner = 'draw';
      log(g, 'The game is a draw.');
    }
  }
}
