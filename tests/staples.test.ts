// Hand scripts for staples in the parse report's corpus (the 600 most-played Commander
// cards) that the Oracle text parser can't read: the clauses that could go wrong. Their data
// is the corpus's (tests/parser-corpus.generated.json).
import { describe, expect, it } from 'vitest';
import { registerCards } from '../src/cards/db';
import { applyAction, applyBotAction, botAction, enterBattlefield, isLand, stats } from '../src/engine';
import type { Action, CardData, Game, TargetRef } from '../src/engine';
import corpus from './parser-corpus.generated.json';
import { byName, emptyGame, put, run } from './helpers';

const STAPLES = ['Brainstorm', 'Chaos Warp', 'Arcane Denial', 'The One Ring', 'Myriad Landscape'];
const cards = corpus.cards as unknown as CardData[];
registerCards(Object.fromEntries(STAPLES.map((n) => [n, { ...cards.find((c) => c.name === n)!, image: '', art: '' }])));

const player = (id: number): TargetRef => ({ kind: 'player', id });
const card = (id: string): TargetRef => ({ kind: 'card', id });

/** Passes priority (bots answering anything asked) until the stack is empty, or a person must decide. */
function settle(g: Game, until?: (g: Game) => boolean): Game {
  for (let i = 0; i < 80 && (g.decision || g.stack.length) && !until?.(g); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, { type: 'pass' });
  return g;
}
const humanGame = (setup: (g: Game) => void) =>
  emptyGame((d) => {
    d.players[0].isBot = false;
    d.players[0].you = true;
    setup(d);
  });
const passTurn = (g: Game) => {
  const turn = g.turn;
  for (let i = 0; i < 200 && g.turn === turn; i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, { type: 'pass' } as Action);
  return g;
};

describe('corpus staples with hand scripts', () => {
  it('Brainstorm: draw three, then two cards from the hand on top in the order chosen (401.4)', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Brainstorm', 'hand');
      put(d, 0, 'Island');
    });
    const top3 = g.players[0].library.slice(0, 3).map((c) => c.id);
    g = run(g, { type: 'cast', card: byName(g, 0, 'Brainstorm', 'hand')!.id });
    g = settle(g, (x) => x.decision?.type === 'chooseCards');
    expect(g.players[0].hand.map((c) => c.id)).toEqual(top3);
    g = run(g, { type: 'chooseCards', cards: [top3[2], top3[0]] });
    expect(g.players[0].library.slice(0, 2).map((c) => c.id)).toEqual([top3[2], top3[0]]);
    expect(g.players[0].hand.map((c) => c.id)).toEqual([top3[1]]);
  });

  it('Chaos Warp: the owner shuffles it in, then a revealed permanent card is put onto the battlefield', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Chaos Warp', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 3);
      put(d, 1, 'Serra Angel');
      // Every card in player 1's library is a land: whichever is revealed is a permanent card.
      d.players[1].library = d.players[1].library.filter((c) => c.name === 'Plains' || c.name === 'Island' || c.name === 'Swamp' || c.name === 'Mountain' || c.name === 'Forest');
    });
    const library = g.players[1].library.length;
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Chaos Warp', 'hand')!.id, targets: [card(byName(g, 1, 'Serra Angel')!.id)] }));
    expect(byName(g, 1, 'Serra Angel')).toBeUndefined();
    // The Angel went in and a land came out: the library is the same size, and the land is on the battlefield.
    expect(g.players[1].library).toHaveLength(library);
    expect(g.players[1].battlefield.filter((c) => isLand(g, c))).toHaveLength(1);
  });

  it("Arcane Denial: the spell is countered, and both players draw at the next turn's upkeep (603.7)", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Shock', 'hand');
      put(d, 0, 'Mountain');
      put(d, 1, 'Arcane Denial', 'hand');
      put(d, 1, 'Island', 'battlefield', 2);
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Shock', 'hand')!.id, targets: [player(1)], hold: true }, { type: 'pass' });
    g = run(g, { type: 'cast', card: byName(g, 1, 'Arcane Denial', 'hand')!.id, targets: [{ kind: 'stack', id: g.stack[0].id }] });
    g = settle(g);
    expect(g.players[1].life).toBe(40);
    const hands = g.players.map((p) => p.hand.length);
    g = passTurn(g);
    g = settle(g);
    // Player 1's upkeep: player 0 (whose spell it was) draws two (the bot takes both), player 1 one, besides its draw step.
    expect(g.players[0].hand.length - hands[0]).toBe(2);
    expect(g.players[1].hand.length - hands[1]).toBeGreaterThanOrEqual(1);
  });

  it('The One Ring: protection only if cast, and burden counters (702.16j)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'The One Ring', 'hand');
      put(d, 0, 'Plains', 'battlefield', 4);
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'The One Ring', 'hand')!.id }));
    expect(g.effects).toContainEqual({ kind: 'protection', player: 0, ends: { nextTurnOf: 0 } });
    const hand = g.players[0].hand.length;
    g = settle(run(g, { type: 'activate', card: byName(g, 0, 'The One Ring')!.id }));
    expect(byName(g, 0, 'The One Ring')!.counters.burden).toBe(1);
    expect(g.players[0].hand.length).toBe(hand + 1);
    // Put onto the battlefield without being cast, it gives no protection.
    let h = emptyGame((d) => {
      const ring = put(d, 0, 'The One Ring', 'hand');
      enterBattlefield(d, ring);
    });
    expect(h.triggers.length + h.stack.length).toBe(0);
    h = settle(h);
    expect(h.effects).toEqual([]);
    expect(stats(h, byName(h, 0, 'The One Ring')!).keywords.has('indestructible')).toBe(true);
  });

  it('Myriad Landscape: two basic lands that share a land type, tapped, from one search (701.23h)', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Myriad Landscape');
      put(d, 0, 'Plains', 'battlefield', 2);
      d.players[0].library = [];
      put(d, 0, 'Forest', 'library', 2);
      put(d, 0, 'Island', 'library');
    });
    g = run(g, { type: 'activate', card: byName(g, 0, 'Myriad Landscape')!.id });
    g = settle(g, (x) => x.decision?.type === 'chooseCards');
    const [forest, forest2] = g.players[0].library.filter((c) => c.name === 'Forest');
    g = run(g, { type: 'chooseCards', cards: [forest.id] });
    // The Island doesn't share a land type with the Forest, so it can't be the second.
    const island = g.players[0].library.find((c) => c.name === 'Island')!;
    expect(applyAction(g, { type: 'chooseCards', cards: [island.id] })).toBe(g);
    g = run(g, { type: 'chooseCards', cards: [forest2.id] });
    expect(g.players[0].battlefield.filter((c) => c.name === 'Forest').map((c) => c.tapped)).toEqual([true, true]);
  });
});
