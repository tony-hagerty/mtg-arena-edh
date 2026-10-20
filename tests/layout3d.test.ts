// The 3D table's layout (src/ui/three/layout3d.ts): where each seat's cards lie on the table.
import { describe, expect, it } from 'vitest';
import { seatBox } from '../src/ui/table-layout';
import { CARD3D, baseCamera, layoutSeat } from '../src/ui/three/layout3d';
import type { Row } from '../src/ui/three/layout3d';
import { tableHeight, DEPTH } from '../src/ui/camera';
import type { Seat } from '../src/ui/util';

const W = 192;
const H = 108;
const TABLE_H = tableHeight(H, DEPTH);
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const rows = (lands: string[][], others: string[][], creatures: string[][]): Row<string>[] => [
  { kind: 'other', piles: lands },
  { kind: 'other', piles: others },
  { kind: 'creature', piles: creatures },
];

/** A pose's centre back in the CSS table's terms (rem from the top-left, y down). */
const css = (p: { x: number; y: number }) => ({ x: p.x + W / 2, y: TABLE_H - p.y });

describe('layoutSeat', () => {
  it('keeps every card inside its seat box, lands nearest the edge and creatures nearest the middle', () => {
    for (const seat of [{ v: 'bottom', h: 'left' }, { v: 'top', h: 'right' }, { v: 'bottom', h: 'full' }] as Seat[]) {
      const box = seatBox(seat, W, H);
      const poses = layoutSeat(seat, box, rows([ids('l', 3), ids('m', 2)], [['a']], [ids('c', 2), ['d']]), W, TABLE_H);
      expect(poses).toHaveLength(9);
      for (const p of poses) {
        const c = css(p);
        // The lean turns the rows a little, so allow a card's size of slack.
        expect(c.x).toBeGreaterThan(box.left - p.w);
        expect(c.x).toBeLessThan(box.left + box.width + p.w);
        expect(c.y).toBeGreaterThan(box.top - p.h);
        expect(c.y).toBeLessThan(box.top + box.height + p.h);
      }
      const y = (id: string) => css(poses.find((p) => p.item === id)!).y;
      // CSS y grows downward: at the bottom the lands are lowest (largest y), at the top highest.
      if (seat.v === 'bottom') expect(y('l0')).toBeGreaterThan(y('c0'));
      else expect(y('l0')).toBeLessThan(y('c0'));
      expect(Math.abs(y('a') - (y('l0') + y('c0')) / 2)).toBeLessThan(CARD3D.creature.h);
    }
  });

  it('steps the cards of a pile along the row and up off the table', () => {
    const seat: Seat = { v: 'bottom', h: 'left' };
    const poses = layoutSeat(seat, seatBox(seat, W, H), rows([ids('l', 4)], [], []), W, TABLE_H);
    expect(poses.map((p) => p.stack)).toEqual([0, 1, 2, 3]);
    expect(poses.every((p) => p.pile === 4)).toBe(true);
    // Each card a tenth of a width along the row, which leans with the seat.
    for (let i = 1; i < 4; i++) expect(Math.hypot(poses[i].x - poses[i - 1].x, poses[i].y - poses[i - 1].y)).toBeCloseTo(poses[i].w * 0.1, 5);
    // The whole bottom edge has no lean; a corner does (the bottom-left leans 5° clockwise in CSS, so counterclockwise here is negative).
    expect(poses[0].turn).toBeCloseTo((-5 * Math.PI) / 180, 5);
    const full: Seat = { v: 'bottom', h: 'full' };
    expect(layoutSeat(full, seatBox(full, W, H), rows([['l']], [], []), W, TABLE_H)[0].turn).toBe(0);
  });

  it('draws nothing for an empty seat and never below the smallest scale', () => {
    const seat: Seat = { v: 'top', h: 'left' };
    expect(layoutSeat(seat, seatBox(seat, W, H), rows([], [], []), W, TABLE_H)).toEqual([]);
    const crowded = layoutSeat(seat, seatBox(seat, W, H), rows([], [], [ids('c', 14).map((x) => [x])].flat()), W, TABLE_H);
    expect(crowded[0].w).toBeCloseTo(CARD3D.creature.w * 0.7, 5);
  });
});

describe('baseCamera', () => {
  it('frames the screen from the middle of its bottom edge, DEPTH out', () => {
    const c = baseCamera(W, H, DEPTH);
    expect(c.position).toEqual([0, 0, DEPTH]);
    // The frustum is twice the screen's height, and the top half is drawn.
    expect(Math.tan(((c.fov / 2) * Math.PI) / 180) * DEPTH).toBeCloseTo(H, 5);
    expect(c.aspect).toBeCloseTo(W / (2 * H), 5);
    expect(c.viewOffset).toEqual({ fullWidth: W, fullHeight: 2 * H, x: 0, y: 0, width: W, height: H });
  });
});
