// EDHREC's most-played cards and commanders, tokens group: the hand scripts in
// src/cards/edhrec/tokens.ts, the parsed ones, and the rules they needed (an ability's
// resolutions this turn, emblems, "one or more tokens enter", "whenever a Dwarf becomes
// tapped", attack restrictions, "Sacrifice X"): the clauses that could go wrong.
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { cardData, registerCards } from '../src/cards/db';
import { scriptCards } from '../src/cards/oracle';
import { problemsOf } from '../src/cards/support';
import { applyAction, applyBotAction, botAction, createToken, destroy, enterBattlefield, has, makeCard, permanent, stats, tap } from '../src/engine';
import type { Action, Card, Game, PlayerId, TargetRef } from '../src/engine';
import { byName, emptyGame, put, run } from './helpers';
import './fixtures';

const PARSED = ['Ms. Bumbleflower', 'Omnath, Locus of Creation', "Go-Shintai of Life's Origin", 'Rin and Seri, Inseparable', 'Aragorn, the Uniter', 'Kenrith, the Returned King', 'Magda, Brazen Outlaw', 'Marneus Calgar'];
const HAND = ['Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel', 'Kefka, Court Mage // Kefka, Ruler of Ruin', 'Eriette of the Charmed Apple', 'Chatterfang, Squirrel General'];
// What a pasted deck's fetched cards go through: the parser scripts those without a hand script.
const refused = scriptCards([...PARSED, ...HAND, 'Doubling Season']);

const pass = { type: 'pass' } as const;
const player = (id: PlayerId): TargetRef => ({ kind: 'player', id });
const card = (c: { id: string }): TargetRef => ({ kind: 'card', id: c.id });
const cast = (g: Game, name: string, extra: object = {}, pid: PlayerId = 0): Action => ({ type: 'cast', card: byName(g, pid, name, 'hand')!.id, ...extra });

/** Passes priority (bots answering anything asked) until the stack is empty and nothing is being decided. */
function settle(g: Game, human?: (g: Game) => Action | null): Game {
  for (let i = 0; i < 120 && (g.decision || g.stack.length || g.triggers.length); i++) {
    const mine = human && g.decision ? human(g) : null;
    g = mine ? run(g, mine) : g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  }
  return g;
}

/** Passes until a decision for player 0 comes up, or the stack empties. */
function untilAsked(g: Game, pid: PlayerId = 0): Game {
  for (let i = 0; i < 60 && !(g.decision && g.priority === pid) && (g.stack.length || g.triggers.length || g.decision); i++) {
    g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  }
  return g;
}

/** A game with player 0 a person, so its choices wait for the test. */
const humanGame = (setup: (g: Game) => void) =>
  emptyGame((d) => {
    d.players[0].isBot = false;
    d.players[0].you = true;
    setup(d);
  });

/** Puts a card from nowhere onto the battlefield under `pid`'s control, as an effect would, and lets what it triggers resolve. */
const enter = (g: Game, pid: PlayerId, name: string) =>
  produce(g, (d) => {
    const c = makeCard(d, name, pid, 'hand');
    d.players[pid].hand.push(c);
    enterBattlefield(d, d.players[pid].hand[d.players[pid].hand.length - 1]);
  });

/** Destroys a permanent, as an effect would. */
const kill = (g: Game, c: Card) => produce(g, (d) => void destroy(d, permanent(d, c.id)));

/** Replaces a player's library with these cards, the first on top. */
function top(g: Game, pid: PlayerId, names: string[]) {
  g.players[pid].library = names.map((n) => makeCard(g, n, pid, 'library'));
}

describe('the tokens group can be played', () => {
  it('every card is scripted, by the parser or by hand', () => {
    expect(refused).toEqual([]);
    for (const name of [...PARSED, ...HAND]) expect(problemsOf(name)).toEqual([]);
  });

  it('an ability word or flavor word is a label, not a keyword the engine must know (207.2c, 207.2d)', () => {
    // "Master Tactician —", "Chapter Master —" (Marneus Calgar) and "Super Nova —" (Sephiroth) are flavor words.
    expect(cardData('Marneus Calgar').keywords).toContain('Master Tactician');
    expect(problemsOf('Marneus Calgar')).toEqual([]);
  });
});

describe('Ms. Bumbleflower', () => {
  /** Player 0 casts Sol Ring with Ms. Bumbleflower out; its trigger targets player 1 and `target`. */
  const castWithTrigger = (g: Game, target: Card) => {
    g = run(g, cast(g, 'Sol Ring'));
    expect(g.decision?.type).toBe('targets');
    return settle(run(g, { type: 'chooseTargets', targets: [player(1), card(target)] }));
  };

  it('opponent draws, a +1/+1 counter and flying, and the second resolution this turn draws you two (707.10b, 400.7)', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Ms. Bumbleflower');
      put(d, 0, 'Plains', 'battlefield', 3);
      put(d, 0, 'Sol Ring', 'hand');
      put(d, 0, 'Sol Ring', 'hand');
      put(d, 0, 'Sol Ring', 'hand');
    });
    const bee = byName(g, 0, 'Ms. Bumbleflower')!;
    const hands = () => [g.players[0].hand.length, g.players[1].hand.length];
    // First time: the opponent draws, the creature gets the counter and flying, you draw nothing.
    let [mine, theirs] = hands();
    g = castWithTrigger(g, bee);
    expect(hands()).toEqual([mine - 1, theirs + 1]);
    expect(permanent(g, bee.id)!.counters['+1/+1']).toBe(1);
    expect(has(g, permanent(g, bee.id)!, 'flying')).toBe(true);
    // Second time this turn: you draw two as well.
    [mine, theirs] = hands();
    g = castWithTrigger(g, bee);
    expect(hands()).toEqual([mine - 1 + 2, theirs + 1]);
    // Third time: no more.
    [mine, theirs] = hands();
    g = castWithTrigger(g, bee);
    expect(hands()).toEqual([mine - 1, theirs + 1]);
    expect(permanent(g, bee.id)!.counters['+1/+1']).toBe(3);
  });

  it('counts each turn afresh, and counts resolutions, not triggers', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Ms. Bumbleflower');
      put(d, 0, 'Plains', 'battlefield', 3);
      put(d, 0, 'Sol Ring', 'hand', 2);
    });
    const bee = byName(g, 0, 'Ms. Bumbleflower')!;
    g = castWithTrigger(g, bee);
    // A new turn: the next resolution is the first again.
    g = produce(g, (d) => void (d.turn += 4));
    const mine = g.players[0].hand.length;
    g = castWithTrigger(g, bee);
    expect(g.players[0].hand.length).toBe(mine - 1);
  });

  it('a new object is a new ability (400.7): its count starts over', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Ms. Bumbleflower');
      put(d, 0, 'Plains', 'battlefield', 3);
      put(d, 0, 'Sol Ring', 'hand', 2);
    });
    const bee = byName(g, 0, 'Ms. Bumbleflower')!;
    g = castWithTrigger(g, bee);
    // It leaves and comes back: another object, whose ability hasn't resolved this turn.
    g = produce(g, (d) => {
      const c = permanent(d, bee.id)!;
      d.players[0].battlefield = d.players[0].battlefield.filter((x) => x.id !== c.id);
      c.zone = 'hand';
      d.players[0].hand.push(c);
      enterBattlefield(d, d.players[0].hand[d.players[0].hand.length - 1]);
    });
    const mine = g.players[0].hand.length;
    g = castWithTrigger(g, permanent(g, bee.id)!);
    expect(g.players[0].hand.length).toBe(mine - 1);
  });
});

describe('Omnath, Locus of Creation', () => {
  it('draws as it enters; landfall gains 4, then adds {R}{G}{W}{U}, then deals 4 to each opponent and their planeswalkers', () => {
    let g = emptyGame((d) => {
      put(d, 1, 'Jace Beleren').counters.loyalty = 5;
      put(d, 0, 'Jace Beleren').counters.loyalty = 5;
    });
    const hand = g.players[0].hand.length;
    g = settle(enter(g, 0, 'Omnath, Locus of Creation'));
    expect(g.players[0].hand.length).toBe(hand + 1);
    // First landfall this turn.
    g = settle(enter(g, 0, 'Forest'));
    expect(g.players[0].life).toBe(44);
    // Second: the mana, which stays until the phase ends (500.5).
    g = settle(enter(g, 0, 'Forest'));
    expect(g.players[0].pool.map((m) => m.sym).sort()).toEqual(['G', 'R', 'U', 'W']);
    expect(g.players[0].life).toBe(44);
    // Third: 4 damage to each opponent and each planeswalker you don't control; yours is spared.
    g = settle(enter(g, 0, 'Forest'));
    expect(g.players.slice(1).map((p) => p.life)).toEqual([36, 36, 36]);
    expect(byName(g, 1, 'Jace Beleren')?.counters.loyalty ?? 0).toBeLessThanOrEqual(1);
    expect(byName(g, 0, 'Jace Beleren')!.counters.loyalty).toBe(5);
    // Fourth: nothing.
    g = settle(enter(g, 0, 'Forest'));
    expect(g.players.slice(1).map((p) => p.life)).toEqual([36, 36, 36]);
    expect(g.players[0].life).toBe(44);
    // An opponent's land isn't "a land you control".
    g = settle(enter(g, 1, 'Forest'));
    expect(g.players[0].life).toBe(44);
  });
});

const SEPHIROTH = 'Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel';
const KEFKA = 'Kefka, Court Mage // Kefka, Ruler of Ruin';

/** Puts a game at the declare-attackers decision, player `pid` attacking. */
function attacking(d: Game, pid: PlayerId = 0) {
  d.active = pid;
  d.priority = pid;
  d.step = 'attackers';
  d.combat = { attacks: [], toBlock: [], struckFirst: null, moreDamage: false } as unknown as Game['combat'];
  d.decision = { type: 'attackers' };
}

describe('Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel', () => {
  /** A creature dies; player 0 aims the drain at player 1. */
  const dies = (g: Game, c: Card) => {
    g = untilAsked(kill(g, c));
    if (g.decision?.type === 'targets') g = run(g, { type: 'chooseTargets', targets: [player(1)] });
    return settle(g);
  };

  it('as it enters, you may sacrifice another creature; if you do, draw a card', () => {
    const play = (sacrifice: boolean) => {
      let g = humanGame((d) => {
        put(d, 0, SEPHIROTH, 'hand');
        put(d, 0, 'Swamp', 'battlefield', 3);
        put(d, 0, 'Llanowar Elves');
      });
      const hand = g.players[0].hand.length;
      g = untilAsked(run(g, cast(g, SEPHIROTH)));
      expect(g.decision).toMatchObject({ type: 'chooseCards', choice: { min: 0, max: 1 } });
      // Only another creature: Sephiroth itself can't be chosen.
      expect((g.decision as { choice: { cards: string[] } }).choice.cards).toEqual([byName(g, 0, 'Llanowar Elves')!.id]);
      g = settle(run(g, { type: 'chooseCards', cards: sacrifice ? [byName(g, 0, 'Llanowar Elves')!.id] : [] }));
      return { elves: !!byName(g, 0, 'Llanowar Elves'), drew: g.players[0].hand.length - (hand - 1) };
    };
    expect(play(true)).toEqual({ elves: false, drew: 1 });
    expect(play(false)).toEqual({ elves: true, drew: 0 });
  });

  it('another creature dying drains 1; the fourth time this turn it transforms and you get the emblem (712.20, 114)', () => {
    let g = humanGame((d) => {
      put(d, 0, SEPHIROTH);
      put(d, 0, 'Elite Vanguard', 'battlefield', 2);
      put(d, 1, 'Elite Vanguard', 'battlefield', 3);
    });
    const seph = byName(g, 0, SEPHIROTH)!;
    const vanguards = [...g.players[0].battlefield, ...g.players[1].battlefield].filter((c) => c.name === 'Elite Vanguard');
    for (const [i, c] of vanguards.slice(0, 3).entries()) {
      g = dies(g, c);
      expect([g.players[0].life, g.players[1].life]).toEqual([40 + i + 1, 40 - i - 1]);
      expect(permanent(g, seph.id)!.face).toBe(0);
    }
    expect(g.players[0].emblems ?? []).toEqual([]);
    g = dies(g, vanguards[3]);
    const angel = permanent(g, seph.id)!;
    expect(angel.face).toBe(1);
    expect(stats(g, angel)).toMatchObject({ power: 5, toughness: 5 });
    expect(has(g, angel, 'flying')).toBe(true);
    expect(g.players[0].emblems?.map((e) => e.name)).toEqual(['Sephiroth, One-Winged Angel Emblem']);
    // The emblem drains on any creature dying, from the command zone (114.4), even Sephiroth's own death.
    g = dies(g, vanguards[4]);
    expect([g.players[0].life, g.players[1].life]).toEqual([45, 35]);
    g = dies(g, permanent(g, seph.id)!);
    expect([g.players[0].life, g.players[1].life]).toEqual([46, 34]);
  });

  it("doesn't trigger on its own death (\"another creature\")", () => {
    let g = humanGame((d) => void put(d, 0, SEPHIROTH));
    g = settle(kill(g, byName(g, 0, SEPHIROTH)!));
    expect(g.players[0].life).toBe(40);
  });

  it('One-Winged Angel attacks: sacrifice any number of other creatures, draw that many', () => {
    let g = humanGame((d) => {
      put(d, 0, SEPHIROTH).face = 1;
      put(d, 0, 'Elite Vanguard', 'battlefield', 3);
      attacking(d);
    });
    const hand = g.players[0].hand.length;
    g = run(g, { type: 'declareAttack', card: byName(g, 0, SEPHIROTH)!.id, defender: 1 }, pass);
    g = untilAsked(g);
    expect(g.decision).toMatchObject({ type: 'chooseCards', choice: { min: 0, max: 3 } });
    const two = g.players[0].battlefield.filter((c) => c.name === 'Elite Vanguard').slice(0, 2).map((c) => c.id);
    g = run(g, { type: 'chooseCards', cards: two });
    expect(g.players[0].battlefield.filter((c) => c.name === 'Elite Vanguard')).toHaveLength(1);
    expect(g.players[0].hand.length).toBe(hand + 2);
  });
});

describe('Kefka, Court Mage // Kefka, Ruler of Ruin', () => {
  it('each player discards a card, then you draw a card for each card type among them (205.2a)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Sol Ring', 'hand');
      put(d, 1, 'Lightning Bolt', 'hand');
      put(d, 2, 'Forest', 'hand');
      put(d, 3, 'Solemn Simulacrum', 'hand');
    });
    g = settle(enter(g, 0, KEFKA));
    // Artifact, instant, land, and the artifact creature adds creature: four types.
    expect(g.players.slice(1).map((p) => p.hand.length)).toEqual([0, 0, 0]);
    expect(g.players[0].hand).toHaveLength(4);
    expect(g.players.map((p) => p.graveyard.length)).toEqual([1, 1, 1, 1]);
  });

  it('picks go in APNAP order and the cards are discarded together, after the last pick (101.4)', () => {
    let g = emptyGame((d) => {
      d.players[3].isBot = false;
      for (const p of d.players) put(d, p.id, 'Forest', 'hand', 2);
    });
    g = untilAsked(enter(g, 0, KEFKA), 3);
    expect(g.decision).toMatchObject({ type: 'chooseCards' });
    // Everyone before player 3 has picked, and nothing is discarded yet.
    expect(g.players.map((p) => p.hand.length)).toEqual([2, 2, 2, 2]);
    g = settle(run(g, { type: 'chooseCards', cards: [g.players[3].hand[0].id] }));
    expect(g.players.map((p) => p.graveyard.length)).toEqual([1, 1, 1, 1]);
    // Only lands: one type, one card.
    expect(g.players[0].hand).toHaveLength(2);
  });

  it('{8}: each opponent sacrifices a permanent of their choice, then it transforms; only as a sorcery', () => {
    let g = emptyGame((d) => {
      put(d, 0, KEFKA);
      put(d, 0, 'Plains', 'battlefield', 8);
      put(d, 1, 'Elite Vanguard');
      put(d, 2, 'Serra Angel');
    });
    const kefka = byName(g, 0, KEFKA)!;
    g = settle(run(g, { type: 'activate', card: kefka.id }));
    expect(g.players[1].battlefield).toHaveLength(0);
    expect(g.players[2].battlefield).toHaveLength(0);
    const ruler = permanent(g, kefka.id)!;
    expect(ruler.face).toBe(1);
    expect(stats(g, ruler)).toMatchObject({ power: 5, toughness: 7 });
    expect(has(g, ruler, 'flying')).toBe(true);
    // Not while something is on the stack.
    let h = emptyGame((d) => {
      put(d, 0, KEFKA);
      put(d, 0, 'Plains', 'battlefield', 9);
      put(d, 0, 'Sol Ring', 'hand');
    });
    h = run(h, cast(h, 'Sol Ring', { hold: true }));
    expect(applyAction(h, { type: 'activate', card: byName(h, 0, KEFKA)!.id })).toBe(h);
  });

  it('Ruler of Ruin: an opponent losing life during your turn draws you that many; not on their turn', () => {
    let g = emptyGame((d) => {
      put(d, 0, KEFKA).face = 1;
      put(d, 0, 'Mountain');
      put(d, 0, 'Lightning Bolt', 'hand');
    });
    const hand = g.players[0].hand.length;
    g = settle(run(g, cast(g, 'Lightning Bolt', { targets: [player(1)] })));
    expect(g.players[1].life).toBe(37);
    expect(g.players[0].hand.length).toBe(hand - 1 + 3);
    // On player 1's turn, nothing.
    g = produce(g, (d) => {
      d.active = 1;
      d.priority = 1;
      put(d, 1, 'Mountain');
      put(d, 1, 'Lightning Bolt', 'hand');
    });
    const now = g.players[0].hand.length;
    g = settle(run(g, { type: 'cast', card: byName(g, 1, 'Lightning Bolt', 'hand')!.id, targets: [player(2)] }));
    expect(g.players[2].life).toBe(37);
    expect(g.players[0].hand.length).toBe(now);
  });
});

describe('Eriette of the Charmed Apple', () => {
  /** Player 1 declaring attackers, with a Vanguard enchanted by player 0's Holy Strength and an Angel by its own. */
  const setup = () =>
    emptyGame((d) => {
      put(d, 0, 'Eriette of the Charmed Apple');
      put(d, 0, 'Jace Beleren').counters.loyalty = 3;
      const mine = put(d, 1, 'Elite Vanguard');
      const theirs = put(d, 1, 'Serra Angel');
      put(d, 0, 'Holy Strength').attachedTo = mine.id;
      put(d, 1, 'Holy Strength').attachedTo = theirs.id;
      attacking(d, 1);
    });

  it("a creature enchanted by an Aura you control can't attack you or your planeswalkers (508.1c)", () => {
    const g = setup();
    const vanguard = byName(g, 1, 'Elite Vanguard')!;
    const angel = byName(g, 1, 'Serra Angel')!;
    const jace = byName(g, 0, 'Jace Beleren')!;
    expect(applyAction(g, { type: 'declareAttack', card: vanguard.id, defender: 0 })).toBe(g);
    expect(applyAction(g, { type: 'declareAttack', card: vanguard.id, defender: 0, target: jace.id })).toBe(g);
    // Another player, yes; and a creature enchanted only by its controller's Aura may attack you.
    expect(applyAction(g, { type: 'declareAttack', card: vanguard.id, defender: 2 })).not.toBe(g);
    expect(applyAction(g, { type: 'declareAttack', card: angel.id, defender: 0 })).not.toBe(g);
  });

  it("a bot doesn't send the enchanted creature at Eriette's controller", () => {
    let g = setup();
    const vanguard = byName(g, 1, 'Elite Vanguard')!.id;
    for (let i = 0; i < 6 && g.decision?.type === 'attackers'; i++) {
      const a = botAction(g, 1);
      if (a.type !== 'declareAttack') break;
      if (a.card === vanguard) expect(a.defender).not.toBe(0);
      g = run(g, a);
    }
  });

  it('at your end step, each opponent loses X and you gain X, X the Auras you control', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Eriette of the Charmed Apple');
      const v = put(d, 1, 'Elite Vanguard');
      put(d, 0, 'Holy Strength').attachedTo = v.id;
      put(d, 0, 'Holy Strength').attachedTo = v.id;
      d.step = 'main2';
    });
    for (let i = 0; i < 60 && g.step !== 'cleanup' && g.turn === 1; i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
    expect(g.players.map((p) => p.life)).toEqual([42, 38, 38, 38]);
  });
});

describe('Chatterfang, Squirrel General', () => {
  const names = (g: Game, pid: PlayerId) =>
    g.players[pid].battlefield
      .filter((c) => c.isToken)
      .map((c) => cardData(c.name).name)
      .sort();

  it('those tokens plus that many 1/1 green Squirrels are created instead (614.1a), only under your control', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Chatterfang, Squirrel General');
      put(d, 0, 'Plains', 'battlefield', 3);
      put(d, 0, 'Raise the Alarm', 'hand');
    });
    g = settle(run(g, cast(g, 'Raise the Alarm')));
    expect(names(g, 0)).toEqual(['Soldier', 'Soldier', 'Squirrel', 'Squirrel']);
    const squirrel = g.players[0].battlefield.find((c) => c.name === 'Squirrel 1/1 G')!;
    expect(stats(g, squirrel)).toMatchObject({ power: 1, toughness: 1 });
    g = produce(g, (d) => void createToken(d, 1, 'Treasure'));
    expect(names(g, 1)).toEqual(['Treasure']);
  });

  it("with Doubling Season the two replacement effects both apply, in an order the creator chooses (616.1)", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Chatterfang, Squirrel General');
      put(d, 0, 'Doubling Season');
      put(d, 0, 'Plains', 'battlefield', 3);
      put(d, 0, 'Raise the Alarm', 'hand');
    });
    g = settle(run(g, cast(g, 'Raise the Alarm')));
    // Either order: 2 Soldiers doubled, plus as many Squirrels; or 2 plus 2 Squirrels, doubled.
    expect(names(g, 0)).toEqual(['Soldier', 'Soldier', 'Soldier', 'Soldier', 'Squirrel', 'Squirrel', 'Squirrel', 'Squirrel']);
  });

  it('{B}, Sacrifice X Squirrels: target creature gets +X/-X, exactly X sacrificed (107.3a)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Chatterfang, Squirrel General');
      put(d, 0, 'Swamp');
      put(d, 1, 'Serra Angel');
      createToken(d, 0, 'Treasure', 2);
    });
    const chatter = byName(g, 0, 'Chatterfang, Squirrel General')!;
    const squirrels = g.players[0].battlefield.filter((c) => c.name === 'Squirrel 1/1 G').map((c) => c.id);
    expect(squirrels).toHaveLength(2);
    const angel = byName(g, 1, 'Serra Angel')!;
    // X must match the Squirrels sacrificed, and can't be more than there are (Chatterfang is a Squirrel too).
    expect(applyAction(g, { type: 'activate', card: chatter.id, x: 2, targets: [card(angel)], sacrifice: [squirrels[0]] })).toBe(g);
    expect(applyAction(g, { type: 'activate', card: chatter.id, x: 4, targets: [card(angel)], sacrifice: [...squirrels, chatter.id] })).toBe(g);
    g = run(g, { type: 'activate', card: chatter.id, x: 2, targets: [card(angel)], sacrifice: squirrels, hold: true });
    expect(g.players[0].battlefield.filter((c) => c.name === 'Squirrel 1/1 G')).toHaveLength(0);
    g = settle(g);
    expect(stats(g, permanent(g, angel.id)!)).toMatchObject({ power: 6, toughness: 2 });
  });
});

describe('Marneus Calgar', () => {
  it('draws once for each event that puts tokens you control onto the battlefield (603.2c)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Marneus Calgar');
      put(d, 0, 'Plains', 'battlefield', 9);
      put(d, 0, 'Raise the Alarm', 'hand');
    });
    expect(has(g, byName(g, 0, 'Marneus Calgar')!, 'double strike')).toBe(true);
    let hand = g.players[0].hand.length;
    g = settle(run(g, cast(g, 'Raise the Alarm')));
    expect(g.players[0].hand.length).toBe(hand - 1 + 1);
    // Chapter Master: two 2/2 white Astartes Warriors with vigilance, and another card.
    hand = g.players[0].hand.length;
    g = settle(run(g, { type: 'activate', card: byName(g, 0, 'Marneus Calgar')!.id }));
    const astartes = g.players[0].battlefield.filter((c) => cardData(c.name).name === 'Astartes Warrior');
    expect(astartes).toHaveLength(2);
    expect(stats(g, astartes[0])).toMatchObject({ power: 2, toughness: 2 });
    expect(has(g, astartes[0], 'vigilance')).toBe(true);
    expect(g.players[0].hand.length).toBe(hand + 1);
    // An opponent's tokens don't count.
    hand = g.players[0].hand.length;
    g = settle(produce(g, (d) => void createToken(d, 1, 'Treasure')));
    expect(g.players[0].hand.length).toBe(hand);
  });
});

describe('tokens of several kinds created at once', () => {
  it('"Create a Treasure token and a Food token" is one event: Marneus draws once, Chatterfang adds two Squirrels (111.2, 603.2c)', () => {
    registerCards({ 'Test Provisions': { name: 'Test Provisions', manaCost: '{1}', cmc: 1, colors: [], colorIdentity: [], typeLine: 'Sorcery', oracleText: 'Create a Treasure token and a Food token.', keywords: [], image: '', art: '' } });
    expect(scriptCards(['Test Provisions'])).toEqual([]);
    let g = emptyGame((d) => {
      put(d, 0, 'Marneus Calgar');
      put(d, 0, 'Chatterfang, Squirrel General');
      put(d, 0, 'Plains');
      put(d, 0, 'Test Provisions', 'hand');
    });
    const hand = g.players[0].hand.length;
    g = settle(run(g, cast(g, 'Test Provisions')));
    expect(g.players[0].hand.length).toBe(hand - 1 + 1);
    expect(g.players[0].battlefield.filter((c) => c.isToken).map((c) => cardData(c.name).name).sort()).toEqual(['Food', 'Squirrel', 'Squirrel', 'Treasure']);
  });
});

describe("Go-Shintai of Life's Origin", () => {
  it('it or another nontoken Shrine you control entering makes a 1/1 colorless Shrine enchantment creature token', () => {
    let g = settle(enter(emptyGame(), 0, "Go-Shintai of Life's Origin"));
    const shrines = () => g.players[0].battlefield.filter((c) => c.isToken);
    // The token is a Shrine, but a token: it doesn't trigger again.
    expect(shrines()).toHaveLength(1);
    expect(cardData(shrines()[0].name)).toMatchObject({ typeLine: 'Token Enchantment Creature — Shrine', colors: [], power: '1', toughness: '1' });
    // Another player's Shrine isn't one you control.
    g = settle(enter(g, 1, "Go-Shintai of Life's Origin"));
    expect(shrines()).toHaveLength(1);
  });

  it('{W}{U}{B}{R}{G}, {T}: returns target enchantment card from your graveyard to the battlefield', () => {
    let g = emptyGame((d) => {
      put(d, 0, "Go-Shintai of Life's Origin");
      for (const land of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']) put(d, 0, land);
      put(d, 0, 'Phyrexian Arena', 'graveyard');
    });
    g = settle(run(g, { type: 'activate', card: byName(g, 0, "Go-Shintai of Life's Origin")!.id, targets: [card(byName(g, 0, 'Phyrexian Arena', 'graveyard')!)] }));
    expect(byName(g, 0, 'Phyrexian Arena')).toBeDefined();
  });
});

describe('Rin and Seri, Inseparable', () => {
  it('a Dog spell makes a green Cat, a Cat spell a white Dog; the ability counts Dogs for damage and Cats for life', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Rin and Seri, Inseparable');
      put(d, 0, 'Plains', 'battlefield', 4);
      put(d, 0, 'Phelia, Exuberant Shepherd', 'hand');
      put(d, 0, "Ajani's Pridemate", 'hand');
    });
    g = settle(run(g, cast(g, 'Phelia, Exuberant Shepherd')));
    g = settle(run(g, cast(g, "Ajani's Pridemate")));
    const tokens = g.players[0].battlefield.filter((c) => c.isToken).map((c) => cardData(c.name));
    expect(tokens.map((d) => `${d.name} ${d.colors.join('')}`).sort()).toEqual(['Cat G', 'Dog W']);
    // Dogs: Rin and Seri, Phelia and the Dog token. Cats: Rin and Seri, the Pridemate, the Cat token and a Lion.
    g = produce(g, (d) => {
      put(d, 0, 'Whitemane Lion');
      for (const land of ['Mountain', 'Forest', 'Plains']) put(d, 0, land);
    });
    g = settle(run(g, { type: 'activate', card: byName(g, 0, 'Rin and Seri, Inseparable')!.id, targets: [player(1)] }));
    expect(g.players[1].life).toBe(37);
    expect(g.players[0].life).toBe(44);
  });
});

describe('Aragorn, the Uniter', () => {
  it('a trigger for each colour of the spell cast', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Aragorn, the Uniter');
      put(d, 0, 'Plains');
      put(d, 0, 'Mountain');
      put(d, 0, 'Forest');
      put(d, 0, 'Island');
      put(d, 0, 'Elite Vanguard', 'hand');
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Llanowar Elves', 'hand');
      put(d, 0, 'Mystic Remora', 'hand');
    });
    const aragorn = byName(g, 0, 'Aragorn, the Uniter')!;
    // White: a 1/1 Human Soldier.
    g = settle(run(g, cast(g, 'Elite Vanguard')));
    expect(g.players[0].battlefield.filter((c) => c.isToken).map((c) => cardData(c.name).name)).toEqual(['Human Soldier']);
    // Red: 3 damage to target opponent, besides the Bolt's.
    g = run(g, cast(g, 'Lightning Bolt', { targets: [player(2)] }));
    g = settle(run(g, { type: 'chooseTargets', targets: [player(1)] }));
    expect([g.players[1].life, g.players[2].life]).toEqual([37, 37]);
    // Green: target creature gets +4/+4 until end of turn.
    g = run(g, cast(g, 'Llanowar Elves'));
    g = settle(run(g, { type: 'chooseTargets', targets: [card(aragorn)] }));
    expect(stats(g, permanent(g, aragorn.id)!)).toMatchObject({ power: 9, toughness: 9 });
    // Blue: scry 2.
    g = untilAsked(run(g, cast(g, 'Mystic Remora')));
    expect(g.decision).toMatchObject({ type: 'chooseCards', choice: { max: 2 } });
  });
});

describe('Kenrith, the Returned King', () => {
  it("{4}{B} puts a creature card from any graveyard onto the battlefield under its owner's control (110.2a)", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kenrith, the Returned King');
      put(d, 0, 'Swamp', 'battlefield', 5);
      put(d, 1, 'Serra Angel', 'graveyard');
    });
    g = settle(run(g, { type: 'activate', card: byName(g, 0, 'Kenrith, the Returned King')!.id, activated: 4, targets: [card(byName(g, 1, 'Serra Angel', 'graveyard')!)] }));
    expect(byName(g, 1, 'Serra Angel')).toBeDefined();
    expect(byName(g, 0, 'Serra Angel')).toBeUndefined();
  });

  it("{R}: all creatures, everyone's, gain trample and haste until end of turn", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kenrith, the Returned King');
      put(d, 0, 'Mountain');
      put(d, 1, 'Elite Vanguard');
    });
    g = settle(run(g, { type: 'activate', card: byName(g, 0, 'Kenrith, the Returned King')!.id }));
    const v = byName(g, 1, 'Elite Vanguard')!;
    expect(has(g, v, 'trample') && has(g, v, 'haste')).toBe(true);
  });
});

describe('Magda, Brazen Outlaw', () => {
  it('other Dwarves you control get +1/+0; a Dwarf you control becoming tapped makes a Treasure', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Magda, Brazen Outlaw');
      put(d, 0, 'Tataru Taru');
      put(d, 0, 'Elite Vanguard');
      put(d, 1, 'Storm-Kiln Artist');
    });
    expect(stats(g, byName(g, 0, 'Tataru Taru')!).power).toBe(Number(cardData('Tataru Taru').power) + 1);
    expect(stats(g, byName(g, 0, 'Magda, Brazen Outlaw')!).power).toBe(2);
    expect(stats(g, byName(g, 1, 'Storm-Kiln Artist')!).power).toBe(Number(cardData('Storm-Kiln Artist').power));
    const treasures = () => g.players[0].battlefield.filter((c) => c.name === 'Treasure').length;
    const tapNamed = (pid: PlayerId, name: string) => (g = settle(produce(g, (d) => void tap(d, byName(d, pid, name)!))));
    tapNamed(0, 'Tataru Taru');
    tapNamed(0, 'Magda, Brazen Outlaw');
    expect(treasures()).toBe(2);
    // Not another creature, and not an opponent's Dwarf; nor one already tapped.
    tapNamed(0, 'Elite Vanguard');
    tapNamed(1, 'Storm-Kiln Artist');
    tapNamed(0, 'Tataru Taru');
    expect(treasures()).toBe(2);
  });

  it('Sacrifice five Treasures: an artifact or Dragon card onto the battlefield (701.23)', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Magda, Brazen Outlaw');
      createToken(d, 0, 'Treasure', 5);
      top(d, 0, ['Forest', 'Shivan Dragon', 'Llanowar Elves']);
    });
    const treasures = g.players[0].battlefield.filter((c) => c.name === 'Treasure').map((c) => c.id);
    expect(applyAction(g, { type: 'activate', card: byName(g, 0, 'Magda, Brazen Outlaw')!.id, sacrifice: treasures.slice(0, 4) })).toBe(g);
    g = untilAsked(run(g, { type: 'activate', card: byName(g, 0, 'Magda, Brazen Outlaw')!.id, sacrifice: treasures }));
    expect(g.players[0].battlefield.filter((c) => c.name === 'Treasure')).toHaveLength(0);
    // Only the Dragon can be found: not the land or the Elves.
    const choice = (g.decision as { choice: { cards: string[] } }).choice;
    expect(choice).toBeDefined();
    const dragon = byName(g, 0, 'Shivan Dragon', 'library')!;
    g = settle(run(g, { type: 'chooseCards', cards: [dragon.id] }));
    expect(byName(g, 0, 'Shivan Dragon')).toBeDefined();
    const elves = byName(g, 0, 'Llanowar Elves', 'library')!;
    expect(elves).toBeDefined();
  });
});
