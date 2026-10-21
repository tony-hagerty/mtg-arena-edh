import { camera } from '../camera';
import type { SeatBox } from '../table-layout';
import type { Seat } from '../util';
import { fbm, hash, valueNoise } from './noise';

/*
  The 3D table's board (Garden.tsx draws it): a torch-lit hall for four, its floor flagstones
  (floor.ts). Pure maths, no DOM or Three: tests/garden.test.ts checks it.

  - Four mats lie flat on the flagstones, one in each corner of the table, where the seats are
    (`seatOf`: bottom left, top left, top right, bottom right, clockwise in turn order). They
    are the same size on the table, so the far two look smaller, as the table leans away. The
    near two start just above the bottom of the screen, so their edge shows.
  - Each mat is a material, dark and plain enough that the cards on it read, with a border
    worked into it: worn leather with stitching (yours), oak planks in a darker frame, slate
    slabs with a brass line, and a woven cloth with a gold trim.
  - A well where the paths between the mats cross, which is the exile (400.1: exile is shared,
    not any one player's). The mats' corners nearest it curve in around it.
  - Each mat is its seat's battlefield (`seatArea`): its library and graveyard lie along the
    seat's own edge, and its rows of permanents in the rest, clear of the well.

  Coordinates are the table's (layout3d.ts): rem, x from the middle of the near edge (right
  is positive), y up the table from the near edge.
*/

export type Material = 'leather' | 'wood' | 'slate' | 'cloth';

export interface Bed {
  material: Material;
  /** Which corner of the table, or the whole of its near or far side (`full`). */
  v: 'bottom' | 'top';
  h: 'left' | 'right' | 'full';
  /** The mat's rectangle. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Garden {
  beds: Bed[];
  /** The well: its water's middle and radius. */
  pond: { x: number; y: number; r: number };
}

/** Half the width of the paths between the mats, rem. */
export const PATH = 3.2;
/** How rounded a mat's corners are, rem. */
export const BED_CORNER = 1.6;
/** How wide the border worked into each mat is, rem. */
export const BORDER = 1.3;
/** The well's water radius, rem. */
export const POND_R = 13;
/** How far the mats keep from the well's water: its wall and a path around it, rem. */
export const POND_CLEAR = 4.2;
/**
 * The margins between the mats and the table's edges, rem: the sides, and the far edge, which
 * leaves room for the hall's back. The near mats start NEAR_ABOVE rem above the bottom of the
 * screen, so their edge shows.
 */
const MARGIN = { side: 2, far: 16 };
const NEAR_ABOVE = 0.9;

/** The materials by corner, in turn order from the bottom left (`seatOf`'s order for four). */
const CORNERS: Pick<Bed, 'v' | 'h' | 'material'>[] = [
  { v: 'bottom', h: 'left', material: 'leather' },
  { v: 'top', h: 'left', material: 'wood' },
  { v: 'top', h: 'right', material: 'slate' },
  { v: 'bottom', h: 'right', material: 'cloth' },
];

/** Table y (up from the near edge) of a point `up` rem above the bottom of a `stageW` × `stageH` screen, its table `tableH` deep. */
function upTable(up: number, stageW: number, stageH: number, tableH: number) {
  return tableH - camera(stageW, stageH, 1).toTable({ x: stageW / 2, y: stageH - up }).y;
}

/** The four corners' seats, for a game of four (`seatOf`). */
const FOUR: Seat[] = CORNERS.map(({ v, h }) => ({ v, h }));

/**
 * The board on a table `tableW` × `tableH` rem, seen on a screen `stageW` × `stageH`, for the
 * game's `seats` (`seatOf`; four corners unless given): a mat for each seat, the well where
 * the paths between them cross. A seat in a corner has its corner's mat; a seat alone on its
 * side of the table (two players, or you with three) has one mat the whole width of that side,
 * in its own corner's material (the whole bottom edge is the bottom left's), curving in round
 * the well. Every mat is the same depth, so the far ones look shallower.
 */
export function gardenPlan(stageW: number, stageH: number, tableW: number, tableH: number, seats: Seat[] = FOUR): Garden {
  const near = upTable(NEAR_ABOVE, stageW, stageH, tableH);
  const cross = (near + tableH - MARGIN.far) / 2;
  const beds = seats.map((seat): Bed => {
    const alone = seat.h === 'full' || seats.filter((o) => o.v === seat.v).length === 1;
    const h = alone ? 'full' : seat.h;
    const corner = seat.h === 'full' ? 'left' : seat.h;
    return {
      material: CORNERS.find((c) => c.v === seat.v && c.h === corner)!.material,
      v: seat.v,
      h,
      x0: h === 'right' ? PATH : -tableW / 2 + MARGIN.side,
      x1: h === 'left' ? -PATH : tableW / 2 - MARGIN.side,
      y0: seat.v === 'bottom' ? near : cross + PATH,
      y1: seat.v === 'bottom' ? cross - PATH : tableH - MARGIN.far,
    };
  });
  return { beds, pond: { x: 0, y: cross, r: POND_R } };
}

/** A rounded rectangle's signed distance (negative inside), for a point `dx`, `dy` from its middle, half-sizes `hx`, `hy`, corner radius `r`. */
export function roundedBoxDistance(dx: number, dy: number, hx: number, hy: number, r: number) {
  const qx = Math.abs(dx) - (hx - r);
  const qy = Math.abs(dy) - (hy - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** A mat's signed distance (negative inside): its rounded rectangle, less the round it keeps clear of the well. */
export function bedDistance(g: Garden, b: Bed, x: number, y: number) {
  const box = roundedBoxDistance(x - (b.x0 + b.x1) / 2, y - (b.y0 + b.y1) / 2, (b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2, BED_CORNER);
  return Math.max(box, g.pond.r + POND_CLEAR - Math.hypot(x - g.pond.x, y - g.pond.y));
}

/** The mat under the point (`x`, `y`), or null on a path or the well. */
export const bedAt = (g: Garden, x: number, y: number) => g.beds.find((b) => bedDistance(g, b, x, y) <= 0) ?? null;

/* ---------- each seat's area: its piles and its battlefield ---------- */

export interface PileSpot {
  /** The pile's middle on the table, in table units (see above), and its size there (5:7). */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where an opponent holds their hand (`seatArea`): the foot of the fan's middle on the table, and how wide it may spread, rem. */
export interface HandSpot {
  x: number;
  y: number;
  room: number;
}

/** A pile's size on the table, rem, and the space between a seat's two: the same for every seat, so the far seats' look smaller. */
export const PILE = { w: 10.8, h: 10.8 * 1.4, gap: 2.4 };
/** How far the piles keep inside their mat's edges, past its border, rem; a near seat's a little further, so their counts clear the bottom of the screen. */
const PILE_IN = BORDER + 0.9;
const PILE_IN_NEAR = BORDER + 2.6;
/** How far up its mat from the piles' near edge a near opponent holds their hand, rem. */
const HAND_UP = 2.5;
/**
 * How far each seat's library keeps from the table's middle across, rem: the near ones clear
 * the controls (36rem wide); the far ones lie against their mat's inner edge, by the middle
 * path (above the controls' level, the log bar is short and sits higher on the screen).
 */
const PILE_INNER = { near: 19.5, far: PATH + PILE_IN };
/** The space between the piles' strip and the rows, and between the rows and a mat's edge or the well, rem. */
const ROOM = 1.5;
/**
 * What stands on the screen over the table, which the rows keep clear of: the portraits along
 * the side edges (the rows start BOX_LEFT rem in), at the bottom your hand (ABOVE_HAND rem up
 * at its highest) and the controls with their seat arrows in the middle (ABOVE_CONTROLS rem
 * up, CONTROLS_HALF rem either side of the middle, table rem as much as screen rem there).
 */
const BOX_LEFT = 20.3;
const ABOVE_HAND = 17.5;
const ABOVE_CONTROLS = 24.4;
const CONTROLS_HALF = 20;

/**
 * Seat `seat`'s area on its mat, for a screen `stageW` × `stageH` rem and its table: where its
 * library and graveyard lie (along the mat's own edge, just inside it, the library nearest the
 * middle across: a far seat's against its mat's inner edge), and the box its rows of
 * permanents fill (`layoutSeat`), in the CSS table's terms as `seatBox` gives it: as much of
 * the rest of the mat as is clear of the piles, the well and what stands on the screen over
 * the table. Rows lie square to the mat (no lean). The whole bottom edge (three
 * players) spans both near mats and the path between them. And where the seat's hand is held,
 * if it is an opponent's (`HandSpot`).
 */
export function seatArea(seat: Seat, g: Garden, stageW: number, stageH: number, tableW: number, tableH: number) {
  const cam = camera(stageW, stageH, 1);
  /** Table x of the screen's point `sx` rem from its left edge, at table depth `y`. */
  const xAt = (sx: number, y: number) => {
    const p = cam.toScreen({ x: stageW / 2, y: tableH - y });
    return cam.toTable({ x: sx, y: p.y }).x - tableW / 2;
  };
  const right = seat.h === 'right';
  const near = seat.v === 'bottom';
  const beds = g.beds.filter((b) => b.v === seat.v && (seat.h === 'full' || b.h === 'full' || b.h === seat.h));
  // Its mat spans its whole side: the rows may use all of it (the piles stay in the seat's corner).
  const full = seat.h === 'full' || beds.some((b) => b.h === 'full');
  const x0 = Math.min(...beds.map((b) => b.x0));
  const x1 = Math.max(...beds.map((b) => b.x1));
  const y0 = beds[0].y0;
  const y1 = beds[0].y1;
  // The piles: outward from the inner edge, a pile and a gap a step.
  const pileY = near ? y0 + PILE_IN_NEAR + PILE.h / 2 : y1 - PILE_IN - PILE.h / 2;
  const spot = (i: number): PileSpot => {
    const inner = (near ? PILE_INNER.near : PILE_INNER.far) + i * (PILE.w + PILE.gap) + PILE.w / 2;
    return { x: right ? inner : -inner, y: pileY, w: PILE.w, h: PILE.h };
  };
  const piles = { library: spot(0), graveyard: spot(1) };
  // The rows' box, table y up (xa..xb across, ya..yb up), in from the mat's border.
  const inX0 = x0 + BORDER + ROOM;
  const inX1 = x1 - BORDER - ROOM;
  const wellClear = g.pond.r + POND_CLEAR + ROOM;
  /** Clear of the portraits, at the box's nearest (widest on the screen) edge. */
  const sides = (ya: number) => ({ a: Math.max(inX0, xAt(BOX_LEFT, ya)), b: Math.min(inX1, xAt(stageW - BOX_LEFT, ya)) });
  type Span = { xa: number; xb: number; ya: number; yb: number };
  const area = (p: Span) => (p.xb - p.xa) * (p.yb - p.ya);
  let span: Span;
  if (near) {
    // Beside the controls: above the piles and the hand, on the seat's side of the controls
    // rather than above them, which keeps it clear of the well too (CONTROLS_HALF is wider
    // than the well's clearing), so it runs all the way up to the mat's inner edge.
    const besideYa = Math.max(pileY + PILE.h / 2 + ROOM, upTable(ABOVE_HAND, stageW, stageH, tableH));
    const sb = sides(besideYa);
    const besideYb = CONTROLS_HALF >= wellClear ? y1 - BORDER - ROOM : g.pond.y - wellClear;
    const beside: Span = right ? { xa: Math.max(sb.a, CONTROLS_HALF), xb: sb.b, ya: besideYa, yb: besideYb } : { xa: sb.a, xb: Math.min(sb.b, -CONTROLS_HALF), ya: besideYa, yb: besideYb };
    // Above the controls: the mat's whole width, short of the well.
    const aboveYa = Math.max(pileY + PILE.h / 2 + ROOM, upTable(ABOVE_CONTROLS, stageW, stageH, tableH));
    const sa = sides(aboveYa);
    const above: Span = { xa: sa.a, xb: sa.b, ya: aboveYa, yb: g.pond.y - wellClear };
    // A corner's mat has only its side; the whole bottom edge's seat sits on both, so only
    // above suits it; a corner seat with the whole side's mat takes whichever is bigger.
    span = !full ? beside : seat.h === 'full' ? above : area(beside) > area(above) ? beside : above;
  } else {
    // A far mat: short of the piles, and either short of the well across its whole width, or
    // up to its inner edge beside the well (on the seat's own side of it); whichever leaves more room.
    const yb = pileY - PILE.h / 2 - ROOM;
    const fullYa = g.pond.y + wellClear;
    const besideYa = y0 + BORDER + ROOM;
    const sFull = sides(fullYa);
    const sBeside = sides(besideYa);
    const across: Span = { xa: sFull.a, xb: sFull.b, ya: fullYa, yb };
    const beside: Span = right ? { xa: Math.max(sBeside.a, wellClear), xb: sBeside.b, ya: besideYa, yb } : { xa: sBeside.a, xb: Math.min(sBeside.b, -wellClear), ya: besideYa, yb };
    span = area(beside) > area(across) ? beside : across;
  }
  const box: SeatBox = { left: span.xa + tableW / 2, top: tableH - span.yb, width: span.xb - span.xa, height: span.yb - span.ya, lean: 0 };
  // An opponent's hand, held at the back of their mat (its own edge) beside the piles, on the
  // side away from the middle: on the far side of the middle from them for a seat along the
  // whole edge. Its middle there, and how much of the edge it has.
  // It stands at the near side of the piles' strip and leans back over it, so a far seat's
  // stays on the screen; a near seat's a little further in, so its foot and count do.
  const outer = PILE_INNER[near ? 'near' : 'far'] + 2 * PILE.w + PILE.gap + ROOM;
  const from = seat.h === 'full' ? PILE_INNER[near ? 'near' : 'far'] : outer;
  const to = right || seat.h === 'full' ? inX1 : -inX0;
  const toward = right || seat.h === 'full' ? 1 : -1;
  const hand: HandSpot = { x: toward * ((from + to) / 2), y: pileY - PILE.h / 2 + (near ? HAND_UP : 0), room: Math.max(0, to - from) };
  return { box, piles, hand };
}

/* ---------- the mats' maps ---------- */

type RGB = [number, number, number];

/** Each material's colours (its field and its border) and how it takes the light (Garden.tsx). */
export const MATERIAL: Record<Material, { base: RGB; border: RGB; roughness: number }> = {
  leather: { base: [72, 50, 36], border: [52, 35, 25], roughness: 0.7 },
  wood: { base: [76, 54, 36], border: [46, 32, 22], roughness: 0.8 },
  slate: { base: [56, 61, 68], border: [44, 47, 52], roughness: 0.6 },
  cloth: { base: [56, 34, 38], border: [40, 24, 26], roughness: 0.95 },
};

/** The slate's slabs and the wood's planks, rem. */
const SLAB = 15;
const PLANK = 4.6;

export interface BedMaps {
  width: number;
  height: number;
  /** RGBA, sRGB: the mat's surface; clear outside it (round its corners and the well). */
  albedo: Uint8ClampedArray;
  /** RGBA: the tangent-space normal, +y up the table. */
  normal: Uint8ClampedArray;
}

/**
 * Mat `b`'s maps over its rectangle, `px` pixels a rem. Row 0 is its near edge, as Three
 * reads a DataTexture. Every material is a height and a shade, worked out at each pixel from
 * where it lies (in rem, so a texture is the same size at any `px`):
 *
 * - leather: a pebbled grain, a slow mottle of wear, and a line of stitches round its border;
 * - wood: planks along the seat's edge, staggered, each its own shade, with grain and dark seams;
 * - slate: slabs with fine joints and a chiselled face, a brass line round the border;
 * - cloth: a fine weave, worn paler in patches, a gold trim with a line through it.
 *
 * The border is its own darker band, `BORDER` wide, a little raised at its inner edge.
 */
export function bedMaps(g: Garden, b: Bed, px: number): BedMaps {
  const W = Math.max(1, Math.round((b.x1 - b.x0) * px));
  const H = Math.max(1, Math.round((b.y1 - b.y0) * px));
  const albedo = new Uint8ClampedArray(W * H * 4);
  const normal = new Uint8ClampedArray(W * H * 4);
  const height = new Float32Array(W * H);
  const m = MATERIAL[b.material];
  for (let j = 0; j < H; j++) {
    const y = b.y0 + (j + 0.5) / px;
    for (let i = 0; i < W; i++) {
      const x = b.x0 + (i + 0.5) / px;
      const d = bedDistance(g, b, x, y);
      // How far in from the mat's edge: the border is the first BORDER rem.
      const inside = -d;
      const border = inside < BORDER;
      let h = 0.5;
      let shade = 1;
      let color: RGB = border ? m.border : m.base;
      switch (b.material) {
        case 'leather': {
          const grain = valueNoise(x * 5, y * 5, 3);
          const wear = fbm(x, y, 10, 4);
          h = 0.3 + grain * 0.5;
          shade = 0.82 + wear * 0.3 + (grain - 0.5) * 0.08;
          // Stitches: short dashes along a line in the middle of the border.
          const s = Math.abs(inside - BORDER * 0.55);
          const along = (x - b.x0 + y - b.y0) / 0.7;
          if (s < 0.09 && along - Math.floor(along) < 0.55) {
            color = [150, 118, 82];
            shade = 1;
            h = 0.9;
          }
          break;
        }
        case 'wood': {
          const row = Math.floor((y - b.y0) / PLANK);
          const v = (y - b.y0) / PLANK - row;
          // Staggered plank ends along each row.
          const len = 22 + hash(row, 0, 7) * 12;
          const u = (x - b.x0 + hash(row, 1, 7) * len) / len;
          const end = u - Math.floor(u);
          const seam = Math.min(v, 1 - v) * PLANK < 0.12 || Math.min(end, 1 - end) * len < 0.12;
          const plank = hash(row, Math.floor(u), 8);
          const grain = Math.sin((y + valueNoise(x * 0.12, y * 2, 9) * 3) * 9) * 0.5 + 0.5;
          h = seam ? 0 : 0.5 + grain * 0.15;
          shade = (0.82 + plank * 0.28 + grain * 0.08 + (fbm(x, y, 8, 10) - 0.5) * 0.1) * (seam ? 0.55 : 1);
          break;
        }
        case 'slate': {
          const u = (((x - b.x0) % SLAB) + SLAB) % SLAB;
          const v = (((y - b.y0) % SLAB) + SLAB) % SLAB;
          const joint = Math.min(u, SLAB - u, v, SLAB - v);
          const chisel = valueNoise(x * 2.2, y * 2.2, 11);
          const slab = hash(Math.floor((x - b.x0) / SLAB), Math.floor((y - b.y0) / SLAB), 12);
          h = border ? 0.5 : Math.min(1, joint / 0.25) * (0.45 + chisel * 0.25);
          shade = (0.86 + slab * 0.16 + (chisel - 0.5) * 0.12 + (fbm(x, y, 7, 13) - 0.5) * 0.1) * (!border && joint < 0.08 ? 0.6 : 1);
          // A brass line round the field, just inside the border.
          if (Math.abs(inside - BORDER) < 0.12) {
            color = [150, 116, 56];
            shade = 0.9 + chisel * 0.15;
            h = 0.7;
          }
          break;
        }
        case 'cloth': {
          // A weave: threads across and along, over and under.
          const k = (Math.PI * 2) / 0.55;
          const a = Math.sin(x * k);
          const c = Math.sin(y * k);
          h = 0.5 + 0.25 * (Math.sign(a * c) * Math.min(Math.abs(a), Math.abs(c)));
          const wear = fbm(x, y, 9, 14);
          shade = 0.82 + wear * 0.26 + (h - 0.5) * 0.25;
          if (border) {
            color = [116, 88, 40];
            shade = 0.75 + wear * 0.25 + (h - 0.5) * 0.2;
            // A dark line through the middle of the trim.
            if (Math.abs(inside - BORDER * 0.5) < 0.1) shade *= 0.45;
          }
          break;
        }
      }
      // The border's inner edge stands a little proud of the field.
      if (Math.abs(inside - BORDER) < 0.15) h = Math.max(h, 0.8);
      const k = j * W + i;
      height[k] = h;
      const o = k * 4;
      albedo[o] = color[0] * shade;
      albedo[o + 1] = color[1] * shade;
      albedo[o + 2] = color[2] * shade;
      // Soft at the edge, a pixel wide.
      albedo[o + 3] = 255 * Math.min(1, Math.max(0, 0.5 - d * px));
    }
  }
  // The normal from the height's slope.
  const depth = (b.material === 'cloth' ? 0.8 : b.material === 'leather' ? 0.9 : 0.7) * (px / 8);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const o = (j * W + i) * 4;
      const hx = (height[j * W + Math.min(W - 1, i + 1)] - height[j * W + Math.max(0, i - 1)]) * depth;
      const hy = (height[Math.min(H - 1, j + 1) * W + i] - height[Math.max(0, j - 1) * W + i]) * depth;
      const l = Math.hypot(hx, hy, 1);
      normal[o] = (0.5 - hx / l / 2) * 255;
      normal[o + 1] = (0.5 - hy / l / 2) * 255;
      normal[o + 2] = (0.5 + 0.5 / l) * 255;
      normal[o + 3] = 255;
    }
  return { width: W, height: H, albedo, normal };
}
