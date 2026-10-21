import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, Color, DodecahedronGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, RingGeometry, SphereGeometry } from 'three';
import { play } from '../sound';
import type { Sound } from '../sound';
import { rng } from './floor';

/*
  What a click on the 3D board does where it lands: a splash on the pond, a puff of sand,
  a few petals off the moss, pebbles hopping on the gravel, a glint of frost on the stone, a
  little dust off the flagstones. Each is a handful of particles that live for a second, with
  a soft sound to match (synth.ts).

  A click adds one burst here (`burst`), and only this component draws again for it: the
  table, its cards and the rest of the scene don't, and each burst's particles move in its
  own frame loop, off React.
*/

export type Burst = 'splash' | 'moss' | 'sand' | 'gravel' | 'stone' | 'path';

/** Each burst's sound. */
const SOUND: Record<Burst, Sound> = { splash: 'splash', moss: 'moss', sand: 'sand', gravel: 'gravel', stone: 'stone', path: 'stone' };

interface Live {
  id: number;
  kind: Burst;
  /** Where, in the table's coordinates (z up off it). */
  x: number;
  y: number;
  z: number;
}

let next = 0;
const listeners = new Set<(b: Live) => void>();

/** A burst of `kind` at (`x`, `y`, `z`) on the table, and its sound. */
export function burst(kind: Burst, x: number, y: number, z = 0) {
  play(SOUND[kind]);
  const b = { id: next++, kind, x, y, z };
  listeners.forEach((f) => f(b));
}

/** The bursts now playing. Drawn in the table's group, so the particles' z is up off the table. */
export function Bursts() {
  const [live, setLive] = useState<Live[]>([]);
  useEffect(() => {
    const add = (b: Live) => setLive((l) => [...l.slice(-12), b]);
    listeners.add(add);
    return () => void listeners.delete(add);
  }, []);
  return (
    <>
      <Warmup />
      {live.map((b) => (
        <Particles key={b.id} b={b} done={() => setLive((l) => l.filter((x) => x.id !== b.id))} />
      ))}
    </>
  );
}

/** How each burst looks: how many particles, their colours, how hard they fly, and for how long. */
interface Recipe {
  count: number;
  colors: string[];
  /** Particle size, rem. */
  size: number;
  shape: 'drop' | 'grain' | 'petal' | 'pebble' | 'spark';
  /** Speed outward and upward, rem a second (each a range), and the pull down. */
  out: [number, number];
  up: [number, number];
  gravity: number;
  life: number;
  /** Rings spreading on the surface: a splash's ripples, a frost glint's flash. */
  rings?: { color: string; reach: number; delay: number }[];
}

const RECIPES: Record<Burst, Recipe> = {
  splash: {
    count: 14,
    colors: ['#dff4ff', '#bfe6f2', '#ffffff'],
    size: 0.45,
    shape: 'drop',
    out: [3, 7],
    up: [8, 14],
    gravity: 34,
    life: 1.1,
    rings: [
      { color: '#e8fbff', reach: 7, delay: 0 },
      { color: '#c6eef5', reach: 5, delay: 0.2 },
    ],
  },
  sand: { count: 16, colors: ['#d8d0bc', '#c9bfa8', '#e6dfcd'], size: 0.28, shape: 'grain', out: [2.5, 6], up: [4, 7], gravity: 26, life: 0.85 },
  moss: { count: 7, colors: ['#f4b6c9', '#f9d3de', '#9cbf6e'], size: 0.9, shape: 'petal', out: [1.5, 3.5], up: [3, 5], gravity: 3.5, life: 1.5 },
  gravel: { count: 8, colors: ['#8f7f6c', '#a8957d', '#6f6252'], size: 0.42, shape: 'pebble', out: [2, 5], up: [5, 9], gravity: 34, life: 0.8 },
  stone: { count: 10, colors: ['#ffffff', '#e6f2ff'], size: 0.2, shape: 'spark', out: [2.5, 6], up: [1.5, 4], gravity: 6, life: 0.75, rings: [{ color: '#f2f8ff', reach: 3.5, delay: 0 }] },
  path: { count: 9, colors: ['#8b8780', '#a39f97'], size: 0.24, shape: 'grain', out: [1.5, 4], up: [2.5, 5], gravity: 20, life: 0.65 },
};

/** The particles' shapes, a unit across, made once for every burst. */
const SHAPES = {
  drop: new SphereGeometry(1, 6, 4),
  grain: new BoxGeometry(1, 1, 1),
  petal: new SphereGeometry(1, 6, 4),
  pebble: new DodecahedronGeometry(1, 0),
  spark: new SphereGeometry(1, 6, 4),
};
const RING = new RingGeometry(0.8, 1, 48);

/*
  The bursts' materials are pooled: each burst takes the ones it needs (`take`) and gives them
  back when it ends (`give`), so a click makes no new material once the first of its kind has
  played. A new material is the expensive part of a burst (its shader is built on first draw),
  and `Warmup` builds one of each as the board first draws, so even the first click doesn't
  stall.
*/
type Mat = MeshStandardMaterial | MeshBasicMaterial;
const pool = new Map<string, Mat[]>();

function make(kind: Burst, key: string): Mat {
  const r = RECIPES[kind];
  const [, what, color] = key.split('|');
  if (what === 'ring') return new MeshBasicMaterial({ color, transparent: true, opacity: 0, side: DoubleSide, depthWrite: false });
  return new MeshStandardMaterial({
    color,
    transparent: true,
    depthWrite: false,
    roughness: r.shape === 'drop' ? 0.1 : 0.9,
    // Lit by their own colour a little too, so a petal or a grain reads in shade as well as in sun.
    emissive: new Color(color),
    emissiveIntensity: r.shape === 'spark' ? 1.5 : 0.3,
  });
}
const keysOf = (kind: Burst) => [...RECIPES[kind].colors.map((c) => `${kind}|part|${c}`), ...(RECIPES[kind].rings ?? []).map((ring) => `${kind}|ring|${ring.color}`)];
const take = (kind: Burst, key: string) => pool.get(key)?.pop() ?? make(kind, key);
const give = (key: string, m: Mat) => {
  m.opacity = 1;
  pool.set(key, [...(pool.get(key) ?? []), m]);
};

/** One of each burst's materials, drawn briefly, out of sight under the floor, as the board first draws: their shaders are built then. */
function Warmup() {
  const [shown, setShown] = useState(true);
  const mats = useMemo(() => (Object.keys(RECIPES) as Burst[]).flatMap((kind) => keysOf(kind).map((key) => ({ key, m: take(kind, key) }))), []);
  const frames = useRef(0);
  useFrame(() => {
    // Drawn for a few frames, then back to the pool.
    if (shown && ++frames.current > 3) {
      mats.forEach(({ key, m }) => give(key, m));
      setShown(false);
    }
  });
  if (!shown) return null;
  return (
    <group position-z={-5}>
      {mats.map(({ key, m }) => (
        <mesh key={key} geometry={SHAPES.drop} material={m} scale={0.001} raycast={() => null} />
      ))}
    </group>
  );
}

/** The longest step a burst takes in one frame, s: after a stall it carries on where it was rather than jumping to its end. */
const MAX_STEP = 1 / 20;

/** One burst's particles: each flies out and up from where the click landed and falls back, fading; the rings spread and fade. */
function Particles({ b, done }: { b: Live; done: () => void }) {
  const r = RECIPES[b.kind];
  const group = useRef<Group>(null);
  const parts = useMemo(() => {
    const rand = rng(b.id * 9301 + 7);
    return Array.from({ length: r.count }, (_, i) => {
      const a = (i / r.count) * Math.PI * 2 + rand() * 0.6;
      const speed = r.out[0] + rand() * (r.out[1] - r.out[0]);
      return {
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        vz: r.up[0] + rand() * (r.up[1] - r.up[0]),
        spin: (rand() - 0.5) * 12,
        key: `${b.kind}|part|${r.colors[i % r.colors.length]}`,
        s: r.size * (0.7 + rand() * 0.6),
      };
    });
  }, [b.id, b.kind, r]);
  // The burst's materials, one a colour, shared by its particles (they fade together).
  const materials = useMemo(() => new Map(keysOf(b.kind).map((key) => [key, take(b.kind, key)])), [b.kind]);
  useEffect(() => () => materials.forEach((m, key) => give(key, m)), [materials]);
  const age = useRef(0);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const t = (age.current += Math.min(dt, MAX_STEP));
    if (t > r.life + 0.3) {
      done();
      return;
    }
    const fade = Math.max(0, 1 - t / r.life);
    parts.forEach((p, i) => {
      const m = g.children[i] as Mesh;
      // Petals drift down slowly and sway; everything else flies on a plain arc and stops at the surface.
      const z = Math.max(0, p.vz * t - (r.gravity * t * t) / 2);
      const sway = r.shape === 'petal' ? Math.sin(t * 5 + i) * 0.25 : 0;
      m.position.set(p.vx * t + sway, p.vy * t, z + 0.05);
      m.rotation.set(p.spin * t, p.spin * t * 0.7, p.spin * t * 0.3);
      (m.material as Mat).opacity = fade;
    });
    (r.rings ?? []).forEach((ring, k) => {
      const m = g.children[parts.length + k] as Mesh;
      const rt = Math.max(0, t - ring.delay) / (r.life - ring.delay);
      m.visible = t >= ring.delay && rt < 1;
      m.scale.setScalar(0.2 + rt * ring.reach);
      (m.material as Mat).opacity = 0.7 * (1 - rt);
    });
  });
  return (
    <group ref={group} position={[b.x, b.y, b.z]}>
      {parts.map((p, i) => (
        <mesh key={i} geometry={SHAPES[r.shape]} material={materials.get(p.key)} scale={r.shape === 'petal' ? [p.s, p.s * 0.6, p.s * 0.1] : p.s} raycast={() => null} />
      ))}
      {(r.rings ?? []).map((ring, k) => (
        <mesh key={`ring${k}`} geometry={RING} material={materials.get(`${b.kind}|ring|${ring.color}`)} position-z={0.02} visible={false} raycast={() => null} />
      ))}
    </group>
  );
}
