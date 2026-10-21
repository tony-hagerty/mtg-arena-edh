// The table's layout (src/ui/three/layout3d.ts): where each seat's cards lie on the table.
import { describe, expect, it } from 'vitest';
import { CARD3D, HELD, HELD_LEAN, K_MAX_3D, K_MIN, PILE_STEP, ROW_GAP_3D, baseCamera, heldFan, layoutSeat, quadMatrix, rowGap, rowUnits, seatScale } from '../src/ui/three/layout3d';
import { CORNER, cardGeometry } from '../src/ui/three/geometry';
import type { Row, RowSpec, SeatBox } from '../src/ui/three/layout3d';
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
const row = (kind: keyof typeof CARD3D, piles: number[]): RowSpec => ({ ...CARD3D[kind], piles });

/** A seat's box, in rem from the table's top-left corner, y down: its half of the table, 36rem deep, short of the middle and of its edge. */
const seatBox = (seat: Seat): SeatBox => ({
  left: seat.h === 'right' ? W / 2 + 4 : 20,
  width: seat.h === 'full' ? W - 40 : W / 2 - 24,
  top: seat.v === 'top' ? 24 : TABLE_H - 60,
  height: 36,
});

/** A pose's centre back in the box's terms (rem from the top-left, y down). */
const css = (p: { x: number; y: number }) => ({ x: p.x + W / 2, y: TABLE_H - p.y });

describe('rowUnits', () => {
  it('counts a pile as one card and a step for each card under the top one', () => {
    expect(rowUnits([])).toBe(0);
    expect(rowUnits([1, 1, 1])).toBe(3);
    expect(rowUnits([7, 1])).toBeCloseTo(2 + 6 * PILE_STEP, 9);
  });
});

describe('seatScale', () => {
  it('grows a small board to the biggest size', () => {
    expect(seatScale({ rows: [row('other', [4]), row('other', []), row('creature', [1, 1])], rowLen: 73, room: 40 })).toBe(K_MAX_3D);
  });

  it('fits every row along its length', () => {
    const rows = [row('creature', Array(8).fill(1))];
    const k = seatScale({ rows, rowLen: 73, room: 100 });
    expect(k).toBeLessThan(K_MAX_3D);
    // The row fills its length exactly.
    expect(8 * CARD3D.creature.w * k + 7 * CARD3D.creature.gap).toBeCloseTo(73, 6);
  });

  it('fits all the rows into the height, ignoring empty ones', () => {
    const rows = [row('other', [1]), row('other', []), row('creature', [1])];
    const k = seatScale({ rows, rowLen: 500, room: 20 });
    expect(CARD3D.other.h * k + CARD3D.creature.h * k + ROW_GAP_3D).toBeCloseTo(20, 6);
  });

  it('never goes below the smallest size: a crowded row overlaps instead', () => {
    const piles = Array(20).fill(1);
    expect(seatScale({ rows: [row('creature', piles)], rowLen: 73, room: 30 })).toBe(K_MIN);
    const w = CARD3D.creature.w * K_MIN;
    const gap = rowGap(piles, w, CARD3D.creature.gap, 73);
    expect(gap).toBeLessThan(0);
    expect(20 * w + 19 * gap).toBeCloseTo(73, 6);
  });

  it('keeps the full gap while a row fits', () => {
    expect(rowGap([3, 1], 10, 0.8, 73)).toBe(0.8);
    expect(rowGap([1], 10, 0.8, 5)).toBe(0.8);
  });
});

describe('layoutSeat', () => {
  it('keeps every card inside its seat box, lands nearest the edge and creatures nearest the middle', () => {
    for (const seat of [{ v: 'bottom', h: 'left' }, { v: 'top', h: 'right' }, { v: 'bottom', h: 'full' }] as Seat[]) {
      const box = seatBox(seat);
      const poses = layoutSeat(seat, box, rows([ids('l', 3), ids('m', 2)], [['a']], [ids('c', 2), ['d']]), W, TABLE_H);
      expect(poses).toHaveLength(9);
      for (const p of poses) {
        const c = css(p);
        expect(c.x).toBeGreaterThan(box.left);
        expect(c.x).toBeLessThan(box.left + box.width);
        expect(c.y).toBeGreaterThan(box.top);
        expect(c.y).toBeLessThan(box.top + box.height);
      }
      const y = (id: string) => css(poses.find((p) => p.item === id)!).y;
      // y grows downward: at the bottom the lands are lowest (largest y), at the top highest.
      if (seat.v === 'bottom') expect(y('l0')).toBeGreaterThan(y('c0'));
      else expect(y('l0')).toBeLessThan(y('c0'));
      expect(Math.abs(y('a') - (y('l0') + y('c0')) / 2)).toBeLessThan(CARD3D.creature.h);
    }
  });

  it('steps the cards of a pile along the row and up off the table', () => {
    const seat: Seat = { v: 'bottom', h: 'left' };
    const poses = layoutSeat(seat, seatBox(seat), rows([ids('l', 4)], [], []), W, TABLE_H);
    expect(poses.map((p) => p.stack)).toEqual([0, 1, 2, 3]);
    expect(poses.every((p) => p.pile === 4)).toBe(true);
    // Each card a tenth of a width along the row, square to the table.
    for (let i = 1; i < 4; i++) {
      expect(poses[i].x - poses[i - 1].x).toBeCloseTo(poses[i].w * PILE_STEP, 5);
      expect(poses[i].y).toBeCloseTo(poses[i - 1].y, 9);
    }
  });

  it('leaves ROW_GAP_3D between rows', () => {
    const seat: Seat = { v: 'bottom', h: 'full' };
    const poses = layoutSeat(seat, seatBox(seat), rows([['l']], [['a']], [['c']]), W, TABLE_H);
    const [l, a, c] = ['l', 'a', 'c'].map((id) => poses.find((p) => p.item === id)!);
    expect(a.y - a.h / 2 - (l.y + l.h / 2)).toBeCloseTo(ROW_GAP_3D, 5);
    expect(c.y - c.h / 2 - (a.y + a.h / 2)).toBeCloseTo(ROW_GAP_3D, 5);
  });

  it('draws nothing for an empty seat and never below the smallest scale', () => {
    const seat: Seat = { v: 'top', h: 'left' };
    expect(layoutSeat(seat, seatBox(seat), rows([], [], []), W, TABLE_H)).toEqual([]);
    const crowded = layoutSeat(seat, seatBox(seat), rows([], [], [ids('c', 14).map((x) => [x])].flat()), W, TABLE_H);
    expect(crowded[0].w).toBeCloseTo(CARD3D.creature.w * K_MIN, 5);
  });
});

describe('heldFan', () => {
  it('fans a hand out evenly from the middle, each card in front of the one before', () => {
    const { cards, w, h } = heldFan(7, 100);
    expect([w, h]).toEqual([HELD.w, HELD.h]);
    expect(cards).toHaveLength(7);
    // The middle card stands straight, the others lean out to their side, symmetric about it.
    expect(cards[3].turn).toBeCloseTo(0);
    expect(cards[3].x).toBeCloseTo(0);
    expect(cards[3].y).toBeCloseTo(h / 2);
    for (let i = 0; i < 3; i++) {
      expect(cards[i].x).toBeCloseTo(-cards[6 - i].x);
      expect(cards[i].turn).toBeCloseTo(-cards[6 - i].turn);
      expect(cards[i].turn).toBeGreaterThan(0);
    }
    for (let i = 1; i < 7; i++) expect(cards[i].z).toBeGreaterThan(cards[i - 1].z);
  });

  it('shrinks to fit its room, and stands clear of the table', () => {
    for (const n of [1, 4, 12]) {
      const { cards, w, h, lift } = heldFan(n, 20);
      const left = Math.min(...cards.map((c) => c.x - (w / 2) * Math.cos(c.turn) - (h / 2) * Math.abs(Math.sin(c.turn))));
      const right = Math.max(...cards.map((c) => c.x + (w / 2) * Math.cos(c.turn) + (h / 2) * Math.abs(Math.sin(c.turn))));
      expect(right - left).toBeLessThanOrEqual(20 + 1e-6);
      // Leant back, the lowest corner is still above the table.
      const low = Math.min(...cards.map((c) => c.y - (h / 2) * Math.cos(c.turn) - (w / 2) * Math.abs(Math.sin(c.turn))));
      expect(lift + low * Math.cos(HELD_LEAN)).toBeGreaterThan(0);
      // Leant back further, as a far seat's is, it stands lower.
      const flat = heldFan(n, 20, 1.1);
      expect(flat.lift + low * Math.cos(1.1)).toBeGreaterThan(0);
      expect(flat.lift).toBeLessThanOrEqual(lift);
    }
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

describe('quadMatrix', () => {
  /** Where the CSS matrix (column by column) takes the box's point (x, y). */
  const apply = (m: number[], x: number, y: number) => {
    const w = m[3] * x + m[7] * y + m[15];
    return [(m[0] * x + m[4] * y + m[12]) / w, (m[1] * x + m[5] * y + m[13]) / w];
  };
  const corners = (w: number, h: number) => [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];

  it("lays a proxy's corners on the card's projected corners: turned, foreshortened and all", () => {
    const quads: [number, number][][] = [
      // A card turned a little, as a seat's lean or tapping turns it.
      [
        [110, 52],
        [168, 58],
        [161, 139],
        [103, 133],
      ],
      // Foreshortened: the far edge narrower than the near one.
      [
        [412, 300],
        [470, 300],
        [474, 382],
        [408, 382],
      ],
    ];
    for (const q of quads) {
      const m = quadMatrix(60, 84, q);
      corners(60, 84).forEach(([x, y], i) => {
        const [px, py] = apply(m, x, y);
        expect(px).toBeCloseTo(q[i][0], 6);
        expect(py).toBeCloseTo(q[i][1], 6);
      });
      // The middle of the box goes to where the quad's diagonals cross, as perspective puts a card's middle.
      const [cx, cy] = apply(m, 30, 42);
      const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
      const t = ((x3 - x1) * (y1 - y0) - (y3 - y1) * (x1 - x0)) / ((x3 - x1) * (y2 - y0) - (y3 - y1) * (x2 - x0));
      expect(cx).toBeCloseTo(x0 + t * (x2 - x0), 6);
      expect(cy).toBeCloseTo(y0 + t * (y2 - y0), 6);
    }
  });

  it('is a plain move and scale for a card square to the screen', () => {
    const m = quadMatrix(50, 70, [
      [10, 20],
      [110, 20],
      [110, 160],
      [10, 160],
    ]);
    expect(m).toEqual([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 10, 20, 0, 1]);
  });
});

describe('cardGeometry', () => {
  it("rounds a card's corners and lays the face's image over its whole top", () => {
    const g = cardGeometry(5, 7, 0.1);
    expect(g.groups.map((x) => x.materialIndex)).toEqual([0, 1, 2]);
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    const top = g.groups[1];
    let nearest = Infinity;
    for (let i = top.start; i < top.start + top.count; i++) {
      // The face's uv is its position over the card's size.
      expect(uv.getX(i)).toBeCloseTo(pos.getX(i) / 5 + 0.5, 6);
      expect(uv.getY(i)).toBeCloseTo(pos.getY(i) / 7 + 0.5, 6);
      nearest = Math.min(nearest, Math.hypot(Math.abs(pos.getX(i)) - 2.5, Math.abs(pos.getY(i)) - 3.5));
    }
    // No point reaches a square corner: the nearest is the arc's middle, r(√2 - 1) in from it.
    expect(nearest).toBeCloseTo(CORNER * 5 * (Math.SQRT2 - 1), 6);
  });
});
