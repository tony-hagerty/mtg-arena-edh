// EDHREC's most-played cards and commanders, tokens group: the hand scripts in
// src/cards/edhrec/tokens.ts, the parsed ones, and the rules they needed (an ability's
// resolutions this turn, emblems, "one or more tokens enter", "whenever a Dwarf becomes
// tapped", attack restrictions, "Sacrifice X"): the clauses that could go wrong.
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { cardData } from '../src/cards/db';
import { scriptCards } from '../src/cards/oracle';
import { problemsOf } from '../src/cards/support';
import { applyAction, applyBotAction, botAction, createToken, destroy, enterBattlefield, has, makeCard, permanent, stats } from '../src/engine';
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
