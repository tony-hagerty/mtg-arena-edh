// EDHREC's most-played cards and commanders, triggers-combat group: the clauses that could go
// wrong, with the card data from tests/fixtures.generated.json.
import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { applyAction, applyBotAction, attach, botAction, canCast, createToken, destroy, destroyMany, draw, has, hasType, label, makeCard, stats, untilEndOfTurn } from '../src/engine';
import type { Action, Game, PlayerId, TargetRef } from '../src/engine';
import { registerCards } from '../src/cards/db';
import { registerScripts } from '../src/engine/registry';
import { problemsOf } from '../src/cards/support';
import { useStore } from '../src/ui/store';
import { buildView, clickPermanent, pickAbilityMode } from '../src/ui/view';
import { byName, emptyGame, put, run } from './helpers';
import './fixtures';

const CARDS = ['Annie Joins Up', 'Isshin, Two Heavens as One', 'Teysa Karlov', 'Felothar the Steadfast', 'Arcades, the Strategist', 'Kutzil, Malamet Exemplar', 'Lathril, Blade of the Elves', 'Cloud, Ex-SOLDIER', "Caesar, Legion's Emperor", 'Breya, Etherium Shaper', 'Zurgo Stormrender', 'Korvold, Fae-Cursed King'];

const pass = { type: 'pass' } as const;
const player = (id: PlayerId): TargetRef => ({ kind: 'player', id });
const card = (c: { id: string }): TargetRef => ({ kind: 'card', id: c.id });
const cast = (g: Game, name: string, extra: object = {}, pid: PlayerId = 0): Action => ({ type: 'cast', card: byName(g, pid, name, 'hand')!.id, ...extra });
const lifeOf = (g: Game) => g.players.map((p) => p.life);
/** A player's permanents named `name` (a token's name, not its key). */
const named = (g: Game, pid: PlayerId, name: string) => g.players[pid].battlefield.filter((c) => label(c) === name);
const plenty = Array.from({ length: 12 }, () => 'Plains');

/** Replaces a player's library with these cards, the first on top. */
function top(g: Game, pid: PlayerId, names: string[]) {
  g.players[pid].library = names.map((n) => makeCard(g, n, pid, 'library'));
}

/** Player 0 is a person, so their choices wait for an answer. */
function human(d: Game) {
  d.players[0].isBot = false;
  d.players[0].you = true;
}

/** Puts a game at the declare-attackers decision, player 0 attacking. */
function attacking(d: Game) {
  d.step = 'attackers';
  d.combat = { attacks: [], toBlock: [], struckFirst: null, moreDamage: false };
  d.decision = { type: 'attackers' };
}

/** Passes priority, bots (and a bot answering for the person) deciding everything, until `stop`. */
function until(g: Game, stop: (g: Game) => boolean): Game {
  for (let i = 0; i < 400 && !stop(g); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  return g;
}

/** Passes priority (bots answering anything asked) until the stack is empty, or `human` answers for player 0. */
function settle(g: Game, human?: (g: Game) => Action | null): Game {
  for (let i = 0; i < 120 && (g.decision || g.stack.length || g.triggers.length); i++) {
    const mine = human && g.priority === 0 && g.decision ? human(g) : null;
    g = mine ? run(g, mine) : g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  }
  return g;
}

/** Passes until a decision for player 0 comes up, or nothing is left to do. */
function untilAsked(g: Game): Game {
  for (let i = 0; i < 60 && !(g.decision && g.priority === 0) && (g.stack.length || g.triggers.length || g.decision); i++) {
    g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  }
  return g;
}

/** Through the combat phase to the second main phase, bots deciding everything. */
const throughCombat = (g: Game) => until(g, (x) => x.step === 'main2' && !x.stack.length && !x.triggers.length && !x.decision);
/** Through the rest of the turn to the next player's turn, bots deciding everything. */
const nextTurn = (g: Game) => until(g, (x) => x.turn === 2 && !x.stack.length && !x.triggers.length && !x.decision);

describe('the triggers-combat group is playable', () => {
  it('has a script for every card', () => {
    for (const name of CARDS) expect(problemsOf(name), name).toEqual([]);
  });
});

describe('Annie Joins Up', () => {
  it("doubles a legendary creature's triggered ability, not a nonlegendary creature's or its own (603.2d)", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Annie Joins Up');
      put(d, 0, 'Kokusho, the Evening Star');
      put(d, 0, 'Solemn Simulacrum');
      top(d, 0, plenty);
    });
    const hand = g.players[0].hand.length;
    g = settle(produce(g, (d) => void destroy(d, byName(d, 0, 'Kokusho, the Evening Star'))));
    // Kokusho's "when this dies" twice: each opponent loses 10, Annie's controller gains 30.
    expect(lifeOf(g)).toEqual([70, 30, 30, 30]);
    g = settle(produce(g, (d) => void destroy(d, byName(d, 0, 'Solemn Simulacrum'))));
    // Solemn Simulacrum isn't legendary: one card.
    expect(g.players[0].hand.length).toBe(hand + 1);
  });

  it('deals 5 damage to a creature or planeswalker an opponent controls as it enters, once (it is an enchantment)', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Annie Joins Up', 'hand');
      put(d, 0, 'Plains', 'battlefield', 2);
      put(d, 0, 'Mountain');
      put(d, 0, 'Forest');
      put(d, 1, 'Serra Angel');
      put(d, 0, 'Serra Angel');
    });
    g = untilAsked(run(g, cast(g, 'Annie Joins Up')));
    expect(g.decision?.type).toBe('targets');
    // Only an opponent's creature can be the target.
    expect(applyAction(g, { type: 'chooseTargets', targets: [card(byName(g, 0, 'Serra Angel')!)] })).toBe(g);
    g = untilAsked(run(g, { type: 'chooseTargets', targets: [card(byName(g, 1, 'Serra Angel')!)] }));
    // Once: Annie isn't a creature, so no second target is asked for.
    expect(g.decision).toBeNull();
    g = settle(g);
    expect(byName(g, 1, 'Serra Angel')).toBeUndefined();
    expect(byName(g, 1, 'Serra Angel', 'graveyard')).toBeDefined();
    expect(byName(g, 0, 'Serra Angel')).toBeDefined();
  });
});

describe('Isshin, Two Heavens as One', () => {
  it('a creature attacking makes "whenever this attacks" trigger twice, but not "whenever this becomes tapped"', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Isshin, Two Heavens as One');
      put(d, 0, 'Zurgo Stormrender');
      put(d, 0, 'Emmara, Soul of the Accord');
      attacking(d);
    });
    const hand = g.players[0].hand.length;
    g = run(g, { type: 'declareAttack', card: byName(g, 0, 'Zurgo Stormrender')!.id, defender: 1 }, { type: 'declareAttack', card: byName(g, 0, 'Emmara, Soul of the Accord')!.id, defender: 1 }, pass);
    g = throughCombat(g);
    // Mobilize 1 twice: two Warriors, tapped and attacking (the bot sends them at player 1). Emmara tapping is another event: one Soldier.
    expect(named(g, 0, 'Warrior')).toHaveLength(2);
    expect(named(g, 0, 'Soldier')).toHaveLength(1);
    expect(g.players[1].life).toBe(40 - 3 - 2 - 2);
    // At the end step both Warriors are sacrificed, not attacking: Zurgo's ability twice, each opponent losing 1 life each time.
    g = nextTurn(g);
    expect(named(g, 0, 'Warrior')).toHaveLength(0);
    expect(lifeOf(g)).toEqual([40, 31, 38, 38]);
    expect(g.players[0].hand.length).toBe(hand);
  });

  it("doesn't double an opponent's attack triggers or an enters trigger", () => {
    let g = emptyGame((d) => {
      put(d, 1, 'Isshin, Two Heavens as One').tapped = true; // so it can't block
      put(d, 0, 'Zurgo Stormrender');
      put(d, 0, 'Elvish Visionary', 'hand');
      put(d, 0, 'Forest', 'battlefield', 2);
      top(d, 0, plenty);
    });
    const hand = g.players[0].hand.length - 1;
    g = settle(run(g, cast(g, 'Elvish Visionary')));
    expect(g.players[0].hand.length).toBe(hand + 1);
    g = produce(g, (d) => attacking(d));
    g = run(g, { type: 'declareAttack', card: byName(g, 0, 'Zurgo Stormrender')!.id, defender: 1 }, pass);
    g = throughCombat(g);
    expect(named(g, 0, 'Warrior')).toHaveLength(1);
    expect(g.players[1].life).toBe(36);
  });
});

describe('Teysa Karlov', () => {
  it('a creature dying makes "when this dies", "whenever a creature dies" and "whenever you sacrifice" trigger twice; a land dying does not (700.4)', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Teysa Karlov');
      put(d, 0, 'Kokusho, the Evening Star');
      put(d, 0, 'Judith, the Scourge Diva');
      put(d, 0, 'Plains');
      put(d, 0, 'Korvold, Fae-Cursed King', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 2);
      put(d, 0, 'Mountain');
      put(d, 0, 'Forest', 'battlefield', 2);
      top(d, 0, plenty);
    });
    const hand = g.players[0].hand.length - 1;
    g = untilAsked(run(g, cast(g, 'Korvold, Fae-Cursed King')));
    // Korvold's "sacrifice another permanent": Kokusho.
    expect(g.decision?.type).toBe('chooseCards');
    g = run(g, { type: 'chooseCards', cards: [byName(g, 0, 'Kokusho, the Evening Star')!.id] });
    // Judith's ability twice: each asks for a target (player 1).
    g = settle(g, (x) => (x.decision?.type === 'targets' ? { type: 'chooseTargets', targets: [player(1)] } : null));
    const korvold = byName(g, 0, 'Korvold, Fae-Cursed King')!;
    // Kokusho twice (each opponent loses 10, you gain 30), Judith twice (2 to player 1). Korvold's
    // "whenever you sacrifice a permanent" triggers on the sacrifice, which caused the death, not
    // on the dying: once (one counter, one card), as Teysa's rulings say.
    expect(lifeOf(g)).toEqual([70, 28, 30, 30]);
    expect(korvold.counters['+1/+1']).toBe(1);
    expect(g.players[0].hand.length).toBe(hand + 1);
    // Korvold attacks and sacrifices the Plains: a land dying isn't a creature dying, so once.
    g = produce(g, (d) => {
      byName(d, 0, 'Korvold, Fae-Cursed King')!.sick = false;
      attacking(d);
    });
    g = untilAsked(run(g, { type: 'declareAttack', card: korvold.id, defender: 1 }, pass));
    expect(g.decision?.type).toBe('chooseCards');
    g = settle(run(g, { type: 'chooseCards', cards: [byName(g, 0, 'Plains')!.id] }));
    expect(byName(g, 0, 'Korvold, Fae-Cursed King')!.counters['+1/+1']).toBe(2);
    expect(g.players[0].hand.length).toBe(hand + 2);
  });

  it('an artifact creature dying doubles "whenever an artifact is put into a graveyard from the battlefield"; a noncreature artifact does not', () => {
    // A made-up card with that ability, which reads the permanent as it last was (603.10a).
    registerCards({ 'Test Scrapyard': { name: 'Test Scrapyard', manaCost: '{1}', cmc: 1, colors: [], colorIdentity: [], typeLine: 'Artifact', oracleText: 'Whenever an artifact is put into a graveyard from the battlefield, draw a card.', keywords: [], image: '', art: '' } });
    registerScripts({ 'Test Scrapyard': { onCardToGraveyard: { when: (g, { from }) => !!from && hasType(g, from, 'Artifact'), resolve: (g, { you }) => draw(g, you) } } });
    let g = emptyGame((d) => {
      put(d, 0, 'Teysa Karlov');
      put(d, 0, 'Test Scrapyard');
      put(d, 0, 'Solemn Simulacrum');
      put(d, 0, 'Sol Ring');
      top(d, 0, plenty);
    });
    const hand = g.players[0].hand.length;
    // Solemn Simulacrum: the Scrapyard twice and its own "may draw" twice (the bot says yes).
    g = settle(produce(g, (d) => void destroy(d, byName(d, 0, 'Solemn Simulacrum'))));
    expect(g.players[0].hand.length).toBe(hand + 4);
    // Sol Ring isn't a creature: once.
    g = settle(produce(g, (d) => void destroy(d, byName(d, 0, 'Sol Ring'))));
    expect(g.players[0].hand.length).toBe(hand + 5);
  });

  it('a creature leaving the battlefield by dying doubles "leaves the battlefield" abilities, and a land made a creature counts (603.10a)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Teysa Karlov');
      put(d, 0, 'Zurgo Stormrender');
      put(d, 0, 'Judith, the Scourge Diva');
      createToken(d, 0, 'Soldier');
      untilEndOfTurn(d, put(d, 0, 'Plains'), { types: ['Creature'], setPower: 1, setToughness: 1 });
    });
    // The Soldier token dies: Zurgo's "whenever a creature token you control leaves the battlefield" twice.
    g = settle(produce(g, (d) => void destroy(d, named(d, 0, 'Soldier')[0])));
    expect(lifeOf(g)).toEqual([40, 38, 38, 38]);
    // The animated Plains dies: Judith's "whenever a nontoken creature you control dies" twice (2 damage in all).
    g = settle(produce(g, (d) => void destroy(d, byName(d, 0, 'Plains'))));
    expect(g.players.slice(1).reduce((n, p) => n + 38 - p.life, 0)).toBe(2);
  });

  it('two Teysas make a creature dying trigger three times, and Teysa dying alongside still counts (603.10a)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Teysa Karlov', 'battlefield', 2);
      put(d, 0, 'Kokusho, the Evening Star');
    });
    g = settle(produce(g, (d) => void destroy(d, byName(d, 0, 'Kokusho, the Evening Star'))));
    expect(lifeOf(g)).toEqual([85, 25, 25, 25]);
    let h = emptyGame((d) => {
      put(d, 0, 'Teysa Karlov');
      put(d, 0, 'Kokusho, the Evening Star');
    });
    h = settle(produce(h, (d) => destroyMany(d, [byName(d, 0, 'Teysa Karlov')!, byName(d, 0, 'Kokusho, the Evening Star')!])));
    expect(lifeOf(h)).toEqual([70, 30, 30, 30]);
  });

  it('creature tokens you control have vigilance and lifelink; other creatures do not', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Teysa Karlov');
      put(d, 0, 'Walking Corpse');
      createToken(d, 0, 'Soldier');
      createToken(d, 1, 'Soldier');
    });
    const mine = named(g, 0, 'Soldier')[0];
    expect(has(g, mine, 'vigilance') && has(g, mine, 'lifelink')).toBe(true);
    expect(has(g, byName(g, 0, 'Walking Corpse')!, 'lifelink')).toBe(false);
    expect(has(g, g.players[1].battlefield[0], 'lifelink')).toBe(false);
  });
});

describe('Felothar the Steadfast', () => {
  it('your creatures assign combat damage equal to their toughness, and ones with defender can attack (510.1a)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Felothar the Steadfast');
      put(d, 0, 'Angelic Wall');
      attacking(d);
    });
    const felothar = byName(g, 0, 'Felothar the Steadfast')!;
    const wall = byName(g, 0, 'Angelic Wall')!;
    g = run(g, { type: 'declareAttack', card: felothar.id, defender: 1 }, { type: 'declareAttack', card: wall.id, defender: 2 }, pass);
    g = throughCombat(g);
    // Felothar 0/5 deals 5, the Wall 0/4 deals 4.
    expect(lifeOf(g)).toEqual([40, 35, 36, 40]);
    // An opponent's Wall still can't attack.
    g = produce(g, (d) => {
      d.active = 1;
      d.priority = 1;
      put(d, 1, 'Angelic Wall');
      attacking(d);
    });
    expect(applyAction(g, { type: 'declareAttack', card: byName(g, 1, 'Angelic Wall')!.id, defender: 0 })).toBe(g);
  });

  it('{3}, {T}, sacrifice another creature: draw its toughness, then discard its power (608.2h)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Felothar the Steadfast');
      put(d, 0, 'Serra Angel');
      put(d, 0, 'Plains', 'battlefield', 3);
      top(d, 0, plenty);
    });
    const felothar = byName(g, 0, 'Felothar the Steadfast')!;
    // Felothar can't sacrifice itself: "another creature".
    expect(applyAction(g, { type: 'activate', card: felothar.id, sacrifice: [felothar.id] })).toBe(g);
    g = settle(run(g, { type: 'activate', card: felothar.id, sacrifice: [byName(g, 0, 'Serra Angel')!.id] }));
    // Four drawn, four discarded: the library is four shorter and the graveyard holds the Angel and four cards.
    expect(g.players[0].library).toHaveLength(plenty.length - 4);
    expect(g.players[0].graveyard).toHaveLength(5);
    expect(g.players[0].hand).toHaveLength(0);
  });
});

describe('Arcades, the Strategist', () => {
  it('draws when a creature with defender enters under your control, and only those creatures deal toughness damage and may attack', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Arcades, the Strategist');
      put(d, 0, 'Angelic Wall', 'hand');
      put(d, 0, 'Elite Vanguard', 'hand');
      put(d, 0, 'Plains', 'battlefield', 4);
      put(d, 1, 'Angelic Wall', 'hand');
      put(d, 1, 'Plains', 'battlefield', 2);
      top(d, 0, plenty);
    });
    const hand = g.players[0].hand.length;
    g = settle(run(g, cast(g, 'Angelic Wall')));
    expect(g.players[0].hand.length).toBe(hand); // one cast, one drawn
    g = settle(run(g, cast(g, 'Elite Vanguard')));
    expect(g.players[0].hand.length).toBe(hand - 1); // no defender, no card
    // An opponent's Wall entering draws nothing.
    g = produce(g, (d) => {
      d.active = 1;
      d.priority = 1;
    });
    g = settle(run(g, cast(g, 'Angelic Wall', {}, 1)));
    expect(g.players[0].hand.length).toBe(hand - 1);
    // The Wall attacks for 4; Elite Vanguard deals its power, 2.
    g = produce(g, (d) => {
      d.active = 0;
      d.priority = 0;
      for (const c of d.players[0].battlefield) c.sick = false;
      for (const c of d.players[1].battlefield) c.tapped = true; // the opponent's Wall can't block
      attacking(d);
    });
    g = run(g, { type: 'declareAttack', card: byName(g, 0, 'Angelic Wall')!.id, defender: 1 }, { type: 'declareAttack', card: byName(g, 0, 'Elite Vanguard')!.id, defender: 2 }, pass);
    g = throughCombat(g);
    expect(lifeOf(g)).toEqual([40, 36, 38, 40]);
  });
});

describe('Kutzil, Malamet Exemplar', () => {
  it("opponents can't cast spells during your turn", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kutzil, Malamet Exemplar');
      put(d, 1, 'Lightning Bolt', 'hand');
      put(d, 1, 'Mountain');
    });
    expect(canCast(g, 1, byName(g, 1, 'Lightning Bolt', 'hand')!)).toBe(false);
    g = produce(g, (d) => {
      d.active = 1;
      d.priority = 1;
    });
    expect(canCast(g, 1, byName(g, 1, 'Lightning Bolt', 'hand')!)).toBe(true);
  });

  it('draws once when creatures with power above their base power deal combat damage to a player (603.2c)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kutzil, Malamet Exemplar');
      const a = put(d, 0, 'Walking Corpse');
      a.counters['+1/+1'] = 1;
      const b = put(d, 0, 'Elite Vanguard');
      b.counters['+1/+1'] = 1;
      put(d, 0, 'Serra Angel');
      top(d, 0, plenty);
      attacking(d);
    });
    const hand = g.players[0].hand.length;
    const ids = ['Walking Corpse', 'Elite Vanguard', 'Serra Angel'].map((n) => byName(g, 0, n)!.id);
    // Two pumped creatures hit player 1 (one card), the unpumped Angel hits player 2 (no card).
    g = run(g, { type: 'declareAttack', card: ids[0], defender: 1 }, { type: 'declareAttack', card: ids[1], defender: 1 }, { type: 'declareAttack', card: ids[2], defender: 2 }, pass);
    g = throughCombat(g);
    expect(lifeOf(g)).toEqual([40, 34, 36, 40]);
    expect(g.players[0].hand.length).toBe(hand + 1);
  });
});

describe('Lathril, Blade of the Elves', () => {
  it('creates that many Elf Warriors on combat damage to a player', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Lathril, Blade of the Elves');
      attacking(d);
    });
    g = run(g, { type: 'declareAttack', card: byName(g, 0, 'Lathril, Blade of the Elves')!.id, defender: 1 }, pass);
    g = throughCombat(g);
    expect(g.players[1].life).toBe(38);
    const elves = named(g, 0, 'Elf Warrior');
    expect(elves).toHaveLength(2);
    expect(stats(g, elves[0]).power).toBe(1);
  });

  it('{T}, tap ten untapped Elves: each opponent loses 10 life and you gain 10; Lathril is not one of the ten (302.6 lets sick Elves pay)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Lathril, Blade of the Elves');
      createToken(d, 0, 'Elf Warrior 1/1 G', 10);
      put(d, 0, 'Llanowar Elves').tapped = true;
    });
    const lathril = byName(g, 0, 'Lathril, Blade of the Elves')!;
    const elves = named(g, 0, 'Elf Warrior').map((c) => c.id);
    expect(named(g, 0, 'Elf Warrior').every((c) => c.sick)).toBe(true);
    // Nine Elves, a tapped Elf, or Lathril itself among the ten: refused.
    expect(applyAction(g, { type: 'activate', card: lathril.id, crew: elves.slice(0, 9) })).toBe(g);
    expect(applyAction(g, { type: 'activate', card: lathril.id, crew: [...elves.slice(0, 9), byName(g, 0, 'Llanowar Elves')!.id] })).toBe(g);
    expect(applyAction(g, { type: 'activate', card: lathril.id, crew: [...elves.slice(0, 9), lathril.id] })).toBe(g);
    g = settle(run(g, { type: 'activate', card: lathril.id, crew: elves }));
    expect(lifeOf(g)).toEqual([50, 30, 30, 30]);
    expect(named(g, 0, 'Elf Warrior').every((c) => c.tapped)).toBe(true);
    expect(byName(g, 0, 'Lathril, Blade of the Elves')!.tapped).toBe(true);
  });
});

describe('Cloud, Ex-SOLDIER', () => {
  it('attaches up to one Equipment you control as it enters', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Cloud, Ex-SOLDIER', 'hand');
      put(d, 0, 'Bonesplitter');
      put(d, 1, 'Bonesplitter');
      put(d, 0, 'Plains', 'battlefield', 3);
      put(d, 0, 'Mountain');
      put(d, 0, 'Forest');
    });
    g = untilAsked(run(g, cast(g, 'Cloud, Ex-SOLDIER')));
    expect(g.decision?.type).toBe('targets');
    expect(applyAction(g, { type: 'chooseTargets', targets: [card(byName(g, 1, 'Bonesplitter')!)] })).toBe(g);
    g = settle(run(g, { type: 'chooseTargets', targets: [card(byName(g, 0, 'Bonesplitter')!)] }));
    const cloud = byName(g, 0, 'Cloud, Ex-SOLDIER')!;
    expect(byName(g, 0, 'Bonesplitter')!.attachedTo).toBe(cloud.id);
    expect(stats(g, cloud).power).toBe(6);
  });

  it('draws a card for each equipped attacking creature, then two Treasures if its power is 7 or more', () => {
    let g = emptyGame((d) => {
      const cloud = put(d, 0, 'Cloud, Ex-SOLDIER');
      const corpse = put(d, 0, 'Walking Corpse');
      put(d, 0, 'Serra Angel');
      attach(d, put(d, 0, 'Bonesplitter'), cloud);
      attach(d, put(d, 0, 'Loxodon Warhammer'), corpse);
      top(d, 0, plenty);
      attacking(d);
    });
    const hand = g.players[0].hand.length;
    const ids = ['Cloud, Ex-SOLDIER', 'Walking Corpse', 'Serra Angel'].map((n) => byName(g, 0, n)!.id);
    g = run(g, { type: 'declareAttack', card: ids[0], defender: 1 }, { type: 'declareAttack', card: ids[1], defender: 1 }, { type: 'declareAttack', card: ids[2], defender: 1 }, pass);
    g = throughCombat(g);
    // Cloud and the Corpse are equipped: two cards. Cloud's power is 6: no Treasure.
    expect(g.players[0].hand.length).toBe(hand + 2);
    expect(named(g, 0, 'Treasure')).toHaveLength(0);
    expect(g.players[1].life).toBe(40 - 6 - 5 - 4);
    // With both Equipment on Cloud it has power 9: two Treasures.
    let h = emptyGame((d) => {
      const cloud = put(d, 0, 'Cloud, Ex-SOLDIER');
      attach(d, put(d, 0, 'Bonesplitter'), cloud);
      attach(d, put(d, 0, 'Loxodon Warhammer'), cloud);
      top(d, 0, plenty);
      attacking(d);
    });
    h = run(h, { type: 'declareAttack', card: byName(h, 0, 'Cloud, Ex-SOLDIER')!.id, defender: 1 }, pass);
    h = throughCombat(h);
    expect(named(h, 0, 'Treasure')).toHaveLength(2);
  });
});

describe("Caesar, Legion's Emperor", () => {
  const setup = () =>
    emptyGame((d) => {
      human(d);
      put(d, 0, "Caesar, Legion's Emperor");
      put(d, 0, 'Walking Corpse');
      top(d, 0, plenty);
      attacking(d);
    });

  it('whenever you attack, you may sacrifice another creature; when you do, choose two: tokens attacking a player of your choice and damage (603.12, 508.4)', () => {
    let g = setup();
    g = untilAsked(run(g, { type: 'declareAttack', card: byName(g, 0, "Caesar, Legion's Emperor")!.id, defender: 1 }, pass));
    expect(g.decision?.type).toBe('chooseCards');
    // Caesar itself isn't offered: "another creature".
    expect(applyAction(g, { type: 'chooseCards', cards: [byName(g, 0, "Caesar, Legion's Emperor")!.id] })).toBe(g);
    g = untilAsked(run(g, { type: 'chooseCards', cards: [byName(g, 0, 'Walking Corpse')!.id] }));
    expect(byName(g, 0, 'Walking Corpse', 'graveyard')).toBeDefined();
    // The reflexive ability's modes are chosen as it goes on the stack (603.3c): exactly two.
    expect(g.decision?.type).toBe('triggerModes');
    expect(applyAction(g, { type: 'chooseModes', modes: [0] })).toBe(g);
    expect(applyAction(g, { type: 'chooseModes', modes: [0, 1, 2] })).toBe(g);
    g = untilAsked(run(g, { type: 'chooseModes', modes: [0, 2] }));
    expect(g.decision?.type).toBe('targets');
    g = untilAsked(run(g, { type: 'chooseTargets', targets: [player(1)] }));
    // The Soldiers are created tapped and attacking; every opponent is a defending player (802.2), so you choose whom.
    expect(g.decision?.type).toBe('player');
    const soldiers = named(g, 0, 'Soldier');
    expect(soldiers).toHaveLength(2);
    expect(soldiers.every((s) => s.tapped && has(g, s, 'haste'))).toBe(true);
    g = untilAsked(run(g, { type: 'choosePlayer', player: 2 }));
    expect(g.log.some((l) => l.text === `Soldier, Soldier are attacking ${g.players[2].name}.`)).toBe(true);
    g = throughCombat(g);
    // Caesar dealt 2 (the two new Soldiers) and then 4 to player 1; a Soldier's 1 each to player 2.
    expect(lifeOf(g)).toEqual([40, 34, 38, 40]);
  });

  it('sacrificing nothing means no reflexive ability; drawing a card loses 1 life', () => {
    let g = setup();
    const hand = g.players[0].hand.length;
    g = untilAsked(run(g, { type: 'declareAttack', card: byName(g, 0, "Caesar, Legion's Emperor")!.id, defender: 1 }, pass));
    expect(g.decision?.type).toBe('chooseCards');
    g = untilAsked(run(g, { type: 'chooseCards', cards: [] }));
    expect(g.decision).toBeNull();
    expect(g.stack).toHaveLength(0);
    expect(byName(g, 0, 'Walking Corpse')).toBeDefined();
    // Another combat: sacrifice, then draw and tokens.
    let h = setup();
    h = untilAsked(run(h, { type: 'declareAttack', card: byName(h, 0, "Caesar, Legion's Emperor")!.id, defender: 1 }, pass));
    h = untilAsked(run(h, { type: 'chooseCards', cards: [byName(h, 0, 'Walking Corpse')!.id] }));
    h = untilAsked(run(h, { type: 'chooseModes', modes: [0, 1] }));
    expect(h.decision?.type).toBe('player');
    h = untilAsked(run(h, { type: 'choosePlayer', player: 1 }));
    expect(h.players[0].hand.length).toBe(hand + 1);
    expect(h.players[0].life).toBe(39);
  });

  it('bots sacrifice a creature token and take the tokens and the damage', () => {
    let g = emptyGame((d) => {
      put(d, 0, "Caesar, Legion's Emperor");
      put(d, 0, 'Serra Angel');
      createToken(d, 0, 'Soldier');
      top(d, 0, plenty);
      attacking(d);
    });
    g = run(g, { type: 'declareAttack', card: byName(g, 0, "Caesar, Legion's Emperor")!.id, defender: 1 }, pass);
    g = throughCombat(g);
    // The Soldier token went, the Angel stayed, two new hasty Soldiers came in attacking.
    expect(byName(g, 0, 'Serra Angel')).toBeDefined();
    expect(named(g, 0, 'Soldier')).toHaveLength(2);
    expect(named(g, 0, 'Soldier').every((c) => has(g, c, 'haste'))).toBe(true);
    // Caesar's ability dealt 2, Caesar 4 and the Soldiers 1 each.
    expect(g.players.slice(1).reduce((n, p) => n + 40 - p.life, 0)).toBe(2 + 4 + 2);
  });
});

describe('Breya, Etherium Shaper', () => {
  it('enters with two Thopters, and its modal ability is chosen as it is activated (700.2a)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Breya, Etherium Shaper', 'hand');
      put(d, 0, 'Plains');
      put(d, 0, 'Island');
      put(d, 0, 'Swamp');
      put(d, 0, 'Mountain');
      put(d, 0, 'Sol Ring');
      put(d, 1, 'Serra Angel');
    });
    g = settle(run(g, cast(g, 'Breya, Etherium Shaper')));
    const thopters = named(g, 0, 'Thopter');
    expect(thopters).toHaveLength(2);
    expect(has(g, thopters[0], 'flying')).toBe(true);
    const breya = byName(g, 0, 'Breya, Etherium Shaper')!;
    g = produce(g, (d) => {
      for (const c of d.players[0].battlefield) c.tapped = false;
    });
    const sac = thopters.map((t) => t.id);
    // Exactly one mode, and its own targets: no mode, two modes, or a mode without its target is refused.
    expect(applyAction(g, { type: 'activate', card: breya.id, sacrifice: sac })).toBe(g);
    expect(applyAction(g, { type: 'activate', card: breya.id, sacrifice: sac, modes: [0, 2] })).toBe(g);
    expect(applyAction(g, { type: 'activate', card: breya.id, sacrifice: sac, modes: [0] })).toBe(g);
    // One artifact isn't enough: "sacrifice two artifacts".
    expect(applyAction(g, { type: 'activate', card: breya.id, sacrifice: [sac[0]], modes: [2] })).toBe(g);
    g = settle(run(g, { type: 'activate', card: breya.id, sacrifice: sac, modes: [2] }));
    expect(g.players[0].life).toBe(45);
    expect(named(g, 0, 'Thopter')).toHaveLength(0);
    // Breya itself is an artifact: it and the Sol Ring pay for 3 damage to a player.
    g = produce(g, (d) => {
      for (const c of d.players[0].battlefield) c.tapped = false;
    });
    g = settle(run(g, { type: 'activate', card: breya.id, sacrifice: [breya.id, byName(g, 0, 'Sol Ring')!.id], modes: [0], targets: [player(1)] }));
    expect(g.players[1].life).toBe(37);
    expect(byName(g, 0, 'Breya, Etherium Shaper')).toBeUndefined();
  });

  it('-4/-4 until end of turn on a target creature', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Breya, Etherium Shaper');
      createToken(d, 0, 'Thopter 1/1 flying U artifact', 2);
      put(d, 0, 'Plains', 'battlefield', 2);
      put(d, 1, 'Serra Angel');
    });
    const sac = named(g, 0, 'Thopter').map((c) => c.id);
    g = settle(run(g, { type: 'activate', card: byName(g, 0, 'Breya, Etherium Shaper')!.id, sacrifice: sac, modes: [1], targets: [card(byName(g, 1, 'Serra Angel')!)] }));
    expect(byName(g, 1, 'Serra Angel')).toBeUndefined();
  });

  it('a bot finds the mode that wins: 3 damage to an opponent at 3 life', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Breya, Etherium Shaper');
      createToken(d, 0, 'Thopter 1/1 flying U artifact', 2);
      put(d, 0, 'Plains', 'battlefield', 2);
      d.players[1].life = 3;
    });
    g = settle(applyBotAction(g, botAction(g, 0)));
    expect(g.players[1].lost).toBe(true);
    expect(byName(g, 0, 'Breya, Etherium Shaper')).toBeDefined(); // the Thopters paid, not Breya
  });
});

describe('Zurgo Stormrender', () => {
  it('mobilize 1: a tapped and attacking Warrior, sacrificed at the next end step, when each opponent loses 1 life', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Zurgo Stormrender');
      top(d, 0, plenty);
      attacking(d);
    });
    const hand = g.players[0].hand.length;
    g = run(g, { type: 'declareAttack', card: byName(g, 0, 'Zurgo Stormrender')!.id, defender: 1 }, pass);
    g = throughCombat(g);
    const warrior = named(g, 0, 'Warrior')[0];
    expect(warrior.tapped).toBe(true);
    // A bot sent it at the opponent with the least life (all equal: the first): Zurgo's 3 and the Warrior's 1.
    expect(g.log.some((l) => l.text === 'Warrior is attacking Mortis.')).toBe(true);
    expect(g.players[1].life).toBe(36);
    g = nextTurn(g);
    // The Warrior wasn't attacking as it was sacrificed at the end step: each opponent loses 1 life, no card.
    expect(named(g, 0, 'Warrior')).toHaveLength(0);
    expect(lifeOf(g)).toEqual([40, 35, 39, 39]);
    expect(g.players[0].hand.length).toBe(hand);
  });

  it('a creature token leaving while attacking draws a card instead', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Zurgo Stormrender');
      createToken(d, 0, 'Soldier')[0].sick = false;
      put(d, 1, 'Angelic Wall'); // a possible blocker, so the game waits for player 1 in the declare blockers step
      top(d, 0, plenty);
      attacking(d);
    });
    const hand = g.players[0].hand.length;
    const soldier = named(g, 0, 'Soldier')[0];
    g = run(g, { type: 'declareAttack', card: soldier.id, defender: 1 }, pass);
    expect(g.step).toBe('blockers');
    expect(g.combat!.attacks.some((a) => a.id === soldier.id)).toBe(true);
    g = settle(produce(g, (d) => void destroy(d, named(d, 0, 'Soldier')[0])));
    expect(g.players[0].hand.length).toBe(hand + 1);
    expect(lifeOf(g)).toEqual([40, 40, 40, 40]);
    // A nontoken creature leaving does nothing.
    g = settle(produce(g, (d) => void destroy(d, byName(d, 0, 'Zurgo Stormrender'))));
    expect(g.players[0].hand.length).toBe(hand + 1);
  });
});

describe('Voice of Victory', () => {
  it("mobilize's Warriors attack whom their controller chooses (508.4)", () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Voice of Victory');
      attacking(d);
    });
    g = untilAsked(run(g, { type: 'declareAttack', card: byName(g, 0, 'Voice of Victory')!.id, defender: 1 }, pass));
    expect(g.decision?.type).toBe('player');
    expect(named(g, 0, 'Warrior')).toHaveLength(2);
    g = throughCombat(run(g, { type: 'choosePlayer', player: 3 }));
    // Voice's 1 to player 1, the Warriors' 1 each to player 3.
    expect(lifeOf(g)).toEqual([40, 39, 40, 38]);
  });
});

describe('Korvold, Fae-Cursed King', () => {
  it('sacrifices another permanent as it enters and as it attacks; each sacrifice puts a counter on it and draws', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Korvold, Fae-Cursed King', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 2);
      put(d, 0, 'Mountain');
      put(d, 0, 'Forest', 'battlefield', 2);
      put(d, 0, 'Walking Corpse');
      top(d, 0, plenty);
    });
    const hand = g.players[0].hand.length - 1;
    g = untilAsked(run(g, cast(g, 'Korvold, Fae-Cursed King')));
    expect(g.decision?.type).toBe('chooseCards');
    // Korvold can't be chosen: "another permanent".
    expect(applyAction(g, { type: 'chooseCards', cards: [byName(g, 0, 'Korvold, Fae-Cursed King')!.id] })).toBe(g);
    g = settle(run(g, { type: 'chooseCards', cards: [byName(g, 0, 'Walking Corpse')!.id] }));
    expect(byName(g, 0, 'Walking Corpse')).toBeUndefined();
    expect(byName(g, 0, 'Korvold, Fae-Cursed King')!.counters['+1/+1']).toBe(1);
    expect(g.players[0].hand.length).toBe(hand + 1);
    // Sacrificing with nothing else to give still draws: Korvold itself sacrificed draws, with no counter anywhere.
    g = settle(produce(g, (d) => void destroy(d, byName(d, 0, 'Swamp'))));
    expect(g.players[0].hand.length).toBe(hand + 1); // destroyed, not sacrificed
  });
});

describe('the triggers-combat group in the UI', () => {
  function play(setup: (g: Game) => void) {
    const g = produce(emptyGame(setup), (d) => human(d));
    useStore.setState({ game: g, human: 0, humans: [0], handoff: null, targeting: null, pickedBlockers: [], undoSteps: [], manaPick: null });
  }
  const game = () => useStore.getState().game!;
  const press = () => buildView().primary!.onClick();

  it("chooses a modal ability's mode in the prompt, then the sacrifice, then pays (700.2a)", () => {
    play((d) => {
      put(d, 0, 'Breya, Etherium Shaper');
      createToken(d, 0, 'Thopter 1/1 flying U artifact', 2);
      put(d, 0, 'Plains', 'battlefield', 2);
    });
    clickPermanent(byName(game(), 0, 'Breya, Etherium Shaper')!);
    let v = buildView();
    expect(v.abilityModes?.modes.map((m) => [m.text.slice(0, 5), m.ok, m.picked])).toEqual([
      ['Breya', true, false],
      ['Targe', true, false],
      ['You g', true, false],
    ]);
    expect(v.primary?.disabled).toBe(true);
    pickAbilityMode(0);
    pickAbilityMode(2); // choose one: replaces the first pick
    v = buildView();
    expect(v.abilityModes?.modes.map((m) => m.picked)).toEqual([false, false, true]);
    press(); // Continue: no targets for that mode, so the sacrifices come next
    expect(buildView().prompt).toContain('an artifact');
    const thopters = named(game(), 0, 'Thopter');
    clickPermanent(thopters[0]);
    clickPermanent(thopters[1]);
    expect(buildView().prompt).toContain('Pay');
    press(); // Pay {2}; the bots pass and it resolves
    expect(game().players[0].life).toBe(45);
  });

  it('picks the ten Elves to tap by clicking them, then the ability goes on the stack', () => {
    play((d) => {
      put(d, 0, 'Lathril, Blade of the Elves');
      createToken(d, 0, 'Elf Warrior 1/1 G', 11);
    });
    clickPermanent(byName(game(), 0, 'Lathril, Blade of the Elves')!);
    let v = buildView();
    expect(v.prompt).toContain('Tap ten untapped Elves you control (0 of 10 chosen)');
    expect(v.primary?.disabled).toBe(true);
    const elves = named(game(), 0, 'Elf Warrior');
    expect(v.glow.get(elves[0].id)).toBe('target');
    for (const e of elves.slice(0, 10)) clickPermanent(e);
    clickPermanent(elves[0]); // a second click takes it back out
    expect(buildView().prompt).toContain('(9 of 10 chosen)');
    clickPermanent(elves[10]);
    v = buildView();
    expect(v.prompt).toContain('(10 of 10 chosen)');
    expect(v.primary?.disabled).toBe(false);
    press(); // Tap: costs no mana, so it goes on the stack and resolves
    expect(game().players.map((p) => p.life)).toEqual([50, 30, 30, 30]);
    expect(named(game(), 0, 'Elf Warrior').filter((c) => !c.tapped)).toHaveLength(1);
  });
});
