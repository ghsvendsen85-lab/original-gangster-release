// Make a two-wheeler's front wheel the same size as its rear one, standing on
// the ground. Generated models (Tripo) can come out with a smaller front wheel
// that floats. The model must already face +x and stand on y = 0 (see
// scripts/prepare-model.mjs).
//
// Measure the wheels from an orthographic side view (tyre edges against a
// metre grid): automatic fits are thrown by mudguards, frames and footboards.
// The front assembly (tyre, mudguard, lower fork) is scaled about the front
// axle to the rear radius, put back on the ground, and moved forward by the
// growth so it clears the frame; it blends back to unchanged up the fork and
// towards the frame, so the mesh stays joined.
//
// Usage:
//   node scripts/match-wheels.mjs <in.glb> <out.glb> --front x,y,r --rear r [--frame x]
//     --front  front axle centre (x, y) and tyre radius, metres
//     --rear   rear tyre radius, metres (the target)
//     --frame  x behind which nothing moves (the frame's front; default front x - 1.1 r)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [input, output] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const front = arg('front')?.split(',').map(Number), rearR = Number(arg('rear'));
if (!input || !output || !front || front.length !== 3 || !(rearR > 0)) {
  console.error('usage: node scripts/match-wheels.mjs <in.glb> <out.glb> --front x,y,r --rear r [--frame x]');
  process.exit(1);
}
const [cx, cy, r] = front;
const frameX = Number(arg('frame') ?? cx - r * 1.1);
const scale = rearR / r, grow = rearR - r;
// New axle: forward by the growth (the tyre's back edge stays put), on the ground.
const target = { x: cx + grow, y: rearR };

const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const inner = r * 1.3, outer = r * 2;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
let moved = 0;
for (const prim of doc.getRoot().listMeshes().flatMap(m => m.listPrimitives())) {
  const pos = prim.getAttribute('POSITION'), v = [0, 0, 0];
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, v);
    const dx = v[0] - cx, dy = v[1] - cy;
    // Fully moved round the wheel and mudguard; easing out up the fork, and to nothing behind the frame's front.
    const w = (1 - smooth((Math.hypot(dx, dy) - inner) / (outer - inner))) * smooth((v[0] - frameX) / (r * .35));
    if (w <= 0) continue;
    const nx = target.x + dx * scale, ny = target.y + dy * scale;
    pos.setElement(i, [v[0] + (nx - v[0]) * w, v[1] + (ny - v[1]) * w, v[2]]);
    moved++;
  }
}
console.log(`front wheel r ${r} → ${rearR} (×${scale.toFixed(3)}), axle (${cx}, ${cy}) → (${target.x.toFixed(3)}, ${target.y.toFixed(3)}); ${moved} vertices moved`);
await io.write(output, doc);
