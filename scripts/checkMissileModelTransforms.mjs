import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';
import { Cartesian3, Matrix3, Matrix4, Quaternion } from 'cesium';
import { bodyToWorldQuaternion, getVisualExhaustPosition, getVisualModelAnchorPosition,
  createWorldMissileBillboard } from '../src/scenes/advanced/modelOrientation.js';
import { visualBodyQuaternion } from '../src/scenes/advanced/visualInterpolation.js';

const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
try {
  const { getAdvancedInterceptorPresentation } = await server.ssrLoadModule('/src/data/advanced3dRegistry.js');
  for (const id of ['INT-LONG-V1', 'INT-MEDIUM-V1', 'INT-SHORT-V1', 'INT-ASTER30-V1']) {
    const p = getAdvancedInterceptorPresentation({ interceptorSpecId: id });
    assert.equal(p.baseVisualScale, 1.45);
    assert.equal(p.minPixelSize, 0, 'Camera distance must not silently inflate geometry away from anchors');
    assert.equal(p.maxVisualScale, p.baseVisualScale);
    let rawBounds = null;
    if (p.modelUri) {
      const file = decodeURIComponent(p.modelUri.split('?')[0]).replace(/^\//, '');
      const bytes = fs.readFileSync(file);
      const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
        const a = gltf.accessors[primitive.attributes.POSITION];
        for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], a.min[k]); max[k] = Math.max(max[k], a.max[k]); }
      }
      const dimensions = max.map((v, k) => v - min[k]);
      rawBounds = { min, max, dimensions };
      assert.ok(Math.max(...dimensions) / Math.min(...dimensions) > 6, `${id}: elongated raw geometry`);
      const visit = (index, parent = Matrix4.IDENTITY) => {
        const n = gltf.nodes[index];
        const local = n.matrix ? Matrix4.fromArray(n.matrix) : Matrix4.fromTranslationQuaternionRotationScale(
          Cartesian3.fromArray(n.translation ?? [0, 0, 0]), Quaternion.unpack(n.rotation ?? [0, 0, 0, 1]),
          Cartesian3.fromArray(n.scale ?? [1, 1, 1]));
        const world = Matrix4.multiply(parent, local, new Matrix4());
        const scale = Matrix4.getScale(world, new Cartesian3());
        assert.ok(Math.abs(scale.x - scale.y) < 1e-6 && Math.abs(scale.y - scale.z) < 1e-6,
          `${id}: non-uniform GLB hierarchy at ${n.name}`);
        for (const child of n.children ?? []) visit(child, world);
      };
      for (const root of gltf.scenes[gltf.scene ?? 0].nodes) visit(root);
    } else {
      assert.equal(id, 'INT-SHORT-V1', 'Only IRIS-T has no supplied GLB');
      assert.ok(Math.abs(p.billboardDimensionsM.width / p.billboardDimensionsM.height - 5892 / 920) < 1e-8);
    }
    for (const headingDeg of [0, 90, 180, 270]) for (const pitchDeg of [-65, 0, 65]) {
      const kinematics = { headingDeg, pitchDeg, rollDeg: 30 };
      const pose = { worldPosition: Cartesian3.fromDegrees(30, 50, 1000), kinematics,
        quaternion: visualBodyQuaternion(kinematics) };
      const forward = Matrix3.multiplyByVector(Matrix3.fromQuaternion(bodyToWorldQuaternion(
        pose.worldPosition, pose.quaternion)), Cartesian3.UNIT_X, new Cartesian3());
      const exhaust = getVisualExhaustPosition(pose, pose.worldPosition, p);
      const heat = getVisualModelAnchorPosition(pose, p, p.thermalAnchorModelM);
      const offset = Cartesian3.subtract(exhaust, pose.worldPosition, new Cartesian3());
      const behind = Cartesian3.dot(offset, forward);
      assert.ok(behind < -2, `${id}: exhaust must be behind the body`);
      assert.ok(Cartesian3.magnitude(Cartesian3.cross(offset, forward, new Cartesian3())) < 1e-7);
      assert.ok(Cartesian3.distance(exhaust, heat) < 0.2, `${id}: hotspot at engine`);
      const shifted = Cartesian3.add(pose.worldPosition, new Cartesian3(10, 0, 0), new Cartesian3());
      assert.ok(Cartesian3.distance(getVisualExhaustPosition(pose, shifted, p), exhaust) > 9.99,
        'Historical plume samples must retain their own position');
      if (!p.modelUri) {
        const sprite = createWorldMissileBillboard(() => pose, p, { rightWC: forward,
          upWC: Cartesian3.cross(forward, Cartesian3.UNIT_Z, new Cartesian3()) });
        assert.ok(Math.abs(sprite.rotation.getValue()) < 1e-8);
        assert.ok(Math.abs(sprite.width * sprite.scale - 4.2 * 1.45) < 1e-8);
        assert.ok(sprite.height >= 1, 'Billboard GPU integer packing must not erase its height');
        assert.equal(sprite.sizeInMeters, true);
      }
    }
    console.log(JSON.stringify({ id, rawBounds, rawNose: p.forwardAxis ?? 'IMAGE_RIGHT',
      yawOffsetDeg: p.yawOffsetDeg, scale: p.baseVisualScale, exhaust: p.exhaustAnchorModelM,
      hotspot: p.thermalAnchorModelM }));
  }
} finally { await server.close(); }
