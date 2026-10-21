// The splash over the board while the 3D table loads (src/ui/BoardSplash.tsx): its bar only fills.
import { describe, expect, it } from 'vitest';
import { STEP_PROGRESS, laterStep } from '../src/ui/BoardSplash';
import type { BoardStep } from '../src/ui/BoardSplash';

const ORDER: BoardStep[] = ['loading', 'loaded', 'renderer', 'drawn'];

describe('board splash', () => {
  it('fills the bar further at each step, and full once drawn', () => {
    const widths = ORDER.map((s) => STEP_PROGRESS[s]);
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
    expect(new Set(widths).size).toBe(ORDER.length);
    expect(STEP_PROGRESS.drawn).toBe(100);
  });

  it('never goes back a step when one is reported late', () => {
    expect(laterStep('renderer', 'loaded')).toBe('renderer');
    expect(laterStep('loaded', 'renderer')).toBe('renderer');
    expect(laterStep('drawn', 'loading')).toBe('drawn');
  });
});
