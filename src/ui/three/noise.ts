/*
  Small seeded noise for the 3D table's procedural textures (garden.ts, floor.ts). Pure maths,
  no DOM, so the floor's worker can use it.
*/

/** A hashed value, 0..1, for the lattice point (`x`, `y`). */
export function hash(x: number, y: number, seed: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
}

const wrap = (i: number, n: number) => (n ? ((i % n) + n) % n : i);

/**
 * Value noise, 0..1, smooth between whole-number lattice points. With a period (`px`, `py`
 * lattice cells), it repeats after that many, so a texture made with it tiles without a seam.
 */
export function valueNoise(x: number, y: number, seed: number, px = 0, py = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = x - xi;
  const ty = y - yi;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const x0 = wrap(xi, px);
  const x1 = wrap(xi + 1, px);
  const y0 = wrap(yi, py);
  const y1 = wrap(yi + 1, py);
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * Three octaves of value noise at `scale` rem a cell, 0..1. With an area (`w` × `h` rem, each
 * a whole number of cells), it repeats over that area.
 */
export function fbm(x: number, y: number, scale: number, seed: number, w = 0, h = 0) {
  const pw = w ? Math.round(w / scale) : 0;
  const ph = h ? Math.round(h / scale) : 0;
  return (
    (valueNoise(x / scale, y / scale, seed, pw, ph) * 4 +
      valueNoise((x * 2) / scale, (y * 2) / scale, seed + 1, pw * 2, ph * 2) * 2 +
      valueNoise((x * 4) / scale, (y * 4) / scale, seed + 2, pw * 4, ph * 4)) /
    7
  );
}
