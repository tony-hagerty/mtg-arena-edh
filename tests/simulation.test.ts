import { describe, expect, it } from 'vitest';
import { applyBotAction, botAction, newGame } from '../src/engine';
import type { Game } from '../src/engine';
import { DECKS } from '../src/cards/db';
import type { DeckDef } from '../src/cards/db';
import './fixtures';
import { twoCommanderDeck } from './helpers';

/** Checks things that must hold after every single action. `sizes` is each player's deck size. */
function checkInvariants(g: Game, sizes: number[]) {
  const seen = new Set<string>();
  for (const p of g.players) {
    const zones = [p.library, p.hand, p.battlefield, p.graveyard, p.exile, p.command];
    const names = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
    let real = 0;
    zones.forEach((zone, i) => {
      for (const c of zone) {
        if (seen.has(c.id)) throw new Error(`card ${c.name} (${c.id}) is in two places`);
        seen.add(c.id);
        if (c.zone !== names[i]) throw new Error(`${c.name} thinks it is in ${c.zone} but is in ${names[i]}`);
        if (c.owner !== p.id) throw new Error(`${c.name} is in the wrong player's zone`);
        if (!c.isToken) real++;
      }
    });
    // A spell on the stack is a card too (601.2a).
    // A copy of a spell isn't a card (707.10).
    const casting = g.stack.filter((x) => x.kind === 'spell' && x.card.owner === p.id && !x.copy).map((x) => x.card);
    for (const c of casting) {
      if (seen.has(c.id)) throw new Error(`card ${c.name} (${c.id}) is on the stack and somewhere else`);
      seen.add(c.id);
      if (c.zone !== 'stack') throw new Error(`${c.name} thinks it is in ${c.zone} but is on the stack`);
    }
    real += casting.length;
    if (!p.lost && real !== sizes[p.id]) throw new Error(`${p.name} has ${real} cards instead of ${sizes[p.id]}`);
    const commanders = [...p.command, ...p.battlefield, ...p.hand, ...p.library, ...p.graveyard, ...p.exile, ...casting].filter((c) => c.isCommander).length;
    if (!p.lost && commanders !== p.commanders.length) throw new Error(`${p.name} has ${commanders} commanders instead of ${p.commanders.length}`);
    // Bots always send their commander home (903.9), once nothing is partway through resolving.
    if (!g.resolving && [...p.graveyard, ...p.exile, ...p.hand, ...p.library].some((c) => c.isCommander)) throw new Error(`${p.name}'s commander didn't go home`);
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
