import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, DoubleSide, Group, PointLight, RepeatWrapping, SRGBColorSpace, Vector2 } from 'three';
import type { Texture } from 'three';
import { rng } from './floor';
import { hash, valueNoise } from './noise';

/*
  The hall around the 3D table: dressed-stone walls down both sides and across the far end,
  with arched recesses, after a dungeon's (the board, Garden.tsx, lies on its flagstone floor).
  Torches burn in iron sconces on the side walls either side of the play area, and their
  flickering light is most of the warm light on the table. Built in the table's coordinates
  (layout3d.ts: rem, x across, y up the table, z up off it).
*/

/** The walls: how high they stand and how thick they are, how far past the table's sides, and the blocks' size, rem. */
const WALL = { h: 30, t: 3, side: 4, block: { w: 5.2, h: 2.6 } };

/** One picture of the wall's dressed stone: blocks in courses, each its own shade, in dark mortar, with a matching normal map. Drawn once. */
let wallMaps: { map: CanvasTexture; normalMap: CanvasTexture } | null = null;
function wallTextures() {
  if (wallMaps) return wallMaps;
  const N = 512;
  // The picture is 4 blocks across and 8 courses up, so it tiles.
  const cols = 4;
  const rows = 8;
  const bw = N / cols;
  const bh = N / rows;
  const color = new ImageData(N, N);
  const normal = new ImageData(N, N);
  const height = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const row = Math.floor(y / bh);
    const v = y - row * bh;
    // Every other course is offset by half a block.
    const shift = row % 2 ? bw / 2 : 0;
    for (let x = 0; x < N; x++) {
      const xs = (x + shift) % N;
      const col = Math.floor(xs / bw);
      const u = xs - col * bw;
      const mortar = Math.min(u, bw - u, v, bh - v);
      const block = hash(col, row, 3);
      const face = valueNoise(x / 14, y / 14, 4, N / 14, N / 14);
      const fine = valueNoise(x / 3, y / 3, 5, N / 3, N / 3);
      // Rounded, chipped block edges into recessed mortar.
      const edge = Math.min(1, Math.max(0, (mortar - 3 + (fine - 0.5) * 3) / 6));
      height[y * N + x] = edge * (0.7 + face * 0.3);
      const shade = edge > 0 ? (0.55 + block * 0.3 + face * 0.25 + (fine - 0.5) * 0.12) * (0.75 + edge * 0.25) : 0.25 + fine * 0.1;
      const o = (y * N + x) * 4;
      color.data[o] = 120 * shade;
      color.data[o + 1] = 114 * shade;
      color.data[o + 2] = 106 * shade;
      color.data[o + 3] = 255;
    }
  }
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const hx = (height[y * N + ((x + 1) % N)] - height[y * N + ((x - 1 + N) % N)]) * 2;
      const hy = (height[((y + 1) % N) * N + x] - height[((y - 1 + N) % N) * N + x]) * 2;
      const l = Math.hypot(hx, hy, 1);
      const o = (y * N + x) * 4;
      // Canvas rows run down; the normal's y is up the picture, so it is flipped.
      normal.data[o] = (0.5 - hx / l / 2) * 255;
      normal.data[o + 1] = (0.5 + hy / l / 2) * 255;
      normal.data[o + 2] = (0.5 + 0.5 / l) * 255;
      normal.data[o + 3] = 255;
    }
  const canvas = (img: ImageData) => {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    c.getContext('2d')!.putImageData(img, 0, 0);
    const t = new CanvasTexture(c);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  const map = canvas(color);
  map.colorSpace = SRGBColorSpace;
  wallMaps = { map, normalMap: canvas(normal) };
  return wallMaps;
}

/** A wall's maps, repeated to its size (`len` along it, `WALL.h` up), so its blocks are the same size on every wall. */
function useWallMaps(len: number) {
  return useMemo(() => {
    const base = wallTextures();
    const repeat = (t: Texture) => {
      const c = t.clone();
      c.repeat.set(len / (WALL.block.w * 4), WALL.h / (WALL.block.h * 8));
      c.needsUpdate = true;
      return c;
    };
    return { map: repeat(base.map), normalMap: repeat(base.normalMap) };
  }, [len]);
}

/** A stretch of wall `len` long, its face toward the table: a slab of dressed stone with a row of arched recesses. Its own origin is the foot of its face's middle; its z is up. */
function Wall({ len, arches }: { len: number; arches: number }) {
  const maps = useWallMaps(len);
  return (
    <group>
      <mesh receiveShadow position={[0, WALL.t / 2, WALL.h / 2]}>
        <boxGeometry args={[len, WALL.t, WALL.h]} />
        <meshStandardMaterial attach="material-0" color="#3a3632" roughness={0.95} />
        <meshStandardMaterial attach="material-1" color="#3a3632" roughness={0.95} />
        {/* The face toward the table (-y): the box's third face pair is its y sides. */}
        <meshStandardMaterial attach="material-2" color="#3a3632" roughness={0.95} />
        <meshStandardMaterial attach="material-3" map={maps.map} normalMap={maps.normalMap} normalScale={new Vector2(1.2, 1.2)} roughness={0.92} />
        <meshStandardMaterial attach="material-4" color="#2a2724" roughness={0.95} />
        <meshStandardMaterial attach="material-5" color="#2a2724" roughness={0.95} />
      </mesh>
      {Array.from({ length: arches }, (_, i) => (
        <Arch key={i} x={((i + 0.5) / arches - 0.5) * len} />
      ))}
    </group>
  );
}

/** An arched recess in a wall's face at `x`: dark stone, framed in lighter voussoirs. */
function Arch({ x }: { x: number }) {
  const W = 9;
  const H = 16;
  return (
    <group position={[x, -0.05, 0]} rotation-x={Math.PI / 2}>
      {/* The recess: a dark panel with a round top, just proud of the face. */}
      <mesh position={[0, H / 2 - W / 4, 0]}>
        <planeGeometry args={[W, H - W / 2]} />
        <meshStandardMaterial color="#0d0c0b" roughness={1} />
      </mesh>
      <mesh position={[0, H - W / 2 - W / 4, 0]}>
        <circleGeometry args={[W / 2, 24, 0, Math.PI]} />
        <meshStandardMaterial color="#0d0c0b" roughness={1} />
      </mesh>
      {/* The frame: jambs up its sides and a ring of stones over it. */}
      {[-1, 1].map((s) => (
        <mesh key={s} castShadow position={[s * (W / 2 + 0.6), (H - W / 2) / 2, 0.4]}>
          <boxGeometry args={[1.2, H - W / 2, 0.8]} />
          <meshStandardMaterial color="#6a645b" roughness={0.9} />
        </mesh>
      ))}
      {Array.from({ length: 9 }, (_, i) => {
        const a = (i / 8) * Math.PI;
        const rr = W / 2 + 0.6;
        return (
          <mesh key={i} castShadow position={[Math.cos(a) * rr, H - W / 2 + Math.sin(a) * rr, 0.4]} rotation-z={a}>
            <boxGeometry args={[1.2, 1.6, 0.8]} />
            <meshStandardMaterial color={i % 2 ? '#6a645b' : '#5e5951'} roughness={0.9} flatShading />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * A torch in an iron sconce, mounted on a wall: a wooden haft, a cup of pitch, and a flame that
 * flickers, with a warm light that flickers with it. Its own origin is the wall's face, and it
 * stands out from the wall along the wall's own -y, as `Wall` faces. Built Y-up, as Three's
 * primitives are, and turned to stand on the table.
 */
function Torch({ seed }: { seed: number }) {
  const flame = useRef<Group>(null);
  const light = useRef<PointLight>(null);
  const rand = useMemo(() => rng(seed), [seed]);
  const phase = useMemo(() => rand() * 100, [rand]);
  useFrame((state) => {
    const t = state.clock.elapsedTime + phase;
    // Flicker: a few incommensurate wobbles, never quite repeating.
    const f = 0.82 + 0.1 * Math.sin(t * 11.3) + 0.06 * Math.sin(t * 17.9 + 1.3) + 0.05 * Math.sin(t * 5.1 + 0.4);
    if (light.current) light.current.intensity = 5200 * f;
    if (flame.current) {
      flame.current.scale.set(0.9 + 0.12 * f, 0.8 + 0.35 * f, 0.9 + 0.12 * f);
      flame.current.rotation.z = 0.08 * Math.sin(t * 7.7);
    }
  });
  return (
    <group rotation-x={Math.PI / 2}>
      {/* The bracket from the wall, and the iron cup it holds. */}
      <mesh castShadow position={[0, 0, 1.4]}>
        <boxGeometry args={[0.5, 0.5, 2.8]} />
        <meshStandardMaterial color="#2a2623" metalness={0.6} roughness={0.5} />
      </mesh>
      <group position={[0, 0, 2.6]} rotation-x={0.3}>
        <mesh castShadow position={[0, -1.6, 0]}>
          <cylinderGeometry args={[0.35, 0.28, 4.2, 8]} />
          <meshStandardMaterial color="#4a3423" roughness={0.9} />
        </mesh>
        <mesh castShadow position={[0, 0.6, 0]}>
          <cylinderGeometry args={[0.85, 0.5, 1.2, 10, 1, true]} />
          <meshStandardMaterial color="#2a2623" metalness={0.6} roughness={0.5} side={DoubleSide} />
        </mesh>
        <group ref={flame} position={[0, 1.2, 0]}>
          <mesh position={[0, 1, 0]}>
            <coneGeometry args={[0.75, 2.6, 10]} />
            <meshBasicMaterial color="#ff8a2a" transparent opacity={0.85} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.75, 0]}>
            <coneGeometry args={[0.42, 1.6, 10]} />
            <meshBasicMaterial color="#ffe08a" toneMapped={false} />
          </mesh>
        </group>
        <pointLight ref={light} position={[0, 3, 0]} color="#ff9a45" intensity={5200} distance={160} decay={2} />
      </group>
    </group>
  );
}

/**
 * The hall: a wall down each side of the table, just past its edge, and one across the far
 * end, all with arched recesses; a torch on each side wall either side of the play area, at
 * `cross` (where the paths between the mats cross), one nearer you and one further off.
 */
export function Hall({ w, tableH, cross }: { w: number; tableH: number; cross: number }) {
  const side = w / 2 + WALL.side;
  const len = tableH + 60;
  const torches = [cross - 26, cross + 24];
  return (
    <>
      {/* The side walls run from well behind you to past the far end; their faces look in. */}
      <group position={[-side, len / 2 - 30, 0]} rotation-z={Math.PI / 2}>
        <Wall len={len} arches={6} />
      </group>
      <group position={[side, len / 2 - 30, 0]} rotation-z={-Math.PI / 2}>
        <Wall len={len} arches={6} />
      </group>
      <group position={[0, tableH + 6, 0]}>
        <Wall len={2 * side + 2 * WALL.t} arches={5} />
      </group>
      {torches.map((y, i) => (
        <group key={i}>
          <group position={[-side, y, 14]} rotation-z={Math.PI / 2}>
            <Torch seed={i * 2 + 1} />
          </group>
          <group position={[side, y, 14]} rotation-z={-Math.PI / 2}>
            <Torch seed={i * 2 + 2} />
          </group>
        </group>
      ))}
    </>
  );
}
