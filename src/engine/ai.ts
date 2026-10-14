// Bot players. Because the engine is pure, the bot evaluates most choices by simply
// trying them (`applyAction`) and scoring the resulting position. Attacks and blocks use
// hand-written heuristics, since their outcome depends on what other players do next.
import { scriptOf } from './registry';
import {
  applyAction,
  attackCandidates,
  canActivate,
  canCast,
  canPlayLand,
  castTargets,
} from './engine';
import {
  COMMANDER_DAMAGE,
  canBlock,
  creaturesOf,
  data,
  fight,
  isCreature,
  isLand,
  isPermanentCard,
  legalTargets,
  manaOf,
  opponentsOf,
  permanent,
  stats,
} from './rules';
import type { Action, Card, Game, Player, PlayerId, TargetRef, TargetSpec } from './types';

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
  let v = lifeValue(me.life) + boardValue(g, me) + handValue(me) - Math.max(...me.commanderDamage) * 0.3;
  for (const o of g.players) {
    if (o.id === pid) continue;
    if (o.lost) v += 25;
    else v -= 0.5 * (lifeValue(o.life) + boardValue(g, o) + handValue(o) * 0.5);
  }
  return v;
}

// ---------- trying out casts and abilities ----------

/** Every way of choosing targets for `specs` (capped so wide boards stay cheap). */
function targetChoices(g: Game, pid: PlayerId, specs: TargetSpec[], source: Card, allowSkip: boolean): (TargetRef | null)[][] {
  let combos: (TargetRef | null)[][] = [[]];
  for (const spec of specs) {
    const legal: (TargetRef | null)[] = legalTargets(g, pid, spec, source);
    if (allowSkip || spec.optional || legal.length === 0) legal.push(null);
    combos = combos.flatMap((c) => legal.map((t) => [...c, t])).slice(0, 80);
  }
  return combos;
}

function candidateActions(g: Game, pid: PlayerId): { action: Action; spendsCard: boolean }[] {
  const p = g.players[pid];
  const out: { action: Action; spendsCard: boolean }[] = [];
  for (const c of [...p.hand, ...p.command]) {
    if (!canCast(g, pid, c)) continue;
    for (const targets of targetChoices(g, pid, castTargets(c), c, isPermanentCard(c))) {
      out.push({ action: { type: 'cast', card: c.id, targets }, spendsCard: true });
    }
  }
  for (const c of p.battlefield) {
    if (!canActivate(g, pid, c)) continue;
    for (const targets of targetChoices(g, pid, scriptOf(c.name).activated!.targets ?? [], c, false)) {
      out.push({ action: { type: 'activate', card: c.id, targets }, spendsCard: false });
    }
  }
  return out;
}

/**
 * The cast/ability that improves the position most, or null if nothing is worth it.
 * `throughCombat` scores positions after combat damage, for tricks in the damage window.
 */
function bestPlay(g: Game, pid: PlayerId, throughCombat: boolean): Action | null {
  const finish = (s: Game) => (throughCombat && s.step === 'damage' && s.priority === pid ? applyAction(s, { type: 'pass' }) : s);
  const baseline = evaluate(finish(g), pid);
  let best: Action | null = null;
  let bestGain = 0;
  for (const { action, spendsCard } of candidateActions(g, pid)) {
    const after = applyAction(g, action);
    if (after === g) continue;
    const gain = evaluate(finish(after), pid) - baseline - (spendsCard ? 0.25 : 0.05);
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
      const lethal = cs.power >= o.life || (c.isCommander && o.commanderDamage[pid] + cs.power >= COMMANDER_DAMAGE);
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
      incoming >= me.life || (atk.isCommander && me.commanderDamage[atk.owner] + s.power >= COMMANDER_DAMAGE);
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
  const play = bestPlay(g, pid, false);
  if (play) return play;
  const declared = new Map<string, string>();
  for (const a of g.combat?.attacks ?? []) for (const b of a.blockers) declared.set(b, a.id);
  for (const [blocker, attacker] of planBlocks(g, pid)) {
    if (declared.get(blocker) !== attacker) return { type: 'declareBlock', blocker, attacker };
  }
  return { type: 'pass' };
}

// ---------- main phases ----------

function mainAction(g: Game, pid: PlayerId): Action {
  const p = g.players[pid];
  const land = p.hand.find((c) => canPlayLand(g, pid, c));
  if (land) return { type: 'playLand', card: land.id };
  const play = bestPlay(g, pid, false);
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

export function botAction(g: Game, pid: PlayerId): Action {
  switch (g.step) {
    case 'main1':
    case 'main2':
      return mainAction(g, pid);
    case 'attackers':
      return attackAction(g, pid);
    case 'blockers':
      return blockAction(g, pid);
    case 'damage':
      return bestPlay(g, pid, true) ?? { type: 'pass' };
    case 'discard':
      return discardChoice(g, pid);
    default:
      return { type: 'pass' };
  }
}

/** Applies a bot action, falling back to a pass so a bad plan can never stall the game. */
export function applyBotAction(g: Game, a: Action): Game {
  let next = applyAction(g, a);
  if (next === g && a.type !== 'pass') next = applyAction(g, { type: 'pass' });
  if (next === g && g.step === 'discard') next = applyAction(g, discardChoice(g, g.priority));
  return next;
}
