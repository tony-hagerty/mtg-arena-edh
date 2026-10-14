// Bot players. Because the engine is pure, the bot evaluates most choices by simply
// trying them (`applyAction`), letting the stack resolve, and scoring the resulting
// position. Attacks and blocks use hand-written heuristics, since their outcome depends
// on what other players do next.
import { scriptOf } from './registry';
import {
  activatable,
  applyAction,
  attackCandidates,
  attackOptions,
  canCast,
  canMulligan,
  canPlayLand,
  castTargets,
  choiceOptions,
  crewOptions,
  crewPower,
  maxX,
  modeChoices,
  sacrificeOptions,
} from './engine';
import {
  CANT_ATTACK,
  CANT_BLOCK,
  COMMANDER_DAMAGE,
  altCostsOf,
  canBlock,
  commanderDamageFrom,
  creaturesOf,
  data,
  defenseOf,
  fight,
  isBattle,
  isCreature,
  isLand,
  isPlaneswalker,
  loyaltyOf,
  legalTargets,
  manaOf,
  parseCost,
  permanent,
  stats,
  targetSpecs,
} from './rules';
import type { ApplyOptions, AttackOption } from './engine';
import type { Action, Card, CastChoices, Game, ManaSym, Player, PlayerId, TargetRef, TargetSpec } from './types';

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
  const script = scriptOf(c.name);
  if (script.static || script.onCreatureDies || script.onCast || script.onDraw || script.damageBonus) v += 1.5;
  // A creature that can't attack or block (Pacifism) is worth little.
  if (s.keywords.has(CANT_ATTACK) && s.keywords.has(CANT_BLOCK)) v *= 0.25;
  return v;
}

/**
 * The crew for Vehicle `v`, or null if crewing isn't worth it now: only before combat on
 * the bot's own turn, when the Vehicle can attack, using the summoning-sick and weakest
 * creatures first, and only if they have less power than the Vehicle brings.
 */
function crewChoice(g: Game, pid: PlayerId, v: Card): string[] | null {
  const need = scriptOf(v.name).activated?.cost.crew;
  if (!need || g.active !== pid || g.step !== 'main1' || v.sick || isCreature(v)) return null;
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
    if (isCreature(c)) v += threat(g, c);
    else if (isPlaneswalker(c)) v += walkerValue(c);
    else if (isBattle(c)) v += battleValue(c);
    else if (!isLand(c)) v += 1 + data(c).cmc * 0.5;
    mana += manaOf(g, c)?.amount ?? 0;
  }
  return v + Math.min(mana, 12) * 1.3;
}

const handValue = (p: Player) => Math.min(p.hand.length, 5) + Math.max(0, p.hand.length - 5) * 0.4;

/** Higher is better for `pid`. Opponents count half: each is only one of three enemies. */
export function evaluate(g: Game, pid: PlayerId): number {
  const me = g.players[pid];
  if (me.lost) return -1000;
  if (g.winner === pid) return 1000;
  let v = lifeValue(me.life) + boardValue(g, me) + handValue(me) - Math.max(...me.commanderDamage.flat()) * 0.3;
  for (const o of g.players) {
    if (o.id === pid) continue;
    if (o.lost) v += 25;
    else v -= 0.5 * (lifeValue(o.life) + boardValue(g, o) + handValue(o) * 0.5);
  }
  return v;
}

// ---------- trying out casts and abilities ----------

const PASS: Action = { type: 'pass' };

/** Every way of choosing targets for `specs` (capped so wide boards stay cheap). */
function targetChoices(g: Game, pid: PlayerId, specs: TargetSpec[], source: Card): (TargetRef | null)[][] {
  let combos: (TargetRef | null)[][] = [[]];
  for (const spec of specs) {
    const legal: (TargetRef | null)[] = legalTargets(g, pid, spec, source);
    if (spec.optional || legal.length === 0) legal.push(null);
    combos = combos.flatMap((c) => legal.map((t) => [...c, t])).slice(0, 80);
  }
  return combos;
}

/**
 * A few sensible ways to cast `c` (601.2b), for the look-ahead to compare: every set of
 * modes it allows (700.2), each available cost (mana cost or alternative), X as high as
 * it can pay and about half that, kicked as many times as it can pay or not at all, and
 * the two least valuable permanents to sacrifice.
 */
function castChoices(g: Game, pid: PlayerId, c: Card): CastChoices[] {
  const script = scriptOf(c.name);
  const out: CastChoices[] = [];
  const sacrifices = script.additionalCost
    ? [...sacrificeOptions(g, pid, c)]
        .sort((a, b) => (isCreature(a) ? threat(g, a) : 0) - (isCreature(b) ? threat(g, b) : 0))
        .slice(0, 2)
        .map((x) => [x.id])
    : [undefined];
  const modeSets = script.modal ? modeChoices(g, pid, c) : [undefined];
  for (const modes of modeSets) {
    for (const alt of [undefined, ...altCostsOf(g, c)]) {
      for (const sacrifice of sacrifices) {
        const kicks = [0];
        if (script.kicker) {
          let k = 0;
          while (k < (script.kicker.multi ? 10 : 1) && canCast(g, pid, c, { alt, sacrifice, modes, kicked: k + 1 })) k++;
          if (k) kicks.push(k);
        }
        for (const kicked of kicks) {
          const most = maxX(g, pid, c, { alt, sacrifice, modes, kicked });
          for (const x of new Set([most, Math.floor(most / 2)])) {
            const choices: CastChoices = { x, kicked, alt, sacrifice, modes };
            if (x >= 0 && canCast(g, pid, c, choices)) out.push(choices);
          }
        }
      }
    }
  }
  return out;
}

function candidateActions(g: Game, pid: PlayerId): { action: Action; spendsCard: boolean }[] {
  const p = g.players[pid];
  const out: { action: Action; spendsCard: boolean }[] = [];
  for (const c of [...p.hand, ...p.command]) {
    if (!canCast(g, pid, c)) continue;
    for (const choices of castChoices(g, pid, c)) {
      for (const targets of targetChoices(g, pid, castTargets(c, choices.modes), c)) {
        out.push({ action: { type: 'cast', card: c.id, targets, ...choices }, spendsCard: true });
      }
    }
  }
  for (const c of p.battlefield) {
    for (const ability of activatable(g, pid, c)) {
      const script = scriptOf(c.name);
      const ab = ability === undefined ? script.activated! : script.loyalty![ability];
      const crew = ability === undefined && script.activated!.cost.crew ? crewChoice(g, pid, c) : undefined;
      if (crew === null) continue;
      for (const targets of targetChoices(g, pid, ab.targets ?? [], c)) {
        out.push({ action: { type: 'activate', card: c.id, ability, targets, crew }, spendsCard: false });
      }
    }
  }
  return out;
}

// Look-ahead turns auto-pass off, so that passing only ever resolves the stack or ends one
// step. Positions being compared then always stop at the same point in the turn.
const STEP_BY_STEP = { autoPass: false } as const;

/**
 * A quick answer to a decision that comes up while the stack resolves: the first legal
 * targets, a bot's card choice, the order triggers went on in, or a commander sent home.
 */
function anyTargets(g: Game): Action {
  if (g.decision?.type === 'chooseCards') return cardChoice(g, g.priority);
  if (g.decision?.type === 'orderTriggers') return defaultOrder(g, g.priority);
  if (g.decision?.type === 'commanderZone') return { type: 'commanderZone', toCommand: true };
  if (g.decision?.type !== 'targets') return PASS;
  const { item } = g.decision;
  const targets = targetSpecs(item).map((spec) => (spec.optional ? null : (legalTargets(g, g.priority, spec, item.card)[0] ?? null)));
  return { type: 'chooseTargets', targets };
}

/** The targets for a waiting triggered ability that leave `pid` best off. */
function bestTargets(g: Game, pid: PlayerId, depth = 0): Action {
  if (g.decision?.type !== 'targets') return PASS;
  const { item } = g.decision;
  let best = anyTargets(g);
  let bestScore = -Infinity;
  for (const targets of targetChoices(g, pid, targetSpecs(item), item.card)) {
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
    if (deciding === 'chooseCards' || deciding === 'orderTriggers' || deciding === 'commanderZone') action = anyTargets(g);
    else if (g.decision?.type === 'targets') action = g.priority === pid && depth < 2 ? bestTargets(g, pid, depth) : anyTargets(g);
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
  const outcome = (s: Game) => {
    s = resolveStack(s, pid);
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
  if (target && isPlaneswalker(target)) {
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
    if (best !== null) plan.set(c.id, best);
  }

  // Swarm: if we have clearly more attackers than someone has blockers, send everyone.
  const idle = mine.filter((c) => !plan.has(c.id));
  if (idle.length) {
    const players = opps.filter((o) => o.option.target === null);
    const victim = players.sort((a, b) => b.bias - a.bias).find(({ blockers }) => idle.length >= blockers.length + 2);
    if (victim) for (const c of idle) plan.set(c.id, victim.option);
  }
  return plan;
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
      : isPlaneswalker(target)
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
function bestLand(g: Game, pid: PlayerId, lands: Card[]): Card {
  const p = g.players[pid];
  const sources = p.battlefield.map((c) => manaOf(g, c)?.colors ?? []);
  const pips = [...p.hand, ...p.command].flatMap((c) => parseCost(data(c).manaCost).pips);
  const short = (sym: ManaSym) => pips.filter((x) => x === sym).length / (1 + sources.filter((m) => m.includes(sym)).length);
  const score = (land: Card) =>
    Math.max(0, ...(manaOf(g, land)?.colors ?? []).map(short)) - (scriptOf(land.name).entersTapped ? 0.5 : 0);
  return lands.reduce((best, c) => (score(c) > score(best) ? c : best));
}

function mainAction(g: Game, pid: PlayerId): Action {
  const p = g.players[pid];
  const lands = p.hand.filter((c) => canPlayLand(g, pid, c));
  if (lands.length) return { type: 'playLand', card: bestLand(g, pid, lands).id };
  const play = bestPlay(g, pid);
  if (play) return play;
  // Team pumps look worthless to `evaluate` (they wear off), so cast them by rule.
  if (g.step === 'main1' && attackCandidates(g, pid).length >= 3) {
    const alpha = p.hand.find((c) => scriptOf(c.name).ai === 'alpha' && canCast(g, pid, c));
    if (alpha) return { type: 'cast', card: alpha.id };
  }
  return { type: 'pass' };
}

function discardChoice(g: Game, pid: PlayerId): Action {
  const p = g.players[pid];
  const lands = p.battlefield.filter(isLand).length;
  const spare = lands >= 5 ? p.hand.find(isLand) : undefined;
  const priciest = [...p.hand].sort((a, b) => data(b).cmc - data(a).cmc)[0];
  return { type: 'discard', card: (spare ?? priciest).id };
}

// ---------- mulligans and card choices ----------

/** Keep a hand with a workable number of lands, or any hand of five or fewer cards. */
function mulliganChoice(g: Game, pid: PlayerId): Action {
  const hand = g.players[pid].hand;
  const lands = hand.filter(isLand).length;
  const keep = hand.length <= 5 || (lands >= 2 && lands <= hand.length - 2) || !canMulligan(g, pid);
  return { type: keep ? 'keep' : 'mulligan' };
}

/**
 * Searches find the first land they can. After a mulligan, the cards kept are about three
 * lands in seven with the cheapest spells, and the rest go on the bottom.
 */
function cardChoice(g: Game, pid: PlayerId): Action {
  if (g.decision?.type !== 'chooseCards') return PASS;
  const { choice } = g.decision;
  const { cards, valid } = choiceOptions(g, choice);
  if (choice.kind === 'search') return { type: 'chooseCards', cards: cards.filter((c) => valid.has(c.id)).slice(0, 1).map((c) => c.id) };
  const hand = g.players[pid].hand;
  const keepCount = hand.length - choice.count;
  const lands = hand.filter(isLand);
  const spells = hand.filter((c) => !isLand(c)).sort((a, b) => data(a).cmc - data(b).cmc);
  const landsKept = Math.min(lands.length, Math.max(Math.round((keepCount * 3) / 7), keepCount - spells.length));
  const kept = new Set([...lands.slice(0, landsKept), ...spells.slice(0, keepCount - landsKept)].map((c) => c.id));
  return { type: 'chooseCards', cards: hand.filter((c) => !kept.has(c.id)).map((c) => c.id) };
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
    case 'attackers':
      return attackAction(g, pid);
    case 'blockers':
      return blockAction(g, pid);
    case 'discard':
      return discardChoice(g, pid);
    case 'targets':
      return bestTargets(g, pid);
  }
  // With priority: sorcery-speed plays in the bot's own main phase, otherwise responses and tricks.
  const myMain = pid === g.active && !g.stack.length && (g.step === 'main1' || g.step === 'main2');
  return myMain ? mainAction(g, pid) : (bestPlay(g, pid) ?? PASS);
}

/** Applies a bot action, falling back to a legal default so a bad plan can never stall the game. */
export function applyBotAction(g: Game, a: Action, opts?: ApplyOptions): Game {
  let next = applyAction(g, a, opts);
  if (next === g && a.type !== 'pass') next = applyAction(g, PASS, opts);
  if (next === g && g.decision?.type === 'discard') next = applyAction(g, discardChoice(g, g.priority), opts);
  if (next === g && g.decision?.type === 'targets') next = applyAction(g, anyTargets(g), opts);
  if (next === g && g.decision?.type === 'chooseCards') next = applyAction(g, cardChoice(g, g.priority), opts);
  if (next === g && g.decision?.type === 'mulligan') next = applyAction(g, { type: 'keep' }, opts);
  return next;
}
