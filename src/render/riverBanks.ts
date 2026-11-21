import { STREET_WIDTH, CELL } from '../sim/constants';
import { cityStreetInset } from '../sim/cityLayout';
import type { Block, WorldState } from '../sim/types';
import { paveWidth } from './util';

export interface Rect { x: number; y: number; w: number; h: number }
export interface RiverBank {
  /** Open water: to the cell edge where the river continues, to the plot line on land sides. */
  water: Rect;
  /** Raised bank pavements between the kerb and the water, on each land side. */
  banks: Rect[];
  /** Railings along the water's edge on land sides; at a bridge, its parapets. */
  railings: { x0: number; y0: number; x1: number; y1: number }[];
  /** Which sides of the cell end the water at the plot line (land or a bridge deck). */
  sides: { N: boolean; S: boolean; W: boolean; E: boolean };
  /** Water's edge distance from the cell edge on those sides. */
  plot: number;
}

/** The river runs in a sunken channel, this far below the carriageway (metres). */
export const RIVER_LEVEL = -1.8;

/** A box in plan: centre and size on the ground (x, z). */
export interface WallPiece { x: number; z: number; w: number; d: number }

/**
 * The embankment walls round the whole channel: wherever water (the union of
 * the blocks' water rectangles) meets dry ground inside the map, a wall of
 * `thickness` on the dry side, plus a square at every corner so bends, bank
 * ends and bridge abutments close up. Off the map the river flows on: no wall.
 * Built on the rectangles' own edges (a compressed grid), so walls line up
 * exactly with the street surface's opening.
 */
export function embankmentWalls(rects: readonly Rect[], mapW: number, mapH: number, thickness = .6): WallPiece[] {
  if (!rects.length) return [];
  const xs = [...new Set(rects.flatMap(r => [r.x, r.x + r.w]).concat([0, mapW]))].sort((a, b) => a - b);
  const zs = [...new Set(rects.flatMap(r => [r.y, r.y + r.h]).concat([0, mapH]))].sort((a, b) => a - b);
  const nx = xs.length - 1, nz = zs.length - 1;
  const wet = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
    if (rects.some(r => cx > r.x && cx < r.x + r.w && cz > r.y && cz < r.y + r.h)) wet[j * nx + i] = 1;
  }
  // Off the map is neither: the river flows on and the land carries on, so a
  // boundary needs water and dry ground both inside the map.
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < nz;
  const isWet = (i: number, j: number) => inside(i, j) && wet[j * nx + i] === 1;
  const isDry = (i: number, j: number) => inside(i, j) && wet[j * nx + i] === 0;
  const edge = (ai: number, aj: number, bi: number, bj: number) =>
    isWet(ai, aj) && isDry(bi, bj) ? 1 : isDry(ai, aj) && isWet(bi, bj) ? -1 : 0;
  const pieces: WallPiece[] = [];
  const t = thickness;
  // Vertical boundaries (between columns i-1 and i), merged down each run.
  for (let i = 0; i <= nx; i++) {
    let start = -1, side = 0;
    const flush = (end: number) => {
      if (start < 0) return;
      const x = xs[i] + side * t / 2, z0 = zs[start], z1 = zs[end];
      pieces.push({ x, z: (z0 + z1) / 2, w: t, d: z1 - z0 });
      start = -1;
    };
    for (let j = 0; j <= nz; j++) {
      const s = j < nz ? edge(i - 1, j, i, j) : 0; // +1: water left, wall on the right (dry) side
      if (s !== side || s === 0) { flush(j); }
      if (s !== 0 && start < 0) { start = j; side = s; }
    }
  }
  // Horizontal boundaries (between rows j-1 and j).
  for (let j = 0; j <= nz; j++) {
    let start = -1, side = 0;
    const flush = (end: number) => {
      if (start < 0) return;
      const z = zs[j] + side * t / 2, x0 = xs[start], x1 = xs[end];
      pieces.push({ x: (x0 + x1) / 2, z, w: x1 - x0, d: t });
      start = -1;
    };
    for (let i = 0; i <= nx; i++) {
      const s = i < nx ? edge(i, j - 1, i, j) : 0;
      if (s !== side || s === 0) { flush(i); }
      if (s !== 0 && start < 0) { start = i; side = s; }
    }
  }
  // Corner squares: at every grid point where water and dry ground meet, fill
  // the dry quadrants' corner so two walls meeting there leave no notch.
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const quads = [[i - 1, j - 1, -1, -1], [i, j - 1, 1, -1], [i - 1, j, -1, 1], [i, j, 1, 1]] as const;
    const wets = quads.map(([a, b]) => isWet(a, b)), drys = quads.map(([a, b]) => isDry(a, b));
    if (!wets.some(Boolean) || !drys.some(Boolean)) continue;
    // A straight run (water on one whole side) needs no corner piece.
    const [nw, ne, sw, se] = wets, [dnw, dne, dsw, dse] = drys;
    if ((nw && ne && dsw && dse) || (sw && se && dnw && dne) || (nw && sw && dne && dse) || (ne && se && dnw && dsw)) continue;
    for (const [k, [, , sx, sz]] of quads.entries()) {
      if (!drys[k]) continue;
      pieces.push({ x: xs[i] + sx * t / 2, z: zs[j] + sz * t / 2, w: t, d: t });
    }
  }
  return pieces;
}

/**
 * The original city's river block: rows 1..3 are water and the outer ring is
 * bank pavement where it meets land (Block_BuildContent 19..24). Neighbouring
 * river blocks join into one channel; the map edge leaves the river open.
 * Bridges are avenue blocks, so their side of a river block is a land side: the
 * streets beside a bridge cross on dry deck behind the parapet railings.
 */
/** An avenue crossing the river (content 37): water under the avenue's two
 * carriageways, which cross on decks at the cell's street edges. */
export function riverCrossing(b: Block | null | undefined): boolean {
  return b?.layout?.use === 'avenue' && b.original?.content === 37;
}

export function riverBank(w: WorldState, b: Block): RiverBank {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w.gridW && y < w.gridH ? w.blocks[y * w.gridW + x] : null;
  // A side is land when there is a non-river block there; off the map the river flows on.
  const wet = (n: Block | null) => n?.layout?.use === 'water' || riverCrossing(n);
  const land = (x: number, y: number) => { const n = at(x, y); return !!n && !wet(n); };
  // Either side of a crossing is a street deck, so the water stops at the plot
  // line there too, behind a parapet; the bank pavement runs only on land sides.
  const crossing = riverCrossing(b);
  const deck = (x: number, y: number) => crossing || riverCrossing(at(x, y));
  const N = land(b.gx, b.gy - 1) || deck(b.gx, b.gy - 1), S = land(b.gx, b.gy + 1) || deck(b.gx, b.gy + 1);
  const W = land(b.gx - 1, b.gy) || deck(b.gx - 1, b.gy), E = land(b.gx + 1, b.gy) || deck(b.gx + 1, b.gy);
  const bankN = land(b.gx, b.gy - 1), bankS = land(b.gx, b.gy + 1), bankW = land(b.gx - 1, b.gy), bankE = land(b.gx + 1, b.gy);
  const plot = STREET_WIDTH / 2 + cityStreetInset(w), kerb = plot - paveWidth(w);
  const x0 = b.gx * CELL, y0 = b.gy * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
  const water = { x: x0 + (W ? plot : 0), y: y0 + (N ? plot : 0), w: 0, h: 0 };
  water.w = x1 - (E ? plot : 0) - water.x; water.h = y1 - (S ? plot : 0) - water.y;
  const banks: Rect[] = [], railings: RiverBank['railings'] = [];
  // North and south banks run between the kerbs of any land to the west or east;
  // west and east banks fill between them.
  const bx0 = x0 + (W ? kerb : 0), bx1 = x1 - (E ? kerb : 0);
  if (bankN) banks.push({ x: bx0, y: y0 + kerb, w: bx1 - bx0, h: plot - kerb });
  if (bankS) banks.push({ x: bx0, y: y1 - plot, w: bx1 - bx0, h: plot - kerb });
  const by0 = y0 + (N ? plot : 0), by1 = y1 - (S ? plot : 0);
  if (bankW) banks.push({ x: x0 + kerb, y: by0, w: plot - kerb, h: by1 - by0 });
  if (bankE) banks.push({ x: x1 - plot, y: by0, w: plot - kerb, h: by1 - by0 });
  const r = water;
  if (N) railings.push({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y });
  if (S) railings.push({ x0: r.x, y0: r.y + r.h, x1: r.x + r.w, y1: r.y + r.h });
  if (W) railings.push({ x0: r.x, y0: r.y, x1: r.x, y1: r.y + r.h });
  if (E) railings.push({ x0: r.x + r.w, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });
  return { water, banks, railings, sides: { N, S, W, E }, plot };
}
