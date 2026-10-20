import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { GLProps, ThreeEvent } from '@react-three/fiber';
import { BufferAttribute, Group, MathUtils, Matrix4, Mesh, MeshBasicMaterial, OrthographicCamera, Plane, PlaneGeometry, Raycaster, Vector2, Vector3 } from 'three';
import type { DirectionalLight, PerspectiveCamera, Texture, WebGLRenderer } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { attachmentsOf, data, defenseOf, isBattle, isCreature, isPlaneswalker, loyaltyOf, stats } from '../../engine';
import type { Card, Game, Player } from '../../engine';
import { creaturePiles, landPiles, otherPermanents } from '../Board';
import { DEPTH, TILT, useStageSize, useTableSize } from '../camera';
import { Counters, TextlessBadge } from '../Card';
import { useStore } from '../store';
import { seatBox } from '../table-layout';
import { frameOf } from '../TextCard';
import { cx, faceUp, seatOf } from '../util';
import type { Seat } from '../util';
import { ViewContext, clickGroup, clickPermanent, useView } from '../view';
import type { View } from '../view';
import { newGame, zoneMoves } from '../zone-moves';
import type { Place } from '../zone-moves';
import { AREA } from './floor';
import { CARD_THICKNESS, baseCamera, layoutSeat, quadMatrix, tiltRad } from './layout3d';
import type { Pose, Row } from './layout3d';
import { SHADOW_SPREAD, backTexture, shadowTexture, useCardTexture, useFloorTextures } from './textures';

/*
  The table drawn in 3D (a spike, see docs/plans/flutter-conversion.md): opened with
  `?table=3d`. It replaces `.table` in GameScreen and nothing else: the portraits, piles,
  hands, HUD and pickers stay on the screen as before, over the canvas, and the engine, the
  store and view.ts are untouched.

  The scene is Three.js through React Three Fiber, drawn with Three's WebGPU renderer, which
  falls back to WebGL 2 where the browser has no WebGPU (`?gl=webgl` forces that). The
  camera starts where the CSS table's perspective puts the viewer (camera.ts, `baseCamera`),
  so the seats' rows land where table-layout.ts designed them, and moves from there: a slow
  push in while combat is on.

  The cards are thin boxes with the card's image on top and a drawn back underneath, lit and
  casting shadows on a flagstone floor (floor.ts), each with a soft dark under it where it
  rests, with trees, rocks and lantern pillars around it. Their
  hover, click and glow come from raycasting on the meshes and go to the same view.ts handlers
  the CSS tiles call.

  Each card also has a proxy: an empty div in `.card-proxies`, the card's size, laid onto the
  card on the screen every frame by a matrix3d (`useProxy`), so it leans, turns and
  foreshortens with the card. It takes no pointer events. It exists so the parts of the
  interface that find cards on the screen by their elements keep working unchanged: the
  preview beside the hovered card (`hover.el`), the arrows (`[data-card]`), and the flights of
  cards leaving the table (Flights.tsx reads where they were). It carries the badges too: P/T,
  counters, the summoning-sick mark and a pile's "x7", crisp DOM text over the canvas.
  Arrivals on the table fly in here instead (`origins`): the proxy only gets its `data-card`
  once the card has landed, so Flights.tsx leaves those to us.
*/

const PARAMS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
/** `?quality=low`: no shadows and no high-DPI drawing, for a weak machine. */
const LOW = PARAMS.get('quality') === 'low';

const BG = '#070a12';
/** How far a tapped card is turned (rad). The CSS tile's is 8°. */
const TAPPED_RAD = (8 * Math.PI) / 180;
/** The highlight colours (`--play`, `--target`, `--danger` in styles.css). */
const GLOW: Record<string, string> = { play: '#39e3ff', attack: '#39e3ff', block: '#39e3ff', target: '#ffe45c', picked: '#ffffff', discard: '#ff5a4a' };

/*
  What lies just under the cards, in the table's z (up off it), apart enough not to fight over
  depth: the floor, a card's soft shadow on it, a card's glow over that, and the card's
  underside at 0 (CARD_THICKNESS / 2 under the middle of the lowest card).
*/
const FLOOR_Z = -0.06;
const SHADOW_Z = -0.04;
const GLOW_Z = -0.02;
/** How dark a card's soft shadow is right under it, resting. */
const SHADOW_OPACITY = 0.7;

/** Where a card that just reached the table came from, read off the screen before React redrew it. */
interface Origin {
  x: number;
  y: number;
  /** The card's width there, px. */
  w: number;
  /** A token appearing: nothing to fly from, so it pops up where it lands. */
  pop?: boolean;
  at: number;
}
const origins = new Map<string, Origin>();

/** The proxies by card id (see the note above). */
const proxies = new Map<string, HTMLDivElement>();

const q = (sel: string) => document.querySelector<HTMLElement>(sel);

/** The element a card at `place` was drawn as, or its zone's, for where a flight starts. */
function originEl(place: Place, id: string) {
  switch (place.zone) {
    case 'hand':
      return q(`[data-hand="${id}"]`) ?? q(`[data-hand-of="${place.pid}"]`);
    case 'stack':
      return q(`[data-stack-card="${id}"]`) ?? q(`[data-paying="${id}"]`);
    case 'graveyard':
    case 'exile':
      return q(`[data-pile="${place.pid}-${place.zone}"]`);
    case 'library':
      return q(`[data-library="${place.pid}"] .card-back`);
    case 'command':
      return q(`[data-card="${id}"]`) ?? q(`[data-avatar="${place.pid}"]`);
    case 'battlefield':
      return q(`[data-card="${id}"]`);
  }
}

/** On every change of game, before React redraws: where each card now reaching the table was. */
function captureOrigins(next: Game | null, prev: Game | null) {
  if (!next || !prev || next === prev || newGame(prev, next)) return;
  const now = performance.now();
  for (const m of zoneMoves(prev, next)) {
    if (m.to.zone !== 'battlefield') continue;
    if (!m.from) {
      if (m.card.isToken) origins.set(m.card.id, { x: 0, y: 0, w: 0, pop: true, at: now });
      continue;
    }
    const el = originEl(m.from, m.card.id);
    const r = el?.getBoundingClientRect();
    if (!r || !r.width) continue;
    origins.set(m.card.id, { x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.min(r.width, r.height), at: now });
  }
}

/** Three's WebGPU renderer, on WebGL 2 where there is no WebGPU. */
/** What the Canvas hands a renderer factory: the canvas to draw on. */
type RendererProps = Parameters<Extract<GLProps, (p: never) => unknown>>[0];
async function makeRenderer(props: RendererProps) {
  const renderer = new WebGPURenderer({ canvas: props.canvas as HTMLCanvasElement, antialias: true, forceWebGL: PARAMS.get('gl') === 'webgl' });
  await renderer.init();
  return renderer as unknown as WebGLRenderer;
}

interface SeatLayout {
  player: Player;
  seat: Seat;
  poses: Pose<Card>[];
  phased: Set<string>;
  /** Each pile of more than one card, by the id of the card on top, for its badge. */
  piles: Map<string, Card[]>;
}

/** The whole seats' layout for this game, from the same piles the CSS table draws. */
function layoutSeats(v: View, players: Player[], stageW: number, stageH: number, tableH: number): SeatLayout[] {
  const g = v.g;
  return players.map((p) => {
    const seat = seatOf(g, v.me, p.id);
    const box = seatBox(seat, stageW, stageH);
    const { others, phased } = otherPermanents(g, p);
    const rows: Row<Card>[] = [
      { kind: 'other', piles: landPiles(g, p) },
      { kind: 'other', piles: [...others, ...phased].map((c) => [c]) },
      { kind: 'creature', piles: creaturePiles(v, p) },
    ];
    const piles = new Map(rows.flatMap((r) => r.piles.filter((pile) => pile.length > 1).map((pile) => [pile[pile.length - 1].id, pile] as const)));
    return { player: p, seat, poses: layoutSeat(seat, box, rows, stageW, tableH), phased: new Set(phased.map((c) => c.id)), piles };
  });
}

/** The 3D table in place of `.table`: the canvas, and the proxies over it. */
export default function Table3D({ players }: { players: Player[] }) {
  const v = useView();
  const stage = useStageSize();
  const table = useTableSize();
  const speed = useStore((s) => s.speed);
  const seats = layoutSeats(v, players, stage.w, stage.h, table.h);
  useEffect(() => useStore.subscribe((s, old) => captureOrigins(s.game, old.game)), []);
  return (
    <div className="table3d">
      <Canvas gl={makeRenderer} shadows={!LOW} dpr={LOW ? 1 : [1, 1.5]} camera={{ manual: true, position: [0, 0, DEPTH], near: 5, far: 2500 }}>
        <Scene v={v} speed={speed} w={stage.w} h={stage.h} tableH={table.h} seats={seats} />
      </Canvas>
      <div className="card-proxies">
        {seats.flatMap((s) =>
          s.poses.flatMap((p) => [
            <CardProxy key={p.item.id} card={p.item} g={v.g} pile={s.piles.get(p.item.id)} />,
            ...attachmentsOf(v.g, p.item).map((a) => <CardProxy key={a.id} card={a} g={v.g} />),
          ]),
        )}
      </div>
    </div>
  );
}

/**
 * A card's stand-in on the screen (see the note at the top): kept over the card by `useProxy`,
 * carrying its badges. `pile`: it is the top of a pile, whose badge uses them all at once.
 */
function CardProxy({ card, g, pile }: { card: Card; g: Game; pile?: Card[] }) {
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) proxies.set(card.id, el);
      else proxies.delete(card.id);
    },
    [card.id],
  );
  const d = data(card);
  const creature = isCreature(g, card);
  const s = creature ? stats(g, card) : null;
  const printed = { power: parseInt(d.power ?? '0', 10) || 0, toughness: parseInt(d.toughness ?? '0', 10) || 0 };
  const ptClass = s && card.damage > 0 ? 'hurt' : s && (s.power > printed.power || s.toughness > printed.toughness) ? 'buffed' : s && (s.power < printed.power || s.toughness < printed.toughness) ? 'hurt' : '';
  const sick = creature && card.sick && g.active === card.controller && !s!.keywords.has('haste');
  return (
    <div ref={ref} className="card-proxy" style={{ '--frame': `var(--f-${frameOf(d)})` } as CSSProperties}>
      {s && (
        <div className={cx('tile-pt', ptClass)}>
          {s.power}/{s.toughness - card.damage}
        </div>
      )}
      {isPlaneswalker(g, card) && !s && <div className="tile-pt tile-loyalty">{loyaltyOf(card)}</div>}
      {isBattle(g, card) && <div className="tile-pt tile-defense">{defenseOf(card)}</div>}
      <Counters card={card} />
      {sick && <i className="tile-sick ms ms-ability-summoning-sickness" title="Summoning sick" />}
      {card.textless && <TextlessBadge />}
      {pile && (
        <div
          className="tile-badge"
          title={`Use all ${pile.length}`}
          onClick={(e) => {
            e.stopPropagation();
            clickGroup(pile);
          }}
        >
          x{pile.length}
        </div>
      )}
    </div>
  );
}

/* ---------- inside the canvas ---------- */

interface SceneState {
  v: View;
  speed: number;
  /** The table's group: everything on the table is placed in its coordinates (layout3d.ts). */
  table: RefObject<Group | null>;
}
const SceneCtx = createContext<SceneState | null>(null);
const useScene = () => useContext(SceneCtx)!;

const inCombat = (g: Game) => g.step === 'beginCombat' || g.step === 'attackers' || g.step === 'blockers' || g.step === 'damage';

function Scene({ v, speed, w, h, tableH, seats }: { v: View; speed: number; w: number; h: number; tableH: number; seats: SeatLayout[] }) {
  const table = useRef<Group>(null);
  const state = useMemo(() => ({ v, speed, table }), [v, speed]);
  return (
    <SceneCtx.Provider value={state}>
      {/* The view for anything inside that asks for it, as the DOM side has it. */}
      <ViewContext.Provider value={v}>
        <color attach="background" args={[BG]} />
        {/* Only what lies past the table fades: the near edge is DEPTH away, the far one a little more. */}
        <fog attach="fog" args={[BG, 660, 1500]} />
        <Rig w={w} h={h} combat={inCombat(v.g)} />
        <Lights w={w} tableH={tableH} />
        {/* The table leans away from you by TILT about its bottom edge, like the CSS one. Its own z is up off the table. */}
        <group ref={table} rotation-x={-tiltRad(TILT)}>
          <Floor w={w} tableH={tableH} />
          <Props w={w} tableH={tableH} />
          {seats.map((s) => s.poses.map((p) => <Card3D key={p.item.id} pose={p} seat={s.seat} phased={s.phased.has(p.item.id)} />))}
        </group>
      </ViewContext.Provider>
    </SceneCtx.Provider>
  );
}

/**
 * The camera: the CSS table's viewer to start with (`baseCamera`), so the rows fall where the
 * layout puts them, and a slow push in, a little higher and looking down a little more, while
 * combat is on.
 */
function Rig({ w, h, combat }: { w: number; h: number; combat: boolean }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  useEffect(() => {
    const c = baseCamera(w, h, DEPTH);
    camera.fov = c.fov;
    camera.aspect = c.aspect;
    camera.setViewOffset(c.viewOffset.fullWidth, c.viewOffset.fullHeight, c.viewOffset.x, c.viewOffset.y, c.viewOffset.width, c.viewOffset.height);
    camera.updateProjectionMatrix();
  }, [camera, w, h]);
  const push = useRef(0);
  useFrame((_, dt) => {
    push.current = MathUtils.damp(push.current, combat ? 1 : 0, 2.2, dt);
    const k = push.current;
    // Gently: the rows must stay on the screen, under the same portraits and piles. Nearer
    // makes everything climb the screen (the camera's axis is the bottom edge), so it also
    // looks up by just enough that the far edge stays where it was and the near rows grow.
    camera.position.set(0, 0, DEPTH - 40 * k);
    camera.rotation.set(0.013 * k, 0, 0);
  });
  return null;
}

/** Where the moon is, in the world: high, beyond the far edge and to the left. */
const MOON = new Vector3(-150, 260, 230);

/**
 * The moon's shadow camera fitted to the table and what stands on it: the box, in the light's
 * own view, around the table (with a margin for the props past its sides and far edge) from
 * the floor up to the treetops. The tighter it is, the more shadow map each card gets: a card
 * is 0.12 rem thick, so its shadow is a sliver that a loose box blurs away.
 */
function moonShadowBox(w: number, tableH: number) {
  // A camera, not a plain object: lookAt turns a camera's -z to the target, as the shadow camera's is.
  const view = new OrthographicCamera();
  view.position.copy(MOON);
  view.lookAt(0, 0, 0);
  view.updateMatrixWorld();
  const toView = view.matrixWorldInverse;
  // The table leans away by TILT about its bottom edge, as the scene's table group does.
  const lean = new Matrix4().makeRotationX(-tiltRad(TILT));
  let left = Infinity;
  let right = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  let near = Infinity;
  let far = -Infinity;
  const p = new Vector3();
  for (const x of [-w / 2 - 24, w / 2 + 24])
    for (const y of [-6, tableH + 12])
      for (const z of [0, 40]) {
        p.set(x, y, z).applyMatrix4(lean).applyMatrix4(toView);
        left = Math.min(left, p.x);
        right = Math.max(right, p.x);
        bottom = Math.min(bottom, p.y);
        top = Math.max(top, p.y);
        // The light looks down its -z.
        near = Math.min(near, -p.z);
        far = Math.max(far, -p.z);
      }
  return { left, right, bottom, top, near: near - 10, far: far + 10 };
}

function Lights({ w, tableH }: { w: number; tableH: number }) {
  const box = useMemo(() => moonShadowBox(w, tableH), [w, tableH]);
  const moon = useRef<DirectionalLight>(null);
  // Three reads the shadow camera's bounds only when it first sets the shadow up: a new size needs telling.
  useEffect(() => moon.current?.shadow.camera.updateProjectionMatrix(), [box]);
  return (
    <>
      <hemisphereLight args={['#a9b9dc', '#2a2d36', 0.75]} />
      {/*
        The moon: the one light that casts shadows, over the whole table. The biases are small
        next to a card's thickness (0.12): bigger, and the shadow comes loose from the card
        that casts it (peter-panning), so the card seems to float.
      */}
      <directionalLight
        ref={moon}
        position={MOON}
        intensity={3.2}
        color="#fbf5ea"
        castShadow={!LOW}
        shadow-mapSize-width={4096}
        shadow-mapSize-height={4096}
        shadow-camera-near={box.near}
        shadow-camera-far={box.far}
        shadow-camera-left={box.left}
        shadow-camera-right={box.right}
        shadow-camera-top={box.top}
        shadow-camera-bottom={box.bottom}
        shadow-bias={-0.00004}
        shadow-normalBias={0.02}
      />
    </>
  );
}

/**
 * The flagstones under everything, well past the table's edges: the far corners of the screen
 * look past its sides. Its maps (floor.ts) are laid on in rem, AREA to a picture, from the
 * table's middle, so they never show twice; it darkens toward its edges (the vertex colours),
 * as the CSS table's vignette does.
 */
function Floor({ w, tableH }: { w: number; tableH: number }) {
  const fw = w * 2.4;
  const fh = tableH * 1.9;
  const tex = useFloorTextures();
  const geometry = useMemo(() => floorGeometry(fw, fh, w, tableH), [fw, fh, w, tableH]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh receiveShadow geometry={geometry} position={[0, tableH / 2, FLOOR_Z]}>
      <meshStandardMaterial
        map={tex.map}
        normalMap={tex.normalMap}
        roughnessMap={tex.roughnessMap}
        roughness={1}
        emissiveMap={tex.emissiveMap}
        emissive="#ffffff"
        emissiveIntensity={0.9}
        vertexColors
      />
    </mesh>
  );
}

/** The floor's plane: `fw` × `fh` about the table's middle, its maps in rem, and its light falling off toward the edges. */
function floorGeometry(fw: number, fh: number, w: number, tableH: number) {
  const geo = new PlaneGeometry(fw, fh, 48, 32);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    // In the table's terms: y up from its bottom edge.
    const y = pos.getY(i) + tableH / 2;
    uv.setXY(i, x / AREA.w, y / AREA.h);
    // Lit from above the middle, darker toward the edges and well past them.
    const d = Math.hypot(x / (w * 0.62), (y - tableH * 0.46) / (tableH * 0.66));
    const k = (1 + 0.15 * (1 - Math.min(1, d / 0.7))) * (1 - 0.8 * MathUtils.smootherstep(d, 0.5, 1.5));
    colors.set([k, k, k], i * 3);
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  return geo;
}

/* The props stand on the table (its z up): built from Three's Y-up primitives, so each is turned by a quarter about x. */

function Tree({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <group position={[x, y, 0]} rotation-x={Math.PI / 2} scale={s}>
      <mesh castShadow position={[0, 5, 0]}>
        <cylinderGeometry args={[0.9, 1.5, 10, 7]} />
        <meshStandardMaterial color="#3a2a1c" roughness={1} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} castShadow position={[0, 11 + i * 6.5, 0]}>
          <coneGeometry args={[9 - i * 2.2, 11 - i * 2, 9]} />
          <meshStandardMaterial color={i % 2 ? '#1f4a2d' : '#27593a'} roughness={0.9} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function Rock({ x, y, s, seed }: { x: number; y: number; s: number; seed: number }) {
  return (
    <mesh castShadow receiveShadow position={[x, y, s * 0.45]} rotation={[seed * 0.7, seed * 1.3, seed * 2.1]} scale={[1.35, 1, 0.75]}>
      <dodecahedronGeometry args={[s, 0]} />
      <meshStandardMaterial color="#454b56" roughness={0.95} flatShading />
    </mesh>
  );
}

/** A stone pillar with a lantern on top: a warm light on the cards near it. */
function Pillar({ x, y }: { x: number; y: number }) {
  return (
    <group position={[x, y, 0]} rotation-x={Math.PI / 2}>
      <mesh castShadow receiveShadow position={[0, 1, 0]}>
        <boxGeometry args={[7, 2, 7]} />
        <meshStandardMaterial color="#5e5a53" roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0, 16, 0]}>
        <cylinderGeometry args={[2.2, 2.6, 28, 10]} />
        <meshStandardMaterial color="#6b665e" roughness={0.85} />
      </mesh>
      <mesh castShadow position={[0, 30.8, 0]}>
        <boxGeometry args={[6.5, 1.8, 6.5]} />
        <meshStandardMaterial color="#5e5a53" roughness={0.9} />
      </mesh>
      <mesh position={[0, 34, 0]}>
        <sphereGeometry args={[1.3, 12, 12]} />
        <meshStandardMaterial color="#ffb25a" emissive="#ffa040" emissiveIntensity={4} />
      </mesh>
      <pointLight position={[0, 35, 0]} color="#ffa64d" intensity={3500} distance={150} decay={2} />
    </group>
  );
}

function Props({ w, tableH }: { w: number; tableH: number }) {
  const side = w / 2;
  return (
    <>
      <Pillar x={-(side - 16)} y={tableH - 4} />
      <Pillar x={side - 16} y={tableH - 4} />
      {/* A wood along the far edge, in the strip past the top seats' rows (their piles hang over it on the screen), and past both sides. */}
      <Tree x={-side * 0.62} y={tableH * 0.96} s={0.9} />
      <Tree x={-side * 0.38} y={tableH * 0.99} s={1.05} />
      <Tree x={-side * 0.1} y={tableH * 0.97} s={0.85} />
      <Tree x={side * 0.18} y={tableH * 0.99} s={1} />
      <Tree x={side * 0.44} y={tableH * 0.96} s={0.95} />
      <Tree x={side * 0.68} y={tableH + 4} s={1.1} />
      <Tree x={-side - 6} y={tableH * 0.55} s={1.2} />
      <Tree x={side + 8} y={tableH * 0.5} s={1.1} />
      <Tree x={-side - 14} y={tableH * 0.85} s={1} />
      <Tree x={side + 16} y={tableH * 0.9} s={1.05} />
      {[0.12, 0.3, 0.52, 0.74, 0.92].map((f, i) => (
        <Rock key={`l${i}`} x={-(side - 5) + (i % 2) * 2} y={tableH * f} s={2.2 + (i % 3)} seed={i + 1} />
      ))}
      {[0.08, 0.26, 0.48, 0.7, 0.88].map((f, i) => (
        <Rock key={`r${i}`} x={side - 5 - (i % 2) * 2} y={tableH * f} s={2 + ((i + 1) % 3)} seed={i + 7} />
      ))}
    </>
  );
}

/* ---------- cards ---------- */

const corner = new Vector3();
const ndc = new Vector2();
const ray = new Raycaster();
const plane = new Plane();
const hit = new Vector3();

/**
 * Keeps `card`'s proxy on the card on the screen: a box the card's size (`w` × `h` rem), laid
 * by a homography onto its top face's four projected corners (`quadMatrix`), so the badges
 * turn and foreshorten with it, and `getBoundingClientRect()` still gives the card's box.
 * Styles are written straight to the element, off React, and only when they change.
 */
function useProxy(id: string, group: RefObject<Group | null>, w: number, h: number) {
  const { camera, gl } = useThree();
  const last = useRef('');
  /** `time`: the frame's clock, so the page is measured once a frame for all the proxies. */
  return (time: number) => {
    const el = proxies.get(id);
    const o = group.current;
    if (!el || !o) return;
    if (page.at !== time) {
      page.at = time;
      const c = gl.domElement.getBoundingClientRect();
      const box = el.parentElement?.getBoundingClientRect() ?? c;
      page.x = c.left - box.left;
      page.y = c.top - box.top;
      page.w = c.width;
      page.h = c.height;
      page.rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    }
    o.updateMatrixWorld();
    CORNERS.forEach(([sx, sy], i) => {
      corner.set((sx * w) / 2, (sy * h) / 2, CARD_THICKNESS / 2);
      o.localToWorld(corner).project(camera);
      quad[i][0] = page.x + ((corner.x + 1) / 2) * page.w;
      quad[i][1] = page.y + ((1 - corner.y) / 2) * page.h;
    });
    // The box is the card's own size on the table, so its badges are sized as the CSS tiles'
    // are; the matrix lays it onto the card on the screen.
    const bw = w * page.rem;
    const bh = h * page.rem;
    // Its perspective terms are tiny (the table is seen from far off), so they keep more places.
    const matrix = quadMatrix(bw, bh, quad)
      .map((v, i) => v.toFixed(i === 3 || i === 7 ? 10 : 4))
      .join(',');
    const key = `${bw.toFixed(2)} ${bh.toFixed(2)} ${matrix}`;
    if (key === last.current) return;
    last.current = key;
    el.style.width = `${bw.toFixed(2)}px`;
    el.style.height = `${bh.toFixed(2)}px`;
    el.style.fontSize = `${(bw / 10).toFixed(2)}px`;
    el.style.transform = `matrix3d(${matrix})`;
  };
}

/** The proxies' container and the canvas, measured once a frame (`useProxy`). */
const page = { at: -1, x: 0, y: 0, w: 0, h: 0, rem: 16 };
/** A card's corners in its own terms, as the proxy's box has them: top-left, top-right, bottom-right, bottom-left (its y is up the table). */
const CORNERS = [
  [-1, 1],
  [1, 1],
  [1, -1],
  [-1, -1],
] as const;
const quad: [number, number][] = CORNERS.map(() => [0, 0]);

/** The point `lift` above the table under the screen point (`sx`, `sy`, px), in the table's coordinates. */
function onTable(table: Group, camera: PerspectiveCamera, canvas: HTMLCanvasElement, sx: number, sy: number, lift: number) {
  const rect = canvas.getBoundingClientRect();
  ndc.set(((sx - rect.left) / rect.width) * 2 - 1, -((sy - rect.top) / rect.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  table.updateMatrixWorld();
  const normal = new Vector3(0, 0, 1).transformDirection(table.matrixWorld);
  plane.setFromNormalAndCoplanarPoint(normal, table.localToWorld(new Vector3(0, 0, lift)));
  if (!ray.ray.intersectPlane(plane, hit)) return null;
  return table.worldToLocal(hit);
}

/** The six faces of a card's box: edges, then the face on top (+z) and the back underneath (-z). */
function CardMaterials({ face, back, d, tapped, phased }: { face: Texture | null; back: Texture; d: ReturnType<typeof data>; tapped: boolean; phased: boolean }) {
  const tint = tapped ? '#8f8f8f' : '#ffffff';
  const opacity = phased ? 0.35 : 1;
  const edge = { color: tapped ? '#8d877a' : '#ded6c2', roughness: 0.8, transparent: phased, opacity };
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <meshStandardMaterial key={i} attach={`material-${i}`} {...edge} />
      ))}
      {/* Keyed on having the image: a material made without a map can't be given one later without rebuilding its shader. */}
      {face ? (
        <meshStandardMaterial key="face" attach="material-4" map={face} color={tint} roughness={0.55} metalness={0} transparent={phased} opacity={opacity} />
      ) : (
        // No image yet (or none loads): the frame's colour, with the proxy's badges over it.
        <meshStandardMaterial key="plain" attach="material-4" color={FRAME[frameOf(d)] ?? FRAME.artifact} roughness={0.7} transparent={phased} opacity={opacity} />
      )}
      <meshStandardMaterial attach="material-5" map={back} roughness={0.6} transparent={phased} opacity={opacity} />
    </>
  );
}

/** The frame colours (`--f-*` in styles.css). */
const FRAME: Record<string, string> = { W: '#e3d9ae', U: '#4a90d2', B: '#8a6cc4', R: '#e0553a', G: '#4fae62', gold: '#d2aa42', artifact: '#93a0af', land: '#8a765c' };

/**
 * One permanent on the table: its box, its glow, and the Auras and Equipment attached to it
 * fanned out behind it. It eases to its place (`pose`) when the layout moves it, turns when
 * tapped, lifts toward the middle while attacking or blocking, and flies in from where it was
 * on the screen when it reaches the table (`origins`).
 */
function Card3D({ pose, seat, phased }: { pose: Pose<Card>; seat: Seat; phased: boolean }) {
  const { v, speed, table } = useScene();
  const g = v.g;
  const card = pose.item;
  const d = data(card);
  const face = useCardTexture(faceUp(card, v.me) ? d.image : null);
  const back = backTexture();
  const glow = v.glow.get(card.id);
  const attacking = g.combat?.attacks.some((a) => a.id === card.id) ?? false;
  const blocking = g.combat?.attacks.some((a) => a.blockers.includes(card.id)) ?? false;
  // Toward the middle of the table: up it for the bottom seats, down it for the top ones.
  const inward = seat.v === 'bottom' ? 1 : -1;
  const lift = attacking ? 2.5 : blocking ? 1.2 : 0;
  const attached = attachmentsOf(g, card);
  // Resting: on the card under it in its pile, or on its Auras and Equipment, which lie under it on the floor.
  const rest = CARD_THICKNESS / 2 + (pose.stack + attached.length) * CARD_THICKNESS;
  const target = {
    x: pose.x,
    y: pose.y + inward * lift,
    z: rest + (lift ? 0.6 : 0),
    rz: pose.turn - (card.tapped ? TAPPED_RAD : 0),
  };
  const group = useRef<Group>(null);
  const glowRef = useRef<Mesh>(null);
  const shadowRef = useRef<Mesh>(null);
  const { camera, gl } = useThree();
  const flight = useRef<{ started: boolean; landed: boolean }>({ started: false, landed: false });
  const updateProxy = useProxy(card.id, group, pose.w, pose.h);
  // Only a pile's bottom card lies on the floor; the ones over it shadow it through the moon.
  const grounded = pose.stack === 0;

  useFrame((state, dt) => {
    const o = group.current;
    if (!o) return;
    if (!flight.current.started) {
      // The first frame: start from where the card was on the screen, or pop up as a token does, or just be there.
      flight.current.started = true;
      const from = origins.get(card.id);
      origins.delete(card.id);
      const fresh = from && performance.now() - from.at < 2500;
      if (from && fresh && !from.pop && table.current) {
        const at = onTable(table.current, camera as PerspectiveCamera, gl.domElement, from.x, from.y, 6);
        if (at) {
          o.position.copy(at);
          const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
          o.scale.setScalar(Math.max(0.3, from.w / rem / pose.w));
        }
      } else if (from?.pop) {
        o.position.set(target.x, target.y, target.z + 4);
        o.scale.setScalar(0.3);
      } else {
        o.position.set(target.x, target.y, target.z);
        flight.current.landed = true;
      }
      o.rotation.z = target.rz;
    }
    const l = 9 * Math.sqrt(speed);
    o.position.x = MathUtils.damp(o.position.x, target.x, l, dt);
    o.position.y = MathUtils.damp(o.position.y, target.y, l, dt);
    o.position.z = MathUtils.damp(o.position.z, target.z, l, dt);
    o.rotation.z = MathUtils.damp(o.rotation.z, target.rz, l, dt);
    const s = MathUtils.damp(o.scale.x, 1, l, dt);
    o.scale.setScalar(s);
    if (!flight.current.landed && Math.abs(o.position.x - target.x) + Math.abs(o.position.y - target.y) + Math.abs(o.position.z - target.z) < 0.3 && Math.abs(s - 1) < 0.03) {
      flight.current.landed = true;
    }
    // Landed, the proxy stands for the card on the screen (Flights.tsx, the arrows, `cardAt`).
    const el = proxies.get(card.id);
    if (el && flight.current.landed && el.dataset.card !== card.id) el.dataset.card = card.id;
    if (glowRef.current && glow === 'target') {
      const k = 1 + 0.04 * Math.sin(state.clock.elapsedTime * 6);
      glowRef.current.scale.set(k, k, 1);
    }
    // The soft shadow stays on the floor under the card, spreading and fading as the card rises
    // (attacking, blocking, flying in), so a card resting on the stone reads as resting.
    const sh = shadowRef.current;
    if (sh) {
      const rise = Math.max(0, o.position.z - rest);
      sh.position.z = (SHADOW_Z - o.position.z) / s;
      sh.scale.setScalar(1 + rise * 0.06);
      (sh.material as MeshBasicMaterial).opacity = SHADOW_OPACITY * (phased ? 0.4 : 1) * Math.max(0.25, 1 - rise / 4);
    }
    updateProxy(state.clock.elapsedTime);
  });

  const hover = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const el = proxies.get(card.id);
    if (el) useStore.setState({ hover: { name: d.name, d, el, ...(card.textless && { textless: true }) } });
  };
  const unhover = () => {
    const h = useStore.getState().hover;
    if (h && h.el === proxies.get(card.id)) useStore.setState({ hover: null });
  };
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!phased) clickPermanent(card);
  };

  return (
    <group ref={group}>
      <mesh castShadow receiveShadow onPointerOver={hover} onPointerOut={unhover} onClick={click}>
        <boxGeometry args={[pose.w, pose.h, CARD_THICKNESS]} />
        <CardMaterials face={face} back={back} d={d} tapped={card.tapped} phased={phased} />
      </mesh>
      {grounded && (
        <mesh ref={shadowRef} renderOrder={-1} raycast={() => null}>
          <planeGeometry args={[pose.w * (1 + 2 * SHADOW_SPREAD), pose.h + 2 * SHADOW_SPREAD * pose.w]} />
          <meshBasicMaterial map={shadowTexture()} color="#000000" transparent opacity={SHADOW_OPACITY} depthWrite={false} />
        </mesh>
      )}
      {glow && (
        <mesh ref={glowRef} position={[0, 0, -CARD_THICKNESS / 2 + GLOW_Z]} raycast={() => null}>
          <planeGeometry args={[pose.w * 1.16, pose.h * 1.12]} />
          <meshBasicMaterial color={GLOW[glow]} transparent opacity={0.9} toneMapped={false} />
        </mesh>
      )}
      {attached.map((a, i) => (
        <Attached key={a.id} card={a} host={pose} index={i} inward={inward} />
      ))}
    </group>
  );
}

/** An Aura or Equipment attached to a permanent (303.4b, 301.5a): a card behind it, slid out toward the middle so its top shows; hover to read it, click to use it. */
function Attached({ card, host, index, inward }: { card: Card; host: Pose<Card>; index: number; inward: number }) {
  const { v } = useScene();
  const d = data(card);
  const face = useCardTexture(faceUp(card, v.me) ? d.image : null);
  const group = useRef<Group>(null);
  const updateProxy = useProxy(card.id, group, host.w, host.h);
  useFrame((state) => {
    const el = proxies.get(card.id);
    if (el && el.dataset.card !== card.id) el.dataset.card = card.id;
    updateProxy(state.clock.elapsedTime);
  });
  const glow = v.glow.get(card.id);
  return (
    <group ref={group} position={[0, inward * 1.6 * (index + 1), -(index + 1) * CARD_THICKNESS]}>
      <mesh
        castShadow
        onPointerOver={(e) => {
          e.stopPropagation();
          const el = proxies.get(card.id);
          if (el) useStore.setState({ hover: { name: d.name, d, el } });
        }}
        onPointerOut={() => {
          const h = useStore.getState().hover;
          if (h && h.el === proxies.get(card.id)) useStore.setState({ hover: null });
        }}
        onClick={(e) => {
          e.stopPropagation();
          clickPermanent(card);
        }}
      >
        <boxGeometry args={[host.w, host.h, CARD_THICKNESS]} />
        <CardMaterials face={face} back={backTexture()} d={d} tapped={card.tapped} phased={false} />
      </mesh>
      {glow && (
        <mesh position={[0, 0, -CARD_THICKNESS / 2 + GLOW_Z]} raycast={() => null}>
          <planeGeometry args={[host.w * 1.16, host.h * 1.12]} />
          <meshBasicMaterial color={GLOW[glow]} transparent opacity={0.9} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}
