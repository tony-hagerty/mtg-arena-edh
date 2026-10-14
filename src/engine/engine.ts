// Game setup, turn structure, priority, the stack and action handling. `applyAction` is
// the only way a game changes: it returns a new Game, or the same object if the action
// was illegal. Rule numbers in comments refer to docs/rules.
import { produce } from 'immer';
import { DECKS, deckLibrary } from '../cards/db';
import { scriptOf } from './registry';
import {
  MAX_HAND,
  STARTING_LIFE,
  broadcast,
  canAttack,
  canBlock,
  canTapForMana,
  canUntapMana,
  castCost,
  checkState,
  creaturesOf,
  damageCard,
  damagePlayer,
  describeRef,
  dieMany,
  draw,
  enterBattlefield,
  has,
  isCreature,
  isInstantSpeed,
  isLand,
  isPermanentCard,
  label,
  legalTargets,
  living,
  log,
  makeCard,
  moveCard,
  nextLiving,
  parseCost,
  pay,
  permanent,
  planPayment,
  rand,
  sameRef,
  says,
  searchable,
  shuffle,
  snapshot,
  stats,
  tapForMana,
  targetSpecs,
  trigger,
  turnOrder,
  untapMana,
} from './rules';
import type { Action, Card, CardChoice, Game, Player, PlayerId, StackItem, Step, TargetRef, TargetSpec, Trigger } from './types';

// ---------- setup ----------

export interface NewGameOptions {
  seed: number;
  /** Deck index the human plays in seat 0, or null for four bots. */
  humanDeck: number | null;
}

export function newGame({ seed, humanDeck }: NewGameOptions): Game {
  const g: Game = {
    players: [],
    active: 0,
    priority: 0,
    turn: 0,
    step: 'untap',
    decision: null,
    stack: [],
    triggers: [],
    mulligan: null,
    choices: [],
    resolving: null,
    passes: 0,
    combat: null,
    winner: null,
    log: [],
    rng: seed | 0,
    nextId: 1,
    lastSpell: null,
  };
  const order = humanDeck === null ? [0, 1, 2, 3] : [humanDeck, ...[0, 1, 2, 3].filter((i) => i !== humanDeck)];
  order.forEach((deckIndex, seat) => {
    const deck = DECKS[deckIndex];
    const human = humanDeck !== null && seat === 0;
    const p: Player = {
      id: seat,
      name: human ? 'You' : deck.pilot,
      isBot: !human,
      deckId: deck.id,
      commander: deck.commander,
      life: STARTING_LIFE,
      library: [],
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      command: [],
      commanderCasts: 0,
      commanderDamage: [0, 0, 0, 0],
      landsPlayed: 0,
      pool: [],
      lost: false,
      drewFromEmpty: false,
    };
    p.command.push(makeCard(g, deck.commander, seat, 'command', { isCommander: true }));
    p.library = deckLibrary(deck).map((name) => makeCard(g, name, seat, 'library'));
    shuffle(g, p.library); // 103.3
    drawHand(p);
    g.players.push(p);
  });
  beginMulligans(g, Math.floor(rand(g) * 4));
  settle(g, true);
  return g;
}

// ---------- mulligans ----------

const HAND_SIZE = 7;

/** Draws a starting hand (103.5). Not a draw for "whenever you draw" abilities: nothing is on the battlefield yet. */
function drawHand(p: Player) {
  for (const c of p.library.splice(0, HAND_SIZE)) {
    c.zone = 'hand';
    p.hand.push(c);
  }
}

/**
 * In a multiplayer game a player's first mulligan is free: it doesn't count toward the
 * cards they put on the bottom or the mulligans they may take (103.5c). Games always have
 * four players for now, but a two-player game would make this false.
 */
const freeMulligan = (g: Game) => g.players.length > 2;

/** Mulligans that count against the hand (103.5c). */
const countedMulligans = (g: Game, taken: number) => Math.max(0, taken - (freeMulligan(g) ? 1 : 0));

/** Can this player take another mulligan? Not once their hand would be zero cards (103.5). */
export function canMulligan(g: Game, pid: PlayerId): boolean {
  const m = g.mulligan;
  return !!m && countedMulligans(g, m.taken[pid]) < HAND_SIZE;
}

/** How many cards the player would put on the bottom if they took one more mulligan. */
export const nextMulliganBottom = (g: Game, pid: PlayerId) => countedMulligans(g, (g.mulligan?.taken[pid] ?? 0) + 1);

/** The starting player is chosen (103.1), then everyone declares in turn order from them (103.5). */
function beginMulligans(g: Game, starter: PlayerId) {
  g.active = starter;
  g.mulligan = { taken: g.players.map(() => 0), waiting: turnOrder(g, starter), taking: [] };
  continueMulligans(g);
}

/**
 * Moves the mulligan process on (103.5). Asks the next player to declare. Once everyone
 * has, all who chose to mulligan do so at the same time: they shuffle their hand back,
 * draw seven, and put cards on the bottom. Then those players declare again, until nobody
 * takes a mulligan and the starting player takes the first turn (103.8).
 */
function continueMulligans(g: Game) {
  const m = g.mulligan!;
  if (m.waiting.length) {
    g.decision = { type: 'mulligan' };
    g.priority = m.waiting[0];
    return;
  }
  if (!m.taking.length) {
    g.mulligan = null;
    g.decision = null;
    // In a multiplayer game nobody skips their first draw (103.8c).
    beginTurn(g, g.active);
    return;
  }
  const taking = m.taking;
  m.taking = [];
  for (const pid of taking) {
    const p = g.players[pid];
    m.taken[pid]++;
    for (const c of [...p.hand]) moveCard(g, c, 'library');
    shuffle(g, p.library);
    drawHand(p);
    const bottom = countedMulligans(g, m.taken[pid]);
    if (bottom > 0) g.choices.push({ kind: 'bottom', player: pid, count: Math.min(bottom, p.hand.length) });
  }
  // Those who just took a mulligan declare again, unless their hand is down to nothing.
  m.waiting = taking.filter((pid) => canMulligan(g, pid));
  if (!nextChoice(g)) continueMulligans(g);
}

// ---------- card choices ----------

/** What a card choice shows the player: the cards, which of them can be picked, and how many. */
export function choiceOptions(g: Game, choice: CardChoice): { cards: Card[]; valid: Set<string>; min: number; max: number } {
  const p = g.players[choice.player];
  if (choice.kind === 'bottom') {
    return { cards: p.hand, valid: new Set(p.hand.map((c) => c.id)), min: choice.count, max: choice.count };
  }
  // The whole library is looked at (701.23a). Sorted, so the order of the library stays hidden (401.2).
  const cards = [...p.library].sort((a, b) => label(a).localeCompare(label(b)));
  const valid = new Set(cards.filter((c) => searchable(c, choice.subtype)).map((c) => c.id));
  // A search for a card with a stated quality may find nothing, even if there is one (701.23b).
  return { cards, valid, min: 0, max: 1 };
}

/** Asks the next waiting card choice, if there is one. */
function nextChoice(g: Game): boolean {
  while (g.choices.length) {
    const choice = g.choices.shift()!;
    if (g.players[choice.player].lost) continue;
    g.decision = { type: 'chooseCards', choice };
    g.priority = choice.player;
    return true;
  }
  return false;
}

/** Carries out a card choice once the player has made it. */
function doChoice(g: Game, choice: CardChoice, cards: Card[]) {
  const p = g.players[choice.player];
  if (choice.kind === 'bottom') {
    for (const c of cards) moveCard(g, c, 'library'); // onto the bottom, in the chosen order (103.5)
    log(g, `${says(p, 'puts')} ${cards.length} card${cards.length === 1 ? '' : 's'} on the bottom.`, p.id);
    return;
  }
  const [land] = cards;
  if (land) {
    log(g, `${says(p, 'fetches')} ${label(land)}.`, p.id);
    if (choice.to === 'battlefield') enterBattlefield(g, land, { tapped: choice.tapped });
    else moveCard(g, land, 'hand');
  } else {
    log(g, `${says(p, 'finds')} nothing.`, p.id);
  }
  // Several searches of one library in a row are one search, and it is shuffled once (701.23h).
  const next = g.choices[0];
  if (!(next?.kind === 'search' && next.player === p.id)) shuffle(g, p.library);
}

// ---------- legality helpers (also used by the UI and bots) ----------

const isMain = (step: Step) => step === 'main1' || step === 'main2';

/**
 * Can the player cast a spell or activate an ability now? They need priority (117.1).
 * Anything that isn't instant speed also needs their own main phase and an empty stack (117.1a).
 */
function timingOk(g: Game, pid: PlayerId, instantSpeed: boolean): boolean {
  if (g.priority !== pid || g.decision || g.step === 'gameOver') return false;
  if (instantSpeed) return true;
  return pid === g.active && isMain(g.step) && g.stack.length === 0;
}

/** Playing a land is a special action with sorcery timing, once a turn (305.1, 305.2). */
export function canPlayLand(g: Game, pid: PlayerId, c: Card): boolean {
  return c.owner === pid && c.zone === 'hand' && isLand(c) && g.players[pid].landsPlayed < 1 && timingOk(g, pid, false);
}

/** Targets chosen as a spell is cast (601.2c). A permanent's `targets` are for its enters ability instead. */
export const castTargets = (c: Card): TargetSpec[] => (isPermanentCard(c) ? [] : (scriptOf(c.name).targets ?? []));

export function canCast(g: Game, pid: PlayerId, c: Card): boolean {
  if (c.owner !== pid || (c.zone !== 'hand' && c.zone !== 'command') || isLand(c)) return false;
  if (!timingOk(g, pid, isInstantSpeed(c))) return false;
  if (!planPayment(g, pid, castCost(g, c))) return false;
  for (const spec of castTargets(c)) {
    if (!spec.optional && legalTargets(g, pid, spec, c).length === 0) return false;
  }
  return true;
}

export function canActivate(g: Game, pid: PlayerId, c: Card): boolean {
  const ab = scriptOf(c.name).activated;
  if (!ab || c.owner !== pid || c.zone !== 'battlefield' || !timingOk(g, pid, true)) return false;
  // A summoning-sick creature can't pay a tap cost (302.6).
  if (ab.cost.tap && (c.tapped || (isCreature(c) && c.sick && !has(g, c, 'haste')))) return false;
  if (ab.cost.mana && !planPayment(g, pid, parseCost(ab.cost.mana))) return false;
  for (const spec of ab.targets ?? []) {
    if (!spec.optional && legalTargets(g, pid, spec, c).length === 0) return false;
  }
  return true;
}

/** Every slot has a legal target, or is an optional one left empty. */
function targetsOk(g: Game, pid: PlayerId, c: Card, specs: TargetSpec[], targets: (TargetRef | null)[]) {
  return specs.every((spec, i) => {
    const t = targets[i];
    if (!t) return !!spec.optional;
    return legalTargets(g, pid, spec, c).some((x) => sameRef(x, t));
  });
}

export const attackCandidates = (g: Game, pid: PlayerId) => creaturesOf(g, pid).filter((c) => canAttack(g, c));

/** The defender's creatures that could block at least one creature attacking them. */
export function blockCandidates(g: Game, pid: PlayerId): Card[] {
  const attackers = (g.combat?.attacks ?? []).filter((a) => a.defender === pid).map((a) => permanent(g, a.id)!);
  return creaturesOf(g, pid).filter((b) => attackers.some((a) => a && canBlock(g, b, a)));
}

/** Blocks the rules don't allow as declared: a lone blocker on a creature with menace (702.111b). */
export function illegalBlocks(g: Game, pid: PlayerId): string[] {
  const out: string[] = [];
  for (const a of g.combat?.attacks ?? []) {
    const c = permanent(g, a.id);
    if (a.defender === pid && c && a.blockers.length === 1 && has(g, c, 'menace')) out.push(a.id);
  }
  return out;
}

/** Could the player with priority do anything other than pass? Mana abilities don't count. */
export function canAct(g: Game, pid: PlayerId): boolean {
  const p = g.players[pid];
  return (
    [...p.hand, ...p.command].some((c) => canCast(g, pid, c) || canPlayLand(g, pid, c)) ||
    p.battlefield.some((c) => canActivate(g, pid, c))
  );
}

// ---------- auto-pass ----------

/**
 * Should the game stop and ask this player, or pass priority for them?
 *
 * This is not a rule. Every player gets priority in every step (117.3), which in a
 * four-player game is dozens of passes a turn, so like Arena the engine passes for a
 * player unless they are likely to want to act:
 *  - never when passing is all they can do, except in their own first main phase
 *  - with something on the stack: when the top object is someone else's
 *  - with the stack empty, on their turn: both main phases, and after blockers are declared
 *  - with the stack empty, on another turn: after attackers and after blockers are
 *    declared, and in the end step
 * `applyAction(g, a, { autoPass: false })` turns it off.
 */
export function wantsPriority(g: Game, pid: PlayerId): boolean {
  const top = g.stack[g.stack.length - 1];
  const myTurn = pid === g.active;
  if (!top && myTurn && g.step === 'main1') return true;
  if (!canAct(g, pid)) return false;
  if (top) return top.controller !== pid;
  if (myTurn) return g.step === 'main2' || g.step === 'blockers';
  const inCombat = !!g.combat?.attacks.length && (g.step === 'attackers' || g.step === 'blockers');
  return inCombat || g.step === 'end';
}

// ---------- turn structure ----------

const STEP_ORDER: Step[] = [
  'untap',
  'upkeep',
  'draw',
  'main1',
  'beginCombat',
  'attackers',
  'blockers',
  'damage',
  'endCombat',
  'main2',
  'end',
  'cleanup',
];

/** The active player gets priority first. If they have left the game, the next player does (800.4j). */
const firstPriority = (g: Game) => (g.players[g.active].lost ? nextLiving(g, g.active) : g.active);

function beginTurn(g: Game, pid: PlayerId) {
  g.active = pid;
  g.turn++;
  g.combat = null;
  g.players[pid].landsPlayed = 0;
  log(g, `Turn ${g.turn} — ${g.players[pid].name}`, pid);
  beginStep(g, 'untap');
}

/**
 * Starts a step or phase and does its turn-based actions (703). Whoever calls this lets
 * `settle` run afterwards: it puts "at the beginning of" triggers on the stack and gives
 * out priority (117.3a).
 */
function beginStep(g: Game, step: Step) {
  const pid = g.active;
  const p = g.players[pid];
  g.step = step;
  g.passes = 0;
  g.priority = firstPriority(g);
  switch (step) {
    case 'untap':
      // 502.3. Summoning sickness ends too: these have been under control since the turn began (302.6).
      for (const c of p.battlefield) {
        c.tapped = false;
        c.sick = false;
      }
      // No player gets priority in the untap step (502.4).
      beginStep(g, 'upkeep');
      break;
    case 'upkeep':
      broadcast(g, 'onUpkeep', { player: pid }); // 503.1a
      break;
    case 'draw':
      draw(g, pid, 1); // 504.1
      break;
    case 'beginCombat':
      g.combat = { attacks: [], toBlock: [], struckFirst: null, moreDamage: false };
      break;
    case 'attackers':
      if (attackCandidates(g, pid).length) g.decision = { type: 'attackers' }; // 508.1
      break;
    case 'blockers': {
      // Each defending player who is able to block declares blockers, in APNAP order (802.4).
      const combat = g.combat!;
      combat.toBlock = turnOrder(g, pid).filter((d) => d !== pid && blockCandidates(g, d).length > 0);
      if (combat.toBlock.length) {
        g.decision = { type: 'blockers' };
        g.priority = combat.toBlock[0];
      } else {
        blockersDeclared(g);
      }
      break;
    }
    case 'damage':
      combatDamage(g);
      break;
    case 'end':
      broadcast(g, 'onEndStep', { player: pid }); // 513.1
      break;
    case 'cleanup':
      if (p.hand.length > MAX_HAND) g.decision = { type: 'discard' }; // 514.1
      else cleanup(g);
      break;
  }
}

/** Ends the current step or phase and begins the next. */
function nextStep(g: Game) {
  for (const p of g.players) p.pool = []; // unspent mana empties (500.5)
  const combat = g.combat;
  switch (g.step) {
    case 'attackers':
      // With no attackers, the declare blockers and combat damage steps are skipped (508.8).
      return beginStep(g, combat?.attacks.length ? 'blockers' : 'endCombat');
    case 'damage':
      // A first-strike damage step is followed by a second combat damage step (510.4).
      return beginStep(g, combat?.moreDamage ? 'damage' : 'endCombat');
    case 'endCombat':
      g.combat = null; // everything is removed from combat (511.3)
      return beginStep(g, 'main2');
    default:
      return beginStep(g, STEP_ORDER[STEP_ORDER.indexOf(g.step) + 1]);
  }
}

/**
 * The second half of the cleanup step, then the next turn: damage wears off and "until
 * end of turn" effects end, both at once (514.2). Players never get priority in this
 * step; an ability that triggers here waits for the next upkeep instead (514.3a).
 */
function cleanup(g: Game) {
  for (const p of g.players) {
    for (const c of p.battlefield) {
      c.damage = 0;
      c.deathtouched = false;
      c.mods = [];
    }
  }
  beginTurn(g, nextLiving(g, g.active));
}

// ---------- combat ----------

/** Locks in the chosen attackers: they tap, and "attacks" abilities trigger (508.1f, 508.1m). */
function attackersDeclared(g: Game) {
  const combat = g.combat!;
  g.decision = null;
  g.priority = firstPriority(g); // 508.2
  if (!combat.attacks.length) return;
  const names: string[] = [];
  for (const a of combat.attacks) {
    const c = permanent(g, a.id)!;
    if (!has(g, c, 'vigilance')) c.tapped = true;
    names.push(`${label(c)} → ${g.players[a.defender].name}`);
  }
  log(g, `${says(g.players[g.active], 'attacks')}: ${names.join(', ')}.`, g.active);
  for (const a of combat.attacks) {
    const c = permanent(g, a.id)!;
    trigger(g, c, 'onAttack', { defender: a.defender });
    broadcast(g, 'onCreatureAttacks', { attacker: c, defender: a.defender });
  }
}

/** Locks in blocks: each attacker is now blocked or unblocked for the rest of combat (509.1h). */
function blockersDeclared(g: Game) {
  for (const a of g.combat!.attacks) {
    a.blocked = a.blockers.length > 0;
    const c = permanent(g, a.id);
    if (c && a.blocked) {
      log(g, `${label(c)} is blocked by ${a.blockers.map((b) => label(permanent(g, b)!)).join(', ')}.`, a.defender);
    }
  }
  g.decision = null;
  g.priority = firstPriority(g); // 509.2
}

/** The turn-based action of a combat damage step (510.1, 510.2). */
function combatDamage(g: Game) {
  const combat = g.combat!;
  const fighters = combat.attacks.flatMap((a) => [a.id, ...a.blockers]).map((id) => permanent(g, id));
  // Only first strikers and double strikers deal damage in the first of two damage steps (510.4).
  const firstStrike =
    combat.struckFirst === null && fighters.some((c) => c && (has(g, c, 'first strike') || has(g, c, 'double strike')));
  const struckFirst = new Set(combat.struckFirst ?? []);
  dealCombatDamage(g, firstStrike, struckFirst);
  combat.struckFirst = [...struckFirst];
  combat.moreDamage = firstStrike;
}

/**
 * All damage is worked out first, then dealt at the same time (510.2). The split between
 * several blockers is automatic: lethal damage to each in order, the rest to the last one,
 * or to the defending player with trample (702.19b).
 */
function dealCombatDamage(g: Game, firstStrike: boolean, struckFirst: Set<string>) {
  const hits: { src: Card; card?: Card; player?: PlayerId; n: number }[] = [];
  const deals = (c: Card) => {
    const kw = stats(g, c).keywords;
    if (firstStrike) return kw.has('first strike') || kw.has('double strike');
    return !struckFirst.has(c.id) || kw.has('double strike');
  };
  for (const a of g.combat!.attacks) {
    const atk = permanent(g, a.id);
    if (!atk) continue;
    const s = stats(g, atk);
    const blockers = a.blockers.map((id) => permanent(g, id)).filter((b): b is Card => !!b);
    if (deals(atk) && s.power > 0) {
      if (firstStrike) struckFirst.add(atk.id);
      if (!a.blocked) {
        hits.push({ src: atk, player: a.defender, n: s.power });
      } else {
        let left = s.power;
        blockers.forEach((b, i) => {
          const lethal = s.keywords.has('deathtouch') ? 1 : Math.max(1, stats(g, b).toughness - b.damage);
          const last = i === blockers.length - 1 && !s.keywords.has('trample');
          const n = last ? left : Math.min(left, lethal);
          if (n > 0) hits.push({ src: atk, card: b, n });
          left -= n;
        });
        if (left > 0 && s.keywords.has('trample')) hits.push({ src: atk, player: a.defender, n: left });
      }
    }
    for (const b of blockers) {
      const bs = stats(g, b);
      if (!deals(b) || bs.power <= 0) continue;
      if (firstStrike) struckFirst.add(b.id);
      hits.push({ src: b, card: atk, n: bs.power });
    }
  }
  for (const h of hits) {
    if (h.card) damageCard(g, h.src, h.card, h.n);
    else damagePlayer(g, h.src, h.player!, h.n, true);
  }
}

// ---------- priority and the stack ----------

/**
 * The player with priority passes it on (117.3d). Once every player has passed in a row,
 * the top of the stack resolves, or the step ends if the stack is empty (117.4).
 */
function passPriority(g: Game) {
  g.passes++;
  if (g.passes < living(g).length) {
    g.priority = nextLiving(g, g.priority);
  } else if (g.stack.length) {
    resolveTop(g);
  } else {
    nextStep(g);
  }
}

/**
 * Resolves the top spell or ability of the stack (608). It stays there until it has
 * finished, which waits if its effect asked a player to choose cards.
 */
function resolveTop(g: Game) {
  const item = g.stack[g.stack.length - 1];
  const { card, controller } = item;
  g.resolving = item.id;
  const script = scriptOf(card.name);
  // Targets are checked again. Illegal ones are left alone, and if every target has
  // become illegal the spell or ability does nothing at all (608.2b).
  const specs = targetSpecs(item);
  const targets = item.targets.map((t, i) =>
    t && legalTargets(g, controller, specs[i], card).some((x) => sameRef(x, t)) ? t : null,
  );
  const fizzled = item.targets.some(Boolean) && !targets.some(Boolean);
  if (fizzled) log(g, `${label(card)} has no legal target left and does nothing.`, controller);

  if (item.kind === 'spell') {
    if (isPermanentCard(card)) {
      enterBattlefield(g, card); // 608.3
    } else {
      if (!fizzled) script.onResolve?.(g, { self: card, you: controller, targets });
    }
  } else if (!fizzled) {
    // An ability uses its source as it is now, or as it last was if it has gone (113.7a).
    const ctx = { self: permanent(g, card.id) ?? card, you: controller, targets };
    if (item.kind === 'activated') {
      script.activated!.resolve(g, ctx);
    } else {
      const t = script[item.hook!] as Trigger<object>;
      (typeof t === 'function' ? t : t.resolve)(g, { ...item.event, ...ctx });
    }
  }
  if (!nextChoice(g)) finishResolving(g);
}

/** The end of resolving: the item leaves the stack, and the active player gets priority (117.3b). */
function finishResolving(g: Game) {
  const item = g.stack.find((x) => x.id === g.resolving);
  g.resolving = null;
  // A permanent spell has already moved to the battlefield (608.3). An instant or sorcery
  // goes to the graveyard as the last part of resolving (608.2n).
  if (item?.kind === 'spell') moveCard(g, item.card, 'graveyard');
  else if (item) g.stack = g.stack.filter((x) => x !== item);
  g.passes = 0;
  g.priority = firstPriority(g);
}

/**
 * Puts the next waiting triggered ability on the stack (603.3). The active player's go
 * on first, then each other player's in turn order, so they resolve in the reverse order.
 * Each player puts theirs on in the order they choose (603.3b). A human with two or more
 * is asked for it; bots keep the order they triggered in. Returns false if none are waiting.
 */
function putTriggerOnStack(g: Game): boolean {
  if (!g.triggers.length) return false;
  const order = turnOrder(g, firstPriority(g));
  let next = 0;
  g.triggers.forEach((t, i) => {
    if (order.indexOf(t.controller) < order.indexOf(g.triggers[next].controller)) next = i;
  });
  const pid = g.triggers[next].controller;
  const theirs = g.triggers.filter((t) => t.controller === pid);
  if (!g.players[pid].isBot && theirs.length > 1 && theirs.some((t) => !t.ordered)) {
    g.decision = { type: 'orderTriggers', resume: g.priority };
    g.priority = pid;
    return true;
  }
  const [item] = g.triggers.splice(next, 1);
  const specs = targetSpecs(item);
  const options = specs.map((spec) => legalTargets(g, item.controller, spec, item.card));
  // An ability that needs a target and has none is removed instead (603.3d).
  if (specs.some((spec, i) => !spec.optional && options[i].length === 0)) return true;
  if (options.some((o) => o.length)) {
    g.decision = { type: 'targets', item, resume: g.priority };
    g.priority = item.controller;
    return true;
  }
  item.targets = specs.map(() => null);
  g.stack.push(item);
  return true;
}

// ---------- actions ----------

function act(g: Game, a: Action): boolean {
  const pid = g.priority;
  const p = g.players[pid];
  const deciding = g.decision?.type;
  if (g.step === 'gameOver') return false;

  switch (a.type) {
    case 'playLand': {
      const c = p.hand.find((x) => x.id === a.card);
      if (!c || !canPlayLand(g, pid, c)) return false;
      p.landsPlayed++;
      log(g, `${says(p, 'plays')} ${label(c)}.`, pid);
      enterBattlefield(g, c);
      g.passes = 0; // the player keeps priority after a special action (117.3c)
      return true;
    }

    // Casting is one action. The steps a player goes through to propose a spell (601.2:
    // choose targets, then pay) are collected by the UI first, so backing out of any of
    // them leaves the game as if the spell was never started (733.1).
    case 'cast': {
      const c = p.hand.find((x) => x.id === a.card) ?? p.command.find((x) => x.id === a.card);
      if (!c || !canCast(g, pid, c)) return false;
      const specs = castTargets(c);
      const targets = specs.map((_, i) => a.targets?.[i] ?? null);
      if (!targetsOk(g, pid, c, specs, targets)) return false;
      pay(g, pid, castCost(g, c)); // 601.2f-h
      const from = c.zone === 'command' ? p.command : p.hand;
      if (c.zone === 'command') p.commanderCasts++; // commander tax (903.8)
      from.splice(from.findIndex((x) => x.id === c.id), 1);
      c.zone = 'stack'; // 601.2a
      g.stack.push({ id: `s${g.nextId++}`, kind: 'spell', controller: pid, card: c, targets });
      const chosen = targets.filter((t): t is TargetRef => !!t).map((t) => describeRef(g, t));
      log(g, `${says(p, 'casts')} ${label(c)}${chosen.length ? ` targeting ${chosen.join(' and ')}` : ''}.`, pid);
      g.lastSpell = { seq: (g.lastSpell?.seq ?? 0) + 1, name: c.name, caster: pid };
      broadcast(g, 'onCast', { card: c, caster: pid }); // 601.2i
      g.passes = 0; // the caster keeps priority (117.3c)
      return true;
    }

    case 'activate': {
      const c = p.battlefield.find((x) => x.id === a.card);
      if (!c || !canActivate(g, pid, c)) return false;
      const ab = scriptOf(c.name).activated!;
      const specs = ab.targets ?? [];
      const targets = specs.map((_, i) => a.targets?.[i] ?? null);
      if (!targetsOk(g, pid, c, specs, targets)) return false;
      if (ab.cost.mana) pay(g, pid, parseCost(ab.cost.mana));
      if (ab.cost.tap) c.tapped = true;
      // The ability goes on the stack as its own object, apart from its source (602.2a).
      const item: StackItem = { id: `s${g.nextId++}`, kind: 'activated', controller: pid, card: snapshot(c), targets };
      const chosen = targets.filter((t): t is TargetRef => !!t).map((t) => describeRef(g, t));
      log(g, `${says(p, 'activates')} ${label(c)}${chosen.length ? ` targeting ${chosen.join(' and ')}` : ''}.`, pid);
      if (ab.cost.sacrifice) dieMany(g, [c], 'is sacrificed');
      g.stack.push(item);
      g.passes = 0;
      return true;
    }

    // Mana abilities don't use the stack (605.3b). Tapping by hand isn't logged: it is the
    // one thing a player can undo.
    case 'tapMana': {
      const c = p.battlefield.find((x) => x.id === a.card);
      if (!c || deciding || !canTapForMana(g, pid, c)) return false;
      tapForMana(g, pid, c);
      return true;
    }

    case 'untapMana': {
      const c = p.battlefield.find((x) => x.id === a.card);
      if (!c || !canUntapMana(g, pid, c)) return false;
      untapMana(g, pid, c);
      return true;
    }

    case 'declareAttack': {
      const c = p.battlefield.find((x) => x.id === a.card);
      const defender = g.players[a.defender];
      if (deciding !== 'attackers' || !g.combat || !c || !canAttack(g, c)) return false;
      if (!defender || defender.lost || defender.id === pid) return false;
      const existing = g.combat.attacks.find((x) => x.id === c.id);
      if (existing) existing.defender = a.defender;
      else g.combat.attacks.push({ id: c.id, defender: a.defender, blockers: [], blocked: false });
      return true;
    }

    case 'undeclareAttack': {
      if (deciding !== 'attackers' || !g.combat || !g.combat.attacks.some((x) => x.id === a.card)) return false;
      g.combat.attacks = g.combat.attacks.filter((x) => x.id !== a.card);
      return true;
    }

    case 'declareBlock': {
      if (deciding !== 'blockers' || !g.combat) return false;
      const blocker = p.battlefield.find((x) => x.id === a.blocker);
      const attack = g.combat.attacks.find((x) => x.id === a.attacker);
      const attacker = permanent(g, a.attacker);
      if (!blocker || !attack || !attacker || attack.defender !== pid || !canBlock(g, blocker, attacker)) return false;
      for (const x of g.combat.attacks) x.blockers = x.blockers.filter((b) => b !== blocker.id);
      attack.blockers.push(blocker.id);
      return true;
    }

    case 'undeclareBlock': {
      if (deciding !== 'blockers' || !g.combat) return false;
      const attack = g.combat.attacks.find((x) => x.defender === pid && x.blockers.includes(a.blocker));
      if (!attack) return false;
      attack.blockers = attack.blockers.filter((b) => b !== a.blocker);
      return true;
    }

    case 'discard': {
      const c = p.hand.find((x) => x.id === a.card);
      if (deciding !== 'discard' || !c) return false;
      log(g, `${says(p, 'discards')} ${label(c)}.`, pid);
      moveCard(g, c, 'graveyard');
      if (p.hand.length <= MAX_HAND) {
        g.decision = null;
        cleanup(g);
      }
      return true;
    }

    case 'chooseTargets': {
      if (g.decision?.type !== 'targets') return false;
      const { item, resume } = g.decision;
      const specs = targetSpecs(item);
      const targets = specs.map((_, i) => a.targets?.[i] ?? null);
      if (!targetsOk(g, pid, item.card, specs, targets)) return false;
      const chosen = targets.filter((t): t is TargetRef => !!t).map((t) => describeRef(g, t));
      if (chosen.length) log(g, `${label(item.card)} targets ${chosen.join(' and ')}.`, pid);
      item.targets = targets;
      g.stack.push(item);
      g.decision = null;
      g.priority = resume;
      return true;
    }

    case 'keep':
    case 'mulligan': {
      const m = g.mulligan;
      if (deciding !== 'mulligan' || !m || (a.type === 'mulligan' && !canMulligan(g, pid))) return false;
      m.waiting.shift();
      if (a.type === 'mulligan') {
        m.taking.push(pid);
        log(g, `${says(p, 'mulligans')}.`, pid);
      } else {
        log(g, `${says(p, 'keeps')} ${p.hand.length} card${p.hand.length === 1 ? '' : 's'}.`, pid);
      }
      g.decision = null;
      continueMulligans(g);
      return true;
    }

    case 'chooseCards': {
      if (g.decision?.type !== 'chooseCards') return false;
      const { choice } = g.decision;
      const { cards, valid, min, max } = choiceOptions(g, choice);
      const picked = a.cards.map((id) => cards.find((c) => c.id === id));
      if (new Set(a.cards).size !== a.cards.length || picked.length < min || picked.length > max) return false;
      if (picked.some((c) => !c || !valid.has(c.id))) return false;
      g.decision = null;
      doChoice(g, choice, picked as Card[]);
      if (nextChoice(g)) return true;
      if (g.mulligan) continueMulligans(g);
      else finishResolving(g);
      return true;
    }

    case 'orderTriggers': {
      if (g.decision?.type !== 'orderTriggers') return false;
      const theirs = g.triggers.filter((t) => t.controller === pid);
      const ordered = a.order.map((id) => theirs.find((t) => t.id === id));
      if (new Set(a.order).size !== a.order.length || ordered.length !== theirs.length || ordered.some((t) => !t)) return false;
      // Their triggers swap places among themselves, so they go on the stack in the chosen order.
      let i = 0;
      g.triggers = g.triggers.map((t) => (t.controller === pid ? ordered[i++]! : t));
      for (const t of theirs) t.ordered = true;
      g.priority = g.decision.resume;
      g.decision = null;
      return true;
    }

    case 'pass': {
      switch (deciding) {
        case undefined:
          passPriority(g);
          return true;
        case 'attackers':
          attackersDeclared(g);
          return true;
        case 'blockers': {
          const combat = g.combat!;
          for (const id of illegalBlocks(g, pid)) {
            const attack = combat.attacks.find((x) => x.id === id)!;
            attack.blockers = [];
            log(g, `${label(permanent(g, id)!)} has menace and can't be blocked by one creature.`, pid);
          }
          combat.toBlock = combat.toBlock.filter((x) => x !== pid);
          if (combat.toBlock.length) g.priority = combat.toBlock[0];
          else blockersDeclared(g);
          return true;
        }
        default:
          return false;
      }
    }
  }
}

/**
 * Runs the game forward until it needs a player. Each time a player would get priority,
 * state-based actions are checked and waiting triggered abilities go on the stack, until
 * neither does anything more (117.5). Then that player gets priority, or it is passed for
 * them (see `wantsPriority`).
 */
function settle(g: Game, autoPass: boolean) {
  for (let guard = 0; guard < 5000; guard++) {
    // A spell or ability is waiting on a choice partway through resolving. Nothing else
    // happens until it has finished, not even state-based actions (608.2).
    if (g.resolving) return;
    checkState(g);
    if (g.winner !== null) {
      g.step = 'gameOver';
      g.combat = null;
      g.decision = null;
      return;
    }
    if (g.decision) return;
    if (putTriggerOnStack(g)) continue;
    if (g.players[g.priority].lost) g.priority = nextLiving(g, g.priority);
    if (!autoPass || wantsPriority(g, g.priority)) return;
    passPriority(g);
  }
}

export interface ApplyOptions {
  /** Pass priority for players who have nothing they'd want to do (default true). See `wantsPriority`. */
  autoPass?: boolean;
}

export function applyAction(g: Game, a: Action, { autoPass = true }: ApplyOptions = {}): Game {
  return produce(g, (draft) => {
    if (act(draft, a)) settle(draft, autoPass);
  });
}
