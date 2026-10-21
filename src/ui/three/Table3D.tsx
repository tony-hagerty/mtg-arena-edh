import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { GLProps, ThreeEvent } from '@react-three/fiber';
import { BufferAttribute, Color, Group, MathUtils, Matrix4, Mesh, MeshBasicMaterial, OrthographicCamera, Plane, PlaneGeometry, Raycaster, Vector2, Vector3 } from 'three';
import type { BufferGeometry, DirectionalLight, PerspectiveCamera, Texture, WebGLRenderer } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { attachmentsOf, data, defenseOf, isBattle, isCreature, isPlaneswalker, loyaltyOf, stats } from '../../engine';
import type { Card, Game, Player } from '../../engine';
import { FaceUpPile, Library, creaturePiles, landPiles, otherPermanents } from '../Board';
import { DEPTH, TILT, useStageSize, useTableSize } from '../camera';
import { Counters, TextlessBadge } from '../Card';
import { useStore } from '../store';
import { frameOf } from '../TextCard';
import { cx, faceUp, seatOf } from '../util';
import type { Seat } from '../util';
import { ViewContext, clickGroup, clickPermanent, useView } from '../view';
import type { View } from '../view';
import { newGame, zoneMoves } from '../zone-moves';
import type { Place } from '../zone-moves';
import { AREA } from './floor';
import { Garden, WATER_Z } from './Garden';
import { Hall } from './Hall';
import type { Floating } from './Garden';
import { burst } from './effects';
import { gardenPlan, seatArea } from './board';
import type { Garden as GardenPlan, HandSpot, PileSpot } from './board';
import { CORNER, cardGeometry, roundedPlane } from './geometry';
import { CARD_THICKNESS, HELD_LEAN, LIFT_RAD, baseCamera, heldFan, layoutSeat, quadMatrix, tiltRad } from './layout3d';
import type { Pose, Row } from './layout3d';
import { SHADOW_SPREAD, backTexture, shadowTexture, tileTexture, useCardTexture, useFloorTextures } from './textures';

/*
  The table, drawn in 3D (docs/plans/flutter-conversion.md says how it came about), for a
  browser that can draw it (`CAN_DRAW_3D` in camera.ts). It is the table in GameScreen and
  nothing else: the portraits, your hand, the HUD and the pickers stay on the screen, over
  the canvas, and the engine, the store and view.ts know nothing of it.

  The scene is Three.js through React Three Fiber, drawn with Three's WebGPU renderer, which
  falls back to WebGL 2 where the browser has no WebGPU (`?gl=webgl` forces that). The
  camera starts where camera.ts puts the viewer (`baseCamera`), so the seats' rows land where
  board.ts lays them, and moves from there: a slow push in while combat is on.

  The cards are slabs with rounded corners (geometry.ts), thick enough that their edge shows,
  the card's art and name on top and a drawn back underneath, each tipped up a little about
  its bottom edge (`LIFT_RAD`), lit and casting shadows on the board (Garden.tsx: four mats on
  a flagstone floor, floor.ts, around a well), each with a soft dark under it where it rests,
  in a torch-lit stone hall (Hall.tsx). Each seat's library and graveyard lie on the table too
  (`Pile3D`), and each opponent holds their hand fanned at the back of their mat (`HeldHand`).
  Their hover, click and glow come from raycasting on the meshes and go to view.ts's
  handlers, as a hand card's do.

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

const BG = '#06070a';
/** How far a tapped card is turned (rad): 8°. */
const TAPPED_RAD = (8 * Math.PI) / 180;
/** The highlight colours (`--play`, `--target`, `--danger` in styles.css). */
const GLOW: Record<string, string> = { play: '#39e3ff', attack: '#39e3ff', block: '#39e3ff', target: '#ffe45c', picked: '#ffffff', discard: '#ff5a4a' };

/*
  What lies just under the cards, in the table's z (up off it), apart enough not to fight over
  depth: the floor, the garden's sand (SAND_Z, Garden.tsx), a card's soft shadow on it, and
  the card's underside at 0 (CARD_THICKNESS / 2 under the middle of the lowest card). A card's
  glow is a ring round its face, GLOW_DROP under the face.
*/
const FLOOR_Z = -0.12;
const SHADOW_Z = -0.04;
/**
 * How far a card's glow lies under its face, rem: just enough that the face covers it. Any
 * lower, and the card's thickness hides more of the ring on its far side than on its near one,
 * since the table is seen at an angle.
 */
const GLOW_DROP = 0.02;
/** How far a card's glow reaches past its edge, as a share of its width: the same all round. */
const GLOW_REACH = 0.04;
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
  /** Where the library and graveyard lie (`seatArea`). */
  zones: Record<PileZone, PileSpot>;
  /** Where the hand is held, for an opponent's seat (`seatArea`); the bottom seat's hand is on the screen (`PlayerHand`). */
  hand: HandSpot | null;
}

/**
 * The piles each seat has on the 3D table. Exile is not one: it is shared (400.1), the well
 * in the middle (Garden.tsx), with every player's exiled cards in it.
 */
type PileZone = 'library' | 'graveyard';
const ZONES: PileZone[] = ['library', 'graveyard'];
/** The well's proxy, in the proxies' map: the exile's stand-in on the screen. */
const EXILE_KEY = 'exile';
/** A zone's proxy, in the proxies' map. */
const zoneKey = (pid: number, zone: PileZone) => `zone:${pid}:${zone}`;

/** The whole seats' layout for this game, from the piles Board.tsx groups: each seat's rows and piles on its mat (`seatArea`). */
function layoutSeats(v: View, players: Player[], plan: GardenPlan, stageW: number, stageH: number, tableH: number): SeatLayout[] {
  const g = v.g;
  // The player at the bottom holds their hand on the screen (GameScreen's `bottom`).
  const bottom = players[0];
  return players.map((p) => {
    const seat = seatOf(g, v.me, p.id);
    const area = seatArea(seat, plan, stageW, stageH, stageW, tableH);
    const box = area.box;
    const { others, phased } = otherPermanents(g, p);
    const rows: Row<Card>[] = [
      { kind: 'other', piles: landPiles(g, p) },
      { kind: 'other', piles: [...others, ...phased].map((c) => [c]) },
      { kind: 'creature', piles: creaturePiles(v, p) },
    ];
    const piles = new Map(rows.flatMap((r) => r.piles.filter((pile) => pile.length > 1).map((pile) => [pile[pile.length - 1].id, pile] as const)));
    return { player: p, seat, poses: layoutSeat(seat, box, rows, stageW, tableH), phased: new Set(phased.map((c) => c.id)), piles, zones: area.piles, hand: p === bottom ? null : area.hand };
  });
}

/** The 3D table in place of `.table`: the canvas, and the proxies over it. */
export default function Table3D({ players }: { players: Player[] }) {
  const v = useView();
  const stage = useStageSize();
  const table = useTableSize();
  const speed = useStore((s) => s.speed);
  // Laid out again only when the size changes by a rem or more, so a resize doesn't redraw the
  // mats every frame, or when the seats do (a mat for each, `gardenPlan`).
  const seatsKey = players.map((p) => JSON.stringify(seatOf(v.g, v.me, p.id))).join();
  const size = `${Math.round(stage.w)}x${Math.round(stage.h)}x${Math.round(table.h)}|${seatsKey}`;
  const plan = useMemo(
    () => gardenPlan(stage.w, stage.h, stage.w, table.h, players.map((p) => seatOf(v.g, v.me, p.id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [size],
  );
  const seats = layoutSeats(v, players, plan, stage.w, stage.h, table.h);
  useEffect(() => useStore.subscribe((s, old) => captureOrigins(s.game, old.game)), []);
  return (
    <div className="table3d">
      <Canvas gl={makeRenderer} shadows={!LOW} dpr={LOW ? 1 : [1, 2]} camera={{ manual: true, position: [0, 0, DEPTH], near: 5, far: 2500 }}>
        <Scene v={v} speed={speed} w={stage.w} h={stage.h} tableH={table.h} seats={seats} plan={plan} players={players} />
      </Canvas>
      <div className="card-proxies">
        {seats.flatMap((s) =>
          s.poses.flatMap((p) => [
            <CardProxy key={p.item.id} card={p.item} g={v.g} pile={s.piles.get(p.item.id)} covered={p.stack < p.pile - 1} />,
            ...attachmentsOf(v.g, p.item).map((a) => <CardProxy key={a.id} card={a} g={v.g} />),
          ]),
        )}
        {seats.flatMap((s) =>
          ZONES.map((zone) => (
            <ZoneProxy key={zoneKey(s.player.id, zone)} id={zoneKey(s.player.id, zone)}>
              {zone === 'library' ? <Library player={s.player} /> : <FaceUpPile player={s.player} zone={zone} />}
            </ZoneProxy>
          )),
        )}
        <ExileProxy players={players} />
        {seats.map((s) => s.hand && <HandProxy key={handKey(s.player.id)} player={s.player} />)}
      </div>
    </div>
  );
}

/**
 * A card's stand-in on the screen (see the note at the top): kept over the card by `useProxy`,
 * carrying its badges. `pile`: it is the top of a pile, whose badge uses them all at once.
 * `covered`: another card of its pile lies on it, so it shows no tap symbol (the top one does).
 */
function CardProxy({ card, g, pile, covered = false }: { card: Card; g: Game; pile?: Card[]; covered?: boolean }) {
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
      {/* The 3D card already dims when tapped; the proxy adds only the symbol. */}
      {card.tapped && !covered && <i className="tap-symbol ms ms-tap" />}
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

/**
 * A library, graveyard or exile pile's stand-in: the DOM pile (Board.tsx), kept
 * over the 3D pile's top on the screen like a card's proxy. The 3D pile is what shows; the
 * DOM one keeps its zone's icon, its count, its outline while empty, and everything that
 * finds or uses a pile by its element: the click that opens the zone, the hover on the top
 * card, and the flights to and from it.
 */
function ZoneProxy({ id, children }: { id: string; children: ReactNode }) {
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) proxies.set(id, el);
      else proxies.delete(id);
    },
    [id],
  );
  return (
    <div ref={ref} className="card-proxy zone-proxy">
      {children}
    </div>
  );
}

/** An opponent's hand's proxy, in the proxies' map. */
const handKey = (pid: number) => `hand:${pid}`;

/**
 * An opponent's hand's stand-in on the screen, kept over the middle card of the fan they hold
 * (`HeldHand`): where cards going to their hand fly to and leave it from (`data-hand-of`,
 * Flights.tsx), and the hand's count, on the fan's foot.
 */
function HandProxy({ player }: { player: Player }) {
  const id = handKey(player.id);
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) proxies.set(id, el);
      else proxies.delete(id);
    },
    [id],
  );
  return (
    <div ref={ref} className="card-proxy hand-proxy" data-hand-of={player.id}>
      <span className="count" title={`${player.hand.length} cards in hand`}>
        {player.hand.length}
      </span>
    </div>
  );
}

/** Opens the exile: everyone's exiled cards, by owner (`ZoneViewer`). */
const openExile = () => useStore.setState({ viewer: { pid: null, zone: 'exile' }, hover: null });

/**
 * The exile's stand-in on the screen, kept over the well like a pile's (`ExileAnchor`): a
 * round the well's size carrying the count and the exile's mark, glowing when something in
 * exile can be cast. It takes no pointer events (the well takes the clicks), and holds one
 * spot per player for the flights to and from their exiled cards (`[data-pile]`).
 */
function ExileProxy({ players }: { players: Player[] }) {
  const { glow } = useView();
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (el) proxies.set(EXILE_KEY, el);
    else proxies.delete(EXILE_KEY);
  }, []);
  const total = players.reduce((n, p) => n + p.exile.length, 0);
  const castable = players.some((p) => p.exile.some((c) => glow.get(c.id) === 'play'));
  return (
    <div ref={ref} className="card-proxy exile-proxy">
      <div className={cx('exile-pool', castable && 'glow-play')}>
        {players.map((p) => (
          <div key={p.id} className="exile-spot" data-pile={`${p.id}-exile`} />
        ))}
        <div className="exile-badge" title={`Exile: ${total} cards — right-click the well to view`}>
          <i className="ms ms-exile" />
          {total}
        </div>
      </div>
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

function Scene({ v, speed, w, h, tableH, seats, plan, players }: { v: View; speed: number; w: number; h: number; tableH: number; seats: SeatLayout[]; plan: GardenPlan; players: Player[] }) {
  const table = useRef<Group>(null);
  const state = useMemo(() => ({ v, speed, table }), [v, speed]);
  // The top of each player's exile circles in the well; one exiled face down shows its back (406.3).
  const exiled: Floating[] = players.flatMap((p) => {
    const top = p.exile[p.exile.length - 1];
    return top ? [{ id: top.id, image: faceUp(top, v.me) ? data(top).image : null }] : [];
  });
  return (
    <SceneCtx.Provider value={state}>
      {/* The view for anything inside that asks for it, as the DOM side has it. */}
      <ViewContext.Provider value={v}>
        <color attach="background" args={[BG]} />
        {/* Only what lies well past the table fades: the near edge is DEPTH away, the far one about twice that. */}
        <fog attach="fog" args={[BG, DEPTH * 2.6, DEPTH * 5]} />
        <Rig w={w} h={h} combat={inCombat(v.g)} />
        <Lights w={w} tableH={tableH} />
        {/* The table leans away from you by TILT about its bottom edge, as camera.ts has it. Its own z is up off the table. */}
        <group ref={table} rotation-x={-tiltRad(TILT)}>
          <Floor w={w} tableH={tableH} />
          <Garden plan={plan} exiled={exiled} onExile={openExile} />
          <ExileAnchor plan={plan} />
          <Hall w={w} tableH={tableH} cross={plan.pond.y} />
          {seats.map((s) => s.poses.map((p) => <Card3D key={p.item.id} pose={p} seat={s.seat} phased={s.phased.has(p.item.id)} />))}
          {seats.flatMap((s) => ZONES.map((zone) => <Pile3D key={zoneKey(s.player.id, zone)} player={s.player} zone={zone} spot={s.zones[zone]} />))}
          {seats.map((s) => s.hand && <HeldHand key={handKey(s.player.id)} player={s.player} spot={s.hand} library={s.zones.library} far={s.seat.v === 'top'} />)}
        </group>
      </ViewContext.Provider>
    </SceneCtx.Provider>
  );
}

/**
 * The camera: camera.ts's viewer to start with (`baseCamera`), so the rows fall where the
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
    camera.position.set(0, 0, DEPTH * (1 - 0.067 * k));
    camera.rotation.set(0.013 * k, 0, 0);
  });
  return null;
}

/** Where the light from above comes from, in the world: high, beyond the far edge and to the left, as from a shaft in the hall's roof. */
const OVERHEAD = new Vector3(-170, 240, 200);

/**
 * The overhead light's shadow camera fitted to the table and what stands on it: the box, in the light's
 * own view, around the table (with a margin for the props past its sides and far edge) from
 * the floor up to the treetops. The tighter it is, the more shadow map each card gets: a card
 * is CARD_THICKNESS (0.3 rem) thick, so its shadow is a sliver that a loose box blurs away.
 */
function overheadShadowBox(w: number, tableH: number) {
  // A camera, not a plain object: lookAt turns a camera's -z to the target, as the shadow camera's is.
  const view = new OrthographicCamera();
  view.position.copy(OVERHEAD);
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
  const box = useMemo(() => overheadShadowBox(w, tableH), [w, tableH]);
  const overhead = useRef<DirectionalLight>(null);
  // Three reads the shadow camera's bounds only when it first sets the shadow up: a new size needs telling.
  useEffect(() => overhead.current?.shadow.camera.updateProjectionMatrix(), [box]);
  return (
    <>
      {/* A dim, cool fill: the hall is lit by the torches (Hall.tsx) and the light from above. */}
      <hemisphereLight args={['#8a98bb', '#1c1610', 0.7]} />
      {/*
        The light from above, cool and dim: the one light that casts shadows, over the whole table. The biases are small
        next to a card's thickness (0.3): bigger, and the shadow comes loose from the card
        that casts it (peter-panning), so the card seems to float.
      */}
      <directionalLight
        ref={overhead}
        position={OVERHEAD}
        intensity={1.9}
        color="#d6defa"
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

/** Keeps the exile's proxy (`ExileProxy`) on the well's water. */
function ExileAnchor({ plan }: { plan: GardenPlan }) {
  const group = useRef<Group>(null);
  const d = plan.pond.r * 2;
  const updateProxy = useProxy(EXILE_KEY, group, d, d, WATER_Z);
  useFrame((state) => updateProxy(state.clock.elapsedTime));
  return <group ref={group} position={[plan.pond.x, plan.pond.y, 0]} />;
}

/**
 * The flagstones under everything, well past the table's edges: the far corners of the screen
 * look past its sides. Its maps (floor.ts) are laid on in rem, AREA to a picture, from the
 * table's middle, so they never show twice; it darkens toward its edges (the vertex colours),
 * as a vignette does.
 */
function Floor({ w, tableH }: { w: number; tableH: number }) {
  const fw = w * 2.4;
  const fh = tableH * 1.9;
  const tex = useFloorTextures();
  const geometry = useMemo(() => floorGeometry(fw, fh, w, tableH), [fw, fh, w, tableH]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const { table } = useScene();
  // A click on the paths kicks up a little dust (effects.tsx).
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const p = table.current!.worldToLocal(e.point.clone());
    burst('path', p.x, p.y, FLOOR_Z);
  };
  return (
    <mesh receiveShadow geometry={geometry} position={[0, tableH / 2, FLOOR_Z]} onClick={click}>
      <meshStandardMaterial
        map={tex.map}
        normalMap={tex.normalMap}
        roughnessMap={tex.roughnessMap}
        roughness={1}
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

/* ---------- cards ---------- */

const corner = new Vector3();
const ndc = new Vector2();
const ray = new Raycaster();
const plane = new Plane();
const hit = new Vector3();

/**
 * Keeps `card`'s proxy on the card on the screen: a box the card's size (`w` × `h` rem), laid
 * by a homography onto its top face's four projected corners (`quadMatrix`; the face is `z` up
 * from the group's origin), so the badges
 * turn and foreshorten with it, and `getBoundingClientRect()` still gives the card's box.
 * Styles are written straight to the element, off React, and only when they change.
 */
function useProxy(id: string, group: RefObject<Group | null>, w: number, h: number, z = CARD_THICKNESS / 2) {
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
      corner.set((sx * w) / 2, (sy * h) / 2, z);
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
    // A pile's own size (`.pile`), for a zone's proxy.
    el.style.setProperty('--pile-w', `${bw.toFixed(2)}px`);
    // How much the matrix shrinks the box on the screen, along its top edge, undone by the
    // badges that should read the same size near and far (a pile's or hand's count, `--unscale`).
    const shown = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]);
    el.style.setProperty('--unscale', (bw / Math.max(1, shown)).toFixed(3));
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

/** A card's three materials (`cardGeometry`): its edge, the face on top (+z) and the back underneath (-z). */
function CardMaterials({ face, back, d, tapped, phased }: { face: Texture | null; back: Texture; d: ReturnType<typeof data>; tapped: boolean; phased: boolean }) {
  const tint = tapped ? '#8f8f8f' : '#ffffff';
  const opacity = phased ? 0.35 : 1;
  // The edge is the frame's colour, darkened, as a solid tile's sides would be: it shows how thick the card is.
  const edge = useMemo(() => new Color(FRAME[frameOf(d)] ?? FRAME.artifact).multiplyScalar(tapped ? 0.2 : 0.32), [d, tapped]);
  return (
    <>
      <meshStandardMaterial attach="material-0" color={edge} roughness={0.75} transparent={phased} opacity={opacity} />
      {/* Keyed on having the image: a material made without a map can't be given one later without rebuilding its shader. */}
      {face ? (
        // Lit partly by itself (`FACE_GLOW`), so the card reads in the hall's dim corners; less so tapped, so a tapped card stays dimmed.
        <meshStandardMaterial key="face" attach="material-1" map={face} color={tint} roughness={0.7} metalness={0} emissiveMap={face} emissive="#ffffff" emissiveIntensity={tapped ? FACE_GLOW * 0.55 : FACE_GLOW} transparent={phased} opacity={opacity} />
      ) : (
        // No image yet (or none loads): the frame's colour, with the proxy's badges over it.
        <meshStandardMaterial key="plain" attach="material-1" color={FRAME[frameOf(d)] ?? FRAME.artifact} roughness={0.7} transparent={phased} opacity={opacity} />
      )}
      <meshStandardMaterial attach="material-2" map={back} roughness={0.6} transparent={phased} opacity={opacity} />
    </>
  );
}

/** A card's shape at `w` × `h` (`cardGeometry`), and its glow's, made once per size and freed after. */
function useCardShapes(w: number, h: number) {
  const shapes = useMemo(() => {
    const m = w * GLOW_REACH;
    return { card: cardGeometry(w, h, CARD_THICKNESS), glow: roundedPlane(w + 2 * m, h + 2 * m, w * CORNER + m) };
  }, [w, h]);
  useEffect(
    () => () => {
      shapes.card.dispose();
      shapes.glow.dispose();
    },
    [shapes],
  );
  return shapes;
}

/**
 * How much a card's face lights itself, as a share of its own colours: the hall is dim and
 * its light uneven (torches at the sides), so without this a card in a dark corner is hard to
 * read. Arena's cards read the same wherever they lie; this gets most of the way there while
 * the scene's light still shades them a little.
 */
const FACE_GLOW = 0.55;

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
  // Its art and name (a tile); the full card is the hover's.
  const face = faceUp(card, v.me) ? tileTexture(d.name, d.art, FRAME[frameOf(d)] ?? FRAME.artifact) : null;
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
    rz: card.tapped ? -TAPPED_RAD : 0,
  };
  const group = useRef<Group>(null);
  /** The card tipped up about its bottom edge (`LIFT_RAD`), inside `group`: what the proxy follows. */
  const tipped = useRef<Group>(null);
  const glowRef = useRef<Mesh>(null);
  const shadowRef = useRef<Mesh>(null);
  const { camera, gl } = useThree();
  const flight = useRef<{ started: boolean; landed: boolean }>({ started: false, landed: false });
  const updateProxy = useProxy(card.id, tipped, pose.w, pose.h);
  const shapes = useCardShapes(pose.w, pose.h);
  // Only a pile's bottom card lies on the floor; the ones over it shadow it through the light from above.
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
      {/* Tipped about its bottom edge, which stays where it lay: the middle rises by half the card's height times the lift. */}
      <group ref={tipped} rotation-x={LIFT_RAD} position={[0, -(pose.h / 2) * (1 - Math.cos(LIFT_RAD)), (pose.h / 2) * Math.sin(LIFT_RAD)]}>
        <mesh castShadow receiveShadow geometry={shapes.card} onPointerOver={hover} onPointerOut={unhover} onClick={click}>
          <CardMaterials face={face} back={back} d={d} tapped={card.tapped} phased={phased} />
        </mesh>
        {glow && (
          <mesh ref={glowRef} geometry={shapes.glow} position={[0, 0, CARD_THICKNESS / 2 - GLOW_DROP]} raycast={() => null}>
            <meshBasicMaterial color={GLOW[glow]} transparent opacity={0.9} toneMapped={false} />
          </mesh>
        )}
        {attached.map((a, i) => (
          <Attached key={a.id} card={a} host={pose} index={i} inward={inward} />
        ))}
      </group>
      {grounded && (
        <mesh ref={shadowRef} renderOrder={-1} raycast={() => null}>
          <planeGeometry args={[pose.w * (1 + 2 * SHADOW_SPREAD), pose.h + 2 * SHADOW_SPREAD * pose.w]} />
          <meshBasicMaterial map={shadowTexture()} color="#000000" transparent opacity={SHADOW_OPACITY} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/** An Aura or Equipment attached to a permanent (303.4b, 301.5a): a card behind it, slid out toward the middle so its top shows; hover to read it, click to use it. */
function Attached({ card, host, index, inward }: { card: Card; host: Pose<Card>; index: number; inward: number }) {
  const { v } = useScene();
  const d = data(card);
  const face = faceUp(card, v.me) ? tileTexture(d.name, d.art, FRAME[frameOf(d)] ?? FRAME.artifact) : null;
  const group = useRef<Group>(null);
  const updateProxy = useProxy(card.id, group, host.w, host.h);
  const shapes = useCardShapes(host.w, host.h);
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
        geometry={shapes.card}
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
        <CardMaterials face={face} back={backTexture()} d={d} tapped={card.tapped} phased={false} />
      </mesh>
      {glow && (
        <mesh geometry={shapes.glow} position={[0, 0, CARD_THICKNESS / 2 - GLOW_DROP]} raycast={() => null}>
          <meshBasicMaterial color={GLOW[glow]} transparent opacity={0.9} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

/** How thick a card in a pile is drawn, in rem: thinner than a card on the table, so a 99-card library stands 3.5 rem. */
const PILE_CARD = 0.035;

/** A pile's look: its top's tint and its edges'. The graveyard is worn and browned, exile washed out and pale blue, as the CSS piles are. */
const PILE_LOOK: Record<PileZone, { tint: string; edge: string }> = {
  library: { tint: '#ffffff', edge: '#2d333e' },
  graveyard: { tint: '#c9b79a', edge: '#4a3d2e' },
};

/**
 * A library, graveyard or exile lying on the table at `spot`: a block as thick as the pile,
 * its top the library's back or the top card's face, with the soft shadow a card has. Its
 * proxy (`ZoneProxy`) is kept on its top. Nothing is drawn while it is empty: the proxy's
 * outline marks the place.
 */
function Pile3D({ player, zone, spot }: { player: Player; zone: PileZone; spot: PileSpot }) {
  const { v } = useScene();
  const cards = player[zone];
  const n = cards.length;
  const top = cards[n - 1];
  const thick = n ? Math.max(CARD_THICKNESS, n * PILE_CARD) : 0;
  const up = zone !== 'library' && top && faceUp(top, v.me);
  const face = useCardTexture(up ? data(top).image : null);
  const back = backTexture();
  // One card's shape, a rem thick, stretched to the pile's thickness.
  const shape = useMemo(() => cardGeometry(spot.w, spot.h, 1), [spot.w, spot.h]);
  useEffect(() => () => shape.dispose(), [shape]);
  const group = useRef<Group>(null);
  const updateProxy = useProxy(zoneKey(player.id, zone), group, spot.w, spot.h, thick + 0.01);
  useFrame((state) => updateProxy(state.clock.elapsedTime));
  const look = PILE_LOOK[zone];
  return (
    <group ref={group} position={[spot.x, spot.y, 0]}>
      {n > 0 && (
        <>
          <mesh castShadow receiveShadow geometry={shape} position-z={thick / 2} scale-z={thick} raycast={() => null}>
            <meshStandardMaterial attach="material-0" color={look.edge} roughness={0.9} />
            {face ? (
              // Lit by itself a little less than a card in play: the graveyard is worn and dim.
              <meshStandardMaterial key="face" attach="material-1" map={face} color={look.tint} roughness={0.7} emissiveMap={face} emissive={look.tint} emissiveIntensity={FACE_GLOW * 0.4} />
            ) : up ? (
              // A face-up card whose picture hasn't loaded: plain, never a back, which would say it was face down.
              <meshStandardMaterial key="plain" attach="material-1" color={FRAME[frameOf(data(top))] ?? FRAME.artifact} roughness={0.8} />
            ) : (
              <meshStandardMaterial key="back" attach="material-1" map={back} roughness={0.6} />
            )}
            <meshStandardMaterial attach="material-2" map={back} roughness={0.6} />
          </mesh>
          <mesh position-z={SHADOW_Z} renderOrder={-1} raycast={() => null}>
            <planeGeometry args={[spot.w * (1 + 2 * SHADOW_SPREAD), spot.h + 2 * SHADOW_SPREAD * spot.w]} />
            <meshBasicMaterial map={shadowTexture()} color="#000000" transparent opacity={SHADOW_OPACITY} depthWrite={false} />
          </mesh>
        </>
      )}
    </group>
  );
}

/** How many of an opponent's cards their held fan draws, as the CSS fan did: past that, the count says. */
const HELD_SHOWN = 12;

/**
 * An opponent's hand on the 3D table: their cards held up at the back of their mat at `spot`,
 * fanned (`heldFan`), leant back so their backs face you (a far seat's square to the
 * screen), held still. A card just drawn rises into the fan from their library (`library`);
 * any other card reaching the hand rises from the fan's foot. Its proxy (`HandProxy`) is kept on the middle
 * card.
 */
function HeldHand({ player, spot, library, far }: { player: Player; spot: HandSpot; library: PileSpot; far: boolean }) {
  const { table } = useScene();
  const n = Math.min(player.hand.length, HELD_SHOWN);
  // A far seat's fan faces you square: leant back as far as the table leans away, its plane is
  // the screen's, so it reads as an even fan. Leant less, the far corners of the table see it
  // from the side, and it skews. A near seat's stands more upright (HELD_LEAN).
  const lean = far ? Math.PI / 2 - tiltRad(TILT) : HELD_LEAN;
  const fan = heldFan(n, spot.room, lean);
  const shape = useMemo(() => cardGeometry(fan.w, fan.h, CARD_THICKNESS), [fan.w, fan.h]);
  useEffect(() => () => shape.dispose(), [shape]);
  // What the hand and library held last time: more in hand, fewer in the library, is a draw.
  const before = useRef({ hand: n, library: player.library.length });
  const drew = n > before.current.hand && player.library.length < before.current.library;
  const first = before.current.hand;
  useEffect(() => {
    before.current = { hand: n, library: player.library.length };
  });
  const plane = useRef<Group>(null);
  const fanGroup = useRef<Group>(null);
  const anchor = useRef<Group>(null);
  const updateProxy = useProxy(handKey(player.id), anchor, fan.w, fan.h);
  useFrame((state) => updateProxy(state.clock.elapsedTime));
  /** Where a card drawn now starts: on the library's top, in the fan's own terms. */
  const fromLibrary = () => {
    const p = plane.current;
    const t = table.current;
    if (!p || !t) return null;
    t.updateMatrixWorld();
    const at = t.localToWorld(new Vector3(library.x, library.y, Math.max(CARD_THICKNESS, player.library.length * PILE_CARD)));
    return fanGroup.current!.worldToLocal(at);
  };
  const mid = n ? fan.cards[Math.floor((n - 1) / 2)] : { x: 0, y: fan.h / 2, z: 0, turn: 0 };
  return (
    <group position={[spot.x, spot.y, fan.lift]} rotation-x={Math.PI / 2 - lean}>
      <group ref={plane}>
        <group ref={fanGroup}>
          {fan.cards.map((c, i) => (
            <HeldBack key={i} pose={c} shape={shape} from={i >= first ? (drew ? fromLibrary : 'below') : null} />
          ))}
          <group ref={anchor} position={[n % 2 ? mid.x : 0, mid.y, mid.z + CARD_THICKNESS]} />
        </group>
      </group>
    </group>
  );
}

/** The back of every held card, its face too: you never see an opponent's hand. */
function HeldBack({ pose, shape, from }: { pose: { x: number; y: number; z: number; turn: number }; shape: BufferGeometry; from: (() => Vector3 | null) | 'below' | null }) {
  const { speed } = useScene();
  const ref = useRef<Group>(null);
  const started = useRef(false);
  useFrame((_, dt) => {
    const o = ref.current;
    if (!o) return;
    if (!started.current) {
      started.current = true;
      const at = typeof from === 'function' ? from() : null;
      if (at) o.position.copy(at);
      else if (from === 'below') o.position.set(pose.x, pose.y - 6, pose.z);
      else o.position.set(pose.x, pose.y, pose.z);
      o.rotation.z = pose.turn;
    }
    const l = 7 * Math.sqrt(speed);
    o.position.x = MathUtils.damp(o.position.x, pose.x, l, dt);
    o.position.y = MathUtils.damp(o.position.y, pose.y, l, dt);
    o.position.z = MathUtils.damp(o.position.z, pose.z, l, dt);
    o.rotation.z = MathUtils.damp(o.rotation.z, pose.turn, l, dt);
  });
  const back = backTexture();
  return (
    <group ref={ref}>
      <mesh castShadow geometry={shape} raycast={() => null}>
        <meshStandardMaterial attach="material-0" color="#14161b" roughness={0.7} />
        <meshStandardMaterial attach="material-1" map={back} roughness={0.55} emissiveMap={back} emissive="#ffffff" emissiveIntensity={FACE_GLOW * 0.5} />
        <meshStandardMaterial attach="material-2" map={back} roughness={0.55} emissiveMap={back} emissive="#ffffff" emissiveIntensity={FACE_GLOW * 0.5} />
      </mesh>
    </group>
  );
}
