// Plays a bot-vs-bot game for the files in this folder (see games.ts: one game a file, so
// Vitest plays them at the same time on every core), checking the game after every action.
import { applyBotAction, botAction, newGame } from '../../src/engine';
import type { Card, Game } from '../../src/engine';
import type { DeckDef } from '../../src/cards/db';
import '../fixtures';

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
  // Phased-out permanents are still on the battlefield, treated as though they don't exist (702.26b).
  for (const p of g.players) {
    for (const c of p.phasedOut ?? []) {
      if (seen.has(c.id)) throw new Error(`card ${c.name} (${c.id}) is phased out and somewhere else`);
      seen.add(c.id);
      if (!c.isToken) owned[c.owner].push(c);
    }
  }
  // A spell on the stack is a card too (601.2a). A copy of a spell isn't a card (707.10).
  for (const x of g.stack) {
    // Nor is a spell cast from a copy of a card (707.12, paradigm and Mizzix's Mastery).
    if (x.kind !== 'spell' || x.copy || x.card.isToken) continue;
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

export function playOut(seed: number, decks?: DeckDef[]) {
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
