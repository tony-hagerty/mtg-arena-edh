import { useSyncExternalStore } from 'react';
import { useRem } from './rem';

/*
  The camera on the table. The table (the scene in src/ui/three/Table3D.tsx) leans away from
  you by TILT about its bottom edge, seen with a perspective of DEPTH from the bottom centre
  of the screen, like Arena's board. These two numbers are the only ones: the scene's camera
  is built from them (`baseCamera` in three/layout3d.ts), and the maths below projects
  between the table's plane and the screen with the same values.

  Two coordinate spaces then: the table's own (px from its top-left corner, what the seats'
  layout uses: three/board.ts) and the screen's (what getBoundingClientRect returns). The
  hand, the portraits, the HUD and the arrows live on the screen; the cards, piles and held
  hands live on the table, each with a proxy the scene lays over it on the screen.
*/

/** Whether this browser can draw the 3D table: Three's renderer runs on WebGPU, else on WebGL 2, which every browser with WebGPU also has. */
function canDraw3D() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    // Only asked to find out: give the context back rather than hold one of the browser's few.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

/** Whether this browser can draw the table (GameScreen says so when it can't). Outside a browser (the tests) nothing is drawn. */
export const CAN_DRAW_3D = typeof document !== 'undefined' && canDraw3D();

/** How far the table leans away from you, in degrees. 0 is flat. It leans as Arena's board does, its far seats foreshortened. */
export const TILT = 26;
/** The perspective distance in rem. Bigger is weaker (flatter). Arena's: the far edge about 0.6 of the near one. */
export const DEPTH = 170;

const RAD = (TILT * Math.PI) / 180;
const SIN = Math.sin(RAD);
const COS = Math.cos(RAD);

/**
 * The height the untilted table needs so that, leaned over, its far edge lands exactly on
 * the top of the screen. `stageH` and `depth` in the same unit, the answer too. A point `y`
 * up from the bottom edge projects to `y·cos t·D / (D + y·sin t)`; set that to the stage's
 * height and solve for `y`.
 */
export function tableHeight(stageH: number, depth: number) {
  return (stageH * depth) / (depth * COS - stageH * SIN);
}

/** How wide the far edge is, as a fraction of the near one. */
export const farEdgeScale = (stageH: number, depth: number) => depth / (depth + tableHeight(stageH, depth) * SIN);

export interface Pt {
  x: number;
  y: number;
}

/**
 * The projection for a stage of `w`×`h` px with `rem` px per rem: between a point on the
 * table (px from its top-left corner) and the same point on the screen. Both the transform
 * origin and the perspective origin are the bottom centre of the screen, so a table point
 * `u` right of centre and `v` above the bottom edge goes to depth `v·sin t`, which scales
 * it by `1 / (1 + v·sin t / D)`, and up the screen by `v·cos t`.
 */
export function camera(w: number, h: number, rem: number) {
  const depth = DEPTH * rem;
  const tableH = tableHeight(h, depth);
  // The projective scale of a table point is 1/wgt, with wgt linear in its y: wgt = a·y + b.
  const a = -SIN / depth;
  const b = 1 + (tableH * SIN) / depth;
  const toScreen = (p: Pt): Pt => {
    const wgt = a * p.y + b;
    return { x: w / 2 + (p.x - w / 2) / wgt, y: h + ((p.y - tableH) * COS) / wgt };
  };
  // The same equations solved for the table point.
  const toTable = (p: Pt): Pt => {
    const y = (h * b - tableH * COS - p.y * b) / ((p.y - h) * a - COS);
    const wgt = a * y + b;
    return { x: (p.x - w / 2) * wgt + w / 2, y };
  };
  return { tableH, toScreen, toTable };
}

const subscribe = (onChange: () => void) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};
const useWidth = () => useSyncExternalStore(subscribe, () => window.innerWidth);
const useHeight = () => useSyncExternalStore(subscribe, () => window.innerHeight);

/** The table's size in rem: the screen's width, and the height that puts its far edge on the top of the screen. */
export function useTableSize() {
  const rem = useRem();
  const w = useWidth() / rem;
  const h = tableHeight(useHeight() / rem, DEPTH);
  return { w, h };
}

/** The screen's size in rem. */
export function useStageSize() {
  const rem = useRem();
  return { w: useWidth() / rem, h: useHeight() / rem };
}

/** The projection for the screen as it is now. */
export const screenCamera = () => camera(window.innerWidth, window.innerHeight, parseFloat(getComputedStyle(document.documentElement).fontSize));
