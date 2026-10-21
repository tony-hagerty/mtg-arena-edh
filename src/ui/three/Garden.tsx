import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { AdditiveBlending, BoxGeometry, CanvasTexture, DataTexture, Group, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, RGBAFormat, RepeatWrapping, SRGBColorSpace, UnsignedByteType, Vector2 } from 'three';
import { Bursts, burst } from './effects';
import { MATERIAL, bedMaps } from './garden';
import type { Bed, Garden as Plan } from './garden';
import { rng } from './floor';
import { cardGeometry } from './geometry';
import { backTexture, useCardTexture } from './textures';

/*
  The board on the 3D table (garden.ts plans it): the four mats lying flat on the flagstones,
  the well where the paths cross (the exile), and the bursts a click on any of them makes
  (effects.tsx). Drawn in the table's group, so its z is up off the table, between the floor
  (Table3D's FLOOR_Z) and the cards' soft shadows (SHADOW_Z): `SAND_Z` is the mats.
*/

/** The mats' height, between the floor (-0.12) and the cards' soft shadows (-0.04). */
export const SAND_Z = -0.08;
/** The well's water: a little below the mats, inside its wall. */
export const WATER_Z = -0.1;
/** The well's wall: how high it stands, its thickness, and its stones' length along it, rem. */
const WALL = { h: 1.1, t: 1.5, stone: 2.1 };

/** How many pixels a rem the mats' maps get. */
const MAT_PX = 8;

function dataTexture(data: Uint8ClampedArray, w: number, h: number, srgb: boolean) {
  const t = new DataTexture(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), w, h, RGBAFormat, UnsignedByteType);
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** A card floating in the well: the top of a player's exile. `image` null is a card exiled face down. */
export interface Floating {
  id: string;
  image: string | null;
}

/**
 * The board for `plan`: the mats and the well. `exiled`: the cards circling in the well.
 * `onExile`: a right-click on the well, which opens the exile.
 */
export function Garden({ plan, exiled, onExile }: { plan: Plan; exiled: Floating[]; onExile: () => void }) {
  const root = useRef<Group>(null);
  /** Where on the table an event landed: the board's group is the table's own coordinates. */
  const at = (e: ThreeEvent<MouseEvent>) => root.current!.worldToLocal(e.point.clone());
  return (
    <group ref={root}>
      {plan.beds.map((b) => (
        <Mat key={b.material} plan={plan} bed={b} at={at} />
      ))}
      <Well plan={plan} exiled={exiled} at={at} onExile={onExile} />
      <Bursts />
    </group>
  );
}

/** A mat: one flat plane over its rectangle, clear outside its rounded, well-cut shape. A click on it makes its material's burst. */
function Mat({ plan, bed, at }: { plan: Plan; bed: Bed; at: (e: ThreeEvent<MouseEvent>) => { x: number; y: number } }) {
  const tex = useMemo(() => {
    const m = bedMaps(plan, bed, MAT_PX);
    return { map: dataTexture(m.albedo, m.width, m.height, true), normalMap: dataTexture(m.normal, m.width, m.height, false) };
  }, [plan, bed]);
  useEffect(
    () => () => {
      tex.map.dispose();
      tex.normalMap.dispose();
    },
    [tex],
  );
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const p = at(e);
    burst(bed.material, p.x, p.y, SAND_Z);
  };
  return (
    <mesh receiveShadow position={[(bed.x0 + bed.x1) / 2, (bed.y0 + bed.y1) / 2, SAND_Z]} onClick={click}>
      <planeGeometry args={[bed.x1 - bed.x0, bed.y1 - bed.y0]} />
      <meshStandardMaterial map={tex.map} normalMap={tex.normalMap} normalScale={new Vector2(1, 1)} roughness={MATERIAL[bed.material].roughness} alphaTest={0.5} />
    </mesh>
  );
}

/* ---------- the well ---------- */

/**
 * A whirlpool's arms: soft pale spirals winding into a dark eye, on a clear ground, drawn once.
 * Laid over the water and turned slowly, two of them at different speeds (`Well`).
 */
let swirl: CanvasTexture | null = null;
function swirlTexture() {
  if (swirl) return swirl;
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  const ARMS = 4;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N - 0.5;
      const dy = (y + 0.5) / N - 0.5;
      const r = Math.hypot(dx, dy) * 2;
      const o = (y * N + x) * 4;
      if (r >= 1) continue;
      // A logarithmic spiral: the arms wind tighter toward the eye.
      const a = Math.atan2(dy, dx) + Math.log(r + 0.05) * 2.6;
      const arm = Math.pow(0.5 + 0.5 * Math.cos(a * ARMS), 3);
      // Strongest midway out, fading at the rim and into the eye.
      const fade = Math.sin(Math.min(1, r) * Math.PI) * Math.min(1, r * 3);
      img.data[o] = 190;
      img.data[o + 1] = 215;
      img.data[o + 2] = 255;
      img.data[o + 3] = arm * fade * 150;
    }
  g.putImageData(img, 0, 0);
  swirl = new CanvasTexture(c);
  swirl.colorSpace = SRGBColorSpace;
  return swirl;
}

/** The well's depths: dark water, black at the eye of the whirlpool, drawn once. */
let depths: CanvasTexture | null = null;
function depthsTexture() {
  if (depths) return depths;
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  grad.addColorStop(0, '#020407');
  grad.addColorStop(0.35, '#08141c');
  grad.addColorStop(1, '#173039');
  g.fillStyle = grad;
  g.fillRect(0, 0, N, N);
  depths = new CanvasTexture(c);
  depths.colorSpace = SRGBColorSpace;
  return depths;
}

/** The water's ripples: a normal map of soft swells that tiles, drawn once, turned with the whirlpool. */
let ripples: CanvasTexture | null = null;
function rippleTexture() {
  if (ripples) return ripples;
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  const rand = rng(17);
  // A few waves that tile (whole numbers of them across), summed into a height, then its slope.
  const waves = Array.from({ length: 6 }, () => ({ kx: Math.round(rand() * 6 - 3) || 1, ky: Math.round(rand() * 6 - 3) || 2, a: 0.4 + rand() * 0.6, p: rand() * Math.PI * 2 }));
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let dx = 0;
      let dy = 0;
      for (const w of waves) {
        const t = ((w.kx * x + w.ky * y) / N) * Math.PI * 2 + w.p;
        dx += w.a * w.kx * Math.cos(t) * 0.08;
        dy += w.a * w.ky * Math.cos(t) * 0.08;
      }
      const l = Math.hypot(dx, dy, 1);
      const o = (y * N + x) * 4;
      img.data[o] = (0.5 - dx / l / 2) * 255;
      img.data[o + 1] = (0.5 - dy / l / 2) * 255;
      img.data[o + 2] = (0.5 + 0.5 / l) * 255;
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  ripples = new CanvasTexture(c);
  ripples.wrapS = ripples.wrapT = RepeatWrapping;
  ripples.repeat.set(2, 2);
  ripples.center.set(0.5, 0.5);
  return ripples;
}

/** The wall's stones: one shape, scaled for each, and a few shades of worn stone. */
const STONE = new BoxGeometry(1, 1, 1);
const STONE_LOOKS = ['#8a8274', '#978e7f', '#7b7468', '#a0968a'].map((color) => new MeshStandardMaterial({ color, roughness: 0.95, flatShading: true }));

/**
 * The well, which is the exile: a ring of cobblestones, two courses high and no higher than a
 * hand, round dark water turning slowly into a whirlpool, and the top card of each player's
 * exile circling in it. A click on the water splashes; a right-click opens the exile.
 */
function Well({ plan, exiled, at, onExile }: { plan: Plan; exiled: Floating[]; at: (e: ThreeEvent<MouseEvent>) => { x: number; y: number }; onExile: () => void }) {
  const { x, y, r } = plan.pond;
  const water = useRef(rippleTexture());
  const arms = useRef<Mesh>(null);
  const arms2 = useRef<Mesh>(null);
  const stones = useMemo(() => {
    const rand = rng(23);
    const mid = r + WALL.t / 2;
    const n = Math.round((2 * Math.PI * mid) / WALL.stone);
    const course = WALL.h / 2;
    return [0, 1].flatMap((k) =>
      Array.from({ length: n }, (_, i) => {
        // The upper course sits over the joints of the lower.
        const a = ((i + k * 0.5) / n) * Math.PI * 2;
        const len = ((2 * Math.PI * mid) / n) * (0.88 + rand() * 0.08);
        const hh = course * (0.85 + rand() * 0.2);
        return {
          x: Math.cos(a) * (mid + (rand() - 0.5) * 0.15),
          y: Math.sin(a) * (mid + (rand() - 0.5) * 0.15),
          z: SAND_Z + course * k + hh / 2,
          turn: a + Math.PI / 2 + (rand() - 0.5) * 0.08,
          size: [len, WALL.t * (0.85 + rand() * 0.15), hh] as [number, number, number],
          look: Math.floor(rand() * STONE_LOOKS.length),
        };
      }),
    );
  }, [r]);
  useFrame((_, dt) => {
    // The whirlpool turns: the arms, the faster inner ones, and the water's ripples with them.
    if (arms.current) arms.current.rotation.z -= dt * 0.35;
    if (arms2.current) arms2.current.rotation.z -= dt * 0.6;
    water.current.rotation -= dt * 0.2;
  });
  return (
    <group position={[x, y, 0]}>
      {stones.map((s, i) => (
        <mesh key={i} castShadow receiveShadow geometry={STONE} material={STONE_LOOKS[s.look]} position={[s.x, s.y, s.z]} rotation-z={s.turn} scale={s.size} raycast={() => null} />
      ))}
      <mesh position-z={WATER_Z - 0.01} raycast={() => null}>
        <circleGeometry args={[r + 0.2, 48]} />
        <meshStandardMaterial map={depthsTexture()} roughness={1} />
      </mesh>
      <mesh
        position-z={WATER_Z}
        renderOrder={1}
        onClick={(e) => {
          e.stopPropagation();
          const p = at(e);
          burst('splash', p.x, p.y, WATER_Z);
        }}
        onContextMenu={(e) => {
          e.stopPropagation();
          e.nativeEvent.preventDefault();
          onExile();
        }}
      >
        <circleGeometry args={[r + 0.2, 48]} />
        <meshStandardMaterial color="#2c5560" transparent opacity={0.5} roughness={0.08} metalness={0.3} normalMap={water.current} normalScale={new Vector2(0.5, 0.5)} depthWrite={false} />
      </mesh>
      {/* The arms of the whirlpool, glowing faintly: what is exiled is drawn away. */}
      <mesh ref={arms} position-z={WATER_Z + 0.01} renderOrder={2} raycast={() => null}>
        <circleGeometry args={[r, 48]} />
        <meshBasicMaterial map={swirlTexture()} color="#9cc4ff" transparent opacity={0.55} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={arms2} position-z={WATER_Z + 0.012} renderOrder={2} rotation-z={1} scale={0.55} raycast={() => null}>
        <circleGeometry args={[r, 48]} />
        <meshBasicMaterial map={swirlTexture()} color="#b9a8ff" transparent opacity={0.45} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      {exiled.map((f, i) => (
        <FloatingCard key={f.id} f={f} index={i} count={exiled.length} r={r} />
      ))}
    </group>
  );
}

/** A floating card's size in the well, rem. */
const FLOAT_W = 5.5;

/**
 * The top card of a player's exile, circling slowly in the whirlpool, drifting a little in and
 * out, washed pale blue as the CSS exile pile is. It takes no clicks: a right-click on it is
 * the well's.
 */
function FloatingCard({ f, index, count, r }: { f: Floating; index: number; count: number; r: number }) {
  const face = useCardTexture(f.image);
  const shape = useMemo(() => cardGeometry(FLOAT_W, FLOAT_W * 1.4, 0.08), []);
  useEffect(() => () => shape.dispose(), [shape]);
  const ref = useRef<Group>(null);
  useFrame((state) => {
    const o = ref.current;
    if (!o) return;
    const t = state.clock.elapsedTime;
    const a = (index / count) * Math.PI * 2 - t * 0.18;
    const rr = r * (0.5 + 0.08 * Math.sin(t * 0.4 + index * 2));
    o.position.set(Math.cos(a) * rr, Math.sin(a) * rr, WATER_Z + 0.08 + 0.02 * Math.sin(t * 1.3 + index));
    // Nose along the current, tipped a little toward the eye.
    o.rotation.set(0.05 * Math.cos(a), 0.05 * Math.sin(a), a - Math.PI / 2);
  });
  return (
    <group ref={ref}>
      <mesh geometry={shape} castShadow raycast={() => null}>
        <meshStandardMaterial attach="material-0" color="#cfdcf0" roughness={0.6} />
        {face ? <meshStandardMaterial key="face" attach="material-1" map={face} color="#c4d6f2" roughness={0.4} /> : <meshStandardMaterial key="back" attach="material-1" map={backTexture()} roughness={0.5} />}
        <meshStandardMaterial attach="material-2" map={backTexture()} roughness={0.5} />
      </mesh>
    </group>
  );
}
