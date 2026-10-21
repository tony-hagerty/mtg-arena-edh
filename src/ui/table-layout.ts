import { camera } from './camera';
import type { Seat } from './util';

/*
  Where each seat's rows go and how big their cards are drawn, worked out from the screen's
  size in rem. Pure maths, no React: tests/table-layout.test.ts checks it. The numbers come
  from the approved mockup (1440 × 900 px, so a rem is 7.5 px there).

  Each seat has a box on the screen: across its half of the table, between the portraits and
  the middle, and from just past the middle of the screen out to above the piles and the
  controls on its edge. Its rows (lands nearest the edge, then the other permanents, then the
  creatures nearest the middle) lean ROW_LEAN degrees and grow while they fit the box.
*/

/** How much of each card under the top one a pile shows, as a share of the tile's width. Keep in step with `.stack .tile + .tile` in styles.css. */
export const PILE_STEP = 0.1;

/** How far a seat's rows lean, in degrees: down toward the middle of the bottom edge for the bottom seats, up toward the middle of the top edge for the top ones. */
export const ROW_LEAN = 5;

/** Base tile sizes in rem, before `seatScale`: width, height (the tile is 5:4, see `.tile`) and the gap between tiles. */
export const TILE = {
  creature: { w: 11.2, h: 8.96, gap: 1.07 },
  other: { w: 8.8, h: 7.04, gap: 0.8 },
} as const;

/** The gap between rows, in rem. */
export const ROW_GAP = 1.87;

/** The smallest and biggest a seat's cards are drawn. Below the smallest, a crowded row overlaps instead. */
export const K_MIN = 0.7;
export const K_MAX = 1.45;

/** How many tile widths a row of piles takes: each pile is one tile and a step for every card under the top one. */
export const rowUnits = (piles: number[]) => piles.reduce((n, k) => n + 1 + PILE_STEP * (k - 1), 0);

export interface RowSpec {
  /** Base tile size and gap (`TILE`). */
  w: number;
  h: number;
  gap: number;
  /** How many cards are in each pile along the row; a lone card is a pile of 1. */
  piles: number[];
}

/**
 * The biggest scale at which every row fits its length and all the rows, with `gap` (ROW_GAP
 * unless given) between them, fit the seat's height, clamped to K_MIN..`max` (K_MAX unless given). Empty rows take no room.
 */
export function seatScale({ rows, rowLen, room, max = K_MAX, gap = ROW_GAP }: { rows: RowSpec[]; rowLen: number; room: number; max?: number; gap?: number }) {
  const used = rows.filter((r) => r.piles.length);
  if (!used.length) return max;
  let k = (room - gap * (used.length - 1)) / used.reduce((n, r) => n + r.h, 0);
  for (const r of used) k = Math.min(k, (rowLen - (r.piles.length - 1) * r.gap) / (rowUnits(r.piles) * r.w));
  return Math.max(K_MIN, Math.min(max, k));
}

/**
 * The space between the piles of a row `len` long whose tiles are `w` wide: `gap` while they
 * fit, less (negative: they overlap) once they don't.
 */
export function rowGap(piles: number[], w: number, gap: number, len: number) {
  if (piles.length < 2) return gap;
  return Math.min(gap, (len - rowUnits(piles) * w) / (piles.length - 1));
}

/** The seat's box on the screen in the bottom-left corner's terms, before mirroring: from right of the portraits to just short of the middle. */
const BOX_LEFT = 20.3;
const BOX_MIDDLE_GAP = 2.7;
/** From just below the middle of the screen out toward the seat's edge. */
const BOX_BELOW_MIDDLE = 1.33;
/**
 * The bottom seats stop above the piles (`.seat-zones`: 9.6rem wide piles, 13.44rem tall,
 * standing 9.2rem up over the tip of your hand, so their tops are 22.64rem up) and the
 * controls (`.action-bar` and its seat arrows, under 20rem even while paying).
 */
const BOX_ABOVE_EDGE = 24.4;
/** The top seats stop below their piles (14.74rem down) and their hands' counts. */
const BOX_BELOW_EDGE = 20.8;
/**
 * The whole bottom edge runs level through the middle of the screen, so it starts further
 * below the middle, clear of the prompt (`.prompt`).
 */
const BOX_BELOW_MIDDLE_FULL = 3.2;

export interface SeatBox {
  /** The rows' rectangle on the table, in rem from the table's top-left corner. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** The rows' lean in degrees, clockwise. */
  lean: number;
}

/** Which way a seat's rows lean, clockwise: the bottom-left and top-right seats one way, the top-left and bottom-right the other. The whole bottom edge stays level. */
export const leanOf = (s: Seat) => (s.h === 'full' ? 0 : (s.h === 'right') === (s.v === 'top') ? ROW_LEAN : -ROW_LEAN);

/**
 * Where a seat's rows go on the table, for a screen `stageW` × `stageH` rem. The box is laid
 * out on the screen (see the constants above), less the rise of the lean at the rows' ends,
 * mirrored for the top and right seats. The rows are drawn on the tilted table, so its corners
 * are projected back onto the table (`camera`); the rectangle inside them is the answer.
 */
export function seatBox(s: Seat, stageW: number, stageH: number): SeatBox {
  const lean = leanOf(s);
  let x0 = BOX_LEFT;
  let x1 = s.h === 'full' ? stageW - BOX_LEFT : stageW / 2 - BOX_MIDDLE_GAP;
  const rise = (Math.tan((Math.abs(lean) * Math.PI) / 180) * (x1 - x0)) / 2;
  let y0 = stageH / 2 + (s.h === 'full' ? BOX_BELOW_MIDDLE_FULL : BOX_BELOW_MIDDLE) + rise;
  let y1 = stageH - (s.v === 'top' ? BOX_BELOW_EDGE : BOX_ABOVE_EDGE) - rise;
  if (s.h === 'right') [x0, x1] = [stageW - x1, stageW - x0];
  if (s.v === 'top') [y0, y1] = [stageH - y1, stageH - y0];
  const cam = camera(stageW, stageH, 1);
  const tl = cam.toTable({ x: x0, y: y0 });
  const tr = cam.toTable({ x: x1, y: y0 });
  const bl = cam.toTable({ x: x0, y: y1 });
  const br = cam.toTable({ x: x1, y: y1 });
  const left = Math.max(tl.x, bl.x);
  const right = Math.min(tr.x, br.x);
  return { left, top: tl.y, width: right - left, height: bl.y - tl.y, lean };
}

/*
  An opponent's hand: card backs fanned out of their corner from a pivot off the screen,
  past their side edge and beyond their own edge, so only the tops of the cards show.
*/
/** The size of a card back in an opponent's hand, in rem. Keep in step with `.opp-fan .card-back`. */
export const BACK_W = 10.4;
export const BACK_H = BACK_W * 1.4;
/** How far the cards' bottoms are from the pivot, in rem. */
export const FAN_RADIUS = 30.4;
/** The pivot: this far off the side edge and beyond the seat's own edge, in rem. Keep in step with `.opp-fan`. */
export const FAN_PIVOT_SIDE = 9.3;
export const FAN_PIVOT_BEYOND = 20;

/** The most an opponent's fan turns from one card to the next, in degrees: a small hand stays a tight fan. */
const FAN_STEP = 6;

/**
 * How far card `i` of an opponent's `n` is turned about the pivot, in degrees clockwise from
 * pointing up: about 32° (a lone card's), spreading FAN_STEP a card, at most from 14° to 50°,
 * for the bottom-left corner, mirrored into the seat's own.
 */
export function fanAngle(i: number, n: number, s: Seat) {
  const step = n > 1 ? Math.min(FAN_STEP, 36 / (n - 1)) : 0;
  let a = 32 + (i - (n - 1) / 2) * step;
  if (s.h === 'right') a = -a;
  if (s.v === 'top') a = 180 - a;
  return a;
}

/*
  Your hand follows a curve: flat out of the left edge of the screen, then bending down into
  the bottom edge. The card centres sit on it, evenly spaced along it, each turned to the
  curve's direction under it. Points here are in rem: x from the screen's left edge, y up
  from its bottom edge. Angles are degrees clockwise, as CSS turns things.
*/

/** A hand card's size in rem. Keep in step with `.hand-slot` (and HAND_W in Card.tsx). */
export const HAND_W = 15;
export const HAND_H = HAND_W * 1.4;

/** The curve as drawn on the mockup: two cubic Béziers in its px (900 px high, y down). */
const CURVE_PX = [
  [
    [-43, 821.4],
    [-43, 821.4],
    [-7.7, 818],
    [43.2, 818],
  ],
  [
    [43.2, 818],
    [138.8, 818],
    [289.3, 829.8],
    [365.1, 897.8],
  ],
];
const PX = 7.5;
const MOCK_H = 900;

export interface Pt {
  x: number;
  y: number;
}

/** The curve sampled finely, with the distance along it at each sample. */
const samples: Pt[] = CURVE_PX.flatMap((b) =>
  Array.from({ length: 201 }, (_, j) => {
    const u = j / 200;
    const v = 1 - u;
    const w = [v * v * v, 3 * v * v * u, 3 * v * u * u, u * u * u];
    const px = w.reduce((n, k, i) => n + k * b[i][0], 0);
    const py = w.reduce((n, k, i) => n + k * b[i][1], 0);
    return { x: px / PX, y: (MOCK_H - py) / PX };
  }),
);
const acc = samples.reduce<number[]>((a, p, i) => [...a, i ? a[i - 1] + Math.hypot(p.x - samples[i - 1].x, p.y - samples[i - 1].y) : 0], []);
/** The curve's length in rem. */
export const CURVE_LEN = acc[acc.length - 1];

/** Which way the curve runs from `p` to `q`, in degrees clockwise (y is up, so it is flipped). */
const heading = (p: Pt, q: Pt) => (Math.atan2(-(q.y - p.y), q.x - p.x) * 180) / Math.PI;
const unit = (p: Pt, q: Pt) => {
  const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  return { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
};
const startDir = unit(samples[0], samples[10]);
const endDir = unit(samples[samples.length - 11], samples[samples.length - 1]);

/**
 * The point `s` rem along the curve and its heading. Past either end the curve carries
 * straight on, so cards scrolled out of the hand slide off along it.
 */
export function along(s: number): Pt & { th: number } {
  const th = (d: Pt) => (Math.atan2(-d.y, d.x) * 180) / Math.PI;
  if (s <= 0) return { x: samples[0].x + startDir.x * s, y: samples[0].y + startDir.y * s, th: th(startDir) };
  if (s >= CURVE_LEN) {
    const e = samples[samples.length - 1];
    const k = s - CURVE_LEN;
    return { x: e.x + endDir.x * k, y: e.y + endDir.y * k, th: th(endDir) };
  }
  let j = 1;
  while (j < acc.length - 1 && (acc[j] < s || acc[j] === acc[j - 1])) j++;
  const p = samples[j - 1];
  const q = samples[j];
  const f = acc[j] > acc[j - 1] ? (s - acc[j - 1]) / (acc[j] - acc[j - 1]) : 0;
  return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, th: heading(p, q) };
}

/** The whole curve drops so that the bottom quarter of each card is below the screen: its flat part carries the card centres a quarter of a card above the bottom edge. */
export const HAND_DROP = HAND_H / 4 - (MOCK_H - 818) / PX;
/** How many cards show at once; a bigger hand scrolls. */
export const HAND_VISIBLE = 7;
/** How far left of its centre a hand card at curve distance `s` reaches, turned to the curve there, in rem. */
const reachLeft = (s: number) => {
  const t = (along(s).th * Math.PI) / 180;
  return (HAND_W / 2) * Math.abs(Math.cos(t)) + (HAND_H / 2) * Math.abs(Math.sin(t));
};
/** Where the first card's centre is along the curve: just far enough in that its left edge touches the screen's left edge (found by halving). */
const S0 = (() => {
  let lo = 0;
  let hi = CURVE_LEN / 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (along(mid).x - reachLeft(mid) < 0) lo = mid;
    else hi = mid;
  }
  return hi;
})();
/** Where the last card's centre is: where the dropped curve reaches the bottom edge, so its corner still shows. */
const S_END = (() => {
  const i = samples.findIndex((p) => p.y + HAND_DROP <= 0);
  return i < 0 ? CURVE_LEN - 24 / PX : acc[i];
})();
/** The distance along the curve from one card to the next. */
export const HAND_STEP = (S_END - S0) / (HAND_VISIBLE - 1);

/** The centre and turn of the card in `slot` (0 the first one showing; less, or HAND_VISIBLE and more, past the ends). */
export function handSlot(slot: number): Pt & { th: number } {
  const p = along(S0 + slot * HAND_STEP);
  return { x: p.x, y: p.y + HAND_DROP, th: p.th };
}

/** The first card that shows: `start`, kept so the window never runs past either end of a hand of `total`. */
export const handWindow = (start: number, total: number) => Math.max(0, Math.min(total - HAND_VISIBLE, start));

/**
 * The scroll pills over a hand that doesn't fit: two short arcs along the curve, lifted just
 * above the card tops, either side of the middle of the cards that show. Each is a list of
 * points, with a double chevron in its middle pointing its way.
 */
const PILL_LIFT = HAND_H / 2 + 11 / PX;
const PILL_GAP = 8 / PX;
const PILL_LEN = 64 / PX;

/** The point `s` rem along the curve, lifted above the card tops, and its heading. */
function lifted(s: number): Pt & { th: number } {
  const p = along(s);
  const t = (p.th * Math.PI) / 180;
  // Straight up from the card: the curve's normal toward the top of the screen.
  return { x: p.x + Math.sin(t) * PILL_LIFT, y: p.y + HAND_DROP + Math.cos(t) * PILL_LIFT, th: p.th };
}

const arc = (a: number, b: number) => Array.from({ length: 31 }, (_, k) => lifted(a + ((b - a) * k) / 30));

/** Two marks a little apart along the curve, each a "<" (dir -1) or ">" (dir 1) turned to the curve under it, as polylines. */
function chevron(s: number, dir: -1 | 1): Pt[][] {
  const mark = (at: number) => {
    const q = lifted(at);
    const t = (q.th * Math.PI) / 180;
    // Offsets along (x) and across (y, up) the curve, in rem.
    const pt = (x: number, y: number) => ({ x: q.x + x * Math.cos(t) + y * Math.sin(t), y: q.y - x * Math.sin(t) + y * Math.cos(t) });
    return [pt(-0.21 * dir, 0.37), pt(0.16 * dir, 0), pt(-0.21 * dir, -0.37)];
  };
  return [mark(s - 0.35), mark(s + 0.35)];
}

export function handPills() {
  const mid = S0 + ((HAND_VISIBLE - 1) * HAND_STEP) / 2;
  const left = { a: mid - PILL_GAP - PILL_LEN, b: mid - PILL_GAP };
  const right = { a: mid + PILL_GAP, b: mid + PILL_GAP + PILL_LEN };
  return {
    left: { path: arc(left.a, left.b), chevron: chevron((left.a + left.b) / 2, -1) },
    right: { path: arc(right.a, right.b), chevron: chevron((right.a + right.b) / 2, 1) },
  };
}
