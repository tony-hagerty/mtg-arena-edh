import { isHidden } from '../engine';
import type { Card, Game, PlayerId, StackItem } from '../engine';

/** Where a card can be, as the screen draws it: a player's zone, or the stack. */
export type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command' | 'stack';

/** Where one card is: the zone, and whose zone it is (the stack's is the spell's controller). */
export interface Place {
  zone: Zone;
  pid: PlayerId;
}

/**
 * A card that changed zones between two games. A card nobody could see before (an
 * opponent's card cast from the hand) gets the hidden zone it most likely came from; `from` is
 * null for one that is new (a token) or whose zone can't be told.
 */
export interface ZoneMove {
  card: Card;
  from: Place | null;
  to: Place;
}

const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'] as const;

/**
 * Every card's place by id. A spell's card is on the stack; an ability's card is only its
 * source, so it isn't. Phased-out permanents still count as on the battlefield (702.26b): they
 * stay drawn there. Stand-ins for hidden cards (`isHidden`) are left out: their ids are their
 * places in the zone, not the cards.
 */
function places(g: Game) {
  const at = new Map<string, Place & { card: Card }>();
  for (const p of g.players) {
    for (const zone of ZONES) for (const card of p[zone]) if (!isHidden(card)) at.set(card.id, { zone, pid: p.id, card });
    for (const card of p.phasedOut ?? []) at.set(card.id, { zone: 'battlefield', pid: p.id, card });
  }
  for (const item of g.stack) if (item.kind === 'spell') at.set(item.card.id, { zone: 'stack', pid: item.controller, card: item.card });
  return at;
}

/**
 * Where a card nobody could see came from: a hidden zone of its owner's that shrank, the hand
 * before the library (a card cast or played). Null for a token, which comes from nowhere (111.1).
 */
function hiddenSource(prev: Game, next: Game, card: Card): Place | null {
  if (card.isToken) return null;
  const [was, now] = [prev.players[card.owner], next.players[card.owner]];
  if (now.hand.length < was.hand.length) return { zone: 'hand', pid: card.owner };
  if (now.library.length < was.library.length) return { zone: 'library', pid: card.owner };
  return null;
}

/** Is `next` a different game from `prev` (a new game, or another table), rather than its next state? */
export const newGame = (prev: Game, next: Game) => prev.players.length !== next.players.length || next.log.length < prev.log.length;

/**
 * The cards that moved from one zone to another between `prev` and `next`, in the order
 * `next` holds them. A permanent changing controller stays on the battlefield, so it isn't a
 * move. A card that left the game entirely (a token or a copy ceasing to exist, 704.5d,
 * 707.10a) isn't one either: it has nowhere to go.
 */
export function zoneMoves(prev: Game | null, next: Game): ZoneMove[] {
  if (!prev || prev === next || newGame(prev, next)) return [];
  const before = places(prev);
  const moves: ZoneMove[] = [];
  for (const [id, { card, zone, pid }] of places(next)) {
    const was = before.get(id);
    if (was?.zone === zone && (zone === 'battlefield' || was.pid === pid)) continue;
    moves.push({ card, from: was ? { zone: was.zone, pid: was.pid } : hiddenSource(prev, next, card), to: { zone, pid } });
  }
  return moves;
}

/** The stack items in `prev` that are gone from `next`: they resolved, or were countered or removed (608, 701.6). */
export function leftStack(prev: Game | null, next: Game): StackItem[] {
  if (!prev || prev === next || newGame(prev, next)) return [];
  const ids = new Set(next.stack.map((s) => s.id));
  return prev.stack.filter((s) => !ids.has(s.id));
}
