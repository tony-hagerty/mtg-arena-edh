// Turns the game + the human's in-progress selections into what the screen needs:
// which cards glow, what the prompt says, what the buttons do. Also the click handlers.
import { createContext, useContext } from 'react';
import {
  attackCandidates,
  blockCandidates,
  canActivate,
  canAttack,
  canBlock,
  canCast,
  canPlayLand,
  canTapForMana,
  canUntapMana,
  castCost,
  castTargets,
  findCard,
  illegalBlocks,
  isLand,
  label,
  legalTargets,
  opponentsOf,
  parseCost,
  permanent,
  planPayment,
  scriptOf,
  targetSpecs,
  MAX_HAND,
} from '../engine';
import type { Card, Cost, Game, PlayerId, Step, TargetRef } from '../engine';
import { useStore } from './store';
import type { Targeting } from './store';

export type Glow = 'play' | 'attack' | 'block' | 'target' | 'discard' | 'picked';

export interface Btn {
  label: string;
  sub?: string;
  tone: 'go' | 'attack' | 'cancel' | 'plain';
  disabled?: boolean;
  onClick: () => void;
}

export interface View {
  g: Game;
  me: PlayerId | null;
  /** True when the human has a decision to make. */
  mine: boolean;
  glow: Map<string, Glow>;
  /** The human's permanents that a click taps for mana, or untaps to take the mana back. */
  mana: Set<string>;
  targetPlayers: Set<PlayerId>;
  attackTarget: PlayerId | null;
  prompt: string | null;
  primary: Btn | null;
  secondary: Btn | null;
}

export const STEP_NAMES: Record<Step, string> = {
  untap: 'Untap step',
  upkeep: 'Upkeep',
  draw: 'Draw step',
  main1: 'Main phase',
  beginCombat: 'Beginning of combat',
  attackers: 'Declare attackers',
  blockers: 'Declare blockers',
  damage: 'Combat damage',
  endCombat: 'End of combat',
  main2: 'Second main phase',
  end: 'End step',
  cleanup: 'Cleanup',
  gameOver: 'Game over',
};

type StoreState = ReturnType<typeof useStore.getState>;
const S = () => useStore.getState();
const pass = () => S().act({ type: 'pass' });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * What the human is in the middle of, if anything: a spell or ability they have started
 * (nothing has reached the game yet, so it can be cancelled), or a triggered ability of
 * theirs that the game is waiting on for targets (which can't).
 */
function targetingOf(s: StoreState): Targeting | null {
  const g = s.game;
  if (g?.decision?.type === 'targets' && g.priority === s.human) {
    const { item } = g.decision;
    const chosen = s.targeting?.mode === 'trigger' ? s.targeting.chosen : [];
    return { mode: 'trigger', cardId: item.card.id, specs: targetSpecs(item), chosen, tapped: [] };
  }
  return s.targeting?.mode === 'trigger' ? null : s.targeting;
}

/** Targets are done and the spell or ability is waiting for its cost to be paid (601.2f-h). */
const isPaying = (t: Targeting) => t.mode !== 'trigger' && t.chosen.length === t.specs.length;

/** The mana a spell or ability costs, and the same thing written out ("{1}{B}{B}"). */
function costOf(g: Game, t: Targeting): { cost: Cost; text: string } {
  const card = findCard(g, t.cardId)!;
  const cost = t.mode === 'cast' ? castCost(g, card) : parseCost(scriptOf(card.name).activated?.cost.mana ?? '');
  const text = (cost.generic || !cost.pips.length ? `{${cost.generic}}` : '') + cost.pips.map((p) => `{${p}}`).join('');
  return { cost, text };
}

/** The human's permanents that a click taps for mana, or untaps to take the mana back. */
function markMana(view: View, g: Game, me: PlayerId) {
  for (const c of g.players[me].battlefield) {
    if (canTapForMana(g, me, c) || canUntapMana(g, me, c)) view.mana.add(c.id);
  }
}

const sourceOf = (g: Game, t: Targeting) => (g.decision?.type === 'targets' ? g.decision.item.card : findCard(g, t.cardId));

function currentTargets(g: Game, me: PlayerId, t: Targeting): TargetRef[] {
  const source = sourceOf(g, t);
  const spec = t.specs[t.chosen.length];
  return source && spec ? legalTargets(g, me, spec, source) : [];
}

export function buildView(): View {
  const s = S();
  const g = s.game!;
  const me = s.human;
  const mine = me !== null && g.priority === me && g.step !== 'gameOver';
  const view: View = {
    g,
    me,
    mine,
    glow: new Map(),
    mana: new Set(),
    targetPlayers: new Set(),
    attackTarget: null,
    prompt: null,
    primary: null,
    secondary: null,
  };
  if (g.step === 'gameOver') return view;
  const deciding = g.decision?.type;

  if (me === null || !mine) {
    const who = g.players[g.priority].name;
    const text = deciding === 'blockers' ? `${who} is blocking` : g.priority === g.active ? `${who}'s turn` : `${who} may respond`;
    view.primary = { label: text, tone: 'plain', disabled: true, onClick: () => {} };
    return view;
  }
  const p = g.players[me];

  const t = targetingOf(s);

  // --- paying for a spell or ability ---
  if (t && isPaying(t)) {
    const card = findCard(g, t.cardId)!;
    const { cost, text } = costOf(g, t);
    const plan = planPayment(g, me, cost);
    const ability = t.mode === 'activate' ? scriptOf(card.name).activated : undefined;
    view.glow.set(card.id, 'picked');
    // The sources auto-pay would tap. Tapping others by hand first changes the plan.
    for (const id of plan?.tap ?? []) view.glow.set(id, 'play');
    markMana(view, g, me);
    view.prompt = ability
      ? `${label(card)} — ${ability.text}. Pay the cost, or cancel.`
      : `Pay ${text} to cast ${label(card)}, or cancel.`;
    view.primary = { label: 'Pay', sub: ability ? 'Activate' : `Cast ${label(card)}`, tone: 'go', disabled: !plan, onClick: pay };
    view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    return view;
  }

  // --- choosing targets ---
  if (t) {
    const spec = t.specs[t.chosen.length];
    for (const ref of currentTargets(g, me, t)) {
      if (ref.kind === 'card') view.glow.set(ref.id, 'target');
      else view.targetPlayers.add(ref.id);
    }
    const source = sourceOf(g, t);
    view.prompt = `${source ? label(source) : ''}: choose ${spec?.label ?? 'a target'}.`;
    if (t.mode !== 'trigger') view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    if (spec?.optional) view.primary = { label: 'No Target', tone: 'plain', onClick: () => chooseTarget(null) };
    return view;
  }

  // --- things you can play (only with priority: the engine says no while a declaration is going on) ---
  for (const c of [...p.hand, ...p.command]) {
    if (canPlayLand(g, me, c) || canCast(g, me, c)) view.glow.set(c.id, 'play');
  }
  for (const c of p.battlefield) if (canActivate(g, me, c)) view.glow.set(c.id, 'play');
  if (!deciding) markMana(view, g, me);

  switch (deciding) {
    case undefined:
      priorityView(view, g, me);
      break;
    case 'attackers': {
      const opps = opponentsOf(g, me);
      const target = opps.find((o) => o.id === s.attackTarget) ?? opps[0];
      view.attackTarget = target?.id ?? null;
      const candidates = attackCandidates(g, me);
      const attacks = g.combat?.attacks ?? [];
      for (const c of candidates) view.glow.set(c.id, 'attack');
      for (const o of opps) view.targetPlayers.add(o.id);
      view.prompt = `Choose attackers — sending them at ${target?.name}. Click an opponent to switch.`;
      if (attacks.length) {
        view.primary = { label: plural(attacks.length, 'Attacker'), sub: 'Attack', tone: 'attack', onClick: pass };
        view.secondary = {
          label: 'Cancel Attacks',
          tone: 'plain',
          onClick: () => attacks.forEach((a) => S().act({ type: 'undeclareAttack', card: a.id })),
        };
      } else {
        view.primary = {
          label: 'All Attack',
          tone: 'attack',
          onClick: () => candidates.forEach((c) => S().act({ type: 'declareAttack', card: c.id, defender: target.id })),
        };
        view.secondary = { label: 'No Attacks', tone: 'plain', onClick: pass };
      }
      break;
    }
    case 'blockers': {
      const blocking = (g.combat?.attacks ?? []).filter((a) => a.defender === me).flatMap((a) => a.blockers);
      for (const c of blockCandidates(g, me)) view.glow.set(c.id, 'block');
      if (s.pickedBlocker) {
        view.glow.set(s.pickedBlocker, 'picked');
        const blocker = permanent(g, s.pickedBlocker);
        for (const a of g.combat?.attacks ?? []) {
          const atk = permanent(g, a.id);
          if (a.defender === me && atk && blocker && canBlock(g, blocker, atk)) view.glow.set(a.id, 'target');
        }
      }
      const illegal = illegalBlocks(g, me).length > 0;
      view.prompt = illegal
        ? 'A creature with menace needs two or more blockers.'
        : s.pickedBlocker
          ? 'Choose the attacker to block.'
          : 'Choose blockers.';
      view.primary = {
        label: blocking.length ? plural(blocking.length, 'Blocker') : 'No Blocks',
        sub: 'Done',
        tone: 'go',
        disabled: illegal,
        onClick: pass,
      };
      if (blocking.length) {
        view.secondary = {
          label: 'Cancel Blocks',
          tone: 'plain',
          onClick: () => blocking.forEach((b) => S().act({ type: 'undeclareBlock', blocker: b })),
        };
      }
      break;
    }
    case 'discard': {
      const n = p.hand.length - MAX_HAND;
      for (const c of p.hand) view.glow.set(c.id, 'discard');
      view.prompt = `Discard ${plural(n, 'card')} — drag ${n === 1 ? 'it' : 'them'} out of your hand.`;
      view.primary = { label: `Discard ${n}`, tone: 'plain', disabled: true, onClick: () => {} };
      break;
    }
  }
  return view;
}

/** Prompt and button for when the human has priority. The button always passes it. */
function priorityView(view: View, g: Game, me: PlayerId) {
  const top = g.stack[g.stack.length - 1];
  const myTurn = g.active === me;
  if (top) {
    const whose = top.controller === me ? 'your' : `${g.players[top.controller].name}'s`;
    view.prompt = `Respond to ${whose} ${label(top.card)}, or let it resolve.`;
    view.primary = { label: 'Resolve', sub: label(top.card), tone: 'go', onClick: pass };
  } else if (myTurn && g.step === 'main1') {
    view.primary = attackCandidates(g, me).length
      ? { label: 'Next', sub: 'To Combat', tone: 'go', onClick: pass }
      : { label: 'End Turn', tone: 'go', onClick: endTurn };
  } else if (myTurn && g.step === 'main2') {
    view.primary = { label: 'End Turn', tone: 'go', onClick: pass };
  } else if (myTurn) {
    view.prompt = 'Blockers are declared. Cast instants, or continue to combat damage.';
    view.primary = { label: 'Next', sub: 'To Damage', tone: 'attack', onClick: pass };
  } else {
    const turn = `${g.players[g.active].name}'s turn`;
    const when = g.step === 'attackers' ? 'attackers are declared' : g.step === 'blockers' ? 'blockers are declared' : STEP_NAMES[g.step].toLowerCase();
    view.prompt = `${turn}, ${when}. Cast instants, or pass.`;
    view.primary = { label: 'Pass', tone: 'go', onClick: pass };
  }
}

/** "End Turn" with nothing to attack with: also passes the second main phase if the game stops there. */
function endTurn() {
  const turn = S().game?.turn;
  pass();
  const { game: g, human: me } = S();
  if (g && g.turn === turn && g.step === 'main2' && g.priority === me && !g.decision && !g.stack.length) pass();
}

// ---------- click handlers ----------

/**
 * Starts a spell or ability. This is a proposal (601.2): the human chooses targets, then
 * pays. It all lives in the UI until the cost is paid, so backing out at any point leaves
 * the game as if the spell was never started (733.1).
 */
function propose(mode: 'cast' | 'activate', card: Card) {
  const specs = mode === 'cast' ? castTargets(card) : (scriptOf(card.name).activated?.targets ?? []);
  advance({ mode, cardId: card.id, specs, chosen: [], tapped: [] });
}

/**
 * Skips target slots that have nothing legal. Once every slot is filled, a triggered
 * ability goes on the stack, and a spell or ability moves on to being paid for.
 */
function advance(t: Targeting) {
  const { game: g, human: me } = S();
  if (!g || me === null) return;
  let chosen = t.chosen;
  while (chosen.length < t.specs.length && currentTargets(g, me, { ...t, chosen }).length === 0) chosen = [...chosen, null];
  if (t.mode !== 'trigger' || chosen.length < t.specs.length) {
    useStore.setState({ targeting: { ...t, chosen }, hover: null });
    return;
  }
  useStore.setState({ targeting: null });
  S().act({ type: 'chooseTargets', targets: chosen });
}

/** Pays for the proposed spell or ability, which puts it on the stack. Mana in the pool is spent first, then auto-pay taps the rest. */
function pay() {
  const t = S().targeting;
  if (!t || !isPaying(t) || t.mode === 'trigger') return;
  if (!S().act({ type: t.mode, card: t.cardId, targets: t.chosen })) cancel();
}

/** Taps or untaps a mana source while paying. Once the pool covers the whole cost, the spell is paid for. */
function payByHand(g: Game, me: PlayerId, t: Targeting, card: Card) {
  if (card.owner !== me) return;
  if (canTapForMana(g, me, card)) {
    if (!S().act({ type: 'tapMana', card: card.id })) return;
    useStore.setState({ targeting: { ...t, tapped: [...t.tapped, card.id] } });
    if (planPayment(S().game!, me, costOf(S().game!, t).cost)?.tap.length === 0) pay();
  } else if (canUntapMana(g, me, card) && S().act({ type: 'untapMana', card: card.id })) {
    useStore.setState({ targeting: { ...t, tapped: t.tapped.filter((id) => id !== card.id) } });
  }
}

function chooseTarget(ref: TargetRef | null) {
  const s = S();
  const { game: g, human: me } = s;
  const t = targetingOf(s);
  if (!g || me === null || !t) return;
  if (ref && !currentTargets(g, me, t).some((x) => x.kind === ref.kind && x.id === ref.id)) return;
  advance({ ...t, chosen: [...t.chosen, ref] });
}

/**
 * Backs out of a spell or ability the human had started, and of a picked blocker. Mana
 * tapped while paying is taken back too, so nothing about the game has changed (733.1).
 */
export function cancel() {
  const t = S().targeting;
  for (const id of [...(t?.tapped ?? [])].reverse()) S().act({ type: 'untapMana', card: id });
  useStore.setState({ targeting: null, pickedBlocker: null });
}

function myTurnToAct(): { g: Game; me: PlayerId } | null {
  const { game: g, human: me } = S();
  return g && me !== null && g.priority === me && g.step !== 'gameOver' ? { g, me } : null;
}

/** Plays, casts or discards a card from the human's hand or command zone. */
export function playHandCard(card: Card) {
  const ctx = myTurnToAct();
  if (!ctx || targetingOf(S())) return;
  const { g, me } = ctx;
  if (g.decision?.type === 'discard') S().act({ type: 'discard', card: card.id });
  else if (isLand(card)) S().act({ type: 'playLand', card: card.id });
  else if (canCast(g, me, card)) propose('cast', card);
}

export function clickPermanent(card: Card) {
  const t = targetingOf(S());
  const ctx = myTurnToAct();
  if (t && isPaying(t)) return ctx && payByHand(ctx.g, ctx.me, t, card);
  if (t) return chooseTarget({ kind: 'card', id: card.id });
  if (!ctx) return;
  const { g, me } = ctx;
  const s = S();
  const deciding = g.decision?.type;

  if (deciding === 'attackers') {
    if (card.owner !== me || !canAttack(g, card)) return;
    const target = opponentsOf(g, me).find((o) => o.id === s.attackTarget) ?? opponentsOf(g, me)[0];
    const existing = g.combat?.attacks.find((a) => a.id === card.id);
    if (existing && existing.defender === target.id) s.act({ type: 'undeclareAttack', card: card.id });
    else s.act({ type: 'declareAttack', card: card.id, defender: target.id });
    return;
  }

  if (deciding === 'blockers') {
    const attacksOnMe = (g.combat?.attacks ?? []).filter((a) => a.defender === me);
    if (card.owner !== me) {
      if (s.pickedBlocker && s.act({ type: 'declareBlock', blocker: s.pickedBlocker, attacker: card.id })) {
        useStore.setState({ pickedBlocker: null });
      }
    } else if (attacksOnMe.some((a) => a.blockers.includes(card.id))) {
      s.act({ type: 'undeclareBlock', blocker: card.id });
    } else {
      const options = attacksOnMe.filter((a) => canBlock(g, card, permanent(g, a.id)!));
      if (options.length === 1) s.act({ type: 'declareBlock', blocker: card.id, attacker: options[0].id });
      else if (options.length > 1) useStore.setState({ pickedBlocker: s.pickedBlocker === card.id ? null : card.id });
    }
    return;
  }

  if (deciding || card.owner !== me) return;
  if (canTapForMana(g, me, card)) s.act({ type: 'tapMana', card: card.id });
  else if (canUntapMana(g, me, card)) s.act({ type: 'untapMana', card: card.id });
  else if (canActivate(g, me, card)) propose('activate', card);
}

export function clickPlayer(pid: PlayerId) {
  if (targetingOf(S())) return chooseTarget({ kind: 'player', id: pid });
  const ctx = myTurnToAct();
  if (ctx && ctx.g.decision?.type === 'attackers' && pid !== ctx.me && !ctx.g.players[pid].lost) {
    useStore.setState({ attackTarget: pid });
  }
}

export const ViewContext = createContext<View | null>(null);
export const useView = () => useContext(ViewContext)!;
