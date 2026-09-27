import assert from 'node:assert/strict';
import fs from 'node:fs';

const base = 'src/assets/icons/Air Defence/ASTER-30 FOR SAMP-T/';
const read = name => {
  const buffer = fs.readFileSync(base + name);
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF');
  return JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString('utf8'));
};
const model = read('aster30.glb');
const bodyIndex = model.nodes.findIndex(node => node.name === 'aster30body');
const boosterIndex = model.nodes.findIndex(node => node.name === 'aster30booster');
const rootIndex = model.nodes.findIndex(node => node.name === 'aster30root');
const centre = index => {
  const node = model.nodes[index];
  const accessors = model.meshes[node.mesh].primitives.map(primitive => (
    model.accessors[primitive.attributes.POSITION]
  ));
  const raw = [0, 1, 2].map(axis => (
    (Math.min(...accessors.map(a => a.min[axis]))
      + Math.max(...accessors.map(a => a.max[axis]))) / 2
  ));
  const [x, y, z, w] = node.rotation;
  const t = [2 * (y * raw[2] - z * raw[1]),
    2 * (z * raw[0] - x * raw[2]),
    2 * (x * raw[1] - y * raw[0])];
  return [raw[0] + w * t[0] + y * t[2] - z * t[1] + node.translation[0],
    raw[1] + w * t[1] + z * t[0] - x * t[2] + node.translation[1],
    raw[2] + w * t[2] + x * t[1] - y * t[0] + node.translation[2]];
};
const body = centre(bodyIndex), booster = centre(boosterIndex);
assert.ok(Math.hypot(body[0] - booster[0], body[2] - booster[2]) < 0.02,
  'Body and booster must share the same longitudinal axis');
assert.deepEqual(model.nodes[rootIndex].children, [bodyIndex, boosterIndex]);
assert.deepEqual(read('aster30-body.glb').nodes[rootIndex].children, [bodyIndex]);
assert.deepEqual(read('aster30-booster.glb').nodes[rootIndex].children, [boosterIndex]);
console.log('Aster assembled/booster GLBs share an aligned axis and separation pose.');
