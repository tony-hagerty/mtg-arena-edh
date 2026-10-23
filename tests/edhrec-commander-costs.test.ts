// EDHREC's most-played commanders in the commander-costs group: abilities that work from the
// command zone (eminence, 113.6b), commander ninjutsu (702.49), blitz (702.152), affinity
// (702.41), K'rrik's life for {B}, Morophon's coloured-mana reduction (118.7), cascade (702.85)
// and evoke given as a spell is cast (702.74). Their data is in tests/fixtures.generated.json.
import { describe, expect, it } from 'vitest';
import { cardData } from '../src/cards/db';
import { parseCard, scriptCards } from '../src/cards/oracle';
import { problemsOf } from '../src/cards/support';
import { altCostsOf, applyAction, applyBotAction, botAction, canActivate, canCast, castCost, enterBattlefield, makeCard, stats, unblockedAttackers } from '../src/engine';
import type { Action, Game, TargetRef } from '../src/engine';
import './fixtures';
import { byName, emptyGame, put, run, runWith } from './helpers';

const HAND_SCRIPTED = ['Edgar Markov', 'The Ur-Dragon', 'Oloro, Ageless Ascetic', "Yuriko, the Tiger's Shadow", 'Henzie "Toolbox" Torre', "K'rrik, Son of Yawgmoth", 'Morophon, the Boundless', 'Zhulodok, Void Gorger', 'Ashling, the Limitless'];
const PARSED = ['Witherbloom, the Balancer', 'The First Sliver'];

const player = (id: number): TargetRef => ({ kind: 'player', id });

/** Passes priority (bots answering anything asked) until the stack is empty, or `until` holds. */
function settle(g: Game, until?: (g: Game) => boolean): Game {
  for (let i = 0; i < 80 && (g.decision || g.stack.length) && !until?.(g); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, { type: 'pass' });
  return g;
}

/** Player 0 plays as a person, with `name` as their commander in the command zone. */
const commanderGame = (name: string, setup: (g: Game) => void = () => {}) =>
  emptyGame((d) => {
    d.players[0].isBot = false;
    d.players[0].you = true;
    d.players[0].commanders = [name];
    d.players[0].colors = cardData(name).colorIdentity;
    d.players[0].command = [makeCard(d, name, 0, 'command', { isCommander: true })];
    setup(d);
  });

/** Passes until the next turn begins, bots answering what is asked of them. */
const passTurn = (g: Game) => {
  const turn = g.turn;
  for (let i = 0; i < 300 && g.turn === turn; i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, { type: 'pass' } as Action);
  return g;
};

/** Passes one step at a time (no auto-pass) until the game is in `step`, bots deciding for everyone. */
const untilStep = (g: Game, step: Game['step']) => {
  for (let i = 0; i < 200 && g.step !== step; i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority), { autoPass: false }) : applyAction(g, { type: 'pass' }, { autoPass: false });
  return g;
};

/** Puts player 0's commander `name` onto the battlefield in a game's setup, ready to attack. */
const onField = (d: Game, name: string) => {
  enterBattlefield(d, byName(d, 0, name, 'command')!, { controller: 0 });
  byName(d, 0, name)!.sick = false;
};

/** The cascade triggers waiting or on the stack. */
const cascades = (g: Game) => [...g.triggers, ...g.stack].filter((t) => t.hook === 'onCascade');

describe('the commander-costs group is playable', () => {
  it('every card is scripted: by hand, or read by the parser', () => {
    expect(scriptCards(PARSED)).toEqual([]);
    for (const n of [...HAND_SCRIPTED, ...PARSED]) expect({ n, problems: problemsOf(n) }).toEqual({ n, problems: [] });
  });
});

describe('eminence: abilities that function from the command zone (113.6b)', () => {
  it("Edgar Markov makes a Vampire token for another Vampire spell from the command zone or the battlefield, not from elsewhere", () => {
    let g = commanderGame('Edgar Markov', (d) => {
      put(d, 0, 'Vampire Nighthawk', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 3);
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Vampire Nighthawk', 'hand')!.id }));
    expect(g.players[0].battlefield.filter((c) => c.name === 'Vampire 1/1 B')).toHaveLength(1);
    // From the battlefield too, but Edgar itself isn't "another Vampire spell".
    let h = commanderGame('Edgar Markov', (d) => {
      put(d, 0, 'Swamp', 'battlefield', 6);
      put(d, 0, 'Mountain');
      put(d, 0, 'Plains');
      put(d, 0, 'Child of Night', 'hand');
    });
    h = settle(run(h, { type: 'cast', card: byName(h, 0, 'Edgar Markov', 'command')!.id }));
    expect(h.players[0].battlefield.filter((c) => c.name === 'Vampire 1/1 B')).toHaveLength(0);
    h = settle(run(h, { type: 'cast', card: byName(h, 0, 'Child of Night', 'hand')!.id }));
    expect(h.players[0].battlefield.filter((c) => c.name === 'Vampire 1/1 B')).toHaveLength(1);
    // In a hand (not a commander), nothing.
    let k = emptyGame((d) => {
      put(d, 0, 'Edgar Markov', 'hand');
      put(d, 0, 'Child of Night', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 2);
    });
    k = settle(run(k, { type: 'cast', card: byName(k, 0, 'Child of Night', 'hand')!.id }));
    expect(k.players[0].battlefield.filter((c) => c.name === 'Vampire 1/1 B')).toHaveLength(0);
  });

  it("Edgar's intervening if (603.4): a commander that went home before the trigger resolved is a new object and makes nothing", () => {
    let g = commanderGame('Edgar Markov', (d) => {
      put(d, 0, 'Swamp', 'battlefield', 10);
      put(d, 0, 'Mountain');
      put(d, 0, 'Plains');
      put(d, 0, 'Child of Night', 'hand');
      put(d, 0, 'Murder', 'hand');
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Edgar Markov', 'command')!.id }));
    g = run(g, { type: 'cast', card: byName(g, 0, 'Child of Night', 'hand')!.id, hold: true });
    g = settle(g, (x) => x.stack.some((s) => s.kind === 'triggered'));
    expect(g.stack.some((s) => s.kind === 'triggered' && s.card.name === 'Edgar Markov')).toBe(true);
    // Edgar dies and goes to the command zone with the trigger still waiting.
    g = run(g, { type: 'cast', card: byName(g, 0, 'Murder', 'hand')!.id, targets: [{ kind: 'card', id: byName(g, 0, 'Edgar Markov')!.id }] });
    g = settle(g);
    expect(byName(g, 0, 'Edgar Markov', 'command')).toBeDefined();
    expect(g.players[0].battlefield.filter((c) => c.name === 'Vampire 1/1 B')).toHaveLength(0);
  });

  it('Edgar attacking puts a +1/+1 counter on each Vampire you control', () => {
    let g = commanderGame('Edgar Markov', (d) => {
      onField(d, 'Edgar Markov');
      put(d, 0, 'Child of Night');
      put(d, 0, 'Serra Angel');
    });
    g = untilStep(g, 'attackers');
    g = run(g, { type: 'declareAttack', card: byName(g, 0, 'Edgar Markov')!.id, defender: 1 }, { type: 'pass' });
    g = settle(g);
    expect(byName(g, 0, 'Edgar Markov')!.counters['+1/+1']).toBe(1);
    expect(byName(g, 0, 'Child of Night')!.counters['+1/+1']).toBe(1);
    expect(byName(g, 0, 'Serra Angel')!.counters['+1/+1']).toBeUndefined();
  });

  it("The Ur-Dragon's eminence: other Dragon spells cost {1} less from the command zone (601.2f), not itself, not non-Dragons", () => {
    const g = commanderGame('The Ur-Dragon', (d) => {
      put(d, 0, 'Shivan Dragon', 'hand');
      put(d, 0, 'Serra Angel', 'hand');
    });
    expect(castCost(g, byName(g, 0, 'Shivan Dragon', 'hand')!).generic).toBe(3);
    expect(castCost(g, byName(g, 0, 'Serra Angel', 'hand')!).generic).toBe(3);
    expect(castCost(g, byName(g, 0, 'The Ur-Dragon', 'command')!).generic).toBe(4);
    // Another player's Dragon isn't "you cast".
    const h = commanderGame('The Ur-Dragon', (d) => put(d, 1, 'Shivan Dragon', 'hand'));
    expect(castCost(h, byName(h, 1, 'Shivan Dragon', 'hand')!).generic).toBe(4);
  });

  it('The Ur-Dragon draws a card for each attacking Dragon, then you may put a permanent card from your hand onto the battlefield', () => {
    let g = commanderGame('The Ur-Dragon', (d) => {
      onField(d, 'The Ur-Dragon');
      put(d, 0, 'Shivan Dragon');
      put(d, 0, 'Serra Angel');
      put(d, 0, 'Shock', 'hand');
      put(d, 0, 'Child of Night', 'hand');
    });
    g = untilStep(g, 'attackers');
    const ids = ['The Ur-Dragon', 'Shivan Dragon', 'Serra Angel'].map((n) => byName(g, 0, n)!.id);
    g = run(g, ...ids.map((card): Action => ({ type: 'declareAttack', card, defender: 1 })), { type: 'pass' });
    g = settle(g, (x) => x.decision?.type === 'chooseCards');
    expect(g.decision?.type).toBe('chooseCards');
    // Two Dragons attacked: two cards drawn. Only permanent cards may be put onto the battlefield.
    expect(g.players[0].hand).toHaveLength(4);
    const choice = g.decision!.type === 'chooseCards' ? g.decision.choice : null;
    expect(choice && choice.kind === 'pick' && choice.cards.includes(byName(g, 0, 'Shock', 'hand')!.id)).toBe(false);
    g = run(g, { type: 'chooseCards', cards: [byName(g, 0, 'Child of Night', 'hand')!.id] });
    expect(byName(g, 0, 'Child of Night')).toBeDefined();
    // "You may": none is fine.
    let h = commanderGame('The Ur-Dragon', (d) => {
      onField(d, 'The Ur-Dragon');
      put(d, 0, 'Child of Night', 'hand');
    });
    h = untilStep(h, 'attackers');
    h = run(h, { type: 'declareAttack', card: byName(h, 0, 'The Ur-Dragon')!.id, defender: 1 }, { type: 'pass' });
    h = settle(h, (x) => x.decision?.type === 'chooseCards');
    h = run(h, { type: 'chooseCards', cards: [] });
    expect(byName(h, 0, 'Child of Night')).toBeUndefined();
    expect(h.players[0].hand).toHaveLength(2);
  });

  it('Oloro gains 2 life at your upkeep from the command zone, and both abilities on the battlefield; the life-gain trigger asks to pay {1}', () => {
    let g = commanderGame('Oloro, Ageless Ascetic');
    g = passTurn(g);
    // Everyone else's turns go by; at player 0's next upkeep Oloro's last ability triggers once.
    for (let i = 0; i < 4 && g.active !== 0; i++) g = passTurn(g);
    g = settle(g, (x) => x.decision?.type === 'ask');
    expect(g.players[0].life).toBe(42);
    // On the battlefield: the first ability gains 2, the second then offers {1} for a card and 1 life from each opponent.
    let h = commanderGame('Oloro, Ageless Ascetic', (d) => {
      enterBattlefield(d, byName(d, 0, 'Oloro, Ageless Ascetic', 'command')!, { controller: 0 });
      put(d, 0, 'Plains');
    });
    h = passTurn(h);
    for (let i = 0; i < 4 && h.active !== 0; i++) h = passTurn(h);
    h = settle(h, (x) => x.decision?.type === 'ask');
    expect(h.players[0].life).toBe(42);
    expect(h.decision).toMatchObject({ type: 'ask', choice: { cost: '{1}' } });
    const hand = h.players[0].hand.length;
    h = settle(run(h, { type: 'answer', yes: true }));
    // One card from Oloro; auto-pass then went on through the draw step (one more).
    expect(h.players[0].hand).toHaveLength(hand + 2);
    expect(h.step).toBe('main1');
    expect(h.players.slice(1).map((p) => p.life)).toEqual([39, 39, 39]);
  });
});

describe('commander ninjutsu (702.49)', () => {
  /** Child of Night declared as an attacker; with `declared`, the declaration is done too. */
  const attacking = (declared = true) => {
    let g = commanderGame("Yuriko, the Tiger's Shadow", (d) => {
      put(d, 0, 'Child of Night');
      put(d, 0, 'Island');
      put(d, 0, 'Swamp');
      // The top card is known: a Shivan Dragon, mana value 6.
      d.players[0].library = [makeCard(d, 'Shivan Dragon', 0, 'library'), ...d.players[0].library];
    });
    g = untilStep(g, 'attackers');
    g = run(g, { type: 'declareAttack', card: byName(g, 0, 'Child of Night')!.id, defender: 1 });
    return declared ? run(g, { type: 'pass' }) : g;
  };

  it('works only once blockers are declared, with an unblocked attacker, from the command zone or hand', () => {
    let g = attacking(false);
    const yuriko = () => byName(g, 0, "Yuriko, the Tiger's Shadow", 'command')!;
    // Attackers being declared: nothing is unblocked yet (509.1h).
    expect(g.step).toBe('attackers');
    expect(unblockedAttackers(g, 0)).toEqual([]);
    expect(canActivate(g, 0, yuriko())).toBe(false);
    g = run(g, { type: 'pass' });
    g = untilStep(g, 'blockers');
    g = settle(g, (x) => x.step === 'blockers' && !x.decision);
    expect(g.step).toBe('blockers');
    expect(unblockedAttackers(g, 0).map((c) => c.name)).toEqual(['Child of Night']);
    expect(canActivate(g, 0, yuriko())).toBe(true);
    // The ability needs the creature named, and it must be an unblocked attacker.
    expect(applyAction(g, { type: 'activate', card: yuriko().id })).toBe(g);
    expect(applyAction(g, { type: 'activate', card: yuriko().id, returnAttacker: byName(g, 0, 'Island')!.id })).toBe(g);
    const casts = g.players[0].commanderCasts[0];
    g = runWith({ autoPass: false }, g, { type: 'activate', card: yuriko().id, returnAttacker: byName(g, 0, 'Child of Night')!.id });
    // The returned creature is in its owner's hand as the ability goes on the stack; Yuriko is still in the command zone (702.49b).
    expect(byName(g, 0, 'Child of Night', 'hand')).toBeDefined();
    expect(byName(g, 0, "Yuriko, the Tiger's Shadow", 'command')).toBeDefined();
    // Everyone passes: the ability resolves, still in the declare blockers step.
    for (let i = 0; i < 8 && g.stack.length; i++) g = applyAction(g, { type: 'pass' }, { autoPass: false });
    expect(g.step).toBe('blockers');
    const y = byName(g, 0, "Yuriko, the Tiger's Shadow")!;
    // Tapped and attacking the same player (702.49c), and unblocked (508.4d); not a cast, so no commander tax (903.8).
    expect(y.tapped).toBe(true);
    expect(g.combat?.attacks).toContainEqual({ id: y.id, defender: 1, target: null, blockers: [], blocked: false });
    expect(g.players[0].commanderCasts[0]).toBe(casts);
    expect(g.players[0].pool).toEqual([]);
  });

  it("Yuriko's combat damage reveals the top card into your hand and each opponent loses its mana value", () => {
    let g = attacking();
    g = untilStep(g, 'blockers');
    g = settle(g, (x) => x.step === 'blockers' && !x.decision);
    g = run(g, { type: 'activate', card: byName(g, 0, "Yuriko, the Tiger's Shadow", 'command')!.id, returnAttacker: byName(g, 0, 'Child of Night')!.id });
    g = settle(g);
    g = untilStep(g, 'main2');
    g = settle(g);
    // Yuriko (a Ninja, 1 power) hit player 1: Shivan Dragon (mana value 6) went to the hand and every opponent lost 6.
    expect(byName(g, 0, 'Shivan Dragon', 'hand')).toBeDefined();
    expect(g.players.map((p) => p.life)).toEqual([40, 33, 34, 34]);
  });
});

describe('blitz given by Henzie "Toolbox" Torre (702.152)', () => {
  it('a creature spell with mana value 4 or more has blitz for its mana cost, less {1} per commander cast from the command zone', () => {
    let g = commanderGame('Henzie "Toolbox" Torre', (d) => {
      onField(d, 'Henzie "Toolbox" Torre');
      d.players[0].commanderCasts = [2];
      put(d, 0, 'Serra Angel', 'hand');
      put(d, 0, 'Child of Night', 'hand');
      put(d, 0, 'Plains', 'battlefield', 5);
    });
    const angel = byName(g, 0, 'Serra Angel', 'hand')!;
    expect(altCostsOf(g, angel, 0, 0)).toEqual([0]);
    expect(altCostsOf(g, byName(g, 0, 'Child of Night', 'hand')!, 0, 0)).toEqual([]);
    // {3}{W}{W} less {2}: the generic part only (601.2f).
    expect(castCost(g, angel, { alt: 0 })).toMatchObject({ generic: 1, pips: ['W', 'W'] });
    expect(castCost(g, angel, {})).toMatchObject({ generic: 3 });
    g = settle(run(g, { type: 'cast', card: angel.id, alt: 0 }));
    const angel2 = byName(g, 0, 'Serra Angel')!;
    expect(stats(g, angel2).keywords.has('haste')).toBe(true);
    expect(angel2.cast?.blitz).toBe(true);
    // Sacrificed at the beginning of the next end step; its death draws a card.
    const hand = g.players[0].hand.length;
    g = untilStep(g, 'end');
    g = settle(g);
    expect(byName(g, 0, 'Serra Angel')).toBeUndefined();
    expect(byName(g, 0, 'Serra Angel', 'graveyard')).toBeDefined();
    expect(g.players[0].hand).toHaveLength(hand + 1);
  });

  it('a blitzed creature dying another way still draws, and the blitz stays once Henzie has left', () => {
    let g = commanderGame('Henzie "Toolbox" Torre', (d) => {
      onField(d, 'Henzie "Toolbox" Torre');
      put(d, 0, 'Serra Angel', 'hand');
      put(d, 0, 'Murder', 'hand');
      put(d, 0, 'Plains', 'battlefield', 5);
      put(d, 0, 'Swamp', 'battlefield', 6);
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Serra Angel', 'hand')!.id, alt: 0 }));
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Murder', 'hand')!.id, targets: [{ kind: 'card', id: byName(g, 0, 'Henzie "Toolbox" Torre')!.id }] }));
    expect(byName(g, 0, 'Henzie "Toolbox" Torre')).toBeUndefined();
    expect(stats(g, byName(g, 0, 'Serra Angel')!).keywords.has('haste')).toBe(true);
    const hand = g.players[0].hand.length;
    g = untilStep(g, 'end');
    g = settle(g);
    expect(byName(g, 0, 'Serra Angel')).toBeUndefined();
    expect(g.players[0].hand).toHaveLength(hand + 1);
  });
});

describe('affinity (702.41) and cascade (702.85) read by the parser', () => {
  it('Witherbloom costs {1} less for each creature you control, and gives instants and sorceries affinity for creatures', () => {
    scriptCards(PARSED);
    const g = emptyGame((d) => {
      put(d, 0, 'Witherbloom, the Balancer', 'hand');
      put(d, 0, 'Child of Night', 'battlefield', 3);
      put(d, 1, 'Serra Angel', 'battlefield', 2);
    });
    expect(castCost(g, byName(g, 0, 'Witherbloom, the Balancer', 'hand')!)).toMatchObject({ generic: 3, pips: ['B', 'G'] });
    const h = emptyGame((d) => {
      put(d, 0, 'Witherbloom, the Balancer');
      put(d, 0, 'Child of Night', 'battlefield', 2);
      put(d, 0, 'Spectral Procession', 'hand');
      put(d, 0, 'Serra Angel', 'hand');
    });
    // A sorcery: {2/W}{2/W}{2/W} has no generic mana to take off; a creature spell isn't affected.
    expect(castCost(h, byName(h, 0, 'Serra Angel', 'hand')!).generic).toBe(3);
    const k = emptyGame((d) => {
      put(d, 0, 'Witherbloom, the Balancer');
      put(d, 0, 'Serra Angel', 'battlefield', 2);
      put(d, 0, 'Murder', 'hand');
    });
    // Murder {1}{B}{B} with three creatures (Witherbloom too): {B}{B}.
    expect(castCost(k, byName(k, 0, 'Murder', 'hand')!)).toMatchObject({ generic: 0, pips: ['B', 'B'] });
  });

  it("The First Sliver cascades: exile until a cheaper nonland card, may cast it free, the rest on the bottom at random", () => {
    scriptCards(PARSED);
    let g = emptyGame((d) => {
      d.players[0].isBot = false;
      d.players[0].you = true;
      put(d, 0, 'The First Sliver', 'hand');
      for (const n of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']) put(d, 0, n);
      // Top of the library: a land, a 5-cost creature (not less than 5), then Child of Night (2).
      d.players[0].library = [makeCard(d, 'Forest', 0, 'library'), makeCard(d, 'Serra Angel', 0, 'library'), makeCard(d, 'Child of Night', 0, 'library'), ...d.players[0].library];
    });
    const size = g.players[0].library.length;
    g = runWith({ autoPass: false }, g, { type: 'cast', card: byName(g, 0, 'The First Sliver', 'hand')!.id });
    expect(cascades(g)).toHaveLength(1);
    g = settle(g, (x) => x.decision?.type === 'cast');
    expect(g.decision).toMatchObject({ type: 'cast', choice: { free: true, maxMv: 4 } });
    expect(g.players[0].exile.map((c) => c.name)).toEqual(['Forest', 'Serra Angel', 'Child of Night']);
    // Cast it free: it goes on the stack above the Sliver; the other two go on the bottom.
    g = runWith({ autoPass: false }, g, { type: 'cast', card: byName(g, 0, 'Child of Night', 'exile')!.id });
    expect(g.stack.map((s) => s.card.name)).toEqual(['The First Sliver', 'Child of Night']);
    expect(g.players[0].exile).toEqual([]);
    expect(g.players[0].library.slice(-2).map((c) => c.name).sort()).toEqual(['Forest', 'Serra Angel']);
    expect(g.players[0].library).toHaveLength(size - 3 + 2);
    g = settle(g);
    expect(byName(g, 0, 'Child of Night')).toBeDefined();
    expect(byName(g, 0, 'The First Sliver')).toBeDefined();
  });

  it('exiles the cards one at a time, each its own event (Laelia, the Blade Reforged\'s ruling), not all at once', () => {
    scriptCards(PARSED);
    let g = emptyGame((d) => {
      d.players[0].isBot = false;
      put(d, 0, 'The First Sliver', 'hand');
      for (const n of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']) put(d, 0, n);
      d.players[0].library = [makeCard(d, 'Forest', 0, 'library'), makeCard(d, 'Plains', 0, 'library'), makeCard(d, 'Child of Night', 0, 'library'), ...d.players[0].library];
    });
    const before = g.log.length;
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'The First Sliver', 'hand')!.id }), (x) => x.decision?.type === 'cast');
    // No ability watches cards leaving a library for exile, so the events show as separate zone
    // changes: one log line each, in order, and each card timestamped after the one before (613.7d).
    const lines = g.log.slice(before).filter((l) => /exiles .* from the top of/.test(l.text)).map((l) => l.cards);
    expect(lines).toEqual([['Forest'], ['Plains'], ['Child of Night']]);
    const exiled = g.players[0].exile;
    expect(exiled.map((c) => c.name)).toEqual(['Forest', 'Plains', 'Child of Night']);
    expect(exiled[0].ts).toBeLessThan(exiled[1].ts);
    expect(exiled[1].ts).toBeLessThan(exiled[2].ts);
  });

  it('declining the cascaded card puts it on the bottom with the rest; nothing found puts everything back', () => {
    scriptCards(PARSED);
    let g = emptyGame((d) => {
      d.players[0].isBot = false;
      put(d, 0, 'The First Sliver', 'hand');
      for (const n of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']) put(d, 0, n);
      d.players[0].library = [makeCard(d, 'Child of Night', 0, 'library'), ...d.players[0].library];
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'The First Sliver', 'hand')!.id }), (x) => x.decision?.type === 'cast');
    g = settle(run(g, { type: 'answer', yes: false }));
    expect(g.players[0].exile).toEqual([]);
    expect(g.players[0].library[g.players[0].library.length - 1].name).toBe('Child of Night');
    // A library of nothing but lands: all exiled, all put back.
    let h = emptyGame((d) => {
      d.players[0].isBot = false;
      put(d, 0, 'The First Sliver', 'hand');
      for (const n of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']) put(d, 0, n);
      d.players[0].library = [makeCard(d, 'Forest', 0, 'library'), makeCard(d, 'Plains', 0, 'library')];
    });
    h = settle(run(h, { type: 'cast', card: byName(h, 0, 'The First Sliver', 'hand')!.id }));
    expect(h.players[0].exile).toEqual([]);
    expect(h.players[0].library).toHaveLength(2);
  });

  it('"Sliver spells you cast have cascade": a Sliver cast with The First Sliver out cascades; a non-Sliver and an opponent\'s do not', () => {
    scriptCards(PARSED);
    let g = emptyGame((d) => {
      put(d, 0, 'The First Sliver');
      put(d, 0, 'Serra Angel', 'hand');
      put(d, 0, 'Plains', 'battlefield', 5);
    });
    g = runWith({ autoPass: false }, g, { type: 'cast', card: byName(g, 0, 'Serra Angel', 'hand')!.id });
    expect(cascades(g)).toHaveLength(0);
    // Morophon as a Sliver: changeling makes it every creature type (702.73).
    let h = emptyGame((d) => {
      put(d, 0, 'The First Sliver');
      put(d, 0, 'Morophon, the Boundless', 'hand');
      put(d, 0, 'Plains', 'battlefield', 7);
    });
    h = runWith({ autoPass: false }, h, { type: 'cast', card: byName(h, 0, 'Morophon, the Boundless', 'hand')!.id });
    expect(cascades(h)).toHaveLength(1);
  });

  it('The First Sliver cast with a second one out cascades twice (702.85c), and the parser refuses near misses', () => {
    scriptCards(PARSED);
    let g = emptyGame((d) => {
      put(d, 0, 'The First Sliver');
      put(d, 0, 'The First Sliver', 'hand');
      for (const n of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']) put(d, 0, n);
    });
    g = runWith({ autoPass: false }, g, { type: 'cast', card: byName(g, 0, 'The First Sliver', 'hand')!.id });
    expect(cascades(g)).toHaveLength(2);
    const fake = (text: string) => parseCard({ name: 'Test Card', manaCost: '{1}', cmc: 1, colors: [], colorIdentity: [], typeLine: 'Creature — Elf', oracleText: text, power: '1', toughness: '1', keywords: [], image: '', art: '' });
    expect(fake('Elf spells you cast have cascade.').ok).toBe(true);
    expect(fake('Spells you cast have cascade.').ok).toBe(true);
    expect(fake('Elf spells your opponents cast have cascade.').ok).toBe(false);
    expect(fake('Affinity for artifacts').ok).toBe(true);
    expect(fake('Affinity for artifacts you control').ok).toBe(false);
    expect(fake('Creature spells you cast have affinity for lands.').ok).toBe(true);
    expect(fake('Creature spells you cast have affinity for cards in your graveyard.').ok).toBe(false);
  });

  it("Zhulodok gives colorless spells with mana value 7 or more cast from your hand 'Cascade, cascade': two instances", () => {
    let g = commanderGame('Zhulodok, Void Gorger', (d) => {
      onField(d, 'Zhulodok, Void Gorger');
      put(d, 0, 'Meteor Golem', 'hand');
      put(d, 0, 'Serra Angel', 'hand');
      put(d, 0, 'Plains', 'battlefield', 7);
      d.players[0].library = [makeCard(d, 'Child of Night', 0, 'library'), makeCard(d, 'Child of Night', 0, 'library'), ...d.players[0].library];
    });
    g = runWith({ autoPass: false }, g, { type: 'cast', card: byName(g, 0, 'Meteor Golem', 'hand')!.id });
    expect(cascades(g)).toHaveLength(2);
    // Each resolves on its own: the first's spell goes on the stack above the second trigger (its rulings).
    g = settle(g, (x) => x.decision?.type === 'cast');
    g = runWith({ autoPass: false }, g, { type: 'cast', card: byName(g, 0, 'Child of Night', 'exile')!.id });
    expect(g.stack.map((s) => (s.kind === 'spell' ? s.card.name : s.hook))).toEqual(['Meteor Golem', 'onCascade', 'Child of Night']);
    g = settle(g, (x) => x.decision?.type === 'cast');
    expect(g.decision?.type).toBe('cast');
    // A coloured spell gets none.
    const h = commanderGame('Zhulodok, Void Gorger', (d) => {
      onField(d, 'Zhulodok, Void Gorger');
      put(d, 0, 'Serra Angel', 'hand');
      put(d, 0, 'Plains', 'battlefield', 7);
    });
    expect(cascades(runWith({ autoPass: false }, h, { type: 'cast', card: byName(h, 0, 'Serra Angel', 'hand')!.id }))).toHaveLength(0);
  });
});

describe("K'rrik, Son of Yawgmoth: 2 life for each {B} in a cost", () => {
  it('pays {B} with 2 life when the mana is not there, for spells and abilities you pay for', () => {
    let g = commanderGame("K'rrik, Son of Yawgmoth", (d) => {
      onField(d, "K'rrik, Son of Yawgmoth");
      put(d, 0, 'Murder', 'hand');
      put(d, 0, 'Plains');
    });
    const murder = byName(g, 0, 'Murder', 'hand')!;
    // {1}{B}{B}: each {B} can be paid with 2 life (like {B/P}).
    expect(castCost(g, murder)).toMatchObject({ generic: 1, pips: [], hybrid: [['B', 'life'], ['B', 'life']] });
    expect(canCast(g, 0, murder)).toBe(true);
    g = settle(run(g, { type: 'cast', card: murder.id, targets: [{ kind: 'card', id: byName(g, 0, "K'rrik, Son of Yawgmoth")!.id }] }));
    expect(g.players[0].life).toBe(36);
    // Not for an opponent's costs, and not without K'rrik.
    const h = emptyGame((d) => {
      put(d, 1, "K'rrik, Son of Yawgmoth");
      put(d, 0, 'Murder', 'hand');
      put(d, 0, 'Plains');
    });
    expect(castCost(h, byName(h, 0, 'Murder', 'hand')!).pips).toEqual(['B', 'B']);
    expect(canCast(h, 0, byName(h, 0, 'Murder', 'hand')!)).toBe(false);
  });

  it("casting a black spell puts a +1/+1 counter on K'rrik, which the cast's own trigger (not the spell) does", () => {
    let g = commanderGame("K'rrik, Son of Yawgmoth", (d) => {
      onField(d, "K'rrik, Son of Yawgmoth");
      put(d, 0, 'Child of Night', 'hand');
      put(d, 0, 'Shock', 'hand');
      put(d, 0, 'Mountain');
      put(d, 0, 'Swamp', 'battlefield', 2);
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Child of Night', 'hand')!.id }));
    expect(byName(g, 0, "K'rrik, Son of Yawgmoth")!.counters['+1/+1']).toBe(1);
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Shock', 'hand')!.id, targets: [player(1)] }));
    expect(byName(g, 0, "K'rrik, Son of Yawgmoth")!.counters['+1/+1']).toBe(1);
  });
});

describe('Morophon, the Boundless', () => {
  const morophon = (type: string, setup: (g: Game) => void) => {
    let g = commanderGame('Morophon, the Boundless', (d) => {
      put(d, 0, 'Plains', 'battlefield', 7);
      setup(d);
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Morophon, the Boundless', 'command')!.id });
    g = settle(g, (x) => x.decision?.type === 'name');
    expect(g.decision).toMatchObject({ type: 'name', choice: { of: 'creature type' } });
    return settle(run(g, { type: 'name', name: type }));
  };

  it('chooses a creature type as it enters (614.12a); spells of that type cost one of each colour less, coloured mana only (118.7)', () => {
    const g = morophon('Angel', (d) => {
      put(d, 0, 'Serra Angel', 'hand');
      put(d, 0, 'Child of Night', 'hand');
      put(d, 1, 'Serra Angel', 'hand');
    });
    expect(byName(g, 0, 'Morophon, the Boundless')!.chosen).toBe('Angel');
    // {3}{W}{W}: one {W} off, the other {W} stays, and the generic mana isn't touched.
    expect(castCost(g, byName(g, 0, 'Serra Angel', 'hand')!)).toMatchObject({ generic: 3, pips: ['W'] });
    expect(castCost(g, byName(g, 0, 'Child of Night', 'hand')!)).toMatchObject({ generic: 1, pips: ['B'] });
    expect(castCost(g, byName(g, 1, 'Serra Angel', 'hand')!)).toMatchObject({ generic: 3, pips: ['W', 'W'] });
  });

  it('reduces a hybrid symbol by one of its halves (118.7e) and a Phyrexian symbol by its colour (118.7f), choosing so most symbols are paid for', () => {
    const g = morophon('Spirit', (d) => {
      put(d, 0, 'Spectral Procession', 'hand');
      put(d, 0, 'Kokusho, the Evening Star', 'hand');
    });
    // Spectral Procession isn't a Spirit spell (it makes Spirits): unchanged.
    expect(castCost(g, byName(g, 0, 'Spectral Procession', 'hand')!).hybrid).toHaveLength(3);
    // Kokusho (Dragon Spirit, {4}{B}{B}): one {B} off.
    expect(castCost(g, byName(g, 0, 'Kokusho, the Evening Star', 'hand')!)).toMatchObject({ generic: 4, pips: ['B'] });
  });

  it('other creatures you control of the chosen type get +1/+1; changeling counts (702.73)', () => {
    const g = morophon('Angel', (d) => {
      put(d, 0, 'Serra Angel');
      put(d, 0, 'Child of Night');
      put(d, 1, 'Serra Angel');
    });
    expect(stats(g, byName(g, 0, 'Serra Angel')!)).toMatchObject({ power: 5, toughness: 5 });
    expect(stats(g, byName(g, 0, 'Child of Night')!)).toMatchObject({ power: 2, toughness: 1 });
    expect(stats(g, byName(g, 1, 'Serra Angel')!)).toMatchObject({ power: 4, toughness: 4 });
    // Not itself ("other"), though it is every creature type.
    expect(stats(g, byName(g, 0, 'Morophon, the Boundless')!)).toMatchObject({ power: 6, toughness: 6 });
  });
});

describe('Ashling, the Limitless', () => {
  it('Elemental permanent spells cast from your hand gain evoke {4}; the evoked permanent is sacrificed and Ashling copies it', () => {
    let g = commanderGame('Ashling, the Limitless', (d) => {
      onField(d, 'Ashling, the Limitless');
      put(d, 0, 'Avenger of Zendikar', 'hand');
      put(d, 0, 'Serra Angel', 'hand');
      put(d, 0, 'Forest', 'battlefield', 4);
    });
    const avenger = byName(g, 0, 'Avenger of Zendikar', 'hand')!;
    expect(altCostsOf(g, avenger, 0, 0)).toEqual([0]);
    expect(castCost(g, avenger, { alt: 0 })).toMatchObject({ generic: 4, pips: [] });
    expect(altCostsOf(g, byName(g, 0, 'Serra Angel', 'hand')!, 0, 0)).toEqual([]);
    g = settle(run(g, { type: 'cast', card: avenger.id, alt: 0 }));
    // The card was sacrificed as it entered (702.74a); the token copy stays, with haste this turn.
    expect(byName(g, 0, 'Avenger of Zendikar', 'graveyard')).toBeDefined();
    const token = g.players[0].battlefield.find((c) => c.isToken && c.copy?.name === 'Avenger of Zendikar')!;
    expect(token).toBeDefined();
    expect(stats(g, token).keywords.has('haste')).toBe(true);
    // At the beginning of your next end step: pay {W}{U}{B}{R}{G} or sacrifice it.
    g = untilStep(g, 'end');
    g = settle(g, (x) => x.decision?.type === 'ask');
    expect(g.decision).toMatchObject({ type: 'ask', choice: { cost: '{W}{U}{B}{R}{G}' } });
    g = settle(run(g, { type: 'answer', yes: false }));
    // The copy is gone; the Plants its enters ability made (twice: the card's and the copy's) stay.
    expect(g.players[0].battlefield.some((c) => c.copy?.name === 'Avenger of Zendikar')).toBe(false);
    expect(g.players[0].battlefield.filter((c) => c.name === 'Plant')).toHaveLength(8);
  });

  it('a token Elemental or one sacrificed by another player makes no copy; the evoke outlives Ashling leaving (its rulings)', () => {
    let g = commanderGame('Ashling, the Limitless', (d) => {
      onField(d, 'Ashling, the Limitless');
      put(d, 0, 'Lightning Elemental', 'hand');
      put(d, 0, 'Murder', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 4);
      put(d, 0, 'Swamp', 'battlefield', 3);
    });
    // Evoke paid, then Ashling is killed in response: the Elemental is still sacrificed as it enters.
    g = run(g, { type: 'cast', card: byName(g, 0, 'Lightning Elemental', 'hand')!.id, alt: 0, hold: true });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Murder', 'hand')!.id, targets: [{ kind: 'card', id: byName(g, 0, 'Ashling, the Limitless')!.id }] }), (x) => x.stack.length === 1);
    expect(byName(g, 0, 'Ashling, the Limitless')).toBeUndefined();
    g = settle(g);
    expect(byName(g, 0, 'Lightning Elemental', 'graveyard')).toBeDefined();
    expect(g.players[0].battlefield.some((c) => c.isToken)).toBe(false);
  });
});

describe('ninjutsu for bots and the UI', () => {
  it('a bot can use commander ninjutsu, returning the attacker worth least', () => {
    let g = emptyGame((d) => {
      d.players[0].commanders = ["Yuriko, the Tiger's Shadow"];
      d.players[0].colors = ['U', 'B'];
      d.players[0].command = [makeCard(d, "Yuriko, the Tiger's Shadow", 0, 'command', { isCommander: true })];
      put(d, 0, 'Child of Night');
      put(d, 0, 'Island');
      put(d, 0, 'Swamp');
    });
    g = untilStep(g, 'attackers');
    g = run(g, { type: 'declareAttack', card: byName(g, 0, 'Child of Night')!.id, defender: 1 }, { type: 'pass' });
    g = untilStep(g, 'blockers');
    g = settle(g, (x) => x.step === 'blockers' && !x.decision);
    const a = botAction(g, 0);
    expect(a).toMatchObject({ type: 'activate', returnAttacker: byName(g, 0, 'Child of Night')!.id });
    expect(applyAction(g, a)).not.toBe(g);
  });
});
