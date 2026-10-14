// Bot players. Because the engine is pure, the bot evaluates most choices by simply
// trying them (`applyAction`), letting the stack resolve, and scoring the resulting
// position. Attacks and blocks use hand-written heuristics, since their outcome depends
// on what other players do next.
import { scriptOf } from './registry';
import {
  applyAction,
  attackCandidates,
  canActivate,
  canCast,
  canMulligan,
  canPlayLand,
  castTargets,
  choiceOptions,
} from './engine';
import {
  COMMANDER_DAMAGE,
  canBlock,
  commanderDamageFrom,
  creaturesOf,
  data,
  fight,
  isCreature,
  isLand,
  legalTargets,
  manaOf,
  opponentsOf,
  parseCost,
  permanent,
  stats,
  targetSpecs,
} from './rules';
import type { ApplyOptions } from './engine';
import type { Action, Card, Game, ManaSym, Player, PlayerId, TargetRef, TargetSpec } from './types';

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
  return v;
}

// Each point of life matters more the less of it you have.
const lifeValue = (life: number) => 4 * Math.sqrt(Math.max(0, life));

function boardValue(g: Game, p: Player): number {
  let v = 0;
  let mana = 0;
  for (const c of p.battlefield) {
    if (isCreature(c)) v += threat(g, c);
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

function candidateActions(g: Game, pid: PlayerId): { action: Action; spendsCard: boolean }[] {
  const p = g.players[pid];
  const out: { action: Action; spendsCard: boolean }[] = [];
  for (const c of [...p.hand, ...p.command]) {
    if (!canCast(g, pid, c)) continue;
    for (const targets of targetChoices(g, pid, castTargets(c), c)) {
      out.push({ action: { type: 'cast', card: c.id, targets }, spendsCard: true });
    }
  }
  for (const c of p.battlefield) {
    if (!canActivate(g, pid, c)) continue;
    for (const targets of targetChoices(g, pid, scriptOf(c.name).activated!.targets ?? [], c)) {
      out.push({ action: { type: 'activate', card: c.id, targets }, spendsCard: false });
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

function planAttacks(g: Game, pid: PlayerId): Map<string, PlayerId> {
  const plan = new Map<string, PlayerId>();
  const mine = attackCandidates(g, pid);
  const opps = opponentsOf(g, pid).map((o) => ({
    o,
    blockers: creaturesOf(g, o.id).filter((c) => !c.tapped),
    // Mild preference for the strongest opponent, rotated so bots don't all pile on one seat.
    bias: boardValue(g, o) * 0.01 + o.life * 0.004 + ((o.id * 7 + g.turn * 3 + pid * 5) % 4) * 0.03,
  }));
  if (!mine.length || !opps.length) return plan;

  for (const c of mine) {
    const cs = stats(g, c);
    let best: PlayerId | null = null;
    let bestScore = -Infinity;
    for (const { o, blockers, bias } of opps) {
      const lethal = cs.power >= o.life || (c.isCommander && commanderDamageFrom(g, o, c) + cs.power >= COMMANDER_DAMAGE);
      const unblocked = cs.power * (lethal ? 5 : 0.6) + (c.isCommander ? cs.power * 0.3 : 0);
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
        best = o.id;
      }
    }
    if (best !== null) plan.set(c.id, best);
  }

  // Swarm: if we have clearly more attackers than someone has blockers, send everyone.
  const idle = mine.filter((c) => !plan.has(c.id));
  if (idle.length) {
    const victim = [...opps].sort((a, b) => b.bias - a.bias).find(({ blockers }) => idle.length >= blockers.length + 2);
    if (victim) for (const c of idle) plan.set(c.id, victim.o.id);
  }
  return plan;
}

function attackAction(g: Game, pid: PlayerId): Action {
  const declared = new Map((g.combat?.attacks ?? []).map((a) => [a.id, a.defender]));
  for (const [card, defender] of planAttacks(g, pid)) {
    if (declared.get(card) !== defender) return { type: 'declareAttack', card, defender };
  }
  return { type: 'pass' };
}

// ---------- blocking ----------

function planBlocks(g: Game, pid: PlayerId): Map<string, string> {
  const plan = new Map<string, string>(); // blocker -> attacker
  const me = g.players[pid];
  const attackers = (g.combat?.attacks ?? [])
    .filter((a) => a.defender === pid)
    .map((a) => permanent(g, a.id))
    .filter((c): c is Card => !!c)
    .sort((a, b) => stats(g, b).power - stats(g, a).power);
  let incoming = attackers.reduce((n, c) => n + stats(g, c).power, 0);
  const free = () => creaturesOf(g, pid).filter((b) => !b.tapped && !plan.has(b.id));
  const cheapest = (cards: Card[]) => [...cards].sort((a, b) => threat(g, a) - threat(g, b))[0];

  for (const atk of attackers) {
    const s = stats(g, atk);
    const able = free().filter((b) => canBlock(g, b, atk));
    const mustStop =
      incoming >= me.life || (atk.isCommander && commanderDamageFrom(g, me, atk) + s.power >= COMMANDER_DAMAGE);
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
      (mustStop || s.power >= 5 ? cheapest(able.filter((b) => mustStop || threat(g, b) <= 2.5)) : undefined); // chump
    if (pick) {
      plan.set(pick.id, atk.id);
      incoming -= s.power;
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
