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
  altCostsOf,
  castCost,
  castTargets,
  costText,
  data,
  findCard,
  illegalBlocks,
  isLand,
  label,
  legalTargets,
  maxX,
  opponentsOf,
  parseCost,
  permanent,
  planPayment,
  sacrificeOptions,
  scriptOf,
  targetSpecs,
  MAX_HAND,
} from '../engine';
import type { Card, CastChoices, Cost, Game, PlayerId, Step, TargetRef } from '../engine';
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
  /** The spell or ability the human is deciding whether to pay for (shown by the stack). */
  paying: { card: Card; kind: 'spell' | 'ability' } | null;
  /** A spell whose X, kicker or alternative cost the human is announcing (601.2b), for the options panel. */
  announce: Announce | null;
  prompt: string | null;
  primary: Btn | null;
  secondary: Btn | null;
}

/** What the cast-options panel shows and can change. */
export interface Announce {
  card: Card;
  choices: CastChoices;
  /** The highest X that can be paid with the other choices, or null if the spell has no X. */
  maxX: number | null;
  /** The kicker cost, and how many times it can be paid (more than once only for multikicker). */
  kicker: { text: string; most: number } | null;
  /** The mana cost (alt undefined) and each available alternative cost, and whether each can be paid now. */
  costs: { alt: number | undefined; label: string; payable: boolean }[];
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
    return { mode: 'trigger', cardId: item.card.id, specs: targetSpecs(item), chosen, tapped: [], choices: {}, announcing: false };
  }
  return s.targeting?.mode === 'trigger' ? null : s.targeting;
}

/** Targets are chosen and the spell still needs a permanent to sacrifice for its additional cost (118.8). */
function isSacrificing(t: Targeting): boolean {
  if (t.mode !== 'cast' || t.announcing || t.chosen.length < t.specs.length || t.choices.sacrifice?.length) return false;
  const card = findCard(S().game!, t.cardId);
  return !!card && !!scriptOf(card.name).additionalCost;
}

/** Everything is chosen and the spell or ability is waiting for its cost to be paid (601.2f-h). */
const isPaying = (t: Targeting) => t.mode !== 'trigger' && !t.announcing && t.chosen.length === t.specs.length && !isSacrificing(t);

/** The mana a spell or ability costs, and the same thing written out ("{1}{B}{B}"), with any life to pay. */
function costOf(g: Game, t: Targeting): { cost: Cost; text: string } {
  const card = findCard(g, t.cardId)!;
  const cost = t.mode === 'cast' ? castCost(g, card, t.choices) : parseCost(scriptOf(card.name).activated?.cost.mana ?? '');
  return { cost, text: costText(cost) + (cost.life ? ` and ${cost.life} life` : '') };
}

/** The options panel for a spell being announced. */
function announceOf(g: Game, me: PlayerId, card: Card, choices: CastChoices): Announce {
  const script = scriptOf(card.name);
  const hasX = parseCost(choices.alt === undefined ? data(card).manaCost : script.alternativeCosts![choices.alt].mana).x > 0;
  let most = 0;
  if (script.kicker) while (most < (script.kicker.multi ? 20 : 1) && planPayment(g, me, castCost(g, card, { ...choices, x: 0, kicked: most + 1 }))) most++;
  return {
    card,
    choices,
    maxX: hasX ? Math.max(0, maxX(g, me, card, { ...choices, x: 0 })) : null,
    kicker: script.kicker ? { text: costText(parseCost(script.kicker.mana)), most } : null,
    costs: [undefined, ...altCostsOf(g, card)].map((alt) => ({
      alt,
      label: alt === undefined ? costText(castCost(g, card, { ...choices, alt, kicked: 0, x: 0 })) : script.alternativeCosts![alt].label,
      payable: !!planPayment(g, me, castCost(g, card, { ...choices, alt, kicked: 0, x: 0 })),
    })),
  };
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
    paying: null,
    announce: null,
    prompt: null,
    primary: null,
    secondary: null,
  };
  if (g.step === 'gameOver') return view;
  const deciding = g.decision?.type;

  if (me === null || !mine) {
    const who = g.players[g.priority].name;
    const text =
      deciding === 'blockers'
        ? `${who} is blocking`
        : deciding === 'mulligan'
          ? `${who} is choosing a hand`
          : deciding === 'chooseCards' && g.decision?.type === 'chooseCards'
            ? `${who} is ${g.decision.choice.kind === 'search' ? 'searching' : 'choosing cards'}`
            : g.priority === g.active
              ? `${who}'s turn`
              : `${who} may respond`;
    view.primary = { label: text, tone: 'plain', disabled: true, onClick: () => {} };
    return view;
  }
  const p = g.players[me];

  const t = targetingOf(s);

  // --- announcing X, kicker or an alternative cost (601.2b) ---
  if (t && t.announcing) {
    const card = findCard(g, t.cardId)!;
    const { text } = costOf(g, t);
    view.glow.set(card.id, 'picked');
    view.announce = announceOf(g, me, card, t.choices);
    view.prompt = `Choose how to cast ${label(card)}: ${text}.`;
    view.primary = { label: 'Continue', sub: `Cast ${label(card)}`, tone: 'go', disabled: !planPayment(g, me, castCost(g, card, t.choices)), onClick: confirmAnnounce };
    view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    return view;
  }

  // --- choosing what to sacrifice for an additional cost (118.8) ---
  if (t && isSacrificing(t)) {
    const card = findCard(g, t.cardId)!;
    for (const c of sacrificeOptions(g, me, card)) view.glow.set(c.id, 'target');
    view.glow.set(card.id, 'picked');
    view.prompt = `${label(card)}: choose ${scriptOf(card.name).additionalCost!.sacrifice.label}.`;
    view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    return view;
  }

  // --- paying for a spell or ability ---
  if (t && isPaying(t)) {
    const card = findCard(g, t.cardId)!;
    const { cost, text } = costOf(g, t);
    const plan = planPayment(g, me, cost);
    const ability = t.mode === 'activate' ? scriptOf(card.name).activated : undefined;
    view.glow.set(card.id, 'picked');
    view.paying = { card, kind: ability ? 'ability' : 'spell' };
    // The sources auto-pay would tap. Tapping others by hand first changes the plan.
    for (const id of plan?.tap ?? []) view.glow.set(id, 'play');
    markMana(view, g, me);
    // Phyrexian mana is paid with life only when the mana isn't there (107.4f).
    const life = plan?.life ? ` (auto-pay uses ${plan.life} life)` : '';
    view.prompt = ability
      ? `${label(card)} — ${ability.text}. Pay the cost${life}, or cancel.`
      : `Pay ${text}${life} to cast ${label(card)}, or cancel.`;
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
      const picked = s.pickedBlockers.map((id) => permanent(g, id)).filter((c) => c !== undefined);
      for (const blocker of picked) {
        view.glow.set(blocker.id, 'picked');
        for (const a of g.combat?.attacks ?? []) {
          const atk = permanent(g, a.id);
          if (a.defender === me && atk && canBlock(g, blocker, atk)) view.glow.set(a.id, 'target');
        }
      }
      const illegal = illegalBlocks(g, me).length > 0;
      view.prompt = illegal
        ? 'A creature with menace needs two or more blockers.'
        : picked.length
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
  } else if (myTurn && g.step === 'blockers') {
    view.prompt = 'Blockers are declared. Cast instants, or continue to combat damage.';
    view.primary = { label: 'Next', sub: 'To Damage', tone: 'attack', onClick: pass };
  } else {
    // Any other step is one the human set a stop in.
    const turn = myTurn ? 'Your turn' : `${g.players[g.active].name}'s turn`;
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
  const g = S().game!;
  const me = S().human!;
  const specs = mode === 'cast' ? castTargets(card) : (scriptOf(card.name).activated?.targets ?? []);
  const script = scriptOf(card.name);
  const alts = mode === 'cast' ? altCostsOf(g, card) : [];
  const hasX = mode === 'cast' && parseCost(data(card).manaCost).x > 0;
  // Start from a way that can be paid: the mana cost if it can, else the first alternative.
  const alt = planPayment(g, me, castCost(g, card)) ? undefined : alts.find((i) => planPayment(g, me, castCost(g, card, { alt: i })));
  const choices: CastChoices = { alt, x: hasX && alt === undefined ? Math.max(0, maxX(g, me, card, { alt })) : 0, kicked: 0 };
  const announcing = mode === 'cast' && (hasX || !!script.kicker || alts.length > 0);
  advance({ mode, cardId: card.id, specs, chosen: [], tapped: [], choices, announcing });
}

/** Changes what the human is announcing for the spell: X, kicker, or which cost. X is kept within what can be paid. */
export function setChoices(change: CastChoices) {
  const t = S().targeting;
  const { game: g, human: me } = S();
  if (!t || !t.announcing || !g || me === null) return;
  const card = findCard(g, t.cardId)!;
  let choices = { ...t.choices, ...change };
  const most = maxX(g, me, card, { ...choices, x: 0 });
  if (choices.x !== undefined) choices = { ...choices, x: Math.max(0, Math.min(choices.x, most)) };
  useStore.setState({ targeting: { ...t, choices } });
}

/** Done announcing: on to targets (601.2c). */
function confirmAnnounce() {
  const t = S().targeting;
  if (t) advance({ ...t, announcing: false });
}

/**
 * Skips target slots that have nothing legal. Once every slot is filled, a triggered
 * ability goes on the stack, and a spell or ability moves on to being paid for.
 */
function advance(t: Targeting) {
  const { game: g, human: me } = S();
  if (!g || me === null) return;
  if (t.announcing) {
    useStore.setState({ targeting: t, hover: null });
    return;
  }
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
  const action = t.mode === 'cast' ? { type: t.mode, card: t.cardId, targets: t.chosen, ...t.choices } : { type: t.mode, card: t.cardId, targets: t.chosen };
  if (!S().act(action)) cancel();
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

/** Picks the permanent to sacrifice for the spell's additional cost (118.8). Paying comes next. */
function chooseSacrifice(g: Game, me: PlayerId, t: Targeting, card: Card) {
  const spell = findCard(g, t.cardId)!;
  if (!sacrificeOptions(g, me, spell).some((c) => c.id === card.id)) return;
  useStore.setState({ targeting: { ...t, choices: { ...t.choices, sacrifice: [card.id] } } });
}

function chooseTarget(ref: TargetRef | null) {
  const s = S();
  const { game: g, human: me } = s;
  const t = targetingOf(s);
  if (!g || me === null || !t || t.announcing || isSacrificing(t)) return;
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
  useStore.setState({ targeting: null, pickedBlockers: [] });
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
  if (t && t.announcing) return;
  if (t && isPaying(t)) return ctx && payByHand(ctx.g, ctx.me, t, card);
  if (t && isSacrificing(t)) return ctx && chooseSacrifice(ctx.g, ctx.me, t, card);
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
      const declared = s.pickedBlockers.filter((b) => S().act({ type: 'declareBlock', blocker: b, attacker: card.id }));
      if (declared.length) useStore.setState({ pickedBlockers: [] });
    } else if (attacksOnMe.some((a) => a.blockers.includes(card.id))) {
      s.act({ type: 'undeclareBlock', blocker: card.id });
    } else {
      pickBlockers(g, me, [card]);
    }
    return;
  }

  if (deciding || card.owner !== me) return;
  if (canTapForMana(g, me, card)) s.act({ type: 'tapMana', card: card.id });
  else if (canUntapMana(g, me, card)) s.act({ type: 'untapMana', card: card.id });
  else if (canActivate(g, me, card)) propose('activate', card);
}

/**
 * Blocks with `blockers` (identical creatures, so they can block the same attackers). With one
 * attacker to block they block it; with more they are picked, and clicking an attacker sends
 * them all. Picking the same creatures again unpicks them.
 */
function pickBlockers(g: Game, me: PlayerId, blockers: Card[]) {
  const options = (g.combat?.attacks ?? []).filter((a) => a.defender === me && canBlock(g, blockers[0], permanent(g, a.id)!));
  const ids = blockers.map((c) => c.id);
  const s = S();
  if (options.length === 1) ids.forEach((b) => S().act({ type: 'declareBlock', blocker: b, attacker: options[0].id }));
  else if (options.length > 1) {
    const same = s.pickedBlockers.length === ids.length && ids.every((id) => s.pickedBlockers.includes(id));
    useStore.setState({ pickedBlockers: same ? [] : ids });
  }
}

/**
 * The "x7" badge on a pile of identical permanents: does to all of them what clicking one does.
 * Lands tap for mana together (while paying, only until the cost is covered) or untap together
 * to take the mana back, and creatures attack or block together. A click that only makes sense
 * for one card (a target, an opponent's pile) goes to the top card.
 */
export function clickGroup(cards: Card[]) {
  const top = cards[cards.length - 1];
  const t = targetingOf(S());
  const ctx = myTurnToAct();
  if (!ctx || top.owner !== ctx.me || (t && !isPaying(t))) return clickPermanent(top);
  const { me } = ctx;
  // Every action makes a new game, so each card is looked up again in the latest one.
  const now = () => cards.map((c) => permanent(S().game!, c.id)).filter((c) => c !== undefined);
  const deciding = ctx.g.decision?.type;

  if (t) {
    const tap = now().some((c) => canTapForMana(S().game!, me, c));
    for (const c of now()) {
      const paying = targetingOf(S());
      const g = S().game!;
      if (!paying || !isPaying(paying)) break; // paid: the spell is cast
      if (tap ? canTapForMana(g, me, c) : canUntapMana(g, me, c)) payByHand(g, me, paying, c);
    }
    return;
  }

  if (deciding === 'attackers') {
    const g = ctx.g;
    const target = opponentsOf(g, me).find((o) => o.id === S().attackTarget) ?? opponentsOf(g, me)[0];
    const able = now().filter((c) => canAttack(g, c));
    const attacking = (c: Card) => g.combat?.attacks.some((a) => a.id === c.id && a.defender === target.id);
    if (able.length && able.every(attacking)) able.forEach((c) => S().act({ type: 'undeclareAttack', card: c.id }));
    else able.filter((c) => !attacking(c)).forEach((c) => S().act({ type: 'declareAttack', card: c.id, defender: target.id }));
    return;
  }

  if (deciding === 'blockers') {
    const g = ctx.g;
    const blocking = new Set((g.combat?.attacks ?? []).flatMap((a) => a.blockers));
    const cs = now();
    if (cs.every((c) => blocking.has(c.id))) cs.forEach((c) => S().act({ type: 'undeclareBlock', blocker: c.id }));
    else pickBlockers(g, me, cs.filter((c) => !blocking.has(c.id)));
    return;
  }

  if (!deciding) {
    const g = ctx.g;
    const tappable = now().filter((c) => canTapForMana(g, me, c));
    const untappable = now().filter((c) => canUntapMana(g, me, c));
    if (tappable.length) return tappable.forEach((c) => S().act({ type: 'tapMana', card: c.id }));
    if (untappable.length) return untappable.forEach((c) => S().act({ type: 'untapMana', card: c.id }));
  }
  clickPermanent(top);
}

export function clickPlayer(pid: PlayerId) {
  if (targetingOf(S())) return chooseTarget({ kind: 'player', id: pid });
  const ctx = myTurnToAct();
  if (ctx && ctx.g.decision?.type === 'attackers' && pid !== ctx.me && !ctx.g.players[pid].lost) {
    useStore.setState({ attackTarget: pid });
  }
}

/** The crown on the human's avatar casts their commander. While choosing targets it counts as a click on the avatar. */
export function clickCrown(pid: PlayerId, commander: Card | undefined) {
  if (targetingOf(S()) || !commander) return clickPlayer(pid);
  playHandCard(commander);
}

export const ViewContext = createContext<View | null>(null);
export const useView = () => useContext(ViewContext)!;
