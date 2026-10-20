// The river's geometry (src/ui/River.tsx): a real path at a normal stage, nothing while the
// window has no size. A hidden or zero-size window gives a root font-size of 0 (styles.css),
// so the stage in rem is 0, NaN or Infinity, and the river used to crash the game screen
// looking for rocks on a channel with no samples.
import { describe, expect, it } from 'vitest';
import { riverGeometry } from '../src/ui/River';

const finite = (d: string) => !/NaN|Infinity/.test(d) && d.length > 0;

describe('the river', () => {
  it('draws one channel across a normal stage', () => {
    const [part, ...rest] = riverGeometry(192, 108);
    expect(rest).toEqual([]);
    expect(part.bank.startsWith('M')).toBe(true);
    expect(part.bank.endsWith('Z')).toBe(true);
    for (const d of [part.bank, part.centre, ...part.flows]) expect(finite(d)).toBe(true);
    expect(part.rocks.length).toBeGreaterThanOrEqual(2);
    for (const r of part.rocks) for (const n of [r.x, r.y, r.rx, r.ry, r.turn]) expect(Number.isFinite(n)).toBe(true);
    // The rocks lie in the river's band: well above the bottom edge and not above the stage.
    for (const r of part.rocks) expect(r.y).toBeGreaterThan(0);
  });

  it('draws nothing while the stage has no size', () => {
    expect(riverGeometry(0, 0)).toEqual([]);
    expect(riverGeometry(192, 0)).toEqual([]);
    expect(riverGeometry(0, 108)).toEqual([]);
    expect(riverGeometry(NaN, NaN)).toEqual([]);
    expect(riverGeometry(Infinity, Infinity)).toEqual([]);
    expect(riverGeometry(-5, -5)).toEqual([]);
  });

  it('still draws a valid river at a tiny stage', () => {
    const parts = riverGeometry(1, 1);
    expect(parts.length).toBe(1);
    for (const d of [parts[0].bank, parts[0].centre, ...parts[0].flows]) expect(finite(d)).toBe(true);
    expect(parts[0].rocks.length).toBeGreaterThanOrEqual(2);
  });
});
