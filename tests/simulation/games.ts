// The bot-vs-bot games: every deck set and the seeds it is played with. Each game has its
// own file beside this one (`<set>-<seed>.test.ts`, one line calling `play`), so Vitest
// plays them on every core at once: the run takes about as long as the longest game.
// The seeds are the regression set: keep them. To add a game, add its seed here and a file
// for it; tests/games-table.test.ts checks that the two match.
import { describe, expect, it } from 'vitest';
import { ALL_DECKS, DECKS } from '../../src/cards/db';
import type { DeckDef } from '../../src/cards/db';
import { twoCommanderDeck } from '../helpers';
import { playOut } from './play';

interface Group {
  seeds: number[];
  /** The test's name for one seed. */
  name: (seed: number) => string;
  /** The decks at the table, made fresh for each game. Undefined: the four starter decks. */
  decks: () => DeckDef[] | undefined;
  /** Prints how the game ended. */
  report?: boolean;
}

interface GameSet {
  /** The `describe` the games are under. */
  title: string;
  groups: Group[];
}

const deck = (id: string) => ALL_DECKS.find((d) => d.id === id)!;
const toFinish = (seed: number) => `seed ${seed}: bots play them to a finish`;

export const GAMES: Record<string, GameSet> = {
  'starter-decks': {
    title: 'four bots play full games',
    groups: [{ seeds: [11, 22, 33, 44, 55, 66], name: (seed) => `seed ${seed} reaches a winner with a consistent state throughout`, decks: () => undefined, report: true }],
  },
  costs: {
    title: 'decks with X, hybrid, Phyrexian, kicker, sacrifice and alternative costs',
    groups: [
      {
        seeds: [4, 5, 6],
        name: toFinish,
        decks: () => {
          // Cards from tests/fixtures.ts, swapped in for basic lands and one black card.
          const boros = twoCommanderDeck();
          boros.cards.push('Blaze', 'Boros Recruit', 'Gut Shot', 'Burst Lightning', 'Flawless Maneuver', 'Thalia, Guardian of Thraben', 'Ruby Medallion');
          boros.basics = { Plains: 14, Mountain: 14 };
          const black = { ...DECKS[1], cards: [...DECKS[1].cards.slice(1), 'Bone Splinters'] };
          return [boros, black, DECKS[3], DECKS[0]];
        },
      },
    ],
  },
  'counters-auras': {
    title: 'decks with counters, Auras, Equipment and Vehicles',
    groups: [
      {
        seeds: [21, 22, 23],
        name: toFinish,
        decks: () => {
          const boros = twoCommanderDeck();
          boros.cards.push('Pacifism', 'Holy Strength', 'Bonesplitter', 'Loxodon Warhammer', 'Untethered Express');
          boros.basics = { Plains: 16, Mountain: 14 };
          const black = { ...DECKS[1], cards: [...DECKS[1].cards.slice(1), "Black Sun's Zenith"] };
          return [boros, black, { ...boros, id: 'boros2' }, DECKS[3]];
        },
      },
    ],
  },
  counterspells: {
    title: 'decks with counterspells, modal spells and copies',
    groups: [
      {
        seeds: [12, 13, 14],
        name: toFinish,
        decks: () => {
          // Cards from tests/fixtures.ts, with Islands to cast the blue ones.
          const boros = twoCommanderDeck();
          boros.cards.push('Counterspell', 'Negate', 'Essence Scatter', 'Stifle', 'Cryptic Command', 'Boros Charm', 'Fiery Confluence', 'Reverberate');
          boros.basics = { Plains: 12, Mountain: 12, Island: 3 };
          return [boros, DECKS[1], { ...boros, id: 'boros2' }, DECKS[3]];
        },
      },
    ],
  },
  'faces-and-tokens': {
    title: 'decks with double-faced, split and adventurer cards, Sagas, Classes, flashback and tokens',
    groups: [
      {
        // Seeds where a lot of it comes up: 43 and 47 use flashback, Adventures and Treasure; 50 levels up Wizard Class.
        seeds: [43, 47, 50],
        name: toFinish,
        decks: () => {
          const boros = twoCommanderDeck();
          boros.cards.push('Invasion of Dominaria', 'Dead', 'Strike It Rich', 'Thraben Inspector', 'History of Benalia', 'Needleverge Pathway', 'Delver of Secrets', 'Think Twice', 'Wizard Class');
          boros.basics = { Plains: 14, Mountain: 13, Island: 4 };
          const black = { ...DECKS[1], cards: [...DECKS[1].cards.slice(2), 'Murderous Rider', 'Bake into a Pie'] };
          const green = { ...DECKS[3], cards: [...DECKS[3].cards.slice(1), 'Kazandu Mammoth'] };
          return [boros, black, { ...boros, id: 'boros2' }, green];
        },
      },
    ],
  },
  planeswalkers: {
    title: 'decks with planeswalkers and battles',
    groups: [
      {
        // Seeds where they come up: 36 uses Garruk until he runs out of loyalty, 38 attacks and defeats a battle.
        seeds: [35, 36, 38],
        name: toFinish,
        decks: () => {
          const boros = twoCommanderDeck();
          boros.cards.push('Jace Beleren', 'Invasion of Dominaria');
          boros.basics = { Plains: 16, Mountain: 14, Island: 3 };
          const green = { ...DECKS[3], cards: [...DECKS[3].cards.slice(1), 'Garruk Wildspeaker'] };
          return [boros, DECKS[1], { ...boros, id: 'boros2' }, green];
        },
      },
    ],
  },
  'two-commanders': {
    title: 'a 100-card two-commander deck',
    groups: [{ seeds: [7, 8, 9], name: (seed) => `seed ${seed}: bots play it to a finish against the starter decks`, decks: () => [twoCommanderDeck(), DECKS[1], DECKS[3], DECKS[0]] }],
  },
  'two-colour-8a': {
    title: 'the two-colour starter decks (session 8a)',
    // Kraum and Tymna are off the menu, but their cards are in the pool and the bots still play them.
    groups: [{ seeds: [71, 72], name: (seed) => `seed ${seed}: white-black and black-red play to a finish`, decks: () => [DECKS[0], DECKS[1], deck('kraum-tymna'), DECKS[3]] }],
  },
  'two-colour-8b': {
    title: 'the two-colour starter decks (session 8b)',
    groups: [{ seeds: [81, 82], name: (seed) => `seed ${seed}: red-green and green-white play to a finish`, decks: () => [DECKS[2], DECKS[3], DECKS[0], DECKS[1]] }],
  },
  'kraum-tymna': {
    title: 'the Kraum and Tymna deck',
    // Off the menu, but its cards are in the pool and the bots still play it.
    groups: [
      { seeds: [61, 62, 63], name: (seed) => `seed ${seed}: bots play it to a finish against the starter decks`, decks: () => [deck('kraum-tymna'), DECKS[1], DECKS[0], DECKS[2]] },
      { seeds: [64, 65], name: (seed) => `seed ${seed}: two copies of it play to a finish`, decks: () => [deck('kraum-tymna'), DECKS[3], { ...deck('kraum-tymna'), id: 'kraum2' }, DECKS[1]] },
    ],
  },
  kuja: {
    title: 'the Kuja deck',
    groups: [
      { seeds: [71, 72, 73], name: (seed) => `seed ${seed}: bots play it to a finish`, decks: () => [deck('kuja'), deck('yshtola'), deck('ketramose'), DECKS[2]] },
      { seeds: [74, 75], name: (seed) => `seed ${seed}: two copies of it play to a finish`, decks: () => [deck('kuja'), DECKS[3], { ...deck('kuja'), id: 'kuja2' }, deck('yshtola')] },
    ],
  },
  'counters-proliferate': {
    title: 'decks with proliferate, blight, rad and experience counters, decayed and moving counters',
    groups: [
      {
        // Seeds where they come up: 103 proliferates and blights, 106 proliferates with rad counters out, 107 mills to radiation.
        seeds: [103, 106, 107],
        name: toFinish,
        decks: () => {
          // EDHREC's counters cards (tests/fixtures.ts) in two cut-down starter decks with the basics to cast them, so they come up often.
          const green = {
            ...DECKS[3],
            id: 'counters-green',
            cards: [...DECKS[3].cards.slice(36), "Atraxa, Praetors' Voice", "Tidus, Yuna's Guardian", 'High Perfect Morcant', 'Meren of Clan Nel Toth', 'The Wise Mothman', "Betor, Ancestor's Voice"],
            basics: { Forest: 7, Plains: 5, Swamp: 5, Island: 5 },
          };
          const white = {
            ...DECKS[0],
            id: 'counters-white',
            cards: [...DECKS[0].cards.slice(36), 'Kilo, Apogee Mind', 'Auntie Ool, Cursewretch', 'Hope Estheim', 'Giada, Font of Hope', 'Wilhelt, the Rotcleaver'],
            basics: { Plains: 6, Swamp: 6, Island: 4, Mountain: 3, Forest: 3 },
          };
          return [green, DECKS[1], white, DECKS[2]];
        },
      },
    ],
  },
  hashaton: {
    title: 'the Hashaton deck',
    groups: [{ seeds: [91, 92, 93], name: (seed) => `seed ${seed}: bots play it to a finish`, decks: () => [deck('hashaton'), deck('kuja'), deck('yshtola'), deck('ketramose')] }],
  },
  'hashaton-pair': {
    title: 'two Hashaton decks',
    groups: [{ seeds: [94, 95], name: (seed) => `seed ${seed}: two copies of it play to a finish`, decks: () => [deck('hashaton'), DECKS[3], { ...deck('hashaton'), id: 'hashaton2' }, deck('ketramose')] }],
  },
};

/** Every game, as the file it is played in: `<set>-<seed>.test.ts`. */
export const gameFiles = (): string[] => Object.entries(GAMES).flatMap(([set, s]) => s.groups.flatMap((g) => g.seeds.map((seed) => `${set}-${seed}.test.ts`)));

/** Plays game `seed` of `set` to a finish, as one test. */
export function play(set: string, seed: number) {
  const s = GAMES[set];
  const group = s?.groups.find((g) => g.seeds.includes(seed));
  if (!group) throw new Error(`No game ${set} seed ${seed} in tests/simulation/games.ts`);
  describe(s.title, () => {
    it(group.name(seed), { tags: ['game'] }, () => {
      const { g, actions } = playOut(seed, group.decks());
      expect(g.winner).not.toBe(null);
      if (group.report) console.log(`seed ${seed}: ${g.winner === 'draw' ? 'draw' : g.players[g.winner!].deckId} wins on turn ${g.turn} after ${actions} actions`);
    });
  });
}
