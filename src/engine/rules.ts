// Queries and effect primitives. Everything here either reads a Game or mutates an
// Immer draft of one; turn structure and action handling live in engine.ts.
import { cardData } from '../cards/db';
import { scriptOf } from './registry';
import type {
  BroadcastHook,
  Card,
  CardData,
  CardScript,
  CastChoices,
  Color,
  Game,
  Mana,
  ManaSym,
  Player,
  PlayerId,
  StackItem,
  StaticBonus,
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

/** A player's maximum hand size (402.2): seven, unless something they control removes it. */
export const maxHandSize = (g: Game, pid: PlayerId) => (g.players[pid].battlefield.some((c) => scriptFor(c).noMaxHandSize) ? Infinity : MAX_HAND);

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
  // Keywords the card's script spells out: kicker (702.33), enchant (702.5), equip (702.6),
  // crew (702.122), flashback (702.34), and transform (701.27, a double-faced card's).
  'kicker',
  'multikicker',
  'enchant',
  'equip',
  'crew',
  'flashback',
  'transform',
];

// ---------- card queries ----------

/**
 * The characteristics of one face of a card in a zone. A double-faced card has its front
 * face's everywhere but the stack and battlefield, where it has the face that's up
 * (712.8a, 712.8d-f). A split card has both halves combined everywhere but the stack, where
 * it has the half being cast (709.3b, 709.4). An adventurer card has its normal ones
 * except while it's an Adventure spell (715.3b, 715.4).
 */
export function faceData(d: CardData, zone: Card['zone'], face: number): CardData {
  if (!d.faces) return d;
  const up = zone === 'stack' || (zone === 'battlefield' && d.layout !== 'adventure' && d.layout !== 'split') ? face : 0;
  if (d.layout === 'split' && zone !== 'stack') return d;
  return d.faces[up] ?? d.faces[0];
}

export const data = (c: Card): CardData => faceData(cardData(c.name), c.zone, c.face);

/**
 * The script for the face of `c` that's up, or that would be in `zone` with `face` up.
 * Scripts of cards with faces are registered under each face's name.
 */
export function scriptFor(c: Card, zone = c.zone, face = c.face): CardScript {
  const d = cardData(c.name);
  return scriptOf(d.faces ? faceData(d, zone, face).name : c.name);
}

/** `c` as it would be as a spell cast with face `face` up, for checking what that spell would be (601.2, 709.3a, 712.11c). */
export const asSpell = (c: Card, face = 0): Card => ({ ...c, zone: 'stack', face });

/** The faces of `c` (indexes into `CardData.faces`), or [0] for a card with one face. */
export const facesOf = (c: Card): number[] => (cardData(c.name).faces ?? [cardData(c.name)]).map((_, i) => i);

/** The layout of the card `c` is: double-faced, split, adventurer, or undefined for a normal card. */
export const layoutOf = (c: Card) => cardData(c.name).layout;
/** Display name (token keys like "Beast 3/3" differ from the printed name). */
export const label = (c: Card) => data(c).name;
export const hasType = (c: Card, t: string) => data(c).typeLine.includes(t);
/** Printed as a creature, or made one until end of turn (a crewed Vehicle, 702.122a). */
export const isCreature = (c: Card) => hasType(c, 'Creature') || c.mods.some((m) => m.creature);
export const isAura = (c: Card) => hasType(c, 'Aura');
export const isEquipment = (c: Card) => hasType(c, 'Equipment');
/** How many counters of `kind` are on `c` (122). */
export const counterCount = (c: Card, kind = '+1/+1') => c.counters[kind] ?? 0;
/** Permanents attached to `c`: its Auras and Equipment. */
export const attachmentsOf = (g: Game, c: Card) => battlefield(g).filter((x) => x.attachedTo === c.id);
export const isLand = (c: Card) => hasType(c, 'Land');
export const isPlaneswalker = (c: Card) => hasType(c, 'Planeswalker');
export const isBattle = (c: Card) => hasType(c, 'Battle');
export const isSiege = (c: Card) => isBattle(c) && hasType(c, 'Siege');
export const isSaga = (c: Card) => hasType(c, 'Saga');
/**
 * The faces of `c` that are lands, which it could be played as (305.1, 712.12): [0] for a
 * normal land, the land faces of a modal double-faced card, or none.
 */
export function landFaces(c: Card): number[] {
  const d = cardData(c.name);
  if (d.layout !== 'modal_dfc') return isLand(c) ? [0] : [];
  return d.faces!.map((f, i) => (f.typeLine.includes('Land') ? i : -1)).filter((i) => i >= 0);
}
/** A planeswalker's loyalty on the battlefield: its loyalty counters (306.5c). Elsewhere, its printed loyalty (306.5a). */
export const loyaltyOf = (c: Card) => (c.zone === 'battlefield' ? counterCount(c, 'loyalty') : num(data(c).loyalty));
/** A battle's defense on the battlefield: its defense counters (310.4c). Elsewhere, its printed defense (310.4a). */
export const defenseOf = (c: Card) => (c.zone === 'battlefield' ? counterCount(c, 'defense') : num(data(c).defense));
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
  const basePT = scriptFor(c).basePT;
  if (basePT) ({ power, toughness } = basePT(g, c));
  if (c.zone !== 'battlefield' || !isCreature(c)) return { power, toughness, keywords };

  // +1/+1 and -1/-1 counters (122.1a), and keyword counters (122.1b).
  const net = counterCount(c, '+1/+1') - counterCount(c, '-1/-1');
  power += net;
  toughness += net;
  for (const [kind, n] of Object.entries(c.counters)) if (n > 0 && SUPPORTED_KEYWORDS.includes(kind)) keywords.add(kind);
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
      const fn = scriptFor(src).static;
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

/**
 * Restrictions a static effect can give a creature through `StaticBonus.keywords`, e.g.
 * Pacifism's "Enchanted creature can't attack or block." They aren't keywords, but they
 * travel the same way.
 */
export const CANT_ATTACK = "can't attack";
export const CANT_BLOCK = "can't block";

export function canAttack(g: Game, c: Card): boolean {
  if (c.zone !== 'battlefield' || !isCreature(c) || c.tapped) return false;
  const kw = stats(g, c).keywords;
  return !kw.has('defender') && !kw.has(CANT_ATTACK) && (!c.sick || kw.has('haste'));
}

export function canBlock(g: Game, blocker: Card, attacker: Card): boolean {
  if (blocker.zone !== 'battlefield' || !isCreature(blocker) || blocker.tapped) return false;
  if (has(g, blocker, CANT_BLOCK)) return false;
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

/**
 * One way to pay a hybrid or Phyrexian symbol: one mana of a colour, `'2'` for two
 * generic mana ({2/W}), or `'life'` for 2 life ({W/P}) (107.4e-f).
 */
export type HybridOption = ManaSym | '2' | 'life';

export interface Cost {
  generic: number;
  /** Mana symbols that need one mana of exactly that type. */
  pips: ManaSym[];
  /** Hybrid and Phyrexian symbols: each is paid one of the ways listed (107.4e-f). */
  hybrid: HybridOption[][];
  /** How many {X} symbols the cost has (107.3). Their value is chosen when casting. */
  x: number;
  /** Life to pay on top of the mana (119.4: a player can pay it only if their life total is at least that). */
  life: number;
}

const NO_COST: Cost = { generic: 0, pips: [], hybrid: [], x: 0, life: 0 };

/** Parses a mana cost like "{X}{1}{R/G}{W/P}" (107.4). Snow mana {S} isn't supported. */
export function parseCost(cost: string): Cost {
  const out: Cost = { ...NO_COST, pips: [], hybrid: [] };
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
    const sym = m[1];
    if (/^\d+$/.test(sym)) out.generic += parseInt(sym, 10);
    else if (sym === 'X') out.x++;
    else if (/^[WUBRGC]$/.test(sym)) out.pips.push(sym as ManaSym);
    else if (sym.includes('/')) {
      // {W/U}, {2/W}, {C/W}, {W/P}, {W/U/P}. Mana comes first: it is the way auto-pay tries first.
      const parts = sym.split('/').map((part): HybridOption => (part === 'P' ? 'life' : part === '2' ? '2' : (part as ManaSym)));
      out.hybrid.push([...parts.filter((o) => o !== '2' && o !== 'life'), ...parts.filter((o) => o === '2' || o === 'life')]);
    }
  }
  return out;
}

/** Two costs paid together, e.g. a mana cost plus a kicker cost (601.2f). */
export const addCosts = (a: Cost, b: Cost): Cost => ({
  generic: a.generic + b.generic,
  pips: [...a.pips, ...b.pips],
  hybrid: [...a.hybrid, ...b.hybrid],
  x: a.x + b.x,
  life: a.life + b.life,
});

/** A cost written out in mana symbols, e.g. "{2}{R/G}{W/P}". Life is left out. */
export function costText(cost: Cost): string {
  // Printed order: {2/W} and {W/P}.
  const shard = (h: HybridOption[]) => [...(h.includes('2') ? ['2'] : []), ...h.filter((o) => o !== '2' && o !== 'life'), ...(h.includes('life') ? ['P'] : [])];
  const shards = cost.hybrid.map((h) => `{${shard(h).join('/')}}`).join('');
  const colored = cost.pips.map((p) => `{${p}}`).join('') + shards;
  return (cost.generic || !colored ? `{${cost.generic}}` : '') + colored;
}

/** Which of its owner's commanders `c` is: its index in `commanderCasts` and `commanderDamage`, or -1. */
export const commanderIndex = (g: Game, c: Card) => (c.isCommander ? g.players[c.owner].commanders.indexOf(c.name) : -1);

/**
 * Commander tax: {2} more for each earlier cast of this commander from the command zone
 * (903.8). Partners count only their own casts (702.124d).
 */
export const commanderTax = (g: Game, c: Card) => 2 * (g.players[c.owner].commanderCasts[commanderIndex(g, c)] ?? 0);

/** Combat damage `victim` has taken so far from `commander` (903.10a). */
export const commanderDamageFrom = (g: Game, victim: Player, commander: Card) =>
  victim.commanderDamage[commander.owner]?.[commanderIndex(g, commander)] ?? 0;

/** The alternative costs a spell's caster could choose right now (118.9), by index into its script's list. */
export function altCostsOf(g: Game, c: Card, face = 0): number[] {
  // Flashback is already an alternative cost, and only one can be paid (118.9a, 702.34a).
  if (c.zone === 'graveyard') return [];
  const alts = scriptFor(c, 'stack', face).alternativeCosts ?? [];
  return alts.map((_, i) => i).filter((i) => alts[i].when?.(g, c) ?? true);
}

/**
 * What it costs `c` to be cast right now with these choices (601.2f): the mana cost, or
 * the chosen alternative cost (118.9), with X filled in, plus kicker and commander tax,
 * plus cost increases, minus reductions. Reductions only take off generic mana, and
 * never below {0}. The returned `x` is 0: X has already been added to `generic`.
 */
export function castCost(g: Game, c: Card, choices: CastChoices = {}): Cost {
  // Only the face being cast counts: a split card's half, an Adventure (709.3a, 715.3a).
  const spell = asSpell(c, choices.face ?? 0);
  const script = scriptFor(spell);
  const alt = choices.alt === undefined ? undefined : script.alternativeCosts?.[choices.alt];
  // Cast from a graveyard, a flashback card pays its flashback cost instead (702.34a).
  const flashback = c.zone === 'graveyard' ? scriptFor(c).flashback : undefined;
  let cost = parseCost(flashback ?? (alt ? alt.mana : data(spell).manaCost));
  cost.life += alt?.life ?? 0;
  // X counts as generic mana (107.4b). An alternative cost without {X} makes X 0 (107.3b).
  cost.generic += cost.x * (choices.x ?? 0);
  cost.x = 0;
  for (let k = 0; k < (choices.kicked ?? 0) && script.kicker; k++) cost = addCosts(cost, parseCost(script.kicker.mana));
  // Commander tax is an additional cost, so it applies to alternative costs too (903.8, 118.9d).
  if (c.zone === 'command') cost.generic += commanderTax(g, c);
  // 601.2f: all increases are added and all reductions taken off together, so the order
  // they apply in doesn't matter. Only generic mana is reduced.
  let change = -(script.costReduction?.(g, c) ?? 0);
  for (const p of battlefield(g)) change += scriptFor(p).costModifier?.(g, p, spell, c.owner) ?? 0;
  cost.generic = Math.max(0, cost.generic + change);
  return cost;
}

const BASIC_MANA: Record<string, ManaSym> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };

/** What a permanent taps for, or null if it isn't a mana source. */
export function manaOf(g: Game, c: Card): { amount: number; colors: ManaSym[]; sacrifice?: boolean } | null {
  if (isLand(c)) {
    for (const [type, sym] of Object.entries(BASIC_MANA)) if (hasType(c, type)) return { amount: 1, colors: [sym] };
  }
  const m = scriptFor(c).mana;
  if (!m) return null;
  if (m.colors === 'any') return { amount: m.amount, colors: ['W', 'U', 'B', 'R', 'G'], sacrifice: m.sacrifice };
  if (m.colors === 'identity') {
    // Both partners' colours count as "your commander's colour identity" (702.124c).
    const identity = g.players[c.owner].colors;
    return { amount: m.amount, colors: identity.length ? identity : ['C'] };
  }
  return { amount: m.amount, colors: m.colors };
}

interface Source {
  id: string;
  amount: number;
  colors: ManaSym[];
  /** Sacrificed to make its mana, like a Treasure: auto-pay uses it last. */
  sacrifice?: boolean;
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
 * The colour a source with a choice of colours makes when tapped by hand. It picks one of
 * the player's commander colours (that is all their deck needs), and among those the one
 * their hand and command zone want most and their other mana covers least.
 */
function pickColor(g: Game, pid: PlayerId, options: ManaSym[]): ManaSym {
  const p = g.players[pid];
  const mine = options.filter((x) => (p.colors as ManaSym[]).includes(x));
  if (mine.length <= 1) return mine[0] ?? options[0];
  const need = (sym: ManaSym) => {
    const wanted = [...p.hand, ...p.command].reduce((n, c) => n + parseCost(data(c).manaCost).pips.filter((x) => x === sym).length, 0);
    const pool = p.pool.filter((x) => x.sym === sym).length;
    const fixed = manaSources(g, pid).filter((s) => s.colors.length === 1 && s.colors[0] === sym).length;
    return wanted - pool - fixed;
  };
  return mine.reduce((best, x) => (need(x) > need(best) ? x : best));
}

/** Taps a permanent for mana by hand. A Treasure is sacrificed too (111.10a): that can't be undone. */
export function tapForMana(g: Game, pid: PlayerId, c: Card) {
  const m = manaOf(g, c)!;
  const sym = m.colors.length === 1 ? m.colors[0] : pickColor(g, pid, m.colors);
  c.tapped = true;
  for (let k = 0; k < m.amount; k++) g.players[pid].pool.push({ sym, source: c.id });
  if (m.sacrifice) dieMany(g, [c], 'is sacrificed');
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

interface Plan {
  pool: Mana[];
  sources: Source[];
  tap: string[];
  /** Generic mana still to pay: the cost's own plus any {2/W} paid the generic way. */
  generic: number;
  life: number;
}

/** Mana a source makes beyond the one it is tapped to pay for. It goes to the pool. */
const extraMana = (s: Source, paying: ManaSym | null): Mana[] =>
  Array.from({ length: s.amount - 1 }, () => ({ sym: s.colors.length === 1 ? s.colors[0] : (paying ?? s.colors[0]), source: s.id }));

/**
 * The ways to pay one mana of `sym`: from the pool if it has one (always the best way),
 * otherwise from each kind of source that makes it, least flexible first.
 */
function payMana(sym: ManaSym, plan: Plan): Plan[] {
  const inPool = plan.pool.findIndex((m) => m.sym === sym);
  if (inPool >= 0) return [{ ...plan, pool: plan.pool.filter((_, i) => i !== inPool) }];
  const rank = (s: Source) => s.amount * 10 + s.colors.length + (s.sacrifice ? 1000 : 0);
  const options = plan.sources
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.colors.includes(sym))
    .sort((a, b) => rank(a.s) - rank(b.s));
  const tried = new Set<string>(); // sources that make the same mana are interchangeable
  const out: Plan[] = [];
  for (const { s, i } of options) {
    const kind = `${s.amount}:${s.colors.join('')}`;
    if (tried.has(kind)) continue;
    tried.add(kind);
    out.push({
      ...plan,
      pool: [...plan.pool, ...extraMana(s, sym)],
      sources: plan.sources.filter((_, j) => j !== i),
      tap: [...plan.tap, s.id],
    });
  }
  return out;
}

/** Pays the generic part from whatever is left: pool first, then the sources that fit it best. */
function payGeneric(plan: Plan): Plan | null {
  const pool = [...plan.pool];
  const sources = [...plan.sources];
  const tap = [...plan.tap];
  let remaining = plan.generic;
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
      (s.amount <= remaining ? 100 + s.amount * 10 : 50 - s.amount * 10) + (s.colors[0] === 'C' ? 5 : 0) - s.colors.length - (s.sacrifice ? 500 : 0);
    let best = 0;
    sources.forEach((s, i) => {
      if (score(s) > score(sources[best])) best = i;
    });
    const s = sources.splice(best, 1)[0];
    tap.push(s.id);
    pool.push(...extraMana(s, null));
    remaining--;
  }
  return { ...plan, pool, sources, tap, generic: 0 };
}

/**
 * Pays each symbol in turn, then the generic mana. A choice that leaves something later
 * unpayable is undone and the next one tried: a multicolour deck can paint itself into a
 * corner (a W/U land spent on {W} leaves nothing for {U}), and a {2/W} paid with two
 * generic may leave too little for the rest. Hybrid symbols try mana first, then {2},
 * then 2 life.
 */
function payShards(shards: HybridOption[][], plan: Plan, life: number): Plan | null {
  if (!shards.length) return payGeneric(plan);
  const [shard, ...rest] = shards;
  for (const option of shard) {
    const nexts =
      option === '2'
        ? [{ ...plan, generic: plan.generic + 2 }]
        : option === 'life'
          ? plan.life + 2 <= life
            ? [{ ...plan, life: plan.life + 2 }]
            : []
          : payMana(option, plan);
    for (const next of nexts) {
      const done = payShards(rest, next, life);
      if (done) return done;
    }
  }
  return null;
}

/**
 * Works out how to pay `cost`, or null if it can't be paid. Mana already in the pool is
 * spent first; permanents are tapped (Arena-style auto-pay) only for what the pool can't
 * cover. Coloured symbols are paid first, scarcest colour first; mana left over from a
 * multi-mana source (e.g. Sol Ring) stays in the pool until the step ends. `life` is
 * what Phyrexian symbols and the cost itself take.
 */
export function planPayment(g: Game, pid: PlayerId, cost: Cost): { tap: string[]; pool: Mana[]; life: number } | null {
  const p = g.players[pid];
  // A player can pay life only if their life total is at least that much (119.4).
  if (cost.life > p.life) return null;
  const all = manaSources(g, pid);
  // Not enough mana in total, however it's spent: skip the search.
  const most = p.pool.length + all.reduce((n, s) => n + s.amount, 0);
  if (most < cost.generic + cost.pips.length + cost.hybrid.filter((h) => !h.includes('life')).length) return null;
  const makers = (sym: HybridOption) => all.filter((s) => s.colors.includes(sym as ManaSym)).length;
  const pips = [...cost.pips].sort((a, b) => makers(a) - makers(b)).map((pip): HybridOption[] => [pip]);
  const start: Plan = { pool: [...p.pool], sources: all, tap: [], generic: cost.generic, life: cost.life };
  const paid = payShards([...pips, ...cost.hybrid], start, p.life);
  return paid && { tap: paid.tap, pool: paid.pool, life: paid.life };
}

export function pay(g: Game, pid: PlayerId, cost: Cost): boolean {
  const plan = planPayment(g, pid, cost);
  if (!plan) return false;
  for (const id of plan.tap) permanent(g, id)!.tapped = true;
  g.players[pid].pool = plan.pool;
  const spent = plan.tap.map((id) => permanent(g, id)!).filter((c) => manaOf(g, c)?.sacrifice);
  if (spent.length) dieMany(g, spent, 'is sacrificed');
  if (plan.life) {
    g.players[pid].life -= plan.life; // paying life (119.4)
    log(g, `${says(g.players[pid], 'pays')} ${plan.life} life.`, pid);
  }
  return true;
}

/** Number of `color` pips among mana costs of permanents the player controls. */
export function devotion(g: Game, pid: PlayerId, color: Color): number {
  let n = 0;
  // A hybrid symbol counts toward each of its colours (700.5).
  for (const c of g.players[pid].battlefield) {
    const cost = parseCost(data(c).manaCost);
    n += cost.pips.filter((p) => p === color).length + cost.hybrid.filter((h) => h.includes(color)).length;
  }
  return n;
}

// ---------- targeting ----------

export function legalTargets(g: Game, pid: PlayerId, spec: TargetSpec, source: Card): TargetRef[] {
  const out: TargetRef[] = [];
  if (spec.type === 'spell' || spec.type === 'ability') {
    // A spell or ability on the stack. One can't target itself (115.5).
    for (const item of g.stack) {
      if ((item.kind === 'spell') !== (spec.type === 'spell') || item.card.id === source.id) continue;
      if (spec.who && spec.who !== 'any' && (spec.who === 'you') !== (item.controller === pid)) continue;
      if (spec.filter && !spec.filter(g, item.card, source)) continue;
      out.push({ kind: 'stack', id: item.id });
    }
    return out;
  }
  const whoOk = (owner: PlayerId) =>
    !spec.who || spec.who === 'any' || (spec.who === 'you' ? owner === pid : owner !== pid);
  const players = spec.type === 'player' || spec.type === 'any' || spec.type === 'player or planeswalker';
  // Which permanents the spec can name. "Any target" is a creature, player, planeswalker or battle (115.4).
  const fits = (c: Card) => {
    switch (spec.type) {
      case 'permanent':
        return true;
      case 'any':
        return isCreature(c) || isPlaneswalker(c) || isBattle(c);
      case 'creature or planeswalker':
        return isCreature(c) || isPlaneswalker(c);
      case 'player or planeswalker':
        return isPlaneswalker(c);
      default:
        return isCreature(c);
    }
  };
  for (const p of living(g)) {
    if (players && whoOk(p.id)) out.push({ kind: 'player', id: p.id });
    if (spec.type === 'player' || !whoOk(p.id)) continue;
    for (const c of p.battlefield) {
      if (!fits(c)) continue;
      if (c.owner !== pid && has(g, c, 'hexproof')) continue;
      if (spec.filter && !spec.filter(g, c, source)) continue;
      out.push({ kind: 'card', id: c.id });
    }
  }
  return out;
}

export const sameRef = (a: TargetRef, b: TargetRef) => a.kind === b.kind && a.id === b.id;

/**
 * The targets a spell has to choose as it is cast (601.2c). A modal spell's come from its
 * chosen modes, in order (700.2c). A permanent spell has none of its own: `targets`
 * belongs to its enters ability.
 */
export function spellTargets(c: Card, modes: number[] = []): TargetSpec[] {
  const script = scriptFor(c);
  // An Aura spell targets what it will enchant (303.4a).
  if (script.enchant) return [script.enchant];
  if (isPermanentCard(c)) return [];
  if (script.modal) return modes.flatMap((i) => script.modal!.modes[i]?.targets ?? []);
  return script.targets ?? [];
}

/** The targets a spell or ability on the stack has to choose. */
export function targetSpecs(item: StackItem): TargetSpec[] {
  const script = scriptFor(item.card);
  if (item.kind === 'activated') return (item.ability === undefined ? script.activated : script.loyalty?.[item.ability])?.targets ?? [];
  if (item.kind === 'triggered' && item.hook === 'onChapter') return script.chapters?.[(item.event as { chapter: number }).chapter - 1]?.targets ?? [];
  if (item.kind === 'triggered' && item.hook === 'onEnter') return script.targets ?? [];
  if (item.kind === 'triggered') {
    const t = script[item.hook!] as Trigger<object> | undefined;
    return (t && typeof t !== 'function' && t.targets) || [];
  }
  return spellTargets(item.card, item.card.cast?.modes);
}

/** The spell or ability on the stack that a target names, if it is still there. */
export const refStack = (g: Game, ref: TargetRef | null | undefined) =>
  ref && ref.kind === 'stack' ? g.stack.find((x) => x.id === ref.id) : undefined;

export function describeRef(g: Game, ref: TargetRef): string {
  if (ref.kind === 'player') return g.players[ref.id].name;
  if (ref.kind === 'stack') {
    const item = refStack(g, ref);
    return !item ? '?' : item.kind === 'spell' ? label(item.card) : `${label(item.card)}'s ability`;
  }
  const c = permanent(g, ref.id);
  return c ? label(c) : '?';
}

/** The cards among some targets (a spell or ability counts as its card), for `log`. */
export function refCards(g: Game, refs: (TargetRef | null)[]): Card[] {
  return refs.flatMap((r) => {
    const c = r?.kind === 'card' ? permanent(g, r.id) : refStack(g, r)?.card;
    return c ? [c] : [];
  });
}

/**
 * Counters a spell or ability (701.6a): it leaves the stack without resolving and none of
 * its effects happen. A countered spell goes to its owner's graveyard (a copy just ceases
 * to exist), and nothing paid for it comes back (701.6b).
 */
export function counter(g: Game, ref: TargetRef | null | undefined) {
  const item = refStack(g, ref);
  if (!item) return;
  log(g, `${describeRef(g, ref!)} is countered.`, item.controller, [item.card]);
  if (item.kind === 'spell') moveCard(g, item.card, 'graveyard');
  else g.stack = g.stack.filter((x) => x !== item);
}

/**
 * Copies a spell on the stack (707.10). The copy keeps every choice made for it: modes,
 * X, kicker (700.2g, 707.10). It goes on the stack the next time a player would get
 * priority, and its controller may choose new targets for it then (707.10c).
 */
export function copySpell(g: Game, ref: TargetRef | null | undefined, controller: PlayerId) {
  const item = refStack(g, ref);
  if (!item || item.kind !== 'spell') return;
  const card: Card = { ...snapshot(item.card), id: `c${g.nextId++}`, owner: controller, isToken: true, isCommander: false };
  log(g, `${says(g.players[controller], 'copies')} ${label(item.card)}.`, controller, [item.card]);
  g.triggers.push({ id: `s${g.nextId++}`, kind: 'spell', controller, card, targets: item.targets, copy: true, ordered: true });
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
  pays: 'pay',
  sacrifices: 'sacrifice',
  casts: 'cast',
  activates: 'activate',
  attacks: 'attack',
  discards: 'discard',
  fetches: 'fetch',
  finds: 'find',
  puts: 'put',
  copies: 'copy',
  keeps: 'keep',
  leaves: 'leave',
  mulligans: 'mulligan',
  gains: 'gain',
  loses: 'lose',
  wins: 'win',
  is: 'are',
};

/** Subject + verb for the log: "Cinder casts" for a bot, "You cast" for the human. */
export const says = (p: Player, verb: string) => `${p.name} ${p.isBot ? verb : (SECOND_PERSON[verb] ?? verb)}`;

/** Adds a line to the game log. `cards` are the cards the text names, for the UI to link. */
export function log(g: Game, text: string, player?: PlayerId, cards: Card[] = []) {
  const names = [...new Set(cards.map(label))];
  g.log.push({ turn: g.turn, text, player, ...(names.length ? { cards: names } : {}) });
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
    face: 0,
    level: 1,
    adventure: false,
    tapped: false,
    sick: false,
    damage: 0,
    deathtouched: false,
    counters: {},
    attachedTo: null,
    loyaltyTurn: 0,
    protector: null,
    mods: [],
    cast: null,
    mayReturn: false,
    ...extra,
  };
}

export function removeFromCombat(g: Game, id: string) {
  if (!g.combat) return;
  g.combat.attacks = g.combat.attacks.filter((a) => a.id !== id);
  for (const a of g.combat.attacks) a.blockers = a.blockers.filter((b) => b !== id);
}

/**
 * Moves a card between zones. Tokens vanish. A commander can leave for the command zone:
 *  - Into a graveyard or exile it really goes there, so "dies" abilities see it, and the
 *    next state-based check offers to move it on (903.9a).
 *  - Into a hand or library it may go to the command zone instead (903.9b). That is a
 *    replacement effect, chosen as the card moves. Bots always take it. A human's commander
 *    goes where it was headed and they are asked at the next state-based check, because an
 *    effect can't stop partway through for an answer. No card in the pool does this yet.
 */
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
  c.counters = {};
  c.attachedTo = null; // leaving the battlefield also unattaches it
  c.loyaltyTurn = 0; // a new object with no memory of its last one (400.7)
  c.protector = null;
  c.level = 1;
  c.adventure = false;
  c.mods = [];
  // A spell cast with flashback is exiled instead of going anywhere else (702.34a).
  if (c.zone === 'stack' && c.cast?.flashback && to !== 'exile') to = 'exile';
  // A permanent spell enters with the face it had on the stack up (712.13). Anywhere else,
  // a card has its front face up (712.8a, 712.14).
  if (c.zone !== 'stack' || to !== 'battlefield') c.face = 0;
  // A spell keeps what it was cast with as it becomes a permanent (107.3m), and loses it after.
  if (c.zone !== 'stack' || to !== 'battlefield') c.cast = null;
  if (c.isCommander && (to === 'hand' || to === 'library') && g.players[c.owner].isBot) {
    log(g, `${label(c)} goes to the command zone instead.`, c.owner, [c]);
    to = 'command';
  }
  c.mayReturn = c.isCommander && to !== 'command' && to !== 'battlefield';
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
  const t = scriptFor(source)[hook] as Trigger<object> | undefined;
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

/**
 * Who protects battle `c` if its controller has the choice: for a Siege, the opponent
 * whose untapped creatures could defend it least (310.12a), or null if there is no
 * opponent. Only its controller can protect any other battle (310.9a).
 */
export function defaultProtector(g: Game, c: Card): PlayerId | null {
  if (!isSiege(c)) return c.owner;
  const guard = (pid: PlayerId) => creaturesOf(g, pid).filter((x) => !x.tapped).reduce((n, x) => n + Math.max(0, stats(g, x).power), 0);
  const opps = opponentsOf(g, c.owner);
  return opps.length ? opps.reduce((best, o) => (guard(o.id) < guard(best.id) ? o : best)).id : null;
}

/** Can `pid` protect battle `c`? An opponent for a Siege (310.12a), its controller for any other (310.9a). */
export const canProtect = (g: Game, c: Card, pid: PlayerId) =>
  !g.players[pid]?.lost && (isSiege(c) ? pid !== c.owner : pid === c.owner);

/** Sets up a permanent that was just put onto the battlefield, and triggers "enters" abilities (603.6a). */
function arrive(g: Game, c: Card, opts: { tapped?: boolean; protector?: PlayerId }) {
  c.sick = true;
  c.tapped = !!opts.tapped || !!scriptFor(c).entersTapped;
  // A planeswalker enters with its printed loyalty (306.5b), a battle with its printed defense (310.4b).
  if (isPlaneswalker(c)) c.counters.loyalty = num(data(c).loyalty);
  // A Saga enters with a lore counter, which triggers chapter I (714.3a, 714.2b).
  if (isSaga(c) && scriptFor(c).chapters?.length) addCounters(g, c, 1, 'lore');
  if (isBattle(c)) {
    c.counters.defense = num(data(c).defense);
    c.protector = opts.protector !== undefined && canProtect(g, c, opts.protector) ? opts.protector : defaultProtector(g, c);
    if (c.protector !== null) log(g, `${g.players[c.protector].name} protects ${label(c)}.`, c.owner, [c]);
  }
  trigger(g, c, 'onEnter', {});
  if (isCreature(c)) broadcast(g, 'onCreatureEnters', { entered: c });
  if (isLand(c)) broadcast(g, 'onLandfall', { land: c });
}

/** Puts a card onto the battlefield. An Aura resolving as a spell enters attached to its target (`attachTo`, 303.4). */
/** `face`: the face it enters with up, e.g. a modal double-faced card played as its back face (712.12). */
export function enterBattlefield(g: Game, c: Card, opts: { tapped?: boolean; attachTo?: string; protector?: PlayerId; face?: number } = {}) {
  moveCard(g, c, 'battlefield');
  if (opts.face !== undefined) c.face = opts.face;
  if (opts.attachTo) c.attachedTo = opts.attachTo;
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
    .filter((c) => scriptFor(c).onCreatureDies)
    .map(snapshot);
  const dead = dying.filter(isCreature).map(snapshot);
  for (const c of dying) {
    log(g, `${label(c)} ${verb}.`, c.owner, [c]);
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
  log(g, `${label(c)} is exiled.`, c.owner, [c]);
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
    bonus += scriptFor(c).damageBonus?.(g, c, source, targetOwner) ?? 0;
  }
  return bonus;
}

export function damagePlayer(g: Game, source: Card, pid: PlayerId, n: number, combat = false): number {
  const p = g.players[pid];
  if (n <= 0 || p.lost) return 0;
  n += damageBonus(g, source, pid);
  p.life -= n;
  log(g, `${label(source)} deals ${n} damage to ${p.name}.`, source.owner, [source]);
  // Combat damage from a commander counts toward 21, separately for each partner (903.10a, 702.124d).
  const which = combat ? commanderIndex(g, source) : -1;
  if (which >= 0) p.commanderDamage[source.owner][which] += n;
  if (has(g, source, 'lifelink')) gainLife(g, source.owner, n);
  if (combat) trigger(g, source, 'onCombatDamageToPlayer', { player: pid, amount: n });
  return n;
}

/**
 * Removes defense counters from a battle. When the last one goes, a Siege's defeat
 * ability triggers (310.12b): it is exiled when that resolves, and stays on the
 * battlefield until then (704.5v).
 */
export function removeDefense(g: Game, c: Card, n: number) {
  const before = counterCount(c, 'defense');
  if (n <= 0 || before === 0) return;
  removeCounters(c, n, 'defense');
  if (counterCount(c, 'defense') > 0 || !isSiege(c)) return;
  log(g, `${label(c)} is defeated.`, c.owner, [c]);
  g.triggers.push({ id: `s${g.nextId++}`, kind: 'triggered', controller: c.owner, card: snapshot(c), hook: 'onDefeat', event: {}, targets: [] });
}

/** Is a Siege's defeat ability waiting or on the stack (704.5v)? */
const defeatPending = (g: Game, c: Card) => [...g.triggers, ...g.stack].some((x) => x.hook === 'onDefeat' && x.card.id === c.id);

/**
 * Damage to a permanent: a planeswalker loses that many loyalty counters (120.3c), a
 * battle that many defense counters (120.3h), and a creature has it marked (120.3e).
 */
export function damageCard(g: Game, source: Card, target: Card | undefined, n: number): number {
  if (!target || n <= 0 || target.zone !== 'battlefield') return 0;
  n += damageBonus(g, source, target.owner);
  if (isPlaneswalker(target)) removeCounters(target, n, 'loyalty');
  if (isBattle(target)) removeDefense(g, target, n);
  if (isCreature(target)) target.damage += n;
  if (has(g, source, 'deathtouch') && isCreature(target)) target.deathtouched = true;
  if (has(g, source, 'lifelink')) gainLife(g, source.owner, n);
  return n;
}

export function dealDamage(g: Game, source: Card, ref: TargetRef | null | undefined, n: number): number {
  if (!ref) return 0;
  if (ref.kind === 'player') return damagePlayer(g, source, ref.id, n);
  const c = permanent(g, ref.id);
  if (c) log(g, `${label(source)} deals ${n + damageBonus(g, source, c.owner)} damage to ${label(c)}.`, source.owner, [source, c]);
  return damageCard(g, source, c, n);
}

export function pump(_g: Game, c: Card | undefined, power: number, toughness: number, keywords: string[] = []) {
  if (c && c.zone === 'battlefield') c.mods.push({ power, toughness, keywords });
}

/** Puts `n` counters of `kind` on a permanent (122). */
export function addCounters(g: Game, c: Card | undefined, n = 1, kind = '+1/+1') {
  if (!c || c.zone !== 'battlefield' || n <= 0) return;
  const before = counterCount(c, kind);
  c.counters[kind] = before + n;
  // A Saga's chapter ability triggers when lore counters take it from below N to N or more (714.2b).
  if (kind !== 'lore') return;
  (scriptFor(c).chapters ?? []).forEach((_, i) => {
    const chapter = i + 1;
    if (before < chapter && before + n >= chapter) {
      g.triggers.push({ id: `s${g.nextId++}`, kind: 'triggered', controller: c.owner, card: snapshot(c), hook: 'onChapter', event: { chapter }, targets: [] });
    }
  });
}

/** Is a chapter ability of Saga `c` waiting or on the stack (714.4)? */
const chapterPending = (g: Game, c: Card) => [...g.triggers, ...g.stack].some((x) => x.hook === 'onChapter' && x.card.id === c.id);

/**
 * Transforms a double-faced permanent: its other face turns up (701.27a). It stays the same
 * object (712.18). Nothing happens to a card with one face, or if the other face is an
 * instant or sorcery (712.9, 712.10).
 */
export function transform(g: Game, c: Card | undefined) {
  const d = c && cardData(c.name);
  if (!c || !d || c.zone !== 'battlefield' || (d.layout !== 'transform' && d.layout !== 'modal_dfc')) return;
  const next = d.faces![1 - c.face];
  if (!next || /Instant|Sorcery/.test(next.typeLine)) return;
  const before = label(c);
  c.face = 1 - c.face;
  log(g, `${before} transforms into ${label(c)}.`, c.owner, [c]);
}

/** Removes up to `n` counters of `kind` from a permanent. */
export function removeCounters(c: Card, n: number, kind = '+1/+1') {
  const left = counterCount(c, kind) - n;
  if (left > 0) c.counters[kind] = left;
  else delete c.counters[kind];
}

/**
 * Can Aura `aura` be attached to `host`? The host must be another permanent on the
 * battlefield that its enchant ability allows (702.5a, 303.4d). An Aura that is itself
 * a creature can't enchant anything.
 */
export function canEnchant(g: Game, aura: Card, host: Card | undefined): boolean {
  const spec = scriptFor(aura).enchant;
  if (!spec || !host || host.zone !== 'battlefield' || host.id === aura.id || isCreature(aura)) return false;
  if (spec.type === 'creature' && !isCreature(host)) return false;
  if (spec.who === 'you' && host.owner !== aura.owner) return false;
  if (spec.who === 'opponent' && host.owner === aura.owner) return false;
  return spec.filter?.(g, host, aura) ?? true;
}

/** Can Equipment `eq` stay attached to `host`? Only to a creature on the battlefield, and not itself (301.5c). */
export const canEquip = (eq: Card, host: Card | undefined) =>
  !!host && host.zone === 'battlefield' && isCreature(host) && host.id !== eq.id && !isCreature(eq);

/** Attaches an Aura or Equipment to a permanent (701.3). Moving it from another permanent unattaches it from that one. */
export function attach(g: Game, att: Card | undefined, host: Card | undefined) {
  if (!att || !host || att.zone !== 'battlefield') return;
  if (isAura(att) ? !canEnchant(g, att, host) : !canEquip(att, host)) return; // an illegal attach does nothing (701.3b)
  att.attachedTo = host.id;
  log(g, `${label(att)} is attached to ${label(host)}.`, att.owner, [att, host]);
}

/** "Equip [cost]": attach to target creature you control, as a sorcery (702.6a). */
export const equip = (mana: string): CardScript['activated'] => ({
  cost: { mana },
  sorcery: true,
  targets: [{ type: 'creature', who: 'you', label: 'target creature you control', filter: (_g, c, self) => c.id !== self.id && c.id !== self.attachedTo }],
  text: `Equip ${mana}`,
  resolve: (g, { self, targets }) => attach(g, permanent(g, self.id), refCard(g, targets[0])),
});

/** "Crew N": tap other creatures with total power N or more, and this becomes an artifact creature until end of turn (702.122a). */
export const crew = (n: number): CardScript['activated'] => ({
  cost: { crew: n },
  text: `Crew ${n}`,
  resolve: (g, { self }) => {
    const v = permanent(g, self.id);
    if (v) v.mods.push({ power: 0, toughness: 0, keywords: [], creature: true });
  },
});

/** A static bonus for the creature this Aura or Equipment is attached to (303.4b, 301.5a). */
export const attachedBonus =
  (bonus: StaticBonus) =>
  (_g: Game, self: Card, c: Card): StaticBonus | null =>
    self.attachedTo === c.id ? bonus : null;

/**
 * The player searches their library for a basic land (optionally of one subtype), puts it
 * onto the battlefield or into their hand, then shuffles. They choose the card, so this
 * only queues the choice: the engine asks for it once the effect has finished, before the
 * spell or ability is done resolving (see `CardChoice`).
 */
export function searchBasic(
  g: Game,
  pid: PlayerId,
  to: 'battlefield' | 'hand',
  opts: { tapped?: boolean; subtype?: string } = {},
) {
  if (g.players[pid].lost) return;
  const source = g.stack.find((x) => x.id === g.resolving)?.card;
  g.choices.push({
    kind: 'search',
    player: pid,
    source: source ? label(source) : 'Search',
    to,
    tapped: to === 'battlefield' && (opts.tapped ?? true),
    subtype: opts.subtype,
  });
}

/** Cards that a search for a basic land (of `subtype`, if given) can find. */
export const searchable = (c: Card, subtype?: string) => hasType(c, 'Basic Land') && (!subtype || hasType(c, subtype));

// ---------- state-based actions ----------

/** Moves a commander from wherever it just went to the command zone (903.9a, 903.9b). */
export function returnCommander(g: Game, c: Card) {
  log(g, `${label(c)} goes to the command zone.`, c.owner, [c]);
  moveCard(g, c, 'command');
}

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
          : p.commanderDamage.some((from) => from.some((d) => d >= COMMANDER_DAMAGE))
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
    // A planeswalker with no loyalty (704.5i) and a battle with no defense (704.5v-w) go to
    // the graveyard, except a Siege whose defeat ability hasn't resolved yet. So does a
    // battle with nobody left who can protect it (310.11).
    const spent: Card[] = [];
    for (const c of battlefield(g)) {
      if (isPlaneswalker(c) && loyaltyOf(c) <= 0) spent.push(c);
      else if (isBattle(c) && defenseOf(c) <= 0 && !(isSiege(c) && defeatPending(g, c))) spent.push(c);
      else if (isBattle(c) && (c.protector === null || !canProtect(g, c, c.protector))) {
        c.protector = defaultProtector(g, c);
        if (c.protector === null) spent.push(c);
        else log(g, `${g.players[c.protector].name} protects ${label(c)}.`, c.owner, [c]);
        changed = true;
      }
    }
    if (spent.length) {
      dieMany(g, spent, "is put into its owner's graveyard");
      changed = true;
    }
    // A Saga past its final chapter is sacrificed once that chapter's ability has left the stack (714.4).
    const done = battlefield(g).filter((c) => {
      const chapters = scriptFor(c).chapters?.length ?? 0;
      return isSaga(c) && chapters > 0 && counterCount(c, 'lore') >= chapters && !chapterPending(g, c);
    });
    if (done.length) {
      dieMany(g, done, 'is sacrificed');
      changed = true;
    }
    // An Aura on something it can't enchant, or on nothing, goes to the graveyard (704.5m).
    // Equipment on something it can't equip falls off and stays (704.5n).
    const loose: Card[] = [];
    for (const c of battlefield(g)) {
      if (isAura(c) && !canEnchant(g, c, c.attachedTo ? permanent(g, c.attachedTo) : undefined)) loose.push(c);
      else if (c.attachedTo && !isAura(c) && !canEquip(c, permanent(g, c.attachedTo))) {
        c.attachedTo = null;
        changed = true;
      }
    }
    // +1/+1 and -1/-1 counters on the same permanent cancel out (704.5q).
    for (const c of battlefield(g)) {
      const n = Math.min(counterCount(c, '+1/+1'), counterCount(c, '-1/-1'));
      if (n > 0) {
        removeCounters(c, n, '+1/+1');
        removeCounters(c, n, '-1/-1');
        changed = true;
      }
    }
    if (dying.length) {
      dieMany(g, dying);
      changed = true;
    }
    for (const c of loose) {
      if (c.zone !== 'battlefield') continue;
      log(g, `${label(c)} is put into its owner's graveyard (not attached to anything it can enchant).`, c.owner, [c]);
      moveCard(g, c, 'graveyard');
      changed = true;
    }
    // A commander just put into a graveyard or exile may go to the command zone (903.9a),
    // and so may a human's that just went to a hand or library (903.9b, see `moveCard`).
    // Bots always send it. A human is asked, unless the game is already waiting on another
    // decision: then the commander waits for the next check.
    for (const c of g.players.flatMap((p) => [...p.graveyard, ...p.exile, ...p.hand, ...p.library])) {
      if (!c.mayReturn) continue;
      if (g.players[c.owner].isBot) {
        returnCommander(g, c);
        changed = true;
      } else if (!g.decision) {
        g.decision = { type: 'commanderZone', card: c.id, resume: g.priority };
        g.priority = c.owner;
      }
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
