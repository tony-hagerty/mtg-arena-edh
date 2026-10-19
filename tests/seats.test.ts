// Tables of two to four seats, played by any mix of people and bots (phase 1 of multiplayer).
import { describe, expect, it } from 'vitest';
import './fixtures';
import { DECKS } from '../src/cards/db';
import { applyAction, applyBotAction, botAction, newGame } from '../src/engine';
import type { Game, SeatDef } from '../src/engine';
import { absoluteStops, tableOf } from '../src/ui/store';
import { fromSeat, seatOf } from '../src/ui/util';
import { byName, emptyGame, put, run } from './helpers';

const bots = (n: number): SeatDef[] => DECKS.slice(0, n).map((deck) => ({ deck }));
const people = (n: number): SeatDef[] => DECKS.slice(0, n).map((deck) => ({ deck, human: true }));

/** Plays a game to the end, every seat's moves picked by the bot, people's included. */
function playOut(seed: number, seats: SeatDef[]): Game {
  let g = newGame({ seed, seats });
  for (let actions = 0; g.step !== 'gameOver'; actions++) {
    const next = applyBotAction(g, botAction(g, g.priority));
    if (next === g) throw new Error(`seed ${seed}: stalled at step ${g.step}, ${g.players[g.priority].name} deciding ${g.decision?.type}`);
    g = next;
    if (actions > 20_000) throw new Error(`seed ${seed}: game did not finish (turn ${g.turn})`);
  }
  return g;
}

describe('seats', () => {
  it('takes two to four seats, and no other number', () => {
    for (const n of [2, 3, 4]) expect(newGame({ seed: 1, seats: bots(n) }).players.length).toBe(n);
    expect(() => newGame({ seed: 1, seats: bots(1) })).toThrow();
    expect(() => newGame({ seed: 1, seats: [...bots(4), ...bots(1)] })).toThrow();
  });

  it('calls the only person at the table "You", and several people by seat', () => {
    const alone = newGame({ seed: 1, seats: [{ deck: DECKS[0], human: true }, ...bots(4).slice(1)] });
    expect(alone.players.map((p) => [p.name === 'You', !!p.you, p.isBot])).toEqual([
      [true, true, false],
      [false, false, true],
      [false, false, true],
      [false, false, true],
    ]);
    const two = newGame({ seed: 1, seats: [{ deck: DECKS[0], human: true }, { deck: DECKS[1] }, { deck: DECKS[2], human: true }] });
    expect(two.players.map((p) => [p.name, !!p.you, p.isBot])).toEqual([
      ['Player 1', false, false],
      [DECKS[1].pilot, false, true],
      ['Player 3', false, false],
    ]);
    expect(newGame({ seed: 1, seats: [{ deck: DECKS[0], human: true, name: 'Alice' }, ...bots(2).slice(1)] }).players[0].name).toBe('Alice');
  });

  it('picks the starting player among everyone at a small table', () => {
    const starters = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((seed) => newGame({ seed, seats: bots(3) }).active));
    expect([...starters].every((p) => p < 3)).toBe(true);
    expect(starters.size).toBeGreaterThan(1);
  });
});

describe('a two-player game (103.8a)', () => {
  it('skips the starting player’s first draw step, and no one else’s', () => {
    let g = newGame({ seed: 3, seats: bots(2) });
    const first = g.active;
    while (g.turn < 2 || g.step !== 'main1') g = applyBotAction(g, botAction(g, g.priority));
    const turn1 = g.log.filter((l) => l.turn === 1);
    expect(turn1.some((l) => l.text.endsWith('skips their first draw step.'))).toBe(true);
    expect(g.log.filter((l) => l.turn === 2).some((l) => l.text.includes('first draw step'))).toBe(false);
    expect(g.active).not.toBe(first);
  });

  it('draws on turn 1 at a table of three (103.8c)', () => {
    let g = newGame({ seed: 3, seats: bots(3) });
    while (g.turn < 1 || g.step !== 'main1') g = applyBotAction(g, botAction(g, g.priority));
    expect(g.log.some((l) => l.text.includes('first draw step'))).toBe(false);
  });
});

describe('full games at every table size', () => {
  // The game two people play alone, played once for the two tests that look at it.
  let shared: Game | undefined;
  const twoPeople = () => (shared ??= playOut(7, people(2)));

  for (const [label, game] of [
    ['two bots', () => playOut(7, bots(2))],
    ['three bots', () => playOut(7, bots(3))],
    ['two people alone', twoPeople],
    ['two people and two bots', () => playOut(7, [people(1)[0], ...bots(2).slice(1), { deck: DECKS[3], human: true }])],
  ] as [string, () => Game][]) {
    it(`${label} play to a winner`, { tags: ['game'] }, () => {
      expect(game().winner).not.toBe(null);
    });
  }

  it('writes every line in the third person when several people play', { tags: ['game'] }, () => {
    const g = twoPeople();
    expect(g.log.filter((l) => /\b(You|you|your|Your)\b/.test(l.text))).toEqual([]);
  });
});

describe('a search only the searcher sees (701.23e)', () => {
  it('tells the others only that a card was found', () => {
    let g = emptyGame((d) => {
      d.players[0].isBot = false;
      put(d, 0, 'Swamp', 'battlefield', 2);
      put(d, 0, 'Demonic Tutor', 'hand');
      d.players[0].library = [];
      put(d, 0, 'Kalonian Tusker', 'library');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Demonic Tutor', 'hand')!.id });
    g = run(g, { type: 'chooseCards', cards: [byName(g, 0, 'Kalonian Tusker', 'library')!.id] });
    const line = g.log.find((l) => l.text.includes('searches'))!;
    expect(line.text).toBe(`${g.players[0].name} searches their library for a card.`);
    expect(line.cards).toBeUndefined();
    expect(line.private).toEqual({ players: [0], text: `${g.players[0].name} searches their library for Kalonian Tusker.`, cards: ['Kalonian Tusker'] });
  });

  it('names a card put onto the battlefield for everyone', () => {
    let g = emptyGame((d) => {
      d.players[0].isBot = false;
      put(d, 0, 'Forest', 'battlefield', 3);
      put(d, 0, 'Rampant Growth', 'hand');
      d.players[0].library = [];
      put(d, 0, 'Plains', 'library');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Rampant Growth', 'hand')!.id });
    g = run(g, { type: 'chooseCards', cards: [byName(g, 0, 'Plains', 'library')!.id] });
    const line = g.log.find((l) => l.text.includes('searches'))!;
    expect(line.text).toMatch(/library for Plains\.$/);
    expect(line.private).toBeUndefined();
  });

});

describe('the table as each player sees it', () => {
  const table = (n: number) => newGame({ seed: 1, seats: bots(n) });

  it('puts the viewer at the bottom and the others clockwise in turn order', () => {
    const g = table(4);
    expect(g.players.map((p) => seatOf(g, 0, p.id))).toEqual(['bottom', 'left', 'top', 'right']);
    expect(g.players.map((p) => seatOf(g, 2, p.id))).toEqual(['top', 'right', 'bottom', 'left']);
    expect(fromSeat(g.players, 2).map((p) => p.id)).toEqual([2, 3, 0, 1]);
  });

  it('leaves the top empty at three, and the sides at two', () => {
    const three = table(3);
    expect(three.players.map((p) => seatOf(three, 1, p.id))).toEqual(['right', 'bottom', 'left']);
    const two = table(2);
    expect(two.players.map((p) => seatOf(two, 1, p.id))).toEqual(['top', 'bottom']);
  });

  it('shows seat 0 at the bottom when watching bots', () => {
    const g = table(3);
    expect(seatOf(g, null, 0)).toBe('bottom');
    expect(fromSeat(g.players, null).map((p) => p.id)).toEqual([0, 1, 2]);
  });
});

describe('stops kept from your own seat', () => {
  const own = { main1: 'always' as const };
  const next = { end: 'ifAble' as const };
  const rel = [own, next, {}, {}];

  it('turns them into stops by whose turn it is', () => {
    expect(absoluteStops(rel, 0, 4)).toEqual([own, next, {}, {}]);
    expect(absoluteStops(rel, 2, 4)).toEqual([{}, {}, own, next]);
    expect(absoluteStops(rel, 1, 2)).toEqual([next, own]);
  });

  it('stops each person on their own turn in a game with two people', () => {
    let g = newGame({ seed: 5, seats: people(2), stops: { 0: absoluteStops(rel, 0, 2), 1: absoluteStops(rel, 1, 2) } });
    while (g.decision?.type === 'mulligan') g = applyAction(g, { type: 'keep' });
    expect([g.step, g.priority]).toEqual(['main1', g.active]);
  });
});

describe('seats from the menu settings', () => {
  const settings = (players: ('bot' | 'person' | 'empty')[]) => ({ manualDamage: true, opponents: [null, null, null], players, volume: 0.5, muted: false, music: 0.4, musicMuted: false });

  it('skips empty seats and seats other people at this screen', () => {
    const seats = tableOf(DECKS[0], settings(['person', 'empty', 'bot']), []);
    expect(seats.map((s) => [s.deck.id, !!s.human, !!s.manualDamage])).toEqual([
      [DECKS[0].id, true, true],
      [DECKS[1].id, true, true],
      [DECKS[3].id, false, false],
    ]);
  });

  it('keeps at least one opponent, and seats only bots when watching', () => {
    expect(tableOf(DECKS[0], settings(['empty', 'empty', 'empty']), []).length).toBe(2);
    expect(tableOf(null, settings(['person', 'bot', 'bot']), []).every((s) => !s.human)).toBe(true);
  });
});
