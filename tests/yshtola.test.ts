// The Y'shtola deck's hand scripts and the rules they needed: the clauses that could go wrong.
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  applyBotAction,
  botAction,
  castCost,
  choiceOptions,
  costText,
  data,
  has,
  makeCard,
  damagePlayer,
  refreshSubtypes,
  stats,
  subtypesOf,
} from '../src/engine';
import type { Action, CardChoice, Game, PlayerId, TargetRef } from '../src/engine';
import { produce } from 'immer';
import { byName, emptyGame, put, run } from './helpers';

const pass = { type: 'pass' } as const;
const player = (id: PlayerId): TargetRef => ({ kind: 'player', id });
const card = (c: { id: string }): TargetRef => ({ kind: 'card', id: c.id });
const cast = (g: Game, name: string, extra: object = {}, zone: 'hand' | 'graveyard' | 'exile' = 'hand', pid: PlayerId = 0): Action => ({
  type: 'cast',
  card: byName(g, pid, name, zone)!.id,
  ...extra,
});

/** Passes priority (bots answering anything asked) until the stack is empty and nothing is being decided. */
function settle(g: Game, human?: (g: Game) => Action | null): Game {
  for (let i = 0; i < 80 && (g.decision || g.stack.length || g.triggers.length); i++) {
    const mine = human && g.priority === 0 && g.decision ? human(g) : null;
    g = mine ? run(g, mine) : g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  }
  return g;
}

/** A game where player 0 is a person, so their choices wait for an answer. */
const humanGame = (setup: (g: Game) => void) =>
  emptyGame((d) => {
    d.players[0].isBot = false;
    d.players[0].you = true;
    setup(d);
  });

/** Passes until a decision for player 0 comes up, or the stack empties. */
function untilAsked(g: Game): Game {
  for (let i = 0; i < 40 && !(g.decision && g.priority === 0) && (g.stack.length || g.triggers.length || g.decision); i++) {
    g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  }
  return g;
}

const pickChoice = (g: Game) => (g.decision as { choice: Extract<CardChoice, { kind: 'pick' }> }).choice;
/** Replaces a player's library with these cards, the first on top. */
function top(g: Game, pid: PlayerId, names: string[]) {
  g.players[pid].library = names.map((n) => makeCard(g, n, pid, 'library'));
}
const lifeOf = (g: Game) => g.players.map((p) => p.life);

describe("Y'shtola, Night's Blessed", () => {
  it('deals 2 damage to each opponent and gains 2 life for a noncreature spell with mana value 3 or more', () => {
    let g = emptyGame((d) => {
      put(d, 0, "Y'shtola, Night's Blessed");
      put(d, 0, 'Stock Up', 'hand');
      put(d, 0, 'Island', 'battlefield', 3);
      top(d, 0, ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains']);
    });
    g = run(g, cast(g, 'Stock Up'));
    g = settle(g);
    expect(lifeOf(g)).toEqual([42, 38, 38, 38]);
  });

  it('ignores a cheaper noncreature spell and a creature spell', () => {
    let g = emptyGame((d) => {
      put(d, 0, "Y'shtola, Night's Blessed");
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Roaming Throne', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 5);
    });
    g = run(g, cast(g, 'Lightning Bolt', { targets: [player(1)] }));
    g = settle(g);
    expect(lifeOf(g)).toEqual([40, 37, 40, 40]);
    g = run(g, cast(g, 'Roaming Throne'));
    g = settle(g);
    expect(byName(g, 0, 'Roaming Throne')).toBeDefined();
    expect(lifeOf(g)).toEqual([40, 37, 40, 40]);
  });

  it('draws at the end step only if a player lost 4 or more life this turn (603.4)', () => {
    const endStep = (lost: number) => {
      let g = emptyGame((d) => {
        put(d, 0, "Y'shtola, Night's Blessed");
        top(d, 0, ['Plains', 'Plains']);
        d.players[2].lifeLost = lost;
        d.step = 'main2';
      });
      const hand = g.players[0].hand.length;
      for (let i = 0; i < 20 && g.step !== 'cleanup' && g.active === 0; i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
      return g.players[0].hand.length - hand;
    };
    expect(endStep(4)).toBe(1);
    expect(endStep(3)).toBe(0);
  });
});

describe('Propaganda (508.1g-i)', () => {
  const attackGame = (lands: number, vigilance = false) =>
    humanGame((d) => {
      put(d, 1, 'Propaganda');
      put(d, 0, vigilance ? 'Serra Angel' : 'Walking Corpse', 'battlefield', 2);
      put(d, 0, 'Plains', 'battlefield', lands);
      d.step = 'attackers';
      d.combat = { attacks: [], toBlock: [], struckFirst: null, moreDamage: false } as unknown as Game['combat'];
      d.decision = { type: 'attackers' };
    });
  const bears = (g: Game) => g.players[0].battlefield.filter((c) => c.name === 'Walking Corpse' || c.name === 'Serra Angel');

  it('costs {2} for each creature attacking its controller, paid as attackers are declared', () => {
    let g = attackGame(4);
    const [a, b] = bears(g);
    g = run(g, { type: 'declareAttack', card: a.id, defender: 1 }, { type: 'declareAttack', card: b.id, defender: 1 }, pass);
    expect(g.players[1].life).toBe(36);
    expect(g.players[0].battlefield.filter((c) => c.name === 'Plains' && c.tapped)).toHaveLength(4);
    expect(g.log.some((l) => l.text.endsWith(' pay {4} to attack.'))).toBe(true);
  });

  it("refuses an attack its controller can't pay for, and attacking someone else is free", () => {
    let g = attackGame(3);
    const [a, b] = bears(g);
    g = run(g, { type: 'declareAttack', card: a.id, defender: 1 });
    expect(applyAction(g, { type: 'declareAttack', card: b.id, defender: 1 })).toBe(g);
    g = run(g, { type: 'declareAttack', card: b.id, defender: 2 }, pass);
    expect(g.players[0].battlefield.filter((c) => c.name === 'Plains' && c.tapped)).toHaveLength(2);
  });
});

describe('extort (702.101a): Blind Obedience', () => {
  it('pays {W/B} when you cast a spell: each opponent loses 1 life and you gain that much', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Blind Obedience');
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Mountain');
      put(d, 0, 'Plains');
    });
    g = run(g, cast(g, 'Lightning Bolt', { targets: [player(1)] }));
    g = settle(g);
    expect(lifeOf(g)).toEqual([43, 36, 39, 39]);
  });

  it("makes artifacts and creatures your opponents control enter tapped, but not yours", () => {
    let g = emptyGame((d) => {
      put(d, 1, 'Blind Obedience');
      put(d, 0, 'Walking Corpse', 'hand');
      put(d, 0, 'Sol Ring', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 3);
    });
    g = settle(run(g, cast(g, 'Sol Ring')));
    g = settle(run(g, cast(g, 'Walking Corpse')));
    expect(byName(g, 0, 'Sol Ring')!.tapped).toBe(true);
    expect(byName(g, 0, 'Walking Corpse')!.tapped).toBe(true);
  });
});

describe("job select (702.182a) and Black Mage's Rod", () => {
  it('makes a Hero, attaches to it, and gives +1/+0, Wizard and the ping', () => {
    let g = emptyGame((d) => {
      put(d, 0, "Black Mage's Rod", 'hand');
      put(d, 0, 'Swamp', 'battlefield', 2);
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Mountain');
    });
    g = settle(run(g, cast(g, "Black Mage's Rod")));
    const hero = byName(g, 0, 'Hero')!;
    expect(byName(g, 0, "Black Mage's Rod")!.attachedTo).toBe(hero.id);
    expect(stats(g, hero)).toMatchObject({ power: 2, toughness: 1 });
    expect(subtypesOf(hero)).toContain('Wizard');
    g = settle(run(g, cast(g, 'Lightning Bolt', { targets: [player(1)] })));
    expect(lifeOf(g)).toEqual([40, 36, 39, 39]);
  });
});

describe('Relic of Legends: tap an untapped legendary creature you control', () => {
  it('taps the chosen legendary creature, even one that just arrived (302.6)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Relic of Legends').tapped = true;
      const ysh = put(d, 0, "Y'shtola, Night's Blessed");
      ysh.sick = true;
      put(d, 0, 'Walking Corpse');
    });
    const relic = byName(g, 0, 'Relic of Legends')!;
    const ysh = byName(g, 0, "Y'shtola, Night's Blessed")!;
    const bears = byName(g, 0, 'Walking Corpse')!;
    expect(applyAction(g, { type: 'tapMana', card: relic.id, ability: 1, color: 'U', tap: bears.id })).toBe(g);
    g = run(g, { type: 'tapMana', card: relic.id, ability: 1, color: 'U', tap: ysh.id });
    expect(byName(g, 0, "Y'shtola, Night's Blessed")!.tapped).toBe(true);
    expect(g.players[0].pool.map((m) => m.sym)).toEqual(['U']);
    // With no untapped legendary creature left, it can't be used.
    expect(applyAction(g, { type: 'tapMana', card: relic.id, ability: 1, color: 'U' })).toBe(g);
  });
});

/** Passes until player 0's next precombat main phase, bots acting as they like. */
function nextTurn(g: Game, stop: (g: Game) => boolean = (x) => x.active === 0 && x.step === 'main1' && !x.stack.length && !x.decision && !x.triggers.length): Game {
  const turn = g.turn;
  for (let i = 0; i < 400 && !(g.turn > turn && stop(g)); i++) {
    if (g.decision && g.priority === 0 && g.decision.type === 'cast') break;
    g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  }
  return g;
}

describe('casting rules: delve, aftermath, rebound, paradigm', () => {
  it('delve (702.66a): each card exiled from the graveyard pays for {1}', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Dig Through Time', 'hand');
      put(d, 0, 'Island', 'battlefield', 2);
      put(d, 0, 'Plains', 'graveyard', 6);
      top(d, 0, ['Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp']);
    });
    const dig = byName(g, 0, 'Dig Through Time', 'hand')!;
    const delve = g.players[0].graveyard.map((c) => c.id);
    expect(costText(castCost(g, dig, { delve }))).toBe('{U}{U}');
    expect(costText(castCost(g, dig, { delve: delve.slice(0, 4) }))).toBe('{2}{U}{U}');
    g = settle(run(g, cast(g, 'Dig Through Time', { delve })));
    expect(g.players[0].exile.filter((c) => c.name === 'Plains')).toHaveLength(6);
    expect(g.players[0].hand).toHaveLength(2);
    // The other five went to the bottom: the eighth card is now on top.
    expect(g.players[0].library).toHaveLength(6);
  });

  it('aftermath (702.127a): Dawn only from the graveyard, then exiled; Dusk only from the hand', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Dusk', 'hand');
      put(d, 0, 'Plains', 'battlefield', 10);
      put(d, 0, 'Serra Angel');
      put(d, 1, 'Walking Corpse');
      put(d, 0, 'Elite Vanguard', 'graveyard');
      put(d, 0, 'Serra Angel', 'graveyard');
    });
    expect(applyAction(g, cast(g, 'Dusk', { face: 1 }))).toBe(g);
    g = settle(run(g, cast(g, 'Dusk', { face: 0 })));
    // Destroy all creatures with power 3 or greater: the Angel, not the Corpse.
    expect(byName(g, 0, 'Serra Angel')).toBeUndefined();
    expect(byName(g, 1, 'Walking Corpse')).toBeDefined();
    expect(applyAction(g, cast(g, 'Dusk', { face: 0 }, 'graveyard'))).toBe(g);
    g = settle(run(g, cast(g, 'Dusk', { face: 1 }, 'graveyard')));
    // Creature cards with power 2 or less come back: the Vanguard, not the Angels.
    expect(g.players[0].hand.map((c) => c.name)).toEqual(['Elite Vanguard']);
    expect(byName(g, 0, 'Dusk', 'exile')).toBeDefined();
  });

  it('rebound (702.88a): exiled, then cast free at the next upkeep; the Wizard only from the hand', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Transpose', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 3);
      top(d, 0, ['Plains', 'Plains', 'Plains', 'Plains', 'Plains']);
    });
    const discardFirst = (x: Game): Action | null => (x.decision?.type === 'chooseCards' ? { type: 'chooseCards', cards: [x.players[0].hand[0].id] } : null);
    g = settle(run(g, cast(g, 'Transpose')), discardFirst);
    expect(byName(g, 0, 'Transpose', 'exile')).toBeDefined();
    expect(g.players[0].battlefield.filter((c) => c.name === 'Wizard 0/1 ping')).toHaveLength(1);
    expect(g.players[0].life).toBe(39);
    g = nextTurn(g);
    expect(g.decision?.type).toBe('cast');
    g = settle(run(g, cast(g, 'Transpose', {}, 'exile')), discardFirst);
    expect(byName(g, 0, 'Transpose', 'graveyard')).toBeDefined();
    expect(g.players[0].battlefield.filter((c) => c.name === 'Wizard 0/1 ping')).toHaveLength(1);
    expect(g.players[0].life).toBeLessThanOrEqual(38);
  });

  it('paradigm (702.192a): exiled, and a free copy is offered at each of your precombat main phases', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Decorum Dissertation', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 5);
      top(d, 0, Array.from({ length: 12 }, () => 'Plains'));
    });
    g = settle(run(g, cast(g, 'Decorum Dissertation', { targets: [player(1)] })));
    expect(g.players[1].life).toBe(38);
    expect(byName(g, 0, 'Decorum Dissertation', 'exile')).toBeDefined();
    g = nextTurn(g);
    expect(g.decision?.type).toBe('cast');
    const copy = g.players[0].exile.find((c) => c.name === 'Decorum Dissertation' && c.isToken)!;
    g = settle(run(g, { type: 'cast', card: copy.id, targets: [player(2)] }));
    expect(g.players[2].life).toBe(38);
    // The copy is gone; the card stays in exile, and the next turn offers another copy.
    expect(g.players[0].exile.filter((c) => c.name === 'Decorum Dissertation')).toHaveLength(1);
    g = nextTurn(g);
    expect(g.decision?.type).toBe('cast');
  });
});

describe('Emet-Selch of the Third Seat', () => {
  it('casts an instant from the graveyard when an opponent loses life, exiles it after, and only once a turn (603.2h)', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Emet-Selch of the Third Seat');
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Lightning Bolt', 'graveyard');
      put(d, 0, 'Mountain', 'battlefield', 2);
    });
    const old = byName(g, 0, 'Lightning Bolt', 'graveyard')!;
    g = run(g, cast(g, 'Lightning Bolt', { targets: [player(1)] }));
    g = untilAsked(g);
    expect(g.decision?.type).toBe('targets');
    g = run(g, { type: 'chooseTargets', targets: [card(old)] });
    g = untilAsked(g);
    expect(g.decision?.type).toBe('cast');
    // {2} less for a spell cast from the graveyard: Lightning Bolt still costs {R}.
    expect(costText(castCost(g, old))).toBe('{R}');
    g = run(g, { type: 'cast', card: old.id, targets: [player(2)] });
    g = settle(g);
    expect(lifeOf(g)).toEqual([40, 37, 37, 40]);
    expect(g.players[0].exile.some((c) => c.id === old.id)).toBe(true);
    // The second Bolt hit an opponent too, but it doesn't trigger again this turn.
    expect(g.stack).toHaveLength(0);
    expect(g.decision).toBeNull();
  });

  it('may decline, and it triggers again later that turn', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Emet-Selch of the Third Seat');
      put(d, 0, 'Lightning Bolt', 'hand', 2);
      put(d, 0, 'Mountain', 'battlefield', 2);
    });
    g = run(g, cast(g, 'Lightning Bolt', { targets: [player(1)] }));
    g = untilAsked(g);
    g = run(g, { type: 'chooseTargets', targets: [card(byName(g, 0, 'Lightning Bolt', 'graveyard')!)] });
    g = untilAsked(g);
    g = run(g, { type: 'answer', yes: false });
    g = settle(g);
    g = run(g, cast(g, 'Lightning Bolt', { targets: [player(1)] }));
    g = untilAsked(g);
    expect(g.decision?.type).toBe('targets');
  });
});

describe("G'raha Tia, Scion Reborn", () => {
  it('pays X life for a Hero with X +1/+1 counters, once each turn', () => {
    let g = humanGame((d) => {
      put(d, 0, "G'raha Tia, Scion Reborn");
      put(d, 0, 'Stock Up', 'hand');
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Island', 'battlefield', 3);
      put(d, 0, 'Mountain');
      top(d, 0, ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains']);
    });
    g = run(g, cast(g, 'Stock Up'));
    g = untilAsked(g);
    expect(g.decision?.type).toBe('ask');
    g = run(g, { type: 'answer', yes: true });
    g = settle(g, (x) => (x.decision?.type === 'chooseCards' ? { type: 'chooseCards', cards: choiceOptions(x, pickChoice(x)).cards.slice(0, pickChoice(x).max).map((c) => c.id) } : null));
    expect(g.players[0].life).toBe(37);
    const hero = byName(g, 0, 'Hero')!;
    expect(stats(g, hero)).toMatchObject({ power: 4, toughness: 4 });
    g = run(g, cast(g, 'Lightning Bolt', { targets: [player(1)] }));
    g = settle(g);
    expect(g.players[0].battlefield.filter((c) => c.name === 'Hero')).toHaveLength(1);
  });
});

describe('Ishgard, the Holy See (a land with an Adventure, 715.3d)', () => {
  it('casts Faith & Grief from the hand, then the land can be played from exile', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Ishgard, the Holy See', 'hand');
      put(d, 0, 'Plains', 'battlefield', 5);
      put(d, 0, 'Sol Ring', 'graveyard');
      put(d, 0, 'Blind Obedience', 'graveyard');
      put(d, 0, 'Lightning Bolt', 'graveyard');
    });
    const ring = byName(g, 0, 'Sol Ring', 'graveyard')!;
    const ob = byName(g, 0, 'Blind Obedience', 'graveyard')!;
    g = settle(run(g, cast(g, 'Ishgard, the Holy See', { face: 1, targets: [card(ring), card(ob)] })));
    expect(g.players[0].hand.map((c) => c.name).sort()).toEqual(['Blind Obedience', 'Sol Ring']);
    const ish = byName(g, 0, 'Ishgard, the Holy See', 'exile')!;
    expect(ish.adventure).toBe(true);
    g = run(g, { type: 'playLand', card: ish.id });
    expect(byName(g, 0, 'Ishgard, the Holy See')!.tapped).toBe(true);
  });
});

describe('library searches and looks', () => {
  it('Waterlogged Teachings finds an instant card or a card with flash, not a sorcery', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Waterlogged Teachings', 'hand');
      put(d, 0, 'Island', 'battlefield', 4);
      top(d, 0, ['Lightning Bolt', 'Ophidian Eye', 'Stock Up', 'Plains']);
    });
    g = untilAsked(run(g, cast(g, 'Waterlogged Teachings')));
    const { valid } = choiceOptions(g, pickChoice(g));
    expect([...valid].map((id) => g.players[0].library.find((c) => c.id === id)!.name).sort()).toEqual(['Lightning Bolt', 'Ophidian Eye']);
  });

  it("Silundi Vision shows six but only an instant or sorcery can be taken; the rest go to the bottom", () => {
    let g = humanGame((d) => {
      put(d, 0, 'Silundi Vision', 'hand');
      put(d, 0, 'Island', 'battlefield', 3);
      top(d, 0, ['Plains', 'Stock Up', 'Plains', 'Sol Ring', 'Plains', 'Plains', 'Swamp']);
    });
    g = untilAsked(run(g, cast(g, 'Silundi Vision')));
    const opts = choiceOptions(g, pickChoice(g));
    expect(opts.cards).toHaveLength(6);
    expect(opts.valid.size).toBe(1);
    g = settle(run(g, { type: 'chooseCards', cards: [...opts.valid] }));
    expect(g.players[0].hand.map((c) => c.name)).toEqual(['Stock Up']);
    expect(g.players[0].library[0].name).toBe('Swamp');
  });

  it('Stock Up: two into the hand, and the player orders the rest on the bottom (401.4)', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Stock Up', 'hand');
      put(d, 0, 'Island', 'battlefield', 3);
      top(d, 0, ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes']);
    });
    g = untilAsked(run(g, cast(g, 'Stock Up')));
    const names = (ids: string[]) => ids.map((id) => g.players[0].library.find((c) => c.id === id)!.name);
    const lib = g.players[0].library;
    g = run(g, { type: 'chooseCards', cards: [lib[0].id, lib[1].id] });
    expect(pickChoice(g)).toMatchObject({ ordered: true, min: 3, max: 3 });
    const [swamp, mountain, forest] = pickChoice(g).cards;
    expect(names([swamp, mountain, forest])).toEqual(['Swamp', 'Mountain', 'Forest']);
    g = run(g, { type: 'chooseCards', cards: [forest, swamp, mountain] });
    g = settle(g);
    expect(g.players[0].library.map((c) => c.name)).toEqual(['Wastes', 'Forest', 'Swamp', 'Mountain']);
  });
});

describe('protection and returning from death', () => {
  it('Malakir Rebirth: the creature returns tapped under its owner\'s control when it dies this turn', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Malakir Rebirth', 'hand');
      put(d, 0, 'Swamp');
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Mountain');
      put(d, 1, 'Walking Corpse');
    });
    const corpse = byName(g, 1, 'Walking Corpse')!;
    g = settle(run(g, cast(g, 'Malakir Rebirth', { targets: [card(corpse)] })));
    expect(g.players[0].life).toBe(38);
    g = settle(run(g, cast(g, 'Lightning Bolt', { targets: [card(corpse)] })));
    const back = byName(g, 1, 'Walking Corpse')!;
    expect(back.tapped).toBe(true);
    expect(back.mods).toEqual([]);
  });

  it('Mother of Runes: protection from the chosen colour stops damage and targeting (702.16)', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Mother of Runes');
      put(d, 0, 'Serra Angel');
      put(d, 1, 'Lightning Bolt', 'hand', 2);
      put(d, 1, 'Mountain', 'battlefield', 2);
    });
    const angel = byName(g, 0, 'Serra Angel')!;
    g = run(g, { type: 'activate', card: byName(g, 0, 'Mother of Runes')!.id, targets: [card(angel)] });
    g = untilAsked(g);
    expect(g.decision?.type).toBe('name');
    g = settle(run(g, { type: 'name', name: 'R' }));
    expect(has(g, byName(g, 0, 'Serra Angel')!, 'protection from red')).toBe(true);
    g = { ...g, active: 1, priority: 1 };
    expect(applyAction(g, cast(g, 'Lightning Bolt', { targets: [card(angel)] }, 'hand', 1))).toBe(g);
  });
});

describe('Roaming Throne', () => {
  it('is the chosen type, and doubles triggers of other creatures of that type you control (603.2d)', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Roaming Throne', 'hand');
      put(d, 0, 'Plains', 'battlefield', 4);
      put(d, 0, 'Papalymo Totolymo');
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Mountain');
    });
    g = untilAsked(run(g, cast(g, 'Roaming Throne')));
    expect(g.decision?.type).toBe('name');
    g = settle(run(g, { type: 'name', name: 'Dwarf' }));
    expect(subtypesOf(byName(g, 0, 'Roaming Throne')!)).toContain('Dwarf');
    g = settle(run(g, cast(g, 'Lightning Bolt', { targets: [player(1)] })));
    // Papalymo's ping twice: 2 to each opponent, 2 life, plus the Bolt.
    expect(lifeOf(g)).toEqual([42, 35, 38, 38]);
  });
});

describe('untapping and land types', () => {
  it("Unwinding Clock and Bender's Waterskin untap during each other player's untap step (502.3)", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Unwinding Clock');
      put(d, 0, 'Sol Ring').tapped = true;
      put(d, 0, "Bender's Waterskin").tapped = true;
      put(d, 0, 'Plains').tapped = true;
      d.step = 'end';
    });
    for (let i = 0; i < 50 && g.active === 0; i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
    expect(g.active).toBe(1);
    expect(byName(g, 0, 'Sol Ring')!.tapped).toBe(false);
    expect(byName(g, 0, "Bender's Waterskin")!.tapped).toBe(false);
    expect(byName(g, 0, 'Plains')!.tapped).toBe(true);
  });

  it('Urborg makes every land a Swamp, so each taps for {B} (305.6)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Urborg, Tomb of Yawgmoth');
      put(d, 1, 'Plains');
      refreshSubtypes(d);
    });
    g = run(g, { type: 'tapMana', card: byName(g, 0, 'Urborg, Tomb of Yawgmoth')!.id });
    expect(g.players[0].pool.map((m) => m.sym)).toEqual(['B']);
    expect(subtypesOf(byName(g, 1, 'Plains')!)).toEqual(['Plains', 'Swamp']);
  });
});

describe('sacrifices', () => {
  it("Single Combat: each player keeps one creature or planeswalker, the rest are sacrificed together, and no creature spells until the end of your next turn", () => {
    let g = humanGame((d) => {
      put(d, 0, 'Single Combat', 'hand');
      put(d, 0, 'Plains', 'battlefield', 5);
      put(d, 0, 'Serra Angel');
      put(d, 0, 'Elite Vanguard');
      put(d, 1, 'Walking Corpse', 'battlefield', 3);
      put(d, 2, 'Serra Angel');
      put(d, 1, 'Elite Vanguard', 'hand');
    });
    const angel = byName(g, 0, 'Serra Angel')!;
    g = untilAsked(run(g, cast(g, 'Single Combat')));
    expect(pickChoice(g).player).toBe(0);
    g = settle(run(g, { type: 'chooseCards', cards: [angel.id] }));
    expect(g.players.map((p) => p.battlefield.filter((c) => c.name !== 'Plains').length)).toEqual([1, 1, 1, 0]);
    expect(byName(g, 0, 'Serra Angel')).toBeDefined();
    const later = { ...g, active: 1, priority: 1 };
    expect(applyAction(later, cast(later, 'Elite Vanguard', {}, 'hand', 1))).toBe(later);
    expect(g.effects).toContainEqual({ kind: 'cantCast', player: 1, types: ['Creature', 'Planeswalker'], until: { player: 0, turn: g.turn + 1 } });
  });

  it('Papalymo Totolymo: each opponent who lost life this turn sacrifices a creature with the greatest power', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Papalymo Totolymo');
      put(d, 0, 'Plains', 'battlefield', 4);
      put(d, 1, 'Serra Angel');
      put(d, 1, 'Walking Corpse');
      put(d, 2, 'Serra Angel');
      d.players[1].lifeLost = 1;
    });
    g = settle(run(g, { type: 'activate', card: byName(g, 0, 'Papalymo Totolymo')!.id }));
    expect(byName(g, 1, 'Serra Angel')).toBeUndefined();
    expect(byName(g, 1, 'Walking Corpse')).toBeDefined();
    expect(byName(g, 2, 'Serra Angel')).toBeDefined();
    expect(byName(g, 0, 'Papalymo Totolymo', 'graveyard')).toBeDefined();
  });

  it('Solitary Confinement: shroud, and all damage to you is prevented', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Solitary Confinement');
      put(d, 1, 'Lightning Bolt', 'hand');
      put(d, 1, 'Mountain');
      put(d, 1, 'Walking Corpse');
      d.active = 1;
      d.priority = 1;
    });
    expect(applyAction(g, cast(g, 'Lightning Bolt', { targets: [player(0)] }, 'hand', 1))).toBe(g);
    let dealt = -1;
    produce(g, (d) => {
      dealt = damagePlayer(d, byName(d, 1, 'Walking Corpse')!, 0, 3);
    });
    expect(dealt).toBe(0);
  });

  it('Solitary Confinement: discard to keep it and skip the draw; with an empty hand it is sacrificed, and you draw', () => {
    const upkeep = (handCards: number, keep: boolean) => {
      let g = humanGame((d) => {
        put(d, 0, 'Solitary Confinement');
        put(d, 0, 'Plains', 'hand', handCards);
        top(d, 0, ['Island', 'Island']);
        d.active = 3;
        d.priority = 3;
        d.step = 'end';
      });
      for (let i = 0; i < 60 && !(g.active === 0 && g.step === 'main1'); i++) {
        if (g.decision?.type === 'ask' && g.priority === 0) g = run(g, { type: 'answer', yes: keep });
        else if (g.decision?.type === 'chooseCards' && g.priority === 0) g = run(g, { type: 'chooseCards', cards: [g.players[0].hand[0].id] });
        else g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
      }
      return { kept: !!byName(g, 0, 'Solitary Confinement'), hand: g.players[0].hand.map((c) => c.name) };
    };
    expect(upkeep(1, true)).toEqual({ kept: true, hand: [] });
    expect(upkeep(1, false)).toEqual({ kept: false, hand: ['Plains', 'Island'] });
    expect(upkeep(0, true)).toEqual({ kept: false, hand: ['Island'] });
  });
});

describe('Coalition Relic and Bloodchief Ascension', () => {
  it('Coalition Relic: charge counters become mana of any colours at your precombat main phase', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Coalition Relic').counters = { charge: 2 };
      d.step = 'upkeep';
    });
    for (let i = 0; i < 20 && g.step !== 'main1'; i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
    g = settle(g);
    expect(g.step).toBe('main1');
    expect(g.players[0].pool).toHaveLength(2);
    expect(byName(g, 0, 'Coalition Relic')!.counters.charge).toBeUndefined();
  });

  it('Bloodchief Ascension: quest counters, then 2-life drains when cards hit an opponent\'s graveyard', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Bloodchief Ascension').counters = { quest: 3 };
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Mountain');
      put(d, 1, 'Walking Corpse');
    });
    g = settle(run(g, cast(g, 'Lightning Bolt', { targets: [card(byName(g, 1, 'Walking Corpse')!)] })));
    // The Corpse went to an opponent's graveyard: drain 2. The Bolt went to its owner's: nothing.
    expect(lifeOf(g)).toEqual([42, 38, 40, 40]);
  });
});

describe('Auras that trigger on damage', () => {
  const combat = (aura: string, creature = 'Walking Corpse') =>
    emptyGame((d) => {
      const c = put(d, 0, creature);
      put(d, 0, aura).attachedTo = c.id;
      top(d, 0, ['Plains', 'Plains', 'Plains']);
      top(d, 1, ['Plains', 'Plains', 'Plains']);
      put(d, 3, 'Plains', 'hand', 2);
      put(d, 1, 'Elite Vanguard');
    });
  const attack = (g: Game, target: PlayerId = 1) => {
    const attacker = g.players[0].battlefield.find((c) => c.name === 'Walking Corpse' || c.name === 'Serra Angel')!;
    for (let i = 0; i < 10 && g.decision?.type !== 'attackers'; i++) g = applyAction(g, pass);
    g = run(g, { type: 'declareAttack', card: attacker.id, defender: target }, pass);
    for (let i = 0; i < 40 && g.step !== 'main2'; i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
    return g;
  };

  it('Curiosity draws when the enchanted creature deals damage to an opponent', () => {
    let g = combat('Curiosity');
    g = attack(g, 3);
    expect(g.players[0].hand).toHaveLength(1);
  });

  it('Helm of the Ghastlord: a black creature gets +1/+1 and makes the player discard', () => {
    let g = combat('Helm of the Ghastlord');
    const corpse = byName(g, 0, 'Walking Corpse')!;
    expect(stats(g, corpse)).toMatchObject({ power: 3, toughness: 3 });
    g = attack(g, 3);
    expect(g.players[3].life).toBe(37);
    expect(g.players[3].hand).toHaveLength(1);
    // Not blue: no card drawn.
    expect(g.players[0].hand).toHaveLength(0);
  });

  it('Sigil of Sleep returns a creature the damaged player controls to its owner\'s hand', () => {
    let g = combat('Sigil of Sleep', 'Serra Angel');
    g = attack(g, 1);
    expect(g.players[1].life).toBe(36);
    expect(byName(g, 1, 'Elite Vanguard', 'hand')).toBeDefined();
  });
});

describe('Circle of Power', () => {
  it('draws two, loses 2, makes a pinging Wizard, and Wizards get +1/+0 and lifelink', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Circle of Power', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 4);
      put(d, 0, 'Emet-Selch of the Third Seat');
      top(d, 0, ['Plains', 'Plains', 'Plains']);
    });
    g = settle(run(g, cast(g, 'Circle of Power')));
    expect(g.players[0].life).toBe(38);
    expect(g.players[0].hand).toHaveLength(2);
    const wizard = byName(g, 0, 'Wizard 0/1 ping')!;
    expect(stats(g, wizard)).toMatchObject({ power: 1, toughness: 1 });
    expect(has(g, wizard, 'lifelink')).toBe(true);
    expect(stats(g, byName(g, 0, 'Emet-Selch of the Third Seat')!).power).toBe(4);
  });
});

describe('more Aura and token checks', () => {
  it('Helm of the Ghastlord on a blue and black creature gives +2/+2 and both abilities', () => {
    const g = emptyGame((d) => {
      const emet = put(d, 0, 'Emet-Selch of the Third Seat');
      put(d, 0, 'Helm of the Ghastlord').attachedTo = emet.id;
    });
    expect(stats(g, byName(g, 0, 'Emet-Selch of the Third Seat')!)).toMatchObject({ power: 5, toughness: 6 });
  });

  it('Ophidian Eye has flash: it can be cast on an opponent\'s turn', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Ophidian Eye', 'hand');
      put(d, 0, 'Island', 'battlefield', 3);
      put(d, 0, 'Walking Corpse');
      d.active = 1;
      d.priority = 0;
    });
    g = settle(run(g, cast(g, 'Ophidian Eye', { targets: [card(byName(g, 0, 'Walking Corpse')!)] })));
    expect(byName(g, 0, 'Ophidian Eye')!.attachedTo).toBe(byName(g, 0, 'Walking Corpse')!.id);
  });

  it('Sejiri Shelter gives protection from the colour chosen as it resolves', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Sejiri Shelter', 'hand');
      put(d, 0, 'Plains', 'battlefield', 2);
      put(d, 0, 'Serra Angel');
    });
    g = untilAsked(run(g, cast(g, 'Sejiri Shelter', { targets: [card(byName(g, 0, 'Serra Angel')!)] })));
    g = settle(run(g, { type: 'name', name: 'B' }));
    expect(has(g, byName(g, 0, 'Serra Angel')!, 'protection from black')).toBe(true);
  });

  it('the land faces of the modal double-faced cards enter tapped', () => {
    for (const [name, sym] of [
      ['Malakir Rebirth', 'B'],
      ['Sejiri Shelter', 'W'],
      ['Silundi Vision', 'U'],
      ['Waterlogged Teachings', 'U'],
    ] as const) {
      let g = emptyGame((d) => {
        put(d, 0, name, 'hand');
      });
      g = run(g, { type: 'playLand', card: byName(g, 0, name, 'hand')!.id, face: 1 });
      const land = byName(g, 0, name)!;
      expect(land.tapped).toBe(true);
      expect(data(land).oracleText).toContain(`{${sym}}`);
    }
  });
});
