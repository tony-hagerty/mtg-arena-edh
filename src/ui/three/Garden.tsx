import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { AdditiveBlending, BoxGeometry, CanvasTexture, DataTexture, EquirectangularReflectionMapping, Group, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, RGBAFormat, RepeatWrapping, SRGBColorSpace, UnsignedByteType, Vector2 } from 'three';
import { Bursts, burst } from './effects';
import { MATERIAL, bedDistance, bedMaps } from './board';
import type { Bed, BedMaps, Garden as Plan } from './board';
import { rng } from './floor';
import { valueNoise } from './noise';
import { cardGeometry } from './geometry';
import { backTexture, inWorkers, useCardTexture } from './textures';

/*
  The board on the 3D table (board.ts plans it): the four mats lying flat on the flagstones,
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

/**
 * How many pixels a rem the mats' maps get: as many as a 4K screen gives a rem near you, so a
 * mat is as sharp as the screen, worked out off the main thread (maps.worker.ts). A rough
 * version, MAT_FIRST, is drawn at once in the meantime.
 */
const MAT_PX = 20;
const MAT_FIRST = 4;

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

interface MatTextures {
  map: DataTexture;
  normalMap: DataTexture;
}
const matTextures = (m: BedMaps): MatTextures => ({ map: dataTexture(m.albedo, m.width, m.height, true), normalMap: dataTexture(m.normal, m.width, m.height, false) });

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

/** A mat: one flat plane over its rectangle, clear outside its rounded, well-cut shape. A click on it makes its material's burst; one on its clear part goes through. */
function Mat({ plan, bed, at }: { plan: Plan; bed: Bed; at: (e: ThreeEvent<MouseEvent>) => { x: number; y: number } }) {
  const rough = useMemo(() => matTextures(bedMaps(plan, bed, MAT_FIRST)), [plan, bed]);
  const [sharp, setSharp] = useState<{ for: Bed; tex: MatTextures } | null>(null);
  useEffect(() => {
    let live = true;
    void inWorkers<BedMaps>([{ kind: 'mat', plan, bed, px: MAT_PX }]).then((done) => {
      if (live && done) setSharp({ for: bed, tex: matTextures(done[0]) });
    });
    return () => {
      live = false;
    };
  }, [plan, bed]);
  const tex = sharp?.for === bed ? sharp.tex : rough;
  useEffect(
    () => () => {
      tex.map.dispose();
      tex.normalMap.dispose();
    },
    [tex],
  );
  const click = (e: ThreeEvent<MouseEvent>) => {
    const p = at(e);
    // The plane is the mat's whole rectangle, its rounded corners and the round cut for the
    // well only see-through: a click there is the well's or the floor's, under it, so it goes on.
    if (bedDistance(plan, bed, p.x, p.y) > 0) return;
    e.stopPropagation();
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
 * A whirlpool's current: thin streaks of pale foam winding in toward the middle, on a clear
 * ground, drawn once. Laid over the water and turned slowly, two of them at different speeds
 * (`Well`), so the water is seen to turn without the middle looking like a hole.
 */
let swirl: CanvasTexture | null = null;
function swirlTexture() {
  if (swirl) return swirl;
  // Sharp on a 4K screen: the well is some 500 pixels across there. Its noise is laid in 256ths.
  const N = 1024;
  const k = N / 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  const ARMS = 5;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N - 0.5;
      const dy = (y + 0.5) / N - 0.5;
      const r = Math.hypot(dx, dy) * 2;
      const o = (y * N + x) * 4;
      if (r >= 1) continue;
      // A logarithmic spiral, broken up by noise so the streaks come and go like foam.
      const a = Math.atan2(dy, dx) + Math.log(r + 0.08) * 2.2;
      const arm = Math.pow(0.5 + 0.5 * Math.cos(a * ARMS), 7);
      const breakup = valueNoise(x / (9 * k), y / (9 * k), 31, N / (9 * k), N / (9 * k));
      // Strongest midway out, gone at the rim and fading out before the middle.
      const fade = Math.sin(Math.min(1, r) * Math.PI) * Math.min(1, r * 2.5);
      img.data[o] = 230;
      img.data[o + 1] = 244;
      img.data[o + 2] = 240;
      img.data[o + 3] = arm * fade * Math.max(0, breakup * 1.6 - 0.3) * 255;
    }
  g.putImageData(img, 0, 0);
  swirl = new CanvasTexture(c);
  swirl.colorSpace = SRGBColorSpace;
  return swirl;
}

/** The well's water seen into: deep green-blue, a shade darker toward the middle where it is deepest, drawn once. */
let depths: CanvasTexture | null = null;
function depthsTexture() {
  if (depths) return depths;
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  grad.addColorStop(0, '#0e2f36');
  grad.addColorStop(0.5, '#164650');
  grad.addColorStop(0.85, '#1f5b61');
  // Darker again just under the wall, in its shade.
  grad.addColorStop(1, '#14383c');
  g.fillStyle = grad;
  g.fillRect(0, 0, N, N);
  depths = new CanvasTexture(c);
  depths.colorSpace = SRGBColorSpace;
  return depths;
}

/** Light through the ripples on the well's floor: a net of soft bright lines that tiles, drawn once, drifting under the water. */
let caustic: CanvasTexture | null = null;
function causticTexture() {
  if (caustic) return caustic;
  const N = 512;
  const k = N / 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      // Where two noises cross their middles: thin wandering lines, a net where they meet.
      const a = valueNoise(x / (22 * k), y / (22 * k), 41, N / (22 * k), N / (22 * k));
      const b = valueNoise(x / (15 * k), y / (15 * k), 42, N / (15 * k), N / (15 * k));
      const line = Math.max(1 - Math.abs(a - 0.5) * 9, 0) + Math.max(1 - Math.abs(b - 0.5) * 9, 0);
      const o = (y * N + x) * 4;
      img.data[o] = 170;
      img.data[o + 1] = 230;
      img.data[o + 2] = 220;
      img.data[o + 3] = Math.min(1, line * 0.8) * 255;
    }
  g.putImageData(img, 0, 0);
  caustic = new CanvasTexture(c);
  caustic.colorSpace = SRGBColorSpace;
  caustic.wrapS = caustic.wrapT = RepeatWrapping;
  caustic.repeat.set(3, 3);
  return caustic;
}

/**
 * What the water reflects: the hall above it, dark vaulting with the warm glow of the torches
 * low on either side, as an equirectangular picture, drawn once. Only the water uses it.
 */
let hallSky: CanvasTexture | null = null;
function reflectionTexture() {
  if (hallSky) return hallSky;
  const W = 256;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#05070a');
  sky.addColorStop(0.45, '#1a2028');
  sky.addColorStop(0.55, '#2a2620');
  sky.addColorStop(1, '#0a0806');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  // The torches: warm glows around the horizon, at the hall's sides.
  for (const u of [0.12, 0.38, 0.62, 0.88]) {
    const glow = g.createRadialGradient(u * W, H * 0.44, 0, u * W, H * 0.44, H * 0.22);
    glow.addColorStop(0, 'rgba(255,190,110,0.95)');
    glow.addColorStop(0.3, 'rgba(255,140,60,0.4)');
    glow.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
  }
  hallSky = new CanvasTexture(c);
  hallSky.colorSpace = SRGBColorSpace;
  hallSky.mapping = EquirectangularReflectionMapping;
  return hallSky;
}

/** The water's ripples: a normal map of soft swells that tiles, drawn once per `seed`. Two of them drift across each other (`Well`). */
const ripples = new Map<number, CanvasTexture>();
function rippleTexture(seed: number) {
  const cached = ripples.get(seed);
  if (cached) return cached;
  // Its waves are whole numbers of them across, and their slopes worked out from the picture's width, so it is the same at any size.
  const N = 512;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  const rand = rng(seed);
  // A few waves that tile (whole numbers of them across), summed into a height, then its slope.
  const waves = Array.from({ length: 7 }, () => ({ kx: Math.round(rand() * 8 - 4) || 1, ky: Math.round(rand() * 8 - 4) || 2, a: 0.4 + rand() * 0.6, p: rand() * Math.PI * 2 }));
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let dx = 0;
      let dy = 0;
      for (const w of waves) {
        const t = ((w.kx * x + w.ky * y) / N) * Math.PI * 2 + w.p;
        dx += w.a * w.kx * Math.cos(t) * 0.07;
        dy += w.a * w.ky * Math.cos(t) * 0.07;
      }
      const l = Math.hypot(dx, dy, 1);
      const o = (y * N + x) * 4;
      img.data[o] = (0.5 - dx / l / 2) * 255;
      img.data[o + 1] = (0.5 - dy / l / 2) * 255;
      img.data[o + 2] = (0.5 + 0.5 / l) * 255;
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(2, 2);
  t.center.set(0.5, 0.5);
  ripples.set(seed, t);
  return t;
}

/** A pale rim of foam where the water laps at the wall: brightest at the edge, broken up, gone a little way in. Drawn once. */
let foam: CanvasTexture | null = null;
function foamTexture() {
  if (foam) return foam;
  const N = 1024;
  const k = N / 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N - 0.5;
      const dy = (y + 0.5) / N - 0.5;
      const r = Math.hypot(dx, dy) * 2;
      const o = (y * N + x) * 4;
      if (r >= 1) continue;
      const edge = Math.max(0, 1 - (1 - r) / 0.09);
      const bits = valueNoise(x / (5 * k), y / (5 * k), 51, N / (5 * k), N / (5 * k));
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 235;
      img.data[o + 3] = edge * edge * Math.max(0, bits * 1.5 - 0.35) * 255;
    }
  g.putImageData(img, 0, 0);
  foam = new CanvasTexture(c);
  foam.colorSpace = SRGBColorSpace;
  return foam;
}

/** The wall's stones: one shape, scaled for each, and a few shades of worn stone. */
const STONE = new BoxGeometry(1, 1, 1);
const STONE_LOOKS = ['#8a8274', '#978e7f', '#7b7468', '#a0968a'].map((color) => new MeshStandardMaterial({ color, roughness: 0.95, flatShading: true }));

/**
 * The well, which is the exile: a ring of cobblestones, two courses high and no higher than a
 * hand, round deep green-blue water turning slowly in a whirlpool, and the top card of each
 * player's exile circling in it. The water is layered: its depths with the light from the
 * ripples drifting over them, then the surface, glossy, rippled two ways at once and mirroring
 * the hall's torches, then streaks of foam in the current and a rim of it at the wall. A click
 * on the water splashes; a right-click opens the exile.
 */
function Well({ plan, exiled, at, onExile }: { plan: Plan; exiled: Floating[]; at: (e: ThreeEvent<MouseEvent>) => { x: number; y: number }; onExile: () => void }) {
  const { x, y, r } = plan.pond;
  const swell = useRef(rippleTexture(17));
  const chop = useMemo(() => {
    const t = rippleTexture(29).clone();
    t.repeat.set(3.5, 3.5);
    t.needsUpdate = true;
    return t;
  }, []);
  useEffect(() => () => chop.dispose(), [chop]);
  const light = useRef(causticTexture());
  const arms = useRef<Mesh>(null);
  const arms2 = useRef<Mesh>(null);
  const rim = useRef<Mesh>(null);
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
    // The whirlpool turns: the foam, its faster inner streaks, the rim's, and the swell with them; the chop drifts across it.
    if (arms.current) arms.current.rotation.z -= dt * 0.22;
    if (arms2.current) arms2.current.rotation.z -= dt * 0.4;
    if (rim.current) rim.current.rotation.z -= dt * 0.1;
    swell.current.rotation -= dt * 0.12;
    chop.offset.x += dt * 0.021;
    chop.offset.y -= dt * 0.013;
    light.current.offset.x -= dt * 0.012;
    light.current.offset.y += dt * 0.008;
  });
  return (
    <group position={[x, y, 0]}>
      {stones.map((s, i) => (
        <mesh key={i} castShadow receiveShadow geometry={STONE} material={STONE_LOOKS[s.look]} position={[s.x, s.y, s.z]} rotation-z={s.turn} scale={s.size} raycast={() => null} />
      ))}
      <mesh position-z={WATER_Z - 0.02} raycast={() => null}>
        <circleGeometry args={[r + 0.2, 48]} />
        <meshStandardMaterial map={depthsTexture()} roughness={1} emissive="#0b2a2e" emissiveIntensity={0.6} />
      </mesh>
      <mesh position-z={WATER_Z - 0.015} renderOrder={1} raycast={() => null}>
        <circleGeometry args={[r * 0.97, 48]} />
        <meshBasicMaterial map={light.current} color="#7fd4c8" transparent opacity={0.16} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh
        position-z={WATER_Z}
        renderOrder={2}
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
        <meshStandardMaterial
          color="#3b7f86"
          transparent
          opacity={0.55}
          roughness={0.06}
          metalness={0.1}
          normalMap={swell.current}
          normalScale={new Vector2(0.7, 0.7)}
          envMap={reflectionTexture()}
          envMapIntensity={1.4}
          depthWrite={false}
        />
      </mesh>
      {/* A second, finer set of ripples drifting the other way, so the surface never looks painted on. */}
      <mesh position-z={WATER_Z + 0.004} renderOrder={3} raycast={() => null}>
        <circleGeometry args={[r + 0.2, 48]} />
        <meshStandardMaterial color="#5aa3a8" transparent opacity={0.18} roughness={0.1} normalMap={chop} normalScale={new Vector2(0.6, 0.6)} envMap={reflectionTexture()} envMapIntensity={1} depthWrite={false} />
      </mesh>
      {/* The current: streaks of foam turning in toward the middle. */}
      <mesh ref={arms} position-z={WATER_Z + 0.01} renderOrder={4} raycast={() => null}>
        <circleGeometry args={[r, 48]} />
        <meshBasicMaterial map={swirlTexture()} color="#e6f4f0" transparent opacity={0.3} depthWrite={false} />
      </mesh>
      <mesh ref={arms2} position-z={WATER_Z + 0.012} renderOrder={4} rotation-z={1} scale={0.6} raycast={() => null}>
        <circleGeometry args={[r, 48]} />
        <meshBasicMaterial map={swirlTexture()} color="#e6f4f0" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <mesh ref={rim} position-z={WATER_Z + 0.014} renderOrder={4} raycast={() => null}>
        <circleGeometry args={[r + 0.2, 64]} />
        <meshBasicMaterial map={foamTexture()} color="#e9f3ef" transparent opacity={0.5} depthWrite={false} />
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
