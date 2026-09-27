import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';
import { Cartesian3, Matrix3, Matrix4, Quaternion, Transforms } from 'cesium';
import ModelUtility from '@cesium/engine/Source/Scene/Model/ModelUtility.js';
import Axis from '@cesium/engine/Source/Scene/Axis.js';
import { createOrientation } from '../src/scenes/advanced/modelOrientation.js';

const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
try {
  const registry = await server.ssrLoadModule('/src/data/advanced3dRegistry.js');
  const cases = [
    { name: '9M331', profile: registry.getAdvancedInterceptorPresentation({ interceptorSpecId: 'INT-9M331-V1' }),
      path: 'src/assets/icons/Air Defence/9M331 FOR TOR-M1/9M331.glb', axis: Cartesian3.UNIT_Z },
    { name: 'AIM-120C-7', profile: registry.getAdvancedInterceptorPresentation({ interceptorSpecId: 'INT-MEDIUM-V1' }),
      path: 'src/assets/icons/Air Defence/AIM-120A FOR NASAMS/aim-120c_amraam.glb', axis: new Cartesian3(0, -1, 0) },
    { name: 'Aster 30', profile: registry.getAdvancedInterceptorPresentation({ interceptorSpecId: 'INT-ASTER30-V1' }),
      path: 'src/assets/icons/Air Defence/ASTER-30 FOR SAMP-T/aster30.glb', axis: Cartesian3.UNIT_Z },
    { name: 'IRIS-T SLM', profile: registry.getAdvancedInterceptorPresentation({ interceptorSpecId: 'INT-SHORT-V1' }),
      path: 'src/assets/icons/Air Defence/IRIS-T SLM FOR IRIS-T/iris-t.glb', axis: Cartesian3.UNIT_Z },
    { name: 'Iskander', profile: registry.getAdvancedTargetPresentation({ modelId: 'ISKANDER_M', type: 'BALLISTIC_TARGET' }),
      path: 'src/assets/icons/Ballistic Missiles/Без имени.glb', axis: Cartesian3.UNIT_Z },
    { name: 'PAC-3', profile: registry.getAdvancedInterceptorPresentation({ interceptorSpecId: 'INT-LONG-V1' }),
      path: 'src/assets/icons/Air Defence/PAC-3 MSE FOR PATRIOT/pac-3-mse-colored.glb', axis: Cartesian3.UNIT_X },
    { name: 'Gerbera', profile: registry.getAdvancedTargetPresentation({ modelId: 'GERBERA', type: 'UAV_TARGET' }),
      path: 'src/assets/icons/UAVS/GERBERA/uav_gerbera_low-poly.glb', axis: new Cartesian3(0, 0, -1) },
  ];
  for (const { name, profile, path, axis } of cases) {
  const bytes = fs.readFileSync(path);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  const firstMeshTransform = (index, parent = Matrix4.IDENTITY) => {
    const node = gltf.nodes[index];
    const local = node.matrix ? Matrix4.fromArray(node.matrix)
      : Matrix4.fromTranslationQuaternionRotationScale(Cartesian3.fromArray(node.translation ?? [0, 0, 0]),
        Quaternion.unpack(node.rotation ?? [0, 0, 0, 1]), Cartesian3.fromArray(node.scale ?? [1, 1, 1]));
    const world = Matrix4.multiply(parent, local, new Matrix4());
    if (node.mesh != null) return world;
    for (const child of node.children ?? []) {
      const found = firstMeshTransform(child, world);
      if (found) return found;
    }
    return null;
  };
  const rootNose = Matrix4.multiplyByPointAsVector(firstMeshTransform(gltf.scenes[gltf.scene ?? 0].nodes[0]),
    axis, new Cartesian3());
  const modelNose = Matrix4.multiplyByPointAsVector(
    ModelUtility.getAxisCorrectionMatrix(Axis.Y, Axis.Z, new Matrix4()), rootNose, new Cartesian3());
  const position = Cartesian3.fromDegrees(30, 50, 15000);
  const enu = Transforms.eastNorthUpToFixedFrame(position);
  for (const headingDeg of [0, 90, 180, 270]) {
    for (const pitchDeg of [65, 0, -65]) {
      for (const rollDeg of [0, 30]) {
        const orientation = createOrientation(position, { headingDeg, pitchDeg, rollDeg }, profile);
        const nose = Cartesian3.normalize(Matrix3.multiplyByVector(Matrix3.fromQuaternion(orientation),
          modelNose, new Cartesian3()), new Cartesian3());
        const h = headingDeg * Math.PI / 180, p = pitchDeg * Math.PI / 180;
        const expected = Matrix4.multiplyByPointAsVector(enu, new Cartesian3(
          Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p)), new Cartesian3());
        const minimumAlignment = name === 'IRIS-T SLM' ? 0.99998 : 0.99999;
        assert.ok(Cartesian3.dot(nose, expected) > minimumAlignment, `${name} ${headingDeg}/${pitchDeg}/${rollDeg}: nose must follow velocity`);
      }
    }
  }
  console.log(`${name}: actual GLB hierarchy + Cesium axes + renderer quaternion: 24 orientations passed.`);
  }
} finally {
  await server.close();
}
