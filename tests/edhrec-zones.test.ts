// EDHREC's most-played cards and commanders in the zones group: playing from the top of the
// library, from graveyards and from exile, extra land plays, dredge, mayhem, a Saga back face,
// additional upkeep steps. Each test is a clause that could go wrong.
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { addCounters, applyAction, applyBotAction, botAction, canBlock, canCast, canPlayLand, castCost, colorsOf, counterCount, discard, enterBattlefield, enterTogether, explore, has, isHidden, isLand, makeCard, stats, viewFor } from '../src/engine';
import type { Action, Game, PlayerId, TargetRef } from '../src/engine';
import { problemsOf } from '../src/cards/support';
import { registerCards } from '../src/cards/db';
import { registerScripts } from '../src/engine/registry';
import { scriptCards } from '../src/cards/oracle';
import { byName, emptyGame, put, run } from './helpers';
import './fixtures';

// The fixtures aren't in the card pool, so the parser reads these as it would a fetched card's.
scriptCards(["Glarb, Calamity's Augur", 'The Necrobloom', 'The Wandering Minstrel']);

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
    'Hakbal of the Surging Soul',
    'The Wandering Minstrel',
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

  it("casts a graveyard card for its own alternative cost through Muldrotha (rulings), and names the permission a land is played by", () => {
    // A made-up permanent with its own alternative cost, read by the parser.
    registerCards({ 'Test Rollick': { name: 'Test Rollick', manaCost: '{3}{B}', cmc: 4, colors: ['B'], colorIdentity: ['B'], typeLine: 'Creature — Horror', oracleText: 'If you control a commander, you may cast this spell without paying its mana cost.', power: '3', toughness: '3', keywords: [], image: '', art: '' } });
    expect(scriptCards(['Test Rollick'])).toEqual([]);
    // A second permission to play lands from the graveyard, to choose between.
    registerCards({ 'Test Crucible': { name: 'Test Crucible', manaCost: '{3}', cmc: 3, colors: [], colorIdentity: [], typeLine: 'Artifact', oracleText: 'You may play lands from your graveyard.', keywords: [], image: '', art: '' } });
    registerScripts({ 'Test Crucible': { playPermission: (g, self, pid, c) => (pid === self.controller && c.zone === 'graveyard' && c.owner === pid && isLand(g, c) ? { land: true } : null) } });
    let g = board((d) => {
      d.players[0].battlefield.find((c) => c.name === 'Muldrotha, the Gravetide')!.isCommander = true;
      put(d, 0, 'Test Rollick', 'graveyard');
      put(d, 0, 'Test Crucible');
      put(d, 0, 'Forest', 'graveyard');
      put(d, 0, 'Island', 'graveyard');
    });
    const muldrotha = byName(g, 0, 'Muldrotha, the Gravetide')!;
    const rollick = byName(g, 0, 'Test Rollick', 'graveyard')!;
    // Its alternative cost is open through Muldrotha, paying nothing; the creature use is spent all the same.
    expect(canCast(g, 0, rollick, { permit: muldrotha.id, alt: 0 })).toBe(true);
    expect(castCost(g, rollick, { permit: muldrotha.id, alt: 0 }, 0)).toMatchObject({ generic: 0, pips: [] });
    expect(castCost(g, rollick, { permit: muldrotha.id }, 0)).toMatchObject({ generic: 3, pips: ['B'] });
    g = settle(run(g, { type: 'cast', card: rollick.id, permit: muldrotha.id, alt: 0 }));
    expect(byName(g, 0, 'Test Rollick')).toBeDefined();
    expect(g.players[0].battlefield.filter((c) => c.name === 'Plains' && c.tapped)).toHaveLength(0);
    expect(canCast(g, 0, produce(g, (d) => void put(d, 0, 'Elite Vanguard', 'graveyard')).players[0].graveyard.find((c) => c.name === 'Elite Vanguard')!)).toBe(false);
    // Two permissions allow the Forest: the player must name one (Muldrotha's rulings).
    const forest = byName(g, 0, 'Forest', 'graveyard')!;
    const crucible = byName(g, 0, 'Test Crucible')!;
    expect(canPlayLand(g, 0, forest)).toBe(true);
    expect(applyAction(g, { type: 'playLand', card: forest.id })).toBe(g);
    expect(applyAction(g, { type: 'playLand', card: forest.id, permit: null })).toBe(g); // no right of its own
    g = run(g, { type: 'playLand', card: forest.id, permit: crucible.id });
    expect(byName(g, 0, 'Forest')).toBeDefined();
    // Muldrotha's land use is still free, but the land for the turn is spent (305.2a).
    expect(Object.keys(g.permits ?? {}).some((k) => k.endsWith(':Land'))).toBe(false);
    expect(canPlayLand(g, 0, byName(g, 0, 'Island', 'graveyard')!)).toBe(false);
    // A bot names a way too.
    let h = board((d) => {
      put(d, 0, 'Test Crucible');
      put(d, 0, 'Forest', 'graveyard');
      d.players[0].hand = [];
    });
    const bot = botAction(h, 0);
    expect(bot).toMatchObject({ type: 'playLand', permit: byName(h, 0, 'Test Crucible')!.id });
    h = run(h, bot);
    expect(byName(h, 0, 'Forest')).toBeDefined();
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

describe('Hakbal of the Surging Soul', () => {
  // A Merfolk with no text, and a watcher: "whenever a creature you control explores".
  registerCards({
    'Test Merfolk': { name: 'Test Merfolk', manaCost: '{U}', cmc: 1, colors: ['U'], colorIdentity: ['U'], typeLine: 'Creature — Merfolk', oracleText: '', power: '1', toughness: '1', keywords: [], image: '', art: '' },
    'Test Explorer Watcher': { name: 'Test Explorer Watcher', manaCost: '{G}', cmc: 1, colors: ['G'], colorIdentity: ['G'], typeLine: 'Creature — Elf', oracleText: 'Whenever a creature you control explores, you gain 1 life.', power: '1', toughness: '1', keywords: [], image: '', art: '' },
  });
  scriptCards(['Test Explorer Watcher']);

  it('each Merfolk explores at the beginning of combat, one at a time in the order chosen (701.44a, 701.44d)', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Hakbal of the Surging Soul');
      put(d, 0, 'Test Merfolk');
      put(d, 0, 'Test Explorer Watcher');
      put(d, 0, 'Elite Vanguard'); // not a Merfolk
      top(d, 0, ['Forest', 'Serra Angel', 'Plains', ...plenty()]);
    });
    g = until(g, (x) => x.decision?.type === 'chooseCards' && x.priority === 0);
    // Two Merfolk: the player picks which explores first.
    expect(asked(g)!.cards!.length).toBe(2);
    const merfolk = byName(g, 0, 'Test Merfolk')!;
    g = run(g, { type: 'chooseCards', cards: [merfolk.id] });
    // The Merfolk revealed a Forest: into the hand, no counter, no question.
    expect(byName(g, 0, 'Forest', 'hand')).toBeDefined();
    expect(counterCount(byName(g, 0, 'Test Merfolk')!)).toBe(0);
    // Hakbal explores next (the only one left, no pick): Serra Angel, a counter, then the choice.
    expect(g.decision?.type).toBe('ask');
    expect(counterCount(byName(g, 0, 'Hakbal of the Surging Soul')!)).toBe(1);
    g = run(g, { type: 'answer', yes: true });
    expect(byName(g, 0, 'Serra Angel', 'graveyard')).toBeDefined();
    g = settle(g);
    // "Whenever a creature you control explores" triggered twice (701.44b).
    expect(g.players[0].life).toBe(42);
    expect(byName(g, 0, 'Elite Vanguard')!.counters['+1/+1']).toBeUndefined();
  });

  it('a creature that left still explores, as it last was, and gets no counter (701.44c); an empty library still gives the counter (rulings)', () => {
    registerCards({ 'Test Prowler': { name: 'Test Prowler', manaCost: '{U}', cmc: 1, colors: ['U'], colorIdentity: ['U'], typeLine: 'Creature — Merfolk', oracleText: 'Whenever this creature attacks, it explores.', power: '1', toughness: '1', keywords: [], image: '', art: '' } });
    expect(scriptCards(['Test Prowler'])).toEqual([]);
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Test Prowler');
      put(d, 0, 'Test Explorer Watcher');
      put(d, 0, 'Mountain');
      put(d, 0, 'Shock', 'hand');
      top(d, 0, ['Serra Angel', ...plenty()]);
    });
    g = until(g, (x) => x.step === 'attackers' && x.decision?.type === 'attackers' && x.priority === 0);
    g = run(g, { type: 'declareAttack', card: byName(g, 0, 'Test Prowler')!.id, defender: 1 });
    // The explore trigger is on the stack; the Prowler is shocked in response.
    for (let i = 0; i < 10 && !(g.stack.length === 1 && g.priority === 0 && !g.decision); i++) g = applyAction(g, pass, { autoPass: false });
    expect(g.stack).toHaveLength(1);
    g = run(g, { type: 'cast', card: byName(g, 0, 'Shock', 'hand')!.id, targets: [card(byName(g, 0, 'Test Prowler')!)] });
    g = until(g, (x) => x.decision?.type === 'ask' && x.priority === 0);
    // The Prowler is gone, yet it explored: the card was revealed, nothing got a counter, and it may go to the graveyard.
    expect(byName(g, 0, 'Test Prowler', 'graveyard')).toBeDefined();
    g = settle(run(g, { type: 'answer', yes: false }));
    expect(g.players[0].library[0]?.name).toBe('Serra Angel');
    expect(g.players[0].battlefield.every((c) => !c.counters['+1/+1'])).toBe(true);
    // "Whenever a creature you control explores" triggered for it (701.44b, rulings).
    expect(g.players[0].life).toBe(41);
    // No card to reveal: the counter is still put on.
    let h = emptyGame((d) => {
      put(d, 0, 'Test Merfolk');
      d.players[0].library = [];
    });
    h = produce(h, (d) => explore(d, d.players[0].battlefield[0]));
    expect(counterCount(byName(h, 0, 'Test Merfolk')!)).toBe(1);
  });

  it('on attack, puts a land from the hand onto the battlefield or draws (608.2d)', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Hakbal of the Surging Soul');
      put(d, 0, 'Forest', 'hand');
      top(d, 0, plenty());
      d.players[0].library = d.players[0].library.slice(0, 3);
    });
    // Combat: Hakbal explores first (a Plains goes to hand), then attacks.
    g = until(g, (x) => x.step === 'attackers' && x.decision?.type === 'attackers' && x.priority === 0);
    g = run(g, { type: 'declareAttack', card: byName(g, 0, 'Hakbal of the Surging Soul')!.id, defender: 1 }, pass);
    g = until(g, (x) => x.decision?.type === 'chooseCards' && x.priority === 0);
    expect(asked(g)!.cards!.length).toBe(2); // Forest and the Plains explored into the hand
    g = settle(run(g, { type: 'chooseCards', cards: [byName(g, 0, 'Forest', 'hand')!.id] }));
    expect(byName(g, 0, 'Forest')).toBeDefined();
    // Declining draws instead.
    let h = emptyGame((d) => {
      human(d);
      put(d, 0, 'Hakbal of the Surging Soul');
      put(d, 0, 'Serra Angel', 'hand');
      top(d, 0, ['Shock', 'Shock', 'Shock']);
    });
    h = until(h, (x) => x.step === 'attackers' && x.decision?.type === 'attackers' && x.priority === 0);
    h = run(h, { type: 'declareAttack', card: byName(h, 0, 'Hakbal of the Surging Soul')!.id, defender: 1 }, pass);
    h = until(h, (x) => x.step === 'main2' || x.turn > 1);
    // No land in hand (Shock explored stayed on top or went to the graveyard): a card is drawn.
    expect(h.players[0].hand.length).toBe(2);
  });
});

describe('The Wandering Minstrel', () => {
  registerCards({
    'Test Town': { name: 'Test Town', manaCost: '', cmc: 0, colors: [], colorIdentity: [], typeLine: 'Land — Town', oracleText: '{T}: Add {G}.', keywords: [], image: '', art: '' },
  });
  scriptCards(['Test Town']);

  it('lands you control enter untapped: a tapland asks the order (616.1, rulings), one put onto the battlefield tapped enters untapped, a shock land needs no life', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'The Wandering Minstrel');
      put(d, 0, 'Arcane Sanctum', 'hand');
      put(d, 0, 'Watery Grave', 'hand');
    });
    g = run(g, { type: 'playLand', card: byName(g, 0, 'Arcane Sanctum', 'hand')!.id });
    expect(g.decision?.type).toBe('replacement');
    const options = (g.decision as { ask: { options: { label: string }[] } }).ask.options;
    expect(options.map((o) => o.label).sort()).toEqual(['Arcane Sanctum', 'The Wandering Minstrel']);
    // Apply the Minstrel's effect first: the land's own then makes it enter tapped.
    g = run(g, { type: 'replacement', option: options.findIndex((o) => o.label === 'The Wandering Minstrel') });
    expect(byName(g, 0, 'Arcane Sanctum')!.tapped).toBe(true);
    // The other order: untapped.
    let h = emptyGame((d) => {
      human(d);
      put(d, 0, 'The Wandering Minstrel');
      put(d, 0, 'Arcane Sanctum', 'hand');
    });
    h = run(h, { type: 'playLand', card: byName(h, 0, 'Arcane Sanctum', 'hand')!.id });
    const opts = (h.decision as { ask: { options: { label: string }[] } }).ask.options;
    h = run(h, { type: 'replacement', option: opts.findIndex((o) => o.label === 'Arcane Sanctum') });
    expect(byName(h, 0, 'Arcane Sanctum')!.tapped).toBe(false);
    // A shock land: declining the life, it still enters untapped; a land put onto the battlefield tapped too.
    g = until(g, (x) => x.active === 0 && x.turn > 1 && x.step === 'main1' && !x.decision);
    g = run(g, { type: 'playLand', card: byName(g, 0, 'Watery Grave', 'hand')!.id });
    expect(g.decision?.type).toBe('ask');
    g = run(g, { type: 'answer', yes: false });
    expect(byName(g, 0, 'Watery Grave')!.tapped).toBe(false);
    expect(g.players[0].life).toBe(40);
    g = produce(g, (d) => enterBattlefield(d, makeCard(d, 'Forest', 0, 'hand'), { tapped: true, controller: 0 }));
    expect(byName(g, 0, 'Forest')!.tapped).toBe(false);
    // An opponent's land, and a bot takes untapped.
    g = produce(g, (d) => enterBattlefield(d, makeCard(d, 'Forest', 1, 'hand'), { tapped: true, controller: 1 }));
    expect(byName(g, 1, 'Forest')!.tapped).toBe(true);
  });

  it("entering together with a tapland, the Minstrel's effect doesn't apply to it (614.12, rulings)", () => {
    const g = emptyGame((d) => {
      const minstrel = makeCard(d, 'The Wandering Minstrel', 0, 'hand');
      const land = makeCard(d, 'Arcane Sanctum', 0, 'hand');
      d.players[0].hand.push(minstrel, land);
      enterTogether(d, [{ card: minstrel, opts: { controller: 0 } }, { card: land, opts: { controller: 0 } }]);
    });
    expect(byName(g, 0, 'Arcane Sanctum')!.tapped).toBe(true);
  });

  it("makes a token that's all colors with five Towns at the beginning of combat (603.4), and pumps others by the Towns as it resolves (611.2c)", () => {
    const towns = (n: number) => (d: Game) => {
      for (let i = 0; i < n; i++) put(d, 0, 'Test Town');
    };
    let g = emptyGame((d) => {
      put(d, 0, 'The Wandering Minstrel');
      towns(4)(d);
    });
    g = until(g, (x) => x.step === 'main2' && x.active === 0);
    expect(g.players[0].battlefield.some((c) => c.isToken)).toBe(false);
    let h = emptyGame((d) => {
      put(d, 0, 'The Wandering Minstrel');
      put(d, 0, 'Elite Vanguard');
      put(d, 0, 'Plains');
      put(d, 0, 'Island');
      put(d, 0, 'Swamp');
      put(d, 0, 'Mountain');
      towns(5)(d);
    });
    // Nine lands: enough for the ability. X is the Towns as it resolves.
    h = settle(run(h, { type: 'activate', card: byName(h, 0, 'The Wandering Minstrel')!.id }));
    expect(stats(h, byName(h, 0, 'Elite Vanguard')!)).toMatchObject({ power: 7, toughness: 6 });
    expect(stats(h, byName(h, 0, 'The Wandering Minstrel')!)).toMatchObject({ power: 1, toughness: 3 });
    h = until(h, (x) => x.step === 'main2' && x.active === 0);
    const token = h.players[0].battlefield.find((c) => c.isToken)!;
    expect(token).toBeDefined();
    expect(stats(h, token)).toMatchObject({ power: 2, toughness: 2 });
    expect([...colorsOf(h, token)].sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
  });
});
