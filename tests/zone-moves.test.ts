// The diff the zone-change animations are drawn from (src/ui/zone-moves.ts).
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import './fixtures';
import { makeCard, viewFor } from '../src/engine';
import type { Game, StackItem } from '../src/engine';
import { leftStack, zoneMoves } from '../src/ui/zone-moves';
import { emptyGame, put } from './helpers';

const change = (g: Game, edit: (d: Game) => void) => produce(g, edit);
/** Each move as "name: from -> to", zones with their player; in player order, then zone order. */
const moves = (prev: Game, next: Game) =>
  zoneMoves(prev, next).map((m) => `${m.card.name}: ${m.from ? `${m.from.zone}${m.from.pid}` : 'new'} -> ${m.to.zone}${m.to.pid}`);

const spell = (g: Game, pid: number, from: 'hand' | 'command', name: string): Game =>
  change(g, (d) => {
    const i = d.players[pid][from].findIndex((c) => c.name === name);
    const [card] = d.players[pid][from].splice(i, 1);
    d.stack.push({ id: `s${card.id}`, kind: 'spell', controller: pid, card, targets: [] } as StackItem);
  });

describe('zone moves for the animations', () => {
  const g = emptyGame((d) => {
    put(d, 0, 'Grizzly Bears', 'hand');
    put(d, 0, 'Lightning Bolt', 'hand');
    put(d, 1, 'Llanowar Elves');
  });

  it('follows a creature spell from the hand to the stack to the battlefield', () => {
    const cast = spell(g, 0, 'hand', 'Grizzly Bears');
    expect(moves(g, cast)).toEqual(['Grizzly Bears: hand0 -> stack0']);
    const resolved = change(cast, (d) => void d.players[0].battlefield.push(d.stack.pop()!.card));
    expect(moves(cast, resolved)).toEqual(['Grizzly Bears: stack0 -> battlefield0']);
    expect(leftStack(cast, resolved).map((s) => s.card.name)).toEqual(['Grizzly Bears']);
  });

  it('sends an instant to the graveyard and a dying creature to its owner’s graveyard', () => {
    const cast = spell(g, 0, 'hand', 'Lightning Bolt');
    const resolved = change(cast, (d) => {
      d.players[0].graveyard.push(d.stack.pop()!.card);
      d.players[1].graveyard.push(d.players[1].battlefield.pop()!);
    });
    expect(moves(cast, resolved)).toEqual(['Lightning Bolt: stack0 -> graveyard0', 'Llanowar Elves: battlefield1 -> graveyard1']);
  });

  it('counts exile, a draw and a new token, but not a change of controller', () => {
    const next = change(g, (d) => {
      d.players[1].exile.push(d.players[1].battlefield.pop()!);
      d.players[0].hand.push(d.players[0].library.shift()!);
      d.players[0].battlefield.push(makeCard(d, 'Llanowar Elves', 0, 'battlefield', { isToken: true }));
    });
    const drawn = next.players[0].hand[next.players[0].hand.length - 1].name;
    expect(moves(g, next)).toEqual([`${drawn}: library0 -> hand0`, 'Llanowar Elves: new -> battlefield0', 'Llanowar Elves: battlefield1 -> exile1']);
    const stolen = change(g, (d) => void d.players[0].battlefield.push(d.players[1].battlefield.pop()!));
    expect(moves(g, stolen)).toEqual([]);
  });

  it('says nothing for an ability leaving the stack, only that it left', () => {
    const elves = g.players[1].battlefield[0];
    const trig = change(g, (d) => void d.stack.push({ id: 'a1', kind: 'triggered', controller: 1, card: elves, targets: [] } as StackItem));
    expect(moves(g, trig)).toEqual([]);
    const done = change(trig, (d) => void (d.stack = []));
    expect(moves(trig, done)).toEqual([]);
    expect(leftStack(trig, done).map((s) => s.id)).toEqual(['a1']);
  });

  it('guesses the hidden hand an opponent’s card came from in a seat’s view', () => {
    const hidden = change(g, (d) => void put(d, 1, 'Grizzly Bears', 'hand'));
    const played = change(hidden, (d) => void d.players[1].battlefield.push(d.players[1].hand.pop()!));
    expect(moves(viewFor(hidden, 0), viewFor(played, 0))).toEqual(['Grizzly Bears: hand1 -> battlefield1']);
  });

  it('is empty for a new game or no change', () => {
    expect(zoneMoves(null, g)).toEqual([]);
    expect(zoneMoves(g, g)).toEqual([]);
    expect(zoneMoves(g, emptyGame())).toEqual([]);
  });
});
