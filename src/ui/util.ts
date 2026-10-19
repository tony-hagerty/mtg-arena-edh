import type { MouseEvent } from 'react';
import type { Card, CardData, Game, PlayerId } from '../engine';
import { useStore } from './store';

/** Joins class names, skipping falsy ones. */
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** The edges of the table. */
export const SEATS = ['bottom', 'left', 'top', 'right'] as const;
export type Seat = (typeof SEATS)[number];

/** Where the others sit, clockwise in turn order after you, by how many players there are. */
const LAYOUTS: Record<number, Seat[]> = {
  2: ['bottom', 'top'],
  3: ['bottom', 'left', 'right'],
  4: ['bottom', 'left', 'top', 'right'],
};

/**
 * The table edge a player sits at as `viewer` sees it: the viewer at the bottom, then the
 * others clockwise in turn order. Watching bots, seat 0 is at the bottom.
 */
export function seatOf(g: Game, viewer: PlayerId | null, pid: PlayerId): Seat {
  const n = g.players.length;
  return LAYOUTS[n][(pid - (viewer ?? 0) + n) % n];
}

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
export const hoverProps = (card: string | CardData, { pinOnly = false } = {}) => ({
  onMouseEnter: (e: MouseEvent<HTMLElement>) =>
    useStore.setState({
      hover: { ...(typeof card === 'string' ? { name: card } : { name: card.name, d: card }), el: e.currentTarget, ...(pinOnly && { pinOnly }) },
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
