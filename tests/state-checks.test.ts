// sbaPending asks the questions checkState asks without changing anything, so the engine
// can ask it of a finished game and draft one only when a state-based action is due (704.3).
// The two must agree: checkState changes the game exactly when sbaPending says it would.
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import './fixtures';
import { checkState, sbaPending } from '../src/engine';
import type { Game } from '../src/engine';
import { emptyGame, put } from './helpers';

/** Does checkState change `g`? */
const changes = (g: Game) => produce(g, (d) => void checkState(d)) !== g;

describe('sbaPending', () => {
  const cases: [string, (d: Game) => void][] = [
    ['nothing to do', (d) => void put(d, 0, 'Llanowar Elves')],
    ['a player at 0 life (704.5a)', (d) => void (d.players[1].life = 0)],
    ['a player who drew from an empty library (704.5b)', (d) => void (d.players[2].drewFromEmpty = true)],
    ['21 commander damage (903.10a)', (d) => void (d.players[1].commanderDamage[0][0] = 21)],
    ['a creature with lethal damage (704.5g)', (d) => void (put(d, 1, 'Llanowar Elves').damage = 1)],
    ['a creature with deathtouch damage (704.5h)', (d) => {
      const c = put(d, 1, 'Kalonian Tusker');
      c.damage = 1;
      c.deathtouched = true;
    }],
    ['a creature with 0 toughness (704.5f)', (d) => void (put(d, 1, 'Llanowar Elves').counters['-1/-1'] = 1)],
    ['+1/+1 and -1/-1 counters together (704.5q)', (d) => {
      const c = put(d, 1, 'Kalonian Tusker');
      c.counters['+1/+1'] = 1;
      c.counters['-1/-1'] = 1;
    }],
    ['a planeswalker with no loyalty (704.5i)', (d) => void put(d, 0, 'Jace Beleren')],
    ['two legendary permanents with one name for a bot (704.5j)', (d) => void put(d, 1, 'Lyra Dawnbringer', 'battlefield', 2)],
    ['an Aura attached to nothing (704.5m)', (d) => void put(d, 0, 'Pacifism')],
    ['a bot’s commander in its graveyard (903.9a)', (d) => {
      const c = put(d, 1, 'Llanowar Elves', 'graveyard');
      c.isCommander = true;
      c.mayReturn = true;
    }],
    ['one player left (104.2a)', (d) => {
      for (const p of d.players.slice(1)) p.lost = true;
    }],
  ];
  for (const [label, setup] of cases) {
    it(`agrees with checkState: ${label}`, () => {
      const g = emptyGame(setup);
      expect(sbaPending(g)).toBe(changes(g));
      expect(sbaPending(g)).toBe(label !== 'nothing to do');
    });
  }
});
