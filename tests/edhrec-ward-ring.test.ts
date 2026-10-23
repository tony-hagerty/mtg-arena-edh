// The ward-ring group of EDHREC's most-played cards (src/cards/edhrec/ward-ring.ts and the
// parser templates they share): ward with a sacrifice cost, ward among other keywords, amass,
// the Ring tempts you, partner with, types and an ability given by a static ability, activated
// abilities costing less, protection from colours, and the clauses that could go wrong.
import { describe, expect, it } from 'vitest';
import type { DeckDef } from '../src/cards/db';
import { deckProblems } from '../src/cards/db';
import { parseCard, scriptCards } from '../src/cards/oracle';
import { problemsOf } from '../src/cards/support';
import {
  activatedAbilities,
  addCounters,
  activationCost,
  amass,
  applyAction,
  applyBotAction,
  botAction,
  canBlock,
  castCost,
  counterCount,
  createToken,
  gainControl,
  dealDamage,
  enterBattlefield,
  legalTargets,
  loseLife,
  simultaneously,
  has,
  hasType,
  isRingBearer,
  makeCard,
  manaAbilities,
  scriptFor,
  stats,
  subtypesOf,
  temptWithRing,
  timesTempted,
} from '../src/engine';
import type { Action, Card, Game, PlayerId, TargetRef } from '../src/engine';
import { produce } from 'immer';
import { byName, emptyGame, put, run } from './helpers';
import './fixtures';

const GROUP = [
  'Sauron, the Dark Lord',
  'Frodo, Adventurous Hobbit',
  'Sam, Loyal Attendant',
  'Ygra, Eater of All',
  'Ragost, Deft Gastronaut',
  'Valgavoth, Harrower of Souls',
  'Miirym, Sentinel Wyrm',
  'Voja, Jaws of the Conclave',
  'Ghyrson Starn, Kelermorph',
  'Animar, Soul of Elements',
];
// The ones without a hand script are read by the Oracle text parser, as a fetched card would be.
const refused = scriptCards(GROUP);

const pass = { type: 'pass' } as const;
const player = (id: PlayerId): TargetRef => ({ kind: 'player', id });
const card = (c: { id: string }): TargetRef => ({ kind: 'card', id: c.id });
const pick = (...ids: string[]): Action => ({ type: 'chooseCards', cards: ids });
/** The choice waiting now, if any. */
const asked = (g: Game) => (g.decision && 'choice' in g.decision ? (g.decision.choice as { kind: string; text?: string; cards?: string[]; then?: string; min?: number }) : null);

/** Passes priority (bots answering anything they are asked) until the stack is empty, or `stop` holds. */
function settle(g: Game, stop?: (g: Game) => boolean): Game {
  for (let i = 0; i < 200 && (g.decision || g.stack.length || g.triggers.length) && !stop?.(g); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  return g;
}
/** Passes, bots acting as they like, until `stop` holds. */
function until(g: Game, stop: (g: Game) => boolean): Game {
  for (let i = 0; i < 800 && !stop(g); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  return g;
}
/** Player 0 is a person, so the tests answer their choices. */
const humanGame = (setup: (g: Game) => void) =>
  emptyGame((d) => {
    d.players[0].isBot = false;
    setup(d);
  });
/** Replaces a player's library with these cards, the first on top. */
function top(g: Game, pid: PlayerId, names: string[]) {
  g.players[pid].library = names.map((n) => makeCard(g, n, pid, 'library'));
}
/** Makes it `pid`'s main phase with priority. */
const turnOf = (g: Game, pid: PlayerId) => {
  g.active = pid;
  g.priority = pid;
};

describe('the ward-ring group can be played', () => {
  it('reads or scripts every card, and the engine plays each', () => {
    expect(refused).toEqual([]);
    for (const n of GROUP) expect(problemsOf(n), n).toEqual([]);
  });
});

describe('ward with a sacrifice cost (702.21a)', () => {
  const bolt = (g: Game, target: Card): Game => run(g, { type: 'cast', card: byName(g, 1, 'Lightning Bolt', 'hand')!.id, targets: [card(target)] });
  const opponentsTurn = (setup: (d: Game) => void) =>
    emptyGame((d) => {
      d.players[1].isBot = false;
      put(d, 0, 'Ygra, Eater of All');
      put(d, 1, 'Lightning Bolt', 'hand');
      put(d, 1, 'Mountain');
      setup(d);
      turnOf(d, 1);
    });

  it('"Ward—Sacrifice a Food": the targeting player may sacrifice a Food of theirs, and the spell goes on', () => {
    let g = opponentsTurn((d) => void createToken(d, 1, 'Food'));
    const ygra = byName(g, 0, 'Ygra, Eater of All')!;
    g = settle(bolt(g, ygra), (x) => asked(x)?.then === '@wardSacrifice');
    const choice = asked(g)!;
    expect(g.priority).toBe(1);
    expect(choice.min).toBe(0);
    const food = byName(g, 1, 'Food')!;
    expect(choice.cards).toEqual([food.id]);
    g = settle(run(g, pick(food.id)));
    expect(byName(g, 1, 'Food')).toBeUndefined();
    // The Bolt resolved; and the Food put into a graveyard put two +1/+1 counters on Ygra.
    const after = byName(g, 0, 'Ygra, Eater of All')!;
    expect(after.damage).toBe(3);
    expect(counterCount(after)).toBe(2);
  });

  it('counters the spell if its controller sacrifices nothing, or has nothing that fits', () => {
    let g = opponentsTurn((d) => void createToken(d, 1, 'Food'));
    g = settle(bolt(g, byName(g, 0, 'Ygra, Eater of All')!), (x) => asked(x)?.then === '@wardSacrifice');
    g = settle(run(g, pick()));
    expect(byName(g, 1, 'Food')).toBeDefined();
    expect(byName(g, 0, 'Ygra, Eater of All')!.damage).toBe(0);
    expect(byName(g, 1, 'Lightning Bolt', 'graveyard')).toBeDefined();
    // With no Food at all, nothing is asked: it can't be paid (118.3).
    let h = opponentsTurn(() => {});
    h = settle(bolt(h, byName(h, 0, 'Ygra, Eater of All')!));
    expect(byName(h, 0, 'Ygra, Eater of All')!.damage).toBe(0);
  });

  it("Ygra's other creatures are Foods, so the targeting player may sacrifice one of their creatures", () => {
    let g = opponentsTurn((d) => void put(d, 1, 'Elite Vanguard'));
    const vanguard = byName(g, 1, 'Elite Vanguard')!;
    expect(hasType(g, vanguard, 'Food')).toBe(true);
    g = settle(bolt(g, byName(g, 0, 'Ygra, Eater of All')!), (x) => asked(x)?.then === '@wardSacrifice');
    expect(asked(g)!.cards).toEqual([vanguard.id]);
  });

  it('"Ward—Sacrifice a legendary artifact or legendary creature" (Sauron): only those fit; a nonlegendary creature does not', () => {
    let g = emptyGame((d) => {
      d.players[1].isBot = false;
      put(d, 0, 'Sauron, the Dark Lord');
      put(d, 1, 'Lightning Bolt', 'hand');
      put(d, 1, 'Mountain');
      put(d, 1, 'Elite Vanguard');
      put(d, 1, 'Lyra Dawnbringer');
      turnOf(d, 1);
    });
    expect(scriptFor(byName(g, 0, 'Sauron, the Dark Lord')!).ward?.sacrifice?.label).toBe('a legendary artifact or legendary creature');
    g = settle(bolt(g, byName(g, 0, 'Sauron, the Dark Lord')!), (x) => asked(x)?.then === '@wardSacrifice');
    expect(asked(g)!.cards).toEqual([byName(g, 1, 'Lyra Dawnbringer')!.id]);
    g = settle(run(g, pick(byName(g, 1, 'Lyra Dawnbringer')!.id)));
    expect(byName(g, 1, 'Lyra Dawnbringer', 'graveyard')).toBeDefined();
    expect(byName(g, 0, 'Sauron, the Dark Lord')!.damage).toBe(3);
  });

  it("doesn't trigger for its controller's own spells", () => {
    let g = emptyGame((d) => {
      d.players[0].isBot = false;
      put(d, 0, 'Ygra, Eater of All');
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Mountain');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Lightning Bolt', 'hand')!.id, targets: [card(byName(g, 0, 'Ygra, Eater of All')!)] });
    expect([...g.triggers, ...g.stack].filter((x) => x.hook === 'onWard')).toEqual([]);
  });
});

describe('ward {N} among other keywords', () => {
  it('reads "Flying, ward {2}" and "Vigilance, trample, ward {3}" as the keywords and a ward ability', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Miirym, Sentinel Wyrm');
      put(d, 0, 'Voja, Jaws of the Conclave');
    });
    expect(scriptFor(byName(g, 0, 'Miirym, Sentinel Wyrm')!).ward).toEqual({ mana: '{2}' });
    expect(scriptFor(byName(g, 0, 'Voja, Jaws of the Conclave')!).ward).toEqual({ mana: '{3}' });
    expect(has(g, byName(g, 0, 'Miirym, Sentinel Wyrm')!, 'flying')).toBe(true);
  });

  it('charges the mana: unpaid, the spell is countered', () => {
    let g = emptyGame((d) => {
      d.players[1].isBot = false;
      put(d, 0, 'Voja, Jaws of the Conclave');
      put(d, 1, 'Lightning Bolt', 'hand');
      put(d, 1, 'Mountain', 'battlefield', 4);
      turnOf(d, 1);
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 1, 'Lightning Bolt', 'hand')!.id, targets: [card(byName(g, 0, 'Voja, Jaws of the Conclave')!)] }), (x) => asked(x)?.kind === 'ask');
    expect(asked(g)!.text).toMatch(/Pay \{3\}/);
    g = settle(run(g, { type: 'answer', yes: false }));
    expect(byName(g, 0, 'Voja, Jaws of the Conclave')!.damage).toBe(0);
  });

  it('refuses near misses: two wards, an X, or a keyword it does not know', () => {
    const fake = (text: string) => parseCard({ name: 'Test Ward', manaCost: '{1}', cmc: 1, colors: [], colorIdentity: [], typeLine: 'Creature — Test', oracleText: text, power: '1', toughness: '1', keywords: [], image: '', art: '' });
    expect(fake('Flying, ward {1}')).toMatchObject({ ok: true, script: { ward: { mana: '{1}' } } });
    expect(fake('Ward {1}\nFlying, ward {2}').ok).toBe(false);
    expect(fake('Flying, ward {X}').ok).toBe(false);
    expect(fake('Frobnicate, ward {2}').ok).toBe(false);
    expect(fake('Ward—Sacrifice a creature you control.').ok).toBe(false);
    expect(fake('Ward—Sacrifice a Food.')).toMatchObject({ ok: true, script: { ward: { sacrifice: { label: 'a Food' } } } });
  });
});

describe('amass (701.47)', () => {
  const opponentCasts = (setup: (d: Game) => void = () => {}) => {
    let g = emptyGame((d) => {
      put(d, 0, 'Sauron, the Dark Lord');
      put(d, 1, 'Lightning Bolt', 'hand');
      put(d, 1, 'Mountain');
      setup(d);
      turnOf(d, 1);
    });
    g = run(g, { type: 'cast', card: byName(g, 1, 'Lightning Bolt', 'hand')!.id, targets: [player(2)] });
    return g;
  };

  it('Sauron: "Whenever an opponent casts a spell, amass Orcs 1": a 0/0 black Orc Army with a +1/+1 counter', () => {
    const g = settle(opponentCasts());
    const army = byName(g, 0, 'Orc Army')!;
    expect(army.isToken).toBe(true);
    expect(subtypesOf(g, army)).toEqual(['Orc', 'Army']);
    expect(stats(g, army)).toMatchObject({ power: 1, toughness: 1 });
    expect(g.players[2].life).toBe(37);
  });

  it('puts the counters on the Army it has instead, which becomes an Orc in addition to its other types', () => {
    let g = emptyGame((d) => turnOf(d, 0));
    g = produce(g, (d) => void amass(d, 0, 'Zombie', 2));
    const army = byName(g, 0, 'Zombie Army')!;
    expect(counterCount(army)).toBe(2);
    g = produce(g, (d) => void amass(d, 0, 'Orc', 1));
    expect(g.players[0].battlefield.filter((c) => c.isToken)).toHaveLength(1);
    const now = byName(g, 0, 'Zombie Army')!;
    expect(counterCount(now)).toBe(3);
    expect(subtypesOf(g, now)).toEqual(expect.arrayContaining(['Zombie', 'Army', 'Orc']));
  });

  it('with two Armies the player chooses which one', () => {
    let g = opponentCasts((d) => {
      d.players[0].isBot = false;
      // One Army from amassing into nothing, and a second token like it.
      amass(d, 0, 'Orc', 1);
      addCounters(d, createToken(d, 0, 'Orc Army')[0], 1);
    });
    g = settle(g, (x) => asked(x)?.then === '@amass');
    const armies = g.players[0].battlefield.filter((c) => c.name === 'Orc Army');
    expect(asked(g)!.cards).toEqual(armies.map((c) => c.id));
    g = settle(run(g, pick(armies[1].id)));
    expect(armies.map((a) => counterCount(g.players[0].battlefield.find((c) => c.id === a.id)!))).toEqual([1, 2]);
    expect(g.players[0].battlefield.filter((c) => c.name === 'Orc Army')).toHaveLength(2);
  });
});

describe('the Ring tempts you (701.54)', () => {
  /** The Ring tempts player 0 `n` times, with whatever creatures they have; a bot answers the choice. */
  const tempt = (g: Game, n = 1, pid: PlayerId = 0) => {
    for (let i = 0; i < n; i++) g = settle(produce(g, (d) => void temptWithRing(d, pid)));
    return g;
  };
  /** Player 0 attacks player 1 with `name`, and play goes on to the declare blockers step. */
  const attack = (g: Game, name: string) => run(g, pass, { type: 'declareAttack', card: byName(g, 0, name)!.id, defender: 1 }, pass);

  it('tempts a player with no creatures: they get the emblem, and it counts (701.54c, 701.54d)', () => {
    const g = tempt(emptyGame());
    expect(timesTempted(g, 0)).toBe(1);
    expect(g.players[0].ring?.bearer).toBeNull();
    expect(g.players[0].emblems?.map((e) => e.name)).toEqual(['The Ring']);
    expect(timesTempted(g, 1)).toBe(0);
  });

  it('the only creature becomes the Ring-bearer: legendary, and not blockable by creatures with greater power', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Elite Vanguard');
      put(d, 1, 'Serra Angel');
      put(d, 1, 'Seraph of Dawn');
    });
    const vanguard = byName(g, 0, 'Elite Vanguard')!;
    expect(hasType(g, vanguard, 'Legendary')).toBe(false);
    g = tempt(g);
    const bearer = byName(g, 0, 'Elite Vanguard')!;
    expect(isRingBearer(g, bearer)).toBe(true);
    expect(hasType(g, bearer, 'Legendary')).toBe(true);
    expect(canBlock(g, byName(g, 1, 'Serra Angel')!, bearer)).toBe(false); // power 4 > 2
    expect(canBlock(g, byName(g, 1, 'Seraph of Dawn')!, bearer)).toBe(true); // power 2, not greater
  });

  it('a change of control ends the designation, even if control comes back (701.54a)', () => {
    let g = tempt(emptyGame((d) => void put(d, 0, 'Elite Vanguard')));
    g = produce(g, (d) => void gainControl(d, byName(d, 0, 'Elite Vanguard')!, 1));
    expect(isRingBearer(g, byName(g, 1, 'Elite Vanguard')!, 0)).toBe(false);
    g = produce(g, (d) => void gainControl(d, byName(d, 1, 'Elite Vanguard')!, 0));
    expect(isRingBearer(g, byName(g, 0, 'Elite Vanguard')!)).toBe(false);
    expect(hasType(g, byName(g, 0, 'Elite Vanguard')!, 'Legendary')).toBe(false);
  });

  it('tempted twice: "Whenever your Ring-bearer attacks, draw a card, then discard a card"; once, not', () => {
    const lootsWith = (times: number) => {
      let g = tempt(emptyGame((d) => void put(d, 0, 'Elite Vanguard')), times);
      g = produce(g, (d) => top(d, 0, ['Island', 'Island']));
      g = settle(attack(g, 'Elite Vanguard'));
      return g.players[0].graveyard.length;
    };
    expect(lootsWith(1)).toBe(0);
    expect(lootsWith(2)).toBe(1);
  });

  it('tempted three times: a creature blocking the Ring-bearer is sacrificed at end of combat (511.2)', () => {
    let g = tempt(emptyGame((d) => void put(d, 0, 'Elite Vanguard')), 3);
    g = produce(g, (d) => void put(d, 1, 'Angelic Wall'));
    g = attack(g, 'Elite Vanguard');
    g = settle(g, (x) => x.decision?.type === 'blockers');
    g = run(g, { type: 'declareBlock', blocker: byName(g, 1, 'Angelic Wall')!.id, attacker: byName(g, 0, 'Elite Vanguard')!.id }, pass);
    g = until(g, (x) => x.step === 'main2');
    // The 0/4 Wall survived the combat damage, then was sacrificed.
    expect(byName(g, 1, 'Angelic Wall')).toBeUndefined();
    expect(byName(g, 1, 'Angelic Wall', 'graveyard')).toBeDefined();
  });

  it('tempted four times: combat damage to a player makes each opponent lose 3 life', () => {
    let g = tempt(emptyGame((d) => void put(d, 0, 'Elite Vanguard')), 4);
    g = until(attack(g, 'Elite Vanguard'), (x) => x.step === 'main2');
    expect(g.players.map((p) => p.life)).toEqual([40, 35, 37, 37]);
  });

  it('as the Ring resolves from an ability: Sauron and Frodo, the Ring-bearer chosen from two', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Frodo, Adventurous Hobbit');
      put(d, 0, 'Sam, Loyal Attendant');
      d.players[0].lifeGained = 3;
    });
    g = attack(g, 'Frodo, Adventurous Hobbit');
    g = settle(g, (x) => asked(x)?.then === '@ringBearer');
    expect(asked(g)!.cards).toEqual([byName(g, 0, 'Frodo, Adventurous Hobbit')!.id, byName(g, 0, 'Sam, Loyal Attendant')!.id]);
    const hand = g.players[0].hand.length;
    g = settle(run(g, pick(byName(g, 0, 'Frodo, Adventurous Hobbit')!.id)), (x) => x.step !== 'attackers');
    expect(isRingBearer(g, byName(g, 0, 'Frodo, Adventurous Hobbit')!)).toBe(true);
    // Tempted once so far: "the Ring has tempted you two or more times" is false, so no card.
    expect(timesTempted(g, 0)).toBe(1);
    expect(g.players[0].hand.length).toBe(hand);
  });
});

describe('Frodo, Adventurous Hobbit and Sam, Loyal Attendant', () => {
  const frodoAttacks = (setup: (d: Game) => void) => {
    let g = emptyGame((d) => {
      put(d, 0, 'Frodo, Adventurous Hobbit');
      top(d, 0, ['Island', 'Island', 'Island']);
      setup(d);
    });
    g = run(g, pass, { type: 'declareAttack', card: byName(g, 0, 'Frodo, Adventurous Hobbit')!.id, defender: 1 }, pass);
    return settle(g, (x) => x.decision?.type === 'blockers');
  };

  it('"if you gained 3 or more life this turn" (603.4): with less, nothing happens', () => {
    const g = frodoAttacks((d) => void (d.players[0].lifeGained = 2));
    expect(timesTempted(g, 0)).toBe(0);
    // Vigilance: Frodo didn't tap to attack.
    expect(byName(g, 0, 'Frodo, Adventurous Hobbit')!.tapped).toBe(false);
  });

  it('"Then if Frodo is your Ring-bearer and the Ring has tempted you two or more times this game, draw a card"', () => {
    // The second time, Frodo is chosen (the only creature) and the count is two: a card. The Ring's own loot trigger is the first time's.
    const g = frodoAttacks((d) => {
      d.players[0].lifeGained = 3;
      temptWithRing(d, 0);
    });
    expect(timesTempted(g, 0)).toBe(2);
    expect(isRingBearer(g, byName(g, 0, 'Frodo, Adventurous Hobbit')!)).toBe(true);
    expect(g.players[0].hand.length).toBe(1);
  });

  it('draws nothing when another creature is the Ring-bearer', () => {
    let g = emptyGame((d) => {
      d.players[0].isBot = false;
      put(d, 0, 'Frodo, Adventurous Hobbit');
      put(d, 0, 'Elite Vanguard');
      top(d, 0, ['Island', 'Island']);
      d.players[0].lifeGained = 5;
      d.players[0].emblems = [makeCard(d, 'The Ring', 0, 'command', { emblem: true })];
      d.players[0].ring = { tempted: 1, bearer: null, ts: 1 };
    });
    g = run(g, pass, { type: 'declareAttack', card: byName(g, 0, 'Frodo, Adventurous Hobbit')!.id, defender: 1 }, pass);
    g = settle(g, (x) => asked(x)?.then === '@ringBearer');
    g = settle(run(g, pick(byName(g, 0, 'Elite Vanguard')!.id)), (x) => x.decision?.type === 'blockers');
    expect(timesTempted(g, 0)).toBe(2);
    expect(g.players[0].hand.length).toBe(0);
  });

  it('partner with (702.124j): the two are legal commanders together, and Sam lets a target player search for Frodo', () => {
    const deck = (commanders: string[]): DeckDef => ({ id: 'x', title: 'x', blurb: '', pilot: 'x', commanders, basics: { Plains: 98 }, cards: [] });
    expect(deckProblems(deck(['Frodo, Adventurous Hobbit', 'Sam, Loyal Attendant'])).filter((p) => /partner|commander/.test(p))).toEqual([]);
    expect(deckProblems(deck(['Frodo, Adventurous Hobbit', 'Lyra Dawnbringer'])).length).toBeGreaterThan(0);
    let g = emptyGame((d) => {
      put(d, 0, 'Sam, Loyal Attendant', 'hand');
      put(d, 0, 'Forest');
      put(d, 0, 'Plains', 'battlefield', 2);
      top(d, 0, ['Island', 'Frodo, Adventurous Hobbit', 'Island']);
      d.players[0].isBot = false;
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Sam, Loyal Attendant', 'hand')!.id });
    g = settle(g, (x) => x.decision?.type === 'targets' || asked(x)?.kind === 'ask');
    if (g.decision?.type === 'targets') g = run(g, { type: 'chooseTargets', targets: [player(0)] });
    g = settle(g, (x) => asked(x)?.kind === 'ask');
    expect(asked(g)!.text).toMatch(/card named Frodo, Adventurous Hobbit/);
    g = settle(run(g, { type: 'answer', yes: true }), (x) => asked(x)?.kind === 'search');
    const found = byName(g, 0, 'Frodo, Adventurous Hobbit', 'library')!;
    g = settle(run(g, pick(found.id)));
    expect(byName(g, 0, 'Frodo, Adventurous Hobbit', 'hand')).toBeDefined();
  });

  it('Sam: a Food at the beginning of combat on your turn, and activated abilities of your Foods cost {1} less', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Sam, Loyal Attendant');
      put(d, 1, 'Ragost, Deft Gastronaut');
      put(d, 1, 'Sol Ring');
    });
    g = settle(run(g, pass), (x) => x.step === 'attackers' || x.decision?.type === 'attackers');
    const food = byName(g, 0, 'Food')!;
    expect(food).toBeDefined();
    const [ab] = activatedAbilities(g, food);
    expect(activationCost(g, 0, food, ab)).toMatchObject({ generic: 1 });
    // An opponent's Food (Ragost makes their Sol Ring one) isn't Sam's controller's.
    const ring = byName(g, 1, 'Sol Ring')!;
    expect(hasType(g, ring, 'Food')).toBe(true);
    const lent = activatedAbilities(g, ring).at(-1)!;
    expect(activationCost(g, 1, ring, lent)).toMatchObject({ generic: 2 });
  });

  it('cost reduction reaches mana abilities with mana in their cost, never below {0} (602.2b, 601.2f)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Sam, Loyal Attendant');
      put(d, 0, 'Ragost, Deft Gastronaut');
      put(d, 0, 'Arcane Signet');
    });
    // Arcane Signet has no mana in its cost: nothing to reduce. A Food token's {2} becomes {1}.
    const signet = byName(g, 0, 'Arcane Signet')!;
    expect(manaAbilities(g, signet)[0].cost).toBeUndefined();
    g = produce(g, (d) => void createToken(d, 0, 'Food'));
    const food = byName(g, 0, 'Food')!;
    // Ragost gives it a second {2} ability; with Sam both cost {1}.
    expect(activatedAbilities(g, food).map((a) => activationCost(g, 0, food, a).generic)).toEqual([1, 1]);
  });
});

describe('Sauron, the Dark Lord', () => {
  it('an Army dealing combat damage tempts you; then "you may discard your hand. If you do, draw four cards."', () => {
    const play = (yes: boolean) => {
      let g = emptyGame((d) => {
        d.players[0].isBot = false;
        put(d, 0, 'Sauron, the Dark Lord');
        amass(d, 0, 'Orc', 2);
        byName(d, 0, 'Orc Army')!.sick = false;
        put(d, 0, 'Island', 'hand', 2);
        top(d, 0, Array.from({ length: 6 }, () => 'Swamp'));
      });
      g = run(g, pass, { type: 'declareAttack', card: byName(g, 0, 'Orc Army')!.id, defender: 1 }, pass);
      g = settle(g, (x) => asked(x)?.then === '@ringBearer');
      g = run(g, pick(byName(g, 0, 'Sauron, the Dark Lord')!.id));
      g = settle(g, (x) => asked(x)?.kind === 'ask');
      expect(asked(g)!.text).toMatch(/discard your hand and draw four cards/i);
      return settle(run(g, { type: 'answer', yes }), (x) => x.step === 'main2');
    };
    const yes = play(true);
    expect(timesTempted(yes, 0)).toBe(1);
    expect(isRingBearer(yes, byName(yes, 0, 'Sauron, the Dark Lord')!)).toBe(true);
    expect(yes.players[0].graveyard.map((c) => c.name)).toEqual(['Island', 'Island']);
    expect(yes.players[0].hand.map((c) => c.name)).toEqual(['Swamp', 'Swamp', 'Swamp', 'Swamp']);
    const no = play(false);
    expect(no.players[0].hand.map((c) => c.name)).toEqual(['Island', 'Island']);
  });

  it('a creature that is not an Army dealing combat damage does nothing', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Sauron, the Dark Lord');
      put(d, 0, 'Elite Vanguard');
    });
    g = until(run(g, pass, { type: 'declareAttack', card: byName(g, 0, 'Elite Vanguard')!.id, defender: 1 }, pass), (x) => x.step === 'main2');
    expect(timesTempted(g, 0)).toBe(0);
  });
});

describe('Ygra, Eater of All', () => {
  it('other creatures, every player\'s, are Food artifacts with "{2}, {T}, Sacrifice this permanent: You gain 3 life."; Ygra is not', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Ygra, Eater of All');
      put(d, 0, 'Elite Vanguard');
      put(d, 1, 'Serra Angel');
      put(d, 0, 'Plains', 'battlefield', 2);
    });
    const ygra = byName(g, 0, 'Ygra, Eater of All')!;
    const vanguard = byName(g, 0, 'Elite Vanguard')!;
    const angel = byName(g, 1, 'Serra Angel')!;
    for (const c of [vanguard, angel]) {
      expect(hasType(g, c, 'Artifact')).toBe(true);
      expect(subtypesOf(g, c)).toContain('Food');
      expect(hasType(g, c, 'Creature')).toBe(true);
    }
    expect(hasType(g, ygra, 'Food')).toBe(false);
    expect(activatedAbilities(g, ygra)).toEqual([]);
    expect(activatedAbilities(g, vanguard).map((a) => a.text)).toEqual(['{2}, {T}, Sacrifice this permanent: You gain 3 life.']);
    // Activating it: the Vanguard is sacrificed, its controller gains 3 life, and a Food went to a graveyard: two counters on Ygra.
    g = settle(run(g, { type: 'activate', card: vanguard.id }));
    expect(byName(g, 0, 'Elite Vanguard')).toBeUndefined();
    expect(g.players[0].life).toBe(43);
    expect(counterCount(byName(g, 0, 'Ygra, Eater of All')!)).toBe(2);
  });

  it('counts a creature dying as a Food put into a graveyard, and stops making Foods when it leaves', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Ygra, Eater of All');
      put(d, 1, 'Elite Vanguard');
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Mountain');
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Lightning Bolt', 'hand')!.id, targets: [card(byName(g, 1, 'Elite Vanguard')!)] }));
    expect(counterCount(byName(g, 0, 'Ygra, Eater of All')!)).toBe(2);
    g = produce(g, (d) => {
      put(d, 1, 'Serra Angel');
      const y = byName(d, 0, 'Ygra, Eater of All')!;
      y.zone = 'graveyard';
      d.players[0].battlefield = d.players[0].battlefield.filter((c) => c.id !== y.id);
    });
    expect(hasType(g, byName(g, 1, 'Serra Angel')!, 'Food')).toBe(false);
  });
});

describe('Ragost, Deft Gastronaut', () => {
  it('your artifacts are Foods with the Food ability; sacrifice a Food: 3 damage to each opponent', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Ragost, Deft Gastronaut');
      put(d, 0, 'Sol Ring');
      put(d, 1, 'Arcane Signet');
      put(d, 0, 'Plains', 'battlefield', 1);
    });
    const ring = byName(g, 0, 'Sol Ring')!;
    expect(subtypesOf(g, ring)).toEqual(['Food']);
    expect(activatedAbilities(g, ring).map((a) => a.text)).toEqual(['{2}, {T}, Sacrifice this artifact: You gain 3 life.']);
    // Only its controller's artifacts.
    expect(hasType(g, byName(g, 1, 'Arcane Signet')!, 'Food')).toBe(false);
    const ragost = byName(g, 0, 'Ragost, Deft Gastronaut')!;
    g = settle(run(g, { type: 'activate', card: ragost.id, sacrifice: [ring.id] }));
    expect(byName(g, 0, 'Sol Ring', 'graveyard')).toBeDefined();
    expect(g.players.map((p) => p.life)).toEqual([40, 37, 37, 37]);
    expect(byName(g, 0, 'Ragost, Deft Gastronaut')!.tapped).toBe(true);
  });

  it('"At the beginning of each end step, if you gained life this turn, untap Ragost."', () => {
    const endStep = (gained: number) => {
      let g = emptyGame((d) => {
        put(d, 0, 'Ragost, Deft Gastronaut').tapped = true;
        d.players[0].lifeGained = gained;
        turnOf(d, 1);
      });
      // On through this turn's end step, which nobody stops in: the next turn is another player's, so Ragost doesn't untap in it.
      const turn = g.turn;
      return until(g, (x) => x.turn !== turn);
    };
    expect(byName(endStep(3), 0, 'Ragost, Deft Gastronaut')!.tapped).toBe(false);
    expect(byName(endStep(0), 0, 'Ragost, Deft Gastronaut')!.tapped).toBe(true);
  });
});

describe('Valgavoth, Harrower of Souls', () => {
  it('"Whenever an opponent loses life for the first time during each of their turns": once, and only on their turn', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Valgavoth, Harrower of Souls');
      top(d, 0, ['Island', 'Island', 'Island']);
      turnOf(d, 1);
    });
    g = settle(produce(g, (d) => void loseLife(d, 1, 2)));
    expect(counterCount(byName(g, 0, 'Valgavoth, Harrower of Souls')!)).toBe(1);
    expect(g.players[0].hand.length).toBe(1);
    // The second loss that turn, and another opponent losing life on that turn, don't trigger it.
    g = settle(produce(g, (d) => {
      loseLife(d, 1, 1);
      loseLife(d, 2, 1);
    }));
    expect(counterCount(byName(g, 0, 'Valgavoth, Harrower of Souls')!)).toBe(1);
    expect(g.players[0].hand.length).toBe(1);
  });

  it('several losses at once, like combat damage from two creatures, are one first time', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Valgavoth, Harrower of Souls');
      turnOf(d, 1);
    });
    g = settle(produce(g, (d) => simultaneously(d, () => {
      loseLife(d, 1, 1);
      loseLife(d, 1, 1);
    })));
    expect(counterCount(byName(g, 0, 'Valgavoth, Harrower of Souls')!)).toBe(1);
  });
});

describe('Miirym, Sentinel Wyrm', () => {
  it('copies another nontoken Dragon entering, except the token isn\'t legendary', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Miirym, Sentinel Wyrm');
      put(d, 0, 'Kokusho, the Evening Star', 'hand');
    });
    g = settle(produce(g, (d) => void enterBattlefield(d, byName(d, 0, 'Kokusho, the Evening Star', 'hand')!)));
    const both = g.players[0].battlefield.filter((c) => c.name === 'Kokusho, the Evening Star');
    expect(both).toHaveLength(2);
    const token = both.find((c) => c.isToken)!;
    expect(hasType(g, token, 'Legendary')).toBe(false);
    expect(hasType(g, both.find((c) => !c.isToken)!, 'Legendary')).toBe(true);
    // The token Dragon entering didn't trigger it again, and a second Miirym... is legendary: no copies of Miirym itself.
    expect(g.players[0].battlefield.filter((c) => c.isToken)).toHaveLength(1);
  });

  it("doesn't copy a creature that isn't a Dragon, or an opponent's Dragon", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Miirym, Sentinel Wyrm');
      put(d, 0, 'Elite Vanguard', 'hand');
      put(d, 1, 'Shivan Dragon', 'hand');
    });
    g = settle(produce(g, (d) => {
      enterBattlefield(d, byName(d, 0, 'Elite Vanguard', 'hand')!);
      enterBattlefield(d, byName(d, 1, 'Shivan Dragon', 'hand')!);
    }));
    expect(g.players.flatMap((p) => p.battlefield).filter((c) => c.isToken)).toEqual([]);
  });
});

describe('Voja, Jaws of the Conclave', () => {
  it('attacking: X +1/+1 counters on each creature you control, X the Elves you control; a card for each Wolf', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Voja, Jaws of the Conclave');
      put(d, 0, 'Llanowar Elves');
      put(d, 0, 'Elvish Mystic');
      put(d, 1, 'Elite Vanguard');
      top(d, 0, ['Island', 'Island']);
    });
    g = settle(run(g, pass, { type: 'declareAttack', card: byName(g, 0, 'Voja, Jaws of the Conclave')!.id, defender: 1 }, pass), (x) => x.decision?.type === 'blockers');
    for (const n of ['Voja, Jaws of the Conclave', 'Llanowar Elves', 'Elvish Mystic']) expect(counterCount(byName(g, 0, n)!), n).toBe(2);
    expect(counterCount(byName(g, 1, 'Elite Vanguard')!)).toBe(0);
    expect(g.players[0].hand.length).toBe(1);
  });
});

describe('Ghyrson Starn, Kelermorph', () => {
  const ping = (amount: number, from: (d: Game) => Card, to: (d: Game) => TargetRef) =>
    settle(
      produce(
        emptyGame((d) => {
          put(d, 0, 'Ghyrson Starn, Kelermorph');
          put(d, 0, 'Elite Vanguard');
          put(d, 1, 'Elite Vanguard');
          put(d, 1, 'Serra Angel');
        }),
        (d) => void dealDamage(d, from(d), to(d), amount),
      ),
    );
  const mine = (d: Game) => byName(d, 0, 'Elite Vanguard')!;

  it('another source you control dealing exactly 1 damage: Ghyrson deals 2 more to that player or permanent', () => {
    expect(ping(1, mine, () => player(1)).players[1].life).toBe(37);
    const g = ping(1, mine, (d) => card(byName(d, 1, 'Serra Angel')!));
    expect(byName(g, 1, 'Serra Angel')!.damage).toBe(3);
  });

  it('not for 2 damage, nor for its own damage or an opponent\'s source', () => {
    expect(ping(2, mine, () => player(1)).players[1].life).toBe(38);
    expect(ping(1, (d) => byName(d, 0, 'Ghyrson Starn, Kelermorph')!, () => player(1)).players[1].life).toBe(39);
    expect(ping(1, (d) => byName(d, 1, 'Elite Vanguard')!, () => player(2)).players[2].life).toBe(39);
  });
});

describe('Animar, Soul of Elements', () => {
  it('protection from white and from black (702.16g): not a target of white or black spells; damage from them is prevented', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Animar, Soul of Elements');
      for (const n of ['Swords to Plowshares', 'Doom Blade', 'Lightning Bolt']) put(d, 1, n, 'hand');
    });
    const animar = byName(g, 0, 'Animar, Soul of Elements')!;
    expect(has(g, animar, 'protection from white')).toBe(true);
    expect(has(g, animar, 'protection from black')).toBe(true);
    expect(has(g, animar, 'protection from red')).toBe(false);
    const target = (name: string) => {
      const spell = byName(g, 1, name, 'hand')!;
      return legalTargets(g, 1, scriptFor(spell).targets![0], spell).some((t) => t.kind === 'card' && t.id === animar.id);
    };
    expect(target('Swords to Plowshares')).toBe(false);
    expect(target('Doom Blade')).toBe(false);
    expect(target('Lightning Bolt')).toBe(true);
  });

  it('a +1/+1 counter for each creature spell you cast, and creature spells cost {1} less for each counter', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Animar, Soul of Elements');
      put(d, 0, 'Elite Vanguard', 'hand');
      put(d, 0, 'Serra Angel', 'hand');
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Plains', 'battlefield', 5);
    });
    expect(castCost(g, byName(g, 0, 'Serra Angel', 'hand')!)).toMatchObject({ generic: 3 });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Elite Vanguard', 'hand')!.id }));
    expect(counterCount(byName(g, 0, 'Animar, Soul of Elements')!)).toBe(1);
    expect(castCost(g, byName(g, 0, 'Serra Angel', 'hand')!)).toMatchObject({ generic: 2 });
    // Not for other spells, and the reduction is generic mana only.
    g = produce(g, (d) => void addCounters(d, byName(d, 0, 'Animar, Soul of Elements')!, 4));
    expect(castCost(g, byName(g, 0, 'Serra Angel', 'hand')!)).toMatchObject({ generic: 0, pips: ['W', 'W'] });
    expect(castCost(g, byName(g, 0, 'Lightning Bolt', 'hand')!)).toMatchObject({ generic: 0, pips: ['R'] });
  });
});
