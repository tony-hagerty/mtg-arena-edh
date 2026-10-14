import { produce } from 'immer';
import { ALL_CARD_NAMES, SHARED, cardData } from '../src/cards/db';
import type { DeckDef } from '../src/cards/db';
import { applyAction, makeCard, newGame, permanent } from '../src/engine';
import type { Action, ApplyOptions, Card, Game, PlayerId, Zone } from '../src/engine';

/**
 * A fresh game past the mulligans with empty boards and hands, player 0 active with priority
 * in main phase 1. Player 0's commander is Lyra Dawnbringer (mono-white), whatever the white
 * deck's commander is now, so rules tests have a simple commander to cast.
 */
export function emptyGame(setup: (g: Game) => void = () => {}): Game {
  return produce(newGame({ seed: 1, humanDeck: null }), (g) => {
    for (const p of g.players) {
      p.hand = [];
      p.battlefield = [];
    }
    const p0 = g.players[0];
    p0.commanders = ['Lyra Dawnbringer'];
    p0.colors = ['W'];
    p0.command = [makeCard(g, 'Lyra Dawnbringer', 0, 'command', { isCommander: true })];
    // Skip the mulligans: the game is already under way.
    g.mulligan = null;
    g.decision = null;
    g.turn = 1;
    g.active = 0;
    g.priority = 0;
    g.step = 'main1';
    g.passes = 0;
    setup(g);
  });
}

/** Adds a card to a zone (untapped and without summoning sickness). */
export function put(g: Game, pid: PlayerId, name: string, zone: Zone = 'battlefield', count = 1): Card {
  let last!: Card;
  for (let i = 0; i < count; i++) {
    g.players[pid][zone].push(makeCard(g, name, pid, zone));
    last = g.players[pid][zone][g.players[pid][zone].length - 1];
  }
  return last;
}

export const byName = (g: Game, pid: PlayerId, name: string, zone: Zone = 'battlefield') =>
  g.players[pid][zone].find((c) => c.name === name);

/** Applies actions in order and fails loudly if one is rejected. */
export function run(g: Game, ...actions: Action[]): Game {
  return runWith({}, g, ...actions);
}

/** `run` with engine options, e.g. `{ autoPass: false }` to pass priority for every player by hand. */
export function runWith(opts: ApplyOptions, g: Game, ...actions: Action[]): Game {
  for (const a of actions) {
    const next = applyAction(g, a, opts);
    if (next === g) {
      throw new Error(`Illegal action: ${JSON.stringify(a)} (step ${g.step}, priority ${g.priority}, deciding ${g.decision?.type})`);
    }
    g = next;
  }
  return g;
}

export const onBattlefield = (g: Game, id: string) => !!permanent(g, id);

/**
 * A 100-card white-red deck with two commanders, built from cards in the pool. Lyra and
 * Torbran don't really have partner, so `deckProblems` rejects it, but the engine plays any
 * deck it is given: this tests two commanders and multicolour mana without new cards.
 */
export function twoCommanderDeck(): DeckDef {
  // 28 mono-white and 28 mono-red nonland cards from the pool, besides the commanders and shared artifacts.
  const mono = (color: string) =>
    ALL_CARD_NAMES.filter((n) => {
      const d = cardData(n);
      return d.colorIdentity.join('') === color && !d.typeLine.includes('Land') && !SHARED.includes(n) && !['Lyra Dawnbringer', 'Torbran, Thane of Red Fell'].includes(n);
    }).slice(0, 28);
  return {
    id: 'boros',
    title: 'Test Boros',
    blurb: '',
    pilot: 'Tester',
    commanders: ['Lyra Dawnbringer', 'Torbran, Thane of Red Fell'],
    basics: { Plains: 18, Mountain: 17 },
    cards: [...mono('W'), ...mono('R'), ...SHARED],
  };
}
