/*
  The 3D table's floor, worked out pixel by pixel for Table3D.tsx's `Floor` (textures.ts turns
  it into textures). Pure maths, no DOM or Three, so it runs in a worker (floor.worker.ts).

  The art direction is the CSS table's floor (`--floor` in styles.css): dark slate flagstones
  packed like bubbles, from pebbles to the odd boulder, on a darker ground that shows in the
  joints, grass and moss in the joints, a few small blue mushrooms, a fine grain and a slow
  mottle. Here the stones also have a surface for the light to play across: a height field,
  turned into a normal map, and a roughness map.

  - The stones: discs thrown at the floor biggest first, each kept only if it doesn't crowd the
    ones already there (`packStones`), as bubbles pack. Each stone is the ground its disc claims
    against its neighbours (a power diagram: the bigger stone claims more of the space between
    two), cut down to a polygon of five to seven corners so it is a slab rather than a disc.
    How far a point is in from its stone's edge (`inside`) shapes the rest: the joint, the
    bevel the light catches, the shade toward the joint, the moss creeping in from it.
  - Every map is one picture of `AREA` rem that wraps at its edges, laid on the table in rem
    (a stone is the same size wherever it lies), wide enough that the screen never shows it
    twice. Rows run up the floor (row 0 is the near edge), as Three reads a DataTexture.
*/

/** The rem of floor the maps cover, across and up. */
export const AREA = { w: 192, h: 96 } as const;

export interface FloorMaps {
  width: number;
  height: number;
  /** RGBA, sRGB: the colour, grass and mushrooms included. */
  albedo: Uint8ClampedArray;
  /** RGBA: the tangent-space normal, +y up the floor (OpenGL's convention, as Three takes it). */
  normal: Uint8ClampedArray;
  /** RGBA at half the size each way: roughness in every channel (Three reads green). */
  rough: Uint8ClampedArray;
  /** RGBA, sRGB, at a quarter the size each way: the mushrooms' glow, for the emissive map. */
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

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * Value noise summed over octaves on a `w` × `h` grid that wraps (each octave's lattice divides
 * the grid), 0..1. `cell` is the coarsest lattice's cell, in grid steps.
 */
function fbm(w: number, h: number, cell: number, octaves: number, rand: () => number) {
  const out = new Float32Array(w * h);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves && cell >= 1; o++, cell /= 2, amp *= 0.5) {
    const lw = Math.max(1, Math.round(w / cell));
    const lh = Math.max(1, Math.round(h / cell));
    const lat = new Float32Array(lw * lh).map(() => rand());
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * lh;
      const y0 = Math.floor(fy);
      const ty = smooth(fy - y0);
      const r0 = (y0 % lh) * lw;
      const r1 = ((y0 + 1) % lh) * lw;
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * lw;
        const x0 = Math.floor(fx);
        const tx = smooth(fx - x0);
        const c0 = x0 % lw;
        const c1 = (x0 + 1) % lw;
        const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * tx;
        const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * tx;
        out[y * w + x] += (a + (b - a) * ty) * amp;
      }
    }
    total += amp;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** A field at a sixteenth of the size each way, read back at full size along a row, bilinearly, wrapping. */
function rowOf(field: Float32Array, fw: number, fh: number, y: number, H: number, W: number, out: Float32Array) {
  const fy = (y * fh) / H;
  const y0 = Math.floor(fy);
  const ty = fy - y0;
  const r0 = (y0 % fh) * fw;
  const r1 = ((y0 + 1) % fh) * fw;
  for (let x = 0; x < W; x++) {
    const fx = (x * fw) / W;
    const x0 = Math.floor(fx);
    const tx = fx - x0;
    const c0 = x0 % fw;
    const c1 = (x0 + 1) % fw;
    const a = field[r0 + c0] + (field[r0 + c1] - field[r0 + c0]) * tx;
    const b = field[r1 + c0] + (field[r1 + c1] - field[r1 + c0]) * tx;
    out[x] = a + (b - a) * ty;
  }
}

interface Stone {
  x: number;
  y: number;
  /** The disc's radius, px. */
  r: number;
}

/**
 * Bubbles thrown at a `w` × `h` floor that wraps, biggest first: a few boulders, then stones,
 * then pebbles in the gaps. Each is kept only if it stays clear of the others (with a little
 * overlap allowed, which the power diagram settles). `px` is pixels per rem.
 */
function packStones(w: number, h: number, px: number, rand: () => number): Stone[] {
  const stones: Stone[] = [];
  const bin = 8 * px;
  const bw = Math.ceil(w / bin);
  const bh = Math.ceil(h / bin);
  const bins: number[][] = Array.from({ length: bw * bh }, () => []);
  const fits = (x: number, y: number, r: number) => {
    const bx = Math.floor(x / bin);
    const by = Math.floor(y / bin);
    for (let j = -2; j <= 2; j++)
      for (let i = -2; i <= 2; i++) {
        for (const k of bins[((((by + j) % bh) + bh) % bh) * bw + ((((bx + i) % bw) + bw) % bw)]) {
          const s = stones[k];
          let dx = Math.abs(s.x - x);
          let dy = Math.abs(s.y - y);
          if (dx > w / 2) dx = w - dx;
          if (dy > h / 2) dy = h - dy;
          const min = (s.r + r) * 0.9;
          if (dx * dx + dy * dy < min * min) return false;
        }
      }
    return true;
  };
  const throwSome = (tries: number, radius: () => number) => {
    for (let t = 0; t < tries; t++) {
      const x = rand() * w;
      const y = rand() * h;
      const r = radius() * px;
      if (!fits(x, y, r)) continue;
      bins[Math.floor(y / bin) * bw + Math.floor(x / bin)].push(stones.length);
      stones.push({ x, y, r });
    }
  };
  const area = (w * h) / (px * px);
  // Boulders, rare.
  throwSome(Math.round(area / 2000), () => 5.2 + rand() * 2);
  // Stones, mostly middling, some big.
  throwSome(Math.round(area * 1.2), () => 2 + 2.6 * rand() ** 1.8);
  // Pebbles in what is left.
  throwSome(Math.round(area * 0.12), () => 0.8 + rand() * 0.6);
  return stones;
}

const MAX_SIDES = 7;

/** The floor's maps, `width` pixels across (see the note at the top). The same for the same seed at any width. */
export function floorMaps(width: number, seed = 11): FloorMaps {
  const W = width;
  const H = Math.round((width * AREA.h) / AREA.w);
  const P = W / AREA.w;
  const rand = rng(seed);

  // Fields: a fine noise tile that each stone reads at its own offset (so no two stones share a
  // surface), a second for the joints, and slow fields at a sixteenth of the size: the
  // mottle, and where it is damp enough for moss.
  const T = 256;
  const tile = fbm(T, T, 64, 6, rand);
  const tile2 = fbm(T, T, 16, 3, rand);
  // The tiles are read at 21 px a rem whatever the width, so the surface is the same size.
  const tq = 21.3 / P;
  const lw = W >> 4;
  const lh = H >> 4;
  const mottle = fbm(lw, lh, lw / 6, 4, rand);
  const moss = fbm(lw, lh, lw / 14, 4, rand);

  // The stones and their looks.
  const stones = packStones(W, H, P, rand);
  const n = stones.length;
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const r2 = new Float32Array(n);
  const sides = new Uint8Array(n);
  const nx = new Float32Array(n * MAX_SIDES);
  const ny = new Float32Array(n * MAX_SIDES);
  const ap = new Float32Array(n * MAX_SIDES);
  const tone = new Float32Array(n * 3);
  const off = new Int32Array(n * 2);
  const tilt = new Float32Array(n * 2);
  const rough = new Float32Array(n);
  let reachMax = 0;
  stones.forEach((s, i) => {
    sx[i] = s.x;
    sy[i] = s.y;
    r2[i] = s.r * s.r;
    reachMax = Math.max(reachMax, s.r);
    // The slab: a polygon of 5 to 7 corners well past the disc, so the neighbours' claims cut
    // most of it and its own corners only trim where three stones meet.
    // Big stones get fewer corners: a boulder is a slab, not a disc.
    const k = s.r > 4.5 * P ? 5 + Math.floor(rand() * 2) : 5 + Math.floor(rand() * 3);
    sides[i] = k;
    const a0 = rand() * Math.PI * 2;
    const vx: number[] = [];
    const vy: number[] = [];
    for (let j = 0; j < k; j++) {
      const a = a0 + ((j + (rand() - 0.5) * 0.7) / k) * Math.PI * 2;
      const rr = s.r * (1.15 + rand() * 0.55);
      vx.push(Math.cos(a) * rr);
      vy.push(Math.sin(a) * rr);
    }
    for (let j = 0; j < k; j++) {
      const ex = vx[(j + 1) % k] - vx[j];
      const ey = vy[(j + 1) % k] - vy[j];
      const len = Math.hypot(ex, ey) || 1;
      // Counterclockwise corners: the outward normal is the edge turned clockwise.
      const ox = ey / len;
      const oy = -ex / len;
      nx[i * MAX_SIDES + j] = ox;
      ny[i * MAX_SIDES + j] = oy;
      ap[i * MAX_SIDES + j] = vx[j] * ox + vy[j] * oy;
    }
    // Slate: blue-grey, now and then a greyer or greener one, in a narrow range of value.
    const v = 0.88 + rand() * 0.26;
    const hue = rand();
    const [cr, cg, cb] = hue < 0.18 ? [34, 43, 54] : hue < 0.3 ? [40, 43, 56] : [30, 40, 62];
    tone[i * 3] = cr * v;
    tone[i * 3 + 1] = cg * v;
    tone[i * 3 + 2] = cb * v;
    off[i * 2] = Math.floor(rand() * T);
    off[i * 2 + 1] = Math.floor(rand() * T);
    // Each slab sits a little askew, so the light catches each one differently.
    const ta = rand() * Math.PI * 2;
    const tm = (0.015 + rand() * 0.035) * (21.3 / P);
    tilt[i * 2] = Math.cos(ta) * tm;
    tilt[i * 2 + 1] = Math.sin(ta) * tm;
    rough[i] = 0.6 + rand() * 0.25;
  });

  // Which stones can claim a point in each block of the floor: every stone near enough, once
  // per wrapped copy, with the copy's shift (a stone near one edge reaches over the other).
  // Blocks of about 3 rem.
  const B = Math.max(4, Math.round(3 * P));
  const bw = Math.ceil(W / B);
  const bh = Math.ceil(H / B);
  const lists: number[][] = Array.from({ length: bw * bh }, () => []);
  for (let i = 0; i < n; i++) {
    const reach = Math.sqrt(r2[i]) * 1.75 + 1.2 * P;
    const x0 = Math.floor((sx[i] - reach) / B);
    const x1 = Math.floor((sx[i] + reach) / B);
    const y0 = Math.floor((sy[i] - reach) / B);
    const y1 = Math.floor((sy[i] + reach) / B);
    for (let by = y0; by <= y1; by++)
      for (let bx = x0; bx <= x1; bx++) {
        const wx = ((bx % bw) + bw) % bw;
        const wy = ((by % bh) + bh) % bh;
        lists[wy * bw + wx].push(i, -Math.floor(bx / bw) * W, -Math.floor(by / bh) * H);
      }
  }

  const albedo = new Uint8ClampedArray(W * H * 4);
  const height = new Float32Array(W * H);
  const inside = new Float32Array(W * H);
  const rw = W >> 1;
  const rh = H >> 1;
  const roughSum = new Float32Array(rw * rh);
  const bevel = 0.4 * P;
  const shade = 0.6 * P;
  const creep = 0.45 * P;
  const mottleRow = new Float32Array(W);
  const mossRow = new Float32Array(W);
  let hash = (seed * 2654435761) | 0;

  for (let y = 0; y < H; y++) {
    rowOf(mottle, lw, lh, y, H, W, mottleRow);
    rowOf(moss, lw, lh, y, H, W, mossRow);
    const ty = Math.floor(y * tq);
    for (let x = 0; x < W; x++) {
      const list = lists[((y / B) | 0) * bw + ((x / B) | 0)];
      // The two stones claiming this point most (the smallest power distances).
      let b1 = -1;
      let b2 = -1;
      let p1 = Infinity;
      let p2 = Infinity;
      let x1 = 0;
      let y1 = 0;
      let x2 = 0;
      let y2 = 0;
      for (let k = 0; k < list.length; k += 3) {
        const i = list[k];
        const cx = sx[i] + list[k + 1];
        const cy = sy[i] + list[k + 2];
        const dx = x - cx;
        const dy = y - cy;
        const pd = dx * dx + dy * dy - r2[i];
        if (pd < p1) {
          p2 = p1;
          b2 = b1;
          x2 = x1;
          y2 = y1;
          p1 = pd;
          b1 = i;
          x1 = cx;
          y1 = cy;
        } else if (pd < p2) {
          p2 = pd;
          b2 = i;
          x2 = cx;
          y2 = cy;
        }
      }
      const idx = y * W + x;
      hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d) + idx;
      hash = Math.imul(hash ^ (hash >>> 12), 0x297a2d39);
      const grain = ((hash >>> 8) & 0xffff) / 0xffff - 0.5;
      const m = mottleRow[x];
      const mo = mossRow[x];
      const tx = Math.floor(x * tq);
      const t2 = tile2[(ty & (T - 1)) * T + (tx & (T - 1))];
      // The joint's half-width wanders along it.
      const joint = (0.06 + 0.1 * t2) * P;
      let e = -P;
      if (b1 >= 0) {
        // In from the slab's polygon, and from the line its neighbour claims.
        const dx = x - x1;
        const dy = y - y1;
        const base = b1 * MAX_SIDES;
        for (let j = 0; j < sides[b1]; j++) {
          const d = ap[base + j] - (dx * nx[base + j] + dy * ny[base + j]);
          if (j === 0 || d < e) e = d;
        }
        if (b2 >= 0) {
          const bis = (p2 - p1) / (2 * Math.hypot(x2 - x1, y2 - y1));
          if (bis < e) e = bis;
        }
      }
      const inn = e - joint;
      inside[idx] = inn;
      let h: number;
      let r: number;
      let cr: number;
      let cg: number;
      let cb: number;
      if (b1 >= 0 && inn > 0) {
        const s = b1;
        const surf = tile[((ty + off[s * 2 + 1]) & (T - 1)) * T + ((tx + off[s * 2]) & (T - 1))];
        // A finer roughness over it: the same tile read at three times the frequency, elsewhere.
        const fine = tile[((ty * 3 + off[s * 2]) & (T - 1)) * T + ((tx * 3 + off[s * 2 + 1]) & (T - 1))] - 0.5;
        const t = Math.min(1, inn / bevel);
        const lip = 1 - (1 - t) * (1 - t);
        h = 1.8 * lip + (surf - 0.5) * 3.5 + fine * 5 + grain * 0.9 + (x - x1) * tilt[s * 2] + (y - y1) * tilt[s * 2 + 1];
        // Colour: the stone's tone, clouded by its surface, the floor's mottle and the grain, shaded toward its edge.
        const lum = (0.8 + 0.8 * (surf - 0.5) + 0.7 * fine) * (0.82 + 0.36 * m) * (1 + grain * 0.14) * (0.62 + 0.38 * smooth(inn / shade));
        cr = tone[s * 3] * lum;
        cg = tone[s * 3 + 1] * lum;
        cb = tone[s * 3 + 2] * lum;
        // Moss creeping in from the joints where the floor is damp.
        const damp = clamp01((mo - 0.56) * 5) * (1 - smooth(inn / creep)) * clamp01(0.4 + 1.4 * (t2 - 0.35));
        if (damp > 0) {
          const k = Math.min(0.8, damp);
          const f = 0.75 + surf * 0.5;
          cr += (30 * f - cr) * k;
          cg += (46 * f - cg) * k;
          cb += (30 * f - cb) * k;
        }
        r = rough[s] + (surf - 0.5) * 0.25 + damp * 0.2 - lip * 0.04;
      } else {
        // The ground between: dark earth, mossy where it is damp, deeper the farther from a stone.
        const deep = smooth(-inn / (0.6 * P));
        h = -0.6 - 1.2 * deep + (t2 - 0.5) * 1.2 + grain * 0.4;
        const g = (0.7 + 0.6 * t2) * (1 + grain * 0.25) * (0.85 + 0.3 * m);
        const k = clamp01((mo - 0.45) * 3);
        cr = (6 + 7 * k) * g;
        cg = (8 + 20 * k) * g;
        cb = (11 + 3 * k) * g;
        r = 0.97;
      }
      height[idx] = h;
      const o = idx * 4;
      albedo[o] = cr;
      albedo[o + 1] = cg;
      albedo[o + 2] = cb;
      albedo[o + 3] = 255;
      roughSum[(y >> 1) * rw + (x >> 1)] += r * 0.25;
    }
  }

  const gw = W >> 2;
  const gh = H >> 2;
  const glowSum = new Float32Array(gw * gh);
  growGrass(W, H, P, rand, inside, moss, lw, lh, albedo, height);
  sprinkleShrooms(W, H, P, rand, inside, albedo, height, glowSum, gw, gh);

  // The normal map, from the height field's slopes, wrapping.
  const normal = new Uint8ClampedArray(W * H * 4);
  // Slopes are per pixel: per rem, the same at any width.
  const strength = 0.38 * (P / 21.3);
  for (let y = 0; y < H; y++) {
    const below = ((y - 1 + H) % H) * W;
    const above = ((y + 1) % H) * W;
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const dx = (height[row + ((x + 1) % W)] - height[row + ((x - 1 + W) % W)]) * 0.5 * strength;
      const dy = (height[above + x] - height[below + x]) * 0.5 * strength;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const o = (row + x) * 4;
      normal[o] = (-dx / len) * 127.5 + 127.5;
      normal[o + 1] = (-dy / len) * 127.5 + 127.5;
      normal[o + 2] = (1 / len) * 127.5 + 127.5;
      normal[o + 3] = 255;
    }
  }
  const roughOut = new Uint8ClampedArray(rw * rh * 4);
  for (let i = 0; i < rw * rh; i++) {
    const v = roughSum[i] * 255;
    roughOut[i * 4] = roughOut[i * 4 + 1] = roughOut[i * 4 + 2] = v;
    roughOut[i * 4 + 3] = 255;
  }
  const glow = new Uint8ClampedArray(gw * gh * 4);
  for (let i = 0; i < gw * gh; i++) {
    const v = Math.min(1, glowSum[i]);
    // sRGB-ish: the cold blue of the CSS table's mushrooms (#7fc3ff), fading out.
    glow[i * 4] = 127 * Math.sqrt(v) * v;
    glow[i * 4 + 1] = 195 * Math.sqrt(v);
    glow[i * 4 + 2] = 255 * Math.sqrt(v);
    glow[i * 4 + 3] = 255;
  }
  return { width: W, height: H, albedo, normal, rough: roughOut, glow };
}

/** Lays colour `c` over pixel (`x`, `y`) of `albedo` at `a`, wrapping. */
function blend(albedo: Uint8ClampedArray, W: number, H: number, x: number, y: number, c: readonly number[], a: number) {
  const o = ((((y % H) + H) % H) * W + (((x % W) + W) % W)) * 4;
  albedo[o] += (c[0] - albedo[o]) * a;
  albedo[o + 1] += (c[1] - albedo[o + 1]) * a;
  albedo[o + 2] += (c[2] - albedo[o + 2]) * a;
}

/** Tufts of grass in the joints, thicker where it is damp: short bent blades, raised a little in the height field. */
function growGrass(W: number, H: number, P: number, rand: () => number, inside: Float32Array, moss: Float32Array, lw: number, lh: number, albedo: Uint8ClampedArray, height: Float32Array) {
  const greens = [
    [52, 86, 40],
    [64, 100, 46],
    [74, 112, 54],
    [44, 72, 34],
    [84, 120, 62],
  ];
  const tufts = Math.round((W * H) / (P * P * 5));
  for (let t = 0; t < tufts; t++) {
    const x = Math.floor(rand() * W);
    const y = Math.floor(rand() * H);
    if (inside[y * W + x] > 0.04 * P) continue;
    const mo = moss[Math.floor((y * lh) / H) * lw + Math.floor((x * lw) / W)];
    if (mo < 0.5 && rand() > 0.15) continue;
    const count = 2 + Math.floor(rand() * (mo > 0.58 ? 6 : 3));
    for (let b = 0; b < count; b++) {
      const a = rand() * Math.PI * 2;
      const len = (0.22 + rand() * 0.5) * P;
      const bend = (rand() - 0.5) * 1.1;
      const rx = x + (rand() - 0.5) * 0.25 * P;
      const ry = y + (rand() - 0.5) * 0.25 * P;
      const c = greens[Math.floor(rand() * greens.length)];
      const half = (0.025 + rand() * 0.03) * P;
      // A quadratic curve from the root, tapering, stamped as discs.
      const steps = Math.ceil(len);
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const ang = a + bend * u;
        const px = rx + Math.cos(a) * len * u * (1 - u * 0.3) + Math.cos(ang) * len * 0.3 * u * u;
        const py = ry + Math.sin(a) * len * u * (1 - u * 0.3) + Math.sin(ang) * len * 0.3 * u * u;
        const rad = half * (1 - u * 0.7) + 0.35;
        const shade = 0.7 + 0.5 * u;
        const col = [c[0] * shade, c[1] * shade, c[2] * shade];
        for (let oy = Math.floor(py - rad); oy <= Math.ceil(py + rad); oy++)
          for (let ox = Math.floor(px - rad); ox <= Math.ceil(px + rad); ox++) {
            const d = Math.hypot(ox + 0.5 - px, oy + 0.5 - py);
            const cover = clamp01(rad - d + 0.5) * 0.75;
            if (cover <= 0) continue;
            blend(albedo, W, H, ox, oy, col, cover);
            const hi = ((((oy % H) + H) % H) * W) + (((ox % W) + W) % W);
            height[hi] = Math.max(height[hi], 0.5 + 1.2 * u);
          }
      }
    }
  }
}

/** Small blue mushrooms in a few of the deeper joints, by ones and threes, each with a glow around it. */
function sprinkleShrooms(W: number, H: number, P: number, rand: () => number, inside: Float32Array, albedo: Uint8ClampedArray, height: Float32Array, glow: Float32Array, gw: number, gh: number) {
  const clumps = Math.round((W * H) / (P * P * 420));
  let placed = 0;
  for (let t = 0; t < clumps * 40 && placed < clumps; t++) {
    const x = Math.floor(rand() * W);
    const y = Math.floor(rand() * H);
    if (inside[y * W + x] > -0.06 * P) continue;
    placed++;
    const many = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < many; i++) {
      const cx = x + (rand() - 0.5) * 0.45 * P;
      const cy = y + (rand() - 0.5) * 0.45 * P;
      const r = (0.09 + rand() * 0.09) * P;
      for (let oy = Math.floor(cy - r - 1); oy <= Math.ceil(cy + r + 1); oy++)
        for (let ox = Math.floor(cx - r - 1); ox <= Math.ceil(cx + r + 1); ox++) {
          const dx = (ox + 0.5 - cx) / r;
          const dy = (oy + 0.5 - cy) / r;
          const d = Math.hypot(dx, dy);
          const cover = clamp01((1 - d) * r + 0.5);
          if (cover <= 0) continue;
          // The cap, lit from up and to the left, paler at its crown.
          const lit = clamp01(0.75 - 0.35 * dx + 0.35 * dy - 0.3 * d);
          blend(albedo, W, H, ox, oy, [70 + 110 * lit, 130 + 95 * lit, 200 + 55 * lit], cover);
          const hi = ((((oy % H) + H) % H) * W) + (((ox % W) + W) % W);
          height[hi] = Math.max(height[hi], 1.5 * Math.sqrt(Math.max(0, 1 - d * d)));
        }
      // The glow, on the quarter-size map.
      const gx = cx / 4;
      const gy = cy / 4;
      const gr = (0.6 * P) / 4;
      for (let oy = Math.floor(gy - gr); oy <= Math.ceil(gy + gr); oy++)
        for (let ox = Math.floor(gx - gr); ox <= Math.ceil(gx + gr); ox++) {
          const d = Math.hypot(ox + 0.5 - gx, oy + 0.5 - gy) / gr;
          if (d >= 1) continue;
          glow[(((oy % gh) + gh) % gh) * gw + (((ox % gw) + gw) % gw)] += 0.4 * (1 - d) ** 2.4;
        }
    }
  }
}
