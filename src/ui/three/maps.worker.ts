import { bedMaps } from './board';
import type { Bed, Garden } from './board';
import { floorBand } from './floor';

/*
  Works out the board's maps off the main thread: at the size a 4K screen needs, a mat takes
  a second or two and the whole floor ten. Asked for a band of the floor's rows (floor.ts,
  several workers share a floor) or a mat's maps (board.ts), it answers with them, their
  pixels handed over, not copied.
*/

export type MapsRequest = { kind: 'floor'; width: number; j0: number; j1: number } | { kind: 'mat'; plan: Garden; bed: Bed; px: number };

const scope = self as unknown as Worker;
scope.onmessage = (e: MessageEvent<MapsRequest>) => {
  const r = e.data;
  if (r.kind === 'floor') {
    const b = floorBand(r.width, r.j0, r.j1);
    scope.postMessage(b, [b.albedo.buffer, b.height.buffer, b.rough.buffer]);
  } else {
    const m = bedMaps(r.plan, r.bed, r.px);
    scope.postMessage(m, [m.albedo.buffer, m.normal.buffer]);
  }
};
