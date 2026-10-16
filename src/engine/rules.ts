// Queries and effect primitives. Everything here either reads a Game or mutates an
// Immer draft of one; turn structure and action handling live in engine.ts.
import { cardData } from '../cards/db';
import { scriptOf } from './registry';
import { characteristics, settled } from './layers';
import type {
  ActivatedAbility,
  BroadcastHook,
  AskChoice,
  Choice,
  CopyInfo,
  Find,
  PlayerChoice,
  WardCost,
  ManaAbility,
  NameChoice,
  NumberChoice,
  Card,
  CardData,
  CardScript,
  CastChoices,
  Color,
  Game,
  GrantedTrigger,
  Mana,
  ManaSym,
  Player,
  PlayerId,
  StackItem,
  StaticBonus,
  TargetRef,
  TargetSpec,
  Delayed,
  LayerParts,
  ContinuousEffect,
  OrderDamageChoice,
  Trigger,
  TriggerEvents,
  TurnEffect,
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
  'fear',
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
  // Storm (702.40) and cumulative upkeep (702.24) are handled by the engine and scripts;
  // partner (702.124) by the deck rules; mobilize (702.181) by the card's script.
  'storm',
  'cumulative upkeep',
  'partner',
  'mobilize',
  // Cycling (702.29) is read by the Oracle text parser as an ability activated from the hand.
  'cycling',
  // Ward (702.21), dash (702.109), bargain (702.166) and gift (702.174) by the engine with
  // the card's script; escape (702.138) is given by Underworld Breach.
  'ward',
  'dash',
  'bargain',
  'gift',
  // Afterlife (702.135) by the card's script.
  'afterlife',
  // Delve (702.66), rebound (702.88), aftermath (702.127) and paradigm (702.192) by the
  // engine; extort (702.101) and job select (702.182) by the card's script (`extort`, `jobSelect`).
  'delve',
  'rebound',
  'aftermath',
  'paradigm',
  'extort',
  'job select',
  // Prowess (702.108) is read by the Oracle text parser; a hand script uses `prowess` below.
  'prowess',
  // Airbend (701.65), plot (702.170) and warp (702.185) by the engine; escape printed on a card
  // (702.138), spree (702.172), overload (702.96), evoke (702.74) and convoke (702.51) by the
  // engine with the card's script; adapt (701.46), reconfigure (702.151), persist (702.79) and
  // harness (701.64) by the card's script (`adapt`, `reconfigure`, `persist`, `Lasting.flags`).
  'airbend',
  'plot',
  'warp',
  'escape',
  'spree',
  'overload',
  'evoke',
  'convoke',
  'adapt',
  'reconfigure',
  'persist',
  'harness',
  // Offspring (702.175) and spectacle (702.137) by the engine with the card's script;
  // changeling (702.73) by `subtypesOf`.
  'offspring',
  'spectacle',
  'changeling',
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

/**
 * The copiable values of `c` (707.2): its printed characteristics, or what it is a copy of,
 * with the face that's up. These are layer 1's result (613.2c); every other effect is
 * applied by `characteristics` (613.1).
 */
export const data = (c: Card): CardData => (c.copy && c.zone === 'battlefield' ? copyData(c.copy) : faceData(cardData(c.name), c.zone, c.face));

const copies = new Map<string, CardData>();
/**
 * What a permanent that is a copy has (707.2): the copiable values of the card copied, with
 * the face that was up, and the copy effect's exceptions added (707.9b).
 */
function copyData(copy: CopyInfo): CardData {
  const key = JSON.stringify(copy);
  let d = copies.get(key);
  if (!d) {
    const base = faceData(cardData(copy.name), 'battlefield', copy.face);
    const [types, subs] = base.typeLine.split(' — ');
    const subtypes = [...(subs ? subs.split(' ') : []), ...copy.subtypes.filter((t) => !subs?.split(' ').includes(t))];
    d = {
      ...base,
      typeLine: subtypes.length ? `${types} — ${subtypes.join(' ')}` : types,
      keywords: [...base.keywords, ...copy.keywords.filter((k) => !base.keywords.includes(k))],
      ...(copy.power !== undefined ? { power: String(copy.power) } : {}),
      ...(copy.toughness !== undefined ? { toughness: String(copy.toughness) } : {}),
    };
    copies.set(key, d);
  }
  return d;
}

/**
 * The script for the face of `c` that's up, or that would be in `zone` with `face` up.
 * Scripts of cards with faces are registered under each face's name. A copy has the
 * script of what it copies (707.2a).
 */
export function scriptFor(c: Card, zone = c.zone, face = c.face): CardScript {
  if (c.copy && zone === 'battlefield') return scriptOf(faceData(cardData(c.copy.name), 'battlefield', c.copy.face).name);
  const d = cardData(c.name);
  return scriptOf(d.faces ? faceData(d, zone, face).name : c.name);
}

const listOf = <T>(x: T | T[] | undefined): T[] => (Array.isArray(x) ? x : x ? [x] : []);

/** The cards whose activated abilities permanent `c` has from effects (613.1f), like Agatha's Soul Cauldron's. */
const lenders = (g: Game, c: Card): string[] => (c.zone === 'battlefield' ? characteristics(g, c, '6').activatedOf : []);

/** The activated abilities a copy effect gave `c` as exceptions (707.9a), like Likeness Looter's "this ability". */
const copyExtras = (c: Card) => (c.zone === 'battlefield' ? (c.copy?.activated ?? []) : []);

/**
 * `c`'s activated abilities, in printed order (602), then any its copy effect added (707.9a),
 * then any it has from other cards (`LayerParts.activatedOf`).
 */
export function activatedAbilities(g: Game, c: Card): ActivatedAbility[] {
  const own = listOf(scriptFor(c).activated);
  const extra = copyExtras(c).flatMap((a) => listOf(scriptOf(a.from).activated).slice(a.index, a.index + 1));
  const lent = lenders(g, c);
  return extra.length || lent.length ? [...own, ...extra, ...lent.flatMap((name) => listOf(scriptOf(name).activated))] : own;
}

/**
 * The card whose script `c`'s activated ability `i` comes from, if it isn't `c`'s own: a copy
 * effect's exception (707.9a, Likeness Looter) or another card that gives it the ability
 * (Agatha's Soul Cauldron).
 */
export function borrowedFrom(g: Game, c: Card, i = 0): string | undefined {
  let n = listOf(scriptFor(c).activated).length;
  if (i < n) return undefined;
  for (const a of copyExtras(c)) if (i < ++n) return a.from;
  for (const name of lenders(g, c)) {
    n += listOf(scriptOf(name).activated).length;
    if (i < n) return name;
  }
  return undefined;
}

/** `c`'s activated ability number `i` (the first if left out). */
export const activatedAt = (g: Game, c: Card, i = 0): ActivatedAbility | undefined => activatedAbilities(g, c)[i];

/** `c` as it would be as a spell cast with face `face` up, for checking what that spell would be (601.2, 709.3a, 712.11c). */
export const asSpell = (c: Card, face = 0, controller = c.controller): Card => ({ ...c, zone: 'stack', face, controller });

/** The faces of `c` (indexes into `CardData.faces`), or [0] for a card with one face. */
export const facesOf = (c: Card): number[] => (cardData(c.name).faces ?? [cardData(c.name)]).map((_, i) => i);

/** The layout of the card `c` is: double-faced, split, adventurer, or undefined for a normal card. */
export const layoutOf = (c: Card) => cardData(c.name).layout;
/** Display name (token keys like "Beast 3/3" differ from the printed name). */
export const label = (c: Card) => data(c).name;
/** Does `c` have this card type, supertype or subtype now (205), every effect applied (613.1d)? */
export const hasType = (g: Game, c: Card, t: string) => characteristics(g, c, '4').typeLine.includes(t);
/** Its subtypes now (205.3): the words after the dash in its type line. */
export const subtypesOf = (g: Game, c: Card) => characteristics(g, c, '4').typeLine.split(' — ')[1]?.split(' ') ?? [];
/**
 * Is it a creature now? Printed as one, or made one by an effect, like a crewed Vehicle
 * (702.122a). An Equipment with reconfigure isn't one while it is attached (702.151b).
 */
export const isCreature = (g: Game, c: Card) => hasType(g, c, 'Creature');
/** Has reconfigure (702.151): a rule, so it goes on applying even if the permanent loses its abilities. */
export const hasReconfigure = (c: Card) => data(c).keywords.includes('Reconfigure');
/** Does permanent `c` have marker `flag` (`LayerParts.flags`): harnessed, or an ability a Saga's chapter gave it? */
export const hasFlag = (g: Game, c: Card, flag: string) => characteristics(g, c, '6').flags.includes(flag);

/**
 * Gives permanent `c` a continuous effect from a resolving spell or ability (611.2), with a
 * new timestamp (613.7b). It applies to `c` alone from now on (611.2c), until it leaves the
 * battlefield or, with `until`, sooner (611.2a).
 */
export function addContinuous(g: Game, c: Card | undefined, parts: LayerParts, until: ContinuousEffect['until'] = 'leaves', opts: { while?: ContinuousEffect['while'] } = {}) {
  if (!c || c.zone !== 'battlefield') return;
  c.continuous.push({ ...parts, ts: g.nextId++, until, ...(opts.while ? { while: opts.while } : {}) });
}
/** An effect with no duration (611.2a): it lasts until `c` leaves the battlefield. */
export const addLasting = (g: Game, c: Card | undefined, parts: LayerParts) => addContinuous(g, c, parts);
/** An effect that lasts until end of turn (514.2). */
export const untilEndOfTurn = (g: Game, c: Card | undefined, parts: LayerParts) => addContinuous(g, c, parts, 'turn');

export const isAura = (g: Game, c: Card) => hasType(g, c, 'Aura');
export const isEquipment = (g: Game, c: Card) => hasType(g, c, 'Equipment');
/** How many counters of `kind` are on `c` (122). */
export const counterCount = (c: Card, kind = '+1/+1') => c.counters[kind] ?? 0;
/** Permanents attached to `c`: its Auras and Equipment. */
export const attachmentsOf = (g: Game, c: Card) => battlefield(g).filter((x) => x.attachedTo === c.id);
export const isLand = (g: Game, c: Card) => hasType(g, c, 'Land');
export const isPlaneswalker = (g: Game, c: Card) => hasType(g, c, 'Planeswalker');
export const isBattle = (g: Game, c: Card) => hasType(g, c, 'Battle');
export const isSiege = (g: Game, c: Card) => isBattle(g, c) && hasType(g, c, 'Siege');
export const isSaga = (g: Game, c: Card) => hasType(g, c, 'Saga');
/**
 * The faces of `c` that are lands, which it could be played as (305.1, 712.12): [0] for a
 * normal land, the land faces of a modal double-faced card, or none.
 */
export function landFaces(g: Game, c: Card): number[] {
  const d = cardData(c.name);
  if (d.layout !== 'modal_dfc') return isLand(g, c) ? [0] : [];
  return d.faces!.map((f, i) => (f.typeLine.includes('Land') ? i : -1)).filter((i) => i >= 0);
}
/** A planeswalker's loyalty on the battlefield: its loyalty counters (306.5c). Elsewhere, its printed loyalty (306.5a). */
export const loyaltyOf = (c: Card) => (c.zone === 'battlefield' ? counterCount(c, 'loyalty') : num(data(c).loyalty));
/** A battle's defense on the battlefield: its defense counters (310.4c). Elsewhere, its printed defense (310.4a). */
export const defenseOf = (c: Card) => (c.zone === 'battlefield' ? counterCount(c, 'defense') : num(data(c).defense));
export const isPermanentCard = (g: Game, c: Card) => !hasType(g, c, 'Instant') && !hasType(g, c, 'Sorcery');
export const isInstantSpeed = (g: Game, c: Card) => hasType(g, c, 'Instant') || characteristics(g, c, '6').keywords.includes('flash');
/** Its colours now (105.2), every effect applied (613.1e). */
export const colorsOf = (g: Game, c: Card) => characteristics(g, c, '5').colors;
export const isColor = (g: Game, c: Card, color: Color) => colorsOf(g, c).includes(color);

const num = (s?: string) => {
  const n = parseInt(s ?? '', 10);
  return Number.isNaN(n) ? 0 : n;
};

// ---------- player / zone queries ----------

export const living = (g: Game) => g.players.filter((p) => !p.lost);
export const opponentsOf = (g: Game, pid: PlayerId) => g.players.filter((p) => !p.lost && p.id !== pid);
export const battlefield = (g: Game): Card[] => g.players.flatMap((p) => (p.lost ? [] : p.battlefield));
export const creaturesOf = (g: Game, pid: PlayerId) => g.players[pid].battlefield.filter((c) => isCreature(g, c));
export const allCreatures = (g: Game) => battlefield(g).filter((c) => isCreature(g, c));

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
 * Its power, toughness and keyword abilities now, every continuous effect applied (613).
 * `base` leaves out effects with a duration, like "until end of turn" (the bots use it so
 * temporary pumps don't look like permanent value).
 */
export function stats(g: Game, c: Card, opts: { base?: boolean } = {}): Stats {
  const ch = characteristics(g, c, '7d', !opts.base);
  return { power: ch.power, toughness: ch.toughness, keywords: new Set(ch.keywords) };
}

export const has = (g: Game, c: Card, keyword: string) => stats(g, c).keywords.has(keyword);

/**
 * Restrictions a static effect can give a creature through `StaticBonus.keywords`, e.g.
 * Pacifism's "Enchanted creature can't attack or block." They aren't keywords, but they
 * travel the same way.
 */
export const CANT_ATTACK = "can't attack";
export const CANT_BLOCK = "can't block";
/** "Attacks each combat if able" (508.1d), given the same way. */
export const MUST_ATTACK = 'attacks each combat if able';

/** The `Delayed.key` of dash's return to hand (702.109a). Its `data` names the permanent: `id` and `moves`. */
export const RETURN_TO_HAND = '@return';

export function canAttack(g: Game, c: Card): boolean {
  if (c.zone !== 'battlefield' || !isCreature(g, c) || c.tapped) return false;
  const kw = stats(g, c).keywords;
  return !kw.has('defender') && !kw.has(CANT_ATTACK) && (!c.sick || kw.has('haste'));
}

export function canBlock(g: Game, blocker: Card, attacker: Card): boolean {
  if (blocker.zone !== 'battlefield' || !isCreature(g, blocker) || blocker.tapped) return false;
  if (has(g, blocker, CANT_BLOCK)) return false;
  // An attacker with protection can't be blocked by creatures with the stated quality (702.16f).
  if (protectedFrom(g, attacker, blocker)) return false;
  // Fear: only artifact creatures and/or black creatures can block it (702.36b).
  if (has(g, attacker, 'fear') && !hasType(g, blocker, 'Artifact') && !isColor(g, blocker, 'B')) return false;
  if (has(g, attacker, 'flying')) {
    const kw = stats(g, blocker).keywords;
    return kw.has('flying') || kw.has('reach');
  }
  return true;
}

/**
 * What declaring these attacks costs (508.1g): every "can't attack unless their controller
 * pays" effect together, like Propaganda's {2} for each creature attacking you.
 */
export function attackCost(g: Game, attacks: { id: string; defender: PlayerId; target: string | null }[]): Cost {
  let cost = NO_COST;
  for (const a of attacks) {
    const c = permanent(g, a.id);
    if (!c) continue;
    for (const src of battlefield(g)) {
      const tax = scriptFor(src).attackTax?.(g, src, c, a.defender, a.target);
      if (tax) cost = addCosts(cost, parseCost(tax));
    }
    // "Creatures can't attack you ... unless their controller pays {2} for each" (Summon: Yojimbo): attacks on the player only.
    if (a.target !== null) continue;
    for (const e of g.effects) if (e.kind === 'attackTax' && e.player === a.defender) cost = addCosts(cost, parseCost(e.mana));
  }
  return cost;
}

/** Does a cost ask for nothing at all? */
export const isFree = (cost: Cost) => cost.generic + cost.pips.length + cost.hybrid.length + cost.x + cost.life === 0;

/**
 * Can `pid` pay for these attacks (508.1h-i)? The attackers are tapped first (508.1f), so
 * one without vigilance can't tap for mana to pay.
 */
export function canPayAttacks(g: Game, pid: PlayerId, attacks: { id: string; defender: PlayerId; target: string | null }[]): boolean {
  const cost = attackCost(g, attacks);
  if (isFree(cost)) return true;
  const tapped = attacks.map((a) => permanent(g, a.id)).filter((c): c is Card => !!c && !has(g, c, 'vigilance')).map((c) => c.id);
  return !!planPayment(g, pid, cost, undefined, tapped);
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
export type HybridOption = ManaSym | '2' | 'life' | 'any';

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

/**
 * The alternative costs player `pid` could choose right now to cast `c` (118.9), by index
 * into its script's list. "You" in their conditions is `pid`, who would control the spell.
 */
export function altCostsOf(g: Game, c: Card, face = 0, pid = c.owner): number[] {
  // Flashback and escape are already alternative costs, and so is casting it without
  // paying its mana cost, for {2} after being airbent, or as a plotted card: only one can be
  // paid (118.9a, 702.34a, 702.138a, 701.65a, 702.170d).
  if (c.zone === 'graveyard' || freeCast(g, c) || exileCast(c)) return [];
  // Warp is cast only from the hand (702.185a).
  const alts = (scriptFor(c, 'stack', face).alternativeCosts ?? []).map((a) => (a.warp && c.zone !== 'hand' ? { ...a, when: () => false } : a));
  const self = { ...c, controller: pid };
  // One that exiles a card from the caster's hand, or sacrifices a permanent, needs one that fits (118.9).
  const canExile = (i: number) => !alts[i].exile || g.players[pid].hand.some((x) => x.id !== c.id && alts[i].exile!.filter(g, x, self));
  const canSacrifice = (i: number) => !alts[i].sacrifice || g.players[pid].battlefield.some((x) => fitsSpec(g, x, alts[i].sacrifice!, self));
  return alts.map((_, i) => i).filter((i) => (alts[i].when?.(g, self) ?? true) && canExile(i) && canSacrifice(i));
}

/** Does permanent `c` fit what `spec` describes (its type and filter), ignoring targeting? */
export function fitsSpec(g: Game, c: Card, spec: TargetSpec, source: Card): boolean {
  if (spec.type === 'creature' && !isCreature(g, c)) return false;
  return spec.filter?.(g, c, source, 0) ?? true;
}

/** Is `c` the card a resolving spell or ability lets its player cast now (608.2g)? */
export const castingNow = (g: Game, c: Card) => g.decision?.type === 'cast' && g.decision.choice.card === c.id;

/** Is face `face` of `c` an aftermath half (702.127a)? It can be cast only from a graveyard. */
export const isAftermath = (c: Card, face: number) => !!cardData(c.name).faces?.[face]?.keywords.includes('Aftermath');

/**
 * Is `c`, cast from its owner's graveyard with these choices, cast with flashback (702.34a)?
 * Not with escape, not as an aftermath half, and not when an effect lets the player cast it
 * (Emet-Selch), which pays its mana cost.
 */
export const paysFlashback = (g: Game, c: Card, choices: CastChoices) =>
  c.zone === 'graveyard' && !choices.escape && !castingNow(g, c) && !permission(g, null, c) && !isAftermath(c, choices.face ?? 0) && !!flashbackCost(g, c);

/**
 * The flashback cost card `c` in a graveyard has (702.34a): its own, or its mana cost while an
 * effect gives it flashback this turn (Flashback, Stingcaster Mage).
 */
export function flashbackCost(g: Game, c: Card): string | undefined {
  const own = scriptFor(c).flashback;
  if (own) return own;
  if (c.zone === 'graveyard' && g.effects.some((e) => e.kind === 'flashback' && e.card === c.id && e.moves === c.moves)) return data(c).manaCost;
  return undefined;
}

/** Is `c` being cast without paying its mana cost while a spell resolves (608.2g, Beseech the Mirror)? */
export const freeCast = (g: Game, c: Card) => g.decision?.type === 'cast' && g.decision.choice.card === c.id && g.decision.choice.free;

/**
 * The permission an effect gives `pid` to cast or play card `c` this turn, if there is one
 * (Ragavan, Jeska's Will, Mnemonic Betrayal). It lasts while `c` is the same object (400.7).
 */
export function permission(g: Game, pid: PlayerId | null, c: Card) {
  for (const e of g.effects) {
    if (e.kind !== 'mayCast' || e.card !== c.id || e.moves !== c.moves || (pid !== null && e.player !== pid)) continue;
    // "If you control a Wizard" (Flameshape).
    if (e.ifSubtype && !g.players[e.player].battlefield.some((x) => subtypesOf(g, x).includes(e.ifSubtype!))) continue;
    return e;
  }
  return undefined;
}

/**
 * Does card `c` in its owner's graveyard have escape now (702.138a)? Underworld Breach gives
 * it to each nonland card in its controller's graveyard.
 */
export const hasEscape = (g: Game, c: Card): boolean => escapes(g, c).length > 0;

/**
 * The escape abilities card `c` in its owner's graveyard has now (702.138a): its own, like
 * Cling to Dust's, and the one Underworld Breach gives (its mana cost plus three other cards).
 * Each is its mana and how many other cards from that graveyard it exiles.
 */
export function escapes(g: Game, c: Card): { mana: string; exile: number }[] {
  if (c.zone !== 'graveyard' || isLand(g, c)) return [];
  const out = scriptFor(c).escape ? [scriptFor(c).escape!] : [];
  if (g.players[c.owner].battlefield.some((p) => scriptFor(p).grantsEscape?.(g, p, c))) out.push({ mana: data(c).manaCost, exile: 3 });
  return out;
}

/** The escape ability a cast that exiles `n` other cards uses: the cards to exile tell which (702.138a). */
export const escapeFor = (g: Game, c: Card, n: number) => escapes(g, c).find((e) => e.exile === n);

/**
 * Is `c` in exile cast by a permission its exile gave it, which is an alternative cost: {2}
 * for an airbent card (701.65a), nothing for a plotted one (702.170d)?
 */
export const exileCast = (c: Card): 'airbent' | 'plotted' | undefined =>
  c.zone !== 'exile' ? undefined : c.plotted !== undefined ? 'plotted' : c.airbent ? 'airbent' : undefined;

/**
 * What it costs `c` to be cast right now with these choices (601.2f): the mana cost, or
 * the chosen alternative cost (118.9), with X filled in, plus kicker and commander tax,
 * plus cost increases, minus reductions. Reductions only take off generic mana, and
 * never below {0}. The returned `x` is 0: X has already been added to `generic`.
 */
export function castCost(g: Game, c: Card, choices: CastChoices = {}, pid = c.owner): Cost {
  // Only the face being cast counts: a split card's half, an Adventure (709.3a, 715.3a).
  const spell = asSpell(c, choices.face ?? 0);
  const script = scriptFor(spell);
  const alt = choices.alt === undefined ? undefined : script.alternativeCosts?.[choices.alt];
  // Cast from a graveyard, a card pays its flashback cost (702.34a) or, with escape, its
  // mana cost plus exiling three other cards from that graveyard (702.138a).
  const flashback = paysFlashback(g, c, choices) ? flashbackCost(g, c) : undefined;
  // "Without paying its mana cost" is an alternative cost of nothing (118.9, 601.2f), and so
  // is casting a plotted card (702.170d). An airbent card costs {2} instead (701.65a). A card
  // with its own escape pays its escape cost (702.138a); escape given by Underworld Breach is
  // its mana cost.
  const fromExile = exileCast(c);
  const free = freeCast(g, c) || fromExile === 'plotted';
  const escape = choices.escape && c.zone === 'graveyard' ? escapeFor(g, c, choices.escape.length)?.mana : undefined;
  let cost = parseCost(free ? '' : fromExile === 'airbent' ? '{2}' : (flashback ?? escape ?? (alt ? alt.mana : data(spell).manaCost)));
  // "Mana of any type can be spent to cast them" (Mnemonic Betrayal).
  if (permission(g, pid, c)?.anyMana) cost = anyType(cost);
  cost.life += alt?.life ?? 0;
  // "Pay N life" or "pay X life" as an additional cost (118.8, 119.4). It is paid whatever
  // else is paid instead of the mana cost (118.9d).
  const life = script.additionalCost?.life;
  cost.life += life === 'x' ? (choices.x ?? 0) : (life ?? 0);
  // X counts as generic mana (107.4b). An alternative cost without {X} makes X 0 (107.3b).
  cost.generic += cost.x * (choices.x ?? 0);
  cost.x = 0;
  for (let k = 0; k < (choices.kicked ?? 0) && script.kicker; k++) cost = addCosts(cost, parseCost(script.kicker.mana));
  // Offspring is an optional additional cost (702.175a).
  if (choices.offspring && script.offspring) cost = addCosts(cost, parseCost(script.offspring));
  // "Pay 5 life or pay {2}": the additional cost chosen (118.8).
  const extra = choices.extra === undefined ? undefined : script.additionalCost?.oneOf?.[choices.extra];
  if (extra?.mana) cost = addCosts(cost, parseCost(extra.mana));
  cost.life += extra?.life ?? 0;
  // Spree: each chosen mode's cost is an additional cost (702.172a).
  for (const i of choices.modes ?? []) {
    const extra = script.modal?.modes[i]?.cost;
    if (extra) cost = addCosts(cost, parseCost(extra));
  }
  // Commander tax is an additional cost, so it applies to alternative costs too (903.8, 118.9d).
  if (c.zone === 'command') cost.generic += commanderTax(g, c);
  // 601.2f: all increases are added and all reductions taken off together, so the order
  // they apply in doesn't matter. Only generic mana is reduced.
  let change = -(script.costReduction?.(g, c) ?? 0);
  for (const p of battlefield(g)) change += scriptFor(p).costModifier?.(g, p, spell, pid, c.zone) ?? 0;
  cost.generic = Math.max(0, cost.generic + change);
  // Delve applies after the total cost is worked out: each card exiled pays for {1} (702.66a-b).
  cost.generic = Math.max(0, cost.generic - (choices.delve?.length ?? 0));
  return cost;
}

/** A cost that mana of any type can pay: each coloured symbol becomes one mana of any type. */
export function anyType(cost: Cost): Cost {
  return {
    ...cost,
    generic: cost.generic + cost.pips.length,
    pips: [],
    hybrid: cost.hybrid.map((h): HybridOption[] => ['any', ...(h.includes('life') ? (['life'] as const) : [])]),
  };
}

/**
 * A cost paid with mana spent as though it were mana of any colour (Agatha's Soul Cauldron):
 * each coloured symbol takes one mana of any type. {C} still takes colourless mana.
 */
export function anyColor(cost: Cost): Cost {
  const colored = (x: HybridOption) => WUBRG.includes(x as ManaSym);
  return {
    ...cost,
    generic: cost.generic + cost.pips.filter(colored).length,
    pips: cost.pips.filter((x) => !colored(x)),
    hybrid: cost.hybrid.map((h): HybridOption[] => (h.some(colored) ? ['any', ...(h.includes('life') ? (['life'] as const) : [])] : h)),
  };
}

/** What `pid` pays to activate ability `ab` of `c`: its cost, paid with mana of any colour if something lets them (Agatha's Soul Cauldron). */
export function activationCost(g: Game, pid: PlayerId, c: Card, ab: ActivatedAbility, x = 0): Cost {
  const cost = abilityCost(ab, g, c, x);
  return battlefield(g).some((src) => scriptFor(src).anyColorFor?.(g, src, pid, c)) ? anyColor(cost) : cost;
}

const BASIC_MANA: Record<string, ManaSym> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
const WUBRG: ManaSym[] = ['W', 'U', 'B', 'R', 'G'];

/** One of a permanent's mana abilities (605) as it is right now: the colours worked out, and its index in the script's list. */
export interface ManaUse extends Omit<ManaAbility, 'colors'> {
  index: number;
  colors: ManaSym[];
}

/**
 * Every mana ability `c` has, usable or not right now. A land with basic land types taps
 * for each of their colours (305.6); its other mana abilities come after.
 */
function allManaAbilities(g: Game, c: Card): ManaAbility[] {
  const out: ManaAbility[] = [];
  if (isLand(g, c)) {
    const colors = Object.entries(BASIC_MANA).filter(([type]) => hasType(g, c, type)).map(([, sym]) => sym);
    if (colors.length) out.push({ amount: 1, colors });
  }
  const m = scriptFor(c).mana;
  // Then any an effect gave it (Rain of Filth), and any another card gives it (Agatha's Soul Cauldron).
  const gained = c.zone === 'battlefield' ? characteristics(g, c, '6').mana : [];
  const borrowed = lenders(g, c).flatMap((name) => listOf(scriptOf(name).mana));
  return [...out, ...listOf(m), ...gained, ...borrowed];
}

/**
 * The types of mana a land could produce (106.7), for Fellwar Stone and Exotic Orchard.
 * Costs and conditions are ignored. Abilities whose colours depend on other permanents
 * don't count, so two Orchards can't feed each other.
 */
export function landColors(g: Game, c: Card): ManaSym[] {
  const out = new Set<ManaSym>();
  for (const ab of allManaAbilities(g, c)) {
    if (typeof ab.colors === 'function') continue;
    const colors = ab.colors === 'any' ? WUBRG : ab.colors === 'identity' ? (g.players[c.controller].colors as ManaSym[]) : ab.colors;
    colors.forEach((x) => out.add(x));
  }
  return [...out];
}

/** The mana abilities of `c` whose conditions are met now (605.1a), with their colours worked out. */
export function manaAbilities(g: Game, c: Card): ManaUse[] {
  return allManaAbilities(g, c).flatMap((ab, index) => {
    if (ab.when && !ab.when(g, c)) return [];
    let colors: ManaSym[];
    if (typeof ab.colors === 'function') colors = ab.colors(g, c);
    else if (ab.colors === 'any') colors = WUBRG;
    // Both partners' colours count as "your commander's colour identity" (702.124c). With a
    // colourless commander there is no colour to choose, so it makes no mana: colourless isn't a colour (105.1).
    else if (ab.colors === 'identity') colors = g.players[c.controller].colors;
    else colors = ab.colors;
    // "Any colour that a land an opponent controls could produce" may be no colour at all.
    return colors.length ? [{ ...ab, index, colors }] : [];
  });
}

/** What a permanent can tap for, all its mana abilities together (for display and the bots), or null if it isn't a mana source. */
export function manaOf(g: Game, c: Card): { amount: number; colors: ManaSym[]; sacrifice?: boolean } | null {
  const all = manaAbilities(g, c).filter((m) => !m.fromHand);
  if (!all.length) return null;
  const colors = [...new Set(all.flatMap((m) => m.colors))];
  // A Signet's two mana cost one: it adds one more than it takes.
  const net = (m: ManaUse) => m.amount - (m.cost ? manaCount(parseCost(m.cost)) : 0);
  return { amount: Math.max(...all.map(net)), colors, sacrifice: all.every((m) => m.sacrifice) };
}

/** Does something stop `pid` casting `card`, or activating one of its abilities (101.2)? */
export function forbidden(g: Game, pid: PlayerId, kind: 'cast' | 'activate', card: Card, from?: Zone | 'stack'): boolean {
  const stops = (e: TurnEffect) =>
    e.kind === 'cantCast' &&
    e.player === pid &&
    (!e.noncreature || !isCreature(g, card)) &&
    (!e.types || e.types.some((t) => hasType(g, card, t))) &&
    // "Can't cast spells from anywhere other than their hands" (Avatar's Wrath).
    (!e.notFromHand || (from !== undefined && from !== 'hand'));
  if (kind === 'cast' && g.effects.some(stops)) return true;
  return battlefield(g).some((src) => scriptFor(src).forbids?.(g, src, pid, { kind, card }));
}

/** May `pid` cast `spell` as though it had flash (702.8)? */
export const flashGranted = (g: Game, pid: PlayerId, spell: Card) =>
  g.effects.some((e) => e.kind === 'flash' && e.player === pid) || battlefield(g).some((src) => scriptFor(src).grantsFlash?.(g, src, pid, spell));

interface Source {
  id: string;
  /** Which mana ability. */
  ability: number;
  /**
   * The permanents using it taps or sacrifices: the source itself, and the creature a cost like
   * Relic of Legends's "Tap an untapped legendary creature you control" taps. Once used, no other
   * source that needs one of them can be.
   */
  taps: string[];
  /** The creature tapped for that cost, if it has one. */
  creature?: string;
  amount: number;
  colors: ManaSym[];
  /** Sacrificed to make its mana, like a Treasure: auto-pay uses it last. */
  sacrifice?: boolean;
  /** Life paid, or damage taken, to use it: auto-pay uses it after the free ones. */
  pain: number;
  life: number;
  /** Its mana can be spent only on a creature spell of this type (106.6). */
  only?: string;
  /** Its mana can be spent only on a legendary spell (106.6, Plaza of Heroes). */
  legendary?: boolean;
  /** Its mana can be spent only on spells with one of these card types (106.6, Tablet of Discovery). */
  types?: string[];
  /** Not a mana ability: a creature tapped to pay for one mana of a spell with convoke (702.51a). */
  convoke?: boolean;
  /** A spell its mana is spent on can't be countered (106.6). */
  uncounterable?: boolean;
  /**
   * Tapping it costs more than mana: it is a creature (it could attack, block or crew), or
   * it has another ability with {T} in its cost. Auto-pay uses lands and plain rocks first.
   */
  busy: boolean;
  /** How much auto-pay wants to leave it untapped (see `keepValue`); set by `planPayment`. */
  keep?: number;
}

/** Can `pid` use this mana ability of `c` now? A creature's {T} ability needs it to be free of summoning sickness (302.6). */
function usable(g: Game, pid: PlayerId, c: Card, ab: ManaUse): boolean {
  if (ab.fromHand ? c.zone !== 'hand' || c.owner !== pid : c.zone !== 'battlefield' || c.controller !== pid) return false;
  if (!ab.noTap && !ab.fromHand && (c.tapped || (isCreature(g, c) && c.sick && !has(g, c, 'haste')))) return false;
  if (ab.life && (g.players[pid].life < ab.life || lifeLocked(g, pid))) return false; // 119.4, 119.8
  // "Discard a card" needs a card to discard (Skirge Familiar).
  if (ab.discard && g.players[pid].hand.length < ab.discard) return false;
  // "Sacrifice a creature" needs a creature to sacrifice (Phyrexian Tower).
  if (ab.sacrificeCreature && !creaturesOf(g, pid).length) return false;
  // "Activate only as an instant": its controller needs priority, and nothing else may be going on.
  if (ab.instant && (g.priority !== pid || g.decision || g.resolving)) return false;
  // "Spend this mana only to cast a creature spell of the chosen type": no type chosen, no use.
  if (ab.chosenType && !c.chosen) return false;
  if (ab.tapCreature && !tapCandidates(g, pid, ab).length) return false;
  return !forbidden(g, pid, 'activate', c);
}

/** The creatures `pid` could tap for a mana ability's "Tap an untapped [legendary] creature you control" cost. */
export const tapCandidates = (g: Game, pid: PlayerId, ab: Pick<ManaAbility, 'tapCreature'>): Card[] =>
  ab.tapCreature ? creaturesOf(g, pid).filter((x) => !x.tapped && (!ab.tapCreature!.legendary || hasType(g, x, 'Legendary'))) : [];

/**
 * Can mana with these restrictions be spent on `spell` (106.6)? Restricted to creature
 * spells of type `only`, or to legendary spells.
 */
const spendable = (g: Game, m: { only?: string; legendary?: boolean; types?: string[] }, spell?: Card) =>
  (!m.only || (!!spell && isCreature(g, spell) && subtypesOf(g, spell).includes(m.only))) &&
  (!m.legendary || (!!spell && hasType(g, spell, 'Legendary'))) &&
  (!m.types || (!!spell && m.types.some((t) => hasType(g, spell, t))));

/** Mana that can be spent only on some spells (106.6). */
const restricted = (m: { only?: string; legendary?: boolean; types?: string[] }) => !!(m.only || m.legendary || m.types);

/**
 * The mana abilities `pid` could use now, one entry per ability. `manual` adds the ones
 * auto-pay leaves alone: those marked `manual`, and those used from a hand.
 */
export function manaSources(g: Game, pid: PlayerId, manual = false): Source[] {
  return settled(g, () => findManaSources(g, pid, manual));
}

function findManaSources(g: Game, pid: PlayerId, manual: boolean): Source[] {
  const out: Source[] = [];
  const p = g.players[pid];
  for (const c of [...p.battlefield, ...(manual ? p.hand : [])]) {
    for (const ab of manaAbilities(g, c)) {
      // Auto-pay never discards a card for mana (Skirge Familiar): it costs a card.
      // Nor does it sacrifice a creature for mana (Phyrexian Tower).
      if ((ab.manual || ab.fromHand || ab.discard || ab.sacrificeCreature) && !manual) continue;
      if (!usable(g, pid, c, ab)) continue;
      // One with a mana cost (a Signet) isn't a plain source: auto-pay works it in with
      // `planWithCosted`. By hand it can be used when its cost can be paid without it.
      if (ab.cost && (!manual || !planPayment(g, pid, parseCost(ab.cost), undefined, [c.id]))) continue;
      // One that taps a creature as well is a source once for each creature that could pay
      // (Relic of Legends, Springleaf Drum). The creature can't make mana too once it is tapped.
      const self = ab.noTap && !ab.fromHand ? [] : [c.id];
      const creatures: (string | undefined)[] = ab.tapCreature ? tapCandidates(g, pid, ab).map((x) => x.id) : [undefined];
      for (const creature of creatures) {
        out.push({
          id: c.id,
          ability: ab.index,
          taps: creature ? [...self, creature] : [c.id],
          ...(creature ? { creature } : {}),
          amount: ab.amount,
          colors: ab.colors,
          sacrifice: ab.sacrifice,
          pain: (ab.life ?? 0) + (ab.damage ?? 0),
          life: ab.life ?? 0,
          // Tapping a creature for it costs that creature's attack or block.
          busy: !!creature || (!ab.noTap && !ab.fromHand && (isCreature(g, c) || activatedAbilities(g, c).some((a) => a.cost.tap))),
          ...(ab.chosenType ? { only: c.chosen ?? undefined, uncounterable: ab.uncounterable } : {}),
          ...(ab.legendary ? { legendary: true } : {}),
          ...(ab.types ? { types: ab.types } : {}),
        });
      }
    }
  }
  return out;
}

/** Can the player use a mana ability of this card right now (by hand, so manual ones count)? */
export const canTapForMana = (g: Game, pid: PlayerId, c: Card, ability?: number) =>
  manaSources(g, pid, true).some((s) => s.id === c.id && (ability === undefined || s.ability === ability));

/**
 * The colour a source with a choice of colours makes when tapped by hand. It picks one of
 * the player's commander colours (that is all their deck needs), and among those the one
 * their hand and command zone want most and their other mana covers least.
 */
function pickColor(g: Game, pid: PlayerId, options: ManaSym[]): ManaSym {
  const p = g.players[pid];
  const mine = options.filter((x) => (p.colors as ManaSym[]).includes(x));
  if (mine.length <= 1) return mine[0] ?? options[0];
  return mine.reduce((best, x) => (colorNeed(g, pid, x) > colorNeed(g, pid, best) ? x : best));
}

/** The colour a player's bot would choose when a spell or ability asks for one, like "one mana of any color". */
export const preferredColor = (g: Game, pid: PlayerId): ManaSym => pickColor(g, pid, ['W', 'U', 'B', 'R', 'G']);

/** How much more of colour `sym` the player's hand and command zone want than their pool and one-colour sources give. */
function colorNeed(g: Game, pid: PlayerId, sym: ManaSym): number {
  const p = g.players[pid];
  const wanted = [...p.hand, ...p.command].reduce((n, c) => n + parseCost(data(c).manaCost).pips.filter((x) => x === sym).length, 0);
  const pool = p.pool.filter((x) => x.sym === sym).length;
  const fixed = manaSources(g, pid).filter((s) => s.colors.length === 1 && s.colors[0] === sym).length;
  return wanted - pool - fixed;
}

/**
 * Which mana ability of `c` a click by hand uses: the cheapest one that makes a colour the
 * player needs, or else the cheapest (free before painful, painful before sacrificing).
 */
function pickManaAbility(g: Game, pid: PlayerId, c: Card): number | undefined {
  // One that costs a creature is used only when the player picks it (Phyrexian Tower).
  const options = manaSources(g, pid, true)
    .filter((s) => s.id === c.id && !manaAbilities(g, c).find((m) => m.index === s.ability)?.sacrificeCreature)
    .sort((a, b) => a.pain + (a.sacrifice ? 100 : 0) - (b.pain + (b.sacrifice ? 100 : 0)));
  const wanted = options.find((s) => s.colors.some((x) => x !== 'C' && colorNeed(g, pid, x) > 0));
  return (wanted ?? options[0])?.ability;
}

/**
 * Pays the costs of mana ability `ab` of `c` and applies its side effects, without adding
 * the mana: tapping, life (119.4), sacrificing or exiling it, the damage it deals, and
 * "whenever this becomes tapped".
 */
function useManaAbility(g: Game, pid: PlayerId, c: Card, ab: ManaUse, tapId?: string, discardId?: string, sacrificeId?: string) {
  const p = g.players[pid];
  if (ab.sacrificeCreature) {
    // "Sacrifice a creature" (Phyrexian Tower): the one the player chose.
    const creature = creaturesOf(g, pid).find((x) => x.id === sacrificeId);
    if (creature) dieMany(g, [creature], 'is sacrificed');
  }
  if (ab.discard) {
    // "Discard a card" (Skirge Familiar): the one the player chose, or else the first.
    const card = p.hand.find((x) => x.id === discardId) ?? p.hand[0];
    if (card) discard(g, card);
  }
  if (ab.tapCreature) {
    const options = tapCandidates(g, pid, ab);
    const creature = options.find((x) => x.id === tapId) ?? options[0];
    if (creature) {
      tap(g, creature);
      log(g, `${says(p, 'taps')} ${label(creature)} (${label(c)}).`, pid, [creature, c]);
    }
  }
  if (ab.life) {
    subtractLife(g, pid, ab.life);
    log(g, `${says(p, 'pays')} ${ab.life} life (${label(c)}).`, pid, [c]);
  }
  if (ab.discardHand) discardHand(g, pid);
  if (ab.fromHand) {
    log(g, `${says(p, 'exiles')} ${label(c)} from ${their(p)} hand for mana.`, pid, [c]);
    moveCard(g, c, 'exile');
    return;
  }
  if (!ab.noTap) tap(g, c);
  if (ab.damage) damagePlayer(g, c, pid, ab.damage);
  if (ab.sacrifice) dieMany(g, [c], 'is sacrificed');
}

/**
 * Uses a mana ability by hand. A Treasure is sacrificed too (111.10a): that can't be undone.
 * `color`: the colour to make, if the ability has a choice; left out, one is picked.
 */
export function tapForMana(g: Game, pid: PlayerId, c: Card, ability = pickManaAbility(g, pid, c), color?: ManaSym, tapId?: string, discardId?: string, sacrificeId?: string) {
  const ab = manaAbilities(g, c).find((m) => m.index === ability);
  if (!ab) return;
  if (ab.cost) {
    // Its mana cost is paid first, from the pool or other sources (602.2b, 601.2g-h).
    if (!pay(g, pid, parseCost(ab.cost), undefined, [c.id])) return;
    const made = pickProduce(g, pid, ab, color);
    for (const sym of made) g.players[pid].pool.push({ sym, source: c.id, ability: ab.index });
    useManaAbility(g, pid, c, ab);
    return;
  }
  const sym = color && ab.colors.includes(color) ? color : ab.colors.length === 1 ? ab.colors[0] : pickColor(g, pid, ab.colors);
  const only = ab.chosenType ? (c.chosen ?? undefined) : undefined;
  for (let k = 0; k < ab.amount; k++)
    g.players[pid].pool.push({
      sym,
      source: c.id,
      ability: ab.index,
      ...(only ? { only, uncounterable: ab.uncounterable } : {}),
      ...(ab.legendary ? { legendary: true } : {}),
      ...(ab.types ? { types: ab.types } : {}),
    });
  useManaAbility(g, pid, c, ab, tapId, discardId, sacrificeId);
}

/**
 * Adds mana straight to a player's pool, as a ritual does. `source` is the card that made
 * it. `keep`: it stays in the pool as steps and phases end, until the end of the turn.
 */
export function addMana(g: Game, pid: PlayerId, syms: ManaSym[], source: Card, opts: { keep?: boolean } = {}) {
  if (g.players[pid].lost) return;
  for (const sym of syms) g.players[pid].pool.push({ sym, source: source.id, ...(opts.keep ? { keep: g.turn } : {}) });
  if (syms.length) log(g, `${says(g.players[pid], 'adds')} ${syms.map((s) => `{${s}}`).join('')}.`, pid, [source]);
}

/**
 * Tapping for mana can be undone while every mana it made is still unspent in the pool,
 * and it cost nothing but the tap.
 */
export function canUntapMana(g: Game, pid: PlayerId, c: Card): boolean {
  if (c.controller !== pid || c.zone !== 'battlefield' || !c.tapped) return false;
  const made = g.players[pid].pool.filter((x) => x.source === c.id);
  const ab = made.length ? manaAbilities(g, c).find((m) => m.index === made[0].ability) : undefined;
  if (!ab || ab.life || ab.damage || ab.sacrifice || ab.noTap || ab.discardHand || ab.discard || ab.sacrificeCreature || ab.cost || scriptFor(c).onTapped) return false;
  return made.length === ab.amount;
}

export function untapMana(g: Game, pid: PlayerId, c: Card) {
  const p = g.players[pid];
  p.pool = p.pool.filter((x) => x.source !== c.id);
  c.tapped = false;
}

/** Total mana the player could produce right now (for display). */
export function availableMana(g: Game, pid: PlayerId): number {
  // A permanent with several mana abilities can use only one of them at a time.
  const most = new Map<string, number>();
  for (const s of manaSources(g, pid)) most.set(s.taps.join(), Math.max(most.get(s.taps.join()) ?? 0, s.amount));
  // A Signet adds one more than its cost takes; a filter land's two for one adds nothing to its own {C}.
  for (const { c, ab } of costedSources(g, pid)) most.set(c.id, Math.max(most.get(c.id) ?? 0, ab.amount - manaCount(parseCost(ab.cost!))));
  return [...most.values()].reduce((n, x) => n + x, 0) + g.players[pid].pool.length;
}

/**
 * Coloured mana symbols the player's other cards in hand and command zone ask for, by
 * colour. A hybrid or Phyrexian symbol counts toward each of its colours. `except`: the
 * card being paid for, which won't need its mana again.
 */
function colorWants(g: Game, pid: PlayerId, except?: string): Map<ManaSym, number> {
  const p = g.players[pid];
  const wants = new Map<ManaSym, number>();
  for (const c of [...p.hand, ...p.command]) {
    if (c.id === except) continue;
    const cost = parseCost(data(c).manaCost);
    for (const x of [...cost.pips, ...cost.hybrid.flat()]) if (WUBRG.includes(x as ManaSym)) wants.set(x as ManaSym, (wants.get(x as ManaSym) ?? 0) + 1);
  }
  return wants;
}

/**
 * How much auto-pay wants to leave source `s` untapped; lower is tapped first. Each colour
 * it makes adds 1 (a dual is more flexible than a basic), and 3 more if a card in hand or
 * the command zone wants that colour. Being a creature or having another {T} ability adds
 * 25, more than any land's colours, so lands and plain rocks are tapped first. Pain and
 * sacrifice are weighed separately by `payMana` and `payGeneric`.
 */
const keepValue = (s: Source, wants: Map<ManaSym, number>) =>
  s.colors.reduce((n, x) => n + (x === 'C' ? 0 : 1 + ((wants.get(x) ?? 0) > 0 ? 3 : 0)), 0) + (s.busy ? 25 : 0);

interface Plan {
  pool: Mana[];
  sources: Source[];
  /** The mana abilities used, in order. */
  uses: ManaUseRef[];
  /** Life the mana abilities used cost (119.4). */
  abilityLife: number;
  /** Generic mana still to pay: the cost's own plus any {2/W} paid the generic way. */
  generic: number;
  life: number;
  /** Mana spent so far. */
  spent: number;
  /** Mana that says "that spell can't be countered" was spent (106.6). */
  uncounterable: boolean;
  /** Colours other cards want (`colorWants`): generic mana is paid from the pool with the others first. */
  wants: Map<ManaSym, number>;
}

/** Mana a source makes beyond the one it is tapped to pay for. It goes to the pool. */
const extraMana = (s: Source, paying: ManaSym | null): Mana[] =>
  Array.from({ length: s.amount - 1 }, () => ({
    sym: s.colors.length === 1 ? s.colors[0] : (paying ?? s.colors[0]),
    source: s.id,
    ability: s.ability,
    ...(s.only ? { only: s.only, uncounterable: s.uncounterable } : {}),
    ...(s.legendary ? { legendary: true } : {}),
    ...(s.types ? { types: s.types } : {}),
  }));

/** Uses source `s` to pay one mana: the permanent's other mana abilities are gone with it (it is tapped, or sacrificed). */
const useSource = (plan: Plan, s: Source, paying: ManaSym | null): Plan => ({
  ...plan,
  pool: [...plan.pool, ...extraMana(s, paying)],
  sources: plan.sources.filter((x) => !x.taps.some((t) => s.taps.includes(t))),
  uses: [...plan.uses, { id: s.id, ability: s.ability, ...(s.creature ? { creature: s.creature } : {}), ...(s.convoke ? { convoke: true } : {}), taps: s.taps }],
  abilityLife: plan.abilityLife + s.life,
  // A creature that convoked paid for the mana without it being spent (702.51a).
  spent: plan.spent + (s.convoke ? 0 : 1),
  uncounterable: plan.uncounterable || !!s.uncounterable,
});

/** Spends the mana at `i` in the pool. */
const fromPool = (plan: Plan, i: number): Plan => ({
  ...plan,
  pool: plan.pool.filter((_, k) => k !== i),
  spent: plan.spent + 1,
  uncounterable: plan.uncounterable || !!plan.pool[i].uncounterable,
});

/**
 * The ways to pay one mana of `sym`: from the pool if it has one (always the best way),
 * otherwise from each kind of source that makes it, the one to keep least first (`keepValue`):
 * one mana before two, a basic before a dual, a land before a creature, free before painful
 * before sacrificed.
 */
function payMana(sym: ManaSym, plan: Plan): Plan[] {
  const inPool = plan.pool.findIndex((m) => m.sym === sym);
  if (inPool >= 0) return [fromPool(plan, inPool)];
  const rank = (s: Source) => s.amount * 10 + (s.keep ?? 0) + s.pain * 300 + (s.sacrifice ? 1000 : 0);
  // A stable sort keeps the battlefield order between equals, so the choice is always the same.
  const options = plan.sources.filter((s) => s.colors.includes(sym)).sort((a, b) => rank(a) - rank(b));
  const tried = new Set<string>(); // sources that make the same mana the same way are interchangeable
  const out: Plan[] = [];
  for (const s of options) {
    const kind = `${s.amount}:${s.colors.join('')}:${s.pain}:${!!s.sacrifice}:${s.keep ?? 0}`;
    if (tried.has(kind)) continue;
    tried.add(kind);
    out.push(useSource(plan, s, sym));
  }
  return out;
}

/** Pays the generic part from whatever is left: pool first, then the sources that fit it best. */
function payGeneric(plan: Plan): Plan | null {
  let remaining = plan.generic;
  while (remaining > 0) {
    if (plan.pool.length) {
      // Restricted mana first (it can't pay for anything else), then colourless, then the colour other cards want least.
      const rank = (m: Mana) => (restricted(m) ? -2 : m.sym === 'C' ? -1 : (plan.wants.get(m.sym) ?? 0));
      const i = plan.pool.reduce((best, m, k) => (rank(m) < rank(plan.pool[best]) ? k : best), 0);
      plan = fromPool(plan, i);
      remaining--;
      continue;
    }
    if (!plan.sources.length) return null;
    // Prefer the biggest source that doesn't overpay, then the one to keep least (`keepValue`:
    // colourless before a colour nothing wants, a basic before a dual, a land before a
    // creature), free before painful.
    const score = (s: Source) =>
      (s.amount <= remaining ? 100 + s.amount * 10 : 50 - s.amount * 10) - (s.keep ?? 0) - s.pain * 30 - (s.sacrifice ? 500 : 0);
    const best = plan.sources.reduce((a, b) => (score(b) > score(a) ? b : a));
    // Its first mana pays for this; the rest goes to the pool and is spent next.
    plan = useSource(plan, best, null);
    remaining--;
  }
  return { ...plan, generic: 0 };
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
      option === '2' || option === 'any'
        ? [{ ...plan, generic: plan.generic + (option === '2' ? 2 : 1) }]
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
/** A mana ability used to pay: permanent `id`'s ability `ability`, and the creature it taps for its cost, if any. */
export interface ManaUseRef {
  id: string;
  ability: number;
  creature?: string;
  /** Not a mana ability: creature `id` is tapped to pay for one mana of a spell with convoke (702.51a). */
  convoke?: boolean;
  taps: string[];
}

/** How a cost would be paid (see `planPayment`). */
export interface Payment {
  /** The permanents tapped or sacrificed for it. */
  tap: string[];
  uses: ManaUseRef[];
  pool: Mana[];
  life: number;
  /** How much mana is spent. */
  spent: number;
  /** Mana that makes the spell uncounterable is spent (106.6). */
  uncounterable: boolean;
}

/**
 * `keep`: permanents already being used to pay another part of the cost, like the one
 * sacrificed for an additional cost: they can't make mana too.
 */
export const planPayment = (g: Game, pid: PlayerId, cost: Cost, spell?: Card, keep: string[] = [], convoke?: string[]): Payment | null =>
  convoke ? planConvoked(g, pid, cost, spell, keep, convoke) : planFrom(g, pid, cost, spell, keep, g.players[pid].pool);

/** While set, no creature is a convoke source: the creatures that convoke were chosen already. */
let convokeChosen = false;

/**
 * A payment that taps exactly the creatures `convoke` for convoke (702.51a), each paying for
 * {1} or one mana of its colour, and pays the rest as usual without convoking any others.
 * Null if those creatures can't convoke for this spell, or not all of them can pay a part.
 */
function planConvoked(g: Game, pid: PlayerId, cost: Cost, spell: Card | undefined, keep: string[], convoke: string[]): Payment | null {
  const sources = convokeSources(g, pid, spell);
  const creatures = convoke.map((id) => sources.find((s) => s.id === id));
  if (creatures.some((s) => !s) || new Set(convoke).size !== convoke.length || convoke.some((id) => keep.includes(id))) return null;
  const was = convokeChosen;
  convokeChosen = true;
  try {
    for (const rest of convokeRemainders(cost, creatures.map((s) => s!.colors))) {
      const plan = planFrom(g, pid, rest, spell, [...keep, ...convoke], g.players[pid].pool);
      if (plan) {
        const uses = creatures.map((s): ManaUseRef => ({ id: s!.id, ability: -1, convoke: true, taps: s!.taps }));
        return { ...plan, tap: [...convoke, ...plan.tap], uses: [...uses, ...plan.uses] };
      }
    }
    return null;
  } finally {
    convokeChosen = was;
  }
}

/**
 * What is left of `cost` after each creature with these colours pays one part of it
 * (702.51a): {1}, or one mana of one of its colours, which can pay a coloured or hybrid
 * symbol. Every way it could go, without repeats; none if a creature has nothing to pay.
 */
function convokeRemainders(cost: Cost, creatures: ManaSym[][]): Cost[] {
  const key = (c: Cost) => `${c.generic}|${[...c.pips].sort().join()}|${c.hybrid.map((h) => h.join('/')).sort().join()}`;
  let costs = [cost];
  for (const colors of creatures) {
    const next = new Map<string, Cost>();
    const add = (c: Cost) => next.set(key(c), c);
    for (const c of costs) {
      if (c.generic > 0) add({ ...c, generic: c.generic - 1 });
      for (const sym of new Set(c.pips)) {
        if (colors.includes(sym)) add({ ...c, pips: c.pips.filter((_, i) => i !== c.pips.indexOf(sym)) });
      }
      c.hybrid.forEach((h, i) => {
        const others = c.hybrid.filter((_, j) => j !== i);
        // One mana of its colour pays a hybrid or Phyrexian symbol of that colour, or a {any} one.
        if (h.includes('any') || h.some((x) => colors.includes(x as ManaSym))) add({ ...c, hybrid: others });
        // {2/W} paid as two generic mana: the creature pays for one of them (107.4e).
        if (h.includes('2')) add({ ...c, hybrid: others, generic: c.generic + 1 });
      });
    }
    costs = [...next.values()];
  }
  return costs;
}

/**
 * `planPayment` with `inPool` as the mana in the player's pool, for trying a payment out.
 * Mana abilities with a mana cost (Signets, filter lands) are used only when the cost
 * can't be paid without them (`planWithCosted`).
 */
function planFrom(g: Game, pid: PlayerId, cost: Cost, spell: Card | undefined, keep: string[], inPool: Mana[]): Payment | null {
  const plain = planPlain(g, pid, cost, spell, keep, inPool);
  if (plain) return plain;
  const costed = costedSources(g, pid).filter((x) => !keep.includes(x.c.id));
  if (!costed.length) return null;
  // Not enough mana however the costed abilities are used: skip the search.
  const most = new Map<string, number>();
  // Each source counted once for what it taps: an upper bound on what they can make together.
  for (const s of [...manaSources(g, pid), ...convokeSources(g, pid, spell)]) if (!s.taps.some((t) => keep.includes(t))) most.set(s.taps.join(), Math.max(most.get(s.taps.join()) ?? 0, s.amount));
  for (const { c, ab } of costed) most.set(c.id, Math.max(most.get(c.id) ?? 0, ab.amount - manaCount(parseCost(ab.cost!))));
  const total = inPool.length + [...most.values()].reduce((n, x) => n + x, 0);
  if (total < manaCount(cost)) return null;
  return planWithCosted(g, pid, cost, spell, keep, inPool, costed, 0);
}

/** How many mana a cost takes, leaving out Phyrexian symbols, which can be paid with life. */
const manaCount = (cost: Cost) => cost.generic + cost.pips.length + cost.hybrid.filter((h) => !h.includes('life')).length;

/** Mana abilities with a mana cost that `pid` could use now, whether or not the cost can be paid. */
function costedSources(g: Game, pid: PlayerId): { c: Card; ab: ManaUse }[] {
  return g.players[pid].battlefield.flatMap((c) => manaAbilities(g, c).filter((ab) => ab.cost && !ab.manual && usable(g, pid, c, ab)).map((ab) => ({ c, ab })));
}

/** The lists of mana an ability can add: its `produces`, or `amount` of each of its colours. */
const produceOptions = (ab: ManaUse): ManaSym[][] => ab.produces ?? ab.colors.map((x) => Array.from({ length: ab.amount }, () => x));

/** Which of an ability's lists of mana a player makes by hand: one with `color` if given, else the one their cards want most. */
function pickProduce(g: Game, pid: PlayerId, ab: ManaUse, color?: ManaSym): ManaSym[] {
  const options = produceOptions(ab);
  const withColor = color ? options.filter((o) => o.includes(color)) : [];
  const pool = withColor.length ? withColor : options;
  const need = (o: ManaSym[]) => o.reduce((n, x) => n + (x === 'C' ? 0 : Math.max(0, colorNeed(g, pid, x))), 0);
  return pool.reduce((best, o) => (need(o) > need(best) ? o : best));
}

/** At most this many costed mana abilities are chained for one payment, to keep the search small. */
const MAX_COSTED = 3;

/**
 * Pays `cost` using costed mana abilities from `avail`, in their order: each one's own cost
 * is paid first from the pool and plain sources, without itself (605.1a, 602.2b), then the
 * mana it adds goes to the pool. The first way found that pays everything is used.
 */
function planWithCosted(
  g: Game,
  pid: PlayerId,
  cost: Cost,
  spell: Card | undefined,
  keep: string[],
  inPool: Mana[],
  avail: { c: Card; ab: ManaUse }[],
  depth: number,
): Payment | null {
  if (depth >= MAX_COSTED) return null;
  const life = g.players[pid].life;
  for (let i = 0; i < avail.length; i++) {
    const { c, ab } = avail[i];
    const act = planPlain(g, pid, parseCost(ab.cost!), undefined, [...keep, c.id], inPool);
    if (!act) continue;
    const keep2 = [...keep, ...act.tap, c.id];
    const later = avail.slice(i + 1).filter((x) => !keep2.includes(x.c.id));
    for (const made of produceOptions(ab)) {
      const pool = [...act.pool, ...made.map((sym): Mana => ({ sym, source: c.id, ability: ab.index }))];
      const rest = planPlain(g, pid, cost, spell, keep2, pool) ?? planWithCosted(g, pid, cost, spell, keep2, pool, later, depth + 1);
      if (!rest || act.life + rest.life + (ab.life ?? 0) > life) continue;
      return {
        tap: [...act.tap, c.id, ...rest.tap],
        uses: [...act.uses, { id: c.id, ability: ab.index, taps: [c.id] }, ...rest.uses],
        pool: rest.pool,
        life: act.life + rest.life,
        spent: rest.spent,
        uncounterable: rest.uncounterable,
      };
    }
  }
  return null;
}

/** `planFrom` without costed mana abilities. */
function planPlain(g: Game, pid: PlayerId, cost: Cost, spell: Card | undefined, keep: string[], inPool: Mana[]): Payment | null {
  const p = g.players[pid];
  // A player can pay life only if their life total is at least that much (119.4), and not
  // at all while their life total can't change (119.8).
  const locked = lifeLocked(g, pid);
  if (cost.life > p.life || (cost.life > 0 && locked)) return null;
  // Mana with a restriction can be spent only on what it allows (106.6).
  const wants = colorWants(g, pid, spell?.id);
  const all = [...manaSources(g, pid), ...convokeSources(g, pid, spell)]
    .filter((s) => spendable(g, s, spell) && !s.taps.some((t) => keep.includes(t)))
    .map((s) => ({ ...s, keep: keepValue(s, wants) }));
  const pool = inPool.filter((m) => spendable(g, m, spell));
  const kept = inPool.filter((m) => !spendable(g, m, spell));
  // Not enough mana in total, however it's spent: skip the search.
  const most = pool.length + all.reduce((n, s) => n + s.amount, 0);
  if (most < manaCount(cost)) return null;
  const makers = (sym: HybridOption) => all.filter((s) => s.colors.includes(sym as ManaSym)).length;
  const pips = [...cost.pips].sort((a, b) => makers(a) - makers(b)).map((pip): HybridOption[] => [pip]);
  // A hybrid symbol tries first a colour already in the pool, then the colour other cards
  // want least, then the one more sources make. {2} and life stay after the colours.
  const order = (x: HybridOption, i: number) =>
    !WUBRG.includes(x as ManaSym) ? 1e6 + i : pool.some((m) => m.sym === x) ? -1e6 : (wants.get(x as ManaSym) ?? 0) * 1000 - makers(x);
  const hybrid = cost.hybrid.map((h) => h.map((x, i) => ({ x, k: order(x, i) })).sort((a, b) => a.k - b.k).map((o) => o.x));
  // Restricted mana goes first: it can pay for nothing else.
  const ordered = [...pool.filter(restricted), ...pool.filter((m) => !restricted(m))];
  const start: Plan = { pool: ordered, sources: all, uses: [], abilityLife: 0, generic: cost.generic, life: cost.life, spent: 0, uncounterable: false, wants };
  const paid = payShards([...pips, ...hybrid], start, locked ? 0 : p.life);
  if (!paid || paid.life + paid.abilityLife > p.life) return null;
  return { tap: [...new Set(paid.uses.flatMap((u) => u.taps))], uses: paid.uses, pool: [...paid.pool, ...kept], life: paid.life, spent: paid.spent, uncounterable: paid.uncounterable };
}

/** Does `spell`, cast by `pid`, have convoke (702.51a): printed, or given by a permanent like Eirdu's? */
export function hasConvoke(g: Game, pid: PlayerId, spell: Card | undefined): boolean {
  if (!spell) return false;
  return data(spell).keywords.includes('Convoke') || battlefield(g).some((src) => scriptFor(src).grantsConvoke?.(g, src, spell, pid));
}

/**
 * The creatures `pid` could tap to pay for `spell` with convoke (702.51a), as sources of one
 * mana each: one of the creature's colours, or generic. Summoning sickness doesn't matter:
 * it isn't a {T} ability (302.6).
 */
function convokeSources(g: Game, pid: PlayerId, spell: Card | undefined): Source[] {
  if (convokeChosen || !hasConvoke(g, pid, spell)) return [];
  return creaturesOf(g, pid)
    .filter((c) => !c.tapped)
    .map((c) => ({ id: c.id, ability: -1, taps: [c.id], amount: 1, colors: colorsOf(g, c) as ManaSym[], pain: 0, life: 0, busy: true, convoke: true }));
}

/** Whether `pay` looks ahead (`bestPayment`). Off while a bot tries moves out on copies of the game. */
let lookahead = true;

/** Runs `fn` with auto-pay's lookahead off, so a bot trying out moves stays fast. */
export function withoutLookahead<T>(fn: () => T): T {
  const was = lookahead;
  lookahead = false;
  try {
    return fn();
  } finally {
    lookahead = was;
  }
}

/**
 * The way to pay `cost` that leaves the most of the player's other cards in hand and
 * command zone castable afterwards, this turn. Instants and cards with flash count double.
 * Each card is checked against what it costs now (`castCost`: commander tax, cost
 * increases and reductions), with no kicker and X as 0. The candidates are the usual plan
 * and, for each card castable now, a plan that leaves alone the sources that card would
 * use. Ties go to the usual plan.
 */
function bestPayment(g: Game, pid: PlayerId, cost: Cost, spell?: Card, keep: string[] = []): Payment | null {
  const usual = planPayment(g, pid, cost, spell, keep);
  if (!usual) return null;
  const p = g.players[pid];
  const others = [...p.hand, ...p.command]
    .filter((c) => c.id !== spell?.id && !isLand(g, c) && data(c).manaCost)
    .map((c) => ({ c, cost: castCost(g, c, {}, pid), weight: isInstantSpeed(g, c) ? 2 : 1 }))
    .map((o) => ({ ...o, plan: planPayment(g, pid, o.cost, o.c) }))
    .filter((o) => o.plan);
  const most = others.reduce((n, o) => n + o.weight, 0);
  const score = (paid: Payment) => others.reduce((n, o) => n + (planFrom(g, pid, o.cost, o.c, [...keep, ...paid.tap], paid.pool) ? o.weight : 0), 0);
  let best = usual;
  let bestScore = score(usual);
  for (const o of others) {
    if (bestScore === most) break;
    const alt = planPayment(g, pid, cost, spell, [...keep, ...o.plan!.tap]);
    const s = alt ? score(alt) : -1;
    if (alt && s > bestScore) [best, bestScore] = [alt, s];
  }
  return best;
}

/**
 * Pays a cost, tapping and sacrificing what it has to. Returns how it was paid, or null if
 * it can't be. It looks ahead (`bestPayment`) unless a bot is only trying the move out.
 */
export function pay(g: Game, pid: PlayerId, cost: Cost, spell?: Card, keep: string[] = [], convoke?: string[]): Payment | null {
  // The player chose which creatures convoke (702.51a): those are tapped, and the rest paid as usual.
  const plan = convoke ? planConvoked(g, pid, cost, spell, keep, convoke) : lookahead ? bestPayment(g, pid, cost, spell, keep) : planPayment(g, pid, cost, spell, keep);
  if (!plan) return null;
  g.players[pid].pool = plan.pool;
  // Creatures that convoke are tapped as the cost is paid (702.51a, 601.2h).
  for (const u of plan.uses.filter((x) => x.convoke)) {
    const c = permanent(g, u.id)!;
    tap(g, c);
    log(g, `${says(g.players[pid], 'taps')} ${label(c)} (convoke).`, pid, [c]);
  }
  // Every ability is activated before any of them is sacrificed or deals its damage.
  const used = plan.uses.filter((x) => !x.convoke).map((u) => ({ c: permanent(g, u.id)!, ab: manaAbilities(g, permanent(g, u.id)!).find((m) => m.index === u.ability)!, creature: u.creature }));
  for (const { c, ab, creature } of used) useManaAbility(g, pid, c, { ...ab, sacrifice: false }, creature);
  const spent = used.filter((u) => u.ab.sacrifice).map((u) => u.c);
  if (spent.length) dieMany(g, spent, 'is sacrificed');
  if (plan.life) {
    subtractLife(g, pid, plan.life); // paying life is losing it (119.4)
    log(g, `${says(g.players[pid], 'pays')} ${plan.life} life.`, pid);
  }
  return plan;
}

/** An object's mana value (202.3). On the stack, X counts as the number chosen for it (202.3e). */
export function manaValue(c: Card): number {
  const d = data(c);
  const x = c.zone === 'stack' ? parseCost(d.manaCost).x * (c.cast?.x ?? 0) : 0;
  return d.cmc + x;
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

/** What `pid` could choose for target `spec` of `source`. `x`: the X announced for the activated ability choosing it (107.3a), which `spec.filter` may read. */
export function legalTargets(g: Game, pid: PlayerId, spec: TargetSpec, source: Card, x = 0): TargetRef[] {
  return settled(g, () => findTargets(g, pid, spec, source, x));
}

function findTargets(g: Game, pid: PlayerId, spec: TargetSpec, source: Card, x: number): TargetRef[] {
  const out: TargetRef[] = [];
  if (spec.type === 'spell' || spec.type === 'ability' || spec.type === 'spell or ability') {
    // A spell or ability on the stack. One can't target itself (115.5).
    for (const item of g.stack) {
      if (item.card.id === source.id && item.kind === 'spell') continue;
      if (spec.type !== 'spell or ability' && (item.kind === 'spell') !== (spec.type === 'spell')) continue;
      if (spec.who && spec.who !== 'any' && (spec.who === 'you') !== (item.controller === pid)) continue;
      if (spec.filter && !spec.filter(g, item.card, source, x)) continue;
      if (spec.item && !spec.item(g, item, source)) continue;
      out.push({ kind: 'stack', id: item.id });
    }
    return out;
  }
  const whoOk = (owner: PlayerId) =>
    !spec.who || spec.who === 'any' || (spec.who === 'you' ? owner === pid : owner !== pid);
  if (spec.type === 'graveyard card') {
    // A card in a graveyard: `who` is whose graveyard. Hexproof doesn't matter there (702.11a).
    for (const p of living(g)) {
      if (!whoOk(p.id)) continue;
      for (const c of p.graveyard) if (!spec.filter || spec.filter(g, c, source, x)) out.push({ kind: 'card', id: c.id });
    }
    return out;
  }
  const players = spec.type === 'player' || spec.type === 'any' || spec.type === 'player or planeswalker';
  // Which permanents the spec can name. "Any target" is a creature, player, planeswalker or battle (115.4).
  const fits = (c: Card) => {
    switch (spec.type) {
      case 'permanent':
        return true;
      case 'any':
        return isCreature(g, c) || isPlaneswalker(g, c) || isBattle(g, c);
      case 'creature or planeswalker':
        return isCreature(g, c) || isPlaneswalker(g, c);
      case 'player or planeswalker':
        return isPlaneswalker(g, c);
      default:
        return isCreature(g, c);
    }
  };
  for (const p of living(g)) {
    // A player with protection from everything can't be targeted (702.16j).
    if (players && whoOk(p.id) && !playerShroud(g, p.id) && !playerProtected(g, p.id)) out.push({ kind: 'player', id: p.id });
    if (spec.type === 'player' || !whoOk(p.id)) continue;
    for (const c of p.battlefield) {
      if (!fits(c)) continue;
      if (c.controller !== pid && has(g, c, 'hexproof')) continue;
      // Shroud (702.18a), and protection from what the spell or the ability's source is (702.16b).
      if (has(g, c, 'shroud') || protectedFrom(g, c, source)) continue;
      if (spec.filter && !spec.filter(g, c, source, x)) continue;
      out.push({ kind: 'card', id: c.id });
    }
  }
  return out;
}

/** Can't player `pid`'s life total change now (119.7, 119.8)? Teferi's Protection, Flare of Fortitude. */
export const lifeLocked = (g: Game, pid: PlayerId) => g.effects.some((e) => e.kind === 'lifeLocked' && e.player === pid);

/** Does player `pid` have protection from everything (702.16j)? Teferi's Protection. */
export const playerProtected = (g: Game, pid: PlayerId) => g.effects.some((e) => e.kind === 'protection' && e.player === pid);

/** Does player `pid` have shroud (702.18a), from an effect like Solitary Confinement's "You have shroud"? */
export const playerShroud = (g: Game, pid: PlayerId) => battlefield(g).some((x) => scriptFor(x).givesShroud?.(g, x, pid));

export const sameRef = (a: TargetRef, b: TargetRef) => a.kind === b.kind && a.id === b.id;

/**
 * The targets a spell has to choose as it is cast (601.2c). A modal spell's come from its
 * chosen modes, in order (700.2c). A permanent spell has none of its own: `targets`
 * belongs to its enters ability.
 */
export function spellTargets(c: Card, modes: number[] = [], gift = c.cast?.gift, alt = c.cast?.alt): TargetSpec[] {
  const script = scriptFor(c);
  // A spell cast for its overload cost has no targets: "target" became "each" (702.96b).
  if (alt !== undefined && script.alternativeCosts?.[alt]?.overload) return [];
  // An Aura spell targets what it will enchant (303.4a).
  if (script.enchant) return [script.enchant];
  // A permanent spell has no targets of its own. Off the battlefield its types are its card's: no effect changes them there.
  if (!/Instant|Sorcery/.test(data(c).typeLine)) return [];
  if (script.modal) return modes.flatMap((i) => script.modal!.modes[i]?.targets ?? []);
  // A spell whose gift was promised may have other targets (702.174m).
  if (gift !== undefined && script.gift?.targets) return script.gift.targets;
  return script.targets ?? [];
}

/** The targets a spell or ability on the stack has to choose. */
export function targetSpecs(g: Game, item: StackItem): TargetSpec[] {
  const script = scriptFor(item.card);
  if (item.kind === 'activated') return (item.ability === undefined ? activatedAt(g, item.card, item.activated) : script.loyalty?.[item.ability])?.targets ?? [];
  if (item.kind === 'triggered' && item.hook === 'onChapter') return script.chapters?.[(item.event as { chapter: number }).chapter - 1]?.targets ?? [];
  if (item.kind === 'triggered' && item.hook === 'onReflexive') return itemScript(item).reflexive?.[(item.event as { key: string }).key]?.targets ?? [];
  if (item.kind === 'triggered' && (item.hook === 'onEvoked' || item.hook === 'onOffspring')) return [];
  // A lone "enters" ability uses the card's `targets`; one in a list names its own.
  if (item.kind === 'triggered' && item.hook === 'onEnter' && !item.granted && !Array.isArray(script.onEnter)) return script.targets ?? [];
  if (item.kind === 'triggered') {
    const t = triggerOf(item);
    if (!t || typeof t === 'function') return [];
    // A modal one: the targets of the modes chosen, in printed order (700.2c).
    if (t.modes) return (item.modes ?? []).flatMap((i) => t.modes!.modes[i]?.targets ?? []);
    return t.targets ?? [];
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
  const c = permanent(g, ref.id) ?? refGraveyard(g, ref);
  return c ? label(c) : '?';
}

/** A card in a graveyard that a target names (Sevinne's Reclamation), if it is still there. */
export function refGraveyard(g: Game, ref: TargetRef | null | undefined): Card | undefined {
  if (ref?.kind !== 'card') return undefined;
  for (const p of g.players) {
    const c = p.graveyard.find((x) => x.id === ref.id);
    if (c) return c;
  }
  return undefined;
}

/** The cards among some targets (a spell or ability counts as its card), for `log`. */
export function refCards(g: Game, refs: (TargetRef | null)[]): Card[] {
  return refs.flatMap((r) => {
    const c = r?.kind === 'card' ? (permanent(g, r.id) ?? refGraveyard(g, r)) : refStack(g, r)?.card;
    return c ? [c] : [];
  });
}

/**
 * Can this spell or ability be countered? Not a spell that says it can't (113.6g), one that
 * mana said can't be (106.6, Cavern of Souls), or one a permanent protects.
 */
export const counterable = (g: Game, item: StackItem) =>
  item.kind !== 'spell' ||
  (!scriptFor(item.card).uncounterable && !item.card.cast?.uncounterable && !battlefield(g).some((p) => scriptFor(p).protectsSpell?.(g, p, item.card, item.controller)));

/**
 * Counters a spell or ability (701.6a): it leaves the stack without resolving and none of
 * its effects happen. A countered spell goes to its owner's graveyard (a copy just ceases
 * to exist), or into exile with `exile`, and nothing paid for it comes back (701.6b).
 * Returns whether it was countered.
 */
export function counter(g: Game, ref: TargetRef | null | undefined, opts: { exile?: boolean } = {}): boolean {
  const item = refStack(g, ref);
  if (!item) return false;
  if (!counterable(g, item)) {
    log(g, `${describeRef(g, ref!)} can't be countered.`, item.controller, [item.card]);
    return false;
  }
  log(g, `${describeRef(g, ref!)} is countered.`, item.controller, [item.card]);
  if (item.kind === 'spell') moveCard(g, item.card, opts.exile ? 'exile' : 'graveyard');
  else g.stack = g.stack.filter((x) => x !== item);
  return true;
}

/**
 * Copies a spell on the stack (707.10). The copy keeps every choice made for it: modes,
 * X, kicker (700.2g, 707.10). It goes on the stack the next time a player would get
 * priority, and its controller may choose new targets for it then (707.10c).
 */
export function copySpell(g: Game, ref: TargetRef | null | undefined, controller: PlayerId) {
  const item = refStack(g, ref);
  if (item?.kind === 'spell') copyItem(g, item, controller);
}

/**
 * Copies spell or ability `item`, which may already have left the stack: storm copies it as
 * it last was (702.40a). A copy copies every choice made for it: modes, targets, X, the costs
 * paid and how its damage is divided (707.10). Its controller may choose new targets (707.10c).
 */
export function copyItem(g: Game, item: StackItem, controller: PlayerId) {
  if (item.kind !== 'spell') {
    // A copy of an ability has the same source (707.10, 113.7).
    log(g, `${says(g.players[controller], 'copies')} ${label(item.card)}'s ability.`, controller, [item.card]);
    g.triggers.push({ ...item, id: `s${g.nextId++}`, controller, targets: [...item.targets], copy: true, ordered: true });
    return;
  }
  // A copy is owned by the player who controls it (707.10). It wasn't cast (707.10), so
  // nothing about how it was cast carries over but the choices made (707.2).
  // An effect that made the original uncounterable doesn't apply to the copy, a new object.
  const cast = item.card.cast && { ...item.card.cast, from: undefined, flashback: false, escaped: false, free: false, uncounterable: false };
  const card: Card = { ...snapshot(item.card), id: `c${g.nextId++}`, owner: controller, controller, isToken: true, isCommander: false, cast };
  log(g, `${says(g.players[controller], 'copies')} ${label(item.card)}.`, controller, [item.card]);
  g.triggers.push({ id: `s${g.nextId++}`, kind: 'spell', controller, card, targets: [...item.targets], copy: true, ordered: true });
  broadcast(g, 'onCopy', { card: snapshot(card), controller });
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
  assigns: 'assign',
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
  surveils: 'surveil',
  promises: 'promise',
  skips: 'skip',
  returns: 'return',
  begins: 'begin',
  gives: 'give',
  exiles: 'exile',
  adds: 'add',
  names: 'name',
  searches: 'search',
  mills: 'mill',
  reveals: 'reveal',
  takes: 'take',
  draws: 'draw',
  chooses: 'choose',
  untaps: 'untap',
  creates: 'create',
  declines: 'decline',
  has: 'have',
  looks: 'look',
  shuffles: 'shuffle',
};

/**
 * A verb as the log writes it for this player: "casts" for everyone, "cast" for the one
 * person playing alone against bots, whom the log calls "You" (`Player.you`).
 */
export const verbFor = (p: Player, verb: string) => (p.you ? (SECOND_PERSON[verb] ?? verb) : verb);

/** Subject + verb for the log: "Cinder casts", or "You cast" for `Player.you`. */
export const says = (p: Player, verb: string) => `${p.name} ${verbFor(p, verb)}`;

/** The possessive for this player in the log: "their", or "your" for `Player.you`. */
export const their = (p: Player) => (p.you ? 'your' : 'their');

/** The player's name as a possessive: "Cinder's", or "Your" for `Player.you`. */
export const whose = (p: Player) => (p.you ? 'Your' : `${p.name}'s`);

const cardNames = (cards: Card[]) => {
  const names = [...new Set(cards.map(label))];
  return names.length ? { cards: names } : {};
};

/**
 * Adds a line to the game log. `cards` are the cards the text names, for the UI to link.
 * `secret` is the line as some players see it when it names hidden cards, like the one a
 * player found searching their library (701.23e); the rest see `text`.
 */
export function log(g: Game, text: string, player?: PlayerId, cards: Card[] = [], secret?: { players: PlayerId[]; text: string; cards?: Card[] }) {
  g.log.push({
    turn: g.turn,
    text,
    player,
    ...cardNames(cards),
    ...(secret ? { private: { players: secret.players, text: secret.text, ...cardNames(secret.cards ?? []) } } : {}),
  });
  if (g.log.length > 400) g.log.splice(0, g.log.length - 400);
}

export function makeCard(g: Game, name: string, owner: PlayerId, zone: Zone, extra: Partial<Card> = {}): Card {
  const n = g.nextId++;
  return {
    id: `c${n}`,
    ts: n, // it enters its zone as it is made (613.7d)
    name,
    owner,
    zone,
    isCommander: false,
    isToken: false,
    face: 0,
    level: 1,
    once: {},
    adventure: false,
    tapped: false,
    sick: false,
    damage: 0,
    deathtouched: false,
    counters: {},
    attachedTo: null,
    loyaltyTurn: 0,
    protector: null,
    continuous: [],
    cast: null,
    mayReturn: false,
    controller: owner,
    gained: [],
    moves: 0,
    copy: null,
    faceDown: false,
    known: [],
    chosen: null,
    linked: [],
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
  const from = c.zone;
  // "If this permanent would be put into a graveyard from the battlefield, exile it instead" (122.1h).
  if (from === 'battlefield' && to === 'graveyard' && counterCount(c, 'finality') > 0) {
    log(g, `${label(c)} is exiled instead (finality counter).`, c.controller, [c]);
    to = 'exile';
  }
  // As it last was on the battlefield, for leaves-the-battlefield abilities (603.10a).
  const last = from === 'battlefield' && watchingLeaves(g) ? lastKnown(g, c) : null;
  if (last && batch && !batch.before) batch.before = battlefield(g).map(snapshot);
  const before = last && !batch ? battlefield(g).map(snapshot) : null;
  if (c.zone === 'stack') {
    g.stack = g.stack.filter((x) => x.kind !== 'spell' || x.card.id !== c.id);
  } else {
    // A permanent is on its controller's side of the battlefield; a card anywhere else is in its owner's zone.
    const from = g.players[c.zone === 'battlefield' ? c.controller : c.owner][c.zone];
    const i = from.findIndex((x) => x.id === c.id);
    if (i >= 0) from.splice(i, 1);
  }
  if (c.zone === 'battlefield') removeFromCombat(g, c.id);
  // A new object (400.7): it remembers nothing of what it was. Off the battlefield and the
  // stack, its owner controls it. Onto the battlefield, the caller set its controller.
  c.moves++;
  if (to !== 'battlefield') c.controller = c.owner;
  c.gained = [];
  c.copy = null;
  delete c.copyTs;
  c.faceDown = false;
  c.known = [];
  c.chosen = null;
  c.linked = [];
  c.tapped = false;
  c.sick = false;
  c.damage = 0;
  c.deathtouched = false;
  c.counters = {};
  c.attachedTo = null; // leaving the battlefield also unattaches it
  c.transformed = undefined;
  c.loyaltyTurn = 0; // a new object with no memory of its last one (400.7)
  c.protector = null;
  c.level = 1;
  c.once = {};
  c.adventure = false;
  c.continuous = [];
  c.counterTs = undefined;
  c.lki = undefined;
  c.plotted = undefined;
  c.airbent = undefined;
  c.warped = undefined;
  c.phasedWith = undefined;
  // A spell cast with flashback, or an aftermath half cast from a graveyard, is exiled
  // instead of going anywhere else (702.34a, 702.127a).
  if (c.zone === 'stack' && (c.cast?.flashback || c.cast?.exileOnLeave) && to !== 'exile') to = 'exile';
  // "If that spell would be put into your graveyard, exile it instead" (Emet-Selch).
  if (c.zone === 'stack' && c.cast?.graveyardToExile && to === 'graveyard') to = 'exile';
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
  c.ts = g.nextId++; // a new timestamp as it enters a zone (613.7d)
  if (c.isToken && to !== 'battlefield') {
    if (last) leaves(g, { left: [{ card: last, to }], exiled: [], before });
    return;
  }
  const zone = g.players[to === 'battlefield' ? c.controller : c.owner][to];
  zone.push(c);
  const stored = zone[zone.length - 1];
  if (to === 'graveyard') announce(g, 'onCardToGraveyard', { card: stored, player: c.owner });
  // Cards put into exile from a graveyard or the battlefield (Ketramose). Tokens aren't cards (108.2b).
  const exiled = to === 'exile' && (from === 'graveyard' || from === 'battlefield') && watchingExile(g) ? [stored] : [];
  if (last || exiled.length) leaves(g, { left: last ? [{ card: last, to }] : [], exiled, before });
}

/** Is anything listening for permanents leaving the battlefield (so `moveCard` needs to remember them)? */
const watchingLeaves = (g: Game) =>
  battlefield(g).some((x) => {
    const s = scriptFor(x);
    return s.onLeave || s.onPermanentLeaves || s.onExiled;
  });

/** Is anything listening for cards put into exile from graveyards or the battlefield? */
const watchingExile = (g: Game) => battlefield(g).some((x) => scriptFor(x).onExiled);

/** Permanents that left the battlefield, and cards exiled from graveyards or the battlefield, in one event. */
interface Leaving {
  left: { card: Card; to: Zone }[];
  exiled: Card[];
  /** The battlefield just before the event, for abilities that look back in time (603.10a). */
  before: Card[] | null;
}

/** Records what left in the event going on now, or triggers on it now if nothing else is happening with it (`simultaneously`). */
function leaves(g: Game, l: Leaving) {
  if (batch) {
    batch.left.push(...l.left);
    batch.exiled.push(...l.exiled);
    return;
  }
  fireLeaves(g, l);
}

/**
 * Triggers leaves-the-battlefield abilities (603.6c), which look back in time (603.10a): the
 * permanent's own "when this leaves", every "whenever a permanent leaves", and "whenever one or
 * more cards are put into exile" once for the whole event.
 */
function fireLeaves(g: Game, l: Leaving) {
  if (!l.left.length && !l.exiled.length) return;
  const was = lookBack;
  lookBack = l.before ?? was;
  try {
    const watchers = lookBack ?? battlefield(g);
    for (const { card, to } of l.left) {
      trigger(g, card, 'onLeave', { to });
      for (const w of watchers) if (scriptFor(w).onPermanentLeaves) trigger(g, w, 'onPermanentLeaves', { left: card, to });
    }
    if (l.exiled.length) for (const w of watchers) if (scriptFor(w).onExiled) trigger(g, w, 'onExiled', { cards: l.exiled });
  } finally {
    lookBack = was;
  }
}

/**
 * What the event going on now has done so far, when it does several things at once: cards
 * put into graveyards, damage dealt, life lost. Abilities that trigger on these trigger
 * once it is over. They don't look back in time (603.6c), so a permanent that went to a
 * graveyard in the same event doesn't see the others go. "Whenever one or more players
 * lose life" triggers once for the whole event.
 */
type Dealt = TriggerEvents['onSourceDamage'];
let batch: ({ events: [BroadcastHook, object][]; losses: { player: PlayerId; amount: number }[]; damage: Dealt[] } & Leaving) | null = null;

/** Broadcasts an event now, or once the event going on now is over (`simultaneously`). */
function announce<H extends BroadcastHook>(g: Game, hook: H, event: TriggerEvents[H]) {
  if (batch) batch.events.push([hook, event]);
  else broadcast(g, hook, event);
}

/**
 * Runs `fn` as one event that does several things at the same time, like "each opponent
 * loses 1 life" or combat damage (510.2), then triggers for what it did.
 */
export function simultaneously(g: Game, fn: () => void) {
  if (batch) return fn();
  batch = { events: [], losses: [], damage: [], left: [], exiled: [], before: null };
  try {
    fn();
  } finally {
    const done = batch;
    batch = null;
    fireLeaves(g, done);
    for (const [hook, event] of done.events) broadcast(g, hook, event as never);
    if (done.losses.length) broadcast(g, 'onLifeLossTogether', { losses: done.losses });
    for (const d of done.damage) broadcast(g, 'onSourceDamage', d);
  }
}

/**
 * Player `pid` gains control of permanent `c` (Wishclaw Talisman). It moves to their side
 * of the battlefield, leaves combat (506.4), and is summoning sick again for them (302.6).
 */
export function gainControl(g: Game, c: Card, pid: PlayerId) {
  if (c.zone !== 'battlefield' || c.controller === pid || g.players[pid].lost) return;
  const from = g.players[c.controller].battlefield;
  from.splice(from.findIndex((x) => x.id === c.id), 1);
  removeFromCombat(g, c.id);
  if (!c.gained.length) c.gained.push(c.controller);
  c.gained.push(pid);
  c.controller = pid;
  c.sick = true;
  g.players[pid].battlefield.push(c);
  log(g, `${says(g.players[pid], 'gains')} control of ${label(c)}.`, pid, [c]);
}

/**
 * Taps a permanent, for a cost, an attack or an effect. "Whenever this becomes tapped"
 * triggers only if it was untapped (City of Brass, Emmara).
 */
export function tap(g: Game, c: Card) {
  if (c.tapped) return;
  c.tapped = true;
  trigger(g, c, 'onTapped', {});
}

/** A copy of a card as it is right now, for an ability or event to remember (113.7a, 603.10a). */
export const snapshot = (c: Card): Card => ({ ...c, continuous: c.continuous.map((e) => ({ ...e })), counters: { ...c.counters } });

/**
 * A copy of permanent `c` as it last was on the battlefield (603.10a, 608.2h), with its
 * characteristics then, every effect applied, kept: they don't change with the game after it
 * leaves. Anything else is just copied.
 */
export function lastKnown(g: Game, c: Card): Card {
  const copy = snapshot(c);
  if (c.zone === 'battlefield' && !c.lki) copy.lki = characteristics(g, c);
  return copy;
}

const isCard = (v: unknown): v is Card => typeof v === 'object' && v !== null && 'zone' in v && 'owner' in v;

/**
 * Checks whether `source`'s ability triggers on an event (603.2). If it does, the ability
 * waits in `g.triggers` and goes on the stack the next time a player would get priority (603.3).
 */
export function trigger<H extends TriggerHook>(g: Game, source: Card, hook: H, event: TriggerEvents[H]) {
  const raw = scriptFor(source)[hook] as Trigger<object> | Trigger<object>[] | undefined;
  const own = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((t, i) => ({ t, extra: Array.isArray(raw) ? { trigger: i } : {} }));
  // Abilities other cards give it (613.1f), until end of turn or while they apply.
  const given = grantedTo(g, source)
    .filter((x) => x.grant.hook === hook)
    .map((x) => ({ t: x.grant.trigger as Trigger<object>, extra: { granted: { from: x.from, index: x.index } } }));
  // Each of a card's abilities for this event triggers on its own (603.2), in printed order,
  // and once more for each effect like Roaming Throne's (603.2d).
  const times = 1 + (lookBack ?? battlefield(g)).filter((x) => scriptFor(x).doublesTriggers?.(g, x, source)).length;
  for (const { t, extra } of [...own, ...given]) {
    if (typeof t !== 'function' && t.when && !t.when(g, { self: source, ...event })) continue;
    const remembered = Object.fromEntries(Object.entries(event).map(([k, v]) => [k, isCard(v) ? snapshot(v) : v]));
    for (let k = 0; k < times; k++) {
      g.triggers.push({ id: `s${g.nextId++}`, kind: 'triggered', controller: source.controller, card: { ...snapshot(source), triggeredBy: remembered }, hook, ...extra, event: remembered, targets: [] });
    }
  }
}

/**
 * The permanents on the battlefield as they were just before an event that looks back in
 * time (603.10a), while its abilities trigger, so an effect like Roaming Throne's that left
 * in the same event still applies. Null otherwise.
 */
let lookBack: Card[] | null = null;

/** The triggered abilities other cards give `c` now: from resolved effects (`LayerParts.grant`), and from permanents on the battlefield. */
function grantedTo(g: Game, c: Card): { grant: GrantedTrigger; from: string; index: number }[] {
  const out: { grant: GrantedTrigger; from: string; index: number }[] = [];
  if (c.zone !== 'battlefield') return out;
  for (const m of characteristics(g, c, '6').grants) {
    const grant = scriptOf(m.from).grants?.[m.index];
    if (grant) out.push({ grant, from: m.from, index: m.index });
  }
  for (const src of lookBack ?? battlefield(g)) {
    (scriptFor(src).grants ?? []).forEach((grant, index) => {
      if (grant.applies?.(g, src, c)) out.push({ grant, from: scriptName(src), index });
    });
  }
  return out;
}

/** The name `scriptFor(c)` finds `c`'s script under: the face that's up, or what it copies. */
export const scriptName = (c: Card): string =>
  c.copy && c.zone === 'battlefield' ? faceData(cardData(c.copy.name), 'battlefield', c.copy.face).name : cardData(c.name).faces ? faceData(cardData(c.name), c.zone, c.face).name : c.name;

/** The script a stack item's ability comes from: the card that gave it, or its source's own. */
export const itemScript = (item: StackItem): CardScript =>
  item.granted ? scriptOf(item.granted.from) : item.borrowed ? scriptOf(item.borrowed) : scriptFor(item.card);

/** The triggered ability a stack item is: its hook's ability, the one it names in the hook's list, or one another card gave its source. */
export function triggerOf(item: StackItem): Trigger<object> | undefined {
  if (item.granted) return scriptOf(item.granted.from).grants?.[item.granted.index]?.trigger as Trigger<object> | undefined;
  const raw = scriptFor(item.card)[item.hook!] as Trigger<object> | Trigger<object>[] | undefined;
  return Array.isArray(raw) ? raw[item.trigger ?? 0] : raw;
}

/**
 * Which modes of modal triggered ability `item` can be chosen now (603.3c): not one with a
 * target that has no legal choice (700.2a). Null if it isn't modal.
 */
export function triggerModeOptions(g: Game, item: StackItem): { min: number; max: number; legal: number[] } | null {
  const t = triggerOf(item);
  if (!t || typeof t === 'function' || !t.modes) return null;
  const legal = t.modes.modes.map((_, i) => i).filter((i) => (t.modes!.modes[i].targets ?? []).every((spec) => spec.optional || spec.any || legalTargets(g, item.controller, spec, item.card).length > 0));
  return { min: t.modes.min, max: t.modes.max, legal };
}

/** The text of a triggered ability that has one (for a card with several for one event), or undefined. */
export function triggerText(item: StackItem): string | undefined {
  if (item.kind !== 'triggered' || !item.hook) return undefined;
  const t = triggerOf(item);
  return t && typeof t !== 'function' ? t.text : undefined;
}

/** Offers an event to every permanent on the battlefield, and to cards with abilities that work from a graveyard. */
export function broadcast<H extends BroadcastHook>(g: Game, hook: H, event: TriggerEvents[H]) {
  // Triggering only puts abilities in `Game.triggers`, which no characteristic depends on.
  settled(g, () => {
    for (const c of battlefield(g)) trigger(g, c, hook, event);
    for (const p of g.players) for (const c of p.graveyard) if (scriptFor(c).fromGraveyard?.includes(hook)) trigger(g, c, hook, event);
  });
}

/** Damage `source` dealt: grouped with the rest it deals in the same event (`onSourceDamage`). */
function dealt(g: Game, source: Card, player: PlayerId | null, card: Card | null, amount: number, combat: boolean) {
  const record = { player, card: card && snapshot(card), amount };
  if (!batch) return broadcast(g, 'onSourceDamage', { source: snapshot(source), dealt: [record], combat });
  const same = batch.damage.find((d) => d.source.id === source.id && d.combat === combat);
  if (same) same.dealt.push(record);
  else batch.damage.push({ source: snapshot(source), dealt: [record], combat });
}

/**
 * Who protects battle `c` if its controller has the choice: for a Siege, the opponent
 * whose untapped creatures could defend it least (310.12a), or null if there is no
 * opponent. Only its controller can protect any other battle (310.9a).
 */
export function defaultProtector(g: Game, c: Card): PlayerId | null {
  if (!isSiege(g, c)) return c.controller;
  const guard = (pid: PlayerId) => creaturesOf(g, pid).filter((x) => !x.tapped).reduce((n, x) => n + Math.max(0, stats(g, x).power), 0);
  const opps = opponentsOf(g, c.controller);
  return opps.length ? opps.reduce((best, o) => (guard(o.id) < guard(best.id) ? o : best)).id : null;
}

/** Can `pid` protect battle `c`? An opponent for a Siege (310.12a), its controller for any other (310.9a). */
export const canProtect = (g: Game, c: Card, pid: PlayerId) =>
  !g.players[pid]?.lost && (isSiege(g, c) ? pid !== c.controller : pid === c.controller);

/** Sets up a permanent that was just put onto the battlefield, and triggers "enters" abilities (603.6a). */
function arrive(g: Game, c: Card, opts: EnterOpts) {
  setUp(g, c, opts);
  entered(g, c, opts);
}

/** The `Delayed.key` of warp's exile (702.185a). Its `data` names the permanent: `id` and `moves`. */
export const WARP = '@warp';

/** Sets up a permanent that was just put onto the battlefield, before anything triggers on it. */
function setUp(g: Game, c: Card, opts: EnterOpts) {
  c.sick = true;
  c.entered = g.turn;
  const tapped = scriptFor(c).entersTapped;
  c.tapped =
    !!opts.tapped ||
    (typeof tapped === 'function' ? tapped(g, c, c.controller) : !!tapped) ||
    battlefield(g).some((x) => x.id !== c.id && scriptFor(x).entersTappedFor?.(g, x, c));
  // "This enters with [counters]" (614.1c), and counters the effect putting it there gives it (Ghost Vacuum's flying counter).
  for (const [kind, n] of [...Object.entries(scriptFor(c).entersWith ?? {}), ...Object.entries(opts.counters ?? {})]) c.counters[kind] = (c.counters[kind] ?? 0) + n;
  // Warp: "exile the permanent this spell becomes at the beginning of the next end step" (702.185a).
  const alt = c.cast?.alt !== undefined ? scriptFor(c, 'stack', c.face).alternativeCosts?.[c.cast.alt] : undefined;
  if (alt?.warp) g.delayed.push({ id: `d${g.nextId++}`, controller: c.controller, card: snapshot(c), key: WARP, step: 'end', data: { id: c.id, moves: c.moves } });
  // Dash: "return the permanent this spell becomes to its owner's hand at the beginning of the next end step" (702.109a).
  if (c.cast?.dash) g.delayed.push({ id: `d${g.nextId++}`, controller: c.controller, card: snapshot(c), key: RETURN_TO_HAND, step: 'end', data: { id: c.id, moves: c.moves } });
  // A planeswalker enters with its printed loyalty (306.5b), a battle with its printed defense (310.4b).
  if (isPlaneswalker(g, c)) c.counters.loyalty = num(data(c).loyalty);
  // A Saga enters with a lore counter, which triggers chapter I (714.3a, 714.2b).
  if (isSaga(g, c) && scriptFor(c).chapters?.length) addCounters(g, c, 1, 'lore');
  if (isBattle(g, c)) {
    c.counters.defense = num(data(c).defense);
    c.protector = opts.protector !== undefined && canProtect(g, c, opts.protector) ? opts.protector : defaultProtector(g, c);
    if (c.protector !== null) log(g, `${g.players[c.protector].name} protects ${label(c)}.`, c.controller, [c]);
  }
  // What the effect putting it there says it is or has for as long as it stays (611.2a).
  if (opts.lasting) addLasting(g, c, opts.lasting);
}

/** Triggers on a permanent having entered (603.6a): its own "enters" abilities, then everything watching. */
function entered(g: Game, c: Card, opts: EnterOpts) {
  // Evoke: "When this permanent enters, if its evoke cost was paid, its controller sacrifices it" (702.74a).
  const alt = c.cast?.alt !== undefined ? scriptFor(c, 'stack', c.face).alternativeCosts?.[c.cast.alt] : undefined;
  if (alt?.evoke) g.triggers.push({ id: `s${g.nextId++}`, kind: 'triggered', controller: c.controller, card: snapshot(c), hook: 'onEvoked', event: {}, targets: [] });
  // Offspring: "When this permanent enters, if its offspring cost was paid, create a token that's a copy of it, except it's 1/1" (702.175a).
  if (c.cast?.offspring) g.triggers.push({ id: `s${g.nextId++}`, kind: 'triggered', controller: c.controller, card: snapshot(c), hook: 'onOffspring', event: {}, targets: [] });
  trigger(g, c, 'onEnter', {});
  // Entering with counters is having them put on it (122.6).
  for (const [kind, n] of [...Object.entries(scriptFor(c).entersWith ?? {}), ...Object.entries(opts.counters ?? {})]) if (n > 0) trigger(g, c, 'onCounters', { kind, n });
  if (isCreature(g, c)) broadcast(g, 'onCreatureEnters', { entered: c });
  if (isLand(g, c)) broadcast(g, 'onLandfall', { land: c });
  broadcast(g, 'onPermanentEnters', { entered: c });
  const after = opts.after;
  if (after) {
    const then = (after.script ? scriptOf(after.script) : scriptFor(after.source)).then?.[after.key];
    then?.(g, { self: after.source, you: after.you, targets: [], chooser: after.you, picked: [c], yes: true, name: '', player: null, n: 0, data: after.data ?? {} });
  }
}

/** How a card is put onto the battlefield (see `enterBattlefield`). */
export interface EnterOpts {
  tapped?: boolean;
  /** Counters it enters with because of the effect putting it there (122.6). */
  counters?: Record<string, number>;
  attachTo?: string;
  protector?: PlayerId;
  face?: number;
  /** Who it enters under the control of (110.2a). Left out, its owner. */
  controller?: PlayerId;
  /** What it enters as a copy of (707), chosen by a replacement effect. */
  copy?: CopyInfo;
  /** A choice made as it enters (614.12a), like a creature type. */
  chosen?: string;
  /** Its own replacement effect has been applied already. */
  replaced?: boolean;
  /** What the effect putting it there says it is or has for as long as it stays (611.2a): Ghost Vacuum's 1/1 Spirit, Emperor of Bones's haste. */
  lasting?: LayerParts;
  /**
   * What the effect putting it there does once it is there ("It gains haste. Sacrifice it at
   * the beginning of the next end step."): `source`'s script `then[key]` runs with the card as
   * `picked[0]`. It waits with the card for its replacement effect's choice (614.12a).
   * `script`: the card name whose `then` runs instead, for an ability one card gave another
   * (Not Dead After All's).
   */
  after?: { source: Card; key: string; you: PlayerId; data?: Record<string, unknown>; script?: string };
  /** The cards entering together it waits with (`enterTogether`). */
  group?: string;
}

/**
 * Puts a card onto the battlefield under the control of `opts.controller`, or its owner.
 * An Aura resolving as a spell enters attached to its target (`attachTo`, 303.4). `face`:
 * the face it enters with up, e.g. a modal double-faced card played as its back face
 * (712.12). If the card has a replacement effect that modifies how it enters and needs a
 * choice (614.12a), the choice is asked first, and its continuation calls `finishEnter`.
 */
export function enterBattlefield(g: Game, c: Card, opts: EnterOpts = {}) {
  const controller = opts.controller ?? c.owner;
  const script = scriptFor(c, 'battlefield', opts.face ?? (c.zone === 'stack' ? c.face : 0));
  if (script.replaceEnter && !opts.replaced && script.replaceEnter(g, c, controller)) {
    rememberEnter(g, c, { ...opts, controller });
    return;
  }
  c.controller = controller;
  moveCard(g, c, 'battlefield');
  if (opts.face !== undefined) c.face = opts.face;
  if (opts.attachTo) c.attachedTo = opts.attachTo;
  if (opts.copy) c.copy = opts.copy;
  if (opts.chosen) c.chosen = opts.chosen;
  arrive(g, c, opts);
}

/** Stores how `c` is entering in the choice its replacement effect just asked (614.12a), for `finishEnter`. */
function rememberEnter(g: Game, c: Card, opts: EnterOpts): boolean {
  const waiting = g.choices.find((x) => 'script' in x && x.script === c.id);
  if (!waiting) return false;
  const choice = waiting as { data?: Record<string, unknown> };
  choice.data = { ...(choice.data ?? {}), enter: opts };
  return true;
}

/**
 * Puts several cards onto the battlefield at the same time (Eerie Interlude, Ghost Vacuum,
 * Winds of Abandon): each is set up first, then "enters" abilities trigger, so every one of
 * them sees the others enter (603.6a). A card whose own replacement effect needs a choice as
 * it enters (614.12a) has it made first, and none of them enters until every such choice is
 * made: they wait in `Game.entering`.
 */
export function enterTogether(g: Game, entries: { card: Card; opts?: EnterOpts }[]) {
  const id = `e${g.nextId++}`;
  const ready: { id: string; moves: number; opts: EnterOpts }[] = [];
  const waiting: string[] = [];
  for (const { card: c, opts = {} } of entries) {
    if (c.zone === 'battlefield') continue;
    const controller = opts.controller ?? c.owner;
    const script = scriptFor(c, 'battlefield', opts.face ?? 0);
    if (script.replaceEnter && !opts.replaced && script.replaceEnter(g, c, controller)) {
      // Asked, it waits for the answer; dealt with at once (Mox Diamond with no land), it doesn't enter.
      if (rememberEnter(g, c, { ...opts, controller, group: id })) waiting.push(c.id);
      continue;
    }
    ready.push({ id: c.id, moves: c.moves, opts: { ...opts, controller, replaced: true } });
  }
  const group = { id, ready, waiting };
  if (!waiting.length && !askOrder(g, group)) return putTogether(g, ready);
  (g.entering ??= []).push(group);
}

type Entering = NonNullable<Game['entering']>[number];

/** The script `c` will have on the battlefield, entering as `opts` says: its own face's, or what it copies (707.2). */
function enteringScript(c: Card, opts: EnterOpts): CardScript {
  if (opts.copy) return scriptOf(faceData(cardData(opts.copy.name), 'battlefield', opts.copy.face).name);
  return scriptFor(c, 'battlefield', opts.face ?? 0);
}

/**
 * Before a group enters, each player whose permanents among it would get their timestamps at
 * the same moment chooses their relative order (613.7m). It is asked only where the order can
 * change anything: two or more of that player's permanents with static abilities, whose
 * effects then apply in that order (613.7a). A bot keeps the order listed. Returns whether
 * anything was asked: the group then waits in `Game.entering` for the answers (`orderEntering`).
 */
function askOrder(g: Game, group: Entering): boolean {
  if (group.ordered) return false;
  group.ordered = true;
  for (const pid of turnOrder(g, g.active)) {
    if (g.players[pid].isBot) continue;
    const mine = group.ready.flatMap((r) => {
      const c = findCard(g, r.id);
      const opts = r.opts as EnterOpts;
      const ok = c && c.moves === r.moves && c.zone !== 'battlefield' && (opts.controller ?? c.owner) === pid && enteringScript(c, opts).static;
      return ok ? [c] : [];
    });
    if (mine.length < 2) continue;
    queue(g, {
      kind: 'pick',
      player: pid,
      source: label(mine[0]),
      script: mine[0].id,
      cards: mine.map((c) => c.id),
      min: mine.length,
      max: mine.length,
      ordered: true,
      text: 'These enter the battlefield at the same time. Choose the order they get their timestamps in: the effects of their static abilities apply in that order, the first picked first (613.7m).',
      button: 'Done',
      then: '@timestamps',
      data: { group: group.id },
    });
    group.waiting.push(`@order${pid}`);
  }
  return group.waiting.length > 0;
}

/**
 * A player has chosen the order of their permanents in an entering group (613.7m): they take
 * that player's places in it in the order picked, and once nothing else is waited for, the
 * group enters.
 */
export function orderEntering(g: Game, groupId: string, pid: PlayerId, picked: Card[]) {
  const pending = g.entering?.find((x) => x.id === groupId);
  if (!pending || !pending.waiting.includes(`@order${pid}`)) return;
  const ids = picked.map((c) => c.id);
  const slots = pending.ready.flatMap((r, i) => (ids.includes(r.id) ? [i] : []));
  const mine = ids.flatMap((id) => pending.ready.filter((r) => r.id === id));
  slots.forEach((slot, i) => (pending.ready[slot] = mine[i]));
  pending.waiting = pending.waiting.filter((x) => x !== `@order${pid}`);
  if (pending.waiting.length) return;
  g.entering = g.entering!.filter((x) => x !== pending);
  putTogether(g, pending.ready as { id: string; moves: number; opts: EnterOpts }[]);
}

/**
 * Objects that get a timestamp at the same moment, like cards entering together, get them in
 * APNAP order (613.7m): the active player's first, then each other player's in turn order.
 * A player's own objects keep the order they are listed in, which `askOrder` lets them choose.
 */
export function timestampTogether(g: Game, cards: Card[]) {
  const order = turnOrder(g, g.active);
  const rank = (c: Card) => order.indexOf(c.controller);
  for (const c of [...cards].sort((a, b) => rank(a) - rank(b))) c.ts = g.nextId++;
}

/** The cards of a group whose choices are all made enter, together (603.6a). */
function putTogether(g: Game, ready: { id: string; moves: number; opts: EnterOpts }[]) {
  const now: { c: Card; opts: EnterOpts }[] = [];
  for (const r of ready) {
    const c = findCard(g, r.id);
    // A card that has moved meanwhile is a new object (400.7): it isn't put there.
    if (!c || c.moves !== r.moves || c.zone === 'battlefield') continue;
    const opts = r.opts;
    c.controller = opts.controller ?? c.owner;
    moveCard(g, c, 'battlefield');
    if (opts.face !== undefined) c.face = opts.face;
    if (opts.attachTo) c.attachedTo = opts.attachTo;
    if (opts.copy) c.copy = opts.copy;
    if (opts.chosen) c.chosen = opts.chosen;
    now.push({ c, opts });
  }
  timestampTogether(g, now.map((x) => x.c));
  for (const { c, opts } of now) setUp(g, c, opts);
  for (const { c, opts } of now) entered(g, c, opts);
}

/**
 * A card of an `enterTogether` group has had its replacement effect's choice answered: with
 * `opts` it enters with the others, without (it went elsewhere instead) it doesn't. Once every
 * card's choice is made, they all enter.
 */
export function settleEntering(g: Game, group: string, c: Card, opts?: EnterOpts) {
  const pending = g.entering?.find((x) => x.id === group);
  if (!pending || !pending.waiting.includes(c.id)) return;
  pending.waiting = pending.waiting.filter((x) => x !== c.id);
  if (opts) pending.ready.push({ id: c.id, moves: c.moves, opts: { ...opts, group: undefined } });
  if (pending.waiting.length || askOrder(g, pending)) return;
  g.entering = g.entering!.filter((x) => x !== pending);
  putTogether(g, pending.ready as { id: string; moves: number; opts: EnterOpts }[]);
}

/**
 * Finishes putting `c` onto the battlefield after its replacement effect's choice (614.12a).
 * `data` is the choice's data, which remembers how it was entering. `extra` is what the
 * choice decided, like a copy or a creature type.
 */
export function finishEnter(g: Game, c: Card, data: Record<string, unknown>, extra: Partial<EnterOpts> = {}) {
  const opts: EnterOpts = { ...((data.enter as EnterOpts) ?? {}), ...extra, replaced: true };
  if (opts.group) settleEntering(g, opts.group, c, opts);
  else enterBattlefield(g, c, opts);
}

/**
 * What a copy of `c` copies (707.2), with the exceptions `subtypes`, `keywords`, `activated`
 * abilities (707.9a) and a base power and toughness (707.9b). A copy of a copy copies what that copies, exceptions
 * included (707.3).
 */
export function copyOf(
  c: Card,
  extra: { subtypes?: string[]; keywords?: string[]; activated?: CopyInfo['activated']; power?: number; toughness?: number } = {},
): CopyInfo {
  const base: CopyInfo = c.copy ?? { name: c.name, face: c.zone === 'battlefield' ? c.face : 0, subtypes: [], keywords: [] };
  const activated = [...(base.activated ?? []), ...(extra.activated ?? [])];
  return {
    ...base,
    subtypes: [...base.subtypes, ...(extra.subtypes ?? [])],
    keywords: [...base.keywords, ...(extra.keywords ?? [])],
    ...(activated.length ? { activated } : {}),
    ...(extra.power !== undefined ? { power: extra.power } : {}),
    ...(extra.toughness !== undefined ? { toughness: extra.toughness } : {}),
  };
}

/** Creates a token that's a copy of permanent `c` (707.2), with these exceptions (707.9b). Returns it. */
export function tokenCopy(g: Game, pid: PlayerId, c: Card, extra: Parameters<typeof copyOf>[1] = {}): Card | undefined {
  if (g.players[pid].lost) return undefined;
  const [made] = createToken(g, pid, c.copy?.name ?? c.name, 1, { copy: copyOf(c, extra) });
  if (made) log(g, `${says(g.players[pid], 'creates')} a token copy of ${label(c)}.`, pid, [made]);
  return made;
}

/**
 * Permanent `c` becomes a copy of something while it stays on the battlefield (707.4), like
 * Likeness Looter: `copy` replaces every copiable value it had, printed or from an earlier
 * copy effect (707.2, 613.2a). The copy effect gets its timestamp now (613.7b); the permanent
 * keeps its own. It doesn't enter or leave, so nothing triggers on that, and its status,
 * counters and the other effects on it stay (707.4, 110.5). Its abilities are new ones,
 * linked only to one another (707.7): cards exiled with its old abilities and choices made
 * for them aren't theirs (607.2a, 607.2d).
 */
export function becomeCopy(g: Game, c: Card, copy: CopyInfo) {
  if (c.zone !== 'battlefield') return;
  const before = label(c);
  c.copy = copy;
  c.copyTs = g.nextId++;
  c.linked = [];
  c.chosen = null;
  log(g, `${before} becomes a copy of ${label(c)}.`, c.controller, [c]);
}

/**
 * Creates tokens (111.2). Returns them as stored in the game, so callers can change them
 * further. `copy`: what the tokens are copies of (707.2), set before they enter.
 */
export function createToken(g: Game, pid: PlayerId, key: string, count = 1, opts: { tapped?: boolean; copy?: CopyInfo | null; attachTo?: string } = {}): Card[] {
  if (g.players[pid].lost) return [];
  const out: Card[] = [];
  for (let i = 0; i < count; i++) {
    const c = makeCard(g, key, pid, 'battlefield', { isToken: true, copy: opts.copy ?? null });
    // One to be created attached to a permanent it can't enchant isn't created (303.7, as Roles' rulings say).
    if (opts.attachTo && !canEnchant(g, c, permanent(g, opts.attachTo))) continue;
    g.players[pid].battlefield.push(c);
    // Re-read through the draft so later mutations hit the stored object.
    const stored = g.players[pid].battlefield[g.players[pid].battlefield.length - 1];
    // A token created attached to something (a Role, 303.7) enters attached to it.
    if (opts.attachTo) stored.attachedTo = opts.attachTo;
    arrive(g, stored, { tapped: opts.tapped });
    out.push(stored);
  }
  return out;
}

/**
 * The cost of an activated ability: its mana with X filled in, plus any life (119.4). Tapping, sacrificing
 * and crewing are paid separately.
 */
export function abilityCost(ab: { cost: { mana?: string; life?: number; xColor?: ManaSym }; reduction?: (g: Game, self: Card) => number }, g?: Game, self?: Card, x = 0): Cost {
  const cost = parseCost(ab.cost.mana ?? '');
  cost.life += ab.cost.life ?? 0;
  // X is generic mana (107.4b), or mana of one colour if the ability says to spend only that on X.
  if (ab.cost.xColor) cost.pips.push(...Array<ManaSym>(cost.x * x).fill(ab.cost.xColor));
  else cost.generic += cost.x * x;
  cost.x = 0;
  // A reduction takes off generic mana only, never below {0} (601.2f).
  if (ab.reduction && g && self) cost.generic = Math.max(0, cost.generic - ab.reduction(g, self));
  return cost;
}

/** Returns a permanent to its owner's hand (Snapback, Chain of Vapor). */
export function bounce(g: Game, c: Card | undefined) {
  if (!c || c.zone !== 'battlefield') return;
  log(g, `${label(c)} returns to its owner's hand.`, c.owner, [c]);
  moveCard(g, c, 'hand');
}

/** Does card `c` have this name? A card with several faces has each face's name too (201.2, 709.4b). */
export function hasName(c: Card, name: string): boolean {
  const d = cardData(c.name);
  return d.name === name || !!d.faces?.some((f) => f.name === name);
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
    .filter((c) => scriptFor(c).onCreatureDies || scriptFor(c).onPlaneswalkerDies)
    .map(snapshot);
  // "Whenever a player sacrifices a permanent" looks back in time too, so a sacrificed Mayhem Devil sees itself.
  const sacrificing = verb === 'is sacrificed';
  const sacListeners = sacrificing ? battlefield(g).filter((c) => scriptFor(c).onSacrifice).map(snapshot) : [];
  const gone = sacrificing ? dying.map((x) => lastKnown(g, x)) : [];
  const dead = dying.filter((x) => isCreature(g, x)).map((x) => lastKnown(g, x));
  const walkers = dying.filter((c) => isPlaneswalker(g, c) && !isCreature(g, c)).map((x) => lastKnown(g, x));
  const before = battlefield(g).map(snapshot);
  const died = new Set<string>();
  simultaneously(g, () => {
    for (const c of dying) {
      log(g, `${label(c)} ${verb}.`, c.controller, [c]);
      moveCard(g, c, 'graveyard');
      // "Dies" means put into a graveyard from the battlefield (700.4): not exiled instead (122.1h).
      if (c.zone === 'graveyard') died.add(c.id);
    }
  });
  // Leaves-the-battlefield abilities look back in time (603.10a).
  lookBack = before;
  try {
    for (const c of dead.filter((x) => died.has(x.id))) {
      trigger(g, c, 'onDies', {});
      for (const l of listeners) trigger(g, l, 'onCreatureDies', { dead: c });
    }
    for (const c of walkers.filter((x) => died.has(x.id))) for (const l of listeners) trigger(g, l, 'onPlaneswalkerDies', { dead: c });
    // The player who sacrifices a permanent is its controller (701.21a).
    for (const c of gone) for (const l of sacListeners) trigger(g, l, 'onSacrifice', { card: c, player: c.controller });
  } finally {
    lookBack = null;
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
  // A life total that can't change doesn't, so no life is gained (119.7).
  if (lifeLocked(g, pid)) return;
  p.life += n;
  p.lifeGained = (p.lifeGained ?? 0) + n;
  log(g, `${says(p, 'gains')} ${n} life.`, pid);
  broadcast(g, 'onLifeGain', { player: pid, amount: n });
}

/**
 * Takes `n` life from a player's life total, however they lose it: damage (119.2), paying
 * life (119.4) or an effect (119.3). It counts toward the life they lost this turn, and
 * "whenever a player loses life" abilities trigger.
 */
function subtractLife(g: Game, pid: PlayerId, n: number) {
  const p = g.players[pid];
  // A life total that can't change doesn't, so no life is lost (119.8). Damage is
  // still dealt: lifelink and commander damage count it (120.3).
  if (n <= 0 || p.lost || lifeLocked(g, pid)) return;
  p.life -= n;
  p.lifeLost += n;
  announce(g, 'onLifeLoss', { player: pid, amount: n });
  if (batch) batch.losses.push({ player: pid, amount: n });
  else broadcast(g, 'onLifeLossTogether', { losses: [{ player: pid, amount: n }] });
}

/** Returns the life actually lost. */
export function loseLife(g: Game, pid: PlayerId, n: number): number {
  const p = g.players[pid];
  if (n <= 0 || p.lost || lifeLocked(g, pid)) return 0;
  subtractLife(g, pid, n);
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
    p.drawn++;
    broadcast(g, 'onDraw', { player: pid });
  }
}

/**
 * Thrown out of `applyAction` when a person must order replacement effects (616.1) partway
 * through an action. The action is applied again, from the start, once they answer: the game
 * is deterministic, so it gets back to the same point and uses the answer there.
 */
export class NeedsOrder {
  constructor(public choice: OrderDamageChoice) {}
}

/** The answers to `NeedsOrder` questions for the action being applied, in the order they come up. Null: nobody can be asked (a bot's look-ahead). */
let orderAnswers: { answers: number[]; used: number } | null = null;

/** Runs `fn` with these answers to order questions (`NeedsOrder`), or with nobody asked if null. */
export function withOrderAnswers<T>(answers: number[] | null, fn: () => T): T {
  const was = orderAnswers;
  orderAnswers = answers ? { answers, used: 0 } : null;
  try {
    return fn();
  } finally {
    orderAnswers = was;
  }
}

const orders = <T>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => orders([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest])));

/**
 * The damage `source` deals after the replacement effects that change it (614.1a): each one
 * that applies, in the order the player being dealt damage, or the permanent's controller,
 * chooses (616.1). A bot takes the least damage; a person is asked when the order matters.
 */
function changedDamage(g: Game, source: Card, to: { player?: PlayerId; card?: Card }, n: number, combat: boolean): number {
  const changes = battlefield(g).flatMap((x) => {
    const c = scriptFor(x).changesDamage?.(g, x, source, to, combat);
    return c ? [{ by: x, ...c }] : [];
  });
  if (!changes.length) return n;
  const amounts = new Map<number, string[]>();
  for (const order of orders(changes)) {
    const amount = order.reduce((m, c) => (c.times !== undefined ? m * c.times : m + (c.plus ?? 0)), n);
    if (!amounts.has(amount)) amounts.set(amount, order.map((c) => label(c.by)));
  }
  const options = [...amounts.entries()].sort((a, b) => a[0] - b[0]).map(([amount, order]) => ({ order, amount }));
  if (options.length === 1) return options[0].amount;
  const chooser = to.player ?? to.card!.controller;
  const p = g.players[chooser];
  if (p.isBot || !orderAnswers) return options[0].amount;
  const answer = orderAnswers.answers[orderAnswers.used];
  if (answer === undefined) {
    const what = to.player !== undefined ? (p.you ? 'you' : p.name) : label(to.card!);
    throw new NeedsOrder({ player: chooser, text: `${label(source)} would deal ${n} damage to ${what}. Choose the order its replacement effects apply in (616.1).`, options });
  }
  orderAnswers.used++;
  const chosen = options[answer] ?? options[0];
  log(g, `${says(p, 'applies')} ${chosen.order.join(', then ')}.`, chooser);
  return chosen.amount;
}

/** The colours protection keywords name, like "protection from white" (702.16a). */
const COLOR_NAMES: Record<Color, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
export const protectionFrom = (color: Color) => `protection from ${COLOR_NAMES[color]}`;

/** Does permanent `c` have protection from something `source` is (702.16a)? Only colours so far. */
export function protectedFrom(g: Game, c: Card, source: Card): boolean {
  const kw = stats(g, c).keywords;
  return colorsOf(g, source).some((x) => kw.has(protectionFrom(x)));
}

/**
 * Is damage `source` would deal to this player or permanent prevented (615)? By protection
 * (702.16e), or by an effect like Solitary Confinement's "Prevent all damage that would be
 * dealt to you."
 */
function prevented(g: Game, source: Card, to: { player?: PlayerId; card?: Card }): boolean {
  if (to.card && protectedFrom(g, to.card, source)) return true;
  // Protection from everything prevents all damage to the player (702.16e, 702.16j).
  if (to.player !== undefined && playerProtected(g, to.player)) return true;
  return battlefield(g).some((x) => scriptFor(x).preventsDamage?.(g, x, source, to));
}

export function damagePlayer(g: Game, source: Card, pid: PlayerId, n: number, combat = false): number {
  const p = g.players[pid];
  if (n <= 0 || p.lost) return 0;
  if (prevented(g, source, { player: pid })) {
    log(g, `Damage ${label(source)} would deal to ${p.name} is prevented.`, source.controller, [source]);
    return 0;
  }
  n = changedDamage(g, source, { player: pid }, n, combat);
  subtractLife(g, pid, n); // damage to a player makes them lose that much life (120.3a)
  log(g, `${label(source)} deals ${n} damage to ${p.name}.`, source.controller, [source]);
  // Combat damage from a commander counts toward 21, separately for each partner (903.10a, 702.124d).
  const which = combat ? commanderIndex(g, source) : -1;
  if (which >= 0) p.commanderDamage[source.owner][which] += n;
  if (has(g, source, 'lifelink')) gainLife(g, source.controller, n); // 702.15b
  if (combat && !g.combatDamaged.includes(pid)) g.combatDamaged.push(pid);
  if (combat) trigger(g, source, 'onCombatDamageToPlayer', { player: pid, amount: n });
  announce(g, 'onDamage', { source: snapshot(source), player: pid, card: null, amount: n, combat });
  dealt(g, source, pid, null, n, combat);
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
  if (counterCount(c, 'defense') > 0 || !isSiege(g, c)) return;
  log(g, `${label(c)} is defeated.`, c.controller, [c]);
  g.triggers.push({ id: `s${g.nextId++}`, kind: 'triggered', controller: c.controller, card: snapshot(c), hook: 'onDefeat', event: {}, targets: [] });
}

/** Is a Siege's defeat ability waiting or on the stack (704.5v)? */
const defeatPending = (g: Game, c: Card) => [...g.triggers, ...g.stack].some((x) => x.hook === 'onDefeat' && x.card.id === c.id);

/**
 * Damage to a permanent: a planeswalker loses that many loyalty counters (120.3c), a
 * battle that many defense counters (120.3h), and a creature has it marked (120.3e).
 */
export function damageCard(g: Game, source: Card, target: Card | undefined, n: number, combat = false, logged = false): number {
  if (!target || n <= 0 || target.zone !== 'battlefield') return 0;
  if (prevented(g, source, { card: target })) {
    log(g, `Damage ${label(source)} would deal to ${label(target)} is prevented.`, source.controller, [source, target]);
    return 0;
  }
  n = changedDamage(g, source, { card: target }, n, combat);
  if (logged) log(g, `${label(source)} deals ${n} damage to ${label(target)}.`, source.controller, [source, target]);
  if (isPlaneswalker(g, target)) removeCounters(target, n, 'loyalty');
  if (isBattle(g, target)) removeDefense(g, target, n);
  if (isCreature(g, target)) target.damage += n;
  if (has(g, source, 'deathtouch') && isCreature(g, target)) target.deathtouched = true;
  if (has(g, source, 'lifelink')) gainLife(g, source.controller, n);
  announce(g, 'onDamage', { source: snapshot(source), player: null, card: snapshot(target), amount: n, combat });
  dealt(g, source, null, target, n, combat);
  return n;
}

export function dealDamage(g: Game, source: Card, ref: TargetRef | null | undefined, n: number, combat = false): number {
  if (!ref) return 0;
  if (ref.kind === 'player') return damagePlayer(g, source, ref.id, n, combat);
  return damageCard(g, source, permanent(g, ref.id), n, combat, true);
}

/** "Gets +N/+N [and gains K] until end of turn" (611.2, 613.4c). */
export function pump(g: Game, c: Card | undefined, power: number, toughness: number, keywords: string[] = []) {
  untilEndOfTurn(g, c, { power, toughness, ...(keywords.length ? { keywords } : {}) });
}

/**
 * Prowess (702.108a): "Whenever you cast a noncreature spell, this creature gets +1/+1 until
 * end of turn." Only the permanent it triggered from gets it, if it is still there (400.7).
 */
export const prowess: NonNullable<CardScript['onCast']> = {
  when: (g, { self, card, caster }) => caster === self.controller && !isCreature(g, card),
  resolve: (g, { self }) => {
    const c = permanent(g, self.id);
    if (sameCard(c, self)) pump(g, c, 1, 1);
  },
  text: 'Prowess',
};

/**
 * Extort (702.101a): "Whenever you cast a spell, you may pay {W/B}. If you do, each opponent
 * loses 1 life and you gain life equal to the total life lost this way." Each instance
 * triggers separately (702.101b). Spread into the card's script; it brings its continuation.
 */
export const extort: Pick<CardScript, 'onCast' | 'then' | 'botChoice'> = {
  onCast: {
    when: (_g, { self, caster }) => caster === self.controller,
    resolve: (g, { you, self }) =>
      ask(g, you, {
        text: `Extort (${label(self)}): pay {W/B}? Each opponent loses 1 life and you gain that much.`,
        cost: '{W/B}',
        yes: 'Pay {W/B}',
        no: "Don't Pay",
        then: 'extorted',
      }),
    text: 'Extort',
  },
  then: {
    extorted: (g, { you, yes }) => {
      if (!yes) return;
      let lost = 0;
      simultaneously(g, () => {
        for (const o of opponentsOf(g, you)) lost += loseLife(g, o.id, 1);
      });
      gainLife(g, you, lost);
    },
  },
  // A bot pays whenever it can: a mana for a two-life swing at each opponent.
  botChoice: { extorted: () => ({ type: 'answer', yes: true }) },
};

/**
 * Job select (702.182a): "When this Equipment enters, create a 1/1 colorless Hero creature
 * token, then attach this Equipment to it."
 */
export const jobSelect: NonNullable<CardScript['onEnter']> = {
  resolve: (g, { you, self }) => {
    const [hero] = createToken(g, you, 'Hero');
    const eq = permanent(g, self.id);
    if (sameCard(eq, self)) attach(g, eq, hero);
  },
  text: 'Job select',
};

/**
 * "Do this only once each turn" (603.2h): has `pid` already taken the action of the ability
 * named `ability` this turn? The ability triggers only if they haven't, and checks again as
 * it resolves, in case another of the same was waiting.
 */
export const didThisTurn = (g: Game, pid: PlayerId, ability: string) => g.did?.[`${pid}:${ability}`] === g.turn;
/** Records that `pid` took the action of "do this only once each turn" ability `ability`. */
export function markDid(g: Game, pid: PlayerId, ability: string) {
  g.did = { ...(g.did ?? {}), [`${pid}:${ability}`]: g.turn };
}

/** Puts `n` counters of `kind` on a permanent (122). */
export function addCounters(g: Game, c: Card | undefined, n = 1, kind = '+1/+1') {
  if (!c || c.zone !== 'battlefield' || n <= 0) return;
  const before = counterCount(c, kind);
  c.counters[kind] = before + n;
  // Every counter of that kind gets the new one's timestamp (613.7c).
  c.counterTs = { ...c.counterTs, [kind]: g.nextId++ };
  // "Whenever one or more counters are put on this" (122.6), and abilities that depend on its counters (Agatha's Soul Cauldron).
  trigger(g, c, 'onCounters', { kind, n });
  // A Saga's chapter ability triggers when lore counters take it from below N to N or more (714.2b).
  if (kind !== 'lore') return;
  (scriptFor(c).chapters ?? []).forEach((_, i) => {
    const chapter = i + 1;
    if (before < chapter && before + n >= chapter) {
      g.triggers.push({ id: `s${g.nextId++}`, kind: 'triggered', controller: c.controller, card: snapshot(c), hook: 'onChapter', event: { chapter }, targets: [] });
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
export function transform(g: Game, c: Card | undefined, since?: Card) {
  const d = c && cardData(c.name);
  if (!c || !d || c.zone !== 'battlefield' || (d.layout !== 'transform' && d.layout !== 'modal_dfc')) return;
  // A permanent's own ability transforms it only if it hasn't transformed since the ability
  // was put on the stack (701.27f): `since` is the permanent as it was then.
  if (since && (c.transformed ?? 0) !== (since.transformed ?? 0)) return;
  c.transformed = (c.transformed ?? 0) + 1;
  const next = d.faces![1 - c.face];
  if (!next || /Instant|Sorcery/.test(next.typeLine)) return;
  const before = label(c);
  c.face = 1 - c.face;
  c.ts = g.nextId++; // a new timestamp as it transforms (613.7g)
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
  if (!spec || !host || host.zone !== 'battlefield' || host.id === aura.id || isCreature(g, aura)) return false;
  if (spec.type === 'creature' && !isCreature(g, host)) return false;
  if (spec.who === 'you' && host.controller !== aura.controller) return false;
  if (spec.who === 'opponent' && host.controller === aura.controller) return false;
  if (protectedFrom(g, host, aura)) return false; // 702.16c
  return spec.filter?.(g, host, aura, 0) ?? true;
}

/** Can Equipment `eq` stay attached to `host`? Only to a creature on the battlefield, and not itself (301.5c). */
export const canEquip = (g: Game, eq: Card, host: Card | undefined) =>
  // An Equipment that's also a creature can't equip a creature unless it has reconfigure (301.5c).
  !!host && host.zone === 'battlefield' && isCreature(g, host) && host.id !== eq.id && (!isCreature(g, eq) || hasReconfigure(eq)) && !protectedFrom(g, host, eq); // 702.16d

/** Attaches an Aura or Equipment to a permanent (701.3). Moving it from another permanent unattaches it from that one. */
export function attach(g: Game, att: Card | undefined, host: Card | undefined) {
  if (!att || !host || att.zone !== 'battlefield') return;
  if (isAura(g, att) ? !canEnchant(g, att, host) : !canEquip(g, att, host)) return; // an illegal attach does nothing (701.3b)
  if (att.attachedTo === host.id) return; // nor does attaching it to what it is already on (701.3b)
  att.attachedTo = host.id;
  att.ts = g.nextId++; // a new timestamp as it becomes attached (613.7e)
  log(g, `${label(att)} is attached to ${label(host)}.`, att.controller, [att, host]);
}

/** "Equip [cost]": attach to target creature you control, as a sorcery (702.6a). */
export const equip = (mana: string): ActivatedAbility => ({
  cost: { mana },
  sorcery: true,
  targets: [{ type: 'creature', who: 'you', label: 'target creature you control', filter: (_g, c, self) => c.id !== self.id && c.id !== self.attachedTo }],
  text: `Equip ${mana}`,
  resolve: (g, { self, targets }) => attach(g, permanent(g, self.id), refCard(g, targets[0])),
});

/**
 * "Reconfigure [cost]" (702.151a): "[Cost]: Attach this permanent to another target creature you
 * control. Activate only as a sorcery" and "[Cost]: Unattach this permanent. Activate only if this
 * permanent is attached to a creature and only as a sorcery." While attached it isn't a creature (702.151b).
 */
export const reconfigure = (mana: string): ActivatedAbility[] => [
  {
    cost: { mana },
    sorcery: true,
    targets: [{ type: 'creature', who: 'you', label: 'another target creature you control', filter: (_g, c, self) => c.id !== self.id && c.id !== self.attachedTo }],
    text: `Reconfigure ${mana}: attach`,
    resolve: (g, { self, targets }) => attach(g, permanent(g, self.id), refCard(g, targets[0])),
  },
  {
    cost: { mana },
    sorcery: true,
    when: (g, self) => !!self.attachedTo && !!permanent(g, self.attachedTo),
    text: `Reconfigure ${mana}: unattach`,
    resolve: (g, { self }) => {
      const c = permanent(g, self.id);
      if (!sameCard(c, self) || !c!.attachedTo) return;
      c!.attachedTo = null;
      log(g, `${label(c!)} is unattached.`, c!.controller, [c!]);
    },
  },
];

/**
 * Persist (702.79a): "When this permanent is put into a graveyard from the battlefield, if it had
 * no -1/-1 counters on it, return it to the battlefield under its owner's control with a -1/-1
 * counter on it." Given by Isilu as a granted "dies" trigger.
 */
export const persist: Trigger<object> = {
  when: (_g, { self }) => counterCount(self, '-1/-1') === 0,
  resolve: (g, { self }) => {
    const c = g.players[self.owner].graveyard.find((x) => x.id === self.id && x.moves === self.moves + 1);
    if (!c) return;
    enterBattlefield(g, c, { counters: { '-1/-1': 1 } });
  },
  text: 'Persist',
};

/** "Crew N": tap other creatures with total power N or more, and this becomes an artifact creature until end of turn (702.122a). */
export const crew = (n: number): ActivatedAbility => ({
  cost: { crew: n },
  text: `Crew ${n}`,
  resolve: (g, { self }) => {
    untilEndOfTurn(g, permanent(g, self.id), { types: ['Artifact', 'Creature'] });
  },
});

/** A static bonus for the creature this Aura or Equipment is attached to (303.4b, 301.5a). */
export const attachedBonus =
  (bonus: StaticBonus) =>
  (_g: Game, self: Card, c: Card): StaticBonus | null =>
    self.attachedTo === c.id ? bonus : null;

/** The spell or ability resolving now, if any. Choices made partway through it name it as their source. */
export const resolvingItem = (g: Game) => g.stack.find((x) => x.id === g.resolving);

/**
 * The source of the ability resolving now, if it is still the same permanent it was when
 * the ability was activated or triggered (400.7): "this artifact" means only that object.
 */
export function abilitySource(g: Game): Card | undefined {
  const item = resolvingItem(g);
  const c = item && permanent(g, item.card.id);
  return c && c.moves === item!.card.moves ? c : undefined;
}

/** Is card `c` still the same object it was when `ref` remembered it (400.7)? */
export const sameCard = (c: Card | undefined, ref: { id: string; moves: number }) => !!c && c.id === ref.id && c.moves === ref.moves;
const sourceName = (g: Game) => {
  const item = resolvingItem(g);
  return item ? label(item.card) : 'Search';
};

/** Queues a choice for a player. The engine asks it once the effect so far has been applied (608.2d). */
function queue(g: Game, choice: Choice) {
  if (!g.players[choice.player].lost) g.choices.push(choice);
}

/**
 * The player searches their library for a card that fits `find` (any card if left out),
 * and puts it onto the battlefield, into their hand or on top, then shuffles (701.23). The
 * player chooses the card, so this only queues the choice. `then` runs once it is made.
 */
export function search(
  g: Game,
  pid: PlayerId,
  to: 'battlefield' | 'hand' | 'top' | 'none',
  find?: Find,
  opts: { tapped?: boolean; reveal?: boolean; then?: string; data?: Record<string, unknown>; count?: number } = {},
) {
  queue(g, {
    kind: 'search',
    player: pid,
    source: sourceName(g),
    to,
    tapped: to === 'battlefield' && !!opts.tapped,
    find,
    reveal: opts.reveal,
    then: opts.then,
    data: opts.data,
    ...(opts.count && opts.count > 1 ? { count: opts.count } : {}),
  });
}

/**
 * A player who searched their library some way other than `search` shuffles it, and
 * "whenever a player searches their library" triggers (701.23, 701.23h): Delivery Moogle's
 * search of a library and graveyard together.
 */
export function shuffleSearched(g: Game, pid: PlayerId) {
  shuffle(g, g.players[pid].library);
  broadcast(g, 'onSearch', { player: pid });
}

/**
 * The player searches their library for a basic land (optionally of one subtype), puts it
 * onto the battlefield (tapped unless told otherwise) or into their hand, then shuffles.
 */
export function searchBasic(
  g: Game,
  pid: PlayerId,
  to: 'battlefield' | 'hand',
  opts: { tapped?: boolean; subtype?: string } = {},
) {
  const label = opts.subtype ? `a basic ${opts.subtype}` : 'a basic land';
  search(g, pid, to, { basic: true, subtypes: opts.subtype ? [opts.subtype] : undefined, label }, { tapped: to === 'battlefield' && (opts.tapped ?? true), reveal: true });
}

/** Cards that a search for `find` can find (701.23a). A search for any card finds any card. */
export function searchable(g: Game, c: Card, find?: Find): boolean {
  if (!find) return true;
  if (find.maxToughness !== undefined && stats(g, c).toughness > find.maxToughness) return false;
  const d = data(c);
  if (find.basic && !hasType(g, c, 'Basic Land')) return false;
  // "An instant card or a card with flash": a card type or a keyword, either will do.
  const typed = !!find.types?.some((x) => hasType(g, c, x));
  const keyworded = !!find.keywords?.some((k) => d.keywords.some((x) => x.toLowerCase() === k));
  if ((find.types || find.keywords) && !typed && !keyworded) return false;
  if (find.subtypes && !find.subtypes.some((x) => d.typeLine.split('—')[1]?.split(' ').includes(x))) return false;
  if (find.costs && !find.costs.includes(d.manaCost)) return false;
  return find.maxMv === undefined || d.cmc <= find.maxMv;
}

/**
 * Asks a player to pick `min` to `max` of `cards`; `then` runs with the ones picked.
 * `script`: the card whose script has the continuation, if not the resolving one's.
 */
export function pickCards(
  g: Game,
  pid: PlayerId,
  cards: Card[],
  opts: { min?: number; max?: number; text: string; button: string; then: string; data?: Record<string, unknown>; script?: string; pickable?: Card[]; ordered?: boolean },
) {
  queue(g, {
    ...(opts.ordered ? { ordered: true } : {}),
    ...(opts.pickable ? { pickable: opts.pickable.map((c) => c.id) } : {}),
    kind: 'pick',
    player: pid,
    source: opts.script ? label(findCard(g, opts.script)!) : sourceName(g),
    cards: cards.map((c) => c.id),
    min: opts.min ?? 0,
    max: opts.max ?? 1,
    text: opts.text,
    button: opts.button,
    then: opts.then,
    data: opts.data,
    ...(opts.script ? { script: opts.script } : {}),
  });
}

/** Asks a player yes or no, `then` runs with the answer. `cost` and `life` are paid to say yes (118.12). */
export function ask(g: Game, pid: PlayerId, q: Omit<AskChoice, 'kind' | 'player' | 'source'>) {
  queue(g, { kind: 'ask', player: pid, source: q.script ? label(findCard(g, q.script)!) : sourceName(g), ...q });
}

/** Asks a player to name a card (201.3), or a creature type or colour with `of`; `then` runs with the name. */
export function nameCard(g: Game, pid: PlayerId, q: Omit<NameChoice, 'kind' | 'player' | 'source'>) {
  queue(g, { kind: 'name', player: pid, source: q.script ? label(findCard(g, q.script)!) : sourceName(g), ...q });
}

/** Asks a player to choose a number from `min` to `max`, or none with `decline`; `then` runs with `ctx.n` (`yes` false for none). */
export function chooseNumber(g: Game, pid: PlayerId, q: Omit<NumberChoice, 'kind' | 'player' | 'source'>) {
  queue(g, { kind: 'number', player: pid, source: sourceName(g), ...q });
}

/** Asks a player to choose one of `options` (players); `then` runs with `ctx.player`. */
export function choosePlayer(g: Game, pid: PlayerId, q: Omit<PlayerChoice, 'kind' | 'player' | 'source'>) {
  if (q.options.length) queue(g, { kind: 'player', player: pid, source: sourceName(g), ...q });
}

/**
 * Lets a player cast `card` while the current spell resolves (608.2g), without paying its
 * mana cost if `free`. `then` runs afterwards with `yes` (it was cast) or not.
 */
export function offerCast(
  g: Game,
  pid: PlayerId,
  card: Card,
  q: { free: boolean; maxMv?: number; graveyardToExile?: boolean; text: string; then?: string; data?: Record<string, unknown> },
) {
  queue(g, { kind: 'cast', player: pid, source: sourceName(g), card: card.id, ...q });
}

/**
 * Lets a player choose new targets for spell or ability `item` (115.7d), or with `change`,
 * change its targets (115.7a). Nothing happens if it has no targets.
 */
export function offerRetarget(g: Game, pid: PlayerId, item: StackItem, change = false) {
  if (item.targets.some(Boolean)) queue(g, { kind: 'retarget', player: pid, source: sourceName(g), item: item.id, ...(change ? { change } : {}) });
}

/**
 * For changing the targets of `item` (115.7a): the other legal targets each of its targets
 * could change to, by index (none for a slot with no target). Legal as its controller would
 * choose them (115.7e); "any number of" targets stay different from each other (115.3).
 */
export function changeOptions(g: Game, item: StackItem): TargetRef[][] {
  const specs = specsFor(targetSpecs(g, item), item.targets.length);
  return specs.map((spec, i) => {
    const now = item.targets[i];
    if (!now) return [];
    const other = spec.distinctFrom === undefined ? null : item.targets[spec.distinctFrom];
    return legalTargets(g, item.controller, spec, item.card).filter(
      (t) => !sameRef(t, now) && !(other && sameRef(t, other)) && !(spec.any && item.targets.some((o, k) => k !== i && specs[k].any && o && sameRef(o, t))),
    );
  });
}

/** Can every target of `item` be changed to another legal target (115.7a)? If not, none of them is. */
export const canChangeTargets = (g: Game, item: StackItem) => {
  const options = changeOptions(g, item);
  return item.targets.some(Boolean) && item.targets.every((t, i) => !t || options[i].length > 0);
};

/** Puts a card on top of its owner's library. */
export function putOnTop(g: Game, c: Card) {
  moveCard(g, c, 'library');
  const lib = g.players[c.owner].library;
  lib.unshift(lib.pop()!);
}

/** Puts cards on the bottom of their owner's library in a random order. */
/**
 * Puts cards from `pid`'s library on its bottom "in any order": its owner arranges them
 * (401.4), so with more than one they pick the order.
 */
export function putOnBottomInAnyOrder(g: Game, pid: PlayerId, cards: Card[]) {
  if (cards.length <= 1) {
    for (const c of cards) moveCard(g, c, 'library');
    return;
  }
  queue(g, {
    kind: 'pick',
    player: pid,
    source: sourceName(g),
    cards: cards.map((c) => c.id),
    min: cards.length,
    max: cards.length,
    text: 'put these on the bottom of your library in any order',
    button: 'Put on Bottom',
    then: '@bottom',
    ordered: true,
  });
}

export function putOnBottomRandomly(g: Game, cards: Card[]) {
  const order = [...cards];
  shuffle(g, order);
  for (const c of order) moveCard(g, c, 'library');
}

/** The player mills `n` cards: the top `n` of their library go to their graveyard, or as many as there are (701.17a-b). */
export function mill(g: Game, pid: PlayerId, n: number): Card[] {
  const p = g.players[pid];
  const milled = p.library.slice(0, n);
  simultaneously(g, () => milled.forEach((c) => moveCard(g, c, 'graveyard')));
  if (milled.length) log(g, `${says(p, 'mills')} ${milled.map(label).join(', ')}.`, pid, milled);
  return milled;
}

/** The player discards a card from their hand (701.9a). "Whenever you discard" abilities trigger. */
export function discard(g: Game, c: Card) {
  if (c.zone !== 'hand') return;
  log(g, `${says(g.players[c.owner], 'discards')} ${label(c)}.`, c.owner, [c]);
  moveCard(g, c, 'graveyard');
  broadcast(g, 'onDiscard', { card: c, player: c.owner });
}

/** The player discards their hand (Lion's Eye Diamond): every card at once (701.9a). */
export function discardHand(g: Game, pid: PlayerId) {
  const hand = [...g.players[pid].hand];
  if (!hand.length) return;
  log(g, `${says(g.players[pid], 'discards')} ${their(g.players[pid])} hand: ${hand.map(label).join(', ')}.`, pid, hand);
  simultaneously(g, () => hand.forEach((c) => moveCard(g, c, 'graveyard')));
  for (const c of hand) broadcast(g, 'onDiscard', { card: c, player: pid });
}

/**
 * The player sacrifices one permanent of their choice that fits `spec` (701.21a), like
 * "each opponent sacrifices a creature of their choice". Nothing happens if they have none.
 */
export function chooseToSacrifice(g: Game, pid: PlayerId, spec: TargetSpec, source: Card) {
  const options = g.players[pid].battlefield.filter((c) => fitsSpec(g, c, spec, source));
  if (options.length) pickCards(g, pid, options, { min: 1, max: 1, text: `sacrifice ${spec.label}`, button: 'Sacrifice', then: '@sacrifice' });
}

/** The player discards `n` cards of their choice (701.9a), or their whole hand if it has fewer. */
export function chooseToDiscard(g: Game, pid: PlayerId, n: number) {
  const hand = g.players[pid].hand;
  if (!hand.length || n <= 0) return;
  const count = Math.min(n, hand.length);
  pickCards(g, pid, hand, { min: count, max: count, text: `discard ${count === 1 ? 'a card' : `${count} cards`}`, button: 'Discard', then: '@discard' });
}

/** The player creates a token that's a copy of creature token `token` (701.36a, 707.2). */
export function copyToken(g: Game, pid: PlayerId, token: Card | undefined) {
  if (!token) return;
  const [made] = createToken(g, pid, token.name, 1, { copy: token.copy ? copyOf(token) : null });
  if (made) log(g, `${says(g.players[pid], 'creates')} a copy of ${label(token)}.`, pid, [made]);
}

/**
 * The player populates (701.36a): they choose a creature token they control and create a
 * copy of it. With none, nothing happens (701.36b). When the tokens differ, the player
 * chooses, and this returns true: the continuation `then` copies `picked[0]` and does
 * whatever the spell says next. The engine's own `@populate` only copies it.
 */
export function populate(g: Game, pid: PlayerId, then = '@populate'): boolean {
  const tokens = creaturesOf(g, pid).filter((c) => c.isToken);
  if (!tokens.length) return false;
  // Tokens with the same copiable values make the same copy: no need to ask.
  const same = tokens.every((c) => c.name === tokens[0].name && JSON.stringify(c.copy) === JSON.stringify(tokens[0].copy));
  if (same) {
    copyToken(g, pid, tokens[0]);
    return false;
  }
  pickCards(g, pid, tokens, { min: 1, max: 1, text: 'populate: choose a creature token to copy', button: 'Copy', then, data: { populate: true } });
  return true;
}

/**
 * The player surveils `n` (701.25a): they look at the top `n` cards and put any number of
 * them into their graveyard, the rest back on top. With one card the order can't change.
 */
export function surveil(g: Game, pid: PlayerId, n: number, script?: string) {
  const top = g.players[pid].library.slice(0, n);
  if (!top.length) return;
  pickCards(g, pid, top, { max: top.length, text: `surveil ${n}: put any into your graveyard`, button: 'Done', then: '@surveil', ...(script ? { script } : {}) });
}

/** The player discards a card at random (701.9b). */
export function discardAtRandom(g: Game, pid: PlayerId) {
  const hand = g.players[pid].hand;
  if (hand.length) discard(g, hand[Math.floor(rand(g) * hand.length)]);
}

/** An effect says the player loses the game (104.3e). The next state-based check removes them. */
export function loseGame(g: Game, pid: PlayerId, reason: string) {
  const p = g.players[pid];
  if (!p.lost && !p.loses) p.loses = reason;
}

/** An effect says the player wins the game (104.2b). The game ends at the next state-based check. */
export function winGame(g: Game, pid: PlayerId) {
  if (!g.players[pid].lost) g.players[pid].wins = true;
}

/** An effect that lasts until end of turn (514.2). */
export const addEffect = (g: Game, e: TurnEffect) => void g.effects.push(e);

/**
 * Creates a delayed triggered ability (603.7a): at the beginning of the next `step` that
 * fits, `self`'s script `delayed[key]` goes on the stack.
 */
export function delay(g: Game, self: Card, controller: PlayerId, d: Omit<Delayed, 'id' | 'controller' | 'card'>) {
  g.delayed.push({ id: `d${g.nextId++}`, controller, card: snapshot(self), ...d });
}

/** The ward costs permanent `c` has (702.21): its own, and any others give it. Each is a separate ability (702.21). */
export function wardCosts(g: Game, c: Card): WardCost[] {
  const out: WardCost[] = [];
  const own = scriptFor(c).ward;
  if (own) out.push(own);
  for (const src of battlefield(g)) {
    const w = scriptFor(src).grantsWard?.(g, src, c);
    if (w) out.push(w);
  }
  return out;
}

/**
 * Ward triggers (702.21a): for each permanent with ward that `item` has just made its target,
 * if the permanent's controller is an opponent of the item's controller. `targets`: the
 * targets it just chose, or all of them.
 */
export function checkWard(g: Game, item: StackItem, targets: (TargetRef | null)[] = item.targets) {
  for (const t of targets) {
    const c = t?.kind === 'card' ? permanent(g, t.id) : undefined;
    // "Whenever [a permanent] becomes the target of a spell or ability" (Monk Gyatso). A permanent targeted twice by one spell becomes its target once (115.3).
    if (c && targets.findIndex((x) => x?.kind === 'card' && x.id === c.id) === targets.indexOf(t)) broadcast(g, 'onBecomesTarget', { target: c, item: item.id });
    if (!c || c.controller === item.controller) continue;
    for (const cost of wardCosts(g, c)) {
      g.triggers.push({ id: `s${g.nextId++}`, kind: 'triggered', controller: c.controller, card: snapshot(c), hook: 'onWard', event: { item: item.id, cost }, targets: [] });
    }
  }
}

/**
 * Airbends objects (701.65a): exiles them, all at once. For as long as each card stays exiled,
 * its owner may cast it for {2} rather than its mana cost. Tokens and copies of spells cease to
 * exist (111.7, 707.10a). Returns the cards exiled.
 */
export function airbend(g: Game, objects: Card[]): Card[] {
  const out: Card[] = [];
  simultaneously(g, () => {
    for (const c of objects) {
      if (c.zone !== 'battlefield' && c.zone !== 'stack') continue;
      log(g, `${label(c)} is airbent.`, c.controller, [c]);
      if (c.zone === 'stack') {
        const item = g.stack.find((x) => x.kind === 'spell' && x.card.id === c.id);
        if (item?.copy) {
          g.stack = g.stack.filter((x) => x !== item);
          continue;
        }
      }
      moveCard(g, c, 'exile');
      if (zoneOf(c) === 'exile' && !c.isToken) {
        c.airbent = true;
        out.push(c);
      }
    }
  });
  return out;
}

/**
 * Phases permanents out (702.26b): they're treated as though they don't exist until they phase in
 * during their controller's next untap step (702.26a). They stay the same objects, with their
 * counters and status (702.26d), and leave combat. Auras and Equipment attached to them phase out
 * with them, indirectly (702.26g-h), and phase in with them.
 */
export function phaseOut(g: Game, cards: Card[]) {
  const direct = cards.filter((c) => c.zone === 'battlefield' && !(c.attachedTo && cards.some((x) => x.id === c.attachedTo)));
  const out = (c: Card, host?: string) => {
    const side = g.players[c.controller].battlefield;
    const i = side.findIndex((x) => x.id === c.id);
    if (i < 0) return;
    const [stored] = side.splice(i, 1);
    removeFromCombat(g, c.id);
    if (host) stored.phasedWith = host;
    (g.players[host ? (permanentOrPhased(g, host)?.controller ?? c.controller) : c.controller].phasedOut ??= []).push(stored);
    for (const a of attachmentsOf(g, stored)) out(a, stored.id);
  };
  for (const c of direct) {
    log(g, `${label(c)} phases out.`, c.controller, [c]);
    out(c);
  }
}

/** A permanent on the battlefield or phased out, by id. */
const permanentOrPhased = (g: Game, id: string) => permanent(g, id) ?? g.players.flatMap((p) => p.phasedOut ?? []).find((x) => x.id === id);

/**
 * Player `pid`'s permanents that phased out under their control phase in, with the ones that
 * phased out indirectly with them (702.26a, 702.26g). Nothing triggers on it (702.26d).
 */
export function phaseIn(g: Game, pid: PlayerId) {
  const p = g.players[pid];
  const back = (p.phasedOut ?? []).filter((c) => !c.phasedWith);
  if (!back.length) return;
  const come = (c: Card) => {
    for (const q of g.players) {
      const i = (q.phasedOut ?? []).findIndex((x) => x.id === c.id);
      if (i >= 0) q.phasedOut!.splice(i, 1);
    }
    c.phasedWith = undefined;
    g.players[c.controller].battlefield.push(c);
    for (const q of g.players) for (const a of (q.phasedOut ?? []).filter((x) => x.phasedWith === c.id)) come(a);
  };
  for (const c of back) {
    come(c);
    log(g, `${label(c)} phases in.`, c.controller, [c]);
  }
}

/** A card's zone now: after `moveCard`, which TypeScript can't see change it. */
const zoneOf = (c: Card): Card['zone'] => c.zone;

/** Queues a reflexive triggered ability (603.12): `self`'s script `reflexive[key]` goes on the stack next, with `data`. */
export function reflexive(g: Game, self: Card, controller: PlayerId, key: string, data: Record<string, unknown> = {}) {
  g.triggers.push({ id: `s${g.nextId++}`, kind: 'triggered', controller, card: snapshot(self), hook: 'onReflexive', event: { key, data }, targets: [] });
}

/**
 * Exiles `card` with an ability of permanent `source` (607.2a): the card is linked to the
 * permanent's other abilities that refer to "cards exiled with" it, while the permanent stays
 * the same object (400.7). Returns the card as it is in exile, if it got there.
 */
export function exileLinked(g: Game, source: { id: string; moves: number }, card: Card | undefined): Card | undefined {
  if (!card || card.zone === 'exile' || card.zone === 'library') return undefined;
  log(g, `${label(card)} is exiled.`, card.owner, [card]);
  moveCard(g, card, 'exile');
  if (zoneOf(card) !== 'exile' || card.isToken) return undefined;
  const src = permanent(g, source.id);
  if (src && src.moves === source.moves) src.linked.push({ id: card.id, moves: card.moves });
  return card;
}

/** The cards exiled with permanent `source` that are still in exile (607.2a). */
export const linkedCards = (g: Game, source: Card): Card[] =>
  g.players.flatMap((p) => p.exile).filter((x) => source.linked.some((l) => sameCard(x, l)));

/** Adapt N (701.46a): if this creature has no +1/+1 counters on it, put N +1/+1 counters on it. */
export function adapt(g: Game, c: Card | undefined, n: number) {
  if (!c || c.zone !== 'battlefield' || counterCount(c) > 0) return;
  addCounters(g, c, n);
  log(g, `${label(c)} adapts ${n}.`, c.controller, [c]);
}

/**
 * The target specs for `n` targets: a list whose last spec is "any number of" (115.1d) repeats it
 * for each target past the others. Other lists are as they are.
 */
export function specsFor(specs: TargetSpec[], n: number): TargetSpec[] {
  const last = specs[specs.length - 1];
  if (!last?.any) return specs;
  const head = specs.slice(0, -1);
  return [...head, ...Array.from({ length: Math.max(0, n - head.length) }, () => last)];
}

/** The player takes an extra turn after this one (500.7). */
export function extraTurn(g: Game, pid: PlayerId, opts: { loseAtEnd?: Card } = {}) {
  if (g.players[pid].lost) return;
  g.extraTurns.push({ player: pid, loseAtEnd: opts.loseAtEnd && snapshot(opts.loseAtEnd) });
  log(g, `${says(g.players[pid], 'takes')} an extra turn after this one.`, pid);
}

// ---------- state-based actions ----------

/** Moves a commander from wherever it just went to the command zone (903.9a, 903.9b). */
export function returnCommander(g: Game, c: Card) {
  log(g, `${label(c)} goes to the command zone.`, c.owner, [c]);
  moveCard(g, c, 'command');
}

/**
 * A player leaves the game (800.4a). Everything they own leaves with them, and effects that
 * gave them control of something end: it goes back to whoever controlled it before. Their
 * spells and abilities on the stack cease to exist, and anything else they still control
 * is exiled.
 */
function eliminate(g: Game, p: Player, reason: string) {
  p.lost = true;
  log(g, `${says(p, 'is')} eliminated (${reason}).`, p.id);
  const theirs = (x: StackItem) => x.controller === p.id || x.card.owner === p.id;
  g.stack = g.stack.filter((x) => !theirs(x));
  g.triggers = g.triggers.filter((x) => !theirs(x));
  g.effects = g.effects.filter((e) => !('player' in e) || e.player !== p.id);
  for (const o of g.players) {
    if (o.id === p.id) continue;
    // Their cards in other players' zones (their permanents others control) leave the game.
    o.battlefield = o.battlefield.filter((c) => c.owner !== p.id);
    // Control they gained by an effect ends (800.4a).
    for (const c of o.battlefield) c.gained = c.gained.filter((x) => x !== p.id);
    // Their phased-out permanents leave the game too (702.26k).
    if (o.phasedOut) o.phasedOut = o.phasedOut.filter((c) => c.owner !== p.id);
  }
  // Others' permanents that phased out under their control are exiled (800.4a, 702.26n).
  for (const c of (p.phasedOut ?? []).filter((x) => x.owner !== p.id && !x.isToken)) {
    Object.assign(c, { zone: 'exile', controller: c.owner, gained: [], phasedWith: undefined, attachedTo: null });
    g.players[c.owner].exile.push(c);
    log(g, `${label(c)} is exiled.`, c.owner, [c]);
  }
  p.phasedOut = [];
  for (const c of p.battlefield.filter((x) => x.owner !== p.id)) {
    c.gained = c.gained.filter((x) => x !== p.id);
    const back = c.gained[c.gained.length - 1];
    if (back !== undefined && !g.players[back].lost) {
      c.controller = back;
      if (c.gained.length === 1) c.gained = [];
      g.players[back].battlefield.push(c);
      log(g, `${label(c)} goes back to ${g.players[back].name}.`, back, [c]);
    } else {
      c.zone = 'exile';
      c.controller = c.owner;
      c.gained = [];
      g.players[c.owner].exile.push(c);
      log(g, `${label(c)} is exiled.`, c.owner, [c]);
    }
  }
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
/** What kind of permanent each one is, for the state-based actions (704.5). */
function permanentKinds(g: Game) {
  return settled(g, () =>
    battlefield(g).map((c) => ({
      c,
      creature: isCreature(g, c),
      walker: isPlaneswalker(g, c),
      battle: isBattle(g, c),
      siege: isSiege(g, c),
      saga: isSaga(g, c),
      aura: isAura(g, c),
      legendary: hasType(g, c, 'Legendary'),
    })),
  );
}

export function checkState(g: Game) {
  for (let guard = 0; guard < 50; guard++) {
    let changed = false;
    for (const p of g.players) {
      if (p.lost) continue;
      const reason = p.loses
        ? p.loses // 104.3e
        : p.life <= 0
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
    // What each permanent is, worked out once while nothing changes, and again after a change.
    let kinds = permanentKinds(g);
    // Toughness 0 or less (704.5f) ignores indestructible; lethal and deathtouch damage (704.5g-h) destroy.
    const dying = settled(g, () =>
      kinds
        .filter((k) => k.creature)
        .map((k) => k.c)
        .filter((c) => {
          const s = stats(g, c);
          const lethal = c.damage >= s.toughness || (c.deathtouched && c.damage > 0);
          return s.toughness <= 0 || (lethal && !s.keywords.has('indestructible'));
        }),
    );
    // A planeswalker with no loyalty (704.5i) and a battle with no defense (704.5v-w) go to
    // the graveyard, except a Siege whose defeat ability hasn't resolved yet. So does a
    // battle with nobody left who can protect it (310.11).
    const spent: Card[] = [];
    for (const { c, walker, battle, siege } of kinds) {
      if (walker && loyaltyOf(c) <= 0) spent.push(c);
      else if (battle && defenseOf(c) <= 0 && !(siege && defeatPending(g, c))) spent.push(c);
      else if (battle && (c.protector === null || !canProtect(g, c, c.protector))) {
        c.protector = defaultProtector(g, c);
        if (c.protector === null) spent.push(c);
        else log(g, `${g.players[c.protector].name} protects ${label(c)}.`, c.controller, [c]);
        changed = true;
      }
    }
    if (spent.length) {
      dieMany(g, spent, "is put into its owner's graveyard");
      changed = true;
    }
    if (changed) kinds = permanentKinds(g);
    // A Saga past its final chapter is sacrificed once that chapter's ability has left the stack (714.4).
    const done = kinds
      .filter((k) => k.saga)
      .map((k) => k.c)
      .filter((c) => {
        const chapters = scriptFor(c).chapters?.length ?? 0;
        return chapters > 0 && counterCount(c, 'lore') >= chapters && !chapterPending(g, c);
      });
    if (done.length) {
      dieMany(g, done, 'is sacrificed');
      changed = true;
      kinds = permanentKinds(g);
    }
    // An Aura on something it can't enchant, or on nothing, goes to the graveyard (704.5m).
    // Equipment on something it can't equip falls off and stays (704.5n).
    const loose: Card[] = [];
    let fell = false;
    for (const { c, aura } of kinds) {
      if (aura && !canEnchant(g, c, c.attachedTo ? permanent(g, c.attachedTo) : undefined)) loose.push(c);
      else if (c.attachedTo && !aura && !canEquip(g, c, permanent(g, c.attachedTo))) {
        c.attachedTo = null;
        changed = fell = true;
      }
    }
    if (fell) kinds = permanentKinds(g);
    // Of the Roles one player controls on the same permanent, all but the one attached most
    // recently go to the graveyard (303.7a, 704.5z).
    const roles = battlefield(g).filter((c) => c.attachedTo && !loose.includes(c) && subtypesOf(g, c).includes('Role'));
    const stale = roles.filter((c) => roles.some((r) => r !== c && r.attachedTo === c.attachedTo && r.controller === c.controller && r.ts > c.ts));
    // The legend rule (704.5j): a player with two or more legendary permanents with the same
    // name keeps one of them. A bot keeps the one that is ready to use; a human chooses, unless
    // the game is already waiting on a decision, and then is asked at the next check.
    const legendary = new Set(kinds.filter((k) => k.legendary).map((k) => k.c));
    for (const p of living(g)) {
      const legends = p.battlefield.filter((c) => legendary.has(c));
      if (legends.length < 2) continue;
      const byName = new Map<string, Card[]>();
      for (const c of legends) byName.set(label(c), [...(byName.get(label(c)) ?? []), c]);
      for (const same of byName.values()) {
        if (same.length < 2) continue;
        if (p.isBot) {
          const keep = [...same].sort((a, b) => Number(a.tapped) + Number(a.sick) - (Number(b.tapped) + Number(b.sick)))[0];
          dieMany(g, same.filter((c) => c !== keep), "is put into its owner's graveyard (legend rule)");
          changed = true;
        } else if (!g.decision) {
          g.decision = { type: 'chooseCards', choice: { kind: 'legend', player: p.id, cards: same.map((c) => c.id), resume: g.priority } };
          g.priority = p.id;
        }
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
    for (const c of stale) {
      if (c.zone !== 'battlefield') continue;
      log(g, `${label(c)} is put into its owner's graveyard (a newer Role replaced it).`, c.controller, [c]);
      moveCard(g, c, 'graveyard');
      changed = true;
    }
    for (const c of loose) {
      if (c.zone !== 'battlefield') continue;
      log(g, `${label(c)} is put into its owner's graveyard (not attached to anything it can enchant).`, c.controller, [c]);
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
  // A player an effect says wins the game does, unless they also lost just now (104.2b, 104.3f).
  const winner = living(g).find((p) => p.wins);
  if (g.winner === null && winner) {
    g.winner = winner.id;
    log(g, `${says(winner, 'wins')} the game!`, winner.id);
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
