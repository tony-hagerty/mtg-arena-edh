// Bot players. Because the engine is pure, the bot evaluates most choices by simply
// trying them (`applyAction`), letting the stack resolve, and scoring the resulting
// position. Attacks and blocks use hand-written heuristics, since their outcome depends
// on what other players do next.
import {
  abilityHasX,
  canPlot,
  activatable,
  autoAssignments,
  applyAction,
  attackCandidates,
  attackOptions,
  canCast,
  castFaces,
  castableCards,
  discardOptions,
  escapeOptions,
  activationSacrificeOptions,
  activationExileOptions,
  canMulligan,
  canSayYes,
  canPlayLand,
  castTargets,
  choiceOptions,
  crewOptions,
  crewPower,
  exileOptions,
  maxAbilityX,
  maxX,
  modeChoices,
  sacrificeOptions,
  delveOptions,
  tapCostOptions,
} from './engine';
import {
  activatedAt,
  counterKinds,
  flashbackCost,
  preferredColor,
  CANT_ATTACK,
  CANT_BLOCK,
  COMMANDER_DAMAGE,
  allCreatures,
  altCostsOf,
  canBlock,
  commanderDamageFrom,
  creaturesOf,
  data,
  discardsFor,
  defenseOf,
  fight,
  isBattle,
  isCreature,
  isLand,
  isPlaneswalker,
  asSpell,
  availableMana,
  resolvingItem,
  landFaces,
  loyaltyOf,
  legalTargets,
  manaOf,
  parseCost,
  permanent,
  planPayment,
  stats,
  targetSpecs,
  abilitiesOf,
  scriptFor,
  addCosts,
  castCost,
  findCard,
  manaAbilities as manaAbilitiesOf,
  opponentsOf,
  itemScript,
  attackCost,
  canPayAttacks,
  isFree,
  escapes,
  changeOptions,
  triggerModeOptions,
  triggerOf,
  unblockedAttackers,
} from './rules';
import type { ApplyOptions, AttackOption } from './engine';
import { produce } from 'immer';
import { cardData } from '../cards/db';
import type { AbilityRef, Action, Card, CastChoices, Choice, Game, ManaSym, Player, PlayerId, StackItem, TargetRef, TargetSpec } from './types';

// ---------- position evaluation ----------

/** Rough worth of a creature on the battlefield. */
export function threat(g: Game, c: Card): number {
  const s = stats(g, c, { base: true });
  let v = Math.max(0, s.power) * 1.5 + Math.max(0, s.toughness) * 0.5;
  if (s.keywords.has('flying')) v += 1.5;
  if (s.keywords.has('deathtouch')) v += 1;
  if (s.keywords.has('lifelink')) v += 1;
  if (s.keywords.has('trample')) v += 0.5;
  if (s.keywords.has('double strike')) v += s.power;
  if (c.isCommander) v += 3;
  const script = abilitiesOf(g, c);
  if (script.static || script.onCreatureDies || script.onCast || script.onDraw || script.changesDamage) v += 1.5;
  // A creature that can't attack or block (Pacifism) is worth little.
  if (s.keywords.has(CANT_ATTACK) && s.keywords.has(CANT_BLOCK)) v *= 0.25;
  return v;
}

/**
 * The crew for Vehicle `v`, or null if crewing isn't worth it now: only before combat on
 * the bot's own turn, when the Vehicle can attack, using the summoning-sick and weakest
 * creatures first, and only if they have less power than the Vehicle brings.
 */
function crewChoice(g: Game, pid: PlayerId, v: Card, activated = 0): string[] | null {
  const need = activatedAt(g, v, activated)?.cost.crew;
  if (!need || g.active !== pid || g.step !== 'main1' || v.sick || isCreature(g, v)) return null;
  const pool = crewOptions(g, pid, v).sort((a, b) => Number(b.sick) - Number(a.sick) || threat(g, a) - threat(g, b));
  const picked: Card[] = [];
  for (const c of pool) {
    if (crewPower(g, pid, v, picked) >= need) break;
    picked.push(c);
  }
  if (crewPower(g, pid, v, picked) < need) return null;
  const awake = picked.filter((c) => !c.sick);
  const lost = crewPower(g, pid, v, awake);
  return lost < (parseInt(data(v).power ?? '0', 10) || 0) ? picked.map((c) => c.id) : null;
}

/** Rough worth of a planeswalker: more loyalty means more uses, and further from dying. */
const walkerValue = (c: Card) => 2 + loyaltyOf(c) * 0.8;

/** Rough worth of a battle to its controller: closer to defeat is better (310.12b). */
const battleValue = (c: Card) => 1 + data(c).cmc * 0.5 + (parseInt(data(c).defense ?? '0', 10) - defenseOf(c)) * 0.6;

// Each point of life matters more the less of it you have.
const lifeValue = (life: number) => 4 * Math.sqrt(Math.max(0, life));

function boardValue(g: Game, p: Player): number {
  let v = 0;
  let mana = 0;
  for (const c of p.battlefield) {
    if (isCreature(g, c)) v += threat(g, c);
    else if (isPlaneswalker(g, c)) v += walkerValue(c);
    else if (isBattle(g, c)) v += battleValue(c);
    else if (abilitiesOf(g, c).levels) v += 1 + data(c).cmc * 0.5 + (c.level - 1) * 1.5; // a Class is worth more each level
    else if (!isLand(g, c)) v += 1 + data(c).cmc * 0.5;
    mana += manaOf(g, c)?.amount ?? 0;
  }
  return v + Math.min(mana, 12) * 1.3;
}

/**
 * Cards in hand, counting an adventurer card waiting in exile as one (715.3d), and a
 * flashback card in the graveyard as half of one (702.34a).
 */
const handValue = (g: Game, p: Player) => {
  // Cards in any exile that an effect lets them cast this turn count too (Ragavan, Jeska's Will).
  const allowed = g.effects.filter((e) => e.kind === 'mayCast' && e.player === p.id).length;
  // So do their cards in exile they may cast: an Adventure, airbent, plotted or warped.
  const castable = p.exile.filter((c) => c.adventure || c.airbent || c.plotted !== undefined || c.warped !== undefined).length;
  const n = p.hand.length + castable + allowed + p.graveyard.filter((c) => flashbackCost(g, c)).length * 0.5;
  return Math.min(n, 5) + Math.max(0, n - 5) * 0.4;
};

/** Could `pid` pay `cost` once their permanents untap, with the mana they have now? */
export function canPayLater(g: Game, pid: PlayerId, cost: string): boolean {
  const later = produce(g, (d) => {
    for (const c of d.players[pid].battlefield) c.tapped = false;
    d.players[pid].pool = [];
  });
  return !!planPayment(later, pid, parseCost(cost));
}

/** Higher is better for `pid`. Opponents count half: each is only one of three enemies. */
export function evaluate(g: Game, pid: PlayerId): number {
  const me = g.players[pid];
  if (me.lost) return -1000;
  if (g.winner === pid) return 1000;
  let v = lifeValue(me.life) + boardValue(g, me) + handValue(g, me) - Math.max(...me.commanderDamage.flat()) * 0.3;
  for (const o of g.players) {
    if (o.id === pid) continue;
    if (o.lost) v += 25;
    else v -= 0.5 * (lifeValue(o.life) + boardValue(g, o) + handValue(g, o) * 0.5);
  }
  return v;
}

// ---------- trying out casts and abilities ----------

const PASS: Action = { type: 'pass' };

/** What a permanent is worth, for picking which targets to try. */
const worth = (g: Game, c: Card) => (isCreature(g, c) ? threat(g, c) : isPlaneswalker(g, c) ? walkerValue(c) : 1 + data(c).cmc * 0.5);

/**
 * The targets worth trying for one target slot, so a wide board stays cheap to look ahead
 * on, most promising first: spells and abilities, opponents, their four most valuable
 * permanents, the three graveyard cards the bot wants most, its own two most valuable
 * permanents, and itself. With `limit`, only that many.
 */
function shortlist(g: Game, pid: PlayerId, legal: TargetRef[], limit = Infinity): TargetRef[] {
  const cards = legal.filter((t) => t.kind === 'card').map((t) => ({ t, c: findCard(g, t.id as string)! }));
  const onField = cards.filter((x) => x.c.zone === 'battlefield');
  const best = (xs: typeof cards, n: number) => [...xs].sort((a, b) => worth(g, b.c) - worth(g, a.c)).slice(0, n).map((x) => x.t);
  return [
    ...legal.filter((t) => t.kind === 'stack'),
    ...legal.filter((t) => t.kind === 'player' && t.id !== pid),
    ...best(onField.filter((x) => x.c.controller !== pid), 4),
    ...cards.filter((x) => x.c.zone !== 'battlefield').sort((a, b) => cardWant(g, pid, b.c) - cardWant(g, pid, a.c)).slice(0, 3).map((x) => x.t),
    ...best(onField.filter((x) => x.c.controller === pid), 2),
    ...legal.filter((t) => t.kind === 'player' && t.id === pid),
  ].slice(0, limit);
}

/** Every way of choosing targets for `specs` (capped so wide boards stay cheap). */
function targetChoices(g: Game, pid: PlayerId, specs: TargetSpec[], source: Card, x = 0): (TargetRef | null)[][] {
  let combos: (TargetRef | null)[][] = [[]];
  for (const spec of specs) {
    // "Any number of" targets (115.1d): none, each one alone, or all of them.
    if (spec.any) {
      const legal = shortlist(g, pid, legalTargets(g, pid, spec, source, x), 4);
      // "Up to X target ...": the X most promising at most (`most`).
      const most = spec.most ? spec.most(g, source) : Infinity;
      const all = most < Infinity ? shortlist(g, pid, legalTargets(g, pid, spec, source, x), most) : legalTargets(g, pid, spec, source, x);
      const sets = [[], ...(most >= 1 ? legal.map((t) => [t]) : []), ...(all.length > 1 ? [all] : [])];
      combos = combos.flatMap((c) => sets.map((set) => [...c, ...set])).slice(0, 40);
      continue;
    }
    // With several targets to choose, fewer options each, so the combinations stay few.
    const legal: (TargetRef | null)[] = shortlist(g, pid, legalTargets(g, pid, spec, source, x), specs.length > 1 ? 4 : 6);
    if (spec.optional || legal.length === 0) legal.push(null);
    // A target that must differ from an earlier one can't repeat it (115.3).
    const fits = (c: (TargetRef | null)[], t: TargetRef | null) => {
      const other = spec.distinctFrom === undefined ? null : c[spec.distinctFrom];
      return !t || !other || t.kind !== other.kind || t.id !== other.id;
    };
    combos = combos.flatMap((c) => legal.filter((t) => fits(c, t)).map((t) => [...c, t])).slice(0, 40);
  }
  return combos;
}

/**
 * Counter kinds that are bad for whoever has them: more of them helps only against an
 * opponent. Every other kind is taken to be good for its permanent's controller or its player.
 */
const HARMFUL_COUNTERS = ['-1/-1', 'stun', 'poison', 'rad', 'defense', 'time', 'finality'];
const counterGain = (kinds: string[], mine: boolean) => kinds.reduce((n, k) => n + (HARMFUL_COUNTERS.includes(k) === mine ? -1 : 1), 0);

/** What a bot chooses as it proliferates (701.34a): each permanent and player that comes out better for it. */
function proliferateChoice(g: Game, pid: PlayerId, cards: Card[], players: PlayerId[]): Action {
  return {
    type: 'chooseCards',
    cards: cards.filter((c) => counterGain(counterKinds(c.counters), c.controller === pid) > 0).map((c) => c.id),
    players: players.filter((x) => counterGain(counterKinds(g.players[x].counters), x === pid) > 0),
  };
}

/** What a creature loses as it gets `n` -1/-1 counters (701.68a): all it is worth if that kills it. */
function blightLoss(g: Game, c: Card, n: number): number {
  const s = stats(g, c);
  return s.toughness <= n && !s.keywords.has('indestructible') ? worth(g, c) + 1 : (worth(g, c) * n) / Math.max(1, s.toughness + 1);
}

/** What a permanent is worth to sacrifice: less is a better sacrifice. */
const sacrificeWorth = (g: Game, c: Card) => (isCreature(g, c) ? threat(g, c) : c.isToken ? 0.5 : 1 + data(c).cmc * 0.5);

/**
 * Values of X worth paying in life (Toxic Deluge): each creature's toughness, the three
 * biggest at most, so the look-ahead sees what each X does. Never all of the bot's life.
 */
function lifeXChoices(g: Game, pid: PlayerId, most: number): number[] {
  const cap = Math.min(most, g.players[pid].life - 1);
  const xs = [...new Set(allCreatures(g).map((c) => stats(g, c).toughness))].filter((x) => x > 0 && x <= cap).sort((a, b) => b - a);
  return xs.slice(0, 3);
}

/**
 * A few sensible ways to cast `c` (601.2b), for the look-ahead to compare: every set of
 * modes it allows (700.2), each available cost (mana cost, alternative cost, flashback or
 * escape), X as high as it can pay and about half that, kicked as many times as it can pay
 * or not at all, the least valuable permanents to sacrifice (or none, for bargain), and a
 * gift promised to each opponent or to none.
 */
function castChoices(g: Game, pid: PlayerId, c: Card): CastChoices[] {
  const out: CastChoices[] = [];
  // Each face it can be cast as: a split card's halves, an Adventure, a modal card's faces.
  for (const face of castFaces(c)) {
    const script = scriptFor(asSpell(c, face));
    const cheapest = (cards: Card[]) => [...cards].sort((a, b) => sacrificeWorth(g, a) - sacrificeWorth(g, b));
    // How the cost is paid: the mana cost or an alternative cost, with what it exiles or sacrifices.
    const ways: CastChoices[] = [];
    if (c.zone === 'graveyard') {
      ways.push({}); // flashback
      // Escape exiles the other cards the bot wants least, as many as each escape ability asks (702.138a).
      const others = escapeOptions(g, c).sort((a, b) => cardWant(g, pid, a) - cardWant(g, pid, b));
      for (const e of escapes(g, c)) if (others.length >= e.exile) ways.push({ escape: others.slice(0, e.exile).map((x) => x.id) });
    } else {
      for (const alt of [undefined, ...altCostsOf(g, c, face, pid)]) {
        // An alternative cost that exiles a card from the hand gives up the one the bot wants least.
        const pitch = alt === undefined ? [] : exileOptions(g, pid, c, face, alt).sort((a, b) => cardWant(g, pid, a) - cardWant(g, pid, b));
        const altSac = alt === undefined ? [] : cheapest(sacrificeOptions(g, pid, c, face, alt));
        ways.push({ alt, ...(pitch.length ? { exile: [pitch[0].id] } : {}), ...(altSac.length ? { sacrifice: [altSac[0].id] } : {}) });
      }
    }
    // The additional cost's sacrifice: the least valuable, or none if it is optional (bargain).
    const extra = script.additionalCost?.sacrifice
      ? [...(script.additionalCost.optional ? [undefined] : []), ...cheapest(sacrificeOptions(g, pid, c, face)).slice(0, 1).map((x) => x.id)]
      : [undefined];
    // "Discard a card": the ones the bot wants least, for the additional cost it chose.
    const discardFor = (extra?: number) => {
      const n = discardsFor(script, extra);
      return n ? discardOptions(g, pid, c).sort((a, b) => cardWant(g, pid, a) - cardWant(g, pid, b)).slice(0, n).map((x) => x.id) : undefined;
    };
    const lifeX = script.additionalCost?.life === 'x';
    const gifts = script.gift ? [undefined, ...opponentsOf(g, pid).map((o) => o.id)] : [undefined];
    const modeSets = script.modal ? modeChoices(g, pid, c, face) : [undefined];
    // "Pay 5 life or pay {2}": each of the additional costs it offers.
    const extraCosts: (number | undefined)[] = script.additionalCost?.oneOf ? script.additionalCost.oneOf.map((_, i) => i) : [undefined];
    const paths = ways.flatMap((w) => extraCosts.map((e): CastChoices => ({ ...w, ...(e !== undefined ? { extra: e } : {}) })));
    for (const modes of modeSets) {
      for (const way of paths) {
        for (const add of extra) {
          if (add && way.sacrifice?.includes(add)) continue;
          const sacrifice = [...(way.sacrifice ?? []), ...(add ? [add] : [])];
          const discard = discardFor(way.extra);
          const base: CastChoices = { ...way, sacrifice: sacrifice.length ? sacrifice : undefined, ...(discard ? { discard } : {}), modes, ...(face ? { face } : {}) };
          // Delve (702.66a): exiles the cards the bot wants least, as many as the generic mana they can pay for.
          if (data(asSpell(c, face)).keywords.includes('Delve')) {
            const generic = castCost(g, c, base, pid).generic;
            const fodder = delveOptions(g, pid, c)
              .filter((x) => !way.escape?.includes(x.id))
              .sort((a, b) => cardWant(g, pid, a) - cardWant(g, pid, b))
              .slice(0, generic);
            if (fodder.length) base.delve = fodder.map((x) => x.id);
          }
          for (const gift of gifts) {
            const kicks = [0];
            if (script.kicker) {
              let k = 0;
              while (k < (script.kicker.multi ? 10 : 1) && canCast(g, pid, c, { ...base, gift, kicked: k + 1 })) k++;
              if (k) kicks.push(k);
            }
            // Offspring (702.175a): with and without paying it, when it can be paid.
            const offsprings = script.offspring && canCast(g, pid, c, { ...base, gift, offspring: true }) ? [false, true] : [false];
            for (const kicked of kicks)
              for (const offspring of offsprings) {
                const most = maxX(g, pid, c, { ...base, gift, kicked, offspring });
                // X damage divided among targets: X follows from the targets (`divisions`).
                const xs = script.divide === 'x' ? [0] : lifeX ? lifeXChoices(g, pid, most) : [most, Math.floor(most / 2)];
                for (const x of new Set(xs)) {
                  const choices: CastChoices = { ...base, x, kicked, ...(gift !== undefined ? { gift } : {}), ...(offspring ? { offspring } : {}) };
                  if (x >= 0 && canCast(g, pid, c, choices)) out.push(choices);
                }
              }
          }
        }
      }
    }
  }
  return out;
}

/**
 * Ways to cast a spell that divides damage among its targets (601.2d): at opponents' most
 * valuable creatures and planeswalkers, each given just enough to destroy it. For X damage,
 * X is what that adds up to (a few targets at most, never all of the bot's life); for a set
 * amount, what is left over goes to the first target.
 */
function divisions(g: Game, pid: PlayerId, c: Card, choices: CastChoices, specs: TargetSpec[]): { targets: TargetRef[]; divide: number[]; x?: number }[] {
  const spell = asSpell(c, choices.face ?? 0, pid);
  const total = scriptFor(spell).divide!;
  const spec = specs[specs.length - 1];
  if (!spec) return [];
  const lethal = (x: Card) => (isPlaneswalker(g, x) && !isCreature(g, x) ? loyaltyOf(x) : Math.max(1, stats(g, x).toughness - x.damage));
  const foes = legalTargets(g, pid, spec, spell)
    .filter((t) => t.kind === 'card')
    .map((t) => findCard(g, t.id as string)!)
    .filter((x) => x.controller !== pid)
    .sort((a, b) => worth(g, b) - worth(g, a))
    .slice(0, spec.any ? 4 : specs.length);
  const out: { targets: TargetRef[]; divide: number[]; x?: number }[] = [];
  for (let k = 1; k <= foes.length; k++) {
    const picked = foes.slice(0, k);
    const divide = picked.map(lethal);
    const sum = divide.reduce((a, b) => a + b, 0);
    if (total === 'x') {
      if (!canCast(g, pid, c, { ...choices, x: sum }) || sum >= g.players[pid].life) break;
      out.push({ targets: picked.map((x) => ({ kind: 'card', id: x.id })), divide, x: sum });
    } else {
      if (k > total) break;
      // Short of killing them all, each still gets at least 1 (601.2d).
      const fair = sum > total ? picked.map((_, i) => (i === 0 ? total - (k - 1) : 1)) : divide.map((n, i) => (i === 0 ? n + total - sum : n));
      out.push({ targets: picked.map((x) => ({ kind: 'card', id: x.id })), divide: fair });
    }
  }
  return out;
}

function candidateActions(g: Game, pid: PlayerId): { action: Action; spendsCard: boolean }[] {
  const p = g.players[pid];
  const out: { action: Action; spendsCard: boolean }[] = [];
  // Cards in a graveyard (flashback, escape) or exile (an Adventure, or an effect's permission) can be cast too.
  for (const c of castableCards(g, pid)) {
    const script = scriptFor(c);
    // Cards with their own rule for when to cast them are left to it.
    if (!canCast(g, pid, c) || script.botCast?.(g, pid, c) === false || script.ai === 'extraTurn' || script.ai === 'ritual') continue;
    // About 36 ways per card at most, shared out among its ways of casting it (a modal spell's mode sets).
    const ways = castChoices(g, pid, c);
    const each = Math.max(4, Math.floor(36 / Math.max(1, ways.length)));
    for (const choices of ways) {
      const specs = castTargets(c, choices.modes, choices.face, choices.gift, choices.alt);
      if (scriptFor(asSpell(c, choices.face ?? 0)).divide !== undefined) {
        for (const d of divisions(g, pid, c, choices, specs)) out.push({ action: { type: 'cast', card: c.id, ...choices, ...d }, spendsCard: c.zone === 'hand' || c.zone === 'command' });
        continue;
      }
      for (const targets of targetChoices(g, pid, specs, c).slice(0, each)) {
        out.push({ action: { type: 'cast', card: c.id, targets, ...choices }, spendsCard: c.zone === 'hand' || c.zone === 'command' });
      }
    }
  }
  // Plotting a card to cast it free on a later turn (702.170a).
  for (const c of p.hand) if (canPlot(g, pid, c)) out.push({ action: { type: 'plot', card: c.id }, spendsCard: true });
  // Abilities of permanents, and of cards in the hand (channel) or command zone (commander ninjutsu) that work from there.
  for (const c of [...p.battlefield, ...p.hand, ...p.command]) {
    for (const ref of activatable(g, pid, c)) {
      const script = scriptFor(c);
      // An ability with its own rule for when to use it is left to that rule.
      if (ref.ability === undefined && script.botActivate) continue;
      out.push(...activations(g, pid, c, ref).map((action) => ({ action, spendsCard: c.zone === 'hand' || c.zone === 'command' })));
    }
  }
  return out;
}

/**
 * The values of X the bot tries for an ability with X in its cost (107.3a): every one from 1
 * up to the most it can pay that gives the ability its targets ("with mana value X"), or six
 * spread over those when there are more. X = 0 is left out: it pays nothing and does nothing.
 */
function xChoices(g: Game, pid: PlayerId, c: Card, ref: AbilityRef, specs: TargetSpec[]): (number | undefined)[] {
  if (!abilityHasX(g, c, ref)) return [undefined];
  const most = maxAbilityX(g, pid, c, ref);
  const xs = Array.from({ length: Math.max(0, most) }, (_, i) => i + 1).filter((x) =>
    specs.every((spec) => spec.optional || spec.any || legalTargets(g, pid, spec, c, x).length > 0),
  );
  if (xs.length <= 6) return xs;
  return [...new Set(Array.from({ length: 6 }, (_, i) => xs[Math.round((xs.length * (i + 1)) / 6) - 1]))];
}

/** The ways the bot considers activating ability `ref` of `c`: each X and set of targets, discarding the card it wants least. */
function activations(g: Game, pid: PlayerId, c: Card, ref: AbilityRef): Action[] {
  const { ability, activated } = ref;
  // One of its activated abilities, a loyalty ability, or a Class level bar (which has no targets).
  const ab = ability === undefined ? activatedAt(g, c, activated) : undefined;
  const specs = (ab ? ab.targets : abilitiesOf(g, c).loyalty?.[ability!].targets) ?? [];
  // "Tap three untapped Elves you control": the ones that have done their work this turn first, then the weakest.
  const tapping = ab?.cost.tapUntapped;
  const tapped = tapping
    ? [...tapCostOptions(g, pid, c, activated)]
        .filter((x) => !ab.cost.tap || x.id !== c.id)
        .sort((a, b) => Number(!!g.players[pid].attackedWith?.includes(b.id)) - Number(!!g.players[pid].attackedWith?.includes(a.id)) || Number(b.sick) - Number(a.sick) || worth(g, a) - worth(g, b))
        .slice(0, tapping.n)
        .map((x) => x.id)
    : undefined;
  const crew = ab?.cost.crew ? crewChoice(g, pid, c, activated) : tapped;
  if (crew === null) return [];
  const n = ab?.cost.discard ?? 0;
  const discard = n ? [...discardOptions(g, pid, c, ab?.cost.discardFilter)].sort((a, b) => cardWant(g, pid, a) - cardWant(g, pid, b)).slice(0, n).map((x) => x.id) : undefined;
  // "Sacrifice a creature": the least valuable ones, and not the source itself if there are others.
  const fodder = ab?.cost.sacrificeOne ? [...activationSacrificeOptions(g, pid, c, activated)].sort((a, b) => Number(a.id === c.id) - Number(b.id === c.id) || sacrificeWorth(g, a) - sacrificeWorth(g, b)) : [];
  const victims = fodder.slice(0, ab?.cost.sacrificeCount ?? 1);
  // "Exile a creature you control": the least valuable one, not the source if there is another.
  const exilable = ab?.cost.exileOne ? [...activationExileOptions(g, pid, c, activated)].sort((a, b) => sacrificeWorth(g, a) - sacrificeWorth(g, b)) : [];
  const exiled = exilable.find((x) => x.id !== c.id) ?? exilable[0];
  // "Exile two cards from your graveyard": the ones the bot wants least.
  const k = ab?.cost.exileGraveyard ?? 0;
  const graveyard = k ? [...g.players[pid].graveyard].sort((a, b) => cardWant(g, pid, a) - cardWant(g, pid, b)).slice(0, k).map((x) => x.id) : undefined;
  // Ninjutsu (702.49a): return the unblocked attacker worth least.
  const returned = ab?.cost.returnAttacker ? [...unblockedAttackers(g, pid)].sort((a, b) => sacrificeWorth(g, a) - sacrificeWorth(g, b))[0] : undefined;
  if (ab?.cost.returnAttacker && !returned) return [];
  return xChoices(g, pid, c, ref, specs).flatMap((x) =>
    targetChoices(g, pid, specs, c, x).map((targets): Action => ({
      type: 'activate',
      card: c.id,
      ability,
      ...(activated ? { activated } : {}),
      ...(x !== undefined ? { x } : {}),
      targets,
      crew,
      ...(discard ? { discard } : {}),
      ...(victims.length ? { sacrifice: victims.map((x) => x.id) } : {}),
      ...(exiled ? { exile: [exiled.id] } : {}),
      ...(graveyard ? { graveyard } : {}),
      ...(returned ? { returnAttacker: returned.id } : {}),
    })),
  );
}

// Look-ahead turns auto-pass off, so that passing only ever resolves the stack or ends one
// step. Positions being compared then always stop at the same point in the turn.
// `simulate`: a move only tried out, so auto-pay skips its lookahead (see `pay`).
const STEP_BY_STEP = { autoPass: false, simulate: true } as const;

/**
 * A quick answer to a decision that comes up while the stack resolves: the first legal
 * targets, a bot's card choice, the order triggers went on in, or a commander sent home.
 */
/** The modes a bot chooses for a modal triggered ability (603.3c): its card's own rule, else the first it can. */
function modesFor(g: Game, item: StackItem): Action {
  const modal = triggerModeOptions(g, item);
  if (!modal) return PASS;
  const t = triggerOf(item);
  const wanted = (t && typeof t !== 'function' && t.modes?.bot?.(g, item.controller, item.card)) || [];
  const modes = wanted.filter((i) => modal.legal.includes(i)).slice(0, modal.max);
  return { type: 'chooseModes', modes: modes.length >= modal.min ? modes : modal.legal.slice(0, modal.min) };
}

function anyTargets(g: Game): Action {
  if (g.decision?.type === 'chooseCards') return cardChoice(g, g.priority);
  if (g.decision?.type === 'ask' || g.decision?.type === 'name' || g.decision?.type === 'player' || g.decision?.type === 'number') return choiceAnswer(g, g.priority);
  if (g.decision?.type === 'cast') return castNow(g, g.priority, true);
  if (g.decision?.type === 'retarget') {
    const { choice } = g.decision;
    const item = g.stack.find((x) => x.id === choice.item);
    // Changing targets (115.7a): the first other legal target for each.
    if (item && choice.change) {
      const options = changeOptions(g, item);
      return { type: 'chooseTargets', targets: item.targets.map((t, i) => (t ? (options[i][0] ?? t) : null)) };
    }
    return { type: 'chooseTargets', targets: item?.targets ?? [] };
  }
  if (g.decision?.type === 'orderTriggers') return defaultOrder(g, g.priority);
  if (g.decision?.type === 'triggerModes') return modesFor(g, g.decision.item);
  if (g.decision?.type === 'commanderZone') return { type: 'commanderZone', toCommand: true };
  if (g.decision?.type === 'assignDamage') return { type: 'assignDamage', assignments: autoAssignments(g) };
  if (g.decision?.type !== 'targets') return PASS;
  const { item } = g.decision;
  // An opponent or something of theirs if there is one: most triggered abilities that target harm.
  const mine = (t: TargetRef) => (t.kind === 'player' ? t.id === g.priority : t.kind === 'card' && findCard(g, t.id)?.controller === g.priority);
  // "Any number of" targets: none, here.
  const targets = targetSpecs(g, item).filter((spec) => !spec.any).map((spec) => {
    if (spec.optional) return null;
    const legal = legalTargets(g, g.priority, spec, item.card, item.x);
    return legal.find((t) => !mine(t)) ?? legal[0] ?? null;
  });
  return { type: 'chooseTargets', targets };
}

/**
 * The targets for a waiting triggered ability that leave `pid` best off, or the new targets
 * for a spell or ability they may retarget (115.7d): its own targets are one of the options.
 */
function bestTargets(g: Game, pid: PlayerId, depth = 0): Action {
  const d = g.decision;
  const item = d?.type === 'targets' ? d.item : d?.type === 'retarget' ? g.stack.find((x) => x.id === d.choice.item) : undefined;
  if (!item) return anyTargets(g);
  let best = anyTargets(g);
  let bestScore = -Infinity;
  // New targets are legal for the item's controller (115.7d).
  let options = targetChoices(g, d?.type === 'retarget' ? item.controller : pid, targetSpecs(g, item), item.card, item.x);
  if (d?.type === 'retarget') {
    // Changing targets (115.7a): every target becomes another one. Choosing new ones (115.7d): keeping them is an option.
    if (d.choice.change) {
      const change = changeOptions(g, item);
      options = [
        ...options.filter((o) => item.targets.every((t, i) => !t || change[i].some((x) => o[i] && x.kind === o[i]!.kind && x.id === o[i]!.id))),
        // Each other target alone, for a single one, so a wide board can't leave it out.
        ...(item.targets.length === 1 && item.targets[0] ? change[0].map((x) => [x]) : []),
      ];
    } else options.push(item.targets);
  }
  for (const targets of options) {
    const action: Action = { type: 'chooseTargets', targets };
    const after = applyAction(g, action, STEP_BY_STEP);
    if (after === g) continue;
    const score = evaluate(resolveStack(after, pid, depth + 1), pid);
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  return best;
}

/**
 * Plays on with everyone passing until the stack is empty, to see what a play leads to.
 * `pid` picks good targets for their own triggered abilities; other players take the first legal ones.
 */
function resolveStack(g: Game, pid: PlayerId, depth = 0): Game {
  for (let i = 0; i < 200 && g.step !== 'gameOver'; i++) {
    let action: Action;
    const deciding = g.decision?.type;
    if (deciding === 'chooseCards' || deciding === 'triggerModes' || deciding === 'orderTriggers' || deciding === 'commanderZone' || deciding === 'assignDamage' || deciding === 'ask' || deciding === 'name' || deciding === 'player' || deciding === 'number' || deciding === 'cast' || deciding === 'retarget') {
      action = anyTargets(g);
    } else if (g.decision?.type === 'targets') action = g.priority === pid && depth < 1 ? bestTargets(g, pid, depth) : anyTargets(g);
    else if (g.stack.length && !g.decision) action = PASS;
    else break;
    const next = applyAction(g, action, STEP_BY_STEP);
    if (next === g) break;
    g = next;
  }
  return g;
}

/** Are attackers declared and combat damage still to come? */
const fighting = (g: Game) =>
  !!g.combat?.attacks.length && g.decision?.type !== 'attackers' && ['attackers', 'blockers', 'damage'].includes(g.step);

/** Plays on to the end of combat: everyone passes, and defenders block the way a bot would. */
function finishCombat(g: Game): Game {
  for (let i = 0; i < 300 && fighting(g); i++) {
    const deciding = g.decision?.type;
    const action = deciding === 'blockers' ? blockAction(g, g.priority) : deciding ? anyTargets(g) : PASS;
    const next = applyAction(g, action, STEP_BY_STEP);
    if (next === g) break;
    g = next;
  }
  return g;
}

/**
 * The cast/ability that improves the position most, or null if nothing is worth it.
 * Once attackers are declared, positions are scored after combat damage, so tricks and
 * removal are judged by what they do to the combat.
 */
function bestPlay(g: Game, pid: PlayerId): Action | null {
  const throughCombat = fighting(g);
  // Triggered abilities the play sets off take quick targets here: searching theirs too for
  // every candidate costs too much. The bot searches properly when it really chooses.
  const outcome = (s: Game) => {
    s = resolveStack(s, pid, 1);
    return evaluate(throughCombat ? finishCombat(s) : s, pid);
  };
  const baseline = outcome(g);
  let best: Action | null = null;
  let bestGain = 0;
  for (const { action, spendsCard } of candidateActions(g, pid)) {
    const after = applyAction(g, action, STEP_BY_STEP);
    if (after === g) continue;
    const gain = outcome(after) - baseline - (spendsCard ? 0.25 : 0.05);
    if (gain > bestGain) {
      bestGain = gain;
      best = action;
    }
  }
  return best;
}

// ---------- attacking ----------

/**
 * What damage that gets through is worth to the attacker: to a player, about 0.6 a point
 * (much more if it is lethal); to a planeswalker, a share of its worth, or all of it if
 * the attack kills it; to a battle the attacker controls, progress toward defeating it.
 * Attacking someone else's battle only helps its controller, so it is worth nothing.
 */
function attackWorth(g: Game, pid: PlayerId, c: Card, o: AttackOption): number {
  const power = stats(g, c).power;
  const target = o.target ? permanent(g, o.target) : undefined;
  if (target && isPlaneswalker(g, target)) {
    const loyalty = loyaltyOf(target);
    return power >= loyalty ? walkerValue(target) : (power / loyalty) * walkerValue(target) * 0.8;
  }
  if (target) return target.owner === pid ? Math.min(power, defenseOf(target)) * 0.6 + (power >= defenseOf(target) ? 2 : 0) : 0;
  const p = g.players[o.defender];
  const lethal = power >= p.life || (c.isCommander && commanderDamageFrom(g, p, c) + power >= COMMANDER_DAMAGE);
  return power * (lethal ? 5 : 0.6) + (c.isCommander ? power * 0.3 : 0);
}

const sameAttack = (a: AttackOption | undefined, b: AttackOption) => !!a && a.defender === b.defender && a.target === b.target;

function planAttacks(g: Game, pid: PlayerId): Map<string, AttackOption> {
  const plan = new Map<string, AttackOption>();
  const worth = new Map<string, number>();
  const mine = attackCandidates(g, pid);
  const bias = (o: Player) =>
    // Mild preference for the strongest opponent, rotated so bots don't all pile on one seat.
    boardValue(g, o) * 0.01 + o.life * 0.004 + ((o.id * 7 + g.turn * 3 + pid * 5) % 4) * 0.03;
  const opps = attackOptions(g, pid).map((option) => ({
    option,
    blockers: creaturesOf(g, option.defender).filter((c) => !c.tapped),
    bias: bias(g.players[option.defender]),
  }));
  if (!mine.length || !opps.length) return plan;

  for (const c of mine) {
    const cs = stats(g, c);
    let best: AttackOption | null = null;
    let bestScore = -Infinity;
    for (const { option, blockers, bias } of opps) {
      const unblocked = attackWorth(g, pid, c, option);
      if (unblocked <= 0) continue;
      const able = blockers.filter((b) => canBlock(g, b, c));
      let value = unblocked + 0.5;
      if (able.length >= (cs.keywords.has('menace') ? 2 : 1)) {
        // Assume the defender makes the block that is worst for us, or doesn't block.
        value = unblocked;
        for (const b of able) {
          const r = fight(g, c, b);
          value = Math.min(value, (r.bDies ? threat(g, b) : 0) - (r.aDies ? threat(g, c) : 0));
        }
      }
      if (value > 0.25 && value + bias > bestScore) {
        bestScore = value + bias;
        best = option;
      }
    }
    if (best !== null) {
      plan.set(c.id, best);
      worth.set(c.id, bestScore);
    }
  }

  // Swarm: if we have clearly more attackers than someone has blockers, send everyone.
  const idle = mine.filter((c) => !plan.has(c.id));
  if (idle.length) {
    const players = opps.filter((o) => o.option.target === null);
    const victim = players.sort((a, b) => b.bias - a.bias).find(({ blockers }) => idle.length >= blockers.length + 2);
    if (victim) for (const c of idle) plan.set(c.id, victim.option);
  }
  // "No more than one creature can attack [this planeswalker] each combat" (508.1c): only the best ones.
  for (const { option } of opps) {
    const attacked = option.target ? permanent(g, option.target) : undefined;
    const most = attacked && abilitiesOf(g, attacked).maxAttackers;
    if (most === undefined) continue;
    const at = [...plan].filter(([, o]) => sameAttack(o, option)).sort(([a], [b]) => (worth.get(b) ?? 0) - (worth.get(a) ?? 0));
    for (const [id] of at.slice(most)) plan.delete(id);
  }
  return affordable(g, pid, plan, worth);
}

/**
 * The planned attacks the bot can pay for (Propaganda, 508.1g), the most valuable first.
 * An attack that costs mana goes ahead only if it is worth about what the mana is.
 */
function affordable(g: Game, pid: PlayerId, plan: Map<string, AttackOption>, worth: Map<string, number>): Map<string, AttackOption> {
  const attack = (id: string, o: AttackOption) => ({ id, defender: o.defender, target: o.target });
  if ([...plan].every(([id, o]) => isFree(attackCost(g, [attack(id, o)])))) return plan;
  const out = new Map<string, AttackOption>();
  const ordered = [...plan].sort(([a], [b]) => (worth.get(b) ?? 0.3) - (worth.get(a) ?? 0.3));
  for (const [id, o] of ordered) {
    const tax = attackCost(g, [attack(id, o)]);
    const mana = tax.generic + tax.pips.length + tax.hybrid.length;
    if (mana && (worth.get(id) ?? 0.3) < mana * 0.4) continue;
    const next = [...[...out].map(([i, x]) => attack(i, x)), attack(id, o)];
    if (canPayAttacks(g, pid, next)) out.set(id, o);
  }
  return out;
}

function attackAction(g: Game, pid: PlayerId): Action {
  const declared = new Map((g.combat?.attacks ?? []).map((a) => [a.id, a]));
  for (const [card, option] of planAttacks(g, pid)) {
    if (!sameAttack(declared.get(card), option)) return { type: 'declareAttack', card, defender: option.defender, ...(option.target ? { target: option.target } : {}) };
  }
  return { type: 'pass' };
}

// ---------- blocking ----------

function planBlocks(g: Game, pid: PlayerId): Map<string, string> {
  const plan = new Map<string, string>(); // blocker -> attacker
  const me = g.players[pid];
  // Attacks on this player, their planeswalkers, and the battles they protect (509.1a).
  const attacks = (g.combat?.attacks ?? []).filter((a) => a.defender === pid && permanent(g, a.id));
  const attackers = attacks.map((a) => permanent(g, a.id)!).sort((a, b) => stats(g, b).power - stats(g, a).power);
  const targetOf = (atk: Card) => {
    const t = attacks.find((a) => a.id === atk.id)!.target;
    return t ? permanent(g, t) : undefined;
  };
  let incoming = attackers.filter((c) => !attacks.find((a) => a.id === c.id)!.target).reduce((n, c) => n + stats(g, c).power, 0);
  const free = () => creaturesOf(g, pid).filter((b) => !b.tapped && !plan.has(b.id));
  const cheapest = (cards: Card[]) => [...cards].sort((a, b) => threat(g, a) - threat(g, b))[0];

  for (const atk of attackers) {
    const s = stats(g, atk);
    const able = free().filter((b) => canBlock(g, b, atk));
    const target = targetOf(atk);
    const mustStop =
      !target && (incoming >= me.life || (atk.isCommander && commanderDamageFrom(g, me, atk) + s.power >= COMMANDER_DAMAGE));
    // What the attack would take: a planeswalker it kills, or a battle it defeats. Worth a
    // chump block by a creature that is worth less.
    const stake = !target
      ? 0
      : isPlaneswalker(g, target)
        ? s.power >= loyaltyOf(target) ? walkerValue(target) : 0
        : s.power >= defenseOf(target) ? 3 : 0;
    if (s.keywords.has('menace')) {
      if (mustStop && able.length >= 2) {
        const pair = [...able].sort((a, b) => threat(g, a) - threat(g, b)).slice(0, 2);
        for (const b of pair) plan.set(b.id, atk.id);
        incoming -= s.power;
      }
      continue;
    }
    const outcome = (b: Card) => fight(g, atk, b);
    const pick =
      cheapest(able.filter((b) => outcome(b).aDies && !outcome(b).bDies)) ?? // kill it and live
      cheapest(able.filter((b) => outcome(b).aDies && threat(g, b) <= threat(g, atk) + 0.5)) ?? // fair trade
      cheapest(able.filter((b) => !outcome(b).bDies)) ?? // free wall
      (mustStop || (!target && s.power >= 5) ? cheapest(able.filter((b) => mustStop || threat(g, b) <= 2.5)) : undefined) ?? // chump
      cheapest(able.filter((b) => threat(g, b) < stake)); // save a planeswalker or battle
    if (pick) {
      plan.set(pick.id, atk.id);
      if (!target) incoming -= s.power;
    }
  }
  return plan;
}

function blockAction(g: Game, pid: PlayerId): Action {
  const declared = new Map<string, string>();
  for (const a of g.combat?.attacks ?? []) for (const b of a.blockers) declared.set(b, a.id);
  for (const [blocker, attacker] of planBlocks(g, pid)) {
    if (declared.get(blocker) !== attacker) return { type: 'declareBlock', blocker, attacker };
  }
  return { type: 'pass' };
}

// ---------- main phases ----------

/**
 * The land to play: the one making the colour the bot is shortest of. A multicolour deck
 * wants each of its colours on the battlefield before a second land of any one of them.
 */
function bestLand(g: Game, pid: PlayerId, lands: Card[]): Action | null {
  const p = g.players[pid];
  const sources = p.battlefield.map((c) => manaOf(g, c)?.colors ?? []);
  const pips = [...p.hand, ...p.command].flatMap((c) => parseCost(data(c).manaCost).pips);
  const short = (sym: ManaSym) => pips.filter((x) => x === sym).length / (1 + sources.filter((m) => m.includes(sym)).length);
  const landsOut = p.battlefield.filter((x) => isLand(g, x)).length;
  // Each land face it could be played as (712.12), looked at as it would be on the battlefield.
  const options = lands.flatMap((card) => landFaces(g, card).map((face) => ({ card, face, as: { ...card, zone: 'battlefield' as const, face } })));
  const score = ({ card, as }: (typeof options)[number]) => {
    let v = Math.max(0, ...(manaOf(g, as)?.colors ?? []).map(short)) - (entersTappedFor(g, as, pid) ? 0.5 : 0);
    // A modal card whose front is a spell is a land only when nothing else is, and mana is short.
    if (!isLand(g, card)) v -= landsOut >= 5 ? 100 : 2;
    return v;
  };
  const best = options.reduce((a, b) => (score(b) > score(a) ? b : a));
  if (score(best) < -50) return null;
  return { type: 'playLand', card: best.card.id, ...(best.face ? { face: best.face } : {}) };
}

/** Would land `c` enter tapped for `pid` now (614.1c)? */
function entersTappedFor(g: Game, c: Card, pid: PlayerId): boolean {
  const tapped = scriptFor(c).entersTapped;
  return typeof tapped === 'function' ? tapped(g, c, pid) : !!tapped;
}

function mainAction(g: Game, pid: PlayerId): Action {
  const p = g.players[pid];
  // Lands in the hand, or in exile with an effect that lets the bot play them (Jeska's Will).
  const lands = [...p.hand, ...p.exile].filter((c) => canPlayLand(g, pid, c));
  const land = lands.length ? bestLand(g, pid, lands) : null;
  if (land) return land;
  const combo = comboAction(g, pid);
  if (combo) return combo;
  const ruled = activateByRule(g, pid);
  if (ruled) return ruled;
  const play = bestPlay(g, pid);
  if (play) return play;
  // Mana from a ritual, a card in hand or Lion's Eye Diamond, if it lets the bot cast something it couldn't.
  const mana = enablerPlay(g, pid);
  if (mana) return mana;
  const extra = extraTurnPlay(g, pid);
  if (extra) return extra;
  // Team pumps look worthless to `evaluate` (they wear off), so cast them by rule.
  if (g.step === 'main1' && attackCandidates(g, pid).length >= 3) {
    const alpha = p.hand.find((c) => scriptFor(c).ai === 'alpha' && canCast(g, pid, c));
    if (alpha) return { type: 'cast', card: alpha.id };
  }
  if (g.step === 'main2') {
    const tutor = p.hand.find((c) => scriptFor(c).ai === 'tutor' && canCast(g, pid, c) && castChoices(g, pid, c).length);
    if (tutor) return { type: 'cast', card: tutor.id, ...castChoices(g, pid, tutor)[0] };
  }
  return { type: 'pass' };
}

// ---------- rules for plays the look-ahead can't value ----------

const ORACLE = "Thassa's Oracle";
/** Cards that empty the library for Thassa's Oracle. */
const ENABLERS = ['Demonic Consultation', 'Tainted Pact'];

/** Is the bot's own Thassa's Oracle on the stack, waiting for its library to be emptied? */
export const oracleOnStack = (g: Game, pid: PlayerId) => g.stack.some((x) => x.kind === 'spell' && x.controller === pid && x.card.name === ORACLE);

/**
 * The deck's win: cast Thassa's Oracle holding priority, then, with it on the stack, Demonic
 * Consultation (naming a card that isn't in the library) or Tainted Pact (taking nothing)
 * to exile the whole library. The Oracle resolves with no cards left and wins. Only when
 * both can be paid for.
 */
function comboAction(g: Game, pid: PlayerId): Action | null {
  const p = g.players[pid];
  const enabler = p.hand.find((c) => ENABLERS.includes(c.name) && canCast(g, pid, c));
  if (!enabler) return null;
  if (oracleOnStack(g, pid)) return { type: 'cast', card: enabler.id };
  const oracle = p.hand.find((c) => c.name === ORACLE && canCast(g, pid, c));
  if (!oracle || g.stack.length) return null;
  const both = addCosts(castCost(g, oracle, {}, pid), castCost(g, enabler, {}, pid));
  return planPayment(g, pid, both) ? { type: 'cast', card: oracle.id, hold: true } : null;
}

/** A permanent's ability with its own rule for when a bot uses it (`CardScript.botActivate`). */
function activateByRule(g: Game, pid: PlayerId): Action | null {
  for (const c of g.players[pid].battlefield) {
    const rule = scriptFor(c).botActivate;
    if (!rule) continue;
    for (const ref of activatable(g, pid, c)) {
      if (ref.ability !== undefined || !rule(g, pid, c, ref.activated ?? 0)) continue;
      const [action] = activations(g, pid, c, ref);
      if (action) return action;
    }
  }
  return null;
}

/**
 * Mana the look-ahead doesn't value on its own: a ritual (`ai: 'ritual'`), a card that makes
 * mana from the hand (Simian Spirit Guide), or Lion's Eye Diamond with an empty hand. One is
 * used only if afterwards the bot would cast something it can't cast now.
 */
function enablerPlay(g: Game, pid: PlayerId): Action | null {
  const p = g.players[pid];
  const tries: Action[] = [];
  for (const c of p.hand) {
    if (scriptFor(c).ai === 'ritual' && canCast(g, pid, c)) {
      const choices = castChoices(g, pid, c)[0];
      if (choices) tries.push({ type: 'cast', card: c.id, targets: targetChoices(g, pid, castTargets(c, choices.modes, choices.face, choices.gift, choices.alt), c)[0], ...choices });
    }
  }
  for (const s of [...p.hand, ...p.battlefield]) {
    const ab = manaAbilitiesOf(g, s).find((m) => m.fromHand || (m.discardHand && !p.hand.length));
    if (ab) tries.push({ type: 'tapMana', card: s.id, ability: ab.index });
  }
  const before = new Set(castableCards(g, pid).filter((c) => canCast(g, pid, c)).map((c) => c.id));
  for (const action of tries) {
    const after = resolveStack(applyAction(g, action, STEP_BY_STEP), pid, 1);
    if (after === g || after.stack.length) continue;
    const next = bestPlay(after, pid);
    if (next?.type === 'cast' && !before.has(next.card)) return action;
  }
  return null;
}

/**
 * An extra turn that loses the game at its end (Final Fortune): only with one opponent left
 * whose life the bot's creatures could take in one attack.
 */
function extraTurnPlay(g: Game, pid: PlayerId): Action | null {
  const opponents = opponentsOf(g, pid);
  if (opponents.length !== 1 || g.step !== 'main2') return null;
  const power = creaturesOf(g, pid).reduce((n, c) => n + Math.max(0, stats(g, c).power), 0);
  if (power < opponents[0].life) return null;
  const card = g.players[pid].hand.find((c) => scriptFor(c).ai === 'extraTurn' && canCast(g, pid, c));
  return card ? { type: 'cast', card: card.id } : null;
}

function discardChoice(g: Game, pid: PlayerId): Action {
  const p = g.players[pid];
  const lands = p.battlefield.filter((x) => isLand(g, x)).length;
  const spare = lands >= 5 ? p.hand.find((x) => isLand(g, x)) : undefined;
  const priciest = [...p.hand].sort((a, b) => data(b).cmc - data(a).cmc)[0];
  return { type: 'discard', card: (spare ?? priciest).id };
}

// ---------- mulligans and card choices ----------

/** Keep a hand with a workable number of lands, or any hand of five or fewer cards. */
function mulliganChoice(g: Game, pid: PlayerId): Action {
  const hand = g.players[pid].hand;
  const lands = hand.filter((x) => isLand(g, x)).length;
  const keep = hand.length <= 5 || (lands >= 2 && lands <= hand.length - 2) || !canMulligan(g, pid);
  return { type: keep ? 'keep' : 'mulligan' };
}

/** The card's own rule for answering a choice it asked (`CardScript.botChoice`), if it has one. */
function scriptedChoice(g: Game, pid: PlayerId, choice: Choice): Action | null {
  const item = resolvingItem(g);
  const fn = item && 'then' in choice && choice.then ? itemScript(item).botChoice?.[choice.then] : undefined;
  return fn ? fn(g, pid, choice) : null;
}

/** How much a bot wants a card it could search for: what it would most like to draw. */
export function cardWant(g: Game, pid: PlayerId, c: Card): number {
  const p = g.players[pid];
  const lands = p.battlefield.filter((x) => isLand(g, x)).length + p.hand.filter((x) => isLand(g, x)).length;
  if (isLand(g, c)) return lands < 4 ? 6 : 1;
  const mv = data(c).cmc;
  // Something it could cast soon, the more expensive the better.
  return 3 + Math.min(mv, lands + 1) - Math.max(0, mv - lands - 1) * 2;
}

/**
 * Searches find the card the bot wants most (a land while it is short of them). Picks
 * take the cards it wants most. After a mulligan, the cards kept are about three lands
 * in seven with the cheapest spells, and the rest go on the bottom.
 */
function cardChoice(g: Game, pid: PlayerId): Action {
  if (g.decision?.type !== 'chooseCards') return PASS;
  const { choice } = g.decision;
  const scripted = scriptedChoice(g, pid, choice);
  if (scripted) return scripted;
  const { cards, valid, min, max } = choiceOptions(g, choice);
  const best = (n: number) =>
    cards
      .filter((c) => valid.has(c.id))
      .sort((a, b) => cardWant(g, pid, b) - cardWant(g, pid, a))
      .slice(0, n)
      .map((c) => c.id);
  if (choice.kind === 'search') return { type: 'chooseCards', cards: best(Math.max(min, Math.min(max, choice.count ?? 1))) };
  // Surveil (701.25a): cards it doesn't want go to the graveyard.
  if (choice.kind === 'pick' && choice.then === '@surveil') return { type: 'chooseCards', cards: cards.filter((c) => cardWant(g, pid, c) < 3).map((c) => c.id) };
  const valued = (value: (c: Card) => number, n: number) =>
    cards
      .filter((c) => valid.has(c.id))
      .sort((a, b) => value(a) - value(b))
      .slice(0, n)
      .map((c) => c.id);
  // Sacrifice (701.21a) and discard (701.9a) the least valuable; populate (701.36a) copies the best token.
  // A card's own continuation that sacrifices or discards what is picked says so in `data.bot`.
  if (choice.kind === 'pick' && (choice.then === '@sacrifice' || choice.data?.bot === 'sacrifice')) return { type: 'chooseCards', cards: valued((c) => worth(g, c), min) };
  if (choice.kind === 'pick' && (choice.then === '@discard' || choice.data?.bot === 'discard')) return { type: 'chooseCards', cards: valued((c) => cardWant(g, pid, c), min) };
  if (choice.kind === 'pick' && choice.data?.populate) return { type: 'chooseCards', cards: valued((c) => -worth(g, c), 1) };
  // "Ward—Sacrifice a Food" (702.21a): pay with its least valuable permanent, if that is a token or cheap; otherwise let it be countered.
  if (choice.kind === 'pick' && choice.data?.bot === 'wardSacrifice') {
    const [cheapest] = valued((c) => worth(g, c), 1).map((id) => cards.find((c) => c.id === id)!);
    return { type: 'chooseCards', cards: cheapest && (cheapest.isToken || worth(g, cheapest) < 2) ? [cheapest.id] : [] };
  }
  // The Ring tempts you (701.54a): its most threatening creature carries the Ring. Amass (701.47a): its biggest Army grows.
  if (choice.kind === 'pick' && (choice.data?.bot === 'ringBearer' || choice.data?.bot === 'amass')) return { type: 'chooseCards', cards: valued((c) => -worth(g, c), 1) };
  // Proliferate (701.34a): what gains from another counter, its own or an opponent's.
  if (choice.kind === 'pick' && (choice.then === '@proliferate' || choice.data?.bot === 'proliferate')) return proliferateChoice(g, pid, cards, choice.players ?? []);
  // Blight (701.68a): the creature that loses least; for a cost, only if one loses little (ward).
  if (choice.kind === 'pick' && choice.data?.bot === 'blight') {
    const n = (choice.data.blight as number) ?? 1;
    const [c] = [...cards].filter((x) => valid.has(x.id)).sort((a, b) => blightLoss(g, a, n) - blightLoss(g, b, n));
    const survives = !!c && stats(g, c).toughness > n;
    if (!c || (min === 0 && !survives && blightLoss(g, c, n) > 1.5)) return { type: 'chooseCards', cards: [] };
    return { type: 'chooseCards', cards: [c.id] };
  }
  if (choice.kind === 'pick') return { type: 'chooseCards', cards: best(Math.max(min, Math.min(max, 1))) };
  const hand = g.players[pid].hand;
  // The legend rule: keep the first.
  if (choice.kind === 'legend') return { type: 'chooseCards', cards: [choice.cards[0]] };
  if (choice.kind !== 'bottom') return PASS;
  const keepCount = hand.length - choice.count;
  const lands = hand.filter((x) => isLand(g, x));
  const spells = hand.filter((c) => !isLand(g, c)).sort((a, b) => data(a).cmc - data(b).cmc);
  const landsKept = Math.min(lands.length, Math.max(Math.round((keepCount * 3) / 7), keepCount - spells.length));
  const kept = new Set([...lands.slice(0, landsKept), ...spells.slice(0, keepCount - landsKept)].map((c) => c.id));
  return { type: 'chooseCards', cards: hand.filter((c) => !kept.has(c.id)).map((c) => c.id) };
}

/**
 * Answers a yes/no question or names a card. Paying a tax: yes on someone else's turn if
 * it can, on its own turn only if it leaves mana to spare. Paying life: yes if it keeps
 * plenty. Anything else ("you may draw"): yes. Naming a card: the card it wants most
 * from its library.
 */
function choiceAnswer(g: Game, pid: PlayerId): Action {
  const d = g.decision;
  if (d?.type !== 'ask' && d?.type !== 'name' && d?.type !== 'player' && d?.type !== 'number') return PASS;
  const scripted = scriptedChoice(g, pid, d.choice);
  if (scripted) return scripted;
  // A number: none if that is allowed, else the least.
  if (d.type === 'number') return { type: 'chooseNumber', n: d.choice.decline ? null : d.choice.min };
  // A player: the first one offered.
  if (d.type === 'player') return { type: 'choosePlayer', player: d.choice.options[0] };
  // A kind of counter: a good one before a harmful one.
  if (d.type === 'name' && d.choice.of === 'counter') {
    const options = d.choice.options ?? [];
    return { type: 'name', name: options.find((k) => !HARMFUL_COUNTERS.includes(k)) ?? options[0] };
  }
  if (d.type === 'name' && d.choice.of === 'creature type') return { type: 'name', name: 'Human' };
  if (d.type === 'name' && d.choice.of === 'color') return { type: 'name', name: preferredColor(g, pid) };
  // A card type: creatures are what usually attack and block.
  if (d.type === 'name' && d.choice.of === 'card type') return { type: 'name', name: 'Creature' };
  if (d.type === 'name') {
    const lib = [...g.players[pid].library].sort((a, b) => cardWant(g, pid, b) - cardWant(g, pid, a));
    return { type: 'name', name: lib.length ? cardData(lib[0].name).name : 'Island' };
  }
  const q = d.choice;
  if (!canSayYes(g, q)) return { type: 'answer', yes: false };
  const me = g.players[pid];
  if (q.life && me.life - q.life < 15) return { type: 'answer', yes: false };
  if (q.cost) {
    const mv = parseCost(q.cost).generic + parseCost(q.cost).pips.length;
    return { type: 'answer', yes: g.active !== pid || availableMana(g, pid) - mv >= 3 };
  }
  return { type: 'answer', yes: true };
}

/**
 * May cast a card while a spell resolves (608.2g): the way of casting it that leaves the bot
 * best off, if that beats not casting it. `quick`: the first way, for the look-ahead.
 */
function castNow(g: Game, pid: PlayerId, quick = false): Action {
  if (g.decision?.type !== 'cast') return PASS;
  const c = findCard(g, g.decision.choice.card);
  const decline: Action = { type: 'answer', yes: false };
  if (!c || !canCast(g, pid, c)) return decline;
  const options = castChoices(g, pid, c).flatMap((choices) =>
    targetChoices(g, pid, castTargets(c, choices.modes, choices.face, choices.gift, choices.alt), c).map((targets): Action => ({ type: 'cast', card: c.id, targets, ...choices })),
  );
  if (quick) return options[0] ?? decline;
  let best: Action = decline;
  let bestScore = evaluate(resolveStack(applyAction(g, decline, STEP_BY_STEP), pid, 1), pid);
  for (const action of options) {
    const after = applyAction(g, action, STEP_BY_STEP);
    if (after === g) continue;
    const score = evaluate(resolveStack(after, pid, 1), pid);
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  return best;
}

/** Triggers go on the stack in the order they triggered. */
function defaultOrder(g: Game, pid: PlayerId): Action {
  return { type: 'orderTriggers', order: g.triggers.filter((t) => t.controller === pid).map((t) => t.id) };
}

export function botAction(g: Game, pid: PlayerId): Action {
  switch (g.decision?.type) {
    case 'mulligan':
      return mulliganChoice(g, pid);
    case 'chooseCards':
      return cardChoice(g, pid);
    case 'orderTriggers':
      return defaultOrder(g, pid);
    case 'triggerModes':
      return modesFor(g, g.decision.item);
    case 'attackers':
      return attackAction(g, pid);
    case 'blockers':
      return blockAction(g, pid);
    case 'discard':
      return discardChoice(g, pid);
    case 'targets':
      return bestTargets(g, pid);
    case 'ask':
    case 'name':
    case 'player':
    case 'number':
      return choiceAnswer(g, pid);
    case 'cast':
      return castNow(g, pid);
    case 'retarget':
      return bestTargets(g, pid);
    // Only a person is asked; answering for one, take what a bot would (the first option).
    case 'replacement':
      return { type: 'replacement', option: 0 };
    case 'assignDamage':
      // Only a human is asked, but a bot answering for one splits it automatically.
      return { type: 'assignDamage', assignments: autoAssignments(g) };
    case 'commanderZone':
      // Only a human is asked too; a bot always sends its commander home (903.9).
      return { type: 'commanderZone', toCommand: true };
  }
  // With priority: sorcery-speed plays in the bot's own main phase, otherwise responses and tricks.
  const myMain = pid === g.active && !g.stack.length && (g.step === 'main1' || g.step === 'main2');
  if (myMain) return mainAction(g, pid);
  return comboAction(g, pid) ?? bestPlay(g, pid) ?? PASS;
}

/** Applies a bot action, falling back to a legal default so a bad plan can never stall the game. */
export function applyBotAction(g: Game, a: Action, opts?: ApplyOptions): Game {
  let next = applyAction(g, a, opts);
  if (next === g && a.type !== 'pass') next = applyAction(g, PASS, opts);
  if (next === g && g.decision?.type === 'discard') next = applyAction(g, discardChoice(g, g.priority), opts);
  if (next === g && g.decision?.type === 'targets') next = applyAction(g, anyTargets(g), opts);
  if (next === g && g.decision?.type === 'triggerModes') next = applyAction(g, modesFor(g, g.decision.item), opts);
  if (next === g && g.decision?.type === 'chooseCards') next = applyAction(g, cardChoice(g, g.priority), opts);
  if (next === g && g.decision?.type === 'ask') next = applyAction(g, { type: 'answer', yes: false }, opts);
  if (next === g && g.decision?.type === 'name') next = applyAction(g, { type: 'name', name: g.decision.choice.of === 'card type' ? 'Creature' : g.decision.choice.of ? 'Human' : 'Island' }, opts);
  if (next === g && g.decision?.type === 'player') next = applyAction(g, { type: 'choosePlayer', player: g.decision.choice.options[0] }, opts);
  if (next === g && g.decision?.type === 'number') next = applyAction(g, { type: 'chooseNumber', n: g.decision.choice.decline ? null : g.decision.choice.min }, opts);
  if (next === g && g.decision?.type === 'cast') next = applyAction(g, { type: 'answer', yes: false }, opts);
  if (next === g && g.decision?.type === 'retarget') next = applyAction(g, anyTargets(g), opts);
  if (next === g && g.decision?.type === 'mulligan') next = applyAction(g, { type: 'keep' }, opts);
  if (next === g && g.decision?.type === 'replacement') next = applyAction(g, { type: 'replacement', option: 0 }, opts);
  if (next === g && g.decision?.type === 'assignDamage') next = applyAction(g, { type: 'assignDamage', assignments: autoAssignments(g) }, opts);
  return next;
}

/** The shortest `botPause`: a bot can safely wait this long before it even picks its action. */
export const BOT_PAUSE_MIN = 320;

/**
 * How long a bot waits before `action`, in ms at normal speed, so people can follow along:
 * quick for passing and keeping a hand, a little longer for each attacker or blocker, a
 * second for anything that changes the board.
 */
export function botPause(action: Action): number {
  const quick = action.type === 'pass' || action.type === 'keep' || action.type === 'orderTriggers';
  return quick ? 450 : action.type.includes('declare') ? BOT_PAUSE_MIN : 1000;
}

/** Runs `fn` after `ms`; returns a function that cancels it. Tests pass their own clock. */
export type Schedule = (fn: () => void, ms: number) => () => void;

export const realSchedule: Schedule = (fn, ms) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

/**
 * Drives a bot's next move, the same way on the screen and on the game server: `act` gets
 * the action once its pause (`botPause`, divided by `speed`) has passed. Picking the action
 * (`botAction`) tries moves on copies of the game and can take tens of milliseconds. On the
 * screen that would stretch the frame that draws the last move, so with `deferThink` the
 * bot waits `BOT_PAUSE_MIN` before it thinks, and the pause is counted from now; a server,
 * with no frame to protect, thinks at once and the pause follows the think. Returns a
 * function that cancels whatever is still to come.
 */
export function scheduleBot(g: Game, speed: number, act: (action: Action) => void, schedule: Schedule, deferThink: boolean): () => void {
  const started = performance.now();
  const think = (): (() => void) => {
    const action = botAction(g, g.priority);
    const elapsed = deferThink ? performance.now() - started : 0;
    return schedule(() => act(action), Math.max(0, botPause(action) / speed - elapsed));
  };
  let cancel = deferThink ? schedule(() => (cancel = think()), BOT_PAUSE_MIN / speed) : think();
  return () => cancel();
}
