import { useEffect, useState } from 'react';
import { CanvasTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader, UnsignedByteType } from 'three';
import { floorHeight, floorMaps, joinFloor } from './floor';
import type { FloorBand, FloorMaps } from './floor';
import type { MapsRequest } from './maps.worker';
import backUrl from '../card-back.svg';
import { CORNER } from './geometry';

/*
  Textures for the 3D table: card faces from Scryfall (which allows cross-origin use of its
  images, so WebGL may read them), the card back and a card's soft shadow drawn on a canvas,
  and the floor worked out pixel by pixel (floor.ts), so there are no image files beyond
  card-back.svg.
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

/** A tile's picture, in pixels: 5:4. */
const TILE_W = 320;
const TILE_H = 256;
const tiles = new Map<string, CanvasTexture>();

/** `a` mixed `k` of the way toward `b`, both `#rrggbb`. */
function mix(a: string, b: string, k: number) {
  const p = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  return `rgb(${[0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * k)).join(',')})`;
}

/** The app's typeface (`--sans` in styles.css), for text drawn on a canvas. */
const typeface = () => getComputedStyle(document.documentElement).getPropertyValue('--sans').trim() || 'sans-serif';

/** The name bar and the frame round the art, drawn over whatever is under them. */
function drawFrame(g: CanvasRenderingContext2D, name: string, frame: string) {
  // A thin band: the art is what you look at.
  const bezel = TILE_W * 0.011;
  const bar = TILE_H * 0.155;
  // The card's corners are rounded (geometry.ts, CORNER of its width; its face is laid on the
  // whole rectangle, so that is CORNER of this picture's width too). The band follows them
  // round, the art inside it rounded to match, so a corner never cuts the band away.
  const round = CORNER * TILE_W;
  const inner = new Path2D();
  inner.roundRect(bezel, bezel, TILE_W - 2 * bezel, TILE_H - 2 * bezel, Math.max(0, round - bezel));
  const band = new Path2D();
  band.rect(0, 0, TILE_W, TILE_H);
  band.addPath(inner);
  g.fillStyle = frame;
  g.fill(band, 'evenodd');
  // The rest is drawn inside the band.
  g.save();
  g.clip(inner);
  // The name bar: the frame's colour darkened, a light top edge, the name in the app's typeface.
  const grad = g.createLinearGradient(0, bezel, 0, bezel + bar);
  grad.addColorStop(0, mix(frame, '#262a33', 0.54));
  grad.addColorStop(1, mix(frame, '#0b0c10', 0.7));
  g.fillStyle = grad;
  g.fillRect(bezel, bezel, TILE_W - 2 * bezel, bar);
  g.fillStyle = 'rgba(255,255,255,0.2)';
  g.fillRect(bezel, bezel, TILE_W - 2 * bezel, 1.5);
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.fillRect(bezel, bezel + bar, TILE_W - 2 * bezel, 2);
  // The name, shrunk to fit the bar.
  const room = TILE_W - 2 * bezel - 20;
  let size = bar * 0.62;
  const font = (px: number) => `600 ${px}px ${typeface()}`;
  g.font = font(size);
  while (size > 10 && g.measureText(name).width > room) g.font = font((size -= 1));
  g.textBaseline = 'middle';
  g.fillStyle = '#000';
  g.fillText(name, bezel + 10, bezel + bar / 2 + 1.5, room);
  g.fillStyle = '#f2ead8';
  g.fillText(name, bezel + 10, bezel + bar / 2, room);
  g.restore();
}

/**
 * A permanent's face on the table, a tile: the card's art crop filling a
 * 5:4 tile inside a band of its frame colour, with its name in a bar along the top. Drawn on
 * a canvas once per card (by name and art), at once with the frame colour where the art will
 * be, and again when the art (Scryfall's art crop, which allows cross-origin use) has loaded.
 * If the art never loads, the frame colour and the name stay.
 */
export function tileTexture(name: string, art: string, frame: string): CanvasTexture {
  const key = `${name}|${art}`;
  const had = tiles.get(key);
  if (had) return had;
  const c = document.createElement('canvas');
  c.width = TILE_W;
  c.height = TILE_H;
  const g = c.getContext('2d')!;
  g.fillStyle = mix(frame, '#0b0c10', 0.55);
  g.fillRect(0, 0, TILE_W, TILE_H);
  drawFrame(g, name, frame);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  tiles.set(key, t);
  if (art) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // The art covers the tile, cropped to fit, centred a little high (faces are).
      const k = Math.max(TILE_W / img.width, TILE_H / img.height);
      const w = img.width * k;
      const h = img.height * k;
      g.drawImage(img, (TILE_W - w) / 2, (TILE_H - h) * 0.35, w, h);
      drawFrame(g, name, frame);
      t.needsUpdate = true;
    };
    img.src = art;
  }
  return t;
}

let back: CanvasTexture | null = null;

/**
 * The card back: card-back.svg (the DOM `.card-back`'s picture too), drawn onto a canvas once it has
 * loaded (the field's dark until then). Drawn once.
 */
export function backTexture(): CanvasTexture {
  if (back) return back;
  const c = document.createElement('canvas');
  c.width = 504;
  c.height = 704;
  const g = c.getContext('2d')!;
  g.fillStyle = '#121722';
  g.fillRect(0, 0, c.width, c.height);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  const img = new Image();
  img.onload = () => {
    g.drawImage(img, 0, 0, c.width, c.height);
    t.needsUpdate = true;
  };
  img.src = backUrl;
  back = t;
  return t;
}

/** How far a card's soft shadow spreads past its edges, as a share of its width. */
export const SHADOW_SPREAD = 0.16;

let shadow: CanvasTexture | null = null;

/**
 * The soft dark under a card where it touches the floor (Table3D.tsx, `Card3D`): black, opaque
 * under the card and fading out over SHADOW_SPREAD past its edges, for a plane that size. The
 * overhead light's shadow of a card this thin is a sliver; this is the occlusion a card lying flat makes
 * all around it, which is what shows it resting on the stone. Drawn once.
 */
export function shadowTexture(): CanvasTexture {
  if (shadow) return shadow;
  // In card widths: the card is 1 × 1.4, its corners rounded by 0.05, and the plane reaches SHADOW_SPREAD past it.
  const S = SHADOW_SPREAD;
  const pw = 1 + 2 * S;
  const ph = 1.4 + 2 * S;
  const W = 128;
  const H = Math.round((W * ph) / pw);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  const r = 0.05;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      // A rounded box's signed distance (negative inside).
      const qx = Math.abs(((x + 0.5) / W - 0.5) * pw) - (0.5 - r);
      const qy = Math.abs(((y + 0.5) / H - 0.5) * ph) - (0.7 - r);
      const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      // Darkest at the edge, falling off quickly and then slowly, as occlusion does.
      const t = Math.min(1, Math.max(0, (d + 0.03) / (S + 0.03)));
      img.data[(y * W + x) * 4 + 3] = Math.round((1 - t) ** 2.4 * 255);
    }
  g.putImageData(img, 0, 0);
  shadow = new CanvasTexture(c);
  shadow.colorSpace = SRGBColorSpace;
  return shadow;
}

/** The floor's textures (floor.ts): colour, normal, roughness and the mushrooms' glow. */
export interface FloorTextures {
  map: DataTexture;
  normalMap: DataTexture;
  roughnessMap: DataTexture;
  emissiveMap: DataTexture;
}

function floorTexture(data: Uint8ClampedArray, w: number, h: number, srgb: boolean) {
  const t = new DataTexture(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), w, h, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function floorTextures(m: FloorMaps): FloorTextures {
  return {
    map: floorTexture(m.albedo, m.width, m.height, true),
    normalMap: floorTexture(m.normal, m.width, m.height, false),
    roughnessMap: floorTexture(m.rough, m.width >> 1, m.height >> 1, false),
    emissiveMap: floorTexture(m.glow, m.width >> 2, m.height >> 2, true),
  };
}

/** How wide the floor's maps are, in pixels: about 21 a rem, a 4K screen's pixel a rem near you. A small first version is drawn at once. */
const FLOOR_FULL = 4096;
const FLOOR_FIRST = 512;

let floor: FloorTextures | null = null;
const floorWaiting = new Set<() => void>();

/** Swaps in the full-size floor once the worker has it, and tells whoever is drawing it. */
function upgradeFloor(m: FloorMaps) {
  const old = floor;
  floor = floorTextures(m);
  floorWaiting.forEach((f) => f());
  // Once the floor has been drawn with the new ones.
  if (old) setTimeout(() => Object.values(old).forEach((t: Texture) => t.dispose()), 1000);
}

/**
 * Asks workers (maps.worker.ts) for `requests`, as many at once as the machine has cores to
 * spare, and resolves with their answers in order; null where workers can't run.
 */
export function inWorkers<T>(requests: MapsRequest[]): Promise<T[] | null> {
  return new Promise((resolve) => {
    const out: T[] = new Array(requests.length);
    let next = 0;
    let done = 0;
    const lanes = Math.max(1, Math.min(requests.length, (navigator.hardwareConcurrency || 4) - 1, 6));
    const run = (w: Worker) => {
      const i = next++;
      if (i >= requests.length) return w.terminate();
      w.onmessage = (e: MessageEvent<T>) => {
        out[i] = e.data;
        if (++done === requests.length) resolve(out);
        run(w);
      };
      w.postMessage(requests[i]);
    };
    try {
      for (let k = 0; k < lanes; k++) {
        const w = new Worker(new URL('./maps.worker.ts', import.meta.url), { type: 'module' });
        w.onerror = () => {
          w.terminate();
          resolve(null);
        };
        run(w);
      }
    } catch {
      resolve(null);
    }
  });
}

/** How many bands the full floor is worked out in, by as many workers as can run at once. */
const FLOOR_BANDS = 8;

/**
 * The floor's textures. The first call works out a small version at once (a tenth of a second)
 * and asks workers for the full one in bands (a few seconds), which replaces it when it lands:
 * the same stones, sharper. The full one is kept for the session, as the other textures here are.
 */
export function useFloorTextures(): FloorTextures {
  const [, bump] = useState(0);
  useEffect(() => {
    const rerender = () => bump((n) => n + 1);
    floorWaiting.add(rerender);
    return () => {
      floorWaiting.delete(rerender);
    };
  }, []);
  if (!floor) {
    floor = floorTextures(floorMaps(FLOOR_FIRST));
    const H = floorHeight(FLOOR_FULL);
    const bands = Array.from({ length: FLOOR_BANDS }, (_, k): MapsRequest => ({ kind: 'floor', width: FLOOR_FULL, j0: Math.round((k * H) / FLOOR_BANDS), j1: Math.round(((k + 1) * H) / FLOOR_BANDS) }));
    // No workers: the small floor stays.
    void inWorkers<FloorBand>(bands).then((done) => done && upgradeFloor(joinFloor(FLOOR_FULL, done)));
  }
  return floor;
}
