// Game setup, turn structure and action handling. `applyAction` is the only way a
// game changes: it returns a new Game, or the same object if the action was illegal.
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
  shuffle,
  stats,
  tapForMana,
  untapMana,
} from './rules';
import type { Action, Card, Game, Player, PlayerId, Step, TargetRef, TargetSpec } from './types';

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
    step: 'main1',
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
    shuffle(g, p.library);
    for (const c of p.library.splice(0, 7)) {
      c.zone = 'hand';
      p.hand.push(c);
    }
    g.players.push(p);
  });
  beginTurn(g, Math.floor(rand(g) * 4));
  return g;
}

// ---------- legality helpers (also used by the UI and bots) ----------

function timingOk(g: Game, pid: PlayerId, instantSpeed: boolean): boolean {
  if (g.priority !== pid || g.step === 'discard' || g.step === 'gameOver') return false;
  if (instantSpeed) return true;
  return pid === g.active && (g.step === 'main1' || g.step === 'main2');
}

export function canPlayLand(g: Game, pid: PlayerId, c: Card): boolean {
  return c.owner === pid && c.zone === 'hand' && isLand(c) && g.players[pid].landsPlayed < 1 && timingOk(g, pid, false);
}

export const castTargets = (c: Card): TargetSpec[] => scriptOf(c.name).targets ?? [];

export function canCast(g: Game, pid: PlayerId, c: Card): boolean {
  if (c.owner !== pid || (c.zone !== 'hand' && c.zone !== 'command') || isLand(c)) return false;
  if (!timingOk(g, pid, isInstantSpeed(c))) return false;
  if (!planPayment(g, pid, castCost(g, c))) return false;
  // A spell needs all its targets; a permanent can enter with its trigger doing nothing.
  if (!isPermanentCard(c)) {
    for (const spec of castTargets(c)) {
      if (!spec.optional && legalTargets(g, pid, spec, c).length === 0) return false;
    }
  }
  return true;
}

export function canActivate(g: Game, pid: PlayerId, c: Card): boolean {
  const ab = scriptOf(c.name).activated;
  if (!ab || c.owner !== pid || c.zone !== 'battlefield' || !timingOk(g, pid, true)) return false;
  if (ab.cost.tap && (c.tapped || (isCreature(c) && c.sick && !has(g, c, 'haste')))) return false;
  if (ab.cost.mana && !planPayment(g, pid, parseCost(ab.cost.mana))) return false;
  for (const spec of ab.targets ?? []) {
    if (!spec.optional && legalTargets(g, pid, spec, c).length === 0) return false;
  }
  return true;
}

function targetsOk(g: Game, pid: PlayerId, c: Card, specs: TargetSpec[], targets: (TargetRef | null)[], lenient: boolean) {
  return specs.every((spec, i) => {
    const t = targets[i];
    if (!t) return lenient || !!spec.optional;
    return legalTargets(g, pid, spec, c).some((x) => sameRef(x, t));
  });
}

export const attackCandidates = (g: Game, pid: PlayerId) => creaturesOf(g, pid).filter((c) => canAttack(g, c));

/** The defender's creatures that could block at least one creature attacking them. */
export function blockCandidates(g: Game, pid: PlayerId): Card[] {
  const attackers = (g.combat?.attacks ?? []).filter((a) => a.defender === pid).map((a) => permanent(g, a.id)!);
  return creaturesOf(g, pid).filter((b) => attackers.some((a) => a && canBlock(g, b, a)));
}

/** Blocks the rules don't allow as declared (a lone blocker on a menace creature). */
export function illegalBlocks(g: Game, pid: PlayerId): string[] {
  const out: string[] = [];
  for (const a of g.combat?.attacks ?? []) {
    const c = permanent(g, a.id);
    if (a.defender === pid && c && a.blockers.length === 1 && has(g, c, 'menace')) out.push(a.id);
  }
  return out;
}

/** Can the player do anything at instant speed right now? If not, their window is skipped. */
export function hasInstantOptions(g: Game, pid: PlayerId): boolean {
  const p = g.players[pid];
  return [...p.hand, ...p.command].some((c) => canCast(g, pid, c)) || p.battlefield.some((c) => canActivate(g, pid, c));
}

// ---------- turn structure ----------

function setStep(g: Game, step: Step) {
  g.step = step;
  for (const p of g.players) p.pool = [];
}

function beginTurn(g: Game, pid: PlayerId) {
  const p = g.players[pid];
  g.active = pid;
  g.priority = pid;
  g.turn++;
  g.combat = null;
  setStep(g, 'main1');
  p.landsPlayed = 0;
  for (const c of p.battlefield) {
    c.tapped = false;
    c.sick = false;
  }
  log(g, `Turn ${g.turn} — ${p.name}`, pid);
  broadcast(g, 'onUpkeep', { player: pid });
  draw(g, pid, 1);
}

function endTurn(g: Game) {
  broadcast(g, 'onEndStep', { player: g.active });
  checkState(g);
  if (g.winner !== null || g.players[g.active].lost) return;
  g.combat = null;
  if (g.players[g.active].hand.length > MAX_HAND) {
    setStep(g, 'discard');
    g.priority = g.active;
    return;
  }
  cleanupAndNext(g);
}

function cleanupAndNext(g: Game) {
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

function declareAttackers(g: Game) {
  const combat = g.combat!;
  const names: string[] = [];
  for (const a of combat.attacks) {
    const c = permanent(g, a.id)!;
    if (!has(g, c, 'vigilance')) c.tapped = true;
    names.push(`${label(c)} → ${g.players[a.defender].name}`);
  }
  log(g, `${says(g.players[g.active], 'attacks')}: ${names.join(', ')}.`, g.active);
  for (const a of [...combat.attacks]) {
    const c = permanent(g, a.id);
    if (!c) continue;
    scriptOf(c.name).onAttack?.(g, { self: c, defender: a.defender });
    broadcast(g, 'onCreatureAttacks', { attacker: c, defender: a.defender });
  }
  checkState(g);
  if (g.winner !== null || !g.combat || g.players[g.active].lost) return;
  const order: PlayerId[] = [];
  for (let pid = nextLiving(g, g.active); pid !== g.active; pid = nextLiving(g, pid)) {
    if (blockCandidates(g, pid).length) order.push(pid);
  }
  g.combat.toBlock = order;
  if (order.length) {
    setStep(g, 'blockers');
    g.priority = order[0];
  } else {
    toDamage(g);
  }
}

function toDamage(g: Game) {
  const combat = g.combat!;
  for (const a of combat.attacks) {
    a.blocked = a.blockers.length > 0;
    const c = permanent(g, a.id);
    if (c && a.blocked) {
      log(g, `${label(c)} is blocked by ${a.blockers.map((b) => label(permanent(g, b)!)).join(', ')}.`, a.defender);
    }
  }
  setStep(g, 'damage');
  g.priority = g.active;
  if (!hasInstantOptions(g, g.active)) resolveCombat(g);
}

/** One combat damage step. All damage is worked out first, then dealt at the same time. */
function damageStep(g: Game, firstStrike: boolean, struckFirst: Set<string>) {
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
  checkState(g);
}

function resolveCombat(g: Game) {
  if (g.combat) {
    const fighters = g.combat.attacks.flatMap((a) => [a.id, ...a.blockers]).map((id) => permanent(g, id));
    const anyFirst = fighters.some((c) => c && (has(g, c, 'first strike') || has(g, c, 'double strike')));
    const struckFirst = new Set<string>();
    if (anyFirst) damageStep(g, true, struckFirst);
    if (g.combat && g.winner === null) damageStep(g, false, struckFirst);
  }
  g.combat = null;
  setStep(g, 'main2');
  g.priority = g.active;
}

// ---------- actions ----------

function act(g: Game, a: Action): boolean {
  const pid = g.priority;
  const p = g.players[pid];
  if (g.step === 'gameOver') return false;

  switch (a.type) {
    case 'playLand': {
      const c = p.hand.find((x) => x.id === a.card);
      if (!c || !canPlayLand(g, pid, c)) return false;
      p.landsPlayed++;
      log(g, `${says(p, 'plays')} ${label(c)}.`, pid);
      enterBattlefield(g, c);
      return true;
    }

    case 'cast': {
      const c = p.hand.find((x) => x.id === a.card) ?? p.command.find((x) => x.id === a.card);
      if (!c || !canCast(g, pid, c)) return false;
      const specs = castTargets(c);
      const targets = specs.map((_, i) => a.targets?.[i] ?? null);
      if (!targetsOk(g, pid, c, specs, targets, isPermanentCard(c))) return false;
      pay(g, pid, castCost(g, c));
      if (c.zone === 'command') p.commanderCasts++;
      const chosen = targets.filter((t): t is TargetRef => !!t).map((t) => describeRef(g, t));
      log(g, `${says(p, 'casts')} ${label(c)}${chosen.length ? ` targeting ${chosen.join(' and ')}` : ''}.`, pid);
      g.lastSpell = { seq: (g.lastSpell?.seq ?? 0) + 1, name: c.name, caster: pid };
      broadcast(g, 'onCast', { card: c, caster: pid });
      if (isPermanentCard(c)) {
        enterBattlefield(g, c, { targets });
      } else {
        moveCard(g, c, 'graveyard');
        scriptOf(c.name).onResolve?.(g, { self: c, you: pid, targets });
      }
      return true;
    }

    case 'activate': {
      const c = p.battlefield.find((x) => x.id === a.card);
      if (!c || !canActivate(g, pid, c)) return false;
      const ab = scriptOf(c.name).activated!;
      const specs = ab.targets ?? [];
      const targets = specs.map((_, i) => a.targets?.[i] ?? null);
      if (!targetsOk(g, pid, c, specs, targets, false)) return false;
      if (ab.cost.mana) pay(g, pid, parseCost(ab.cost.mana));
      if (ab.cost.tap) c.tapped = true;
      log(g, `${says(p, 'activates')} ${label(c)}.`, pid);
      if (ab.cost.sacrifice) dieMany(g, [c], 'is sacrificed');
      ab.resolve(g, { self: c, you: pid, targets });
      return true;
    }

    // Tapping for mana by hand, and taking it back. Not logged: it is the one thing a player can undo.
    case 'tapMana': {
      const c = p.battlefield.find((x) => x.id === a.card);
      if (!c || g.step === 'discard' || !canTapForMana(g, pid, c)) return false;
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
      if (g.step !== 'attackers' || !g.combat || !c || !canAttack(g, c)) return false;
      if (!defender || defender.lost || defender.id === pid) return false;
      const existing = g.combat.attacks.find((x) => x.id === c.id);
      if (existing) existing.defender = a.defender;
      else g.combat.attacks.push({ id: c.id, defender: a.defender, blockers: [], blocked: false });
      return true;
    }

    case 'undeclareAttack': {
      if (g.step !== 'attackers' || !g.combat || !g.combat.attacks.some((x) => x.id === a.card)) return false;
      g.combat.attacks = g.combat.attacks.filter((x) => x.id !== a.card);
      return true;
    }

    case 'declareBlock': {
      if (g.step !== 'blockers' || !g.combat) return false;
      const blocker = p.battlefield.find((x) => x.id === a.blocker);
      const attack = g.combat.attacks.find((x) => x.id === a.attacker);
      const attacker = permanent(g, a.attacker);
      if (!blocker || !attack || !attacker || attack.defender !== pid || !canBlock(g, blocker, attacker)) return false;
      for (const x of g.combat.attacks) x.blockers = x.blockers.filter((b) => b !== blocker.id);
      attack.blockers.push(blocker.id);
      return true;
    }

    case 'undeclareBlock': {
      if (g.step !== 'blockers' || !g.combat) return false;
      const attack = g.combat.attacks.find((x) => x.defender === pid && x.blockers.includes(a.blocker));
      if (!attack) return false;
      attack.blockers = attack.blockers.filter((b) => b !== a.blocker);
      return true;
    }

    case 'discard': {
      const c = p.hand.find((x) => x.id === a.card);
      if (g.step !== 'discard' || !c) return false;
      log(g, `${says(p, 'discards')} ${label(c)}.`, pid);
      moveCard(g, c, 'graveyard');
      if (p.hand.length <= MAX_HAND) cleanupAndNext(g);
      return true;
    }

    case 'pass': {
      switch (g.step) {
        case 'main1':
          if (attackCandidates(g, pid).length === 0) {
            endTurn(g);
          } else {
            g.combat = { attacks: [], toBlock: [] };
            setStep(g, 'attackers');
          }
          return true;
        case 'attackers':
          if (!g.combat?.attacks.length) {
            g.combat = null;
            setStep(g, 'main2');
          } else {
            declareAttackers(g);
          }
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
          else toDamage(g);
          return true;
        }
        case 'damage':
          resolveCombat(g);
          return true;
        case 'main2':
          endTurn(g);
          return true;
        default:
          return false;
      }
    }
  }
}

/** Runs state-based actions and repairs the turn flow if a player with a pending decision is gone. */
function settle(g: Game) {
  for (let i = 0; i < 8; i++) {
    checkState(g);
    if (g.winner !== null) {
      g.step = 'gameOver';
      g.combat = null;
      return;
    }
    if (g.players[g.active].lost) {
      beginTurn(g, nextLiving(g, g.active));
      continue;
    }
    if (g.step === 'blockers' && g.combat) {
      const combat = g.combat;
      combat.toBlock = combat.toBlock.filter((pid) => combat.attacks.some((a) => a.defender === pid));
      if (!combat.toBlock.length) {
        toDamage(g);
        continue;
      }
      g.priority = combat.toBlock[0];
    }
    if (g.players[g.priority].lost) g.priority = g.active;
    return;
  }
}

export function applyAction(g: Game, a: Action): Game {
  return produce(g, (draft) => {
    if (act(draft, a)) settle(draft);
  });
}
