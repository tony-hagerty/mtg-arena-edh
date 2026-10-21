// Your hand's curve and its scroll pills (src/ui/table-layout.ts).
import { describe, expect, it } from 'vitest';
import { CURVE_LEN, HAND_H, HAND_STEP, HAND_W, HAND_VISIBLE, PILL, along, handPills, handSlot, handWindow } from '../src/ui/table-layout';

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

  it("touches the screen's left edge with the first card's left edge", () => {
    const first = handSlot(0);
    const t = (first.th * Math.PI) / 180;
    const left = first.x - (HAND_W / 2) * Math.abs(Math.cos(t)) - (HAND_H / 2) * Math.abs(Math.sin(t));
    expect(left).toBeCloseTo(0, 3);
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
    // Clear of the mana costs on the card tops (1.35rem above them), with room to spare.
    expect(PILL.above - PILL.thick / 2).toBeGreaterThan(1.35 + 0.5);
    // About a card's strip long each, no longer.
    expect(PILL.len).toBeLessThan(HAND_STEP * 1.2);
    // A chevron's middle point is its tip: left of its ends for "<", right of them for ">".
    const [l] = left.chevron;
    const [r] = right.chevron;
    expect(l[1].x).toBeLessThan(l[0].x);
    expect(r[1].x).toBeGreaterThan(r[0].x);
  });
});
