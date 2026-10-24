// The 3D table's board (src/ui/three/board.ts): four mats, each a seat's battlefield, around the well that is the exile.
import { describe, expect, it } from 'vitest';
import { PILE, POND_CLEAR, POND_R, SWIRL_MAX, bedAt, bedDistance, bedMaps, gardenPlan, seatArea, wellSwirl } from '../src/ui/three/board';
import { camera, tableHeight, DEPTH } from '../src/ui/camera';
import { floorMaps } from '../src/ui/three/floor';
import type { Seat } from '../src/ui/util';

const W = 192;
const H = 108;
const TABLE_H = tableHeight(H, DEPTH);
const plan = gardenPlan(W, H, W, TABLE_H);
const SEATS: Seat[] = [
  { v: 'bottom', h: 'left' },
  { v: 'top', h: 'left' },
  { v: 'top', h: 'right' },
  { v: 'bottom', h: 'right' },
];

describe('gardenPlan', () => {
  it('gives each corner a mat, in turn order from yours: leather, wood, slate, cloth', () => {
    expect(plan.beds.map((b) => b.material)).toEqual(['leather', 'wood', 'slate', 'cloth']);
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

  it('starts the near mats just above the bottom of the screen, so their edge shows', () => {
    const cam = camera(W, H, 1);
    const edge = cam.toScreen({ x: W / 2, y: TABLE_H - plan.beds[0].y0 });
    expect(H - edge.y).toBeGreaterThan(0.5);
    expect(H - edge.y).toBeLessThan(1.5);
  });

  it('puts the well where the paths cross, and keeps every mat clear of it', () => {
    expect(plan.pond.x).toBe(0);
    expect(plan.pond.y).toBeGreaterThan(plan.beds[0].y1);
    expect(plan.pond.y).toBeLessThan(plan.beds[1].y0);
    expect(bedAt(plan, plan.pond.x, plan.pond.y)).toBeNull();
    for (const b of plan.beds) {
      expect(bedDistance(plan, b, plan.pond.x, plan.pond.y)).toBeGreaterThan(0);
      expect(bedAt(plan, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)).toBe(b);
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

  it("keeps a seat's library and graveyard apart, on its mat", () => {
    for (const seat of SEATS) {
      const { piles } = seatArea(seat, plan, W, H, W, TABLE_H);
      expect(Math.abs(piles.library.x - piles.graveyard.x)).toBeGreaterThan(PILE.w + 1);
    }
  });

  it("holds an opponent's hand at the back of their mat, beside the piles on the outer side", () => {
    SEATS.forEach((seat, i) => {
      const { hand, piles } = seatArea(seat, plan, W, H, W, TABLE_H);
      const b = plan.beds[i];
      expect(bedAt(plan, hand.x, hand.y)).toBe(b);
      expect(hand.room).toBeGreaterThan(20);
      // Further out across than the graveyard, clear of it, and along the piles' strip.
      expect(Math.abs(hand.x) - hand.room / 2).toBeGreaterThan(Math.abs(piles.graveyard.x) + PILE.w / 2);
      expect(Math.sign(hand.x)).toBe(Math.sign(piles.graveyard.x));
      expect(Math.abs(hand.y - piles.graveyard.y)).toBeLessThanOrEqual(PILE.h);
      // The fan's span stays on the mat.
      expect(Math.abs(hand.x) + hand.room / 2).toBeLessThanOrEqual(Math.max(Math.abs(b.x0), Math.abs(b.x1)));
    });
  });

  it('gives a seat alone on its side of the table one mat across that side, and lays its rows across it', () => {
    const three: Seat[] = [{ v: 'bottom', h: 'full' }, SEATS[1], SEATS[2]];
    const two: Seat[] = [SEATS[0], SEATS[2]];
    for (const seats of [three, two]) {
      const g = gardenPlan(W, H, W, TABLE_H, seats);
      expect(g.beds).toHaveLength(seats.length);
      seats.forEach((seat, i) => {
        const b = g.beds[i];
        const alone = seats.filter((o) => o.v === seat.v).length === 1;
        expect(b.h).toBe(alone ? 'full' : seat.h);
        if (alone) {
          // The whole side, the well cut out of its middle.
          expect(b.x0).toBeLessThan(-W / 4);
          expect(b.x1).toBeGreaterThan(W / 4);
          expect(bedAt(g, 0, g.pond.y)).toBeNull();
        }
        const { box, piles } = seatArea(seat, g, W, H, W, TABLE_H);
        const s = span(box);
        expect(s.x0).toBeGreaterThanOrEqual(b.x0);
        expect(s.x1).toBeLessThanOrEqual(b.x1);
        for (const p of [piles.library, piles.graveyard]) expect(bedAt(g, p.x, p.y)).toBe(b);
      });
      // Its corner's material: the bottom is yours (leather), the top right slate.
      expect(g.beds[0].material).toBe('leather');
    }
    // The whole bottom edge's rows run across the middle, above the controls.
    const { box } = seatArea(three[0], gardenPlan(W, H, W, TABLE_H, three), W, H, W, TABLE_H);
    const s = span(box);
    expect(s.x0).toBeLessThan(-10);
    expect(s.x1).toBeGreaterThan(10);
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

describe('floorMaps', () => {
  it('lays flagstones with dirt between them, the same every time', () => {
    const a = floorMaps(192);
    expect(a.width).toBe(192);
    expect(a.height).toBe(96);
    expect(floorMaps(192).albedo).toEqual(a.albedo);
    // Some pixels are stone (greyish), some are the joints' dirt (redder than it is blue).
    let dirt = 0;
    for (let i = 0; i < a.albedo.length; i += 4) if (a.albedo[i] - a.albedo[i + 2] > 30) dirt++;
    const share = dirt / (a.width * a.height);
    expect(share).toBeGreaterThan(0.03);
    expect(share).toBeLessThan(0.5);
  });
});

describe('the exile swirling in the well (wellSwirl)', () => {
  it('circles a few cards half way out, evenly round', () => {
    const { w, slots } = wellSwirl(3, POND_R);
    expect(w).toBe(5.5);
    expect(slots.map((s) => s.r)).toEqual([POND_R / 2, POND_R / 2, POND_R / 2]);
    expect(slots[1].a - slots[0].a).toBeCloseTo((2 * Math.PI) / 3);
  });

  it('winds more along a spiral from the wall in, newest outermost, every card inside the water', () => {
    for (const n of [5, 12, 24, SWIRL_MAX]) {
      const { w, slots } = wellSwirl(n, POND_R);
      expect(slots).toHaveLength(n);
      // Smaller as they crowd, never tiny.
      expect(w).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < n; i++) {
        expect(slots[i].r).toBeLessThan(slots[i - 1].r);
        expect(slots[i].a).toBeGreaterThan(slots[i - 1].a);
      }
      // A card's far corner stays inside the water.
      expect(slots[0].r + Math.hypot(w / 2, (w * 1.4) / 2)).toBeLessThanOrEqual(POND_R);
      expect(slots[n - 1].r).toBeGreaterThan(0);
    }
  });
});
