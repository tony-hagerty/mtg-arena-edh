// Where the seats' rows go and how big their cards are (src/ui/table-layout.ts).
import { describe, expect, it } from 'vitest';
import { camera } from '../src/ui/camera';
import { CURVE_LEN, HAND_H, HAND_STEP, HAND_VISIBLE, K_MAX, K_MIN, PILE_STEP, ROW_GAP, ROW_LEAN, TILE, along, fanAngle, handPills, handSlot, handWindow, leanOf, rowGap, rowUnits, seatBox, seatScale } from '../src/ui/table-layout';
import type { RowSpec } from '../src/ui/table-layout';
import type { Seat } from '../src/ui/util';

const BL: Seat = { v: 'bottom', h: 'left' };
const TL: Seat = { v: 'top', h: 'left' };
const TR: Seat = { v: 'top', h: 'right' };
const BR: Seat = { v: 'bottom', h: 'right' };
const FULL: Seat = { v: 'bottom', h: 'full' };

const row = (kind: keyof typeof TILE, piles: number[]): RowSpec => ({ ...TILE[kind], piles });

describe('rowUnits', () => {
  it('counts a pile as one tile and a step for each card under the top one', () => {
    expect(rowUnits([])).toBe(0);
    expect(rowUnits([1, 1, 1])).toBe(3);
    expect(rowUnits([7, 1])).toBeCloseTo(2 + 6 * PILE_STEP, 9);
  });
});

describe('seatScale', () => {
  it('grows a small board to the biggest size', () => {
    expect(seatScale({ rows: [row('other', [4]), row('other', []), row('creature', [1, 1])], rowLen: 73, room: 30 })).toBe(K_MAX);
  });

  it('fits every row along its length', () => {
    const rows = [row('creature', Array(8).fill(1))];
    const k = seatScale({ rows, rowLen: 73, room: 100 });
    expect(k).toBeLessThan(K_MAX);
    // The row fills its length exactly.
    expect(8 * TILE.creature.w * k + 7 * TILE.creature.gap).toBeCloseTo(73, 6);
  });

  it('fits all the rows into the height, ignoring empty ones', () => {
    const rows = [row('other', [1]), row('other', []), row('creature', [1])];
    const k = seatScale({ rows, rowLen: 500, room: 20 });
    expect(TILE.other.h * k + TILE.creature.h * k + ROW_GAP).toBeCloseTo(20, 6);
  });

  it('never goes below the smallest size: a crowded row overlaps instead', () => {
    const piles = Array(20).fill(1);
    expect(seatScale({ rows: [row('creature', piles)], rowLen: 73, room: 30 })).toBe(K_MIN);
    const w = TILE.creature.w * K_MIN;
    const gap = rowGap(piles, w, TILE.creature.gap, 73);
    expect(gap).toBeLessThan(0);
    expect(20 * w + 19 * gap).toBeCloseTo(73, 6);
  });

  it('keeps the full gap while a row fits', () => {
    expect(rowGap([3, 1], 10, 0.8, 73)).toBe(0.8);
    expect(rowGap([1], 10, 0.8, 5)).toBe(0.8);
  });
});

describe('seatBox', () => {
  const W = 192;
  const H = 108;
  const cam = camera(W, H, 1);
  // The rectangle's corners, back on the screen.
  const corners = (b: ReturnType<typeof seatBox>) =>
    [
      [b.left, b.top],
      [b.left + b.width, b.top],
      [b.left, b.top + b.height],
      [b.left + b.width, b.top + b.height],
    ].map(([x, y]) => cam.toScreen({ x, y }));
  const rise = (len: number) => (Math.tan((ROW_LEAN * Math.PI) / 180) * len) / 2;

  it('puts the bottom-left rows between the portraits and the middle, above the controls', () => {
    const b = seatBox(BL, W, H);
    const pts = corners(b);
    const len = W / 2 - 2.7 - 20.3;
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(20.3 - 1e-6);
      expect(p.x).toBeLessThanOrEqual(W / 2 - 2.7 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(H / 2 + 1.33 + rise(len) - 1e-6);
      expect(p.y).toBeLessThanOrEqual(H - 20.8 - rise(len) + 1e-6);
    }
    // It touches the box's top and bottom, and each side at one corner.
    expect(pts[0].y).toBeCloseTo(H / 2 + 1.33 + rise(len), 6);
    expect(pts[2].y).toBeCloseTo(H - 20.8 - rise(len), 6);
    expect(Math.min(pts[0].x, pts[2].x)).toBeCloseTo(20.3, 6);
    expect(Math.max(pts[1].x, pts[3].x)).toBeCloseTo(W / 2 - 2.7, 6);
  });

  it('mirrors the box for the other corners', () => {
    const tl = corners(seatBox(TL, W, H));
    expect(tl[0].y).toBeCloseTo(20.8 + rise(W / 2 - 23), 6);
    expect(tl[2].y).toBeCloseTo(H / 2 - 1.33 - rise(W / 2 - 23), 6);
    const tr = seatBox(TR, W, H);
    const tlBox = seatBox(TL, W, H);
    expect(tr.top).toBeCloseTo(tlBox.top, 9);
    expect(tr.left + tr.width).toBeCloseTo(W - tlBox.left, 9);
    const br = seatBox(BR, W, H);
    const bl = seatBox(BL, W, H);
    expect(br.left).toBeCloseTo(W - bl.left - bl.width, 9);
    expect(br.height).toBeCloseTo(bl.height, 9);
  });

  it('runs the whole bottom edge, level and above the controls, when you have it to yourself', () => {
    const b = seatBox(FULL, W, H);
    expect(b.lean).toBe(0);
    const pts = corners(b);
    expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(W - 20.3, 6);
    expect(pts[0].y).toBeCloseTo(H / 2 + 3.2, 6);
    expect(pts[2].y).toBeCloseTo(H - 22.6, 6);
  });

  it('places from the middle and the edges on a taller screen', () => {
    const tall = seatBox(BL, W, 120);
    const short = seatBox(BL, W, H);
    expect(tall.height).toBeGreaterThan(short.height);
  });

  it('leans the bottom-left and top-right seats one way and the others the other', () => {
    expect([BL, TL, TR, BR].map(leanOf)).toEqual([ROW_LEAN, -ROW_LEAN, ROW_LEAN, -ROW_LEAN]);
  });
});

describe('fanAngle', () => {
  it('fans an opponent hand out of its corner', () => {
    expect([0, 3, 6].map((i) => fanAngle(i, 7, BR))).toEqual([-14, -32, -50]);
    expect(fanAngle(0, 7, TL)).toBe(166);
    expect(fanAngle(6, 7, TR)).toBe(230);
    expect(fanAngle(0, 1, BL)).toBe(32);
  });
});

describe('the hand curve', () => {
  it('carries straight on past both ends', () => {
    const a = along(-10);
    const b = along(-20);
    const start = along(0);
    expect(a.th).toBeCloseTo(b.th, 9);
    // Evenly spaced along a straight line.
    expect(Math.hypot(a.x - start.x, a.y - start.y)).toBeCloseTo(10, 6);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(10, 6);
    const end = along(CURVE_LEN);
    const past = along(CURVE_LEN + 5);
    expect(Math.hypot(past.x - end.x, past.y - end.y)).toBeCloseTo(5, 6);
    // Bending down into the bottom edge: turned clockwise.
    expect(past.th).toBeGreaterThan(30);
  });

  it('is measured by its length: equal steps along it are equal distances', () => {
    const p = (s: number) => along(s);
    for (const s of [5, 20, 40]) {
      const q = p(s);
      const r = p(s + 0.5);
      expect(Math.hypot(r.x - q.x, r.y - q.y)).toBeCloseTo(0.5, 2);
    }
  });

  it('drops the cards a quarter below the screen, and ends where a centre reaches the bottom edge', () => {
    const first = handSlot(0);
    expect(first.y).toBeCloseTo(HAND_H / 4, 1);
    expect(first.x).toBeGreaterThan(0);
    const last = handSlot(HAND_VISIBLE - 1);
    // Within a sample of the curve.
    expect(last.y).toBeLessThanOrEqual(0);
    expect(last.y).toBeGreaterThan(-0.2);
    // Each card is further along and lower than the one before.
    for (let i = 1; i < HAND_VISIBLE; i++) {
      expect(handSlot(i).x).toBeGreaterThan(handSlot(i - 1).x);
      expect(handSlot(i).y).toBeLessThanOrEqual(handSlot(i - 1).y + 1e-9);
    }
    expect(HAND_STEP).toBeGreaterThan(5);
  });

  it('slides the cards outside the window off along the extensions', () => {
    expect(handSlot(-1).x).toBeLessThan(handSlot(0).x);
    expect(handSlot(HAND_VISIBLE).y).toBeLessThan(0);
  });

  it('keeps the window inside the hand', () => {
    expect(handWindow(3, 5)).toBe(0);
    expect(handWindow(-2, 12)).toBe(0);
    expect(handWindow(4, 12)).toBe(4);
    expect(handWindow(9, 12)).toBe(12 - HAND_VISIBLE);
  });

  it('puts the pills above the card tops, either side of the middle, chevrons pointing outward', () => {
    const { left, right } = handPills();
    const mid = handSlot((HAND_VISIBLE - 1) / 2);
    expect(left.path[0].x).toBeLessThan(mid.x);
    expect(right.path[right.path.length - 1].x).toBeGreaterThan(mid.x);
    expect(left.path[left.path.length - 1].x).toBeLessThan(right.path[0].x);
    // Lifted clear of the cards under them, which reach HAND_H / 4 + HAND_H / 2 at most.
    for (const p of [...left.path, ...right.path]) expect(p.y).toBeGreaterThan(HAND_H / 2 + 1);
    // A chevron's middle point is its tip: left of its ends for "<", right of them for ">".
    const [l] = left.chevron;
    const [r] = right.chevron;
    expect(l[1].x).toBeLessThan(l[0].x);
    expect(r[1].x).toBeGreaterThan(r[0].x);
  });
});
