import { floorMaps } from './floor';

/*
  Works out the floor's maps (floor.ts) off the main thread: at full size it takes a second or
  two. Asked with the width, it answers with the maps, their pixels handed over, not copied.
*/

const scope = self as unknown as Worker;
scope.onmessage = (e: MessageEvent<{ width: number }>) => {
  const m = floorMaps(e.data.width);
  scope.postMessage(m, [m.albedo.buffer, m.normal.buffer, m.rough.buffer, m.glow.buffer]);
};
