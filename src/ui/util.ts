import type { MouseEvent } from 'react';
import type { Card, CardData, Game, PlayerId } from '../engine';
import { useStore } from './store';

/** Joins class names, skipping falsy ones. */
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/**
 * Where a player sits: a corner of the table, or the whole bottom edge (`full`) when you
 * have it to yourself.
 */
export interface Seat {
  v: 'top' | 'bottom';
  h: 'left' | 'right' | 'full';
}

const BL: Seat = { v: 'bottom', h: 'left' };
const TL: Seat = { v: 'top', h: 'left' };
const TR: Seat = { v: 'top', h: 'right' };
const BR: Seat = { v: 'bottom', h: 'right' };
const BOTTOM: Seat = { v: 'bottom', h: 'full' };

/**
 * Where everyone sits, by how many players there are: you first, then the others clockwise
 * in turn order. Two players sit across the table from each other; three leave you the whole
 * bottom edge.
 */
const LAYOUTS: Record<number, Seat[]> = {
  2: [BL, TR],
  3: [BOTTOM, TL, TR],
  4: [BL, TL, TR, BR],
};

/**
 * The seat a player sits at as `viewer` sees it: the viewer at the bottom left (or along the
 * whole bottom), then the others clockwise in turn order. Watching bots, seat 0 is the viewer's.
 */
export function seatOf(g: Game, viewer: PlayerId | null, pid: PlayerId): Seat {
  const n = g.players.length;
  return LAYOUTS[n][(pid - (viewer ?? 0) + n) % n];
}

/** The class names for a seat: `seat-bottom-left` and the like, plus `seat-bottom` or `seat-top`, and `seat-left` or `seat-right` for a corner. */
export const seatClass = (s: Seat) => cx(`seat-${s.v}-${s.h}`, `seat-${s.v}`, s.h !== 'full' && `seat-${s.h}`);

/** The players in the order the viewer sees them: themself first, then clockwise in turn order. */
export function fromSeat<T extends { id: PlayerId }>(players: T[], viewer: PlayerId | null): T[] {
  const at = viewer ?? 0;
  return [...players.slice(at), ...players.slice(0, at)];
}

/** Can the human look at this card? Not one exiled face down, unless they may look at it (406.3). */
export const faceUp = (c: Card, me: PlayerId | null) => !c.faceDown || (me !== null && c.known.includes(me));

/**
 * Shows the big card preview while the pointer is over an element: a card by its name, or a
 * card in the game by its data (`data(card)`), which a token or a copy needs. Right-click
 * pins it (`Preview`). With `pinOnly` only right-click shows it, for a card already shown big.
 */
export const hoverProps = (card: string | CardData, { pinOnly = false, textless = false } = {}) => ({
  onMouseEnter: (e: MouseEvent<HTMLElement>) =>
    useStore.setState({
      hover: { ...(typeof card === 'string' ? { name: card } : { name: card.name, d: card }), el: e.currentTarget, ...(pinOnly && { pinOnly }), ...(textless && { textless }) },
    }),
  onMouseLeave: () => useStore.setState({ hover: null }),
});

/**
 * A CSS colour for a deck's colours: the frame colour of a mono deck, an even blend of a
 * multicolour deck's colours, or the artifact grey for a colourless one.
 */
export function deckColor(colors: readonly string[]): string {
  if (!colors.length) return 'var(--f-artifact)';
  // Each colour mixed in gets an equal share: the k-th one keeps the first k-1 at (k-1)/k.
  return colors
    .map((c) => `var(--f-${c})`)
    .reduce((acc, c, i) => `color-mix(in srgb, ${acc} ${((i / (i + 1)) * 100).toFixed(1)}%, ${c})`);
}

/**
 * The stack item whose target arrows show: the one the pointer is on, or else the top of the
 * stack, the one about to resolve. Null when there is nothing on the stack.
 */
export function arrowsFrom(g: Game, hovered: string | null): string | null {
  if (hovered && g.stack.some((x) => x.id === hovered)) return hovered;
  return g.stack[g.stack.length - 1]?.id ?? null;
}

/**
 * Where a line from the middle of `box` toward (`x`, `y`) leaves it: the point on its edge an
 * arrow starts from, so it comes out of the side that faces its target.
 */
export function edgeToward(box: { left: number; top: number; width: number; height: number }, x: number, y: number): { x: number; y: number } {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const dx = x - cx;
  const dy = y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  // The line's first crossing of a side: the nearer of the vertical and horizontal ones.
  const k = Math.min(dx ? box.width / 2 / Math.abs(dx) : Infinity, dy ? box.height / 2 / Math.abs(dy) : Infinity, 1);
  return { x: cx + dx * k, y: cy + dy * k };
}

/**
 * An arrow from one card on the stack to another (a counterspell's target): the cards
 * overlap, so a straight line between them has nowhere to go. It leaves `from` by its left
 * side, loops out left of the stack, and comes back in to the left end of the part of `to`
 * that shows (`strip` high, from its top), pointing right at it. An SVG path.
 */
export function stackLoop(from: { left: number; top: number; width: number; height: number }, to: { left: number; top: number; width: number }, strip: number): string {
  const x1 = from.left;
  const y1 = from.top + from.height / 2;
  const x2 = to.left;
  const y2 = to.top + strip / 2;
  // How far out the loop swings: about half a card, more for cards further apart.
  const out = from.width * 0.45 + Math.abs(y2 - y1) * 0.25;
  return `M${x1} ${y1} C${x1 - out} ${y1} ${x2 - out} ${y2} ${x2} ${y2}`;
}
