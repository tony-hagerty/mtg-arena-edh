import { PILE_STEP, rowGap, rowUnits, seatScale } from '../table-layout';
import type { SeatBox } from '../table-layout';
import type { Seat } from '../util';

/*
  Where each card lies on the 3D table (Table3D.tsx). Pure maths, no React or Three:
  tests/layout3d.test.ts checks it.

  The table is the same plane the CSS table is (camera.ts): the screen's width across, and
  `tableHeight` deep, leaned away by TILT about its bottom edge. Its own coordinates here are
  world units (1 unit = 1 rem), x from the middle of the bottom edge (right is positive), y up
  the table from the bottom edge toward the far one, z up off the table. The seats' boxes come
  from `seatBox` in table-layout.ts, in the CSS table's terms (rem from its top-left corner, y
  down), and are converted.

  The rows follow the CSS table's order: lands nearest the seat's edge, then the other
  permanents, then creatures nearest the middle. The cards are drawn as the tiles are, art and
  name at 5:4, at their own base sizes.
*/

/** Card sizes on the 3D table in rem, before `seatScale`: width, height and the gap between piles. A permanent is drawn as the CSS table's tile is, its art and name at 5:4 (`tileTexture`), which saves a row a third of a card's depth. */
export const CARD3D = {
  creature: { w: 9.6, h: 9.6 * 0.8, gap: 0.9 },
  other: { w: 8, h: 8 * 0.8, gap: 0.7 },
} as const;

/** How thick a card is, in rem: a solid tile, thick enough that its edge shows. Cards in a pile sit this far apart. */
export const CARD_THICKNESS = 0.3;

/**
 * The space between a seat's rows on the 3D table, rem: wider than the CSS table's ROW_GAP,
 * so the lands read as a row apart from the creatures, and the badges between (P/T under a
 * card, a pile's count over one) have room.
 */
export const ROW_GAP_3D = 3.4;

/** How far each card on the table is tipped up, about its own bottom edge, so its top is a little lifted toward you (radians). */
export const LIFT_RAD = (4 * Math.PI) / 180;

/** The table's lean, as the 3D camera turns it: `TILT` in camera.ts, in radians. */
export const tiltRad = (tiltDeg: number) => (tiltDeg * Math.PI) / 180;

export interface Pose<T> {
  item: T;
  /** The card's centre on the table, in table units (see above). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The card's turn about its centre, in radians counterclockwise (Three's z rotation), from the seat's lean. */
  turn: number;
  /** Its place in its pile, 0 for the bottom card; the top one carries the pile's badge. */
  stack: number;
  /** How many cards are in its pile. */
  pile: number;
}

export interface Row<T> {
  kind: keyof typeof CARD3D;
  piles: T[][];
}

/**
 * The biggest a seat's cards grow on the 3D table, before they would outgrow its mat: higher
 * than the CSS table's K_MAX, since a mat is the whole battlefield and the far seats' cards
 * are seen smaller.
 */
export const K_MAX_3D = 1.9;

/**
 * Where the cards of one seat go. `rows` run from the seat's own edge inward (lands, others,
 * creatures). `box` is the seat's box on the CSS table (`seatBox`), `tableW` and `tableH` the
 * table's size in rem. The cards grow as big as the box lets them (`seatScale`, up to
 * K_MAX_3D). The rows are centred in the box, with ROW_GAP_3D between them, and each
 * row's piles are centred along it, as the CSS flex rows are, then the whole box is turned by
 * its lean about its centre.
 */
export function layoutSeat<T>(seat: Seat, box: SeatBox, rows: Row<T>[], tableW: number, tableH: number): Pose<T>[] {
  const used = rows.filter((r) => r.piles.length);
  if (!used.length) return [];
  const k = seatScale({
    rows: used.map((r) => ({ ...CARD3D[r.kind], piles: r.piles.map((p) => p.length) })),
    rowLen: box.width,
    room: box.height,
    max: K_MAX_3D,
    gap: ROW_GAP_3D,
  });
  const heights = used.map((r) => CARD3D[r.kind].h * k);
  const total = heights.reduce((a, b) => a + b, 0) + ROW_GAP_3D * (used.length - 1);
  // CSS terms first (rem from the table's top-left, y down). The bottom seats' rows run up from the box's bottom edge.
  const poses: { x: number; y: number; w: number; h: number; stack: number; pile: number; item: T }[] = [];
  let edge = seat.v === 'bottom' ? box.top + box.height - (box.height - total) / 2 : box.top + (box.height - total) / 2;
  used.forEach((row, i) => {
    const size = CARD3D[row.kind];
    const w = size.w * k;
    const h = heights[i];
    const sizes = row.piles.map((p) => p.length);
    const gap = rowGap(sizes, w, size.gap, box.width);
    const len = rowUnits(sizes) * w + gap * (sizes.length - 1);
    const cy = seat.v === 'bottom' ? edge - h / 2 : edge + h / 2;
    let x = box.left + (box.width - len) / 2;
    for (const pile of row.piles) {
      pile.forEach((item, j) => poses.push({ item, x: x + w / 2 + j * PILE_STEP * w, y: cy, w, h, stack: j, pile: pile.length }));
      x += (1 + PILE_STEP * (pile.length - 1)) * w + gap;
    }
    edge += (seat.v === 'bottom' ? -1 : 1) * (h + ROW_GAP_3D);
  });
  // The lean: CSS turns the box clockwise about its centre.
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const lean = (box.lean * Math.PI) / 180;
  const cos = Math.cos(lean);
  const sin = Math.sin(lean);
  return poses.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    // Clockwise in CSS (y down) is [cos -sin; sin cos].
    const x = cx + dx * cos - dy * sin;
    const y = cy + dx * sin + dy * cos;
    // Into table units: x from the middle, y up from the bottom edge. A clockwise CSS turn is a negative Three one.
    return { item: p.item, x: x - tableW / 2, y: tableH - y, w: p.w, h: p.h, turn: -lean || 0, stack: p.stack, pile: p.pile };
  });
}

/** A card held in an opponent's hand on the 3D table, before `heldFan` fits the fan to its room: its size, rem. */
export const HELD = { w: 10.5, h: 10.5 * 1.4 };
/** How far below the held cards' bottoms the fan turns about (the holder's grip), rem. */
const HELD_GRIP = 8;
/** The most the fan turns from one card to the next, and over the whole hand, radians. */
const HELD_STEP = (10 * Math.PI) / 180;
const HELD_SPREAD = (80 * Math.PI) / 180;
/** How far the held cards lean back from upright, away from you, radians: enough that their backs face you, as a held hand's do across a table. */
export const HELD_LEAN = (40 * Math.PI) / 180;
/** How far apart the held cards are, front to back, rem. */
const HELD_DEPTH = 0.06;

export interface HeldCard {
  /** The card's middle in the fan's plane (x across, y up it from the middle card's bottom edge) and how far in front of the first card, rem. */
  x: number;
  y: number;
  z: number;
  /** Its turn in the plane, radians counterclockwise (Three's z rotation): the left cards lean left. */
  turn: number;
}

/**
 * An opponent's `n` cards (up to 12 drawn) held fanned out in `room` rem across: each turned
 * about a grip under the fan, the first on the left and each next one in front of the one
 * before, as a hand is held. The fan is scaled down (`k`) to fit `room`. `lift` is how high its
 * plane's origin stands off the table, so that, leant back by HELD_LEAN, no corner dips into
 * the table.
 */
export function heldFan(n: number, room: number) {
  const step = n > 1 ? Math.min(HELD_STEP, HELD_SPREAD / (n - 1)) : 0;
  const half = (step * (n - 1)) / 2;
  const reach = HELD_GRIP + HELD.h;
  const width = 2 * reach * Math.sin(half) + HELD.w * Math.cos(half);
  const k = Math.min(1, room / width);
  const w = HELD.w * k;
  const h = HELD.h * k;
  const grip = HELD_GRIP * k;
  let low = 0;
  const cards: HeldCard[] = Array.from({ length: n }, (_, i) => {
    const a = (i - (n - 1) / 2) * step;
    // Clockwise from up by `a`: the right-hand cards lean right.
    const r = grip + h / 2;
    const x = r * Math.sin(a);
    const y = r * Math.cos(a) - grip;
    // The lowest of its bottom corners, in the plane.
    low = Math.min(low, y - (h / 2) * Math.cos(a) - (w / 2) * Math.abs(Math.sin(a)));
    return { x, y, z: i * HELD_DEPTH, turn: -a };
  });
  return { cards, w, h, k, lift: -low * Math.cos(HELD_LEAN) + 0.4 };
}

/**
 * The CSS `matrix3d` (its 16 numbers, column by column) that lays a `w` × `h` box, turned about
 * its top-left corner, exactly onto the quadrilateral `q`: its top-left, top-right,
 * bottom-right and bottom-left corners, in px. It is a homography, so the box is turned,
 * stretched and foreshortened as the card it stands for is on the screen (Table3D.tsx's
 * proxies). After Heckbert, "Fundamentals of Texture Mapping" (1989): the unit square onto `q`,
 * then scaled to the box.
 */
export function quadMatrix(w: number, h: number, q: readonly (readonly [number, number])[]): number[] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  let g = 0;
  let k = 0;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    const dx1 = x1 - x2;
    const dx2 = x3 - x2;
    const dy1 = y1 - y2;
    const dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    k = (dx1 * sy - sx * dy1) / den;
  }
  // (u, v) in the unit square goes to ((a u + b v + c) / (g u + k v + 1), (d u + e v + f) / (…)).
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + k * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + k * y3;
  return [a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, x0, y0, 0, 1];
}

/**
 * The camera that sees the table as the CSS one does (camera.ts): at the middle of the
 * screen's bottom edge, `depth` out from the screen, looking straight in. Its frame is the
 * screen, `w` × `h` (rem), with that point at the bottom middle: a frustum twice the screen's
 * height, of which the top half is drawn (`viewOffset`). Degrees for the fov, as Three takes.
 */
export function baseCamera(w: number, h: number, depth: number) {
  return {
    position: [0, 0, depth] as [number, number, number],
    fov: (2 * Math.atan(h / depth) * 180) / Math.PI,
    aspect: w / (2 * h),
    viewOffset: { fullWidth: w, fullHeight: 2 * h, x: 0, y: 0, width: w, height: h },
  };
}
