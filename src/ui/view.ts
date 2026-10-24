// Turns the game + the human's in-progress selections into what the screen needs:
// which cards glow, what the prompt says, what the buttons do. Also the click handlers.
import { createContext, useContext } from 'react';
import {
  activatable,
  unblockedAttackers,
  canPlot,
  discardsFor,
  abilityHasX,
  activatedAbilities,
  activatedAt,
  attackCandidates,
  attackOptions,
  attackForbidden,
  blockCandidates,
  canAttack,
  canBlock,
  canCast,
  canCastAs,
  canPlayLand,
  landCandidates,
  landPlayOptions,
  canTapForMana,
  canUntapMana,
  altCostsOf,
  alternativeCostAt,
  lifeChoices,
  castsForAlt,
  canActivate,
  castCost,
  castTargets,
  costText,
  attackCost,
  isFree,
  tapCandidates,
  tappedForManaOptions,
  crewOptions,
  crewPower,
  tapCostOptions,
  data,
  exileOptions,
  defaultProtector,
  findCard,
  illegalBlocks,
  isSiege,
  asSpell,
  castFaces,
  landFaces,
  label,
  legalTargets,
  loyaltyOf,
  maxAbilityX,
  maxX,
  modeChoices,
  opponentsOf,
  parseCost,
  permanent,
  planPayment,
  sacrificeOptions,
  sacrificesFor,
  abilitiesOf,
  scriptFor,
  targetSpecs,
  maxHandSize,
  nextStop,
  wantsPriority,
  actionsFor,
  MUST_ATTACK,
  activationCost,
  castableCards,
  escapes,
  hasConvoke,
  isCreature,
  specsFor,
  activationExileOptions,
  describeRef,
  discardOptions,
  escapeOptions,
  graveyardWays,
  paysFlashback,
  delveOptions,
  has,
  manaAbilities,
  produceOptions,
  maxModes,
  activationSacrificeOptions,
  activatedModeOptions,
  divisionOk,
  divisionTotal,
  changeOptions,
  creaturesOf,
  ownRightToCast,
  playPermissions,
  slotLabel,
} from '../engine';
import type { AbilityRef, Action, AttackOption, Card, CastChoices, Cost, Game, ManaSym, ManaUse, Payment, PlayerId, StackItem, Step, Stops, TapUntapped, TargetRef, TargetSpec } from '../engine';
import { absoluteStops, useStore } from './store';
import type { ManaOption, Targeting, UndoStep } from './store';

export type Glow = 'play' | 'attack' | 'block' | 'target' | 'discard' | 'picked';

export interface Btn {
  label: string;
  sub?: string;
  tone: 'go' | 'attack' | 'cancel' | 'plain';
  disabled?: boolean;
  onClick: () => void;
}

/** One choice in the ability menu: a loyalty ability, a Class level, or one of several activated abilities. */
export interface AbilityOption {
  ref: AbilityRef;
  cost: string;
  text: string;
  ok: boolean;
  /** Use its mana abilities instead (`useForMana`). */
  mana?: boolean;
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
  /** Spells and abilities on the stack the human can target now, by stack item id. */
  targetStack: Set<string>;
  /** What the human's attackers go after (508.1b). */
  attackTarget: AttackOption | null;
  /** The planeswalker whose loyalty ability (606), or Class whose level (716.2), the human is choosing, for the options panel. */
  loyalty: { card: Card; options: AbilityOption[] } | null;
  /** The spell or ability the human is deciding whether to pay for (shown by the stack). */
  paying: { card: Card; kind: 'spell' | 'ability' } | null;
  /** A spell whose X, kicker or alternative cost the human is announcing (601.2b), for the options panel. */
  announce: Announce | null;
  /** An ability whose X the human is announcing (107.3a, 602.2b): the X so far and the highest it can be. */
  abilityX: { card: Card; x: number; max: number } | null;
  /**
   * Paying, the cost has symbols that may be paid with 2 life instead of mana (Phyrexian mana,
   * 107.4f; K'rrik's {B}): how many the human pays with life (`n`, at most `max`, 119.4), and
   * whether that is auto-pay's choice (`auto`: life only where the mana isn't there) or theirs.
   */
  payLife: { n: number; max: number; auto: boolean } | null;
  /** A modal activated ability whose modes the human is choosing (700.2a): how many, and each mode's text, whether picked and whether it can be. */
  abilityModes: { card: Card; min: number; max: number; modes: { text: string; picked: boolean; ok: boolean }[] } | null;
  /** Escape (702.138a): the other cards in the graveyard the human picks `count` of to exile. */
  escape: { card: Card; options: Card[]; count: number } | null;
  /** An ability's "Exile two cards from your graveyard" cost (Matoc): the cards to pick `count` of. */
  graveCost: { card: Card; options: Card[]; count: number } | null;
  /** Delve (702.66a): cards in the graveyard the human may exile, up to `max`, each paying for {1}. */
  delve: { card: Card; options: Card[]; max: number } | null;
  /** Dividing a spell's damage among its targets (601.2d): the total, and each target with its share so far. */
  divide: { card: Card; total: number; rows: { name: string; amount: number }[] } | null;
  /** Cards in a graveyard the human can target now (Sevinne's Reclamation), for a picker. */
  graveTargets: { card: Card; spec: TargetSpec; options: Card[] } | null;
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
  /** The least X the chosen alternative cost allows (Henzie's blitz for a creature with {X}, 202.3e). */
  minX: number;
  /** X is paid in life ("pay X life", 118.8), not mana. */
  xLife: boolean;
  /** The kicker cost, and how many times it can be paid (more than once only for multikicker). */
  kicker: { text: string; most: number } | null;
  /** The offspring cost (702.175a), and whether it can be paid on top of the rest. */
  offspring: { text: string; payable: boolean } | null;
  /** The additional costs it offers a choice of ("pay 5 life or pay {2}"), and whether each can be paid. */
  extraCosts: { label: string; payable: boolean }[] | null;
  /** Plot (702.170a): its plot cost, if the card could be plotted now instead of cast. */
  plot: string | null;
  /**
   * The mana cost (alt undefined) and each available alternative cost, and whether each can
   * be paid now. From a graveyard: flashback, and each escape ability (`escape`: how many
   * other cards it exiles).
   */
  costs: { alt: number | undefined; escape?: number; permit?: string; slot?: string; label: string; payable: boolean }[];
  /** A spell with gift (702.174): the opponents a gift can be promised to. */
  gifts: { id: PlayerId; name: string }[] | null;
  /** An ability of the card that works from the hand, like channel: offered instead of playing it. */
  handAbility: string | null;
  /** A modal spell's modes (700.2): how many to choose, and each mode's text, times picked and whether it can be picked. */
  modal: { min: number; max: number; repeat: boolean; modes: { text: string; picked: number; ok: boolean }[]; valid: boolean } | null;
  /** A Siege's possible protectors: the caster's opponents (310.12a). Null for any other spell. */
  protectors: { id: PlayerId; name: string }[] | null;
  /**
   * The faces it can be cast or played as, when there is a choice: a split card's halves
   * (709.3), an Adventure (715.3), a modal double-faced card's faces (712.11b, 712.12).
   */
  faces: { face: number; name: string; land: boolean; ok: boolean }[] | null;
  /** It has a mana ability that works from the hand, like Simian Spirit Guide's: offered instead of casting it. */
  handMana: boolean;
}

/** A loyalty cost written out: "+1", "0", "−3", "−X". */
export const loyaltyCost = (n: number | '-X') => (n === '-X' ? '−X' : n > 0 ? `+${n}` : n === 0 ? '0' : `−${-n}`);

const sameOption = (a: AttackOption | null | undefined, b: AttackOption) => !!a && a.defender === b.defender && a.target === b.target;

/** What the human's attackers go after: the one they picked if it is still there, else the first opponent. */
function attackTargetOf(g: Game, me: PlayerId): AttackOption | null {
  const options = attackOptions(g, me);
  return options.find((o) => sameOption(S().attackTarget, o)) ?? options.find((o) => o.target === null) ?? options[0] ?? null;
}

/** The name of what an attack option goes after: a player, or a planeswalker or battle. */
function attackName(g: Game, o: AttackOption): string {
  const c = o.target ? permanent(g, o.target) : undefined;
  return c ? `${label(c)} (${g.players[o.defender].name})` : g.players[o.defender].name;
}

/** Sends a creature at what the human picked to attack. */
const declare = (card: string, o: AttackOption) => S().act({ type: 'declareAttack', card, defender: o.defender, ...(o.target ? { target: o.target } : {}) });

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

/** `t` after one choice of the human's, which Ctrl+Z steps back from to `t` (see `undo`). */
const stepFrom = (t: Targeting, change: Partial<Targeting>): Targeting => ({ ...t, ...change, prev: t });

/** Notes something done outside a spell being cast that Ctrl+Z can take back (see `undo`). */
const record = (step: UndoStep) => useStore.setState({ undoSteps: [...S().undoSteps, step] });

/** What each of these creatures attacks now, if it does: an attack moved to another target is moved back by Ctrl+Z. */
function attacksOf(g: Game, ids: string[]): { id: string; was?: AttackOption }[] {
  return ids.map((id) => {
    const a = g.combat?.attacks.find((x) => x.id === id);
    return a ? { id, was: { defender: a.defender, target: a.target } } : { id };
  });
}

/** Declares these creatures as attackers of `o`, as one step Ctrl+Z can take back. */
function declareAll(ids: string[], o: AttackOption) {
  const before = attacksOf(S().game!, ids);
  const done = before.filter((x) => declare(x.id, o));
  if (done.length) record({ kind: 'attack', cards: done });
}

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
    const anyDone = s.targeting?.mode === 'trigger' && !!s.targeting.anyDone;
    const prev = s.targeting?.mode === 'trigger' ? s.targeting.prev : undefined;
    return { mode: 'trigger', cardId: item.card.id, specs: expandSpecs(targetSpecs(g, item), chosen.length, anyDone), chosen, tapped: [], choices: {}, announcing: false, anyDone, ...(prev ? { prev } : {}) };
  }
  // New targets for a spell or ability (115.7d), like Deflecting Swat's.
  const item = g && g.priority === s.human ? retargetItem(g) : undefined;
  if (item) {
    const chosen = s.targeting?.mode === 'retarget' ? s.targeting.chosen : [];
    const prev = s.targeting?.mode === 'retarget' ? s.targeting.prev : undefined;
    // As many targets as it has: new targets don't change how many (115.7d).
    return { mode: 'retarget', cardId: item.card.id, specs: specsFor(targetSpecs(g!, item), item.targets.length), chosen, tapped: [], choices: {}, announcing: false, ...(prev ? { prev } : {}) };
  }
  return s.targeting?.mode === 'trigger' || s.targeting?.mode === 'retarget' ? null : s.targeting;
}

/**
 * The target slots so far for "any number of" targets (115.1d): the last spec once for each
 * target picked, and once more for the next one until the human is done. Other lists are as they are.
 */
function expandSpecs(base: TargetSpec[], chosen: number, done: boolean): TargetSpec[] {
  const last = base[base.length - 1];
  if (!last?.any) return base;
  return [...specsFor(base, chosen), ...(done ? [] : [last])];
}

/** The source a spell or ability choosing targets is from: a triggered ability's as it triggered, with its event (`Card.triggeredBy`). */
function targetSource(g: Game, t: Targeting): Card {
  const d = g.decision;
  return d?.type === 'targets' && t.mode === 'trigger' ? d.item.card : findCard(g, t.cardId)!;
}

/** The spell or ability the game is waiting on new targets for, if any. */
function retargetItem(g: Game): StackItem | undefined {
  const d = g.decision;
  return d?.type === 'retarget' ? g.stack.find((x) => x.id === d.choice.item) : undefined;
}

/** The activated ability (602) the human is activating, once it is chosen: none for a spell, a loyalty ability or a level. */
function activatedOf(t: Targeting, card: Card) {
  return t.mode === 'activate' && t.ability === undefined && !t.pickingAbility ? activatedAt(S().game!, card, t.activated) : undefined;
}

/** The ability `card` has that works from the hand (channel), or from the command zone (commander ninjutsu, 702.49d), if it could be activated now. */
function handAbility(g: Game, me: PlayerId, card: Card): AbilityRef | undefined {
  if (card.zone !== 'hand' && card.zone !== 'command') return undefined;
  return activatable(g, me, card).find((r) => r.ability === undefined && activatedAt(g, card, r.activated)?.fromHand);
}

/**
 * The sacrifices the spell's costs ask for, in order: one for an alternative cost that
 * sacrifices (Flare of Duplication), then one for an additional cost (118.8), which bargain
 * makes optional (702.166a).
 */
function sacrificeNeeds(t: Targeting): { spec: TargetSpec; alt: number | undefined; optional: boolean }[] {
  const card = findCard(S().game!, t.cardId);
  // An ability's "Sacrifice a creature" cost (Goblin Bombardment).
  const ab = card && activatedOf(t, card);
  const cost = ab?.cost;
  // "Sacrifice X Squirrels": as many as the X announced (107.3a).
  if (ab && cost?.sacrificeOne) return Array.from({ length: sacrificesFor(ab, t.x ?? 0) }, () => ({ spec: cost.sacrificeOne!, alt: undefined, optional: false }));
  if (!card || t.mode !== 'cast') return [];
  const script = scriptFor(asSpell(card, t.choices.face));
  const alt = alternativeCostAt(S().game!, card, t.choices.face ?? 0, t.choices.alt, S().human!);
  return [
    ...(alt?.sacrifice ? [{ spec: alt.sacrifice, alt: t.choices.alt, optional: false }] : []),
    ...(script.additionalCost?.sacrifice ? [{ spec: script.additionalCost.sacrifice, alt: undefined, optional: !!script.additionalCost.optional }] : []),
  ];
}

/** The total a spell being cast divides among its targets (601.2d), or null. */
function divideTotal(t: Targeting): number | null {
  const card = t.mode === 'cast' ? findCard(S().game!, t.cardId) : undefined;
  return card ? divisionTotal(scriptFor(asSpell(card, t.choices.face ?? 0)), t.choices.x ?? 0) : null;
}

/** The division as it stands: the human's, or at first as even as it can be, the rest to the first target. */
function draftDivision(t: Targeting): number[] {
  if (t.dividing) return t.dividing;
  const total = divideTotal(t) ?? 0;
  const n = t.chosen.filter(Boolean).length;
  let first = true;
  return t.chosen.map((ref) => {
    if (!ref) return 0;
    const share = Math.floor(total / n) + (first ? total % n : 0);
    first = false;
    return share;
  });
}

/** Targets are chosen and the spell's damage is still to be divided among two or more of them (601.2d). */
function isDividing(t: Targeting): boolean {
  if (t.mode !== 'cast' || t.announcing || t.chosen.length < t.specs.length || t.choices.divide) return false;
  return divideTotal(t) !== null && t.chosen.filter(Boolean).length > 1;
}

/** Targets are chosen and the spell still needs a permanent to sacrifice for a cost (118.8, 118.9). */
function isSacrificing(t: Targeting): boolean {
  if (isDividing(t)) return false;
  if ((t.mode !== 'cast' && t.mode !== 'activate') || t.announcing || t.pickingAbility || t.chosen.length < t.specs.length || t.sacrificeDone) return false;
  return (t.choices.sacrifice?.length ?? 0) < sacrificeNeeds(t).length;
}

/**
 * The spell is cast with escape, and the other cards to exile from the graveyard are still
 * to be picked (702.138a). Until then `escape` holds an empty id for each card its escape
 * ability exiles, which tells the cost which escape ability it is.
 */
function isEscaping(t: Targeting): boolean {
  if (t.mode !== 'cast' || t.announcing || t.chosen.length < t.specs.length || isSacrificing(t)) return false;
  return !!t.choices.escape && t.choices.escape.some((id) => !id);
}

/** An escape choice that exiles `n` other cards, before they are picked. */
const escapeSlots = (n: number) => Array.from({ length: n }, () => '');

/** Targets are chosen and an ability's "Exile a creature you control" cost still needs its creature. */
function isExilingForAbility(t: Targeting): boolean {
  if (t.mode !== 'activate' || t.announcing || t.pickingAbility || t.chosen.length < t.specs.length || t.exile?.length) return false;
  const card = findCard(S().game!, t.cardId);
  return !!card && !!activatedOf(t, card)?.cost.exileOne;
}

/** Targets are chosen and a ninjutsu ability still needs the unblocked attacking creature to return (702.49a). */
function isReturning(t: Targeting): boolean {
  if (t.mode !== 'activate' || t.announcing || t.pickingAbility || t.choosingX || t.chosen.length < t.specs.length || t.returnAttacker) return false;
  const card = findCard(S().game!, t.cardId);
  return !!card && !!activatedOf(t, card)?.cost.returnAttacker;
}

/** Targets are chosen and an ability's "Exile two cards from your graveyard" cost still needs its cards (Matoc). */
function isExilingGraveyard(t: Targeting): boolean {
  if (t.mode !== 'activate' || t.announcing || t.pickingAbility || t.choosingX || t.chosen.length < t.specs.length || t.graveyard) return false;
  const card = findCard(S().game!, t.cardId);
  return !!card && !!activatedOf(t, card)?.cost.exileGraveyard;
}

/** A spell with delve whose cards to exile from the graveyard are still to be picked (702.66a). */
function isDelving(t: Targeting): boolean {
  if (t.mode !== 'cast' || t.announcing || t.chosen.length < t.specs.length || isSacrificing(t) || isEscaping(t) || t.choices.delve) return false;
  const { game: g, human: me } = S();
  const card = g && findCard(g, t.cardId);
  if (!card || me === null || !data(asSpell(card, t.choices.face ?? 0)).keywords.includes('Delve')) return false;
  return delveOptions(g!, me, card).some((x) => !t.choices.escape?.includes(x.id)) && castCost(g!, card, t.choices, me).generic > 0;
}

/** Which cards an ability's "Discard a creature card" cost can discard: any, for a spell. */
const discardFilterOf = (t: Targeting, card: Card) => (t.mode === 'cast' ? undefined : activatedOf(t, card)?.cost.discardFilter);

/** The targets are chosen and an ability's or a spell's "Discard a card" cost still needs its cards (118.8). */
function isDiscarding(t: Targeting): boolean {
  if (t.chosen.length < t.specs.length || t.announcing || isSacrificing(t)) return false;
  const card = findCard(S().game!, t.cardId);
  if (!card) return false;
  const n = t.mode === 'cast' ? discardsFor(scriptFor(asSpell(card, t.choices.face)), t.choices.extra) : (activatedOf(t, card)?.cost.discard ?? 0);
  return n > (t.discard?.length ?? 0);
}

/**
 * Targets are chosen, and the alternative cost chosen exiles a card from the hand that
 * hasn't been picked yet, like Force of Will's blue card (118.9).
 */
function isExiling(t: Targeting): boolean {
  if (t.mode !== 'cast' || t.announcing || t.chosen.length < t.specs.length || t.choices.alt === undefined || t.choices.exile?.length) return false;
  if (isSacrificing(t)) return false;
  const card = findCard(S().game!, t.cardId);
  return !!card && !!alternativeCostAt(S().game!, card, t.choices.face ?? 0, t.choices.alt, S().human!)?.exile;
}

/**
 * Targets are chosen and a Vehicle's crew still has to be picked (702.122a), or the permanents
 * a "Tap three untapped Elves you control" cost taps. Returns the power or number needed, or 0.
 */
function crewNeeded(t: Targeting): number {
  if (t.crewDone || t.chosen.length < t.specs.length) return 0;
  const card = findCard(S().game!, t.cardId);
  const cost = card && activatedOf(t, card)?.cost;
  return cost?.crew || (cost?.tapUntapped ? (cost.tapUntapped.count ?? 1) : 0);
}

/** The permanents that could be tapped for `card`'s "Tap N untapped ... you control" cost, or for its crew. */
function tapOptions(g: Game, me: PlayerId, t: Targeting, card: Card): Card[] {
  const cost = activatedOf(t, card)?.cost;
  // The source among them, unless its own {T} is part of the cost (`tapCostOptions`).
  return cost?.tapUntapped ? tapCostOptions(g, me, card, t.activated) : crewOptions(g, me, card);
}

/** Everything is chosen and the spell or ability is waiting for its cost to be paid (601.2f-h). */
const isPaying = (t: Targeting) =>
  t.mode !== 'trigger' &&
  t.mode !== 'retarget' &&
  !t.announcing &&
  !t.pickingAbility &&
  !t.choosingX &&
  !t.choosingModes &&
  t.chosen.length === t.specs.length &&
  !isDividing(t) &&
  !isSacrificing(t) &&
  !isExiling(t) &&
  !isExilingForAbility(t) &&
  !isExilingGraveyard(t) &&
  !isReturning(t) &&
  !isEscaping(t) &&
  !isDelving(t) &&
  !isDiscarding(t) &&
  !crewNeeded(t);


/** The mana a spell or ability costs, and the same thing written out ("{1}{B}{B}"), with any life to pay. */
function costOf(g: Game, t: Targeting): { cost: Cost; text: string } {
  const card = findCard(g, t.cardId)!;
  // A loyalty ability costs loyalty, not mana (606.4). A Class level bar costs mana (716.2a).
  const script = t.mode === 'cast' ? scriptFor(card) : abilitiesOf(g, card);
  const me = S().human ?? card.controller;
  const ab = activatedOf(t, card);
  const cost =
    t.mode === 'cast'
      ? castCost(g, card, t.choices, me)
      : ab
        ? activationCost(g, me, card, ab, t.x ?? 0, t.choices.payLife)
        : parseCost(t.ability === undefined ? '' : (script.levels?.[t.ability].cost ?? ''));
  return { cost, text: costText(cost) + (cost.life ? ` and ${cost.life} life` : '') };
}

/**
 * How auto-pay would pay for what the human is paying for: a spell with what it sacrifices
 * and the creatures picked to convoke it (702.51a), or an ability with what its cost uses up.
 */
function planFor(g: Game, me: PlayerId, t: Targeting): Payment | null {
  const card = findCard(g, t.cardId);
  if (!card) return null;
  const { cost } = costOf(g, t);
  if (t.mode === 'cast') return planPayment(g, me, cost, asSpell(card, t.choices.face ?? 0, me), t.choices.sacrifice, t.choices.convoke);
  const ab = activatedOf(t, card);
  const busy = ab && (ab.cost.tap || ab.cost.sacrifice || ab.cost.exileSelf) ? [card.id] : [];
  return planPayment(g, me, cost, undefined, [...busy, ...(t.choices.sacrifice ?? []), ...(t.exile ?? [])]);
}

/** Nothing is left to tap but the creatures picked to convoke: the cost can be paid as it stands. */
const paidUp = (g: Game, me: PlayerId, t: Targeting) => !!planFor(g, me, t)?.tap.every((id) => t.choices.convoke?.includes(id));

/** The options panel for a spell being announced. */
function announceOf(g: Game, me: PlayerId, card: Card, choices: CastChoices): Announce {
  const face = choices.face ?? 0;
  const spell = asSpell(card, face);
  const script = scriptFor(spell);
  const land = landFaces(g, card).includes(face) && !castFaces(card).includes(face);
  const hasX = !land && (script.additionalCost?.life === 'x' || (!paysFlashback(g, card, choices) && parseCost(choices.alt === undefined ? data(spell).manaCost : alternativeCostAt(g, card, face, choices.alt, me)!.mana).x > 0));
  const payable = (ch: CastChoices) => !!planPayment(g, me, castCost(g, card, ch, me), asSpell(card, face, me));
  let most = 0;
  if (script.kicker) while (most < (script.kicker.multi ? 20 : 1) && payable({ ...choices, x: 0, kicked: most + 1 })) most++;
  const ways = card.zone === 'graveyard' ? graveyardWays(g, card, face) : null;
  // A permanent's permission to cast it from where it is (Muldrotha, Glarb): one entry per use it has left.
  const own = ownRightToCast(g, me, card);
  const permits = playPermissions(g, me, card)
    .filter((x) => x.p.cast)
    .flatMap((x): { permit: string; slot: string | undefined; x: (typeof x) }[] => (x.p.slots ? x.p.slots.map((slot) => ({ permit: x.source.id, slot, x })) : [{ permit: x.source.id, slot: undefined, x }]))
    // A permission that pays the card's costs as usual opens its own alternative costs too (Muldrotha's rulings).
    .flatMap(({ permit, slot, x }) => (x.p.free || x.p.cost !== undefined ? [undefined] : [undefined, ...altCostsOf(g, card, face, me)]).map((alt) => ({ permit, slot, x, alt })))
    .map(({ permit, slot, x, alt }) => {
      const ch = { ...choices, alt, escape: undefined, permit, slot, x: 0 };
      const how = x.p.free ? 'free' : alt !== undefined ? alternativeCostAt(g, card, face, alt, me)!.label : costText(castCost(g, card, ch, me));
      const as = slot !== undefined && (x.p.slots?.length ?? 0) > 1 ? ` as ${slotLabel(slot)}` : '';
      return { alt, permit, slot, label: `${x.source.id === card.id ? 'Mayhem' : label(x.source)}${as}: ${how}`, payable: payable(ch) };
    });
  // A land with several ways to be played (its own right, Muldrotha): the player names one (Muldrotha's rulings).
  const landWays = land ? landPlayOptions(g, me, card).map((w) => ({ alt: undefined, permit: w.permit, label: w.source ? label(w.source) : card.zone === 'hand' ? 'From your hand' : 'Your own right to play it', payable: canPlayLand(g, me, card, face, w.permit) })) : [];
  const handAb = handAbility(g, me, card);
  const modal = land ? undefined : script.modal;
  const sets = modal ? modeChoices(g, me, card, face) : [];
  const options = playOptions(g, me, card);
  const modes = choices.modes ?? [];
  return {
    card,
    choices,
    modal: modal
      ? {
          min: modal.min,
          max: maxModes(g, me, spell),
          repeat: !!modal.repeat,
          modes: modal.modes.map((m, i) => ({ text: m.text, picked: modes.filter((x) => x === i).length, ok: sets.some((set) => set.includes(i)) })),
          valid: sets.some((set) => set.join() === modes.join()),
        }
      : null,
    maxX: hasX ? Math.max(0, maxX(g, me, card, { ...choices, x: 0 })) : null,
    minX: alternativeCostAt(g, card, face, choices.alt, me)?.minX ?? 0,
    xLife: script.additionalCost?.life === 'x',
    protectors: isSiege(g, spell) ? opponentsOf(g, me).map((o) => ({ id: o.id, name: o.name })) : null,
    faces:
      options.length > 1
        ? options.map((o) => ({ face: o.face, name: data(asSpell(card, o.face)).name, land: o.land, ok: o.ok }))
        : null,
    kicker: script.kicker && !land ? { text: costText(parseCost(script.kicker.mana)), most } : null,
    offspring: script.offspring && !land ? { text: costText(parseCost(script.offspring)), payable: payable({ ...choices, offspring: true }) } : null,
    extraCosts:
      script.additionalCost?.oneOf && !land
        ? script.additionalCost.oneOf.map((o, i) => ({ label: o.label, payable: discardOptions(g, me, card).length >= discardsFor(script, i) && payable({ ...choices, extra: i }) }))
        : null,
    plot: canPlot(g, me, card) ? scriptFor(card).plot! : null,
    handMana: card.zone === 'hand' && canTapForMana(g, me, card),
    handAbility: handAb ? activatedAt(g, card, handAb.activated)!.text : null,
    gifts: script.gift && !land ? opponentsOf(g, me).map((o) => ({ id: o.id, name: o.name })) : null,
    costs: landWays.length > 1
      ? landWays
      : ways
      ? [
          ...(ways.flashback ? [{ alt: undefined, label: `Flashback ${scriptFor(card).flashback}`, payable: payable({ ...choices, escape: undefined, x: 0 }) }] : []),
          // An aftermath half (702.127a), or a card an effect lets the player cast from there: its mana cost.
          ...(ways.aftermath || ways.permitted
            ? [{ alt: undefined, label: costText(castCost(g, card, { ...choices, escape: undefined, x: 0 }, me)), payable: payable({ ...choices, escape: undefined, x: 0 }) }]
            : []),
          // Each escape ability with enough other cards to exile (702.138a).
          ...(ways.escape
            ? escapes(g, card)
                .filter((e) => escapeOptions(g, card).length >= e.exile)
                .map((e) => ({
                  alt: undefined,
                  escape: e.exile,
                  label: `Escape: ${costText(parseCost(e.mana))} + exile ${e.exile}`,
                  payable: payable({ ...choices, escape: escapeSlots(e.exile), x: 0 }),
                }))
            : []),
          ...permits,
        ]
      : [
          ...(land || !own ? [] : [undefined, ...altCostsOf(g, card, face, me)]).map((alt) => ({
            alt,
            label: alt === undefined ? costText(castCost(g, card, { ...choices, alt, permit: undefined, slot: undefined, kicked: 0, x: 0 }, me)) : alternativeCostAt(g, card, face, alt, me)!.label,
            payable: payable({ ...choices, alt, permit: undefined, slot: undefined, kicked: 0, x: 0 }),
          })),
          ...(land ? [] : permits),
        ],
  };
}

/**
 * The ways the human could play `card` now: each face it can be cast as, and each land
 * face it can be played as (712.12). `ok` says whether that way is possible right now.
 */
function playOptions(g: Game, me: PlayerId, card: Card): { face: number; land: boolean; ok: boolean }[] {
  const lands = card.zone !== 'battlefield' && card.zone !== 'stack' && card.zone !== 'command' ? landFaces(g, card) : [];
  return [
    ...castFaces(card).filter((f) => !lands.includes(f)).map((face) => ({ face, land: false, ok: canCastAs(g, me, card, face) })),
    ...lands.map((face) => ({ face, land: true, ok: canPlayLand(g, me, card, face) })),
  ];
}

/**
 * The human's permanents that a click taps for mana, or untaps to take the mana back, and
 * cards in their hand with a mana ability that works from there (Simian Spirit Guide).
 */
function markMana(view: View, g: Game, me: PlayerId) {
  for (const c of g.players[me].battlefield) {
    if (canTapForMana(g, me, c) || canUntapMana(g, me, c)) view.mana.add(c.id);
  }
  for (const c of g.players[me].hand) if (canTapForMana(g, me, c)) view.mana.add(c.id);
}

const sourceOf = (g: Game, t: Targeting) =>
  g.decision?.type === 'targets' ? g.decision.item.card : t.mode === 'retarget' ? retargetItem(g)?.card : findCard(g, t.cardId);

function currentTargets(g: Game, me: PlayerId, t: Targeting): TargetRef[] {
  const source = sourceOf(g, t);
  const spec = t.specs[t.chosen.length];
  if (!source || !spec) return [];
  // Changing targets (115.7a): only to another legal target, and a missing one stays missing.
  const item = t.mode === 'retarget' ? retargetItem(g) : undefined;
  if (item && g.decision?.type === 'retarget' && g.decision.choice.change) return changeOptions(g, item)[t.chosen.length] ?? [];
  // "Two target players": the second can't be the first again (115.3).
  const other = spec.distinctFrom === undefined ? null : t.chosen[spec.distinctFrom];
  // New targets are legal for the spell or ability's controller (115.7d).
  const who = t.mode === 'retarget' ? (retargetItem(g)?.controller ?? me) : me;
  // "Any number of" targets are each a different one (115.3).
  const taken = spec.any ? t.chosen.filter((x, i): x is TargetRef => !!x && !!t.specs[i]?.any) : [];
  // An ability's X, announced before its targets, may decide which fit (107.3a, 601.2b-c via 602.2b).
  const x = g.decision?.type === 'targets' ? g.decision.item.x : t.mode === 'retarget' ? retargetItem(g)?.x : t.mode === 'activate' ? t.x : undefined;
  return legalTargets(g, who, spec, source, x).filter(
    (x) => (!other || x.kind !== other.kind || x.id !== other.id) && !taken.some((y) => y.kind === x.kind && y.id === x.id),
  );
}

/**
 * Whether the stack shows as a small chip instead of its cards: the human hid it
 * (`stackHidden`) to see the table under it. It comes back on its own while something on it
 * can be targeted or a spell or ability is being paid for, since those need it in view.
 */
export const stackTucked = (v: Pick<View, 'g' | 'paying' | 'targetStack'>, hidden: boolean) => hidden && v.g.stack.length > 0 && !v.paying && v.targetStack.size === 0;

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
    targetStack: new Set(),
    attackTarget: null,
    loyalty: null,
    paying: null,
    announce: null,
    abilityX: null,
    payLife: null,
    abilityModes: null,
    escape: null,
    delve: null,
    graveCost: null,
    divide: null,
    graveTargets: null,
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
            : deciding === 'ask'
              ? `${who} is deciding`
              : deciding === 'name'
                ? `${who} is naming ${g.decision?.type === 'name' && g.decision.choice.of ? (g.decision.choice.of === 'color' ? 'a colour' : `a ${g.decision.choice.of}`) : 'a card'}`
                : deciding === 'player'
                  ? `${who} is choosing a player`
                  : deciding === 'number'
                    ? `${who} is choosing a number`
                    : deciding === 'triggerModes'
                      ? `${who} is choosing modes`
                  : deciding === 'cast'
                    ? `${who} may cast a spell`
                    : deciding === 'retarget'
                      ? `${who} is choosing new targets`
                      : deciding === 'replacement'
                        ? `${who} is choosing how replacement effects apply`
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
    const face = t.choices.face ?? 0;
    // Played as a land: a modal card's land face (712.12), or a land with several ways to be played (Muldrotha).
    const playing = landFaces(g, card).includes(face) && !castFaces(card).includes(face);
    const name = data(asSpell(card, face)).name;
    const plot = view.announce.plot;
    view.prompt = playing ? `Play ${name} as a land.` : plot ? `Cast ${name} for ${text}, or plot it for ${plot}?` : `Choose how to cast ${name}: ${text}.`;
    const ready = playing
      ? canPlayLand(g, me, card, face, t.choices.permit) && (landPlayOptions(g, me, card).length <= 1 || t.choices.permit !== undefined)
      : !!planPayment(g, me, castCost(g, card, t.choices, me), asSpell(card, face, me)) && (!view.announce.modal || view.announce.modal.valid);
    view.primary = { label: 'Continue', sub: playing ? `Play ${name}` : `Cast ${name}`, tone: 'go', disabled: !ready, onClick: confirmAnnounce };
    view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    return view;
  }

  // --- choosing which ability: a planeswalker's loyalty ability (606), a Class's level, or one of several (602) ---
  if (t && t.pickingAbility) {
    const card = findCard(g, t.cardId)!;
    const ok = activatable(g, me, card);
    const can = (ref: AbilityRef) => ok.some((r) => r.ability === ref.ability && (r.activated ?? 0) === (ref.activated ?? 0));
    const script = abilitiesOf(g, card);
    view.glow.set(card.id, 'picked');
    // Its activated abilities don't have a cost apart from their text, which starts with it.
    const options: AbilityOption[] = [
      // Its mana abilities, as one choice that goes on to the mana picker if there is more to choose (605).
      ...(canTapForMana(g, me, card) ? [{ ref: {}, cost: '', text: 'Add mana', ok: true, mana: true }] : []),
      ...activatedAbilities(g, card).map((ab, i) => ({ ref: { activated: i }, cost: '', text: ab.text, ok: can({ activated: i }) })),
      ...(script.levels
        ? script.levels.map((bar, i) => ({ ref: { ability: i }, cost: bar.cost, text: bar.text, ok: can({ ability: i }) }))
        : (script.loyalty ?? []).map((ab, i) => ({ ref: { ability: i }, cost: loyaltyCost(ab.cost), text: ab.text, ok: can({ ability: i }) }))),
    ];
    view.loyalty = { card, options };
    view.prompt = script.levels
      ? `${label(card)} (level ${card.level}): gain the next level.`
      : script.loyalty
        ? `${label(card)} (loyalty ${loyaltyOf(card)}): choose an ability. Only one loyalty ability a turn.`
        : `${label(card)}: choose an ability.`;
    view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    return view;
  }

  // --- choosing a modal ability's modes, before its X and targets (700.2a, 601.2b via 602.2b) ---
  if (t && t.choosingModes) {
    const card = findCard(g, t.cardId)!;
    const modal = activatedAt(g, card, t.activated)!.modes!;
    const legal = activatedModeOptions(g, me, card, t.activated);
    const picked = t.modes ?? [];
    view.glow.set(card.id, 'picked');
    view.abilityModes = { card, min: modal.min, max: modal.max, modes: modal.modes.map((m, i) => ({ text: m.text, picked: picked.includes(i), ok: legal.includes(i) })) };
    const many = modal.min === modal.max ? `${modal.min}` : `${modal.min} to ${modal.max}`;
    view.prompt = `${label(card)}: choose ${many} ${modal.max === 1 ? 'mode' : 'modes'}.`;
    view.primary = { label: 'Continue', tone: 'go', disabled: picked.length < modal.min || picked.length > modal.max, onClick: confirmAbilityModes };
    view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    return view;
  }

  // --- announcing X for an ability, before its targets (107.3a, 601.2b via 602.2b) ---
  if (t && t.choosingX) {
    const card = findCard(g, t.cardId)!;
    const ref = { ability: t.ability, activated: t.activated };
    const x = t.x ?? 0;
    const max = Math.max(0, maxAbilityX(g, me, card, ref));
    const walker = t.ability !== undefined;
    view.glow.set(card.id, 'picked');
    view.abilityX = { card, x, max };
    // A −X ability that removes every loyalty counter puts the planeswalker into its owner's graveyard (704.5i).
    const dies = walker && x >= loyaltyOf(card) ? ` ${label(card)} will have no loyalty left.` : '';
    view.prompt = walker
      ? `${label(card)}: choose X. It removes X loyalty counters (${loyaltyOf(card)} now).${dies}`
      : `${label(card)}: choose X. It costs ${costOf(g, t).text}.`;
    view.primary = { label: 'Continue', sub: `X = ${x}`, tone: 'go', disabled: !canActivate(g, me, card, t.ability, t.activated, x), onClick: confirmAbilityX };
    view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    return view;
  }

  // --- dividing the spell's damage among its targets (601.2d) ---
  if (t && isDividing(t)) {
    const card = findCard(g, t.cardId)!;
    const total = divideTotal(t)!;
    const draft = draftDivision(t);
    view.glow.set(card.id, 'picked');
    view.divide = { card, total, rows: t.chosen.map((ref, i) => ({ name: ref ? describeRef(g, ref) : '', amount: draft[i] })).filter((_, i) => !!t.chosen[i]) };
    view.prompt = `${label(card)}: divide ${total} damage among its targets. Each gets at least 1.`;
    const ok = divisionOk(scriptFor(asSpell(card, t.choices.face ?? 0)), t.choices.x ?? 0, t.chosen, draft);
    view.primary = { label: 'Continue', tone: 'go', disabled: !ok, onClick: confirmDivision };
    view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    return view;
  }

  // --- choosing what to sacrifice for an additional or alternative cost (118.8, 118.9) ---
  if (t && isSacrificing(t)) {
    const card = findCard(g, t.cardId)!;
    const need = sacrificeNeeds(t)[t.choices.sacrifice?.length ?? 0];
    for (const c of sacrificeOptionsFor(g, me, t, card, need.alt)) if (!t.choices.sacrifice?.includes(c.id)) view.glow.set(c.id, 'target');
    view.glow.set(card.id, 'picked');
    view.prompt = `${label(card)}: choose ${need.spec.label}${need.optional ? ', or none' : ''}.`;
    if (need.optional) view.primary = { label: 'No Sacrifice', tone: 'plain', onClick: skipSacrifice };
    view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    return view;
  }

  // --- choosing the other cards to exile for escape (702.138a) ---
  if (t && isEscaping(t)) {
    const card = findCard(g, t.cardId)!;
    const count = t.choices.escape!.length;
    view.glow.set(card.id, 'picked');
    view.escape = { card, options: escapeOptions(g, card), count };
    view.prompt = `${label(card)}: choose ${count} other cards in your graveyard to exile.`;
    view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    return view;
  }

  // --- choosing the unblocked attacking creature to return for ninjutsu (702.49a) ---
  if (t && isReturning(t)) {
    const card = findCard(g, t.cardId)!;
    for (const c of unblockedAttackers(g, me)) view.glow.set(c.id, 'target');
    view.glow.set(card.id, 'picked');
    view.prompt = `${label(card)}: choose an unblocked attacking creature you control to return to its owner's hand.`;
    view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    return view;
  }

  // --- choosing the cards in the graveyard to exile for an ability's cost (Matoc) ---
  if (t && isExilingGraveyard(t)) {
    const card = findCard(g, t.cardId)!;
    const count = activatedOf(t, card)!.cost.exileGraveyard!;
    view.glow.set(card.id, 'picked');
    view.graveCost = { card, options: [...p.graveyard], count };
    view.prompt = `${label(card)}: choose ${count} cards in your graveyard to exile.`;
    view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    return view;
  }

  // --- choosing the cards to exile for delve (702.66a) ---
  if (t && isDelving(t)) {
    const card = findCard(g, t.cardId)!;
    view.glow.set(card.id, 'picked');
    view.delve = { card, options: delveOptions(g, me, card).filter((x) => !t.choices.escape?.includes(x.id)), max: castCost(g, card, t.choices, me).generic };
    view.prompt = `${label(card)}: you may exile cards from your graveyard to pay for it (delve).`;
    view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    return view;
  }

  // --- choosing the cards to discard for an ability's cost ---
  if (t && isDiscarding(t)) {
    const card = findCard(g, t.cardId)!;
    for (const c of discardOptions(g, me, card, discardFilterOf(t, card))) if (!t.discard?.includes(c.id)) view.glow.set(c.id, 'target');
    view.glow.set(card.id, 'picked');
    view.prompt = `${label(card)}: choose a card in your hand to discard.`;
    view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    return view;
  }

  // --- choosing the card to exile for an alternative cost (118.9) ---
  if (t && isExiling(t)) {
    const card = findCard(g, t.cardId)!;
    const alt = alternativeCostAt(g, card, t.choices.face ?? 0, t.choices.alt, me)!;
    for (const c of exileOptions(g, me, card, t.choices.face ?? 0, t.choices.alt!)) view.glow.set(c.id, 'target');
    view.glow.set(card.id, 'picked');
    view.prompt = `${label(card)}: choose ${alt.exile!.label} in your hand to exile.`;
    view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    return view;
  }

  // --- choosing the permanent to exile for an ability's cost ---
  if (t && isExilingForAbility(t)) {
    const card = findCard(g, t.cardId)!;
    for (const c of activationExileOptions(g, me, card, t.activated)) view.glow.set(c.id, 'target');
    view.glow.set(card.id, 'picked');
    view.prompt = `${label(card)}: choose ${activatedOf(t, card)!.cost.exileOne!.label} to exile.`;
    view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    return view;
  }

  // --- picking the creatures that crew a Vehicle (702.122a) ---
  const need = t ? crewNeeded(t) : 0;
  const tapping = t && need ? activatedOf(t, findCard(g, t.cardId)!)?.cost.tapUntapped : undefined;
  if (t && need && tapping) {
    // "Tap three untapped Elves you control": exactly that many.
    const card = findCard(g, t.cardId)!;
    const picked = t.crew ?? [];
    for (const c of tapOptions(g, me, t, card)) view.glow.set(c.id, 'target');
    for (const id of picked) view.glow.set(id, 'picked');
    view.glow.set(card.id, picked.includes(card.id) ? 'picked' : view.glow.get(card.id) ?? 'picked');
    view.prompt = `Tap ${tapping.label ?? tapCostText(tapping).replace(/^Tap /, '')} (${picked.length} of ${need} chosen).`;
    view.primary = { label: 'Tap', sub: label(card), tone: 'go', disabled: picked.length !== need, onClick: confirmCrew };
    view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    return view;
  }
  if (t && need) {
    const card = findCard(g, t.cardId)!;
    const picked = (t.crew ?? []).map((id) => permanent(g, id)).filter((c) => c !== undefined);
    const power = crewPower(g, me, card, picked);
    for (const c of crewOptions(g, me, card)) view.glow.set(c.id, 'target');
    for (const c of picked) view.glow.set(c.id, 'picked');
    view.glow.set(card.id, 'picked');
    view.prompt = `Crew ${need}: tap creatures with total power ${need} or more (${power} so far).`;
    view.primary = { label: 'Crew', sub: label(card), tone: 'go', disabled: power < need, onClick: confirmCrew };
    view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    return view;
  }


  // --- paying for a spell or ability ---
  if (t && isPaying(t)) {
    const card = findCard(g, t.cardId)!;
    const { text } = costOf(g, t);
    const plan = planFor(g, me, t);
    const script = abilitiesOf(g, card);
    const ability = t.mode !== 'activate' ? undefined : t.ability === undefined ? activatedAt(g, card, t.activated) : (script.loyalty ?? script.levels)?.[t.ability];
    view.glow.set(card.id, 'picked');
    view.paying = { card, kind: ability ? 'ability' : 'spell' };
    // The sources auto-pay would tap. Tapping others by hand first changes the plan.
    for (const id of plan?.tap ?? []) view.glow.set(id, 'play');
    markMana(view, g, me);
    // A card in hand that makes mana from there can be used too, by hand only.
    for (const c of p.hand) if (view.mana.has(c.id)) view.glow.set(c.id, 'play');
    // Convoke (702.51a): the human can pick the creatures to tap; auto-pay picks any others.
    const convoking = !ability && hasConvoke(g, me, asSpell(card, t.choices.face ?? 0, me));
    if (convoking) {
      for (const c of convokeOptions(g, me, t)) if (!view.glow.has(c.id)) view.glow.set(c.id, 'target');
      for (const id of t.choices.convoke ?? []) view.glow.set(id, 'picked');
    }
    // Symbols that may be paid with 2 life instead of mana (Phyrexian mana, 107.4f; K'rrik's {B}):
    // the human chooses how many (601.2b); until they do, auto-pay uses life only where the mana isn't there.
    const { cost } = costOf(g, t);
    const able = lifeChoices(cost);
    if (able) {
      const auto = t.choices.payLife === undefined;
      view.payLife = { n: auto ? Math.max(0, Math.round(((plan?.life ?? 0) - cost.life) / 2)) : t.choices.payLife!, max: Math.min(able, Math.floor(p.life / 2)), auto };
    }
    const life = plan?.life ? ` (${view.payLife?.auto === false ? 'paying' : 'auto-pay uses'} ${plan.life} life)` : '';
    const convoke = convoking ? ` Click creatures to tap them for convoke${t.choices.convoke?.length ? ` (${t.choices.convoke.length} picked)` : ''}.` : '';
    view.prompt = ability
      ? `${label(card)} — ${ability.text}. Pay the cost${life}, or cancel.`
      : `Pay ${text}${life} to cast ${label(card)}, or cancel.${convoke}`;
    view.primary = { label: 'Pay', sub: ability ? 'Activate' : `Cast ${label(card)}`, tone: 'go', disabled: !plan, onClick: pay };
    view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    return view;
  }

  // --- choosing targets ---
  if (t) {
    const spec = t.specs[t.chosen.length];
    const options = currentTargets(g, me, t);
    for (const ref of options) {
      if (ref.kind === 'card') view.glow.set(ref.id, 'target');
      else if (ref.kind === 'stack') view.targetStack.add(ref.id);
      else view.targetPlayers.add(ref.id);
    }
    const source = sourceOf(g, t);
    // A card in a graveyard isn't on the table: it is picked from a window.
    if (spec?.type === 'graveyard card' && source) {
      view.graveTargets = { card: source, spec, options: options.map((r) => findCard(g, r.id as string)!).filter(Boolean) };
    }
    view.prompt = `${source ? label(source) : ''}: choose ${spec?.label ?? 'a target'}.`;
    if (t.mode !== 'trigger' && t.mode !== 'retarget') view.secondary = { label: 'Cancel', tone: 'cancel', onClick: cancel };
    if (spec?.optional) view.primary = { label: 'No Target', tone: 'plain', onClick: () => chooseTarget(null) };
    // "Any number of" targets (115.1d): as many as the human picks, none included.
    if (spec?.any && t.mode !== 'retarget') {
      const n = t.chosen.filter((_, i) => t.specs[i]?.any).length;
      const most = spec.most?.(g, targetSource(g, t));
      view.prompt = `${source ? label(source) : ''}: choose ${most !== undefined ? `up to ${most}` : 'any number'} of ${spec.label} (${n} so far).`;
      view.primary = { label: 'Done', sub: plural(n, 'target'), tone: 'go', onClick: finishAny };
    }
    if (t.mode === 'retarget') {
      // Any target may be left as it is (115.7d).
      const now = retargetItem(g)?.targets[t.chosen.length];
      if (g.decision?.type === 'retarget' && g.decision.choice.change) {
        // Changing it (115.7a): it must become another legal target.
        view.prompt = `${source ? label(source) : ''}: change its target${now ? ` from ${describeRef(g, now)}` : ''} to another ${spec?.label ?? 'target'}.`;
        view.primary = null;
      } else {
        view.prompt = `${source ? label(source) : ''}: choose a new target (${spec?.label ?? 'target'}), or keep ${now ? describeRef(g, now) : 'it'}.`;
        view.primary = { label: 'Keep Target', tone: 'plain', onClick: keepTarget };
      }
    }
    return view;
  }

  // --- things you can play (only with priority: the engine says no while a declaration is going on) ---
  // A graveyard card with flashback or escape, or an exiled card that may be cast or played,
  // can be cast too (702.34a, 702.138a, 715.3d).
  for (const c of castableCards(g, me)) if (canCast(g, me, c)) view.glow.set(c.id, 'play');
  for (const c of landCandidates(g, me)) if (canPlayLand(g, me, c)) view.glow.set(c.id, 'play');
  // A card that makes mana from the hand (Simian Spirit Guide), or has an ability that works from there (channel).
  if (!deciding) for (const c of p.hand) if (canTapForMana(g, me, c)) view.glow.set(c.id, 'play');
  // Or from the command zone (commander ninjutsu, 702.49d): the crown on the avatar.
  for (const c of [...p.hand, ...p.command]) if (activatable(g, me, c).length) view.glow.set(c.id, 'play');
  for (const c of p.battlefield) if (activatable(g, me, c).length) view.glow.set(c.id, 'play');
  if (!deciding) markMana(view, g, me);

  switch (deciding) {
    case undefined:
      priorityView(view, g, me, s.stops, s.fullControl);
      break;
    case 'attackers': {
      const target = attackTargetOf(g, me);
      view.attackTarget = target;
      const candidates = attackCandidates(g, me);
      const attacks = g.combat?.attacks ?? [];
      // A restriction may keep one from attacking what the attackers go after (508.1c): it doesn't glow.
      const barred = target ? candidates.filter((c) => attackForbidden(g, c, target.defender, target.target)) : [];
      for (const c of candidates) if (!barred.includes(c)) view.glow.set(c.id, 'attack');
      // Opponents, and the planeswalkers and battles that can be attacked (508.1b).
      for (const o of attackOptions(g, me)) {
        if (!o.target) view.targetPlayers.add(o.defender);
        else view.glow.set(o.target, target?.target === o.target ? 'picked' : 'target');
      }
      const walkers = attackOptions(g, me).some((o) => o.target);
      // A creature that attacks each combat if able goes in anyway if left out (508.1d).
      const must = candidates.filter((c) => has(g, c, MUST_ATTACK) && !attacks.some((a) => a.id === c.id));
      view.prompt =
        `Choose attackers — sending them at ${target ? attackName(g, target) : '?'}. Click an opponent${walkers ? ', planeswalker or battle' : ''} to switch.` +
        (must.length ? ` ${must.map(label).join(' and ')} must attack.` : '') +
        (barred.length && target ? ` ${barred.map(label).join(' and ')} can't attack ${attackName(g, target)}.` : '');
      // Attacks that cost mana, like those at a player with Propaganda (508.1g).
      const cost = attackCost(g, attacks);
      if (!isFree(cost)) view.prompt += ` Attacking costs ${costText(cost)}.`;
      // Symbols of it that may be paid with 2 life (K'rrik's {B}): the human chooses how many.
      const able = isFree(cost) ? 0 : lifeChoices(cost);
      if (able) {
        const plan = planPayment(g, me, { ...cost, lifeSymbols: s.attackPayLife }, undefined, attacks.map((a) => a.id));
        view.payLife = { n: s.attackPayLife ?? Math.max(0, Math.round(((plan?.life ?? 0) - cost.life) / 2)), max: Math.min(able, Math.floor(p.life / 2)), auto: s.attackPayLife === undefined };
      }
      if (attacks.length) {
        view.primary = { label: plural(attacks.length, 'Attacker'), sub: isFree(cost) ? 'Attack' : `Pay ${costText(cost)} and attack`, tone: 'attack', onClick: () => S().act({ type: 'pass', payLife: S().attackPayLife }) };
        view.secondary = {
          label: 'Cancel Attacks',
          tone: 'plain',
          onClick: () => attacks.forEach((a) => S().act({ type: 'undeclareAttack', card: a.id })),
        };
      } else {
        view.primary = {
          label: 'All Attack',
          tone: 'attack',
          onClick: () => target && declareAll(candidates.map((c) => c.id), target),
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
    case 'assignDamage':
      view.prompt = 'Divide your attackers\' combat damage.';
      break;
    case 'discard': {
      const n = p.hand.length - maxHandSize(g, me);
      for (const c of p.hand) view.glow.set(c.id, 'discard');
      view.prompt = `Discard ${plural(n, 'card')} — drag ${n === 1 ? 'it' : 'them'} out of your hand.`;
      view.primary = { label: `Discard ${n}`, tone: 'plain', disabled: true, onClick: () => {} };
      break;
    }
  }
  return view;
}

/** What the pass button says it goes to: a step's short name. */
const STEP_SHORT: Partial<Record<Step, string>> = {
  upkeep: 'Upkeep',
  draw: 'Draw',
  main1: 'Main 1',
  beginCombat: 'Combat',
  attackers: 'Attackers',
  blockers: 'Blockers',
  damage: 'Damage',
  endCombat: 'End of Combat',
  main2: 'Main 2',
  end: 'End Step',
};

/**
 * Why the game stopped for the human when it was only because they could act (an `ifAble`
 * stop, or someone else's spell to respond to): what they could do, as "cast Solitude".
 * A pitch spell with flash can be cast in every step, so it is worth saying.
 */
function couldDo(g: Game, me: PlayerId): string | null {
  const { cast, activate, play } = actionsFor(g, me);
  const ways = [...new Set([...cast.map((c) => `cast ${label(c)}`), ...activate.map((c) => `activate ${label(c)}`), ...play.map((c) => `play ${label(c)}`)])];
  if (!ways.length) return null;
  return ways.length <= 2 ? ways.join(' or ') : `${ways.slice(0, 2).join(', ')} or ${ways.length - 2} more`;
}

/**
 * Prompt and button for when the human has priority. The button always passes it, and says
 * where to. In full control (`full`) the game stops at every step, and the prompt says so
 * where that is the only reason it stopped.
 */
function priorityView(view: View, g: Game, me: PlayerId, stops: Stops, full: boolean) {
  const top = g.stack[g.stack.length - 1];
  const myTurn = g.active === me;
  const mine = absoluteStops(stops, me, g.players.length);
  const onlyFull = full && !wantsPriority(g, me, mine);
  const tag = onlyFull ? 'Full control. ' : '';
  if (top) {
    const whose = top.controller === me ? 'your' : `${g.players[top.controller].name}'s`;
    // Stopped because they could respond: say with what.
    const could = !onlyFull && top.controller !== me && g.holding !== me ? couldDo(g, me) : null;
    view.prompt = `${tag}Respond to ${whose} ${label(top.card)}${could ? ` (you could ${could})` : ''}, or let it resolve.`;
    view.primary = { label: 'Resolve', sub: label(top.card), tone: 'go', onClick: pass };
    return;
  }
  // A stop that waits for the human to be able to act: say what they could do.
  const could = !onlyFull && mine[g.active]?.[g.step] === 'ifAble' ? couldDo(g, me) : null;
  const act = could ? `You could ${could}` : 'Cast instants';
  if (myTurn && g.step === 'beginCombat') view.prompt = `${tag}Beginning of combat. ${act}, or go on to declare attackers.`;
  else if (myTurn && g.step === 'blockers') view.prompt = `${tag}Blockers are declared. ${act}, or continue to combat damage.`;
  else if (!(myTurn && (g.step === 'main1' || g.step === 'main2'))) {
    // Any other step is one the human set a stop in, or one full control stops in.
    const turn = myTurn ? 'Your turn' : `${g.players[g.active].name}'s turn`;
    const when = g.step === 'attackers' && g.combat?.attacks.length ? 'attackers are declared' : g.step === 'blockers' ? 'blockers are declared' : STEP_NAMES[g.step].toLowerCase();
    view.prompt = `${tag}${turn}, ${when}. ${act}, or pass.`;
  } else if (onlyFull) view.prompt = `Full control. Your ${STEP_NAMES[g.step].toLowerCase()}.`;
  const to = nextStop(g, me, mine, full);
  const tone = to === 'attackers' || to === 'blockers' || to === 'damage' ? 'attack' : 'go';
  view.primary = to
    ? { label: 'Next', sub: `To ${STEP_SHORT[to]}`, tone, onClick: pass }
    : myTurn
      ? { label: 'End Turn', tone: 'go', onClick: pass }
      : { label: 'Pass', sub: 'To Next Turn', tone: 'go', onClick: pass };
}

// ---------- click handlers ----------

/**
 * Starts a spell or ability. This is a proposal (601.2): the human chooses targets, then
 * pays. It all lives in the UI until the cost is paid, so backing out at any point leaves
 * the game as if the spell was never started (733.1).
 */
function propose(mode: 'cast' | 'activate', card: Card, mana = false) {
  const g = S().game!;
  const me = S().human!;
  // A planeswalker or Class, or a permanent with several abilities that could be activated, its
  // mana abilities among them (`mana`): choose which one first (602, 605, 606, 716.2).
  const refs = mode === 'activate' ? activatable(g, me, card) : [];
  if (mana || refs.length > 1 || refs.some((r) => r.ability !== undefined)) {
    useStore.setState({ targeting: { mode, cardId: card.id, specs: [], chosen: [], tapped: [], choices: {}, announcing: false, pickingAbility: true }, hover: null });
    return;
  }
  // Start on the first face that can be cast now (a split card's left half, an adventurer's creature).
  const options = mode === 'cast' ? playOptions(g, me, card) : [];
  const face = options.find((o) => o.ok)?.face ?? 0;
  const choices = mode === 'cast' ? defaultChoices(g, me, card, face) : {};
  const only = refs[0]?.activated;
  const specs = mode === 'cast' ? castTargets(card, undefined, face, undefined, choices.alt) : (activatedAt(g, card, only)?.targets ?? []);
  const script = scriptFor(asSpell(card, face));
  const hasX = mode === 'cast' && (script.additionalCost?.life === 'x' || (!paysFlashback(g, card, choices) && parseCost(data(asSpell(card, face)).manaCost).x > 0));
  const siege = mode === 'cast' && isSiege(g, asSpell(card, face));
  const handMana = mode === 'cast' && card.zone === 'hand' && canTapForMana(g, me, card);
  const fromHand = mode === 'cast' && !!handAbility(g, me, card);
  const ways = mode === 'cast' && card.zone === 'graveyard' ? graveyardWays(g, card, face) : null;
  const announcing =
    mode === 'cast' &&
    (options.length > 1 ||
      landPlayOptions(g, me, card).length > 1 ||
      hasX ||
      !!script.kicker ||
      !!script.offspring ||
      !!script.additionalCost?.oneOf ||
      altCostsOf(g, card, face, me).length > 0 ||
      !!script.modal ||
      !!script.gift ||
      handMana ||
      fromHand ||
      canPlot(g, me, card) ||
      (!!ways && (ways.flashback || ways.aftermath || ways.permitted) && ways.escape) ||
      playPermissions(g, me, card).filter((x) => x.p.cast).flatMap((x) => x.p.slots ?? [undefined]).length + (ways && (ways.flashback || ways.aftermath || ways.permitted || ways.escape) ? 1 : card.zone === 'graveyard' || card.zone === 'library' ? 0 : ownRightToCast(g, me, card) ? 1 : 0) > 1 ||
      escapes(g, card).filter((e) => escapeOptions(g, card).length >= e.exile).length > 1 ||
      (siege && opponentsOf(g, me).length > 1));
  const start: Targeting = { mode, cardId: card.id, specs, chosen: [], tapped: [], choices, announcing, ...(only ? { activated: only } : {}) };
  if (mode === 'activate' && refs[0] && activatedAt(g, card, only)?.modes) chooseAbilityModes(start);
  else if (mode === 'activate' && refs[0] && abilityHasX(g, card, refs[0])) chooseX(start);
  else advance(start);
}

/** A modal ability: its modes are chosen first (700.2a), before X and the targets (601.2b-c via 602.2b). */
function chooseAbilityModes(t: Targeting) {
  useStore.setState({ targeting: { ...t, modes: [], choosingModes: true }, hover: null });
}

/** Picks a mode of the ability being activated, or takes it back out; with "choose one", the new pick replaces the old. */
export function pickAbilityMode(i: number) {
  const t = S().targeting;
  const { game: g, human: me } = S();
  if (!t || !t.choosingModes || !g || me === null) return;
  const card = findCard(g, t.cardId)!;
  const modal = activatedAt(g, card, t.activated)?.modes;
  if (!modal || !activatedModeOptions(g, me, card, t.activated).includes(i)) return;
  let modes = [...(t.modes ?? [])];
  if (modes.includes(i)) modes = modes.filter((x) => x !== i);
  else {
    if (modes.length >= modal.max) modes.shift();
    modes.push(i);
  }
  useStore.setState({ targeting: { ...t, modes: modes.sort((a, b) => a - b) } });
}

/** Done choosing the modes: on to X, then the targets of the modes chosen (700.2c). */
function confirmAbilityModes() {
  const t = S().targeting;
  const { game: g, human: me } = S();
  if (!t || !t.choosingModes || !g || me === null) return;
  const card = findCard(g, t.cardId)!;
  const modal = activatedAt(g, card, t.activated)!.modes!;
  const specs = (t.modes ?? []).flatMap((i) => modal.modes[i].targets ?? []);
  const next = stepFrom(t, { choosingModes: false, specs });
  if (abilityHasX(g, card, { ability: t.ability, activated: t.activated })) chooseX(next);
  else advance(next);
}

/** An ability with X in its cost: X is announced first, starting as high as it can be (107.3a). */
function chooseX(t: Targeting) {
  const { game: g, human: me } = S();
  const card = g && findCard(g, t.cardId);
  if (!card || me === null) return;
  const x = Math.max(0, maxAbilityX(g, me, card, { ability: t.ability, activated: t.activated }));
  useStore.setState({ targeting: { ...t, x, choosingX: true }, hover: null });
}

/** Changes the X being announced for an ability, within what can be paid. */
export function setAbilityX(x: number) {
  const t = S().targeting;
  const { game: g, human: me } = S();
  if (!t || !t.choosingX || !g || me === null) return;
  const max = Math.max(0, maxAbilityX(g, me, findCard(g, t.cardId)!, { ability: t.ability, activated: t.activated }));
  useStore.setState({ targeting: { ...t, x: Math.max(0, Math.min(x, max)) } });
}

/** Done announcing X: on to the ability's targets (601.2c via 602.2b). */
function confirmAbilityX() {
  const t = S().targeting;
  if (t?.choosingX) advance(stepFrom(t, { choosingX: false }));
}

/**
 * Where announcing starts for casting `card` as `face`: a cost that can be paid (the mana
 * cost if it can, else the first alternative), X as high as it can pay, and for a Siege
 * the protector the engine would pick (310.12a).
 */
function defaultChoices(g: Game, me: PlayerId, card: Card, face: number): CastChoices {
  // From a graveyard: flashback if it can, else escape (702.34a, 702.138a).
  const ways = card.zone === 'graveyard' ? graveyardWays(g, card, face) : null;
  const ability = escapes(g, card).find((e) => escapeOptions(g, card).length >= e.exile);
  const escape = ways && ways.escape && ability && !ways.flashback && !ways.aftermath && !ways.permitted ? escapeSlots(ability.exile) : undefined;
  const spell = asSpell(card, face, me);
  // "Pay 5 life or pay {2}": the first of the additional costs it offers that can be paid.
  const oneOf = scriptFor(asSpell(card, face)).additionalCost?.oneOf;
  const canDiscard = (i: number) => discardOptions(g, me, card).length >= discardsFor(scriptFor(asSpell(card, face)), i);
  const extra = oneOf ? Math.max(0, oneOf.findIndex((_, i) => canDiscard(i) && planPayment(g, me, castCost(g, card, { face, escape, extra: i }, me), spell))) : undefined;
  const alts = ways ? [] : altCostsOf(g, card, face, me);
  const alt = planPayment(g, me, castCost(g, card, { face, escape, extra }, me), spell) && !castsForAlt(g, card) ? undefined : alts.find((i) => planPayment(g, me, castCost(g, card, { alt: i, face, extra }, me), spell));
  // Cast only by a permanent's permission (Muldrotha, Glarb, Maralen): start on the first use that can be paid.
  const permits = playPermissions(g, me, card).filter((x) => x.p.cast).flatMap((x): { permit: string; slot: string | undefined }[] => (x.p.slots ? x.p.slots.map((slot) => ({ permit: x.source.id, slot })) : [{ permit: x.source.id, slot: undefined }]));
  const ownWay = ways ? ways.flashback || ways.aftermath || ways.permitted || (ways.escape && !!escape) : ownRightToCast(g, me, card);
  const permit = !ownWay ? (permits.find((pm) => planPayment(g, me, castCost(g, card, { face, extra, permit: pm.permit, slot: pm.slot }, me), spell)) ?? permits[0]) : undefined;
  // An X paid in life ("pay X life", Toxic Deluge) starts at 0, not at all the player's life.
  const hasX = !paysFlashback(g, card, { face, escape }) && parseCost(data(asSpell(card, face)).manaCost).x > 0;
  const landWays = landFaces(g, card).includes(face) && !castFaces(card).includes(face) ? landPlayOptions(g, me, card) : [];
  const choices: CastChoices = {
    ...(landWays.length > 1 ? { permit: landWays[0].permit } : {}),
    alt: permit ? undefined : alt,
    x: hasX && alt === undefined && !permit ? Math.max(0, maxX(g, me, card, { alt, face, escape, extra })) : permit ? 0 : (alternativeCostAt(g, card, face, alt, me)?.minX ?? 0),
    kicked: 0,
    ...(escape && !permit ? { escape } : {}),
    ...(extra !== undefined ? { extra } : {}),
    ...(permit ? { permit: permit.permit, ...(permit.slot !== undefined ? { slot: permit.slot } : {}) } : {}),
  };
  if (face) choices.face = face;
  if (isSiege(g, spell)) choices.protector = defaultProtector(g, spell) ?? undefined;
  return choices;
}

/** Switches the face being announced (709.3, 712.11b, 715.3): the other choices start over for it. */
export function pickFace(face: number) {
  const t = S().targeting;
  const { game: g, human: me } = S();
  if (!t || !t.announcing || !g || me === null) return;
  const card = findCard(g, t.cardId)!;
  useStore.setState({ targeting: { ...t, choices: defaultChoices(g, me, card, face) } });
}

/**
 * Chooses how many of the cost's symbols that may be paid with 2 life instead of mana are paid
 * with life (601.2b; Phyrexian mana, 107.4f; K'rrik): while paying for a spell or ability, or
 * while declaring attackers whose cost has such symbols. `null` leaves it to auto-pay.
 */
export function setPayLife(n: number | null) {
  const t = S().targeting;
  const { game: g, human: me } = S();
  if (!g || me === null) return;
  if (t && isPaying(t) && t.mode !== 'trigger') {
    const payLife = n === null ? undefined : Math.max(0, n);
    const next = stepFrom(t, { choices: { ...t.choices, payLife } });
    useStore.setState({ targeting: next });
  } else if (!t && g.decision?.type === 'attackers' && g.priority === me) useStore.setState({ attackPayLife: n === null ? undefined : Math.max(0, n) });
}

/** Changes what the human is announcing for the spell: X, kicker, or which cost. X is kept within what can be paid. */
export function setChoices(change: CastChoices) {
  const t = S().targeting;
  const { game: g, human: me } = S();
  if (!t || !t.announcing || !g || me === null) return;
  const card = findCard(g, t.cardId)!;
  let choices = { ...t.choices, ...change };
  const most = Math.max(0, maxX(g, me, card, { ...choices, x: 0 }));
  // An alternative cost with a least X (Henzie's blitz, 202.3e) starts X there and keeps it there.
  const least = alternativeCostAt(g, card, choices.face ?? 0, choices.alt, me)?.minX ?? 0;
  if (choices.x !== undefined || least) choices = { ...choices, x: Math.max(least, Math.min(choices.x ?? 0, most)) };
  useStore.setState({ targeting: { ...t, choices } });
}

/**
 * Picks a mode of a modal spell, or another copy of it if the spell allows repeats
 * (700.2d); `-1` takes one back. Picking past the most allowed drops the first mode
 * picked, so "choose one" works like radio buttons.
 */
export function pickMode(i: number, delta: 1 | -1 = 1) {
  const t = S().targeting;
  const g = S().game;
  if (!t || !t.announcing || !g) return;
  const modal = scriptFor(asSpell(findCard(g, t.cardId)!, t.choices.face)).modal!;
  let modes = [...(t.choices.modes ?? [])];
  if (delta < 0) modes.splice(modes.indexOf(i), 1);
  else if (!modal.repeat && modes.includes(i)) modes = modes.filter((x) => x !== i);
  else {
    if (modes.length >= maxModes(g, S().human ?? 0, findCard(g, t.cardId)!)) modes.shift();
    modes.push(i);
  }
  setChoices({ modes: [...modes].sort((a, b) => a - b) });
}

/** Picks which ability of the card is being activated (a loyalty ability, a level, or one of several): on to its targets. */
export function pickAbility(ref: AbilityRef) {
  const t = S().targeting;
  const { game: g, human: me } = S();
  if (!t || !t.pickingAbility || !g || me === null) return;
  const card = findCard(g, t.cardId)!;
  if (!activatable(g, me, card).some((r) => r.ability === ref.ability && (r.activated ?? 0) === (ref.activated ?? 0))) return;
  const specs = ref.ability === undefined ? (activatedAt(g, card, ref.activated)?.targets ?? []) : (abilitiesOf(g, card).loyalty?.[ref.ability].targets ?? []);
  const next = stepFrom(t, { pickingAbility: false, ability: ref.ability, activated: ref.activated, specs });
  if (ref.ability === undefined && activatedAt(g, card, ref.activated)?.modes) chooseAbilityModes(next);
  else if (abilityHasX(g, card, ref)) chooseX(next);
  else advance(next);
}

/** Done announcing: on to targets, which depend on the modes chosen (601.2c, 700.2c). */
function confirmAnnounce() {
  const t = S().targeting;
  const { game: g, human: me } = S();
  if (!t || !g || me === null) return;
  const card = findCard(g, t.cardId)!;
  const face = t.choices.face ?? 0;
  // A modal double-faced card's land face is played, not cast (712.12).
  if (landFaces(g, card).includes(face) && !castFaces(card).includes(face)) {
    useStore.setState({ targeting: null });
    S().act({ type: 'playLand', card: card.id, face, ...(t.choices.permit !== undefined ? { permit: t.choices.permit } : {}) });
    return;
  }
  advance(stepFrom(t, { announcing: false, specs: castTargets(card, t.choices.modes, face, t.choices.gift, t.choices.alt) }));
}

/** From the prompt's cast options: use the card's ability that works from the hand (channel) instead of playing it. */
export function activateFromHand() {
  const t = S().targeting;
  const g = S().game;
  if (!t || !t.announcing || !g) return;
  const card = findCard(g, t.cardId);
  useStore.setState({ targeting: null });
  if (card) propose('activate', card);
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
  let specs = t.specs;
  let anyDone = t.anyDone;
  // A slot with nothing legal is left empty, or for new targets, left as it was (115.7d).
  // "Any number of" targets with nothing more to pick are done (115.1d).
  const keep = (i: number) => (t.mode === 'retarget' ? (retargetItem(g)?.targets[i] ?? null) : null);
  while (chosen.length < specs.length && currentTargets(g, me, { ...t, chosen, specs }).length === 0) {
    if (specs[chosen.length].any && t.mode !== 'retarget') {
      specs = specs.slice(0, chosen.length);
      anyDone = true;
    } else chosen = [...chosen, keep(chosen.length)];
  }
  const next = { ...t, chosen, specs, ...(anyDone ? { anyDone } : {}) };
  if ((t.mode !== 'trigger' && t.mode !== 'retarget') || chosen.length < specs.length) {
    useStore.setState({ targeting: next, hover: null });
    // A loyalty ability has nothing to pay in mana: it is activated as soon as its targets are chosen.
    if (t.ability !== undefined && chosen.length === specs.length && costOf(g, next).text === '{0}') pay();
    return;
  }
  useStore.setState({ targeting: null });
  S().act({ type: 'chooseTargets', targets: chosen });
}

/** Pays for the proposed spell or ability, which puts it on the stack. Mana in the pool is spent first, then auto-pay taps the rest. */
function pay() {
  const t = S().targeting;
  if (!t || !isPaying(t) || t.mode === 'trigger') return;
  const hold = S().hold;
  // One use, back to the default: on in full control.
  useStore.setState({ hold: S().fullControl });
  // A spell dividing damage with one target gives it all (601.2d).
  const total = divideTotal(t);
  const single = total !== null && !t.choices.divide && t.chosen.some(Boolean) ? { divide: t.chosen.map((ref) => (ref ? total : 0)) } : {};
  const action: Action =
    t.mode === 'cast'
      ? { type: 'cast', card: t.cardId, targets: t.chosen, hold, ...t.choices, ...single, ...(t.discard ? { discard: t.discard } : {}) }
      : { type: 'activate', card: t.cardId, ability: t.ability, activated: t.activated, x: t.x, targets: t.chosen, hold, crew: t.crew, discard: t.discard, sacrifice: t.choices.sacrifice, exile: t.exile, graveyard: t.graveyard, returnAttacker: t.returnAttacker, payLife: t.choices.payLife, ...(t.modes ? { modes: t.modes } : {}) };
  if (!S().act(action)) cancel();
}

/** Taps or untaps a mana source while paying. Once the pool covers the whole cost, the spell is paid for. */
function payByHand(g: Game, me: PlayerId, t: Targeting, card: Card) {
  if ((card.zone === 'battlefield' ? card.controller : card.owner) !== me) return;
  if (canTapForMana(g, me, card)) {
    const tapped = tapByHand(g, me, card);
    if (!tapped) return;
    const next = stepFrom(t, { tapped: [...t.tapped, tapped] });
    useStore.setState({ targeting: next });
    if (paidUp(S().game!, me, next)) pay();
  } else if (canUntapMana(g, me, card) && S().act({ type: 'untapMana', card: card.id })) {
    useStore.setState({ targeting: untappedIn(t, card.id) });
  }
}

/**
 * `t` and the steps before it, with the mana source `id` no longer tapped for it: the human
 * took its mana back by hand. A step that did nothing but tap it is gone, so Ctrl+Z doesn't
 * spend a press on it.
 */
function untappedIn(t: Targeting, id: string): Targeting {
  const tapped = t.tapped.filter((x) => x !== id);
  if (!t.prev) return { ...t, tapped };
  const prev = untappedIn(t.prev, id);
  // A step that tapped mana changed nothing else (`payByHand`, `pickMana`).
  if (t.tapped.length > t.prev.tapped.length && tapped.length === prev.tapped.length) return prev;
  return { ...t, tapped, prev };
}

/** Adds a creature to the crew, or takes it back out. */
function pickCrew(g: Game, me: PlayerId, t: Targeting, card: Card) {
  const vehicle = findCard(g, t.cardId)!;
  if (!tapOptions(g, me, t, vehicle).some((c) => c.id === card.id)) return;
  const crew = t.crew ?? [];
  // No more than a "Tap N untapped ..." cost taps.
  const tapping = activatedOf(t, vehicle)?.cost.tapUntapped;
  const most = tapping && (tapping.count ?? 1);
  if (most !== undefined && !crew.includes(card.id) && crew.length >= most) return;
  useStore.setState({ targeting: stepFrom(t, { crew: crew.includes(card.id) ? crew.filter((id) => id !== card.id) : [...crew, card.id] }) });
}

/** Done picking the crew: on to paying, which for crew alone costs nothing, so it goes straight on the stack. */
function confirmCrew() {
  const t = S().targeting;
  const g = S().game;
  const me = S().human;
  if (!t || !g || me === null) return;
  const next = stepFrom(t, { crewDone: true });
  useStore.setState({ targeting: next });
  if (paidUp(g, me, next)) pay();
}

/** Picks the card in hand to exile for the spell's alternative cost (118.9). Paying comes next. */
function chooseExile(g: Game, me: PlayerId, t: Targeting, card: Card) {
  const spell = findCard(g, t.cardId)!;
  if (!exileOptions(g, me, spell, t.choices.face ?? 0, t.choices.alt!).some((c) => c.id === card.id)) return;
  const next = stepFrom(t, { choices: { ...t.choices, exile: [card.id] } });
  useStore.setState({ targeting: next });
  // An alternative cost with no mana, like Force of Will's, is paid as soon as the card is picked.
  if (paidUp(g, me, next)) pay();
}

/** Picks the permanent to sacrifice for the spell's next sacrifice cost (118.8, 118.9). Paying comes next. */
function chooseSacrifice(g: Game, me: PlayerId, t: Targeting, card: Card) {
  const spell = findCard(g, t.cardId)!;
  const picked = t.choices.sacrifice ?? [];
  const need = sacrificeNeeds(t)[picked.length];
  if (!need || picked.includes(card.id) || !sacrificeOptionsFor(g, me, t, spell, need.alt).some((c) => c.id === card.id)) return;
  const next = stepFrom(t, { choices: { ...t.choices, sacrifice: [...picked, card.id] } });
  useStore.setState({ targeting: next });
  // A cost that is only a sacrifice, like Flare of Duplication's, is paid as soon as it is picked.
  if (isPaying(next) && paidUp(g, me, next)) pay();
}

/** What the next sacrifice cost can take: a spell's (118.8, 118.9) or an ability's. */
const sacrificeOptionsFor = (g: Game, me: PlayerId, t: Targeting, card: Card, alt: number | undefined) =>
  t.mode === 'activate' ? activationSacrificeOptions(g, me, card, t.activated) : sacrificeOptions(g, me, card, t.choices.face ?? 0, alt);

/** Picks the unblocked attacking creature to return to its owner's hand for a ninjutsu cost (702.49a). Paying comes next. */
function chooseReturn(g: Game, me: PlayerId, t: Targeting, card: Card) {
  if (!unblockedAttackers(g, me).some((c) => c.id === card.id)) return;
  const next = stepFrom(t, { returnAttacker: card.id });
  useStore.setState({ targeting: next });
  if (isPaying(next) && paidUp(g, me, next)) pay();
}

/** Picks the permanent to exile for an ability's "Exile a creature you control" cost. Paying comes next. */
function chooseAbilityExile(g: Game, me: PlayerId, t: Targeting, card: Card) {
  const source = findCard(g, t.cardId)!;
  if (!activationExileOptions(g, me, source, t.activated).some((c) => c.id === card.id)) return;
  const next = stepFrom(t, { exile: [card.id] });
  useStore.setState({ targeting: next });
  if (isPaying(next) && paidUp(g, me, next)) pay();
}

/** Untapped creatures the human could tap for convoke (702.51a) while paying for a spell: not ones it sacrifices. */
function convokeOptions(g: Game, me: PlayerId, t: Targeting): Card[] {
  const card = findCard(g, t.cardId);
  if (!card || t.mode !== 'cast' || !hasConvoke(g, me, asSpell(card, t.choices.face ?? 0, me))) return [];
  return g.players[me].battlefield.filter((c) => !c.tapped && isCreature(g, c) && !t.choices.sacrifice?.includes(c.id));
}

/**
 * Picks a creature to tap for convoke, or takes it back (702.51a). A creature that would
 * pay for nothing more isn't added. Once the creatures and the pool cover the cost, it is paid.
 */
function pickConvoke(g: Game, me: PlayerId, t: Targeting, card: Card): boolean {
  if (!convokeOptions(g, me, t).some((c) => c.id === card.id)) return false;
  const picked = t.choices.convoke ?? [];
  const convoke = picked.includes(card.id) ? picked.filter((id) => id !== card.id) : [...picked, card.id];
  const next = stepFrom(t, { choices: { ...t.choices, convoke } });
  if (!planFor(g, me, next)) return true;
  useStore.setState({ targeting: next });
  if (!picked.includes(card.id) && paidUp(g, me, next)) pay();
  return true;
}

/** Done picking "any number of" targets (115.1d): the empty slot goes, and the spell or ability moves on. */
function finishAny() {
  const t = targetingOf(S());
  if (!t) return;
  advance(stepFrom(t, { specs: t.specs.slice(0, t.chosen.length), anyDone: true }));
}

/** Doesn't pay an optional sacrifice, like bargain (702.166a). */
function skipSacrifice() {
  const t = S().targeting;
  if (t) useStore.setState({ targeting: stepFrom(t, { sacrificeDone: true }) });
}

/** Picks the other cards to exile for escape, as many as its escape ability says (702.138a). Paying comes next. */
export function chooseEscape(ids: string[]) {
  const t = S().targeting;
  const { game: g, human: me } = S();
  if (!t || !g || me === null || !isEscaping(t) || ids.length !== t.choices.escape!.length) return;
  const next = stepFrom(t, { choices: { ...t.choices, escape: ids } });
  useStore.setState({ targeting: next });
  if (paidUp(g, me, next)) pay();
}

/** Moves damage to or from the `row`th target being divided among (601.2d). Each keeps at least 1. */
export function shiftDivision(row: number, delta: 1 | -1) {
  const t = S().targeting;
  if (!t || !isDividing(t)) return;
  const draft = [...draftDivision(t)];
  const at = t.chosen.map((ref, i) => (ref ? i : -1)).filter((i) => i >= 0);
  const i = at[row];
  if (i === undefined || draft[i] + delta < 1) return;
  // Taken from, or given to, the first other target that can spare it.
  const other = at.find((j) => j !== i && draft[j] - delta >= 1);
  if (other === undefined) return;
  draft[i] += delta;
  draft[other] -= delta;
  useStore.setState({ targeting: { ...t, dividing: draft } });
}

/** Done dividing the damage (601.2d). Paying comes next. */
function confirmDivision() {
  const t = S().targeting;
  const { game: g, human: me } = S();
  if (!t || !g || me === null || !isDividing(t)) return;
  const next = stepFrom(t, { choices: { ...t.choices, divide: draftDivision(t) } });
  useStore.setState({ targeting: next });
  if (isPaying(next) && paidUp(g, me, next)) pay();
}

/** Picks the cards in the graveyard to exile for an ability's cost (Matoc). Paying comes next. */
export function chooseGraveCost(ids: string[]) {
  const t = S().targeting;
  const { game: g, human: me } = S();
  if (!t || !g || me === null || !isExilingGraveyard(t)) return;
  const next = stepFrom(t, { graveyard: ids });
  useStore.setState({ targeting: next });
  if (isPaying(next) && paidUp(g, me, next)) pay();
}

/** Picks the cards to exile for delve, maybe none (702.66a). Paying comes next. */
export function chooseDelve(ids: string[]) {
  const t = S().targeting;
  const { game: g, human: me } = S();
  if (!t || !g || me === null || !isDelving(t)) return;
  const next = stepFrom(t, { choices: { ...t.choices, delve: ids } });
  useStore.setState({ targeting: next });
  if (paidUp(g, me, next)) pay();
}

/** Picks a card in the hand to discard for an ability's cost. Paying comes next. */
function chooseDiscard(g: Game, me: PlayerId, t: Targeting, card: Card) {
  const source = findCard(g, t.cardId)!;
  if (!discardOptions(g, me, source, discardFilterOf(t, source)).some((c) => c.id === card.id) || t.discard?.includes(card.id)) return;
  const next = stepFrom(t, { discard: [...(t.discard ?? []), card.id] });
  useStore.setState({ targeting: next });
  if (isPaying(next) && paidUp(g, me, next)) pay();
}

/** For new targets (115.7d): leaves the current one as it is. */
function keepTarget() {
  const s = S();
  const t = targetingOf(s);
  const g = s.game;
  if (!t || t.mode !== 'retarget' || !g) return;
  advance(stepFrom(t, { chosen: [...t.chosen, retargetItem(g)?.targets[t.chosen.length] ?? null] }));
}

/** Picks a card in a graveyard as the target (Sevinne's Reclamation). */
export function chooseGraveyardTarget(id: string) {
  chooseTarget({ kind: 'card', id });
}

/** A cost that taps untapped permanents (`TapUntapped`) as a card says it: "Tap two untapped tokens you control". */
export function tapCostText(t: TapUntapped): string {
  const n = t.count ?? 1;
  const noun = t.token ? 'token' : t.type === '' ? 'permanent' : (t.type ?? 'Creature').toLowerCase();
  const count = n === 1 ? 'an' : (['', 'one', 'two', 'three', 'four', 'five'][n] ?? String(n));
  return `Tap ${count} untapped ${t.legendary ? 'legendary ' : ''}${noun}${n === 1 ? '' : 's'} you control`;
}

/** What using a mana ability costs and does besides making mana, as its text would say it: "{U/B}, {T}", "{T}, 1 damage to you". */
function manaAbilityText(card: Card, ab: ManaUse): string {
  const parts = [
    ...(ab.cost ? [ab.cost] : []),
    ...(ab.fromHand ? ['Exile it from your hand'] : ab.noTap ? [] : ['{T}']),
    ...(ab.tapCreature ? [tapCostText(ab.tapCreature)] : []),
    ...(ab.life ? [`Pay ${ab.life} life`] : []),
    ...(ab.discard ? ['Discard a card'] : []),
    ...(ab.sacrificeCreature ? ['Sacrifice a creature'] : []),
    ...(ab.discardHand ? ['Discard your hand'] : []),
    ...(ab.sacrifice ? [`Sacrifice ${label(card)}`] : []),
  ];
  const notes = [
    ...(ab.damage ? [`${ab.damage} damage to you`] : []),
    ...(ab.chosenType && card.chosen ? [`${card.chosen} creature spells only`] : []),
    ...(ab.legendary ? ['legendary spells only'] : []),
    ...(ab.types ? [`${ab.types.map((t) => t.toLowerCase()).join(' and ')} spells only`] : []),
    ...(ab.subtype ? [`${ab.subtype} spells only`] : []),
  ];
  return [parts.join(', ') || 'Add', ...notes].join(' · ');
}

/** The ways the human could use the mana abilities of `card` by hand right now: each ability, and each choice of mana it can make. */
export function manaOptions(g: Game, me: PlayerId, card: Card): ManaOption[] {
  return manaAbilities(g, card)
    .filter((ab) => canTapForMana(g, me, card, ab.index))
    .map((ab) => {
      const creatures = tapCandidates(g, me, ab, card).map((c) => c.id);
      const tapCount = ab.tapCreature?.count ?? 1;
      // "Discard a card" (Skirge Familiar): the card to discard is picked with the mana.
      const discards = ab.discard ? g.players[me].hand.filter((c) => c.id !== card.id).map((c) => c.id) : [];
      // "Sacrifice a creature" (Phyrexian Tower): the creature too.
      const sacrifices = ab.sacrificeCreature ? creaturesOf(g, me).map((c) => c.id) : [];
      return {
        ability: ab.index,
        text: manaAbilityText(card, ab),
        mana: produceOptions(ab),
        ...(creatures.length ? { creatures } : {}),
        ...(tapCount > 1 ? { tapCount } : {}),
        ...(discards.length ? { discards } : {}),
        ...(sacrifices.length ? { sacrifices } : {}),
      };
    });
}

/**
 * The one way to use a card's mana abilities, if there is nothing to choose: one ability, one
 * choice of mana, no creature or card to pick, and no triggered mana ability asking which mana
 * it adds (Kinnan's, 605.1b).
 */
function plainOption(g: Game, me: PlayerId, card: Card, options: ManaOption[]): ManaOption | undefined {
  const only = options.length === 1 && options[0].mana.length === 1 ? options[0] : undefined;
  if (!only || (only.creatures?.length ?? 0) > (only.tapCount ?? 1) || only.discards || only.sacrifices) return undefined;
  // One that would make no mana now (Vivi Ornitier with power 0) is used only when the human picks it.
  if (!only.mana[0].length) return undefined;
  return triggeredAsks(g, me, card, only.ability, only.mana[0]).some((t) => t.mana.length > 1) ? undefined : only;
}

/** The triggered mana abilities using mana ability `ability` of `card` to make `mana` would set off (605.1b), with the mana each could add. */
function triggeredAsks(g: Game, me: PlayerId, card: Card, ability: number, mana: ManaSym[]) {
  const ab = manaAbilities(g, card).find((m) => m.index === ability);
  return ab ? tappedForManaOptions(g, me, card, ab, mana) : [];
}

/** Uses `card` for mana by hand outside a spell being cast, as a step Ctrl+Z can take back. */
function tapForMana(g: Game, me: PlayerId, card: Card) {
  const used = tapByHand(g, me, card);
  if (used) record({ kind: 'mana', cards: [used] });
}

/**
 * Uses a mana ability of `card` by hand. When there is a choice to make (which ability,
 * which mana, which creature to tap or card to discard), the mana picker opens instead, and
 * nothing is used until the human picks. `group`: identical permanents the pick then uses
 * too (a pile's badge). Returns the permanent that clicking takes the mana back from, or
 * null if nothing was used yet.
 */
function tapByHand(g: Game, me: PlayerId, card: Card, group: string[] = []): string | null {
  const options = manaOptions(g, me, card);
  const only = plainOption(g, me, card, options);
  if (!only) {
    if (!options.length) return null;
    const tapping = options.find((o) => o.creatures);
    const creature = tapping && !tapping.tapCount ? tapping.creatures![0] : undefined;
    // A cost that taps several: the first ones, until the human picks others.
    const taps = tapping?.tapCount ? tapping.creatures!.slice(0, tapping.tapCount) : undefined;
    const discard = options.find((o) => o.discards)?.discards?.[0];
    const sacrifice = options.find((o) => o.sacrifices)?.sacrifices?.[0];
    // A pile is used the same way only when nothing about it is picked card by card.
    const same = !tapping && !discard && !sacrifice && group.length ? { group } : {};
    useStore.setState({
      manaPick: { cardId: card.id, options, ...same, ...(creature ? { creature } : {}), ...(taps ? { taps } : {}), ...(discard ? { discard } : {}), ...(sacrifice ? { sacrifice } : {}) },
    });
    return null;
  }
  const several = (only.tapCount ?? 1) > 1;
  const creature = only.creatures?.[0];
  const tap = several ? { taps: only.creatures! } : creature ? { tap: creature } : {};
  if (!S().act({ type: 'tapMana', card: card.id, ability: only.ability, mana: only.mana[0], ...tap })) return null;
  return creature ?? card.id;
}

/**
 * Picks the creature to tap for the mana ability the mana picker is open for (Relic of
 * Legends). For a cost that taps several (Baylen's two tokens), each click adds one or takes it
 * back out, the oldest giving way once there are enough.
 */
export function pickTapCreature(id: string) {
  const { manaPick } = S();
  const option = manaPick?.options.find((o) => o.creatures?.includes(id));
  if (!manaPick || !option) return;
  if (!option.tapCount) return useStore.setState({ manaPick: { ...manaPick, creature: id } });
  const now = manaPick.taps ?? [];
  const taps = now.includes(id) ? now.filter((x) => x !== id) : [...now, id].slice(-option.tapCount);
  useStore.setState({ manaPick: { ...manaPick, taps } });
}

/** Picks the card to discard for the mana ability the mana picker is open for (Skirge Familiar). */
export function pickManaDiscard(id: string) {
  const { manaPick } = S();
  if (manaPick?.options.some((o) => o.discards?.includes(id))) useStore.setState({ manaPick: { ...manaPick, discard: id } });
}

/** Picks the creature to sacrifice for the mana ability the mana picker is open for (Phyrexian Tower). */
export function pickManaSacrifice(id: string) {
  const { manaPick } = S();
  if (manaPick?.options.some((o) => o.sacrifices?.includes(id))) useStore.setState({ manaPick: { ...manaPick, sacrifice: id } });
}

/** Answers the next triggered mana ability's choice the mana picker asks (Kinnan's "any type that permanent produced", 605.1b); null cancels. */
export function pickTriggeredMana(mana: ManaSym[] | null) {
  const { manaPick } = S();
  const t = manaPick?.triggered;
  if (!manaPick || !t) return;
  if (!mana) return void useStore.setState({ manaPick: null });
  useStore.setState({ manaPick: { ...manaPick, triggered: { ...t, answers: [...t.answers, mana] } } });
  pickMana(t.ability, t.mana);
}

/**
 * Uses the mana ability `ability` of the card the mana picker is open for, making `mana`
 * (null closes the picker). A pile's other permanents are used the same way. While paying,
 * the spell is paid for once the pool covers it. Triggered mana abilities that offer a choice
 * of mana (Kinnan's) are asked first, one at a time (`pickTriggeredMana`).
 */
export function pickMana(ability: number | null, mana?: ManaSym[]) {
  const { manaPick, human: me } = S();
  useStore.setState({ manaPick: null });
  if (!manaPick || ability === null || !mana || me === null) return;
  const option = manaPick.options.find((o) => o.ability === ability);
  if (!option) return;
  const source = findCard(S().game!, manaPick.cardId);
  const asks = source ? triggeredAsks(S().game!, me, source, ability, mana) : [];
  const answers = [...(manaPick.triggered?.answers ?? [])];
  while (answers.length < asks.length && asks[answers.length].mana.length === 1) answers.push(asks[answers.length].mana[0]);
  if (answers.length < asks.length) {
    useStore.setState({ manaPick: { ...manaPick, triggered: { ability, mana, asks: asks.map((a) => ({ from: a.from.id, mana: a.mana })), answers } } });
    return;
  }
  const creature = option.creatures && !option.tapCount ? manaPick.creature : undefined;
  const taps = option.tapCount && manaPick.taps?.length === option.tapCount ? manaPick.taps : undefined;
  const extra = {
    ...(creature ? { tap: creature } : {}),
    ...(taps ? { taps } : {}),
    ...(option.discards && manaPick.discard ? { discard: manaPick.discard } : {}),
    ...(option.sacrifices && manaPick.sacrifice ? { sacrifice: manaPick.sacrifice } : {}),
    ...(answers.length ? { triggered: answers } : {}),
  };
  // The pick is one step for Ctrl+Z, however many permanents it uses.
  const start = targetingOf(S());
  const used: string[] = [];
  for (const id of [manaPick.cardId, ...(manaPick.group ?? [])]) {
    const t = targetingOf(S());
    const paying = t && isPaying(t) ? t : null;
    if (paying && paidUp(S().game!, me, paying)) break;
    const card = findCard(S().game!, id);
    if (!card || !canTapForMana(S().game!, me, card, ability)) continue;
    if (!S().act({ type: 'tapMana', card: id, ability, mana, ...extra })) continue;
    // Cancelling the spell takes the mana back: from the creature tapped for it, or the card.
    const back = creature ?? taps?.[0] ?? id;
    if (paying && start) useStore.setState({ targeting: { ...paying, tapped: [...paying.tapped, back], prev: start } });
    else used.push(back);
  }
  if (used.length) record({ kind: 'mana', cards: used });
  const t = targetingOf(S());
  if (t && isPaying(t) && paidUp(S().game!, me, t)) pay();
}

function chooseTarget(ref: TargetRef | null) {
  const s = S();
  const { game: g, human: me } = s;
  const t = targetingOf(s);
  if (!g || me === null || !t || t.announcing || t.choosingModes || isSacrificing(t) || isExiling(t) || isExilingForAbility(t) || isEscaping(t) || isDelving(t) || isDiscarding(t) || crewNeeded(t)) return;
  if (ref && !currentTargets(g, me, t).some((x) => x.kind === ref.kind && x.id === ref.id)) return;
  // "Any number of" targets (115.1d): another slot for the next one, unless that is the most it may have ("up to X").
  const spec = t.specs[t.chosen.length];
  const room = !spec?.most || t.chosen.filter((_, i) => t.specs[i]?.any).length + 1 < spec.most(g, targetSource(g, t));
  const specs = spec?.any && ref && t.mode !== 'retarget' && room ? [...t.specs, spec] : t.specs;
  advance(stepFrom(t, { chosen: [...t.chosen, ref], specs }));
}

/**
 * Backs out of a spell or ability the human had started, and of a picked blocker. Mana
 * tapped while paying is taken back too, so nothing about the game has changed (733.1).
 */
export function cancel() {
  const t = S().targeting;
  for (const id of [...(t?.tapped ?? [])].reverse()) S().act({ type: 'untapMana', card: id });
  useStore.setState({ targeting: null, pickedBlockers: [], hold: S().fullControl });
}

/**
 * Ctrl+Z: takes back the human's latest step that can be taken back, one per press.
 * - A mana choice left open (the mana picker) closes.
 * - While a spell is being cast or an ability activated (601.2, 602.2), the last choice made
 *   for it goes: a target, a sacrifice, a card to discard or exile, a creature to crew or
 *   convoke, the announcing of its X, kicker or cost, or a mana source tapped to pay, which
 *   untaps (733.1). With no choice made yet, it is cancelled as Esc does. A triggered ability's
 *   targets, or new targets, step back the same way but can't be cancelled.
 * - Otherwise the newest of `undoSteps`: mana used by hand comes back while it is still in the
 *   pool (`canUntapMana`), and attackers and blockers declared, or blockers picked, are taken
 *   back while they are still being declared. A step that no longer holds is skipped.
 * Nothing the game has taken for good (a spell cast, a land played, a pass, a trigger's
 * targets sent) is undone: those moves clear what came before them (`act` in store.ts).
 * Returns whether anything was taken back.
 */
export function undo(): boolean {
  const s = S();
  if (s.manaPick) {
    useStore.setState({ manaPick: null });
    return true;
  }
  if (!myTurnToAct()) return false;
  const t = targetingOf(s);
  if (t?.prev) {
    // Mana tapped for it since then is taken back, newest first (733.1).
    for (const id of [...t.tapped].reverse()) if (!t.prev.tapped.includes(id)) S().act({ type: 'untapMana', card: id });
    useStore.setState({ targeting: t.prev, hover: null });
    return true;
  }
  if (t) {
    if (t.mode === 'trigger' || t.mode === 'retarget') return false;
    cancel();
    return true;
  }
  for (let steps = S().undoSteps; steps.length; steps = S().undoSteps) {
    useStore.setState({ undoSteps: steps.slice(0, -1) });
    if (takeBack(steps[steps.length - 1])) return true;
  }
  return false;
}

/** Takes back one of `undoSteps`, if it still holds. Returns whether anything changed. */
function takeBack(step: UndoStep): boolean {
  const g = S().game!;
  const deciding = g.decision?.type;
  const attacks = g.combat?.attacks ?? [];
  switch (step.kind) {
    case 'mana':
      // Not a rule: like Arena, this table lets a mana ability used by hand be taken back
      // while all its mana is still in the pool. The engine checks that it is (`canUntapMana`).
      return [...step.cards].reverse().filter((id) => S().act({ type: 'untapMana', card: id })).length > 0;
    case 'attack':
      // Attackers can change until they are declared (508.1): an attack moved goes back where it was.
      if (deciding !== 'attackers') return false;
      return (
        step.cards
          .filter(({ id }) => attacks.some((a) => a.id === id))
          .filter(({ id, was }) => (was ? declare(id, was) : S().act({ type: 'undeclareAttack', card: id }))).length > 0
      );
    case 'block': {
      // Blockers can change until they are declared (509.1). Those picked for the attacker are picked again.
      if (deciding !== 'blockers') return false;
      const back = step.cards.filter((id) => attacks.some((a) => a.blockers.includes(id)) && S().act({ type: 'undeclareBlock', blocker: id }));
      if (!back.length) return false;
      useStore.setState({ pickedBlockers: step.picked.filter((id) => back.includes(id)) });
      return true;
    }
    case 'pick': {
      const now = S().pickedBlockers;
      if (deciding !== 'blockers' || (now.length === step.before.length && now.every((id) => step.before.includes(id)))) return false;
      useStore.setState({ pickedBlockers: step.before });
      return true;
    }
  }
}

function myTurnToAct(): { g: Game; me: PlayerId } | null {
  const { game: g, human: me } = S();
  return g && me !== null && g.priority === me && g.step !== 'gameOver' ? { g, me } : null;
}

/**
 * Plays, casts or discards a card from the human's hand or command zone. While a spell is
 * being cast, a hand card can instead be the card exiled to pay for it, or make mana from
 * the hand (Simian Spirit Guide).
 */
export function playHandCard(card: Card) {
  const ctx = myTurnToAct();
  const t = targetingOf(S());
  if (ctx && t && isExiling(t)) return chooseExile(ctx.g, ctx.me, t, card);
  if (ctx && t && isDiscarding(t)) return chooseDiscard(ctx.g, ctx.me, t, card);
  if (ctx && t && isPaying(t) && canTapForMana(ctx.g, ctx.me, card)) return payByHand(ctx.g, ctx.me, t, card);
  if (!ctx || t) return;
  const { g, me } = ctx;
  if (g.decision?.type === 'discard') return S().act({ type: 'discard', card: card.id });
  const options = playOptions(g, me, card);
  // An ability that works from the hand, like channel.
  const fromHand = !!handAbility(g, me, card);
  // A plain land is played; anything with a choice of faces, or a spell, is proposed. A card
  // that can't be cast but makes mana from the hand (Simian Spirit Guide) does that.
  if (options.length === 1 && options[0].land && !fromHand && landPlayOptions(g, me, card).length <= 1) S().act({ type: 'playLand', card: card.id, face: options[0].face });
  else if (options.some((o) => o.ok)) propose('cast', card);
  else if (fromHand) propose('activate', card);
  // A card that can't be cast now but can be plotted (702.170a).
  else if (canPlot(g, me, card)) S().act({ type: 'plot', card: card.id });
  else if (!g.decision && canTapForMana(g, me, card)) tapForMana(g, me, card);
}

/** From the prompt's cast options: plot the card instead of casting it (702.170a). */
export function plotCard() {
  const t = S().targeting;
  if (!t || !t.announcing) return;
  useStore.setState({ targeting: null });
  S().act({ type: 'plot', card: t.cardId });
}

/** From the cast panel: use the card's mana ability from the hand instead of casting it. */
export function exileForMana() {
  const t = S().targeting;
  if (!t || !t.announcing) return;
  useStore.setState({ targeting: null });
  const { game: g, human: me } = S();
  const card = g && findCard(g, t.cardId);
  if (card && me !== null) tapForMana(g, me, card);
}

export function clickPermanent(card: Card) {
  const t = targetingOf(S());
  const ctx = myTurnToAct();
  if (t && t.announcing) return;
  if (t && isPaying(t)) {
    if (!ctx) return;
    // A creature that can't make mana now taps for convoke instead (702.51a).
    if (!canTapForMana(ctx.g, ctx.me, card) && !canUntapMana(ctx.g, ctx.me, card) && pickConvoke(ctx.g, ctx.me, t, card)) return;
    return payByHand(ctx.g, ctx.me, t, card);
  }
  if (t && isSacrificing(t)) return ctx && chooseSacrifice(ctx.g, ctx.me, t, card);
  if (t && isExiling(t)) return;
  if (t && isExilingForAbility(t)) return ctx && chooseAbilityExile(ctx.g, ctx.me, t, card);
  if (t && isReturning(t)) return ctx && chooseReturn(ctx.g, ctx.me, t, card);
  if (t && crewNeeded(t)) return ctx && pickCrew(ctx.g, ctx.me, t, card);
  if (t) return chooseTarget({ kind: 'card', id: card.id });
  if (!ctx) return;
  const { g, me } = ctx;
  const s = S();
  const deciding = g.decision?.type;

  if (deciding === 'attackers') {
    // A planeswalker or battle that can be attacked becomes what the attackers go after.
    const option = attackOptions(g, me).find((o) => o.target === card.id);
    if (option) return useStore.setState({ attackTarget: option });
    const target = attackTargetOf(g, me);
    if (card.controller !== me || !canAttack(g, card) || !target) return;
    const existing = g.combat?.attacks.find((a) => a.id === card.id);
    if (sameOption(existing, target)) s.act({ type: 'undeclareAttack', card: card.id });
    else declareAll([card.id], target);
    return;
  }

  if (deciding === 'blockers') {
    const attacksOnMe = (g.combat?.attacks ?? []).filter((a) => a.defender === me);
    if (card.controller !== me) {
      const picked = s.pickedBlockers;
      const declared = picked.filter((b) => S().act({ type: 'declareBlock', blocker: b, attacker: card.id }));
      if (declared.length) {
        useStore.setState({ pickedBlockers: [] });
        record({ kind: 'block', cards: declared, picked });
      }
    } else if (attacksOnMe.some((a) => a.blockers.includes(card.id))) {
      s.act({ type: 'undeclareBlock', blocker: card.id });
    } else {
      pickBlockers(g, me, [card]);
    }
    return;
  }

  if (deciding || card.controller !== me) return;
  // A permanent with a mana ability and another ability that could be activated now (Urza,
  // Baylen): choose which, the mana among them (`useForMana`).
  if (canTapForMana(g, me, card) && activatable(g, me, card).length) propose('activate', card, true);
  else if (canTapForMana(g, me, card)) tapForMana(g, me, card);
  else if (canUntapMana(g, me, card)) s.act({ type: 'untapMana', card: card.id });
  else if (activatable(g, me, card).length) propose('activate', card);
}

/** From the ability menu: use the permanent for mana instead of activating another of its abilities. */
export function useForMana() {
  const t = S().targeting;
  const g = S().game;
  const me = S().human;
  if (!t || !t.pickingAbility || !g || me === null) return;
  const card = findCard(g, t.cardId);
  useStore.setState({ targeting: null });
  if (card) tapForMana(g, me, card);
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
  if (options.length === 1) {
    const declared = ids.filter((b) => S().act({ type: 'declareBlock', blocker: b, attacker: options[0].id }));
    if (declared.length) record({ kind: 'block', cards: declared, picked: [] });
  } else if (options.length > 1) {
    const same = s.pickedBlockers.length === ids.length && ids.every((id) => s.pickedBlockers.includes(id));
    record({ kind: 'pick', before: s.pickedBlockers });
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
  if (!ctx || top.controller !== ctx.me || (t && !isPaying(t))) return clickPermanent(top);
  const { me } = ctx;
  // Every action makes a new game, so each card is looked up again in the latest one.
  const now = () => cards.map((c) => permanent(S().game!, c.id)).filter((c) => c !== undefined);
  const deciding = ctx.g.decision?.type;

  // A pile of permanents with a choice of mana (dual lands): it is picked once, for them all.
  const choosing = (g: Game) => {
    const [first, ...rest] = now().filter((c) => canTapForMana(g, me, c));
    return first && !plainOption(g, me, first, manaOptions(g, me, first)) ? (tapByHand(g, me, first, rest.map((c) => c.id)), true) : false;
  };

  if (t) {
    const tap = now().some((c) => canTapForMana(S().game!, me, c));
    if (tap && choosing(S().game!)) return;
    for (const c of now()) {
      const paying = targetingOf(S());
      const g = S().game!;
      if (!paying || !isPaying(paying)) break; // paid: the spell is cast
      if (tap ? canTapForMana(g, me, c) : canUntapMana(g, me, c)) payByHand(g, me, paying, c);
    }
    // The pile was one click: Ctrl+Z takes back all it tapped at once.
    const end = S().targeting;
    if (tap && end && end !== t && end.tapped.length > t.tapped.length) useStore.setState({ targeting: { ...end, prev: t } });
    return;
  }

  if (deciding === 'attackers') {
    const g = ctx.g;
    const target = attackTargetOf(g, me);
    const able = now().filter((c) => canAttack(g, c));
    if (!target) return;
    const attacking = (c: Card) => sameOption(g.combat?.attacks.find((a) => a.id === c.id), target);
    if (able.length && able.every(attacking)) able.forEach((c) => S().act({ type: 'undeclareAttack', card: c.id }));
    else declareAll(able.filter((c) => !attacking(c)).map((c) => c.id), target);
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
    if (tappable.length && choosing(g)) return;
    if (tappable.length) {
      const used = tappable.map((c) => tapByHand(S().game!, me, c)).filter((id) => id !== null);
      if (used.length) record({ kind: 'mana', cards: used });
      return;
    }
    if (untappable.length) return untappable.forEach((c) => S().act({ type: 'untapMana', card: c.id }));
  }
  clickPermanent(top);
}

/** A click on a spell or ability on the stack: it is a target if one is being chosen. */
export function clickStackItem(id: string) {
  if (targetingOf(S())) chooseTarget({ kind: 'stack', id });
}

export function clickPlayer(pid: PlayerId) {
  if (targetingOf(S())) return chooseTarget({ kind: 'player', id: pid });
  const ctx = myTurnToAct();
  if (ctx && ctx.g.decision?.type === 'attackers' && pid !== ctx.me && !ctx.g.players[pid].lost) {
    useStore.setState({ attackTarget: { defender: pid, target: null } });
  }
}

/** The crown on the human's avatar casts their commander. While choosing targets it counts as a click on the avatar. */
export function clickCrown(pid: PlayerId, commander: Card | undefined) {
  if (targetingOf(S()) || !commander) return clickPlayer(pid);
  playHandCard(commander);
}

export const ViewContext = createContext<View | null>(null);
export const useView = () => useContext(ViewContext)!;
