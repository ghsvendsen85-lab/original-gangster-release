import { CELL } from './constants';
import { assembleBlockKit } from './cityLayout';
import type { Block, Vec2, WorldState } from './types';

/**
 * The turf plan for varied cities (playtest, 24 November):
 *  1. Fair home turf: the four HQs stand at mirrored spots, the same distance
 *     from the centre, each with the same starter kit around it.
 *  2. A contested middle: downtown is the richest ground and lies between all
 *     four gangs.
 *  5. Money follows the trams: blocks on a tram street are richer and become
 *     shopping blocks; back streets far from the lines are poorer.
 */

/** Blocks this close to a tram line front onto it. */
const TRAM_NEAR = 0.75 * CELL;
/** Blocks further than this are back streets. */
const TRAM_FAR = 2 * CELL;
export const TRAM_VALUE = 14, BACKSTREET_VALUE = 6, DOWNTOWN_VALUE = 8;

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function tramDistance(w: WorldState, p: Vec2): number {
  let best = Infinity;
  for (const line of w.cityLayout?.tramLines ?? [])
    for (let i = 1; i < line.points.length; i++) best = Math.min(best, segmentDistance(p, line.points[i - 1], line.points[i]));
  return best;
}

/** Steps 2 and 5, run once the tram lines are laid and before any building exists. */
export function valueByTramsAndCentre(w: WorldState): void {
  for (const block of w.blocks) {
    if (block.layout?.mergedInto != null) continue;
    if (block.district === 'downtown') block.landValue = Math.min(100, block.landValue + DOWNTOWN_VALUE);
    if (block.layout?.use !== 'urban' || block.district === 'industrial') continue;
    const d = tramDistance(w, block.center);
    if (d <= TRAM_NEAR) {
      block.landValue = Math.min(98, block.landValue + TRAM_VALUE);
      if (block.district === 'residential') {
        block.district = 'commercial';
        assembleBlockKit(w, block);
      }
    } else if (d > TRAM_FAR) block.landValue = Math.max(10, block.landValue - BACKSTREET_VALUE);
  }
}

/** Distance from the city centre, 0 at the middle and about 1 at the edge midpoints. */
export function centreRatio(w: WorldState, b: Block): number {
  const cx = (w.gridW - 1) / 2, cy = (w.gridH - 1) / 2;
  return Math.hypot((b.gx - cx) / (w.gridW / 2), (b.gy - cy) / (w.gridH / 2));
}

/** How far an HQ may stand from the middle of its quarter, in blocks. */
export function hqRange(w: WorldState): number { return Math.max(1, Math.floor(Math.min(w.gridW, w.gridH) / 7)); }

/**
 * One HQ block per quarter (in the order of `quadrants`), each drawn at random
 * within hqRange blocks of its quarter's middle (playtest, 24 November): every
 * gang starts about as far from downtown as the others, but nobody can know
 * where a rival's office is before looking. Sites keep clear of the middle
 * lines so no two gangs start as next-door neighbours; a quarter with no site
 * in range widens the search a block at a time.
 */
export function chooseTurfHQs(
  w: WorldState,
  quadrants: ((b: Block) => boolean)[],
  eligible: (b: Block) => boolean,
  pick: <T>(items: T[]) => T,
): Block[] | null {
  const W = w.gridW - 1, H = w.gridH - 1, cx = W / 2, cy = H / 2;
  // Smaller cities have less room: one block clear of the middle lines below 12 across.
  const clearX = Math.min(2, Math.floor(w.gridW / 6)), clearY = Math.min(2, Math.floor(w.gridH / 6));
  const sites: Block[] = [];
  for (const q of quadrants) {
    const quarter = w.blocks.filter(q);
    if (!quarter.length) return null;
    const xs = quarter.map(b => b.gx), ys = quarter.map(b => b.gy);
    const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2;
    const pool = quarter.filter(eligible);
    if (!pool.length) return null;
    const clear = pool.filter(b => Math.abs(b.gx - cx) >= clearX && Math.abs(b.gy - cy) >= clearY);
    const from = clear.length ? clear : pool;
    let range = hqRange(w), inRange: Block[] = [];
    while (!(inRange = from.filter(b => Math.abs(b.gx - mx) <= range && Math.abs(b.gy - my) <= range)).length) range++;
    sites.push(pick(inRange));
  }
  return sites;
}

/** The starter kit every HQ gets within two blocks: enough shops to lean on,
 * a pool hall (a night venue that also turns out hoods) and a gym. */
export const TURF_KIT = { shops: 4, poolHall: 1, gym: 1 } as const;
export const TURF_RADIUS = 2;

export function nearTurf(hq: Block, b: Block): boolean {
  return Math.abs(b.gx - hq.gx) <= TURF_RADIUS && Math.abs(b.gy - hq.gy) <= TURF_RADIUS;
}

/** Each quarter keeps a small works district of its own, 2 × 2 blocks set in
 * one block from its outer corner (playtest, 24 November), in place of one
 * industrial strip along a single edge. */
export function turfIndustrial(gx: number, gy: number, w: number, h: number): boolean {
  const near = (v: number, size: number) => v === 1 || v === 2 || v === size - 2 || v === size - 3;
  return near(gx, w) && near(gy, h);
}

/** Every works district has a few warehouses and some factories. */
export const WORKS_KIT = { warehouses: 2, factories: 2 } as const;
export const FACTORY_TYPES = ['foundry', 'mill', 'cannery'] as const;
