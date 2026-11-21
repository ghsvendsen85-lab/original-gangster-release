// Derive relief (normal) and roughness maps for the city facades from their
// colour art, so the painted walls take light like real masonry:
//   - window openings are set back into the wall, and their glass is glossy;
//   - stone sills, lintels and string courses stand proud and are matte;
//   - brick and mortar get a fine relief from the colour's small-scale detail.
// Everything wraps at the tile edges, as the facades tile across buildings.
// Usage: node scripts/build-facade-maps.mjs [--dry]
// Writes public/art/city/<facade>-normal.jpg and <facade>-roughness.jpg.
import sharp from 'sharp';

const FACADES = ['facade-red-brick', 'facade-brown-brick', 'facade-buff-brick', 'facade-limestone', 'facade-stucco'];
const DIR = 'public/art/city/';
const dry = process.argv.includes('--dry');

/** Separable Gaussian blur of a single-channel float image, wrapping at the edges. */
function blur(src, w, h, sigma) {
  const r = Math.ceil(sigma * 3), k = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[y * w + ((x + i + w) % w)] * k[i + r];
    tmp[y * w + x] = acc;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += tmp[((y + i + h) % h) * w + x] * k[i + r];
    out[y * w + x] = acc;
  }
  return out;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

for (const name of FACADES) {
  const { data, info } = await sharp(`${DIR}${name}.jpg`).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, n = w * h;
  const lum = new Float32Array(n), sat = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 3] / 255, g = data[i * 3 + 1] / 255, b = data[i * 3 + 2] / 255;
    lum[i] = .2126 * r + .7152 * g + .0722 * b;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    sat[i] = max > 0 ? (max - min) / max : 0;
  }
  const sorted = Float32Array.from(lum).sort();
  const median = sorted[Math.floor(n / 2)];
  // The open wall's brightness (upper-middle of the range: past the glass and dark brick).
  const wallLevel = sorted[Math.floor(n * .65)];

  // Window openings: the large dark areas. Thin mortar lines vanish in the blur.
  // On brick the glass is not much darker than the wall, but it is grey where
  // the brick is coloured: a dark-or-grey test finds openings on every facade.
  const soft = blur(lum, w, h, 2.2), softSat = blur(sat, w, h, 2.2);
  const sortedSat = Float32Array.from(softSat).sort(), medianSat = sortedSat[Math.floor(n / 2)];
  const openRaw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dark = 1 - smooth(wallLevel * .42, wallLevel * .6, soft[i]);
    const grey = medianSat > .3 ? (1 - smooth(medianSat * .45, medianSat * .7, softSat[i])) * (1 - smooth(median * .75, median * 1.05, soft[i])) : 0;
    openRaw[i] = Math.max(dark, grey);
  }
  // Close the mask (grow, then shrink back): glazing bars and lighter frames
  // inside an opening are part of it, not wall.
  const grown = blur(openRaw, w, h, 4);
  for (let i = 0; i < n; i++) grown[i] = smooth(.2, .35, grown[i]);
  const shrunk = blur(grown, w, h, 4);
  for (let i = 0; i < n; i++) shrunk[i] = smooth(.7, .85, shrunk[i]);
  const openMask = blur(shrunk, w, h, 1.5);
  const opening = new Float32Array(n);
  for (let i = 0; i < n; i++) opening[i] = smooth(.35, .6, openMask[i]);
  // Every facade is the same 4-bay by 4-storey grid, one window per cell.
  // Light frames and glazing bars on dark brick leave holes in an opening:
  // fill each row, then each column, between the window's own edges. Arched
  // heads keep their shape; stray specks outside the main window are ignored.
  const cellW = w / 4, cellH = h / 4;
  for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
    const xs = [], ys = [];
    for (let y = cy * cellH; y < (cy + 1) * cellH; y++) for (let x = cx * cellW; x < (cx + 1) * cellW; x++)
      if (opening[y * w + x] > .5) { xs.push(x); ys.push(y); }
    if (xs.length < cellW * cellH * .02) continue;
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    const pick = (a, q) => a[Math.min(a.length - 1, Math.floor(a.length * q))];
    const x0 = pick(xs, .06), x1 = pick(xs, .94), y0 = pick(ys, .06), y1 = pick(ys, .94);
    const span = (count, at) => {
      let first = -1, last = -1;
      for (let k = 0; k < count; k++) if (opening[at(k)] > .5) { if (first < 0) first = k; last = k; }
      if (first >= 0) for (let k = first; k <= last; k++) opening[at(k)] = 1;
    };
    for (let y = y0; y <= y1; y++) span(x1 - x0 + 1, k => y * w + x0 + k);
    for (let x = x0; x <= x1; x++) span(y1 - y0 + 1, k => (y0 + k) * w + x);
  }
  { const edged = blur(opening, w, h, 1.2); opening.set(edged); }
  // Stone dressings: noticeably lighter and greyer than the wall around them.
  const trimRaw = new Float32Array(n);
  for (let i = 0; i < n; i++) trimRaw[i] = smooth(median * 1.18, median * 1.45, soft[i]) * (1 - smooth(.25, .5, sat[i])) * (1 - opening[i]);
  const trim = blur(trimRaw, w, h, 1.2);
  // Brick and mortar: the colour's fine detail.
  const fine = blur(lum, w, h, 1.6);

  const height = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const detail = Math.max(-.12, Math.min(.12, lum[i] - fine[i]));
    // Openings are deep (reveal), dressings stand out, brick is shallow.
    height[i] = .55 + detail * 1.1 * (1 - opening[i]) + trim[i] * .22 - opening[i] * .5;
  }
  const relief = blur(height, w, h, .8);

  const normal = Buffer.alloc(n * 3), rough = Buffer.alloc(n);
  const strength = 6;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const dx = (relief[y * w + (x + 1) % w] - relief[y * w + (x - 1 + w) % w]) / 2;
    // Image rows run down the texture; v runs up it (OpenGL normal maps).
    const dy = (relief[((y - 1 + h) % h) * w + x] - relief[((y + 1) % h) * w + x]) / 2;
    let nx = -dx * strength, ny = -dy * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    normal[i * 3] = Math.round((nx * .5 + .5) * 255);
    normal[i * 3 + 1] = Math.round((ny * .5 + .5) * 255);
    normal[i * 3 + 2] = Math.round((nz * .5 + .5) * 255);
    // Glass is glossy; dressed stone a little smoother than weathered brick.
    const wall = .86 + (lum[i] - fine[i]) * .6;
    const r = wall * (1 - opening[i]) + .14 * opening[i] - trim[i] * .1;
    rough[i] = Math.round(Math.min(1, Math.max(0, r)) * 255);
  }
  if (!dry) {
    await sharp(normal, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92, mozjpeg: true }).toFile(`${DIR}${name}-normal.jpg`);
    await sharp(rough, { raw: { width: w, height: h, channels: 1 } }).jpeg({ quality: 88, mozjpeg: true }).toFile(`${DIR}${name}-roughness.jpg`);
  }
  let open = 0; for (let i = 0; i < n; i++) open += opening[i];
  console.log(`${name}: ${w}x${h}, median luminance ${median.toFixed(2)}, openings ${(open / n * 100).toFixed(1)}%`);
}
