import type { Game, PlayerId } from '../engine';

/** Every sound the game plays; synth.ts says how each is made. */
export type Sound =
  | 'click'
  | 'confirm'
  | 'cancel'
  | 'select'
  | 'hover'
  | 'error'
  | 'board'
  | 'release'
  | 'decision'
  | 'turn'
  | 'damage'
  | 'life-gain'
  | 'win'
  | 'lose'
  | 'draw'
  | 'cast'
  | 'enter'
  | 'resolve'
  | 'shuffle';

const total = (g: Game, zone: 'battlefield') => g.players.reduce((n, p) => n + p[zone].length, 0);

/**
 * The one sound for a change of game state, seen from seat `me` (null: watching), or null
 * for none. Only the most important change is heard, so a busy update doesn't play a pile of
 * sounds at once. It reads only what every seat can see: counts, life, the stack, whose turn.
 */
export function gameSound(prev: Game | null, next: Game, me: PlayerId | null): Sound | null {
  if (prev === next) return null;
  // A new game: the decks are shuffled (103.3).
  if (!prev || prev.players.length !== next.players.length || next.log.length < prev.log.length) return 'shuffle';
  if (next.winner !== null && prev.winner === null) return me === null || next.winner === me ? 'win' : 'lose';
  if (me !== null && next.players[me].lost && !prev.players[me].lost) return 'lose';
  if (next.active === me && (prev.active !== me || prev.turn !== next.turn)) return 'turn';
  const lifeLost = next.players.some((p, i) => p.life < prev.players[i].life);
  if (lifeLost) return 'damage';
  if (next.players.some((p, i) => p.life > prev.players[i].life)) return 'life-gain';
  if (next.stack.length > prev.stack.length) return 'cast';
  if (total(next, 'battlefield') > total(prev, 'battlefield')) return 'enter';
  if (next.stack.length < prev.stack.length) return 'resolve';
  if (me !== null) {
    const [was, now] = [prev.players[me], next.players[me]];
    if (now.hand.length > was.hand.length && now.library.length < was.library.length) return 'draw';
    // A mulligan shuffles the hand away and draws a new one (103.5).
    if (next.mulligan && now.hand.some((c, i) => c.id !== was.hand[i]?.id)) return 'shuffle';
    // Someone else's move asks you something.
    if (next.decision && next.priority === me && prev.priority !== me) return 'decision';
  }
  return null;
}
