// Prepare a generated 3D model (Tripo, Meshy, …) for the city: simplify it to a
// triangle budget, turn it so its front faces the game's convention, scale it
// to real size in metres and stand it on the ground at the origin.
//
// Usage:
//   node scripts/prepare-model.mjs <in.glb> <out.glb> --length 2.2 --tris 8000 [--front +x|-x|+z|-z] [--texture 2048]
//
//   --length   size along the model's front-back axis after scaling, in metres
//   --tris     triangle budget after simplification (default 8000)
//   --front    which way the model's front points as delivered (default +x);
//              vehicles are turned to face +x, as the game draws them
//   --texture  largest texture side kept (default 2048)
//   --error    how far the simplified surface may move, as a fraction of the model size (default 0.04)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, simplify, weld, flatten, join, clearNodeTransform, transformMesh, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [input, output] = process.argv.slice(2).filter(a => !a.startsWith('--') && !/^[-+]?\d|^[+-][xz]$/.test(a));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
if (!input || !output) {
  console.error('usage: node scripts/prepare-model.mjs <in.glb> <out.glb> --length <metres> [--tris 8000] [--front +x] [--texture 2048]');
  process.exit(1);
}
const length = Number(arg('length', 0)), budget = Number(arg('tris', 8000));
const front = arg('front', '+x'), maxTexture = Number(arg('texture', 2048));
if (!(length > 0)) { console.error('--length (metres) is required'); process.exit(1); }

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
const triangles = () => root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => {
  const idx = p.getIndices();
  return k + (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
}, 0), 0);
const before = triangles();

// One node, one mesh, transforms baked into the vertices.
await doc.transform(flatten(), join(), weld());
for (const node of root.listNodes()) if (node.getMesh()) clearNodeTransform(node);

// Simplify to the budget (meshoptimizer keeps the silhouette and UV seams).
await MeshoptSimplifier.ready;
const ratio = Math.min(1, budget / Math.max(1, triangles()));
if (ratio < 1) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: Number(arg("error", .04)), lockBorder: false }));
await doc.transform(dedup(), prune());

// Turn the front to +x, scale to length, then stand on the ground centred.
const turn = { '+x': 0, '-x': Math.PI, '+z': -Math.PI / 2, '-z': Math.PI / 2 }[front];
if (turn == null) { console.error(`--front must be +x, -x, +z or -z (got ${front})`); process.exit(1); }
const scene = root.listScenes()[0];
const mesh = root.listMeshes()[0];
const c = Math.cos(turn), s = Math.sin(turn);
// Column-major rotation about Y (three.js convention: x' = c x + s z, z' = -s x + c z).
transformMesh(mesh, [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
let box = getBounds(scene);
const scale = length / (box.max[0] - box.min[0]);
transformMesh(mesh, [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1]);
box = getBounds(scene);
const cx = (box.min[0] + box.max[0]) / 2, cz = (box.min[2] + box.max[2]) / 2;
transformMesh(mesh, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -cx, -box.min[1], -cz, 1]);
box = getBounds(scene);

// Keep textures within the size the game uses.
for (const texture of root.listTextures()) {
  const [w, h] = texture.getSize() ?? [0, 0];
  if (Math.max(w, h) <= maxTexture) continue;
  const image = await sharp(Buffer.from(texture.getImage())).resize(maxTexture, maxTexture, { fit: 'inside' })
    .jpeg({ quality: 90 }).toBuffer();
  texture.setImage(new Uint8Array(image)).setMimeType('image/jpeg');
}

await io.write(output, doc);
const size = box.max.map((v, i) => (v - box.min[i]).toFixed(2));
console.log(`${input} → ${output}`);
console.log(`triangles ${Math.round(before)} → ${Math.round(triangles())}; size (x, y, z) ${size.join(' × ')} m; front was ${front}`);
