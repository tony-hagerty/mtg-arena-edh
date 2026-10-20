import { useEffect, useState } from 'react';
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from 'three';

/*
  Textures for the 3D table: card faces from Scryfall (which allows cross-origin use of its
  images, so WebGL may read them), and the card back and the floor drawn on a canvas, so
  there are no image files, as with the CSS table's SVG back.
*/

type Entry = { texture: Texture | null; failed: boolean; waiting: Set<() => void> };
const cache = new Map<string, Entry>();
const loader = new TextureLoader();

/** Starts loading `url` if it isn't yet, and tells `onChange` when it lands or fails. */
function load(url: string, onChange: () => void) {
  let e = cache.get(url);
  if (!e) {
    e = { texture: null, failed: false, waiting: new Set() };
    cache.set(url, e);
    loader.load(
      url,
      (t) => {
        t.colorSpace = SRGBColorSpace;
        t.anisotropy = 4;
        e!.texture = t;
        e!.waiting.forEach((f) => f());
      },
      undefined,
      () => {
        e!.failed = true;
        e!.waiting.forEach((f) => f());
      },
    );
  }
  e.waiting.add(onChange);
  return () => {
    e!.waiting.delete(onChange);
  };
}

/** The texture at `url`, once it has loaded: null before, and for good if it failed (the card is drawn plain). */
export function useCardTexture(url: string | null): Texture | null {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!url) return;
    const rerender = () => bump((n) => n + 1);
    const stop = load(url, rerender);
    // It may have landed between the render and this effect: draw it now.
    const e = cache.get(url);
    if (e?.texture || e?.failed) rerender();
    return stop;
  }, [url]);
  return url ? (cache.get(url)?.texture ?? null) : null;
}

let back: CanvasTexture | null = null;

/** The card back: a dark field in a gold frame with a star, like the CSS `.card-back`. Drawn once. */
export function backTexture(): CanvasTexture {
  if (back) return back;
  const W = 256;
  const H = 358;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const field = g.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, H * 0.7);
  field.addColorStop(0, '#232c3d');
  field.addColorStop(0.6, '#121722');
  field.addColorStop(1, '#080a0f');
  g.fillStyle = field;
  g.fillRect(0, 0, W, H);
  const gold = g.createLinearGradient(0, 0, W, H);
  gold.addColorStop(0, '#f6dd94');
  gold.addColorStop(0.5, '#d2aa42');
  gold.addColorStop(1, '#8a6a2c');
  g.strokeStyle = gold;
  g.lineWidth = 3;
  g.strokeRect(17, 17, W - 34, H - 34);
  g.strokeStyle = 'rgba(210, 170, 66, 0.45)';
  g.lineWidth = 1;
  g.strokeRect(24, 24, W - 48, H - 48);
  for (const r of [85, 110, 134]) {
    g.beginPath();
    g.arc(W / 2, H / 2, r, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(210, 170, 66, 0.07)';
    g.stroke();
  }
  g.beginPath();
  g.arc(W / 2, H / 2, 47, 0, Math.PI * 2);
  g.fillStyle = 'rgba(11, 14, 20, 0.55)';
  g.fill();
  g.strokeStyle = gold;
  g.lineWidth = 2.5;
  g.stroke();
  // The eight-pointed star.
  g.fillStyle = gold;
  g.beginPath();
  const pts = [
    [0, -51],
    [8, -8],
    [51, 0],
    [8, 8],
    [0, 51],
    [-8, 8],
    [-51, 0],
    [-8, -8],
  ];
  pts.forEach(([x, y], i) => (i ? g.lineTo(W / 2 + x, H / 2 + y) : g.moveTo(W / 2 + x, H / 2 + y)));
  g.closePath();
  g.fill();
  back = new CanvasTexture(c);
  back.colorSpace = SRGBColorSpace;
  back.anisotropy = 4;
  return back;
}

let floor: CanvasTexture | null = null;

/** A simple seeded random, so the floor is the same every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * The floor: dark slate flagstones in a darker ground, with grass in a few joints, like the
 * CSS table's `--floor`. One tile of 1024 px, repeated; drawn once.
 */
export function floorTexture(): CanvasTexture {
  if (floor) return floor;
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d')!;
  const rand = rng(7);
  g.fillStyle = '#101319';
  g.fillRect(0, 0, S, S);
  // Stones: irregular polygons around a jittered grid, so they pack like flagstones.
  const cell = 96;
  for (let gy = -1; gy <= S / cell; gy++) {
    for (let gx = -1; gx <= S / cell; gx++) {
      const cx = gx * cell + cell / 2 + (rand() - 0.5) * cell * 0.5;
      const cy = gy * cell + cell / 2 + (rand() - 0.5) * cell * 0.5;
      const r = cell * (0.42 + rand() * 0.12);
      const n = 5 + Math.floor(rand() * 3);
      const shade = 0.75 + rand() * 0.5;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rand() * 0.4;
        const rr = r * (0.8 + rand() * 0.25);
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
      const lit = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      lit.addColorStop(0, `rgb(${Math.round(70 * shade)}, ${Math.round(76 * shade)}, ${Math.round(88 * shade)})`);
      lit.addColorStop(1, `rgb(${Math.round(38 * shade)}, ${Math.round(42 * shade)}, ${Math.round(50 * shade)})`);
      g.fillStyle = lit;
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 3;
      g.stroke();
    }
  }
  // Grass and moss in some joints.
  for (let i = 0; i < 260; i++) {
    const x = rand() * S;
    const y = rand() * S;
    g.fillStyle = `rgba(${40 + rand() * 30}, ${90 + rand() * 50}, ${40 + rand() * 20}, ${0.25 + rand() * 0.35})`;
    g.beginPath();
    g.ellipse(x, y, 2 + rand() * 5, 1 + rand() * 3, rand() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  // Grain.
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.06)';
    g.fillRect(rand() * S, rand() * S, 2, 2);
  }
  floor = new CanvasTexture(c);
  floor.colorSpace = SRGBColorSpace;
  floor.wrapS = floor.wrapT = RepeatWrapping;
  floor.anisotropy = 8;
  return floor;
}
