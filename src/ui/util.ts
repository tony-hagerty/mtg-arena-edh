import type { MouseEvent } from 'react';
import type { Card, PlayerId } from '../engine';
import { useStore } from './store';

/** Joins class names, skipping falsy ones. */
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** The table edge each player sits at, by player id: you at the bottom, then clockwise in turn order. */
export const SEATS = ['bottom', 'left', 'top', 'right'] as const;

/** Can the human look at this card? Not one exiled face down, unless they may look at it (406.3). */
export const faceUp = (c: Card, me: PlayerId | null) => !c.faceDown || (me !== null && c.known.includes(me));

/** Shows the big card preview while the pointer is over an element. */
export const hoverProps = (name: string) => ({
  onMouseEnter: (e: MouseEvent<HTMLElement>) => useStore.setState({ hover: { name, el: e.currentTarget } }),
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
