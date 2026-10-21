import { useEffect, useState } from 'react';
import { CanvasTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader, UnsignedByteType } from 'three';
import { floorMaps } from './floor';
import type { FloorMaps } from './floor';
import backUrl from '../card-back.svg';

/*
  Textures for the 3D table: card faces from Scryfall (which allows cross-origin use of its
  images, so WebGL may read them), the card back and a card's soft shadow drawn on a canvas,
  and the floor worked out pixel by pixel (floor.ts), so there are no image files, as with
  the CSS table's SVG back.
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

/**
 * The card back: card-back.svg, the CSS `.card-back`'s picture, drawn onto a canvas once it has
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
 * sun's shadow of a card this thin is a sliver; this is the occlusion a card lying flat makes
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

/** How wide the floor's maps are, in pixels: about 21 a rem. A small first version is drawn at once. */
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
 * The floor's textures. The first call works out a small version at once (a tenth of a second)
 * and asks a worker for the full one (a second or two), which replaces it when it lands: the
 * same stones, sharper. The full one is kept for the session, as the other textures here are.
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
    try {
      const worker = new Worker(new URL('./floor.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<FloorMaps>) => {
        upgradeFloor(e.data);
        worker.terminate();
      };
      worker.onerror = () => worker.terminate();
      worker.postMessage({ width: FLOOR_FULL });
    } catch {
      // No workers: the small floor stays.
    }
  }
  return floor;
}
