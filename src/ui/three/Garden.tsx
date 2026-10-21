import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { CanvasTexture, DataTexture, ExtrudeGeometry, Group, LinearFilter, LinearMipmapLinearFilter, Path, RGBAFormat, RepeatWrapping, SRGBColorSpace, Shape, ShapeGeometry, UnsignedByteType, Vector2 } from 'three';
import type { Texture } from 'three';
import { Bursts, burst } from './effects';
import { CURB, MATERIAL, bedMaps, bedOutline } from './garden';
import type { Bed, Garden as Plan, Material } from './garden';
import { rng } from './floor';
import { cardGeometry } from './geometry';
import { backTexture, useCardTexture } from './textures';

/*
  The board on the 3D table (garden.ts plans it): the four mats with their curbs, the koi
  pond where the paths cross (the exile), and the bursts a click on any of them makes
  (effects.tsx). Drawn in the table's group, so its z is up off the table, between the floor
  (Table3D's FLOOR_Z) and the cards' soft shadows (SHADOW_Z): `SAND_Z` is the mats.
*/

/** The mats' height, between the floor (-0.12) and the cards' soft shadows (-0.04). */
export const SAND_Z = -0.08;
/** The pond's layers, from its bed up: the koi swim between the bed and the surface. */
const POND_BED_Z = SAND_Z + 0.01;
const KOI_Z = SAND_Z + 0.025;
export const WATER_Z = SAND_Z + 0.045;
const PAD_Z = SAND_Z + 0.055;

/** How many pixels a rem the mats' maps get. */
const MAT_PX = 7;

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

/** A card floating on the pond: the top of a player's exile. `image` null is a card exiled face down. */
export interface Floating {
  id: string;
  image: string | null;
}

/**
 * The garden for `plan`: the mats, the curbs and the pond. `exiled`: the cards to float on the
 * pond. `onExile`: a right-click on the pond, which opens the exile.
 */
export function Garden({ plan, exiled, onExile }: { plan: Plan; exiled: Floating[]; onExile: () => void }) {
  const root = useRef<Group>(null);
  /** Where on the table an event landed: the garden's group is the table's own coordinates. */
  const at = (e: ThreeEvent<MouseEvent>) => root.current!.worldToLocal(e.point.clone());
  return (
    <group ref={root}>
      {plan.beds.map((b) => (
        <Mat key={b.season} plan={plan} bed={b} at={at} />
      ))}
      {plan.beds.map((b) => (
        <Curb key={b.season} plan={plan} bed={b} />
      ))}
      <Pond plan={plan} exiled={exiled} at={at} onExile={onExile} />
      <Bursts />
    </group>
  );
}

/** A mat: one plane over its rectangle, clear outside its rounded, pond-cut shape. A click on it makes its material's burst. */
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
      <meshStandardMaterial map={tex.map} normalMap={tex.normalMap} normalScale={new Vector2(1.2, 1.2)} roughness={MATERIAL[bed.material].roughness} alphaTest={0.5} />
    </mesh>
  );
}

/** Each mat's curb: wood round the moss, pale granite round the sand, dark slate round the gravel, marble round the stone. */
const CURB_LOOK: Record<Material, { color: string; roughness: number }> = {
  moss: { color: '#6e5238', roughness: 0.85 },
  sand: { color: '#b3ada0', roughness: 0.9 },
  gravel: { color: '#5c5e62', roughness: 0.8 },
  stone: { color: '#dadcdf', roughness: 0.45 },
};

/** A mat's curb: a low kerb around it (`bedOutline`, curving in around the pond), its top edges eased. */
function Curb({ plan, bed }: { plan: Plan; bed: Bed }) {
  const geometry = useMemo(() => {
    const path = <T extends Path>(p: T, pts: [number, number][]) => {
      pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
      p.closePath();
      return p;
    };
    // The bevel grows the shape by its size, so the outline is drawn in by as much.
    const outer = path(new Shape(), bedOutline(plan, bed, CURB.w - 0.08));
    outer.holes.push(path(new Path(), bedOutline(plan, bed, 0.08)));
    return new ExtrudeGeometry(outer, { depth: CURB.h - 0.08, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2 });
  }, [plan, bed]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh castShadow receiveShadow geometry={geometry} position-z={SAND_Z} raycast={() => null}>
      <meshStandardMaterial {...CURB_LOOK[bed.material]} />
    </mesh>
  );
}

/* ---------- the pond ---------- */

/** The water's ripples: a normal map of soft rings and swells that tiles, drawn once. */
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
  ripples.repeat.set(3, 3);
  return ripples;
}

/** The pond's bed: deep green-blue, darker toward the middle, drawn once. */
let pondBed: CanvasTexture | null = null;
function pondBedTexture() {
  if (pondBed) return pondBed;
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  grad.addColorStop(0, '#0c2a2e');
  grad.addColorStop(0.7, '#17444a');
  grad.addColorStop(1, '#3d5a4a');
  g.fillStyle = grad;
  g.fillRect(0, 0, N, N);
  pondBed = new CanvasTexture(c);
  pondBed.colorSpace = SRGBColorSpace;
  return pondBed;
}

/** A koi's outline, nose at +x, a rem and a half long: a slim body and a forked tail. */
const KOI_SHAPE = (() => {
  const s = new Shape();
  s.moveTo(0.75, 0);
  s.quadraticCurveTo(0.6, 0.22, 0.1, 0.2);
  s.quadraticCurveTo(-0.35, 0.16, -0.5, 0.05);
  s.lineTo(-0.78, 0.2);
  s.quadraticCurveTo(-0.72, 0, -0.78, -0.2);
  s.lineTo(-0.5, -0.05);
  s.quadraticCurveTo(-0.35, -0.16, 0.1, -0.2);
  s.quadraticCurveTo(0.6, -0.22, 0.75, 0);
  return s;
})();

/** The koi: their colours, how far out they circle (a share of the pond's radius), how fast, and where they start. */
const KOI = [
  { color: '#f26a1b', orbit: 0.55, speed: 0.22, phase: 0, size: 2.2 },
  { color: '#f4f1ea', orbit: 0.38, speed: -0.3, phase: 2, size: 1.8 },
  { color: '#e8a21c', orbit: 0.68, speed: 0.17, phase: 4, size: 2 },
  { color: '#d8452a', orbit: 0.3, speed: 0.26, phase: 1, size: 1.5 },
];

/** Lily pads: where on the pond (shares of its radius), how big (rem), which way their notch faces, and which carry a flower. */
const PADS = [
  { x: -0.55, y: 0.45, r: 1.5, turn: 0.4, flower: true },
  { x: -0.35, y: 0.62, r: 0.9, turn: 2.2, flower: false },
  { x: 0.6, y: -0.38, r: 1.3, turn: 4.1, flower: false },
  { x: 0.42, y: -0.6, r: 0.8, turn: 1.1, flower: true },
  { x: 0.7, y: 0.3, r: 1, turn: 5.2, flower: false },
  { x: -0.68, y: -0.28, r: 1.1, turn: 3.3, flower: false },
];

const padGeometry = new ShapeGeometry(
  (() => {
    const s = new Shape();
    // A disc with a narrow wedge cut out to its middle.
    s.moveTo(0, 0);
    s.absarc(0, 0, 1, 0.3, Math.PI * 2 - 0.05, false);
    s.lineTo(0, 0);
    return s;
  })(),
  24,
);
const koiGeometry = new ShapeGeometry(KOI_SHAPE, 8);

/**
 * The koi pond, which is the exile: a ring of rim stones, the bed, the koi circling, the
 * rippling surface, lily pads and two lotus flowers, and the top card of each player's exile
 * drifting on the water. A click on the water splashes; a right-click opens the exile.
 */
function Pond({ plan, exiled, at, onExile }: { plan: Plan; exiled: Floating[]; at: (e: ThreeEvent<MouseEvent>) => { x: number; y: number }; onExile: () => void }) {
  const { x, y, r } = plan.pond;
  const water = useRef<Texture>(rippleTexture());
  const koi = useRef<(Group | null)[]>([]);
  const rim = useMemo(() => {
    const rand = rng(23);
    const n = Math.round((2 * Math.PI * r) / 2.1);
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + rand() * 0.06;
      const s = 0.95 + rand() * 0.4;
      return { x: Math.cos(a) * (r + 0.6), y: Math.sin(a) * (r + 0.6), s, turn: a + rand() * 0.6, seed: rand() * 6 };
    });
  }, [r]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // The surface drifts.
    water.current.offset.set(t * 0.012, t * 0.008);
    // Each koi circles at its own pace, weaving a little in and out, nose along its path, its tail beating.
    KOI.forEach((k, i) => {
      const o = koi.current[i];
      if (!o) return;
      const a = k.phase + t * k.speed;
      const wob = 1 + 0.08 * Math.sin(t * 0.7 + i);
      const rr = r * k.orbit * wob;
      o.position.set(Math.cos(a) * rr, Math.sin(a) * rr, 0);
      o.rotation.z = a + (k.speed > 0 ? Math.PI / 2 : -Math.PI / 2) + 0.12 * Math.sin(t * 5 + i * 2);
    });
  });
  return (
    <group position={[x, y, 0]}>
      {rim.map((s, i) => (
        <mesh key={i} castShadow receiveShadow position={[s.x, s.y, SAND_Z]} rotation={[0, 0, s.turn]} scale={[0.85 * s.s, 1.3 * s.s, 0.32 * s.s]} raycast={() => null}>
          <dodecahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color={['#9a958a', '#8a867c', '#a8a397'][i % 3]} roughness={0.9} flatShading />
        </mesh>
      ))}
      <mesh position-z={POND_BED_Z} raycast={() => null}>
        <circleGeometry args={[r + 0.2, 48]} />
        <meshStandardMaterial map={pondBedTexture()} roughness={1} />
      </mesh>
      {KOI.map((k, i) => (
        <group key={i} ref={(o) => void (koi.current[i] = o)} position-z={KOI_Z}>
          <mesh geometry={koiGeometry} scale={k.size} raycast={() => null}>
            <meshStandardMaterial color={k.color} roughness={0.5} transparent opacity={0.85} depthWrite={false} />
          </mesh>
        </group>
      ))}
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
        <meshStandardMaterial color="#5aa3a6" transparent opacity={0.42} roughness={0.06} metalness={0.25} normalMap={water.current} normalScale={new Vector2(0.6, 0.6)} depthWrite={false} />
      </mesh>
      {PADS.map((p, i) => (
        <group key={i} position={[p.x * r, p.y * r, PAD_Z]} rotation-z={p.turn}>
          <mesh geometry={padGeometry} scale={p.r} receiveShadow raycast={() => null}>
            <meshStandardMaterial color={i % 2 ? '#4f8c3e' : '#5c9a45'} roughness={0.7} />
          </mesh>
          {p.flower && <Lotus />}
        </group>
      ))}
      {exiled.map((f, i) => (
        <FloatingCard key={f.id} f={f} index={i} count={exiled.length} r={r} />
      ))}
    </group>
  );
}

/** A floating card's size on the pond, rem. */
const FLOAT_W = 6;

/**
 * The top card of a player's exile, drifting slowly round the pond on the water, washed
 * pale blue as the CSS exile pile is. It takes no clicks: a right-click on it is the pond's.
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
    const a = (index / count) * Math.PI * 2 + t * 0.04;
    o.position.set(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, PAD_Z + 0.06 + 0.02 * Math.sin(t * 1.3 + index));
    o.rotation.set(0.02 * Math.sin(t * 0.9 + index), 0.02 * Math.cos(t * 1.1 + index), a * 0.3 + index);
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

/** A lotus flower on a pad: two rings of pink petals around a gold heart. Built from Three's Y-up primitives, so it is turned a quarter about x to stand on the water. */
function Lotus() {
  return (
    <group rotation-x={Math.PI / 2} position-z={0.05}>
      {[0, 1].map((ring) =>
        Array.from({ length: 6 }, (_, i) => {
          const a = ((i + ring * 0.5) / 6) * Math.PI * 2;
          return (
            <mesh key={`${ring}-${i}`} castShadow position={[Math.cos(a) * 0.22 * (ring ? 0.6 : 1), 0.18 + ring * 0.08, Math.sin(a) * 0.22 * (ring ? 0.6 : 1)]} rotation={[0, -a, ring ? 0.55 : 0.95]} scale={[0.16, 0.42, 0.08]}>
              <sphereGeometry args={[1, 8, 6]} />
              <meshStandardMaterial color={ring ? '#f7c6d6' : '#f09ab8'} roughness={0.6} />
            </mesh>
          );
        }),
      )}
      <mesh position-y={0.26}>
        <sphereGeometry args={[0.12, 8, 6]} />
        <meshStandardMaterial color="#f2c94c" emissive="#a87a10" emissiveIntensity={0.4} />
      </mesh>
    </group>
  );
}
