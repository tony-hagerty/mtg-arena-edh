// The 3D table's board (src/ui/three/garden.ts): four seasonal mats, each a seat's battlefield, around the koi pond that is the exile.
import { describe, expect, it } from 'vitest';
import { PILE, POND_CLEAR, bedAt, bedDistance, bedMaps, bedOutline, gardenPlan, seatArea } from '../src/ui/three/garden';
import { camera, tableHeight, DEPTH } from '../src/ui/camera';
import type { Seat } from '../src/ui/util';

const W = 192;
const H = 108;
const TABLE_H = tableHeight(H, DEPTH);
const plan = gardenPlan(W, TABLE_H);
const SEATS: Seat[] = [
  { v: 'bottom', h: 'left' },
  { v: 'top', h: 'left' },
  { v: 'top', h: 'right' },
  { v: 'bottom', h: 'right' },
];

describe('gardenPlan', () => {
  it('gives each corner a mat, in turn order from yours: spring moss, summer sand, autumn gravel, winter stone', () => {
    expect(plan.beds.map((b) => `${b.season} ${b.material}`)).toEqual(['spring moss', 'summer sand', 'autumn gravel', 'winter stone']);
    const [bl, tl, tr, br] = plan.beds;
    expect(bl.x1).toBeLessThan(0);
    expect(tl.x1).toBeLessThan(0);
    expect(tr.x0).toBeGreaterThan(0);
    expect(br.x0).toBeGreaterThan(0);
    expect(bl.y1).toBeLessThan(tl.y0);
    for (const b of plan.beds) {
      expect(b.x0).toBeGreaterThan(-W / 2);
      expect(b.x1).toBeLessThan(W / 2);
      expect(b.y0).toBeGreaterThan(0);
      expect(b.y1).toBeLessThan(TABLE_H);
    }
  });

  it('makes the mats one size on the table, so the far ones look smaller', () => {
    const sizes = plan.beds.map((b) => [b.x1 - b.x0, b.y1 - b.y0]);
    for (const [w, h] of sizes) {
      expect(w).toBeCloseTo(sizes[0][0], 9);
      expect(h).toBeCloseTo(sizes[0][1], 9);
    }
  });

  it('puts the pond where the paths cross, and keeps every mat clear of it', () => {
    expect(plan.pond.x).toBe(0);
    expect(plan.pond.y).toBeGreaterThan(plan.beds[0].y1);
    expect(plan.pond.y).toBeLessThan(plan.beds[1].y0);
    expect(bedAt(plan, plan.pond.x, plan.pond.y)).toBeNull();
    for (const b of plan.beds) {
      expect(bedDistance(plan, b, plan.pond.x, plan.pond.y)).toBeGreaterThan(0);
      expect(bedAt(plan, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)).toBe(b);
      for (const [x, y] of bedOutline(plan, b, 0)) expect(Math.hypot(x - plan.pond.x, y - plan.pond.y)).toBeGreaterThan(plan.pond.r + POND_CLEAR - 1e-6);
    }
  });
});

describe('seatArea', () => {
  /** A box from `seatArea` back in the table's terms (x from the middle, y up). */
  const span = (box: { left: number; top: number; width: number; height: number }) => ({ x0: box.left - W / 2, x1: box.left + box.width - W / 2, y0: TABLE_H - box.top - box.height, y1: TABLE_H - box.top });

  it("lays each seat's rows inside its own mat, clear of the pond and of its piles", () => {
    SEATS.forEach((seat, i) => {
      const { box, piles } = seatArea(seat, plan, W, H, W, TABLE_H);
      const b = plan.beds[i];
      const s = span(box);
      expect(box.lean).toBe(0);
      expect(s.x0).toBeGreaterThanOrEqual(b.x0);
      expect(s.x1).toBeLessThanOrEqual(b.x1);
      expect(s.y0).toBeGreaterThanOrEqual(b.y0);
      expect(s.y1).toBeLessThanOrEqual(b.y1);
      // No corner of the box reaches into the pond's clearing.
      for (const [x, y] of [[s.x0, s.y0], [s.x1, s.y0], [s.x0, s.y1], [s.x1, s.y1]]) expect(Math.hypot(x - plan.pond.x, y - plan.pond.y)).toBeGreaterThan(plan.pond.r + POND_CLEAR);
      for (const p of [piles.library, piles.graveyard]) {
        expect(p.w).toBe(PILE.w);
        // The piles lie on the seat's own edge side of the rows.
        if (seat.v === 'bottom') expect(p.y + p.h / 2).toBeLessThan(s.y0);
        else expect(p.y - p.h / 2).toBeGreaterThan(s.y1);
        expect(bedAt(plan, p.x, p.y)).toBe(b);
      }
      // The library is nearest the middle across.
      expect(Math.abs(piles.library.x)).toBeLessThan(Math.abs(piles.graveyard.x));
    });
  });

  it('keeps your piles just above the bottom of the screen', () => {
    const { piles } = seatArea(SEATS[0], plan, W, H, W, TABLE_H);
    const cam = camera(W, H, 1);
    const near = cam.toScreen({ x: W / 2 + piles.library.x, y: TABLE_H - (piles.library.y - piles.library.h / 2) });
    expect(H - near.y).toBeGreaterThan(0.5);
    expect(H - near.y).toBeLessThan(2);
  });

  it('spans both near mats for the whole bottom edge', () => {
    const { box } = seatArea({ v: 'bottom', h: 'full' }, plan, W, H, W, TABLE_H);
    const s = span(box);
    expect(s.x0).toBeLessThan(plan.beds[0].x1);
    expect(s.x1).toBeGreaterThan(plan.beds[3].x0);
  });
});

describe('bedMaps', () => {
  it('covers a mat and leaves the rounded corners and the pond clear, the same every time', () => {
    for (const b of plan.beds) {
      const px = 4;
      const m = bedMaps(plan, b, px);
      const alpha = (x: number, y: number) => m.albedo[(Math.floor((y - b.y0) * px) * m.width + Math.floor((x - b.x0) * px)) * 4 + 3];
      expect(m.width).toBe(Math.round((b.x1 - b.x0) * px));
      expect(alpha((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)).toBe(255);
      // The very corner is outside the rounding.
      expect(alpha(b.x0 + 0.1, b.y0 + 0.1)).toBe(0);
      expect(bedMaps(plan, b, px).albedo).toEqual(m.albedo);
    }
  });
});
