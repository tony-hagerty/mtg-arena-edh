import { useSyncExternalStore } from 'react';

const read = () => parseFloat(getComputedStyle(document.documentElement).fontSize);
const subscribe = (onChange: () => void) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};

/**
 * Pixels per rem. The root font-size follows the window size (see styles.css), and
 * Motion needs transform distances in pixels, so animated offsets are `n * rem`.
 */
export const useRem = () => useSyncExternalStore(subscribe, read);
