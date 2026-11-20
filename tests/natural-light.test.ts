import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { naturalSunDirection } from '../src/render/naturalLight';
import { nearestIndices } from '../src/render/streetLights';

describe('street lamps lit near the view', () => {
  it('picks the nearest lamps on the ground plane, nearest first', () => {
    const lamps = [[50, 0], [3, 4], [-1, 0], [0, 10], [2, 2]].map(([x, z]) => new THREE.Vector3(x, .15, z));
    expect(nearestIndices(lamps, new THREE.Vector3(0, 0, 0), 3)).toEqual([2, 4, 1]);
    expect(nearestIndices(lamps, new THREE.Vector3(0, 0, 0), 10)).toHaveLength(5);
    expect(nearestIndices([], new THREE.Vector3(), 4)).toEqual([]);
  });
});

// The map runs west → east along +x and north → south along +z.
describe('natural sun path (free 3D view)', () => {
  it('rises in the east, stands in the south at midday and sets in the west', () => {
    const morning = naturalSunDirection(7), midday = naturalSunDirection(12.75), evening = naturalSunDirection(18.5);
    expect(morning.x).toBeGreaterThan(.8);
    expect(midday.z).toBeGreaterThan(Math.abs(midday.x));
    expect(evening.x).toBeLessThan(-.8);
  });
  it('is highest around midday and low near sunrise and sunset, never under the ground', () => {
    const height = (h: number) => naturalSunDirection(h).y;
    expect(height(12.75)).toBeGreaterThan(height(9));
    expect(height(9)).toBeGreaterThan(height(6.5));
    for (const h of [5, 6, 8, 12, 16, 19.5, 21]) {
      const d = naturalSunDirection(h);
      expect(d.y).toBeGreaterThan(0);
      expect(d.length()).toBeCloseTo(1);
    }
  });
});
