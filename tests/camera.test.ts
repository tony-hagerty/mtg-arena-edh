// The camera on the table (src/ui/camera.ts): the tilted table's size, and the projection between it and the screen.
import { describe, expect, it } from 'vitest';
import { DEPTH, TILT, camera, farEdgeScale, tableHeight } from '../src/ui/camera';

const REM = 10;
const W = 1920;
const H = 1080;
const sin = Math.sin((TILT * Math.PI) / 180);
const cos = Math.cos((TILT * Math.PI) / 180);

describe('tableHeight', () => {
  it('puts the far edge on the top of the screen', () => {
    const h = tableHeight(H, DEPTH * REM);
    // The far edge, h up the table, projects to h·cos t·D / (D + h·sin t) up the screen.
    const up = (h * cos * DEPTH * REM) / (DEPTH * REM + h * sin);
    expect(up).toBeCloseTo(H, 6);
    // Leaning over shortens the table, so it has to be taller than the screen (about 1.05× at 10° and 600rem).
    expect(h).toBeGreaterThan(H);
  });

  it('narrows the far edge by the perspective', () => {
    const h = tableHeight(H, DEPTH * REM);
    expect(farEdgeScale(H, DEPTH * REM)).toBeCloseTo((DEPTH * REM) / (DEPTH * REM + h * sin), 9);
    expect(farEdgeScale(H, DEPTH * REM)).toBeLessThan(1);
  });
});

describe('camera', () => {
  const cam = camera(W, H, REM);

  it('maps the bottom edge to itself', () => {
    expect(cam.toScreen({ x: W / 2, y: cam.tableH })).toEqual({ x: W / 2, y: H });
    const corner = cam.toScreen({ x: 0, y: cam.tableH });
    expect(corner.x).toBeCloseTo(0, 6);
    expect(corner.y).toBeCloseTo(H, 6);
  });

  it('maps the far edge to the top of the screen, narrowed', () => {
    const top = cam.toScreen({ x: W / 2, y: 0 });
    expect(top.y).toBeCloseTo(0, 6);
    const left = cam.toScreen({ x: 0, y: 0 });
    expect(left.x).toBeCloseTo((W / 2) * (1 - farEdgeScale(H, DEPTH * REM)), 6);
  });

  it('goes back and forth without drift', () => {
    for (const p of [
      { x: 0, y: 0 },
      { x: W, y: cam.tableH },
      { x: 300, y: 200 },
      { x: 1500, y: 900 },
      { x: W / 2, y: cam.tableH / 2 },
    ]) {
      const back = cam.toTable(cam.toScreen(p));
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
  });

  it('shrinks things more the farther up the table they are', () => {
    const width = (y: number) => cam.toScreen({ x: 1000, y }).x - cam.toScreen({ x: 900, y }).x;
    expect(width(cam.tableH)).toBeCloseTo(100, 6);
    expect(width(cam.tableH / 2)).toBeLessThan(100);
    expect(width(0)).toBeLessThan(width(cam.tableH / 2));
  });
});
