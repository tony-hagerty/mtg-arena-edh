import { BufferGeometry, Float32BufferAttribute, Shape, ShapeGeometry } from 'three';

/*
  Shapes for the 3D table's cards (Table3D.tsx). A real card's corners are rounded (about 3 mm
  on a 63 mm card), so a box won't do: its corners show square, the face's corners and all.
*/

/** How round a card's corners are, as a share of its width (3 mm of 63). */
export const CORNER = 0.048;

/** The outline of a `w` × `h` rectangle about the origin with corners of radius `r`, counterclockwise, `seg` points to a corner. */
export function roundedOutline(w: number, h: number, r: number, seg = 6): [number, number][] {
  const pts: [number, number][] = [];
  const corners: [number, number, number][] = [
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, Math.PI / 2],
    [-w / 2 + r, -h / 2 + r, Math.PI],
    [w / 2 - r, -h / 2 + r, (3 * Math.PI) / 2],
  ];
  for (const [cx, cy, a0] of corners)
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  return pts;
}

/**
 * A card: `w` × `h` with rounded corners, `t` thick, centred on the origin, its face up (+z).
 * Three material groups: 0 the edge, 1 the face (the card's image, laid on the whole rectangle
 * so the corners cut it as a card's are cut), 2 the back underneath (mirrored, as a card turned
 * over is).
 */
export function cardGeometry(w: number, h: number, t: number): BufferGeometry {
  const outline = roundedOutline(w, h, CORNER * w);
  const n = outline.length;
  const pos: number[] = [];
  const norm: number[] = [];
  const uv: number[] = [];
  const geo = new BufferGeometry();
  // The edge: a strip of quads around the outline, facing out.
  for (let i = 0; i < n; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % n];
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = (y1 - y0) / len;
    const ny = -(x1 - x0) / len;
    const quad = [
      [x0, y0, -t / 2],
      [x1, y1, -t / 2],
      [x1, y1, t / 2],
      [x0, y0, -t / 2],
      [x1, y1, t / 2],
      [x0, y0, t / 2],
    ];
    for (const p of quad) {
      pos.push(...p);
      norm.push(nx, ny, 0);
      uv.push(0, 0);
    }
  }
  geo.addGroup(0, n * 6, 0);
  // The face and the back: fans from the middle (the outline is convex).
  const cap = (z: number, up: boolean) => {
    for (let i = 0; i < n; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % n];
      const tri = up ? [[0, 0], a, b] : [[0, 0], b, a];
      for (const [x, y] of tri) {
        pos.push(x, y, z);
        norm.push(0, 0, up ? 1 : -1);
        uv.push(up ? x / w + 0.5 : 0.5 - x / w, y / h + 0.5);
      }
    }
  };
  cap(t / 2, true);
  geo.addGroup(n * 6, n * 3, 1);
  cap(-t / 2, false);
  geo.addGroup(n * 9, n * 3, 2);
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(norm, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** A flat rounded rectangle about the origin, for a card's glow. */
export function roundedPlane(w: number, h: number, r: number): ShapeGeometry {
  const s = new Shape();
  roundedOutline(w, h, r).forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return new ShapeGeometry(s);
}
