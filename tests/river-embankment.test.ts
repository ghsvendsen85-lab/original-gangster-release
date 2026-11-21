import { describe, expect, it } from 'vitest';
import { embankmentWalls, type WallPiece } from '../src/render/riverBanks';

/** Is the point (x, z) covered by any wall piece? */
const walled = (pieces: WallPiece[], x: number, z: number) =>
  pieces.some(p => Math.abs(x - p.x) <= p.w / 2 + 1e-6 && Math.abs(z - p.z) <= p.d / 2 + 1e-6);
/** Is the point under water (inside any rectangle)? */
const inWater = (rects: { x: number; y: number; w: number; h: number }[], x: number, z: number) =>
  rects.some(r => x > r.x && x < r.x + r.w && z > r.y && z < r.y + r.h);

describe('river embankment walls', () => {
  it('walls a straight reach on both banks and leaves the map edges open', () => {
    // Water across the whole 100 m map, 40..60 m deep in z.
    const rects = [{ x: 0, y: 40, w: 100, h: 20 }];
    const walls = embankmentWalls(rects, 100, 100);
    expect(walled(walls, 50, 39.7)).toBe(true);
    expect(walled(walls, 50, 60.3)).toBe(true);
    // Not along the map's own edge, where land and river simply carry on.
    expect(walled(walls, .2, 20)).toBe(false);
    expect(walled(walls, 99.8, 50)).toBe(false);
    // Never over the water.
    for (const p of walls) expect(inWater(rects, p.x, p.z)).toBe(false);
  });

  it('closes an L-shaped bend, including its outer corner', () => {
    // An east-running reach that turns north at x 60..80.
    const rects = [{ x: 0, y: 40, w: 80, h: 20 }, { x: 60, y: 0, w: 20, h: 40 }];
    const walls = embankmentWalls(rects, 100, 100);
    // The inner corner (land at x<60, z<40) and the outer corner (x>80, z>60).
    expect(walled(walls, 59.8, 39.8)).toBe(true);
    expect(walled(walls, 80.2, 60.2)).toBe(true);
    // Both banks of each arm.
    expect(walled(walls, 30, 39.7)).toBe(true);
    expect(walled(walls, 59.7, 20)).toBe(true);
    expect(walled(walls, 80.3, 20)).toBe(true);
    expect(walled(walls, 70, 60.3)).toBe(true);
    for (const p of walls) expect(inWater(rects, p.x, p.z)).toBe(false);
  });

  it('meets where a bank ends against a wider neighbouring reach', () => {
    // A narrow channel (inset banks) opening into a full-width one: the bank's end face is walled.
    const rects = [{ x: 10, y: 0, w: 20, h: 40 }, { x: 0, y: 40, w: 40, h: 40 }];
    const walls = embankmentWalls(rects, 40, 100);
    expect(walled(walls, 5, 39.7)).toBe(true);
    expect(walled(walls, 35, 39.7)).toBe(true);
    expect(walled(walls, 9.8, 39.8)).toBe(true);
    for (const p of walls) expect(inWater(rects, p.x, p.z)).toBe(false);
  });
});
