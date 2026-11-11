import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import iconUrl from './icon.svg';

/**
 * How far the 3D table has got, in order: its code is still `loading`, it has `loaded` (the
 * scene's first render), its `renderer` has started (WebGPU or WebGL 2), and it has `drawn`
 * its first frames. The canvas is blank until then: those frames build the shaders.
 */
export type BoardStep = 'loading' | 'loaded' | 'renderer' | 'drawn';

/** How full the loading bar is at each step, in percent. */
export const STEP_PROGRESS: Record<BoardStep, number> = { loading: 12, loaded: 45, renderer: 75, drawn: 100 };

/** The later of two steps: the steps can only go forward. */
export const laterStep = (a: BoardStep, b: BoardStep): BoardStep => (STEP_PROGRESS[b] > STEP_PROGRESS[a] ? b : a);

/** The longest the splash stays up, in ms, so a table that never reports drawing can't hide the game for good. */
export const SPLASH_MAX_MS = 15000;

/** How long the full bar stays up before the splash fades, in ms, so it is seen to fill. */
const FULL_MS = 300;

/** The five colours, clockwise round the ring from its top. */
const MANA = ['w', 'u', 'b', 'r', 'g'];

/**
 * Over the board while the 3D table loads: the logo inside a slowly turning ring of the five
 * mana symbols (the title screen's ring), the game's name, and a gold line that fills as the
 * table gets through each step. It fades once the table has drawn.
 */
export function BoardSplash({ step }: { step: BoardStep }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (step !== 'drawn') return;
    const t = setTimeout(() => setGone(true), FULL_MS);
    return () => clearTimeout(t);
  }, [step]);
  return (
    <AnimatePresence>
      {!gone && (
        <motion.div
          className="board-splash"
          role="status"
          aria-live="polite"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.45 } }}
        >
          <div className="board-splash-emblem">
            <div className="board-splash-ring" aria-hidden="true">
              {MANA.map((c, i) => (
                <i key={c} className={`ms ms-cost ms-shadow ms-${c}`} style={{ '--i': i } as CSSProperties} />
              ))}
            </div>
            <img className="board-splash-logo" src={iconUrl} alt="" />
          </div>
          <h1>Commander Table</h1>
          <p className="board-splash-text">Loading board state…</p>
          <div className="board-splash-bar">
            <div style={{ width: `${STEP_PROGRESS[step]}%` }} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
