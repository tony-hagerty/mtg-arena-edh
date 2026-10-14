import { describe, expect, it } from 'vitest';
import { applyBotAction, botAction, newGame } from '../src/engine';
import type { Game } from '../src/engine';

/** Checks things that must hold after every single action. */
function checkInvariants(g: Game) {
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
    const casting = g.stack.filter((x) => x.kind === 'spell' && x.card.owner === p.id).map((x) => x.card);
    for (const c of casting) {
      if (seen.has(c.id)) throw new Error(`card ${c.name} (${c.id}) is on the stack and somewhere else`);
      seen.add(c.id);
      if (c.zone !== 'stack') throw new Error(`${c.name} thinks it is in ${c.zone} but is on the stack`);
    }
    real += casting.length;
    if (!p.lost && real !== 60) throw new Error(`${p.name} has ${real} cards instead of 60`);
    const commanders = [...p.command, ...p.battlefield, ...p.hand, ...casting].filter((c) => c.isCommander).length;
    if (!p.lost && commanders !== 1) throw new Error(`${p.name}'s commander is missing`);
  }
  if (g.step !== 'gameOver' && g.players[g.priority].lost) throw new Error('a dead player has priority');
  if (g.triggers.length && !g.decision && g.step !== 'gameOver') throw new Error('a triggered ability was left waiting');
  if (g.stack.some((x) => g.players[x.controller].lost)) throw new Error('a dead player has something on the stack');
  for (const a of g.combat?.attacks ?? []) {
    if (g.players[a.defender].lost) throw new Error('attacking a dead player');
  }
}

function playOut(seed: number) {
  let g = newGame({ seed, humanDeck: null });
  let actions = 0;
  while (g.step !== 'gameOver') {
    const next = applyBotAction(g, botAction(g, g.priority));
    if (next === g) throw new Error(`seed ${seed}: bot stalled at step ${g.step}`);
    g = next;
    checkInvariants(g);
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
