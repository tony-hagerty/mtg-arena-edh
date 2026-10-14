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
  castTargets,
  findCard,
  illegalBlocks,
  isLand,
  label,
  legalTargets,
  opponentsOf,
  permanent,
  scriptOf,
  MAX_HAND,
} from '../engine';
import type { Card, Game, PlayerId, TargetRef } from '../engine';
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

const S = () => useStore.getState();
const pass = () => S().act({ type: 'pass' });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function currentTargets(g: Game, me: PlayerId, t: Targeting): TargetRef[] {
  const source = findCard(g, t.cardId);
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

  if (me === null || !mine) {
    const who = g.players[g.priority].name;
    const text = g.step === 'blockers' ? `${who} is blocking` : `${who}'s turn`;
    view.primary = { label: text, tone: 'plain', disabled: true, onClick: () => {} };
    return view;
  }
  const p = g.players[me];

  // --- choosing targets ---
  if (s.targeting) {
    const t = s.targeting;
    const spec = t.specs[t.chosen.length];
    for (const ref of currentTargets(g, me, t)) {
      if (ref.kind === 'card') view.glow.set(ref.id, 'target');
      else view.targetPlayers.add(ref.id);
    }
    const source = findCard(g, t.cardId);
    view.prompt = `${source ? label(source) : ''}: choose ${spec?.label ?? 'a target'}.`;
    view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    if (spec?.optional) view.primary = { label: 'No Target', tone: 'plain', onClick: () => chooseTarget(null) };
    return view;
  }

  // --- things you can play ---
  for (const c of [...p.hand, ...p.command]) {
    if (canPlayLand(g, me, c) || canCast(g, me, c)) view.glow.set(c.id, 'play');
  }
  if (g.step !== 'attackers' && g.step !== 'blockers') {
    for (const c of p.battlefield) if (canActivate(g, me, c)) view.glow.set(c.id, 'play');
  }
  if (g.step !== 'discard') {
    for (const c of p.battlefield) if (canTapForMana(g, me, c) || canUntapMana(g, me, c)) view.mana.add(c.id);
  }

  switch (g.step) {
    case 'main1':
      view.primary = attackCandidates(g, me).length
        ? { label: 'Next', sub: 'To Combat', tone: 'go', onClick: pass }
        : { label: 'End Turn', tone: 'go', onClick: pass };
      break;
    case 'main2':
      view.primary = { label: 'End Turn', tone: 'go', onClick: pass };
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
        view.primary = { label: plural(attacks.length, 'Attacker'), sub: 'To Blockers', tone: 'attack', onClick: pass };
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
        sub: 'To Damage',
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
    case 'damage':
      view.prompt = 'Cast instants, or continue to combat damage.';
      view.primary = { label: 'Next', sub: 'To Damage', tone: 'attack', onClick: pass };
      break;
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

// ---------- click handlers ----------

function beginTargeting(mode: Targeting['mode'], card: Card) {
  const specs = mode === 'cast' ? castTargets(card) : (scriptOf(card.name).activated?.targets ?? []);
  advance({ mode, cardId: card.id, specs, chosen: [] });
}

/** Skips target slots that have nothing legal, and fires the action once every slot is filled. */
function advance(t: Targeting) {
  const { game: g, human: me } = S();
  if (!g || me === null) return;
  let chosen = t.chosen;
  while (chosen.length < t.specs.length && currentTargets(g, me, { ...t, chosen }).length === 0) chosen = [...chosen, null];
  if (chosen.length < t.specs.length) {
    useStore.setState({ targeting: { ...t, chosen }, hover: null });
    return;
  }
  useStore.setState({ targeting: null });
  S().act({ type: t.mode, card: t.cardId, targets: chosen });
}

function chooseTarget(ref: TargetRef | null) {
  const { game: g, human: me, targeting: t } = S();
  if (!g || me === null || !t) return;
  if (ref && !currentTargets(g, me, t).some((x) => x.kind === ref.kind && x.id === ref.id)) return;
  advance({ ...t, chosen: [...t.chosen, ref] });
}

export function cancel() {
  useStore.setState({ targeting: null, pickedBlocker: null });
}

function myTurnToAct(): { g: Game; me: PlayerId } | null {
  const { game: g, human: me } = S();
  return g && me !== null && g.priority === me && g.step !== 'gameOver' ? { g, me } : null;
}

/** Plays, casts or discards a card from the human's hand or command zone. */
export function playHandCard(card: Card) {
  const ctx = myTurnToAct();
  if (!ctx || S().targeting) return;
  const { g, me } = ctx;
  if (g.step === 'discard') S().act({ type: 'discard', card: card.id });
  else if (isLand(card)) S().act({ type: 'playLand', card: card.id });
  else if (canCast(g, me, card)) beginTargeting('cast', card);
}

export function clickPermanent(card: Card) {
  if (S().targeting) return chooseTarget({ kind: 'card', id: card.id });
  const ctx = myTurnToAct();
  if (!ctx) return;
  const { g, me } = ctx;
  const s = S();

  if (g.step === 'attackers' && card.owner === me && canAttack(g, card)) {
    const target = opponentsOf(g, me).find((o) => o.id === s.attackTarget) ?? opponentsOf(g, me)[0];
    const existing = g.combat?.attacks.find((a) => a.id === card.id);
    if (existing && existing.defender === target.id) s.act({ type: 'undeclareAttack', card: card.id });
    else s.act({ type: 'declareAttack', card: card.id, defender: target.id });
    return;
  }

  if (g.step === 'blockers') {
    const attacksOnMe = (g.combat?.attacks ?? []).filter((a) => a.defender === me);
    if (card.owner === me) {
      if (attacksOnMe.some((a) => a.blockers.includes(card.id))) {
        s.act({ type: 'undeclareBlock', blocker: card.id });
        return;
      }
      const options = attacksOnMe.filter((a) => canBlock(g, card, permanent(g, a.id)!));
      if (options.length === 1) return void s.act({ type: 'declareBlock', blocker: card.id, attacker: options[0].id });
      if (options.length > 1) return useStore.setState({ pickedBlocker: s.pickedBlocker === card.id ? null : card.id });
      // Not a blocker (a land, say): it can still be tapped for mana below.
    } else {
      if (s.pickedBlocker && s.act({ type: 'declareBlock', blocker: s.pickedBlocker, attacker: card.id })) {
        useStore.setState({ pickedBlocker: null });
      }
      return;
    }
  }

  if (card.owner !== me) return;
  const choosingCombat = g.step === 'attackers' || g.step === 'blockers';
  if (canTapForMana(g, me, card)) s.act({ type: 'tapMana', card: card.id });
  else if (canUntapMana(g, me, card)) s.act({ type: 'untapMana', card: card.id });
  else if (!choosingCombat && canActivate(g, me, card)) beginTargeting('activate', card);
}

export function clickPlayer(pid: PlayerId) {
  if (S().targeting) return chooseTarget({ kind: 'player', id: pid });
  const ctx = myTurnToAct();
  if (ctx && ctx.g.step === 'attackers' && pid !== ctx.me && !ctx.g.players[pid].lost) {
    useStore.setState({ attackTarget: pid });
  }
}

export const ViewContext = createContext<View | null>(null);
export const useView = () => useContext(ViewContext)!;
