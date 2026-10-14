import { describe, expect, it } from 'vitest';
import { applyBotAction, botAction, newGame } from '../src/engine';
import type { Card, Game } from '../src/engine';
import { DECKS } from '../src/cards/db';
import type { DeckDef } from '../src/cards/db';
import './fixtures';
import { twoCommanderDeck } from './helpers';

/** Checks things that must hold after every single action. `sizes` is each player's deck size. */
function checkInvariants(g: Game, sizes: number[]) {
  const seen = new Set<string>();
  const owned = g.players.map(() => [] as Card[]);
  for (const p of g.players) {
    const zones = [p.library, p.hand, p.battlefield, p.graveyard, p.exile, p.command];
    const names = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
    zones.forEach((zone, i) => {
      for (const c of zone) {
        if (seen.has(c.id)) throw new Error(`card ${c.name} (${c.id}) is in two places`);
        seen.add(c.id);
        if (c.zone !== names[i]) throw new Error(`${c.name} thinks it is in ${c.zone} but is in ${names[i]}`);
        // A permanent is on its controller's side (110.2); any other card is in its owner's zone.
        if ((c.zone === 'battlefield' ? c.controller : c.owner) !== p.id) throw new Error(`${c.name} is in the wrong player's zone`);
        if (c.zone !== 'battlefield' && c.controller !== c.owner) throw new Error(`${c.name} is controlled by a non-owner off the battlefield`);
        if (!c.isToken) owned[c.owner].push(c);
      }
    });
  }
  // A spell on the stack is a card too (601.2a). A copy of a spell isn't a card (707.10).
  for (const x of g.stack) {
    if (x.kind !== 'spell' || x.copy) continue;
    const c = x.card;
    if (seen.has(c.id)) throw new Error(`card ${c.name} (${c.id}) is on the stack and somewhere else`);
    seen.add(c.id);
    if (c.zone !== 'stack') throw new Error(`${c.name} thinks it is in ${c.zone} but is on the stack`);
    owned[c.owner].push(c);
  }
  for (const p of g.players) {
    if (p.lost) continue;
    if (owned[p.id].length !== sizes[p.id]) throw new Error(`${p.name} has ${owned[p.id].length} cards instead of ${sizes[p.id]}`);
    const commanders = owned[p.id].filter((c) => c.isCommander);
    if (commanders.length !== p.commanders.length) throw new Error(`${p.name} has ${commanders.length} commanders instead of ${p.commanders.length}`);
    // Bots always send their commander home (903.9), once nothing is partway through resolving.
    if (!g.resolving && commanders.some((c) => ['graveyard', 'exile', 'hand', 'library'].includes(c.zone))) throw new Error(`${p.name}'s commander didn't go home`);
  }
  if (g.step !== 'gameOver' && g.players[g.priority].lost) throw new Error('a dead player has priority');
  if (g.triggers.length && !g.decision && g.step !== 'gameOver') throw new Error('a triggered ability was left waiting');
  if (g.stack.some((x) => g.players[x.controller].lost)) throw new Error('a dead player has something on the stack');
  for (const a of g.combat?.attacks ?? []) {
    if (g.players[a.defender].lost) throw new Error('attacking a dead player');
  }
}

function playOut(seed: number, decks?: DeckDef[]) {
  let g = newGame({ seed, humanDeck: null, decks });
  const sizes = g.players.map((p) => p.library.length + p.hand.length + p.command.length);
  let actions = 0;
  while (g.step !== 'gameOver') {
    const next = applyBotAction(g, botAction(g, g.priority));
    if (next === g) throw new Error(`seed ${seed}: bot stalled at step ${g.step}`);
    g = next;
    checkInvariants(g, sizes);
    if (++actions > 20_000) throw new Error(`seed ${seed}: game did not finish (turn ${g.turn})`);
  }
  return { g, actions };
}

describe('four bots play full games', () => {
  const results: string[] = [];
  for (const seed of [11, 22, 33, 44, 55, 66]) {
    it(`seed ${seed} reaches a winner with a consistent state throughout`, () => {
      const { g, actions } = playOut(seed);
      expect(g.winner).not.toBe(null);
      const winner = g.winner === 'draw' ? 'draw' : g.players[g.winner!].deckId;
      results.push(`seed ${seed}: ${winner} wins on turn ${g.turn} after ${actions} actions`);
      console.log(results[results.length - 1]);
    });
  }
});

describe('a 100-card two-commander deck', () => {
  for (const seed of [7, 8, 9]) {
    it(`seed ${seed}: bots play it to a finish against the starter decks`, () => {
      const { g } = playOut(seed, [twoCommanderDeck(), DECKS[1], DECKS[3], DECKS[0]]);
      expect(g.winner).not.toBe(null);
    });
  }
});

describe('decks with X, hybrid, Phyrexian, kicker, sacrifice and alternative costs', () => {
  // Cards from tests/fixtures.ts, swapped in for basic lands and one black card.
  const boros = twoCommanderDeck();
  boros.cards.push('Blaze', 'Boros Recruit', 'Gut Shot', 'Burst Lightning', 'Flawless Maneuver', 'Thalia, Guardian of Thraben', 'Ruby Medallion');
  boros.basics = { Plains: 14, Mountain: 14 };
  const black = { ...DECKS[1], cards: [...DECKS[1].cards.slice(1), 'Bone Splinters'] };
  for (const seed of [4, 5, 6]) {
    it(`seed ${seed}: bots play them to a finish`, () => {
      const { g } = playOut(seed, [boros, black, DECKS[3], DECKS[0]]);
      expect(g.winner).not.toBe(null);
    });
  }
});

describe('decks with counterspells, modal spells and copies', () => {
  // Cards from tests/fixtures.ts, with Islands to cast the blue ones.
  const deck = twoCommanderDeck();
  deck.cards.push('Counterspell', 'Negate', 'Essence Scatter', 'Stifle', 'Cryptic Command', 'Boros Charm', 'Fiery Confluence', 'Reverberate');
  deck.basics = { Plains: 12, Mountain: 12, Island: 3 };
  for (const seed of [12, 13, 14]) {
    it(`seed ${seed}: bots play them to a finish`, () => {
      const { g } = playOut(seed, [deck, DECKS[1], { ...deck, id: 'boros2' }, DECKS[3]]);
      expect(g.winner).not.toBe(null);
    });
  }
});

describe('decks with counters, Auras, Equipment and Vehicles', () => {
  const deck = twoCommanderDeck();
  deck.cards.push('Pacifism', 'Holy Strength', 'Bonesplitter', 'Loxodon Warhammer', 'Untethered Express');
  deck.basics = { Plains: 16, Mountain: 14 };
  const black = { ...DECKS[1], cards: [...DECKS[1].cards.slice(1), "Black Sun's Zenith"] };
  for (const seed of [21, 22, 23]) {
    it(`seed ${seed}: bots play them to a finish`, () => {
      const { g } = playOut(seed, [deck, black, { ...deck, id: 'boros2' }, DECKS[3]]);
      expect(g.winner).not.toBe(null);
    });
  }
});

describe('decks with planeswalkers and battles', () => {
  const deck = twoCommanderDeck();
  deck.cards.push('Jace Beleren', 'Invasion of Dominaria');
  deck.basics = { Plains: 16, Mountain: 14, Island: 3 };
  const green = { ...DECKS[3], cards: [...DECKS[3].cards.slice(1), 'Garruk Wildspeaker'] };
  // Seeds where they come up: 36 uses Garruk until he runs out of loyalty, 38 attacks and defeats a battle.
  for (const seed of [35, 36, 38]) {
    it(`seed ${seed}: bots play them to a finish`, () => {
      const { g } = playOut(seed, [deck, DECKS[1], { ...deck, id: 'boros2' }, green]);
      expect(g.winner).not.toBe(null);
    });
  }
});

describe('decks with double-faced, split and adventurer cards, Sagas, Classes, flashback and tokens', () => {
  const deck = twoCommanderDeck();
  deck.cards.push('Invasion of Dominaria', 'Dead', 'Strike It Rich', 'Thraben Inspector', 'History of Benalia', 'Needleverge Pathway', 'Delver of Secrets', 'Think Twice', 'Wizard Class');
  deck.basics = { Plains: 14, Mountain: 13, Island: 4 };
  const black = { ...DECKS[1], cards: [...DECKS[1].cards.slice(2), 'Murderous Rider', 'Bake into a Pie'] };
  const green = { ...DECKS[3], cards: [...DECKS[3].cards.slice(1), 'Kazandu Mammoth'] };
  // Seeds where a lot of it comes up: 43 and 47 use flashback, Adventures and Treasure; 50 levels up Wizard Class.
  for (const seed of [43, 47, 50]) {
    it(`seed ${seed}: bots play them to a finish`, () => {
      const { g } = playOut(seed, [deck, black, { ...deck, id: 'boros2' }, green]);
      expect(g.winner).not.toBe(null);
    });
  }
});

describe('the Kraum and Tymna deck', () => {
  const kraum = DECKS.find((d) => d.id === 'kraum-tymna')!;
  for (const seed of [61, 62, 63]) {
    it(`seed ${seed}: bots play it to a finish against the starter decks`, () => {
      const { g } = playOut(seed, [kraum, DECKS[1], DECKS[0], DECKS[2]]);
      expect(g.winner).not.toBe(null);
    });
  }
  for (const seed of [64, 65]) {
    it(`seed ${seed}: two copies of it play to a finish`, () => {
      const { g } = playOut(seed, [kraum, DECKS[3], { ...kraum, id: 'kraum2' }, DECKS[1]]);
      expect(g.winner).not.toBe(null);
    });
  }
});

describe('the two-colour starter decks (session 8a)', () => {
  const [wb, br] = DECKS;
  const kraum = DECKS.find((d) => d.id === 'kraum-tymna')!;
  for (const seed of [71, 72]) {
    it(`seed ${seed}: white-black and black-red play to a finish`, () => {
      const { g } = playOut(seed, [wb, br, kraum, DECKS[3]]);
      expect(g.winner).not.toBe(null);
    });
  }
});

describe('the two-colour starter decks (session 8b)', () => {
  const [wb, br, rg, gw] = DECKS;
  for (const seed of [81, 82]) {
    it(`seed ${seed}: red-green and green-white play to a finish`, () => {
      const { g } = playOut(seed, [rg, gw, wb, br]);
      expect(g.winner).not.toBe(null);
    });
  }
});
