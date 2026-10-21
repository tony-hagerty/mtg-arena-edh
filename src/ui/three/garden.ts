import { camera } from '../camera';
import { rng } from './floor';

/*
  The 3D table's board (Garden.tsx draws it): a courtyard for four, after Arena's garden
  board. Pure maths, no DOM or Three: tests/garden.test.ts checks it.

  - Four beds of raked sand, one in each corner of the table, where the seats are (`seatOf`:
    bottom left, top left, top right, bottom right, clockwise in turn order), each kept by a
    low stone curb. The flagstone floor (floor.ts) shows between them as paths, a cross
    through the middle.
  - Each bed is a season, in turn order from yours: spring, summer, autumn, winter. Its sand
    is tinted for it and strewn along its curb with what the season drops (petals, moss,
    leaves, frost), and the trees nearest it wear the same.
  - A koi pond where the paths cross, the middle of the table. The sand is raked in lines
    along each seat's edge, and in rings around the pond and around a spot in each bed, as
    a zen garden's sand is around its stones.

  Coordinates are the table's (layout3d.ts): rem, x from the middle of the near edge (right
  is positive), y up the table from the near edge.
*/

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface Bed {
  season: Season;
  /** The bed's rectangle, inside its curb. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Where its ripple rings centre, and how far they reach. */
  ripple: { x: number; y: number; r: number };
}

export interface Garden {
  beds: Bed[];
  pond: { x: number; y: number; r: number };
}

/** Half the width of the paths between the beds, rem. */
export const PATH = 3.2;
/** How rounded a bed's corners are, rem. */
export const BED_CORNER = 2.4;
/** The curb's width and height, rem. Low, so a card at a bed's edge lies over it. */
export const CURB = { w: 0.9, h: 0.22 };
/** The pond's radius, rem. */
export const POND_R = 15;
/** How far the beds keep from the pond's water: its rim stones and a path around them, rem. */
export const POND_CLEAR = 3.4;
/** The margins between the beds and the table's edges, rem: the far one leaves room for the wood along it. */
const MARGIN = { side: 2, near: 1.5, far: 7 };

/** The seasons by corner, in turn order from the bottom left (`seatOf`'s order for four). */
const CORNERS: { v: 'bottom' | 'top'; h: 'left' | 'right'; season: Season }[] = [
  { v: 'bottom', h: 'left', season: 'spring' },
  { v: 'top', h: 'left', season: 'summer' },
  { v: 'top', h: 'right', season: 'autumn' },
  { v: 'bottom', h: 'right', season: 'winter' },
];

/**
 * The garden for a screen `stageW` × `stageH` rem and its table, `tableW` × `tableH`. The
 * beds meet the paths at the line the screen's middle falls on (where the top seats' rows
 * end and the bottom seats' begin, `seatBox`) and at the table's middle across.
 */
export function gardenPlan(stageW: number, stageH: number, tableW: number, tableH: number): Garden {
  const cam = camera(stageW, stageH, 1);
  const mid = tableH - cam.toTable({ x: stageW / 2, y: stageH / 2 }).y;
  const beds = CORNERS.map(({ v, h, season }): Bed => {
    const x0 = h === 'left' ? -tableW / 2 + MARGIN.side : PATH;
    const x1 = h === 'left' ? -PATH : tableW / 2 - MARGIN.side;
    const y0 = v === 'bottom' ? MARGIN.near : mid + PATH;
    const y1 = v === 'bottom' ? mid - PATH : tableH - MARGIN.far;
    // A third of the way in from the side, halfway up: under the rows, where nothing else is.
    const rx = h === 'left' ? x0 + (x1 - x0) * 0.32 : x1 - (x1 - x0) * 0.32;
    return { season, x0, y0, x1, y1, ripple: { x: rx, y: (y0 + y1) / 2, r: Math.min(x1 - x0, y1 - y0) * 0.3 } };
  });
  return { beds, pond: { x: 0, y: mid, r: POND_R } };
}

/** A rounded rectangle's signed distance (negative inside), for a point `dx`, `dy` from its middle, half-sizes `hx`, `hy`, corner radius `r`. */
export function roundedBoxDistance(dx: number, dy: number, hx: number, hy: number, r: number) {
  const qx = Math.abs(dx) - (hx - r);
  const qy = Math.abs(dy) - (hy - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** A bed's signed distance (negative inside): its rounded rectangle, less the round it keeps clear of the pond. */
export function bedDistance(g: Garden, b: Bed, x: number, y: number) {
  const box = roundedBoxDistance(x - (b.x0 + b.x1) / 2, y - (b.y0 + b.y1) / 2, (b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2, BED_CORNER);
  return Math.max(box, g.pond.r + POND_CLEAR - Math.hypot(x - g.pond.x, y - g.pond.y));
}

/**
 * A bed's outline grown by `grow` rem (less than 0 shrinks it), counterclockwise, in the
 * table's coordinates: its rounded rectangle, sampled finely, with
 * the points that fall in the pond's clearing pushed out onto its edge, so the corner nearest
 * the pond curves in around it. For the curb (Garden.tsx), which runs between the outline
 * and the bed's own edge.
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

/** The rake's spacing, rem: one groove to the next. */
const RAKE = 0.9;
/** How far in from the curb the sand lies smooth, unraked, rem. */
const SMOOTH = 0.7;

/** The sand's colour in each season, and what lies strewn on it. */
const LOOK: Record<Season, { sand: [number, number, number]; strew: [number, number, number][] }> = {
  spring: { sand: [216, 208, 200], strew: [[246, 178, 198], [250, 206, 218], [238, 150, 178]] },
  summer: { sand: [208, 208, 190], strew: [[92, 138, 66], [118, 160, 72], [74, 116, 58]] },
  autumn: { sand: [216, 202, 184], strew: [[214, 92, 40], [232, 150, 52], [168, 52, 36]] },
  winter: { sand: [212, 218, 226], strew: [[250, 252, 255], [236, 244, 252], [214, 228, 244]] },
};

export interface GardenMaps {
  width: number;
  height: number;
  /** RGBA, sRGB: the sand and what is strewn on it; clear outside the beds (the floor shows). */
  albedo: Uint8ClampedArray;
  /** RGBA: the tangent-space normal of the rake's grooves, +y up the table. */
  normal: Uint8ClampedArray;
}

/** A groove's profile across one rake spacing: 0 in the furrow, 1 on the ridge. */
const groove = (s: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * s) / RAKE);

/**
 * The beds' maps over the whole table, `px` pixels a rem. Row 0 is the near edge, as Three
 * reads a DataTexture. The same garden gives the same maps.
 */
export function gardenMaps(g: Garden, tableW: number, tableH: number, px: number, seed = 5): GardenMaps {
  const W = Math.max(1, Math.round(tableW * px));
  const H = Math.max(1, Math.round(tableH * px));
  const albedo = new Uint8ClampedArray(W * H * 4);
  const normal = new Uint8ClampedArray(W * H * 4);
  const height = new Float32Array(W * H);
  const rand = rng(seed);
  const ringsOf = (b: Bed) => [
    { ...b.ripple, r0: 0 },
    // Around the pond, from its rim stones outward.
    { x: g.pond.x, y: g.pond.y, r0: g.pond.r + POND_CLEAR, r: g.pond.r + POND_CLEAR + 9 * RAKE },
  ];
  for (const b of g.beds) {
    const rings = ringsOf(b);
    const [sr, sg, sb] = LOOK[b.season].sand;
    const px0 = Math.max(0, Math.floor((b.x0 + tableW / 2) * px) - 1);
    const px1 = Math.min(W - 1, Math.ceil((b.x1 + tableW / 2) * px) + 1);
    const py0 = Math.max(0, Math.floor(b.y0 * px) - 1);
    const py1 = Math.min(H - 1, Math.ceil(b.y1 * px) + 1);
    for (let j = py0; j <= py1; j++) {
      const y = (j + 0.5) / px;
      for (let i = px0; i <= px1; i++) {
        const x = (i + 0.5) / px - tableW / 2;
        const d = bedDistance(g, b, x, y);
        if (d > 1 / px) continue;
        // Rings where a ring field reaches, lines along the seat's edge elsewhere; smooth by the curb.
        let h = groove(y - b.y0);
        for (const r of rings) {
          const dr = Math.hypot(x - r.x, y - r.y);
          if (dr >= r.r0 && dr < r.r) {
            h = groove(dr - r.r0);
            break;
          }
          if (dr < r.r0) h = 0.5;
        }
        const edge = Math.min(1, Math.max(0, (-d - SMOOTH) / 0.5));
        h = 0.5 + (h - 0.5) * edge;
        const k = j * W + i;
        height[k] = h;
        const shade = 0.76 + 0.3 * h + (rand() - 0.5) * 0.06;
        const o = k * 4;
        albedo[o] = sr * shade;
        albedo[o + 1] = sg * shade;
        albedo[o + 2] = sb * shade;
        // Soft at the edge, a pixel wide; the curb covers it.
        albedo[o + 3] = 255 * Math.min(1, Math.max(0, 0.5 - d * px));
      }
    }
    strew(g, b, albedo, W, H, px, tableW, rand);
  }
  // The normal from the height's slope: the grooves are shallow.
  const depth = 0.9;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const o = k * 4;
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

/**
 * What the season drops on a bed: thick along its curb and thinning toward the middle, which
 * the cards cover. Petals and leaves are small ovals at any angle, moss is clumps, frost is a
 * pale dusting.
 */
function strew(g: Garden, b: Bed, albedo: Uint8ClampedArray, W: number, H: number, px: number, tableW: number, rand: () => number) {
  const look = LOOK[b.season];
  const area = (b.x1 - b.x0) * (b.y1 - b.y0);
  const count = Math.round(area * (b.season === 'winter' ? 0.5 : b.season === 'summer' ? 0.12 : 0.3));
  const size = { spring: [0.32, 0.2], summer: [0.9, 0.7], autumn: [0.45, 0.28], winter: [0.7, 0.6] }[b.season];
  for (let n = 0; n < count; n++) {
    const x = b.x0 + rand() * (b.x1 - b.x0);
    const y = b.y0 + rand() * (b.y1 - b.y0);
    const d = bedDistance(g, b, x, y);
    // Most by the curb: kept with a chance falling off over the first few rem in.
    if (d > -0.3 || rand() > Math.exp(d / 2.6)) continue;
    const [r, gr, bl] = look.strew[Math.floor(rand() * look.strew.length)];
    const a = size[0] * (0.7 + rand() * 0.6);
    const c = size[1] * (0.7 + rand() * 0.6);
    const turn = rand() * Math.PI;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const reach = Math.ceil(a * px) + 1;
    const ci = (x + tableW / 2) * px;
    const cj = y * px;
    const alpha = b.season === 'winter' ? 0.55 : b.season === 'summer' ? 0.8 : 0.95;
    for (let j = Math.max(0, Math.floor(cj - reach)); j <= Math.min(H - 1, cj + reach); j++)
      for (let i = Math.max(0, Math.floor(ci - reach)); i <= Math.min(W - 1, ci + reach); i++) {
        const dx = (i + 0.5 - ci) / px;
        const dy = (j + 0.5 - cj) / px;
        const u = (dx * cos + dy * sin) / a;
        const v = (-dx * sin + dy * cos) / c;
        // Moss and frost are ragged at the edge; petals and leaves are clean ovals.
        const ragged = b.season === 'summer' || b.season === 'winter' ? (rand() - 0.5) * 0.5 : 0;
        const e = u * u + v * v + ragged;
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
