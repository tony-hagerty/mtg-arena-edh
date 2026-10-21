import { camera } from '../camera';
import type { SeatBox } from '../table-layout';
import type { Seat } from '../util';
import { rng } from './floor';

/*
  The 3D table's board (Garden.tsx draws it): a courtyard for four, after Arena's garden
  board. Pure maths, no DOM or Three: tests/garden.test.ts checks it.

  - Four mats, one in each corner of the table, where the seats are (`seatOf`: bottom left,
    top left, top right, bottom right, clockwise in turn order), each kept by a low curb.
    They are the same size on the table, so the far two look smaller, as the table leans
    away. The flagstone floor (floor.ts) shows between them as paths, a cross whose middle
    is halfway between the mats' near and far edges.
  - Each mat is a season, in turn order from yours, and a material: spring is moss, summer
    raked sand, autumn gravel, winter pale stone slabs. They are kept quiet, so the cards on
    them read: a soft mottle, the rake's lines, a few of the season's petals, leaves or frost
    along the curb. The trees nearest each mat wear its season.
  - A koi pond where the paths cross, which is the exile (400.1: exile is shared, not any
    one player's). The mats' corners nearest it curve in around it.
  - Each mat is its seat's battlefield (`seatArea`): its library and graveyard lie along the
    seat's own edge, and its rows of permanents in the rest, clear of the pond.

  Coordinates are the table's (layout3d.ts): rem, x from the middle of the near edge (right
  is positive), y up the table from the near edge.
*/

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Material = 'moss' | 'sand' | 'gravel' | 'stone';

export interface Bed {
  season: Season;
  material: Material;
  /** Which corner of the table. */
  v: 'bottom' | 'top';
  h: 'left' | 'right';
  /** The mat's rectangle, inside its curb. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Garden {
  beds: Bed[];
  pond: { x: number; y: number; r: number };
}

/** Half the width of the paths between the mats, rem. */
export const PATH = 3.2;
/** How rounded a mat's corners are, rem. */
export const BED_CORNER = 2.4;
/** The curb's width and height, rem. Low, so a card at a mat's edge lies over it. */
export const CURB = { w: 0.9, h: 0.22 };
/** The pond's radius, rem. */
export const POND_R = 16;
/** How far the mats keep from the pond's water: its rim stones and a path around them, rem. */
export const POND_CLEAR = 3.4;
/** The margins between the mats and the table's edges, rem: the far one leaves room for the wood along it. */
const MARGIN = { side: 2, near: 0.8, far: 7 };

/** The seasons and materials by corner, in turn order from the bottom left (`seatOf`'s order for four). */
const CORNERS: Pick<Bed, 'v' | 'h' | 'season' | 'material'>[] = [
  { v: 'bottom', h: 'left', season: 'spring', material: 'moss' },
  { v: 'top', h: 'left', season: 'summer', material: 'sand' },
  { v: 'top', h: 'right', season: 'autumn', material: 'gravel' },
  { v: 'bottom', h: 'right', season: 'winter', material: 'stone' },
];

/** The garden on a table `tableW` × `tableH` rem: four mats of one size, the pond where the paths between them cross. */
export function gardenPlan(tableW: number, tableH: number): Garden {
  const cross = (MARGIN.near + tableH - MARGIN.far) / 2;
  const beds = CORNERS.map(
    (c): Bed => ({
      ...c,
      x0: c.h === 'left' ? -tableW / 2 + MARGIN.side : PATH,
      x1: c.h === 'left' ? -PATH : tableW / 2 - MARGIN.side,
      y0: c.v === 'bottom' ? MARGIN.near : cross + PATH,
      y1: c.v === 'bottom' ? cross - PATH : tableH - MARGIN.far,
    }),
  );
  return { beds, pond: { x: 0, y: cross, r: POND_R } };
}

/** A rounded rectangle's signed distance (negative inside), for a point `dx`, `dy` from its middle, half-sizes `hx`, `hy`, corner radius `r`. */
export function roundedBoxDistance(dx: number, dy: number, hx: number, hy: number, r: number) {
  const qx = Math.abs(dx) - (hx - r);
  const qy = Math.abs(dy) - (hy - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** A mat's signed distance (negative inside): its rounded rectangle, less the round it keeps clear of the pond. */
export function bedDistance(g: Garden, b: Bed, x: number, y: number) {
  const box = roundedBoxDistance(x - (b.x0 + b.x1) / 2, y - (b.y0 + b.y1) / 2, (b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2, BED_CORNER);
  return Math.max(box, g.pond.r + POND_CLEAR - Math.hypot(x - g.pond.x, y - g.pond.y));
}

/** The mat under the point (`x`, `y`), or null on a path or the pond. */
export const bedAt = (g: Garden, x: number, y: number) => g.beds.find((b) => bedDistance(g, b, x, y) <= 0) ?? null;

/**
 * A mat's outline grown by `grow` rem (less than 0 shrinks it), counterclockwise, in the
 * table's coordinates: its rounded rectangle, sampled finely, with the points that fall in
 * the pond's clearing pushed out onto its edge, so the corner nearest the pond curves in
 * around it. For the curb (Garden.tsx), which runs between the outline and the mat's edge.
 */
export function bedOutline(g: Garden, b: Bed, grow: number): [number, number][] {
  const hx = (b.x1 - b.x0) / 2 + grow;
  const hy = (b.y1 - b.y0) / 2 + grow;
  const r = BED_CORNER + grow;
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const clear = g.pond.r + POND_CLEAR - grow;
  const pts: [number, number][] = [];
  // Each corner's arc, then the straight side after it, a point every half rem.
  const corners: [number, number, number][] = [
    [hx - r, hy - r, 0],
    [-hx + r, hy - r, Math.PI / 2],
    [-hx + r, -hy + r, Math.PI],
    [hx - r, -hy + r, (3 * Math.PI) / 2],
  ];
  corners.forEach(([ax, ay, a0], k) => {
    for (let i = 0; i <= 8; i++) {
      const a = a0 + (i / 8) * (Math.PI / 2);
      pts.push([cx + ax + r * Math.cos(a), cy + ay + r * Math.sin(a)]);
    }
    const [bx, by, b0] = corners[(k + 1) % 4];
    const from = [cx + ax + r * Math.cos(a0 + Math.PI / 2), cy + ay + r * Math.sin(a0 + Math.PI / 2)];
    const to = [cx + bx + r * Math.cos(b0), cy + by + r * Math.sin(b0)];
    const steps = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.5);
    for (let i = 1; i < steps; i++) pts.push([from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps]);
  });
  return pts.map(([x, y]) => {
    const d = Math.hypot(x - g.pond.x, y - g.pond.y);
    return d < clear ? [g.pond.x + ((x - g.pond.x) / d) * clear, g.pond.y + ((y - g.pond.y) / d) * clear] : [x, y];
  });
}

/* ---------- each seat's area: its piles and its battlefield ---------- */

export interface PileSpot {
  /** The pile's middle on the table, in table units (see above), and its size there (5:7). */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A pile's size on the table, rem: the same for every seat, so the far seats' look smaller. */
export const PILE = { w: 9.6, h: 9.6 * 1.4, gap: 0.75 };
/** How far your piles' near edge stands above the bottom of the screen, rem: close, not touching. */
const PILE_ABOVE = 1;
/** How far each seat's library keeps from the table's middle across, rem: the near ones clear the controls (36rem wide), the far ones the log bar. */
const PILE_INNER = { near: 18.8, far: 26 };
/** How far the far seats' piles keep from their mat's far edge, rem. */
const PILE_FROM_EDGE = 1.2;
/** The space between the piles' strip and the rows, and between the rows and a mat's curb or the pond, rem. */
const ROOM = 1.5;
/**
 * Where on the screen the rows keep clear of: the portraits along the side edges (the rows
 * start BOX_LEFT in), and at the bottom the hand and the controls with their seat arrows
 * (the near seats' rows start ABOVE_CONTROLS up). In screen rem, as table-layout.ts has them.
 */
const BOX_LEFT = 20.3;
const ABOVE_CONTROLS = 24.4;

/**
 * Seat `seat`'s area on its mat, for a screen `stageW` × `stageH` rem and its table: where its
 * library and graveyard lie (the library nearest the middle across, along the seat's own
 * edge: at the bottom just above the screen's edge, at the top just inside the mat's far
 * edge), and the box its rows of permanents fill (`layoutSeat`), in the CSS table's terms as
 * `seatBox` gives it: the rest of the mat, short of the piles, the pond and what stands on
 * the screen over the table. Rows lie square to the mat (no lean). The whole bottom edge
 * (three players) spans both near mats and the path between them.
 */
export function seatArea(seat: Seat, g: Garden, stageW: number, stageH: number, tableW: number, tableH: number) {
  const cam = camera(stageW, stageH, 1);
  /** Table y (up from the near edge) of a point `up` rem above the screen's bottom edge. */
  const upTable = (up: number) => tableH - cam.toTable({ x: stageW / 2, y: stageH - up }).y;
  /** Table x of the screen's point `sx` rem from its left edge, at table depth `y`. */
  const xAt = (sx: number, y: number) => {
    const p = cam.toScreen({ x: stageW / 2, y: tableH - y });
    return cam.toTable({ x: sx, y: p.y }).x - tableW / 2;
  };
  const right = seat.h === 'right';
  const near = seat.v === 'bottom';
  const beds = g.beds.filter((b) => b.v === seat.v && (seat.h === 'full' || b.h === seat.h));
  const x0 = Math.min(...beds.map((b) => b.x0));
  const x1 = Math.max(...beds.map((b) => b.x1));
  const y1 = beds[0].y1;
  // The piles: outward from the inner edge, a pile and a gap a step.
  const pileY = near ? upTable(PILE_ABOVE) + PILE.h / 2 : y1 - PILE_FROM_EDGE - PILE.h / 2;
  const spot = (i: number): PileSpot => {
    const inner = (near ? PILE_INNER.near : PILE_INNER.far) + i * (PILE.w + PILE.gap) + PILE.w / 2;
    return { x: right ? inner : -inner, y: pileY, w: PILE.w, h: PILE.h };
  };
  const piles = { library: spot(0), graveyard: spot(1) };
  // The rows' box, table y up: from past the piles (and the controls, at the bottom) to short of the pond.
  const clear = g.pond.y + (near ? -1 : 1) * (g.pond.r + POND_CLEAR + ROOM);
  const ya = near ? Math.max(pileY + PILE.h / 2 + ROOM, upTable(ABOVE_CONTROLS)) : clear;
  const yb = near ? clear : pileY - PILE.h / 2 - ROOM;
  // Its sides: in from the curbs, and clear of the portraits at the box's nearest (widest on the screen) edge.
  const left = Math.max(x0 + ROOM, xAt(BOX_LEFT, ya));
  const rightSide = Math.min(x1 - ROOM, xAt(stageW - BOX_LEFT, ya));
  const box: SeatBox = { left: left + tableW / 2, top: tableH - yb, width: rightSide - left, height: yb - ya, lean: 0 };
  return { box, piles };
}

/* ---------- the mats' maps ---------- */

/** A cheap hashed value noise, 0..1, smooth between whole-number lattice points. */
function hash(x: number, y: number, seed: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
}
function valueNoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = x - xi;
  const ty = y - yi;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
/** Three octaves of value noise at `scale` rem a cell, 0..1. */
function fbm(x: number, y: number, scale: number, seed: number) {
  return (valueNoise(x / scale, y / scale, seed) * 4 + valueNoise((x * 2) / scale, (y * 2) / scale, seed + 1) * 2 + valueNoise((x * 4) / scale, (y * 4) / scale, seed + 2)) / 7;
}

/** The rake's spacing, rem: one groove to the next. */
const RAKE = 1.1;
/** How far in from the curb a mat lies plain, rem. */
const SMOOTH = 0.7;
/** The stone slabs' size, rem. */
const SLAB = 18;

type RGB = [number, number, number];

/** Each material's base colour, how it is lit (Garden.tsx), and what its season strews along the curb, sparsely. */
export const MATERIAL: Record<Material, { base: RGB; roughness: number; strew: RGB[]; strewSize: [number, number]; strewDensity: number }> = {
  moss: { base: [86, 106, 66], roughness: 1, strew: [[236, 170, 190], [244, 198, 210]], strewSize: [0.3, 0.19], strewDensity: 0.05 },
  sand: { base: [204, 198, 184], roughness: 0.95, strew: [[110, 146, 80], [92, 128, 70]], strewSize: [0.32, 0.2], strewDensity: 0.03 },
  gravel: { base: [146, 130, 112], roughness: 0.9, strew: [[196, 98, 46], [214, 146, 60], [160, 62, 40]], strewSize: [0.42, 0.26], strewDensity: 0.05 },
  stone: { base: [178, 184, 192], roughness: 0.55, strew: [[236, 242, 250]], strewSize: [0.8, 0.6], strewDensity: 0.08 },
};

export interface BedMaps {
  width: number;
  height: number;
  /** RGBA, sRGB: the mat's surface and what is strewn on it; clear outside it (round its corners and the pond). */
  albedo: Uint8ClampedArray;
  /** RGBA: the tangent-space normal, +y up the table. */
  normal: Uint8ClampedArray;
}

/** A groove's profile across one rake spacing: 0 in the furrow, 1 on the ridge. */
const groove = (s: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * s) / RAKE);

/**
 * Mat `b`'s maps over its rectangle, `px` pixels a rem. Row 0 is its near edge, as Three
 * reads a DataTexture. Every material is a height and a shade, both slight:
 *
 * - moss: a slow mottle and a fine fuzz;
 * - sand: the rake's lines along the seat's edge, and rings around the pond;
 * - gravel: small stones, each a little dome of its own shade;
 * - stone: slabs with fine joints and a faint cloud in each.
 */
export function bedMaps(g: Garden, b: Bed, px: number, seed = 5): BedMaps {
  const W = Math.max(1, Math.round((b.x1 - b.x0) * px));
  const H = Math.max(1, Math.round((b.y1 - b.y0) * px));
  const albedo = new Uint8ClampedArray(W * H * 4);
  const normal = new Uint8ClampedArray(W * H * 4);
  const height = new Float32Array(W * H);
  const m = MATERIAL[b.material];
  const rand = rng(seed + b.x0 * 7 + b.y0 * 13);
  const pondRing = g.pond.r + POND_CLEAR;
  for (let j = 0; j < H; j++) {
    const y = b.y0 + (j + 0.5) / px;
    for (let i = 0; i < W; i++) {
      const x = b.x0 + (i + 0.5) / px;
      const d = bedDistance(g, b, x, y);
      const k = j * W + i;
      let h = 0.5;
      let shade = 1;
      switch (b.material) {
        case 'moss': {
          const mottle = fbm(x, y, 9, 11);
          const fuzz = valueNoise(x * 6, y * 6, 12);
          h = 0.5 + (fuzz - 0.5) * 0.5;
          shade = 0.9 + mottle * 0.16 + (fuzz - 0.5) * 0.08;
          break;
        }
        case 'sand': {
          const dr = Math.hypot(x - g.pond.x, y - g.pond.y) - pondRing;
          h = dr < 8 * RAKE ? groove(dr) : groove(y - b.y0);
          shade = 0.96 + 0.05 * h + (fbm(x, y, 14, 21) - 0.5) * 0.06;
          break;
        }
        case 'gravel': {
          // A jittered grid of small stones: the nearest one's dome and shade.
          const cell = 0.42;
          const cx = Math.floor(x / cell);
          const cy = Math.floor(y / cell);
          let best = 9;
          let tint = 0.5;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const sx = (cx + dx + hash(cx + dx, cy + dy, 31)) * cell;
              const sy = (cy + dy + hash(cx + dx, cy + dy, 32)) * cell;
              const dd = Math.hypot(x - sx, y - sy);
              if (dd < best) {
                best = dd;
                tint = hash(cx + dx, cy + dy, 33);
              }
            }
          h = 0.5 + 0.5 * Math.max(0, 1 - best / (cell * 0.75));
          shade = 0.93 + tint * 0.08 + h * 0.03;
          break;
        }
        case 'stone': {
          const u = (((x - b.x0) % SLAB) + SLAB) % SLAB;
          const v = (((y - b.y0) % SLAB) + SLAB) % SLAB;
          const joint = Math.min(u, SLAB - u, v, SLAB - v);
          h = Math.min(1, joint / 0.2);
          const slab = hash(Math.floor((x - b.x0) / SLAB), Math.floor((y - b.y0) / SLAB), 41);
          shade = (0.96 + slab * 0.04 + (fbm(x, y, 6, 42) - 0.5) * 0.04) * (joint < 0.06 ? 0.93 : 1);
          break;
        }
      }
      // Plain by the curb.
      const edge = Math.min(1, Math.max(0, (-d - SMOOTH) / 0.5));
      h = 0.5 + (h - 0.5) * edge;
      height[k] = h;
      const o = k * 4;
      albedo[o] = m.base[0] * shade;
      albedo[o + 1] = m.base[1] * shade;
      albedo[o + 2] = m.base[2] * shade;
      // Soft at the edge, a pixel wide; the curb covers it.
      albedo[o + 3] = 255 * Math.min(1, Math.max(0, 0.5 - d * px));
    }
  }
  strew(g, b, albedo, W, H, px, rand);
  // The normal from the height's slope: shallow, so the light only grazes it.
  const depth = b.material === 'gravel' ? 0.4 : b.material === 'stone' ? 0.4 : 0.45;
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

/** What the season drops on a mat, sparsely and only along its curb, where the cards don't lie: petals, a few leaves, a little frost. */
function strew(g: Garden, b: Bed, albedo: Uint8ClampedArray, W: number, H: number, px: number, rand: () => number) {
  const m = MATERIAL[b.material];
  const count = Math.round((b.x1 - b.x0) * (b.y1 - b.y0) * m.strewDensity);
  const [sa, sc] = m.strewSize;
  for (let n = 0; n < count; n++) {
    const x = b.x0 + rand() * (b.x1 - b.x0);
    const y = b.y0 + rand() * (b.y1 - b.y0);
    const d = bedDistance(g, b, x, y);
    // Only by the curb: kept with a chance falling off over the first rem or two in.
    if (d > -0.3 || rand() > Math.exp(d / 1.4)) continue;
    const [r, gr, bl] = m.strew[Math.floor(rand() * m.strew.length)];
    const a = sa * (0.7 + rand() * 0.6);
    const c = sc * (0.7 + rand() * 0.6);
    const turn = rand() * Math.PI;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const reach = Math.ceil(a * px) + 1;
    const ci = (x - b.x0) * px;
    const cj = (y - b.y0) * px;
    const alpha = b.material === 'stone' ? 0.35 : 0.75;
    for (let j = Math.max(0, Math.floor(cj - reach)); j <= Math.min(H - 1, cj + reach); j++)
      for (let i = Math.max(0, Math.floor(ci - reach)); i <= Math.min(W - 1, ci + reach); i++) {
        const dx = (i + 0.5 - ci) / px;
        const dy = (j + 0.5 - cj) / px;
        const u = (dx * cos + dy * sin) / a;
        const v = (-dx * sin + dy * cos) / c;
        const e = u * u + v * v;
        if (e > 1) continue;
        const o = (j * W + i) * 4;
        if (!albedo[o + 3]) continue;
        const t = alpha * Math.min(1, (1 - e) * 4);
        albedo[o] += (r - albedo[o]) * t;
        albedo[o + 1] += (gr - albedo[o + 1]) * t;
        albedo[o + 2] += (bl - albedo[o + 2]) * t;
      }
  }
}
