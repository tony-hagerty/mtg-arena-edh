import type { MouseEvent } from 'react';
import { useStore } from './store';

/** Joins class names, skipping falsy ones. */
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** The table edge each player sits at, by player id: you at the bottom, then clockwise in turn order. */
export const SEATS = ['bottom', 'left', 'top', 'right'] as const;

/** Shows the big card preview while the pointer is over an element. */
export const hoverProps = (name: string) => ({
  onMouseEnter: (e: MouseEvent<HTMLElement>) => useStore.setState({ hover: { name, el: e.currentTarget } }),
  onMouseLeave: () => useStore.setState({ hover: null }),
});
