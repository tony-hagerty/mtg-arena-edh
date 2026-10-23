// EDHREC's most-played cards and commanders in the zones group: playing from the top of the
// library, from graveyards and from exile, extra land plays, dredge, mayhem, a Saga back face,
// additional upkeep steps. Each test is a clause that could go wrong.
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { addCounters, applyAction, applyBotAction, botAction, canBlock, canCast, canPlayLand, castCost, counterCount, discard, has, isHidden, makeCard, stats, viewFor } from '../src/engine';
import type { Action, Game, PlayerId, TargetRef } from '../src/engine';
import { problemsOf } from '../src/cards/support';
import { scriptCards } from '../src/cards/oracle';
import { byName, emptyGame, put, run } from './helpers';
import './fixtures';

// The fixtures aren't in the card pool, so the parser reads these as it would a fetched card's.
scriptCards(["Glarb, Calamity's Augur", 'The Necrobloom']);

const pass = { type: 'pass' } as const;
const player = (id: PlayerId): TargetRef => ({ kind: 'player', id });
const card = (c: { id: string }): TargetRef => ({ kind: 'card', id: c.id });

/** Passes priority (bots answering anything asked) until the stack is empty and nothing is being decided; `human` answers player 0's decisions. */
function settle(g: Game, human?: (g: Game) => Action | null): Game {
  for (let i = 0; i < 160 && (g.decision || g.stack.length || g.triggers.length); i++) {
    const mine = human && g.priority === 0 && g.decision ? human(g) : null;
    g = mine ? run(g, mine) : g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  }
  return g;
}
/** Passes, bots acting as they like, until `stop` holds. */
function until(g: Game, stop: (g: Game) => boolean): Game {
  for (let i = 0; i < 600 && !stop(g); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  return g;
}
/** Replaces a player's library with these cards, the first on top. */
function top(g: Game, pid: PlayerId, names: string[]) {
  g.players[pid].library = names.map((n) => makeCard(g, n, pid, 'library'));
}
const plenty = (name = 'Plains') => Array.from({ length: 12 }, () => name);
const human = (d: Game) => {
  d.players[0].isBot = false;
};
/** The choice waiting now, if any. */
const asked = (g: Game) => (g.decision && 'choice' in g.decision ? (g.decision.choice as { kind: string; text?: string; cards?: string[]; card?: string; then?: string }) : null);
/** Player 0 attacks player 1 with `name` and nobody blocks: the game after combat damage, stopped before the trigger resolves. */
function attackWith(g: Game, name: string): Game {
  g = until(g, (x) => x.step === 'attackers' && x.decision?.type === 'attackers' && x.priority === 0);
  g = run(g, { type: 'declareAttack', card: byName(g, 0, name)!.id, defender: 1 }, pass);
  return until(g, (x) => x.step === 'damage' || x.step === 'endCombat' || x.step === 'main2');
}

describe('the zones group is playable', () => {
  it.each([
    "Glarb, Calamity's Augur",
    'Muldrotha, the Gravetide',
    'Kotis, the Fangkeeper',
    'Maralen, Fae Ascendant',
    'Norman Osborn // Green Goblin',
    'The Necrobloom',
    'Flubs, the Fool',
    'Terra, Magical Adept // Esper Terra',
    'Terra, Herald of Hope',
    'Obeka, Splitter of Seconds',
  ])('%s has no problems', (name) => {
    expect(problemsOf(name)).toEqual([]);
  });
});

describe("Glarb, Calamity's Augur", () => {
  it('shows its controller the top card of their library, and nobody else (401.2)', () => {
    const g = emptyGame((d) => {
      put(d, 0, "Glarb, Calamity's Augur");
      top(d, 0, ['Serra Angel', ...plenty()]);
      top(d, 1, ['Serra Angel', ...plenty()]);
    });
    expect(isHidden(viewFor(g, 0).players[0].library[0])).toBe(false);
    expect(isHidden(viewFor(g, 0).players[0].library[1])).toBe(true);
    expect(isHidden(viewFor(g, 1).players[0].library[0])).toBe(true);
    // Only their own library.
    expect(isHidden(viewFor(g, 0).players[1].library[0])).toBe(true);
  });

  it('plays a land from the top of the library as the land for the turn (305.2a)', () => {
    let g = emptyGame((d) => {
      put(d, 0, "Glarb, Calamity's Augur");
      put(d, 0, 'Plains', 'hand');
      top(d, 0, ['Forest', 'Island', ...plenty()]);
    });
    const forest = g.players[0].library[0];
    expect(canPlayLand(g, 0, forest)).toBe(true);
    g = run(g, { type: 'playLand', card: forest.id });
    expect(byName(g, 0, 'Forest')).toBeDefined();
    expect(g.log.some((l) => l.text.includes('plays Forest from the top of'))).toBe(true);
    // The land for the turn is used: neither the next top card nor the hand's Plains can be played.
    expect(canPlayLand(g, 0, g.players[0].library[0])).toBe(false);
    expect(canPlayLand(g, 0, byName(g, 0, 'Plains', 'hand')!)).toBe(false);
  });

  it('casts a spell with mana value 4 or greater from the top, paying its cost, not one below (601.3)', () => {
    let g = emptyGame((d) => {
      put(d, 0, "Glarb, Calamity's Augur");
      put(d, 0, 'Plains', 'battlefield', 5);
      top(d, 0, ['Serra Angel', 'Elite Vanguard', ...plenty()]);
    });
    const angel = g.players[0].library[0];
    expect(canCast(g, 0, angel)).toBe(true);
    expect(castCost(g, angel, {}, 0).pips).toEqual(['W', 'W']);
    g = settle(run(g, { type: 'cast', card: angel.id }));
    expect(byName(g, 0, 'Serra Angel')).toBeDefined();
    expect(g.log.find((l) => /casts Serra Angel/.test(l.text))?.text).toMatch(/casts Serra Angel \(from the top of their library, with Glarb, Calamity's Augur\)/);
    // Elite Vanguard (mana value 1) is on top now and can't be cast.
    expect(canCast(g, 0, g.players[0].library[0])).toBe(false);
    // A land can't be cast at all (305.9), and an opponent gets nothing from Glarb.
    expect(canCast(g, 1, g.players[0].library[0])).toBe(false);
  });

  it('casts an {X} spell from the top only with an X that makes its mana value 4 or more (Glarb rulings, 202.3e)', () => {
    const g = emptyGame((d) => {
      put(d, 0, "Glarb, Calamity's Augur");
      put(d, 0, 'Mountain', 'battlefield', 6);
      top(d, 0, ['Blaze', ...plenty()]);
    });
    const blaze = g.players[0].library[0];
    expect(canCast(g, 0, blaze)).toBe(true);
    expect(canCast(g, 0, blaze, { x: 2, targets: undefined } as never)).toBe(false);
    expect(canCast(g, 0, blaze, { x: 3 })).toBe(true);
    const after = settle(run(g, { type: 'cast', card: blaze.id, x: 3, targets: [player(1)] }));
    expect(after.players[1].life).toBe(37);
  });
});

describe('Muldrotha, the Gravetide', () => {
  const board = (setup: (d: Game) => void = () => {}) =>
    emptyGame((d) => {
      put(d, 0, 'Muldrotha, the Gravetide');
      put(d, 0, 'Plains', 'battlefield', 8);
      setup(d);
    });

  it('casts one permanent spell of each permanent type from the graveyard each turn', () => {
    let g = board((d) => {
      put(d, 0, 'Serra Angel', 'graveyard');
      put(d, 0, 'Elite Vanguard', 'graveyard');
      put(d, 0, 'Pacifism', 'graveyard');
      put(d, 0, 'Shock', 'graveyard');
    });
    const angel = byName(g, 0, 'Serra Angel', 'graveyard')!;
    expect(canCast(g, 0, angel)).toBe(true);
    // An instant isn't a permanent spell.
    expect(canCast(g, 0, byName(g, 0, 'Shock', 'graveyard')!)).toBe(false);
    g = settle(run(g, { type: 'cast', card: angel.id }));
    expect(byName(g, 0, 'Serra Angel')).toBeDefined();
    expect(g.log.some((l) => /casts Serra Angel \(from their graveyard, with Muldrotha, the Gravetide\)/.test(l.text))).toBe(true);
    // The creature for this turn is spent; an enchantment is still allowed.
    expect(canCast(g, 0, byName(g, 0, 'Elite Vanguard', 'graveyard')!)).toBe(false);
    const aura = byName(g, 0, 'Pacifism', 'graveyard')!;
    expect(canCast(g, 0, aura)).toBe(true);
    g = settle(run(g, { type: 'cast', card: aura.id, targets: [card(byName(g, 0, 'Serra Angel')!)] }));
    expect(byName(g, 0, 'Pacifism')).toBeDefined();
  });

  it('plays a land from the graveyard as the land for the turn, and only on its controller\'s turn (305.2a, 305.3)', () => {
    let g = board((d) => {
      put(d, 0, 'Forest', 'graveyard');
      put(d, 0, 'Island', 'graveyard');
    });
    const forest = byName(g, 0, 'Forest', 'graveyard')!;
    expect(canPlayLand(g, 0, forest)).toBe(true);
    g = run(g, { type: 'playLand', card: forest.id });
    expect(byName(g, 0, 'Forest')).toBeDefined();
    expect(canPlayLand(g, 0, byName(g, 0, 'Island', 'graveyard')!)).toBe(false);
    // Next turn (an opponent's), nothing from Muldrotha.
    g = until(g, (x) => x.active === 1 && x.step === 'main1');
    expect(canCast(g, 1, byName(g, 0, 'Island', 'graveyard')!)).toBe(false);
  });

  it('a card with two permanent types is cast as the type chosen, and the other stays free (Muldrotha rulings)', () => {
    let g = board((d) => {
      put(d, 0, 'Solemn Simulacrum', 'graveyard');
      put(d, 0, 'Elite Vanguard', 'graveyard');
      put(d, 0, 'Sol Ring', 'graveyard');
    });
    const golem = byName(g, 0, 'Solemn Simulacrum', 'graveyard')!;
    const muldrotha = byName(g, 0, 'Muldrotha, the Gravetide')!;
    // With two types free, the type must be named as it is cast.
    expect(canCast(g, 0, golem, { permit: muldrotha.id })).toBe(false);
    expect(canCast(g, 0, golem, { permit: muldrotha.id, slot: 'Artifact' })).toBe(true);
    expect(canCast(g, 0, golem, { permit: muldrotha.id, slot: 'Land' })).toBe(false);
    g = settle(run(g, { type: 'cast', card: golem.id, permit: muldrotha.id, slot: 'Artifact' }));
    expect(byName(g, 0, 'Solemn Simulacrum')).toBeDefined();
    expect(g.log.some((l) => l.text.includes('as an artifact'))).toBe(true);
    // The artifact is spent, the creature still free.
    expect(canCast(g, 0, byName(g, 0, 'Sol Ring', 'graveyard')!)).toBe(false);
    expect(canCast(g, 0, byName(g, 0, 'Elite Vanguard', 'graveyard')!)).toBe(true);
  });

  it('uses the one type left on its own when only one fits', () => {
    let g = board((d) => {
      put(d, 0, 'Solemn Simulacrum', 'graveyard');
      put(d, 0, 'Sol Ring', 'graveyard');
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Sol Ring', 'graveyard')!.id }));
    const golem = byName(g, 0, 'Solemn Simulacrum', 'graveyard')!;
    // Only the creature type is left: it needn't be named.
    expect(canCast(g, 0, golem)).toBe(true);
    g = settle(run(g, { type: 'cast', card: golem.id }));
    expect(byName(g, 0, 'Solemn Simulacrum')).toBeDefined();
  });
});

describe('Kotis, the Fangkeeper', () => {
  it('exiles as many cards as the damage dealt and lets its controller cast any number of them free, one at a time (608.2g)', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Kotis, the Fangkeeper');
      top(d, 1, ['Elite Vanguard', 'Shock', 'Serra Angel', ...plenty()]);
    });
    g = attackWith(g, 'Kotis, the Fangkeeper');
    expect(g.players[1].life).toBe(38);
    g = until(g, (x) => x.decision?.type === 'cast' || !x.stack.length);
    // Two cards exiled; Serra Angel (mana value 5) can't be cast with X = 2.
    expect(g.players[1].exile.map((c) => c.name).sort()).toEqual(['Elite Vanguard', 'Shock']);
    expect(asked(g)?.kind).toBe('cast');
    expect(asked(g)!.cards!.length).toBe(2);
    const vanguard = byName(g, 1, 'Elite Vanguard', 'exile')!;
    expect(castCost(g, vanguard, {}, 0).pips).toEqual([]);
    // A creature cast while the ability resolves, free, on the stack above it.
    g = run(g, { type: 'cast', card: vanguard.id });
    expect(g.stack[g.stack.length - 1].card.name).toBe('Elite Vanguard');
    // The rest is offered again; declining leaves it in exile.
    expect(asked(g)?.kind).toBe('cast');
    expect(asked(g)!.cards).toEqual([byName(g, 1, 'Shock', 'exile')!.id]);
    g = settle(run(g, { type: 'answer', yes: false }));
    expect(byName(g, 0, 'Elite Vanguard')).toBeDefined();
    expect(byName(g, 1, 'Shock', 'exile')).toBeDefined();
    expect(canCast(g, 0, byName(g, 1, 'Shock', 'exile')!)).toBe(false);
  });

  it("casts an {X} spell from among them with X as 0 (Kotis's rulings)", () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Kotis, the Fangkeeper');
      top(d, 1, ['Blaze', 'Plains', ...plenty()]);
    });
    g = attackWith(g, 'Kotis, the Fangkeeper');
    g = until(g, (x) => x.decision?.type === 'cast' || !x.stack.length);
    const blaze = byName(g, 1, 'Blaze', 'exile')!;
    expect(canCast(g, 0, blaze, { x: 1 })).toBe(false);
    expect(canCast(g, 0, blaze, { x: 0 })).toBe(true);
  });
});

describe('Maralen, Fae Ascendant', () => {
  const setup = (d: Game) => {
    human(d);
    put(d, 0, 'Plains', 'battlefield', 3);
    put(d, 0, 'Swamp');
    put(d, 0, 'Forest');
    put(d, 0, 'Island');
    put(d, 0, 'Maralen, Fae Ascendant', 'hand');
    top(d, 1, ['Elite Vanguard', 'Serra Angel', 'Shock', ...plenty()]);
  };

  it('exiles the top two cards of a target opponent\'s library as it enters, and once a turn casts one free (607.2a)', () => {
    let g = emptyGame(setup);
    g = run(g, { type: 'cast', card: byName(g, 0, 'Maralen, Fae Ascendant', 'hand')!.id });
    g = until(g, (x) => x.decision?.type === 'targets' && x.priority === 0);
    g = settle(run(g, { type: 'chooseTargets', targets: [player(1)] }));
    expect(g.players[1].exile.map((c) => c.name).sort()).toEqual(['Elite Vanguard', 'Serra Angel']);
    // One Elf or Faerie: Elite Vanguard (mana value 1) may be cast free, Serra Angel (5) not.
    const vanguard = byName(g, 1, 'Elite Vanguard', 'exile')!;
    const angel = byName(g, 1, 'Serra Angel', 'exile')!;
    expect(canCast(g, 0, vanguard)).toBe(true);
    expect(canCast(g, 0, angel)).toBe(false);
    expect(castCost(g, vanguard, {}, 0).pips).toEqual([]);
    g = settle(run(g, { type: 'cast', card: vanguard.id }));
    expect(byName(g, 0, 'Elite Vanguard')).toBeDefined();
    expect(g.log.find((l) => /casts Elite Vanguard/.test(l.text))?.text).toMatch(/casts Elite Vanguard \(from exile, with Maralen, Fae Ascendant, without paying its mana cost\)/);
  });

  it('only once each turn, only this turn\'s cards, and only with enough Elves and Faeries', () => {
    let g = emptyGame((d) => {
      setup(d);
      put(d, 0, 'Deathrite Shaman'); // an Elf
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Maralen, Fae Ascendant', 'hand')!.id });
    g = until(g, (x) => x.decision?.type === 'targets' && x.priority === 0);
    g = settle(run(g, { type: 'chooseTargets', targets: [player(1)] }));
    const angel = byName(g, 1, 'Serra Angel', 'exile')!;
    const vanguard = byName(g, 1, 'Elite Vanguard', 'exile')!;
    // Two Elves and Faeries: still not five.
    expect(canCast(g, 0, angel)).toBe(false);
    g = settle(run(g, { type: 'cast', card: vanguard.id }));
    // Used this turn: another Elf entering exiles two more, but none can be cast until next turn.
    g = until(g, (x) => x.active === 0 && x.step === 'main1' && x.turn > 1);
    const exiled = g.players[1].exile.filter((c) => !/Serra Angel/.test(c.name));
    expect(exiled.every((c) => !canCast(g, 0, c))).toBe(true);
  });
});

describe('Norman Osborn // Green Goblin', () => {
  it("can't be blocked, connives on combat damage, and transforms as a sorcery (701.27f)", () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Norman Osborn');
      put(d, 1, 'Serra Angel');
      put(d, 0, 'Plains', 'hand');
      put(d, 0, 'Shock', 'hand');
      put(d, 0, 'Island', 'battlefield', 2);
      put(d, 0, 'Swamp');
      put(d, 0, 'Mountain');
    });
    const norman = byName(g, 0, 'Norman Osborn')!;
    expect(canBlock(g, byName(g, 1, 'Serra Angel')!, norman)).toBe(false);
    g = attackWith(g, 'Norman Osborn');
    g = until(g, (x) => x.decision?.type === 'chooseCards' && x.priority === 0);
    // Connive: drew a card, now discards one; a nonland gives a +1/+1 counter.
    expect(g.players[0].hand).toHaveLength(3);
    g = settle(run(g, { type: 'chooseCards', cards: [byName(g, 0, 'Shock', 'hand')!.id] }));
    expect(counterCount(byName(g, 0, 'Norman Osborn')!)).toBe(1);
    g = until(g, (x) => x.step === 'main2' && x.priority === 0 && !x.decision);
    g = settle(run(g, { type: 'activate', card: norman.id }));
    expect(byName(g, 0, 'Norman Osborn')!.face).toBe(1);
    expect(has(g, byName(g, 0, 'Norman Osborn')!, 'flying')).toBe(true);
    expect(g.log.some((l) => l.text === 'Norman Osborn transforms into Green Goblin.')).toBe(true);
  });

  it('gives nonland cards in the graveyard mayhem the turn they were discarded, costing {2} less (702.187b)', () => {
    let g = emptyGame((d) => {
      human(d);
      const gg = put(d, 0, 'Norman Osborn');
      gg.face = 1;
      put(d, 0, 'Serra Angel', 'hand');
      put(d, 0, 'Forest', 'hand');
      put(d, 0, 'Plains', 'battlefield', 3);
      put(d, 0, 'Elite Vanguard', 'graveyard');
    });
    expect(has(g, byName(g, 0, 'Norman Osborn')!, 'menace')).toBe(true);
    // A card that got into the graveyard another way has no mayhem.
    expect(canCast(g, 0, byName(g, 0, 'Elite Vanguard', 'graveyard')!)).toBe(false);
    // The Angel is discarded (the engine's own discard, as an effect would).
    g = produce(g, (d) => discard(d, d.players[0].hand.find((x) => x.name === 'Serra Angel')!));
    const dead = byName(g, 0, 'Serra Angel', 'graveyard')!;
    expect(dead.discarded).toBe(g.turn);
    expect(canCast(g, 0, dead)).toBe(true);
    // Its mayhem cost is its mana cost, {3}{W}{W}, less {2}: {1}{W}{W}, which three Plains pay.
    const cost = castCost(g, dead, {}, 0);
    expect(cost.generic).toBe(1);
    expect(cost.pips).toEqual(['W', 'W']);
    g = settle(run(g, { type: 'cast', card: dead.id }));
    expect(byName(g, 0, 'Serra Angel')).toBeDefined();
    expect(g.log.find((l) => /casts Serra Angel/.test(l.text))?.text).toMatch(/casts Serra Angel \(from their graveyard, with Green Goblin\)/);
    // A land discarded has no mayhem (702.187c would need "mayhem" without a cost; Green Goblin gives it to nonland cards).
    g = produce(g, (d) => discard(d, d.players[0].hand.find((x) => x.name === 'Forest')!));
    expect(canCast(g, 0, byName(g, 0, 'Forest', 'graveyard')!)).toBe(false);
  });
});

describe('The Necrobloom', () => {
  it('makes a Plant on landfall, or a Zombie with seven or more lands with different names', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'The Necrobloom');
      put(d, 0, 'Plains', 'hand');
      put(d, 0, 'Forest', 'hand');
      for (const n of ['Island', 'Swamp', 'Mountain', 'Plains', 'Plains', 'Plains']) put(d, 0, n);
    });
    g = settle(run(g, { type: 'playLand', card: byName(g, 0, 'Plains', 'hand')!.id }));
    // Five names: a 0/1 Plant.
    const plant = g.players[0].battlefield.find((c) => c.isToken)!;
    expect(stats(g, plant)).toMatchObject({ power: 0, toughness: 1 });
    g = until(g, (x) => x.active === 0 && x.turn > 1 && x.step === 'main1' && !x.decision);
    g = produce(g, (d) => {
      d.players[0].battlefield.push(makeCard(d, 'Command Tower', 0, 'battlefield'), makeCard(d, 'Exotic Orchard', 0, 'battlefield'));
    });
    g = settle(run(g, { type: 'playLand', card: byName(g, 0, 'Forest', 'hand')!.id }));
    // Seven names (Island, Swamp, Mountain, Plains, Command Tower, Exotic Orchard, Forest): a 2/2 Zombie instead.
    const zombie = g.players[0].battlefield.filter((c) => c.isToken).find((c) => c.name !== plant.name)!;
    expect(stats(g, zombie)).toMatchObject({ power: 2, toughness: 2 });
    expect(g.players[0].battlefield.filter((c) => c.isToken)).toHaveLength(2);
  });

  it('gives land cards in its controller\'s graveyard dredge 2: a draw may be replaced (702.52a), with at least 2 cards in the library (702.52b)', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'The Necrobloom');
      put(d, 0, 'Forest', 'graveyard');
      put(d, 0, 'Serra Angel', 'graveyard');
      top(d, 0, ['Plains', 'Island', 'Swamp', 'Mountain']);
    });
    // Player 0's draw step: asked whether to dredge.
    g = until(g, (x) => x.decision?.type === 'replacement' || (x.active === 0 && x.turn > 1 && x.step === 'main1'));
    expect(g.decision?.type).toBe('replacement');
    const ask = (g.decision as { ask: { options: { label: string }[] } }).ask;
    expect(ask.options.map((o) => o.label)).toContain('Dredge Forest');
    g = run(g, { type: 'replacement', option: ask.options.findIndex((o) => o.label === 'Dredge Forest') });
    g = until(g, (x) => x.active === 0 && x.turn > 1 && x.step === 'main1' && !x.decision);
    expect(byName(g, 0, 'Forest', 'hand')).toBeDefined();
    expect(g.players[0].graveyard.map((c) => c.name).sort()).toEqual(['Island', 'Plains', 'Serra Angel']);
    expect(g.players[0].library).toHaveLength(2);
    // A bot never dredges; with fewer than two cards in the library dredge can't be used at all.
    let h = emptyGame((d) => {
      put(d, 0, 'The Necrobloom');
      put(d, 0, 'Forest', 'graveyard');
      top(d, 0, ['Plains']);
      d.players[0].isBot = false;
    });
    h = until(h, (x) => x.decision?.type === 'replacement' || (x.active === 0 && x.turn > 1 && x.step === 'main1'));
    expect(h.decision?.type).not.toBe('replacement');
    expect(byName(h, 0, 'Plains', 'hand')).toBeDefined();
  });
});

describe('Flubs, the Fool', () => {
  it('allows a second land each turn (305.2) and draws with an empty hand or discards otherwise', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Flubs, the Fool');
      put(d, 0, 'Plains', 'hand');
      put(d, 0, 'Forest', 'hand');
      put(d, 0, 'Island', 'hand');
      top(d, 0, plenty('Swamp'));
    });
    g = run(g, { type: 'playLand', card: byName(g, 0, 'Plains', 'hand')!.id });
    // Two cards in hand: discard one.
    g = until(g, (x) => x.decision?.type === 'chooseCards');
    expect(asked(g)?.kind).toBe('pick');
    g = settle(run(g, { type: 'chooseCards', cards: [byName(g, 0, 'Island', 'hand')!.id] }));
    expect(g.players[0].hand.map((c) => c.name)).toEqual(['Forest']);
    // The additional land.
    const forest = byName(g, 0, 'Forest', 'hand')!;
    expect(canPlayLand(g, 0, forest)).toBe(true);
    g = settle(run(g, { type: 'playLand', card: forest.id }));
    // No cards in hand: draw instead.
    expect(g.players[0].hand).toHaveLength(1);
    expect(g.players[0].hand[0].name).toBe('Swamp');
    // Not a third.
    expect(canPlayLand(g, 0, g.players[0].hand[0])).toBe(false);
  });
});

describe('Terra, Magical Adept // Esper Terra', () => {
  it('mills five as it enters and puts up to one enchantment milled into the hand', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Terra, Magical Adept', 'hand');
      put(d, 0, 'Forest', 'battlefield', 2);
      put(d, 0, 'Mountain');
      top(d, 0, ['Plains', 'Pacifism', 'Serra Angel', 'Hardened Scales', 'Island', 'Swamp', 'Mountain']);
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Terra, Magical Adept', 'hand')!.id });
    g = until(g, (x) => x.decision?.type === 'chooseCards');
    expect(g.players[0].graveyard).toHaveLength(5);
    expect(asked(g)!.cards!.map((id) => g.players[0].graveyard.find((c) => c.id === id)!.name).sort()).toEqual(['Hardened Scales', 'Pacifism']);
    g = settle(run(g, { type: 'chooseCards', cards: [byName(g, 0, 'Hardened Scales', 'graveyard')!.id] }));
    expect(byName(g, 0, 'Hardened Scales', 'hand')).toBeDefined();
    expect(g.players[0].graveyard).toHaveLength(4);
  });

  it('returns transformed as a Saga with a lore counter, copies an enchantment, and comes back front face up on chapter IV (714, 712.14a)', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Terra, Magical Adept');
      put(d, 0, 'Hardened Scales');
      put(d, 0, 'Forest', 'battlefield', 5);
      put(d, 0, 'Mountain');
    });
    const terra = byName(g, 0, 'Terra, Magical Adept')!;
    g = run(g, { type: 'activate', card: terra.id });
    g = until(g, (x) => x.decision?.type === 'targets' && x.priority === 0);
    const esper = byName(g, 0, 'Terra, Magical Adept')!;
    expect(esper.face).toBe(1);
    expect(counterCount(esper, 'lore')).toBe(1);
    expect(stats(g, esper)).toMatchObject({ power: 6, toughness: 6 });
    // Chapter I targets a nonlegendary enchantment: a hasty token copy that goes at the next end step.
    g = settle(run(g, { type: 'chooseTargets', targets: [card(byName(g, 0, 'Hardened Scales')!)] }));
    const token = g.players[0].battlefield.find((c) => c.isToken)!;
    expect(token.name).toBe('Hardened Scales');
    expect(has(g, token, 'haste')).toBe(true);
    g = until(g, (x) => x.active === 1 && x.step === 'main1');
    expect(g.players[0].battlefield.some((c) => c.isToken)).toBe(false);
    // Each of player 0's precombat main phases adds a lore counter: chapters II, III, then IV.
    for (let chapter = 2; chapter <= 3; chapter++) {
      g = until(g, (x) => x.active === 0 && x.decision?.type === 'targets' && x.priority === 0);
      g = settle(run(g, { type: 'chooseTargets', targets: [card(byName(g, 0, 'Hardened Scales')!)] }));
      expect(counterCount(byName(g, 0, 'Terra, Magical Adept')!, 'lore')).toBe(chapter);
    }
    g = until(g, (x) => x.active === 0 && x.step === 'main1' && x.turn > g.turn && !x.decision && !x.stack.length);
    // Chapter IV: ten mana, then Terra is back front face up as a new object with no counters, not sacrificed (714.4).
    const back = byName(g, 0, 'Terra, Magical Adept')!;
    expect(back.face).toBe(0);
    expect(counterCount(back, 'lore')).toBe(0);
    expect(g.players[0].pool.map((m) => m.sym).join('')).toBe('WWUUBBRRGG');
  });

  it('puts up to three lore counters on a Saga token copy, so its chapters trigger (714.2b)', () => {
    let g = emptyGame((d) => {
      human(d);
      const esper = put(d, 0, 'Terra, Magical Adept');
      esper.face = 1;
      put(d, 0, 'History of Benalia');
      // Chapter I triggers as the lore counter is put on.
    });
    g = produce(g, (d) => addCounters(d, d.players[0].battlefield.find((c) => c.face === 1)!, 1, 'lore'));
    g = until(g, (x) => x.decision?.type === 'targets' && x.priority === 0);
    g = run(g, { type: 'chooseTargets', targets: [card(byName(g, 0, 'History of Benalia')!)] });
    g = until(g, (x) => x.decision?.type === 'number' && x.priority === 0);
    g = run(g, { type: 'chooseNumber', n: 2 });
    g = until(g, (x) => !x.stack.length && !x.decision && !x.triggers.length);
    const token = g.players[0].battlefield.find((c) => c.isToken && c.name === 'History of Benalia')!;
    // One as it entered plus two: chapters II and III resolved, which made two Knights; it is sacrificed for its last chapter (714.4).
    const knights = g.players[0].battlefield.filter((c) => c.isToken && c.name !== 'History of Benalia');
    expect(knights.length).toBe(2);
    expect(token).toBeUndefined();
  });
});

describe('Terra, Herald of Hope', () => {
  it('mills two and gains flying at the beginning of its combat; on combat damage, paying {2} returns a small creature tapped (603.12)', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Terra, Herald of Hope');
      put(d, 0, 'Plains', 'battlefield', 2);
      put(d, 0, 'Serra Angel', 'graveyard');
      put(d, 0, 'Elite Vanguard', 'graveyard');
      top(d, 0, plenty());
    });
    g = until(g, (x) => x.step === 'attackers' && x.decision?.type === 'attackers' && x.priority === 0);
    expect(g.players[0].graveyard).toHaveLength(4);
    expect(has(g, byName(g, 0, 'Terra, Herald of Hope')!, 'flying')).toBe(true);
    g = run(g, { type: 'declareAttack', card: byName(g, 0, 'Terra, Herald of Hope')!.id, defender: 1 }, pass);
    g = until(g, (x) => x.decision?.type === 'ask' && x.priority === 0);
    expect(g.players[1].life).toBe(37);
    g = run(g, { type: 'answer', yes: true });
    // The reflexive trigger targets: only a creature card with power 3 or less.
    g = until(g, (x) => x.decision?.type === 'targets' && x.priority === 0);
    const item = (g.decision as { item: { targets: unknown[] } }).item;
    expect(item).toBeDefined();
    g = settle(run(g, { type: 'chooseTargets', targets: [card(byName(g, 0, 'Elite Vanguard', 'graveyard')!)] }));
    const vanguard = byName(g, 0, 'Elite Vanguard')!;
    expect(vanguard.tapped).toBe(true);
    expect(g.players[0].battlefield.filter((c) => c.name === 'Plains' && c.tapped)).toHaveLength(2);
  });
});

describe('Obeka, Splitter of Seconds', () => {
  it('adds that many upkeep steps after the combat phase, in which upkeep triggers fire again (500.9)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Obeka, Splitter of Seconds');
      put(d, 0, 'Land Tax'); // "At the beginning of your upkeep, if an opponent controls more lands than you, ..."
      put(d, 1, 'Plains', 'battlefield', 3);
      top(d, 0, plenty());
    });
    g = attackWith(g, 'Obeka, Splitter of Seconds');
    expect(g.players[1].life).toBe(38);
    const hand = g.players[0].hand.length;
    g = until(g, (x) => x.turn > 1);
    const texts = g.log.map((l) => l.text);
    // Two additional upkeep steps after combat, before the second main phase, and in each Land Tax triggered and found lands.
    expect(texts.filter((t) => t === 'An additional upkeep step begins.')).toHaveLength(2);
    const first = texts.indexOf('An additional upkeep step begins.');
    expect(first).toBeGreaterThan(texts.findIndex((t) => /2 combat damage/.test(t)));
    expect(texts.filter((t) => /searches .* library for/.test(t)).length).toBe(2);
    expect(g.players[0].hand.length).toBeGreaterThanOrEqual(hand);
  });
});
