// The counters group of EDHREC's most-played cards and commanders, and the rules they needed:
// proliferate (701.34), blight (701.68) and Ward—Blight, counters on players (122.1) with rad
// counters (728) and poison (704.5c), moving a counter (122.5), decayed (702.147), and the
// clauses of each card that could go wrong.
import { describe, expect, it } from 'vitest';
import { applyAction, applyBotAction, botAction, choiceOptions, counterCount, makeCard, playerCounters, stats, addCounters, canBlock, permanent } from '../src/engine';
import type { Action, CardChoice, Game, PlayerId, TargetRef } from '../src/engine';
import { problemsOf } from '../src/cards/support';
import { byName, emptyGame, put, run } from './helpers';
import './fixtures';

const pass = { type: 'pass' } as const;
const card = (c: { id: string }): TargetRef => ({ kind: 'card', id: c.id });

const CARDS = [
  "Atraxa, Praetors' Voice",
  'Kilo, Apogee Mind',
  "Tidus, Yuna's Guardian",
  'High Perfect Morcant',
  'Auntie Ool, Cursewretch',
  'The Wise Mothman',
  'Meren of Clan Nel Toth',
  'Hope Estheim',
  "Betor, Ancestor's Voice",
  'Giada, Font of Hope',
  'Wilhelt, the Rotcleaver',
];

/** A game where player 0 is a person, so their choices wait for an answer. */
const humanGame = (setup: (g: Game) => void) =>
  emptyGame((d) => {
    d.players[0].isBot = false;
    d.players[0].you = true;
    setup(d);
  });

/**
 * Plays on, bots answering everything, until `done` holds. `human` answers player 0's
 * decisions when it returns an action.
 */
function playUntil(g: Game, done: (g: Game) => boolean, human?: (g: Game) => Action | null): Game {
  for (let i = 0; i < 300 && !done(g); i++) {
    const mine = human && g.decision && g.priority === 0 ? human(g) : null;
    g = mine ? run(g, mine) : g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  }
  return g;
}

/** Passes until the stack and choices are done with (bots answering). */
const settle = (g: Game, human?: (g: Game) => Action | null) => playUntil(g, (x) => !x.decision && !x.stack.length && !x.triggers.length, human);

/** Plays on until a decision for player 0 comes up, or the turn moves past `step`. */
const untilAsked = (g: Game) => playUntil(g, (x) => !!x.decision && x.priority === 0);

/** From main phase 2, plays through player 0's end step. */
const throughEndStep = (g: Game, human?: (g: Game) => Action | null) => playUntil(g, (x) => x.step === 'cleanup' || x.active !== 0 || x.turn > 1, human);

const pickChoice = (g: Game) => (g.decision as { choice: Extract<CardChoice, { kind: 'pick' }> }).choice;

/** Replaces a player's library with these cards, the first on top. */
function library(g: Game, pid: PlayerId, names: string[]) {
  g.players[pid].library = names.map((n) => makeCard(g, n, pid, 'library'));
}

describe('the counters group is playable', () => {
  it.each(CARDS)('%s has no problems', (name) => {
    expect(problemsOf(name)).toEqual([]);
  });
});

describe('proliferate (701.34a)', () => {
  const setup = () =>
    humanGame((d) => {
      put(d, 0, "Atraxa, Praetors' Voice");
      const mine = put(d, 0, 'Llanowar Elves');
      mine.counters = { '+1/+1': 2, charge: 1 };
      const theirs = put(d, 1, 'Walking Corpse');
      theirs.counters = { '-1/-1': 1 };
      put(d, 1, 'Elvish Mystic').counters = { '+1/+1': 1 };
      d.players[1].counters = { poison: 3 };
      d.players[2].counters = { rad: 1 };
      d.step = 'main2';
    });

  it('chooses any permanents and players with counters, and gives each another of each kind', () => {
    let g = setup();
    g = untilAsked(g);
    const choice = pickChoice(g);
    expect(choice.then).toBe('@proliferate');
    // Only things with counters are offered (701.34a).
    expect(choice.cards.length).toBe(3);
    expect(choice.players).toEqual([1, 2]);
    expect(choiceOptions(g, choice).min).toBe(0);
    const elves = byName(g, 0, 'Llanowar Elves')!;
    const corpse = byName(g, 1, 'Walking Corpse')!;
    g = run(g, { type: 'chooseCards', cards: [elves.id, corpse.id], players: [1] });
    g = settle(g);
    expect(byName(g, 0, 'Llanowar Elves')!.counters).toEqual({ '+1/+1': 3, charge: 2 });
    // The -1/-1 counter killed nothing yet: a 2/2 with two of them dies (704.5f).
    expect(byName(g, 1, 'Walking Corpse')).toBeUndefined();
    expect(byName(g, 1, 'Elvish Mystic')!.counters['+1/+1']).toBe(1);
    expect(playerCounters(g.players[1], 'poison')).toBe(4);
    expect(playerCounters(g.players[2], 'rad')).toBe(1);
  });

  it('refuses a player without counters, or one chosen twice', () => {
    let g = untilAsked(setup());
    expect(applyAction(g, { type: 'chooseCards', cards: [], players: [3] })).toBe(g);
    expect(applyAction(g, { type: 'chooseCards', cards: [], players: [1, 1] })).toBe(g);
    g = run(g, { type: 'chooseCards', cards: [] });
    expect(g.decision?.type).not.toBe('chooseCards');
  });

  it('asks nothing when nothing has a counter', () => {
    let g = humanGame((d) => {
      put(d, 0, "Atraxa, Praetors' Voice");
      d.step = 'main2';
    });
    g = throughEndStep(g, () => {
      throw new Error('asked');
    });
    expect(g.log.some((l) => /proliferates?: nothing has a counter/.test(l.text))).toBe(true);
  });

  it("a bot gives its own good counters and its opponents' bad ones another", () => {
    let g = emptyGame((d) => {
      put(d, 0, "Atraxa, Praetors' Voice");
      put(d, 0, 'Llanowar Elves').counters = { '+1/+1': 1 };
      put(d, 1, 'Elvish Mystic').counters = { '+1/+1': 1 };
      put(d, 1, 'Serra Angel').counters = { '-1/-1': 1 };
      d.players[0].counters = { rad: 2 };
      d.players[1].counters = { poison: 2 };
      d.step = 'main2';
    });
    g = throughEndStep(g);
    expect(byName(g, 0, 'Llanowar Elves')!.counters['+1/+1']).toBe(2);
    expect(byName(g, 1, 'Elvish Mystic')!.counters['+1/+1']).toBe(1);
    expect(byName(g, 1, 'Serra Angel')!.counters['-1/-1']).toBe(2);
    expect(playerCounters(g.players[0], 'rad')).toBe(2);
    expect(playerCounters(g.players[1], 'poison')).toBe(3);
  });

  it("only on Atraxa's controller's end step", () => {
    let g = emptyGame((d) => {
      put(d, 1, "Atraxa, Praetors' Voice");
      put(d, 1, 'Llanowar Elves').counters = { '+1/+1': 1 };
      d.step = 'main2';
    });
    g = throughEndStep(g);
    expect(byName(g, 1, 'Llanowar Elves')!.counters['+1/+1']).toBe(1);
  });
});

describe('poison counters (704.5c)', () => {
  it('a player with ten or more loses the game', () => {
    let g = emptyGame((d) => {
      d.players[1].counters = { poison: 9 };
      put(d, 0, "Atraxa, Praetors' Voice");
      d.step = 'main2';
    });
    g = throughEndStep(g);
    expect(g.players[1].lost).toBe(true);
    expect(g.log.some((l) => /10 poison counters/.test(l.text))).toBe(true);
  });
});

describe('Kilo, Apogee Mind', () => {
  it('proliferates whenever it becomes tapped (attacking)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kilo, Apogee Mind').counters = { '+1/+1': 1 };
      d.step = 'beginCombat';
      d.combat = { attacks: [], toBlock: [], struckFirst: null, moreDamage: false };
    });
    g = playUntil(g, (x) => x.step === 'attackers' && x.decision?.type === 'attackers');
    const kilo = byName(g, 0, 'Kilo, Apogee Mind')!;
    g = run(g, { type: 'declareAttack', card: kilo.id, defender: 1 }, pass);
    g = settle(g);
    expect(byName(g, 0, 'Kilo, Apogee Mind')!.counters['+1/+1']).toBe(2);
  });
});

describe('blight (701.68)', () => {
  it('High Perfect Morcant: each opponent with a creature blights 1 as it enters, choosing in turn order', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'High Perfect Morcant', 'hand');
      put(d, 0, 'Forest', 'battlefield', 2);
      put(d, 0, 'Swamp', 'battlefield', 2);
      put(d, 1, 'Serra Angel');
      put(d, 1, 'Llanowar Elves');
      put(d, 2, 'Walking Corpse');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'High Perfect Morcant', 'hand')!.id });
    g = settle(g);
    // Player 1 blights one of its creatures, the one its bot loses least by; player 3 has none (701.68b).
    const ones = (pid: PlayerId) => g.players[pid].battlefield.reduce((n, c) => n + (c.counters['-1/-1'] ?? 0), 0) + g.players[pid].graveyard.length;
    expect(ones(1)).toBe(1);
    expect(byName(g, 2, 'Walking Corpse')!.counters['-1/-1']).toBe(1);
    expect(g.players[0].battlefield.every((c) => !c.counters['-1/-1'])).toBe(true);
    expect(stats(g, byName(g, 2, 'Walking Corpse')!).power).toBe(1);
  });

  it('triggers for another Elf you control, not a non-Elf or an opponent’s Elf', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'High Perfect Morcant');
      put(d, 0, 'Llanowar Elves', 'hand');
      put(d, 0, 'Walking Corpse', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 2);
      put(d, 0, 'Forest');
      put(d, 1, 'Serra Angel');
      put(d, 1, 'Elvish Mystic', 'hand');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Walking Corpse', 'hand')!.id });
    g = settle(g);
    expect(byName(g, 1, 'Serra Angel')!.counters['-1/-1'] ?? 0).toBe(0);
    g = run(g, { type: 'cast', card: byName(g, 0, 'Llanowar Elves', 'hand')!.id });
    g = settle(g);
    expect(byName(g, 1, 'Serra Angel')!.counters['-1/-1']).toBe(1);
  });

  it('taps three untapped Elves, summoning sick ones and Morcant included, to proliferate as a sorcery', () => {
    let g = humanGame((d) => {
      const m = put(d, 0, 'High Perfect Morcant');
      m.sick = true;
      put(d, 0, 'Llanowar Elves').sick = true;
      put(d, 0, 'Elvish Mystic');
      put(d, 1, 'Serra Angel').counters = { '-1/-1': 1 };
    });
    const ids = g.players[0].battlefield.map((c) => c.id);
    const morcant = byName(g, 0, 'High Perfect Morcant')!;
    // Exactly three.
    expect(applyAction(g, { type: 'activate', card: morcant.id, crew: ids.slice(0, 2) })).toBe(g);
    g = run(g, { type: 'activate', card: morcant.id, crew: ids });
    expect(g.players[0].battlefield.every((c) => c.tapped)).toBe(true);
    g = untilAsked(g);
    g = run(g, { type: 'chooseCards', cards: [byName(g, 1, 'Serra Angel')!.id] });
    g = settle(g);
    expect(byName(g, 1, 'Serra Angel')!.counters['-1/-1']).toBe(2);
  });

  it("can't be activated without three untapped Elves, or outside a main phase", () => {
    const g = emptyGame((d) => {
      put(d, 0, 'High Perfect Morcant');
      put(d, 0, 'Llanowar Elves').tapped = true;
      put(d, 0, 'Elvish Mystic');
    });
    const ids = g.players[0].battlefield.map((c) => c.id);
    expect(applyAction(g, { type: 'activate', card: ids[0], crew: ids })).toBe(g);
    const combat = emptyGame((d) => {
      put(d, 0, 'High Perfect Morcant');
      put(d, 0, 'Llanowar Elves');
      put(d, 0, 'Elvish Mystic');
      d.step = 'beginCombat';
    });
    const all = combat.players[0].battlefield.map((c) => c.id);
    expect(applyAction(combat, { type: 'activate', card: all[0], crew: all })).toBe(combat);
  });
});

describe('Auntie Ool, Cursewretch', () => {
  /** Player 1 casts Lightning Bolt at Auntie Ool; player 1 is the person paying ward. */
  const bolted = (creatures: string[]) => {
    let g = emptyGame((d) => {
      d.players[1].isBot = false;
      put(d, 0, 'Auntie Ool, Cursewretch');
      put(d, 1, 'Lightning Bolt', 'hand');
      put(d, 1, 'Mountain');
      for (const n of creatures) put(d, 1, n);
      d.priority = 1;
    });
    g = run(g, { type: 'cast', card: byName(g, 1, 'Lightning Bolt', 'hand')!.id, targets: [card(byName(g, 0, 'Auntie Ool, Cursewretch')!)] });
    return playUntil(g, (x) => (!!x.decision && x.priority === 1) || !x.stack.length);
  };

  it('Ward—Blight 2: paying puts two -1/-1 counters on a creature its controller chooses, and the spell resolves', () => {
    let g = bolted(['Serra Angel']);
    const choice = pickChoice(g);
    expect(choice.then).toBe('@wardBlight');
    expect(choiceOptions(g, choice).min).toBe(0);
    g = run(g, { type: 'chooseCards', cards: [byName(g, 1, 'Serra Angel')!.id] });
    g = settle(g);
    expect(byName(g, 1, 'Serra Angel')!.counters['-1/-1']).toBe(2);
    expect(byName(g, 0, 'Auntie Ool, Cursewretch')!.damage).toBe(3);
  });

  it('Ward—Blight 2: choosing none counters the spell', () => {
    let g = bolted(['Serra Angel']);
    g = run(g, { type: 'chooseCards', cards: [] });
    g = settle(g);
    expect(byName(g, 0, 'Auntie Ool, Cursewretch')!.damage).toBe(0);
    expect(byName(g, 1, 'Lightning Bolt', 'graveyard')).toBeDefined();
  });

  it("Ward—Blight 2: a player with no creature can't pay (701.68b)", () => {
    const g = settle(bolted([]));
    expect(byName(g, 0, 'Auntie Ool, Cursewretch')!.damage).toBe(0);
  });

  it("draws for -1/-1 counters on its controller's creature, and costs another player 1 life for theirs", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Auntie Ool, Cursewretch');
      const mine = put(d, 0, 'Serra Angel');
      const theirs = put(d, 2, 'Serra Angel');
      library(d, 0, ['Plains', 'Plains']);
      addCounters(d, mine, 1, '-1/-1');
      addCounters(d, theirs, 2, '-1/-1');
      // +1/+1 counters don't count.
      addCounters(d, theirs, 1, '+1/+1');
    });
    expect(g.triggers.length).toBe(2);
    g = settle(g);
    expect(g.players[0].hand.length).toBe(1);
    expect(g.players[2].life).toBe(39);
  });
});

describe('rad counters (728.1)', () => {
  it('The Wise Mothman gives each player a rad counter as it enters', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'The Wise Mothman', 'hand');
      put(d, 0, 'Island', 'battlefield', 2);
      put(d, 0, 'Swamp');
      put(d, 0, 'Forest');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'The Wise Mothman', 'hand')!.id });
    g = settle(g);
    expect(g.players.map((p) => playerCounters(p, 'rad'))).toEqual([1, 1, 1, 1]);
  });

  it('at the beginning of its precombat main phase a player mills one card for each, loses 1 life and a rad counter for each nonland card', () => {
    let g = emptyGame((d) => {
      d.players[1].counters = { rad: 3 };
      library(d, 1, ['Serra Angel', 'Plains', 'Shock', 'Plains', 'Plains']);
      d.active = 1;
      d.priority = 1;
      d.step = 'upkeep';
    });
    g = playUntil(g, (x) => x.step === 'main1' && !x.stack.length && !x.triggers.length && x.log.some((l) => /removes/.test(l.text)));
    const p = g.players[1];
    // It drew the Serra Angel in its draw step, then milled Plains, Shock, Plains.
    expect(p.graveyard.map((c) => c.name)).toEqual(['Plains', 'Shock', 'Plains']);
    expect(p.life).toBe(39);
    expect(playerCounters(p, 'rad')).toBe(2);
  });

  it("doesn't trigger without rad counters, or for a player whose turn it isn't", () => {
    let g = emptyGame((d) => {
      d.players[2].counters = { rad: 2 };
      library(d, 2, ['Shock', 'Shock']);
      d.step = 'upkeep';
    });
    g = playUntil(g, (x) => x.step === 'beginCombat');
    expect(g.players[2].graveyard.length).toBe(0);
  });
});

describe('The Wise Mothman', () => {
  it('puts a +1/+1 counter on each of up to X target creatures, X the nonland cards milled in one event', () => {
    let g = humanGame((d) => {
      put(d, 0, 'The Wise Mothman');
      put(d, 0, 'Llanowar Elves');
      put(d, 0, 'Serra Angel');
      put(d, 0, 'Walking Corpse');
      put(d, 0, 'Hope Estheim');
      d.players[0].lifeGained = 1;
      library(d, 1, ['Shock']);
      library(d, 2, ['Plains']);
      library(d, 3, ['Shock']);
      d.step = 'main2';
    });
    g = untilAsked(g);
    // One event for every opponent's mill (101.4): one trigger, X = 2.
    expect(g.decision?.type).toBe('targets');
    const ids = ['Llanowar Elves', 'Serra Angel', 'Walking Corpse'].map((n) => byName(g, 0, n)!.id);
    expect(applyAction(g, { type: 'chooseTargets', targets: ids.map((id) => ({ kind: 'card', id })) })).toBe(g);
    g = run(g, { type: 'chooseTargets', targets: ids.slice(0, 2).map((id) => ({ kind: 'card', id })) });
    g = settle(g);
    expect(counterCount(byName(g, 0, 'Llanowar Elves')!)).toBe(1);
    expect(counterCount(byName(g, 0, 'Serra Angel')!)).toBe(1);
    expect(counterCount(byName(g, 0, 'Walking Corpse')!)).toBe(0);
  });

  it("doesn't trigger when only lands are milled", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'The Wise Mothman');
      put(d, 0, 'Hope Estheim');
      d.players[0].lifeGained = 2;
      for (const pid of [1, 2, 3]) library(d, pid, ['Plains', 'Plains', 'Plains', 'Plains', 'Plains']);
      d.step = 'main2';
    });
    g = throughEndStep(g);
    expect(g.players[1].graveyard.length).toBe(2);
    expect(g.log.some((l) => /Mothman triggers/.test(l.text))).toBe(false);
  });
});

describe('Hope Estheim', () => {
  it('each opponent mills X at its end step, X the life gained this turn; none for none', () => {
    const run2 = (gained: number) => {
      let g = emptyGame((d) => {
        put(d, 0, 'Hope Estheim');
        d.players[0].lifeGained = gained;
        for (const pid of [1, 2, 3]) library(d, pid, ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains']);
        d.step = 'main2';
      });
      g = throughEndStep(g);
      return g.players.map((p) => p.graveyard.length);
    };
    expect(run2(3)).toEqual([0, 3, 3, 3]);
    expect(run2(0)).toEqual([0, 0, 0, 0]);
  });
});

describe('Meren of Clan Nel Toth', () => {
  it('gets an experience counter when another creature you control dies, not an opponent’s', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Meren of Clan Nel Toth');
      put(d, 0, 'Walking Corpse');
      put(d, 1, 'Walking Corpse');
      put(d, 0, 'Lightning Bolt', 'hand', 2);
      put(d, 0, 'Mountain', 'battlefield', 2);
    });
    const bolts = g.players[0].hand.map((c) => c.id);
    g = run(g, { type: 'cast', card: bolts[0], targets: [card(byName(g, 0, 'Walking Corpse')!)] });
    g = settle(g);
    g = run(g, { type: 'cast', card: bolts[1], targets: [card(byName(g, 1, 'Walking Corpse')!)] });
    g = settle(g);
    expect(playerCounters(g.players[0], 'experience')).toBe(1);
  });

  it('returns the creature card to the battlefield if its mana value is at most the experience counters, else to the hand', () => {
    const endStep = (experience: number) => {
      let g = emptyGame((d) => {
        put(d, 0, 'Meren of Clan Nel Toth');
        put(d, 0, 'Serra Angel', 'graveyard');
        d.players[0].counters = { experience };
        d.step = 'main2';
      });
      g = throughEndStep(g);
      return byName(g, 0, 'Serra Angel', 'battlefield') ? 'battlefield' : byName(g, 0, 'Serra Angel', 'hand') ? 'hand' : 'graveyard';
    };
    expect(endStep(5)).toBe('battlefield');
    expect(endStep(4)).toBe('hand');
  });
});

describe("Betor, Ancestor's Voice", () => {
  it('puts counters equal to life gained on another creature and returns a card with mana value at most the life lost', () => {
    let g = humanGame((d) => {
      put(d, 0, "Betor, Ancestor's Voice");
      put(d, 0, 'Llanowar Elves');
      put(d, 0, 'Walking Corpse', 'graveyard');
      put(d, 0, 'Serra Angel', 'graveyard');
      d.players[0].lifeGained = 3;
      d.players[0].lifeLost = 2;
      d.step = 'main2';
    });
    g = untilAsked(g);
    expect(g.decision?.type).toBe('targets');
    const betor = byName(g, 0, "Betor, Ancestor's Voice")!;
    const angel = byName(g, 0, 'Serra Angel', 'graveyard')!;
    const corpse = byName(g, 0, 'Walking Corpse', 'graveyard')!;
    // "Other" (not Betor), and mana value 5 is more than 2 life lost.
    expect(applyAction(g, { type: 'chooseTargets', targets: [card(betor), card(corpse)] })).toBe(g);
    expect(applyAction(g, { type: 'chooseTargets', targets: [card(byName(g, 0, 'Llanowar Elves')!), card(angel)] })).toBe(g);
    g = run(g, { type: 'chooseTargets', targets: [card(byName(g, 0, 'Llanowar Elves')!), card(corpse)] });
    g = settle(g);
    expect(counterCount(byName(g, 0, 'Llanowar Elves')!)).toBe(3);
    expect(byName(g, 0, 'Walking Corpse')).toBeDefined();
  });
});

describe('Giada, Font of Hope', () => {
  it('each other Angel enters with a +1/+1 counter for each Angel already controlled; others do not', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Giada, Font of Hope');
      put(d, 0, 'Serra Angel');
      put(d, 0, 'Angel of Mercy', 'hand');
      put(d, 0, 'Walking Corpse', 'hand');
      put(d, 0, 'Plains', 'battlefield', 5);
      put(d, 0, 'Swamp', 'battlefield', 2);
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Angel of Mercy', 'hand')!.id });
    g = settle(g);
    expect(counterCount(byName(g, 0, 'Angel of Mercy')!)).toBe(2);
    g = run(g, { type: 'cast', card: byName(g, 0, 'Walking Corpse', 'hand')!.id });
    g = settle(g);
    expect(counterCount(byName(g, 0, 'Walking Corpse')!)).toBe(0);
  });

  it('its mana can be spent only on an Angel spell (106.6)', () => {
    const game = (lands: string[]) =>
      emptyGame((d) => {
        put(d, 0, 'Giada, Font of Hope');
        put(d, 0, 'Walking Corpse', 'hand');
        put(d, 0, 'Angel of Mercy', 'hand');
        for (const n of lands) put(d, 0, n);
      });
    // Walking Corpse costs {1}{B}: a Swamp and Giada's {W} can't pay it.
    const g = game(['Swamp']);
    expect(applyAction(g, { type: 'cast', card: byName(g, 0, 'Walking Corpse', 'hand')!.id })).toBe(g);
    // Angel of Mercy costs {4}{W}: four Plains and Giada.
    const h = game(['Plains', 'Plains', 'Plains', 'Plains']);
    const after = run(h, { type: 'cast', card: byName(h, 0, 'Angel of Mercy', 'hand')!.id });
    expect(byName(after, 0, 'Giada, Font of Hope')!.tapped).toBe(true);
  });
});

describe('decayed (702.147) and Wilhelt, the Rotcleaver', () => {
  it('another Zombie dying makes a decayed Zombie token; a decayed one dying makes none', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Wilhelt, the Rotcleaver');
      put(d, 0, 'Walking Corpse');
      put(d, 0, 'Lightning Bolt', 'hand', 2);
      put(d, 0, 'Mountain', 'battlefield', 2);
    });
    const bolts = g.players[0].hand.map((c) => c.id);
    g = run(g, { type: 'cast', card: bolts[0], targets: [card(byName(g, 0, 'Walking Corpse')!)] });
    g = settle(g);
    const token = g.players[0].battlefield.find((c) => c.isToken)!;
    expect(token.name).toBe('Zombie Decayed');
    expect(stats(g, token).keywords.has('decayed')).toBe(true);
    g = run(g, { type: 'cast', card: bolts[1], targets: [card(token)] });
    g = settle(g);
    expect(g.players[0].battlefield.filter((c) => c.isToken).length).toBe(0);
  });

  it("a decayed creature can't block, and is sacrificed at end of combat after it attacks", () => {
    let g = emptyGame((d) => {
      const z = put(d, 0, 'Zombie Decayed');
      z.isToken = true;
      put(d, 1, 'Walking Corpse');
      d.step = 'beginCombat';
      d.combat = { attacks: [], toBlock: [], struckFirst: null, moreDamage: false };
    });
    const z = g.players[0].battlefield[0];
    expect(canBlock(g, z, byName(g, 1, 'Walking Corpse')!)).toBe(false);
    g = playUntil(g, (x) => x.decision?.type === 'attackers');
    g = run(g, { type: 'declareAttack', card: z.id, defender: 2 }, pass);
    g = playUntil(g, (x) => x.step === 'main2');
    expect(permanent(g, z.id)).toBeUndefined();
    expect(g.players[2].life).toBe(38);
  });

  it('may sacrifice a Zombie at the end step to draw a card', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Wilhelt, the Rotcleaver');
      put(d, 0, 'Walking Corpse');
      library(d, 0, ['Plains', 'Plains']);
      d.step = 'main2';
    });
    g = untilAsked(g);
    const choice = pickChoice(g);
    expect(choiceOptions(g, choice).min).toBe(0);
    g = run(g, { type: 'chooseCards', cards: [byName(g, 0, 'Walking Corpse')!.id] });
    g = settle(g);
    expect(g.players[0].hand.length).toBe(1);
    // The Corpse was another Zombie: a decayed token for it.
    expect(g.players[0].battlefield.some((c) => c.isToken)).toBe(true);
  });
});

describe("Tidus, Yuna's Guardian", () => {
  const combatGame = (setup: (g: Game) => void) =>
    humanGame((d) => {
      put(d, 0, "Tidus, Yuna's Guardian");
      setup(d);
      d.step = 'main1';
    });
  const toCombat = (g: Game) => playUntil(g, (x) => (x.decision?.type === 'targets' && x.priority === 0) || x.step === 'attackers');

  it('may move a counter of the chosen kind from one creature you control onto another (122.5)', () => {
    let g = combatGame((d) => {
      put(d, 0, 'Llanowar Elves').counters = { '+1/+1': 2, charge: 1 };
      put(d, 0, 'Walking Corpse');
    });
    g = run(g, pass);
    g = toCombat(g);
    const elves = byName(g, 0, 'Llanowar Elves')!;
    const corpse = byName(g, 0, 'Walking Corpse')!;
    g = run(g, { type: 'chooseTargets', targets: [card(elves), card(corpse)] });
    g = untilAsked(g);
    expect(g.decision?.type).toBe('ask');
    g = run(g, { type: 'answer', yes: true });
    expect(g.decision?.type).toBe('name');
    expect(applyAction(g, { type: 'name', name: 'loyalty' })).toBe(g);
    g = run(g, { type: 'name', name: 'charge' });
    expect(byName(g, 0, 'Llanowar Elves')!.counters).toEqual({ '+1/+1': 2 });
    expect(byName(g, 0, 'Walking Corpse')!.counters).toEqual({ charge: 1 });
  });

  it('moves nothing onto the same creature, or when declined', () => {
    let g = combatGame((d) => {
      put(d, 0, 'Llanowar Elves').counters = { '+1/+1': 1 };
    });
    g = run(g, pass);
    g = toCombat(g);
    const elves = byName(g, 0, 'Llanowar Elves')!;
    g = run(g, { type: 'chooseTargets', targets: [card(elves), card(elves)] });
    g = playUntil(g, (x) => x.step === 'attackers');
    expect(byName(g, 0, 'Llanowar Elves')!.counters).toEqual({ '+1/+1': 1 });
  });

  it('Cheer: draws and proliferates once each turn when creatures with counters deal combat damage to players', () => {
    let g = combatGame((d) => {
      put(d, 0, 'Llanowar Elves').counters = { '+1/+1': 1 };
      put(d, 0, 'Elvish Mystic').counters = { '+1/+1': 1 };
      library(d, 0, ['Plains', 'Plains', 'Plains']);
      d.step = 'beginCombat';
      d.combat = { attacks: [], toBlock: [], struckFirst: null, moreDamage: false };
    });
    // Tidus's own combat trigger: no targets chosen that move anything.
    g = playUntil(g, (x) => (!!x.decision && x.priority === 0) || x.step === 'attackers', (x) => (x.decision?.type === 'targets' ? { type: 'chooseTargets', targets: [card(byName(x, 0, 'Llanowar Elves')!), card(byName(x, 0, 'Llanowar Elves')!)] } : null));
    g = playUntil(g, (x) => x.decision?.type === 'attackers');
    // Two attackers at two players: two triggers (603.2c), but only one draw and proliferate (603.2h).
    g = run(g, { type: 'declareAttack', card: byName(g, 0, 'Llanowar Elves')!.id, defender: 1 }, { type: 'declareAttack', card: byName(g, 0, 'Elvish Mystic')!.id, defender: 2 }, pass);
    let asks = 0;
    g = playUntil(
      g,
      (x) => x.step === 'main2',
      (x) => {
        if (x.decision?.type === 'ask') {
          asks++;
          return { type: 'answer', yes: true };
        }
        if (x.decision?.type === 'chooseCards') return { type: 'chooseCards', cards: [byName(x, 0, 'Llanowar Elves')!.id] };
        return null;
      },
    );
    expect(asks).toBe(1);
    expect(g.players[0].hand.length).toBe(1);
    expect(byName(g, 0, 'Llanowar Elves')!.counters['+1/+1']).toBe(2);
  });
});
