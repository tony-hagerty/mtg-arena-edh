import { fbm, valueNoise } from './noise';

/*
  The 3D table's floor, worked out pixel by pixel for Table3D.tsx's `Floor` (textures.ts turns
  it into textures). Pure maths, no DOM or Three, so it runs in workers, in bands (maps.worker.ts).

  A dungeon hall's paving: rectangular flagstones laid in rows of different depths, each stone
  its own length and its own shade of worn grey-brown, now and then a pair of small ones in a
  big one's place. The joints between are packed with sandy dirt. Each stone has a surface
  for the light to play across: chipped, bevelled edges, a slight tilt and a rough face, in a
  height field turned into a normal map, and a roughness map with damper, smoother patches.

  Every map is one picture of `AREA` rem that wraps at its edges (the rows and the stones in
  each fill it exactly, and the noise repeats over it), laid on the table in rem, wide enough
  that the screen never shows it twice. Rows of pixels run up the floor (row 0 is the near
  edge), as Three reads a DataTexture.
*/

/** The rem of floor the maps cover, across and up. */
export const AREA = { w: 192, h: 96 } as const;

export interface FloorMaps {
  width: number;
  height: number;
  /** RGBA, sRGB: the colour. */
  albedo: Uint8ClampedArray;
  /** RGBA: the tangent-space normal, +y up the floor (OpenGL's convention, as Three takes it). */
  normal: Uint8ClampedArray;
  /** RGBA at half the size each way: roughness in every channel (Three reads green). */
  rough: Uint8ClampedArray;
  /** RGBA, sRGB, at a quarter the size each way: what glows (nothing, now: the torches light the hall). */
  glow: Uint8ClampedArray;
}

/** A small seeded random (mulberry32), so the floor is the same every time. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

interface Stone {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Its colour, its tilt (the slope of its face across and up) and how rough it is. */
  r: number;
  g: number;
  b: number;
  tx: number;
  ty: number;
  rough: number;
  /** Half its joint, rem: some stones sit tighter than others. */
  joint: number;
}

/** Lengths that add up to exactly `total`: drawn from `pick` until they reach it, then all scaled to fit. */
function fill(total: number, pick: () => number) {
  const out: number[] = [];
  let sum = 0;
  while (sum < total) {
    const v = pick();
    out.push(v);
    sum += v;
  }
  return out.map((v) => (v * total) / sum);
}

/** Worn stone: greys and grey-browns, a few with a green or ochre cast. */
const TONES: [number, number, number][] = [
  [78, 73, 64],
  [70, 68, 64],
  [66, 62, 52],
  [84, 77, 64],
  [62, 64, 62],
  [74, 66, 54],
];

/** The paving's stones, in rem over the AREA: rows up the floor, stones along each. */
function layStones(rand: () => number): Stone[] {
  const stones: Stone[] = [];
  const make = (x0: number, x1: number, y0: number, y1: number): Stone => {
    const [r, g, b] = TONES[Math.floor(rand() * TONES.length)];
    const v = 0.78 + rand() * 0.36;
    const a = rand() * Math.PI * 2;
    const m = 0.02 + rand() * 0.05;
    return { x0, x1, y0, y1, r: r * v, g: g * v, b: b * v, tx: Math.cos(a) * m, ty: Math.sin(a) * m, rough: 0.55 + rand() * 0.35, joint: 0.16 + rand() * 0.14 };
  };
  let y = 0;
  for (const depth of fill(AREA.h, () => [3.4, 4.4, 5.6, 6.8][Math.floor(rand() * 4)])) {
    let x = 0;
    for (const len of fill(AREA.w, () => 3 + rand() * 6.5)) {
      // Now and then two small stones, one above the other, in a long one's place.
      if (len < 6 && depth > 4.5 && rand() < 0.25) {
        const split = y + depth * (0.4 + rand() * 0.2);
        stones.push(make(x, x + len, y, split), make(x, x + len, split, y + depth));
      } else stones.push(make(x, x + len, y, y + depth));
      x += len;
    }
    y += depth;
  }
  return stones;
}

/** The floor's picture's height in pixels, for `width` across. */
export const floorHeight = (width: number) => Math.round((width * AREA.h) / AREA.w);

/** Rows `j0` up to `j1` of the floor's maps (`floorMaps`): their colour, height and roughness, before the normal is worked out from the height. */
export interface FloorBand {
  j0: number;
  j1: number;
  albedo: Uint8ClampedArray;
  height: Float32Array;
  rough: Float32Array;
}

/**
 * Rows `j0` up to `j1` of the floor's maps, `width` pixels across: the slow part, so a floor
 * can be worked out in bands, side by side (Table3D's floor asks several workers, textures.ts),
 * and put together with `joinFloor`.
 */
export function floorBand(width: number, j0: number, j1: number, seed = 11): FloorBand {
  const W = width;
  const P = W / AREA.w;
  const stones = layStones(rng(seed));
  const rows = j1 - j0;
  const albedo = new Uint8ClampedArray(W * rows * 4);
  const height = new Float32Array(W * rows);
  const roughAt = new Float32Array(W * rows);
  const { w: AW, h: AH } = AREA;
  // Which stone covers each pixel: the stones are sorted by row, so each pixel row looks only
  // at the ones whose rows it crosses, and finds its stone along x by a pointer that only moves on.
  for (let j = j0; j < j1; j++) {
    const y = (j + 0.5) / P;
    const row = stones.filter((st) => st.y0 <= y && y < st.y1).sort((a, b) => a.x0 - b.x0);
    let k = 0;
    for (let i = 0; i < W; i++) {
      const x = (i + 0.5) / P;
      while (k < row.length - 1 && x >= row[k].x1) k++;
      const st = row[k];
      // How far in from the stone's edge, with its edges chipped and wandering a little.
      const chip = (valueNoise(x * 2.5, y * 2.5, seed + 1, AW * 2.5, AH * 2.5) - 0.5) * 0.3 + (valueNoise(x * 0.6, y * 0.6, seed + 2, AW * 0.6, AH * 0.6) - 0.5) * 0.25;
      const e = Math.min(x - st.x0, st.x1 - x, y - st.y0, st.y1 - y) - st.joint + chip;
      const face = fbm(x, y, 3, seed + 3, AW, AH);
      const fine = valueNoise(x * 6, y * 6, seed + 4, AW * 6, AH * 6);
      // The grain: the stone's own texture, a few pixels across, sharp at the size it is seen.
      const grit = valueNoise(x * 16, y * 16, seed + 7, AW * 16, AH * 16);
      const at = (j - j0) * W + i;
      const o = at * 4;
      if (e <= 0) {
        // The joint: sandy dirt, lower than the stones, lumpy and gritty.
        const dirt = fbm(x, y, 1, seed + 5, AW, AH);
        height[at] = -0.1 + dirt * 0.12 + e * 0.05 + (grit - 0.5) * 0.05;
        const v = (0.7 + dirt * 0.5) * (0.85 + grit * 0.3);
        albedo[o] = 92 * v;
        albedo[o + 1] = 70 * v;
        albedo[o + 2] = 46 * v;
        roughAt[at] = 1;
      } else {
        // The stone: a rounded bevel into the joint, a tilt, a rough face pitted here and there.
        const bevel = Math.min(1, e / 0.3);
        const lift = Math.sqrt(bevel);
        const cx = (st.x0 + st.x1) / 2;
        const cy = (st.y0 + st.y1) / 2;
        const pit = Math.max(0, valueNoise(x * 9, y * 9, seed + 8, AW * 9, AH * 9) - 0.78) * 4.5;
        height[at] = lift * (0.5 + (x - cx) * st.tx + (y - cy) * st.ty + (face - 0.5) * 0.35 + (fine - 0.5) * 0.06 + (grit - 0.5) * 0.035 - pit * 0.06);
        // Stains and wear across its face; its worn edges a shade lighter; flecks and pits in it.
        const stain = fbm(x, y, 7, seed + 6, AW, AH);
        const v = (0.82 + face * 0.25 + (fine - 0.5) * 0.08 + (grit - 0.5) * 0.16) * (0.85 + stain * 0.3) * (1 + (1 - bevel) * 0.12) * (1 - pit * 0.35);
        albedo[o] = st.r * v;
        albedo[o + 1] = st.g * v;
        albedo[o + 2] = st.b * v;
        // Damp patches are smoother: the light glints off them.
        roughAt[at] = st.rough - Math.max(0, stain - 0.55) * 0.8;
      }
      albedo[o + 3] = 255;
    }
  }
  return { j0, j1, albedo, height, rough: roughAt };
}

/** The floor's maps from its bands (`floorBand`), which cover every row between them: the normal from the height, the roughness at half the size. */
export function joinFloor(width: number, bands: FloorBand[]): FloorMaps {
  const W = width;
  const H = floorHeight(width);
  const P = W / AREA.w;
  const albedo = new Uint8ClampedArray(W * H * 4);
  const height = new Float32Array(W * H);
  const roughAt = new Float32Array(W * H);
  for (const b of bands) {
    albedo.set(b.albedo, b.j0 * W * 4);
    height.set(b.height, b.j0 * W);
    roughAt.set(b.rough, b.j0 * W);
  }

  // The normal from the height's slope, wrapping at the edges as the picture does.
  const normal = new Uint8ClampedArray(W * H * 4);
  // Per pixel the slope shrinks as the pixels do, so the strength grows with them: the same at any width.
  const depth = 1.6 * (P / 21.3);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const hx = (height[j * W + ((i + 1) % W)] - height[j * W + ((i - 1 + W) % W)]) * depth;
      const hy = (height[((j + 1) % H) * W + i] - height[((j - 1 + H) % H) * W + i]) * depth;
      const l = Math.hypot(hx, hy, 1);
      const o = (j * W + i) * 4;
      normal[o] = (0.5 - hx / l / 2) * 255;
      normal[o + 1] = (0.5 - hy / l / 2) * 255;
      normal[o + 2] = (0.5 + 0.5 / l) * 255;
      normal[o + 3] = 255;
    }

  // Roughness at half the size, each pixel the mean of the four under it.
  const rw = W >> 1;
  const rh = H >> 1;
  const rough = new Uint8ClampedArray(rw * rh * 4);
  for (let j = 0; j < rh; j++)
    for (let i = 0; i < rw; i++) {
      const a = (2 * j * W + 2 * i) | 0;
      const v = ((roughAt[a] + roughAt[a + 1] + roughAt[a + W] + roughAt[a + W + 1]) / 4) * 255;
      const o = (j * rw + i) * 4;
      rough[o] = rough[o + 1] = rough[o + 2] = v;
      rough[o + 3] = 255;
    }

  const glow = new Uint8ClampedArray((W >> 2) * (H >> 2) * 4);
  for (let i = 3; i < glow.length; i += 4) glow[i] = 255;
  return { width: W, height: H, albedo, normal, rough, glow };
}

/** The floor's maps, `width` pixels across (see the note at the top), worked out in one go. The same for the same seed at any width. */
export function floorMaps(width: number, seed = 11): FloorMaps {
  return joinFloor(width, [floorBand(width, 0, floorHeight(width), seed)]);
}
