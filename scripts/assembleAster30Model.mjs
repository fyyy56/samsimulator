import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The supplied Aster mesh has its body and booster authored side by side.
// Align their radial centres in the GLB itself so all three visual variants
// (assembled, body, debris booster) share exactly the same attachment pose.
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  '../src/assets/icons/Air Defence/ASTER-30 FOR SAMP-T');
const sourcePath = path.join(directory, 'aster30.glb');
const source = fs.readFileSync(sourcePath);
const jsonLength = source.readUInt32LE(12);
const gltf = JSON.parse(source.subarray(20, 20 + jsonLength).toString('utf8'));
const chunks = [];
for (let offset = 12; offset < source.length;) {
  const length = source.readUInt32LE(offset);
  const type = source.readUInt32LE(offset + 4);
  chunks.push({ type, data: source.subarray(offset + 8, offset + 8 + length) });
  offset += 8 + length;
}
const bodyIndex = gltf.nodes.findIndex(node => node.name === 'aster30body');
const boosterIndex = gltf.nodes.findIndex(node => node.name === 'aster30booster');
const rootIndex = gltf.nodes.findIndex(node => node.name === 'aster30root');
if ([bodyIndex, boosterIndex, rootIndex].some(index => index < 0)) {
  throw new Error('Aster body, booster or root node missing');
}
const meshCentre = node => {
  const mesh = gltf.meshes[node.mesh];
  const positions = mesh.primitives.map(primitive => gltf.accessors[primitive.attributes.POSITION]);
  const min = [0, 1, 2].map(axis => Math.min(...positions.map(item => item.min[axis])));
  const max = [0, 1, 2].map(axis => Math.max(...positions.map(item => item.max[axis])));
  return min.map((value, axis) => (value + max[axis]) / 2);
};
const rotate = (quaternion, point) => {
  const [x, y, z, w] = quaternion;
  const [px, py, pz] = point;
  const tx = 2 * (y * pz - z * py);
  const ty = 2 * (z * px - x * pz);
  const tz = 2 * (x * py - y * px);
  return [px + w * tx + y * tz - z * ty,
    py + w * ty + z * tx - x * tz,
    pz + w * tz + x * ty - y * tx];
};
const transformedCentre = node => rotate(node.rotation ?? [0, 0, 0, 1],
  meshCentre(node)).map((value, axis) => value + (node.translation?.[axis] ?? 0));
const body = gltf.nodes[bodyIndex];
const booster = gltf.nodes[boosterIndex];
const bodyCentre = transformedCentre(body);
const boosterCentre = transformedCentre(booster);
const radialShift = [bodyCentre[0] - boosterCentre[0], 0,
  bodyCentre[2] - boosterCentre[2]];
booster.translation = booster.translation.map((value, axis) => value + radialShift[axis]);

function encode(visibleChildren) {
  gltf.nodes[rootIndex].children = visibleChildren;
  const encoded = Buffer.from(JSON.stringify(gltf));
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20);
  encoded.copy(padded);
  const tail = chunks.slice(1);
  const totalLength = 12 + 8 + padded.length
    + tail.reduce((length, chunk) => length + 8 + chunk.data.length, 0);
  const output = Buffer.alloc(totalLength);
  source.copy(output, 0, 0, 12);
  output.writeUInt32LE(totalLength, 8);
  output.writeUInt32LE(padded.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(output, 20);
  let offset = 20 + padded.length;
  for (const chunk of tail) {
    output.writeUInt32LE(chunk.data.length, offset);
    output.writeUInt32LE(chunk.type, offset + 4);
    chunk.data.copy(output, offset + 8);
    offset += 8 + chunk.data.length;
  }
  return output;
}

fs.writeFileSync(path.join(directory, 'aster30-body.glb'), encode([bodyIndex]));
fs.writeFileSync(path.join(directory, 'aster30-booster.glb'), encode([boosterIndex]));
fs.writeFileSync(sourcePath, encode([bodyIndex, boosterIndex]));
console.log(`Aster body/booster radial centre aligned: ${radialShift.map(n => n.toFixed(4)).join(', ')} m`);
