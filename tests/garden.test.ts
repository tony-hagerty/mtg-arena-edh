// The 3D table's board (src/ui/three/garden.ts): four seasonal beds of raked sand around a koi pond.
import { describe, expect, it } from 'vitest';
import { POND_CLEAR, bedDistance, bedOutline, gardenMaps, gardenPlan } from '../src/ui/three/garden';
import { tableHeight, DEPTH } from '../src/ui/camera';

const W = 192;
const H = 108;
const TABLE_H = tableHeight(H, DEPTH);
const plan = gardenPlan(W, H, W, TABLE_H);

describe('gardenPlan', () => {
  it('gives each corner a bed, in turn order from yours: spring, summer, autumn, winter', () => {
    expect(plan.beds.map((b) => b.season)).toEqual(['spring', 'summer', 'autumn', 'winter']);
    const [bl, tl, tr, br] = plan.beds;
    expect(bl.x1).toBeLessThan(0);
    expect(tl.x1).toBeLessThan(0);
    expect(tr.x0).toBeGreaterThan(0);
    expect(br.x0).toBeGreaterThan(0);
    expect(bl.y1).toBeLessThan(tl.y0);
    expect(br.y1).toBeLessThan(tr.y0);
    for (const b of plan.beds) {
      expect(b.x0).toBeGreaterThan(-W / 2);
      expect(b.x1).toBeLessThan(W / 2);
      expect(b.y0).toBeGreaterThan(0);
      expect(b.y1).toBeLessThan(TABLE_H);
    }
  });

  it('puts the pond where the paths cross, and keeps every bed clear of it', () => {
    expect(plan.pond.x).toBe(0);
    expect(plan.pond.y).toBeGreaterThan(plan.beds[0].y1);
    expect(plan.pond.y).toBeLessThan(plan.beds[1].y0);
    for (const b of plan.beds) {
      expect(bedDistance(plan, b, plan.pond.x, plan.pond.y)).toBeGreaterThan(0);
      for (const [x, y] of bedOutline(plan, b, 0)) expect(Math.hypot(x - plan.pond.x, y - plan.pond.y)).toBeGreaterThan(plan.pond.r + POND_CLEAR - 1e-6);
    }
  });
});

describe('gardenMaps', () => {
  const px = 1;
  const m = gardenMaps(plan, W, TABLE_H, px);
  const alpha = (x: number, y: number) => m.albedo[(Math.floor(y * px) * m.width + Math.floor(x * px + (W / 2) * px)) * 4 + 3];

  it('covers the beds with sand and leaves the paths and the pond clear', () => {
    expect(m.width).toBe(W);
    expect(m.height).toBe(Math.round(TABLE_H));
    const b = plan.beds[0];
    expect(alpha((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)).toBe(255);
    // The path between the left and right beds, and the pond.
    expect(alpha(0, b.y0 + 5)).toBe(0);
    expect(alpha(plan.pond.x, plan.pond.y)).toBe(0);
  });

  it('is the same every time', () => {
    expect(gardenMaps(plan, W, TABLE_H, px).albedo).toEqual(m.albedo);
  });
});
