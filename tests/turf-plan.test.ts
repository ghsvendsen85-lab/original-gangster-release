import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { defaultGameOptions } from '../src/app/newGame';
import { BUILDING_BY_ID } from '../src/sim/data/buildings';
import { CENTRE_LOT } from '../src/sim/world';
import { FACTORY_TYPES, TURF_KIT, WORKS_KIT, hqRange, nearTurf, tramDistance } from '../src/sim/turfPlan';
import type { Block, WorldState } from '../src/sim/types';
import { CELL } from '../src/sim/constants';

const turfCity = (seed: number, citySize = 14) => new Sim({ ...defaultGameOptions(), seed, citySize, turfPlan: true });
const buildingsIn = (w: WorldState, area: (b: Block) => boolean) =>
  w.blocks.filter(area).flatMap(b => b.lotIds.map(id => w.lots[id]).filter(l => l.index !== CENTRE_LOT).map(l => w.buildings[l.buildingId])).filter(Boolean);

describe('turf plan for varied cities (playtest, 24 November)', () => {
  for (const [seed, size] of [[404, 14], [7, 10], [99, 18], [2024, 12]] as const) {
    it(`seed ${seed}, ${size} × ${size}: HQs near their quarter middles with matching kits`, () => {
      const { world: w } = turfCity(seed, size);
      const hqs = Object.values(w.buildings).filter(b => b.isHQ).map(b => w.blocks[b.blockId]);
      expect(hqs).toHaveLength(4);
      // One per quarter.
      const half = (b: Block) => `${b.gx < Math.floor(w.gridW / 2)}${b.gy < Math.floor(w.gridH / 2)}`;
      expect(new Set(hqs.map(half)).size).toBe(4);
      // Each within range of the middle of its own quarter.
      const mid = Math.floor(w.gridW / 2), range = hqRange(w);
      for (const hq of hqs) {
        const qx = hq.gx < mid ? (mid - 1) / 2 : mid + (w.gridW - 1 - mid) / 2;
        const qy = hq.gy < mid ? (mid - 1) / 2 : mid + (w.gridH - 1 - mid) / 2;
        expect(Math.abs(hq.gx - qx)).toBeLessThanOrEqual(range + 1);
        expect(Math.abs(hq.gy - qy)).toBeLessThanOrEqual(range + 1);
      }
      for (const hq of hqs) {
        const around = buildingsIn(w, b => nearTurf(hq, b) && b.id !== hq.id);
        expect(around.filter(b => b.typeId === 'poolHall').length).toBeGreaterThanOrEqual(TURF_KIT.poolHall);
        expect(around.filter(b => b.typeId === 'gym').length).toBeGreaterThanOrEqual(TURF_KIT.gym);
        expect(around.filter(b => b.cls === 'commercial' && !BUILDING_BY_ID[b.typeId].recruit).length).toBeGreaterThanOrEqual(TURF_KIT.shops);
      }
    });
  }

  it('gives each quarter a works district with warehouses and factories, and no industrial edge', () => {
    const { world: w } = turfCity(404);
    const mid = Math.floor(w.gridW / 2);
    for (const [left, top] of [[true, true], [false, true], [true, false], [false, false]]) {
      const q = (b: Block) => (b.gx < mid) === left && (b.gy < mid) === top && b.district === 'industrial';
      const works = buildingsIn(w, q);
      expect(works.filter(b => b.typeId === 'warehouse').length).toBeGreaterThanOrEqual(WORKS_KIT.warehouses);
      expect(works.filter(b => (FACTORY_TYPES as readonly string[]).includes(b.typeId)).length).toBeGreaterThanOrEqual(WORKS_KIT.factories);
    }
    const edgeRow = w.blocks.filter(b => b.gy === 0);
    expect(edgeRow.every(b => b.district !== 'industrial')).toBe(true);
  });

  it('makes downtown the richest ground, with the grand hotels and the main bank', () => {
    const { world: w } = turfCity(404);
    const types = Object.values(w.buildings).filter(b => w.blocks[b.blockId].district === 'downtown').map(b => b.typeId);
    expect(types.filter(t => t === 'hotelLarge').length).toBeGreaterThanOrEqual(2);
    expect(types).toContain('bankLarge');
    const avg = (d: string) => { const bs = w.blocks.filter(b => b.district === d); return bs.reduce((s, b) => s + b.landValue, 0) / bs.length; };
    expect(avg('downtown')).toBeGreaterThan(avg('commercial'));
    expect(avg('downtown')).toBeGreaterThan(avg('residential'));
  });

  it('puts the money on the tram streets', () => {
    const { world: w } = turfCity(404);
    const urban = w.blocks.filter(b => b.layout?.use === 'urban' && b.layout.mergedInto == null && b.district !== 'industrial' && b.district !== 'downtown');
    const near = urban.filter(b => tramDistance(w, b.center) <= 0.75 * CELL);
    const far = urban.filter(b => tramDistance(w, b.center) > 2 * CELL);
    expect(near.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(0);
    expect(near.every(b => b.district !== 'residential')).toBe(true);
    const avg = (bs: Block[]) => bs.reduce((s, b) => s + b.landValue, 0) / bs.length;
    expect(avg(near)).toBeGreaterThan(avg(far));
  });

  it('leaves cities without the turf plan as they were', () => {
    const a = new Sim({ ...defaultGameOptions(), seed: 404 }).world;
    const b = new Sim({ ...defaultGameOptions(), seed: 404, turfPlan: false }).world;
    expect(Object.values(b.buildings).map(x => x.typeId)).toEqual(Object.values(a.buildings).map(x => x.typeId));
  });
});

describe('turf plan HQs keep apart', () => {
  for (const [seed, size] of [[404, 14], [7, 10], [99, 18], [2024, 12], [5, 16]] as const) {
    it(`seed ${seed}, ${size} × ${size}: every HQ clear of the middle lines`, () => {
      const { world: w } = new Sim({ ...defaultGameOptions(), seed, citySize: size, turfPlan: true });
      const cx = (w.gridW - 1) / 2, cy = (w.gridH - 1) / 2;
      for (const b of Object.values(w.buildings).filter(x => x.isHQ).map(x => w.blocks[x.blockId])) {
        expect(Math.abs(b.gx - cx)).toBeGreaterThanOrEqual(Math.min(2, Math.floor(w.gridW / 6)));
        expect(Math.abs(b.gy - cy)).toBeGreaterThanOrEqual(Math.min(2, Math.floor(w.gridH / 6)));
      }
    });
  }
});

describe('turf plan HQs are not predictable', () => {
  it('puts the HQs in different places from one city to the next', () => {
    const spots = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const { world: w } = new Sim({ ...defaultGameOptions(), seed, citySize: 14, turfPlan: true });
      const player = Object.values(w.buildings).find(b => b.isHQ && w.gangs[b.ownerGangId!]?.isPlayer)!;
      spots.add(`${w.blocks[player.blockId].gx},${w.blocks[player.blockId].gy}`);
    }
    expect(spots.size).toBeGreaterThan(4);
  });
});
