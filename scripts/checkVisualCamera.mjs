import assert from 'node:assert/strict';
import { Cartesian3 } from 'cesium';
import { createAdvancedCameraController } from '../src/scenes/advanced/AdvancedCameraController.js';
import { visualBodyQuaternion } from '../src/scenes/advanced/visualInterpolation.js';

for (const mode of ['FPV', 'FIRST_PERSON', 'THIRD_PERSON', 'FOLLOW', 'SIDE', 'TACTICAL']) {
  const endpoints = [];
  for (const fps of [30, 60, 120]) {
    let view;
    const listeners = new Set();
    const canvas = { addEventListener: (_, fn) => listeners.add(fn),
      removeEventListener: (_, fn) => listeners.delete(fn) };
    const viewer = { scene: { canvas, screenSpaceCameraController: {} },
      camera: { frustum: { fov: 1 }, setView: value => { view = value; } } };
    const controller = createAdvancedCameraController(viewer);
    controller.setMode(mode);
    for (let frame = 0; frame <= fps * 10; frame++) {
      const time = frame / fps;
      const k = { headingDeg: (359 + time * 8) % 360, pitchDeg: 10 * Math.sin(time), rollDeg: 20 * Math.sin(time) };
      controller.update({ selectedPosition: Cartesian3.fromDegrees(30 + time * .0001, 50, 1000),
        ...k, bodyQuaternion: visualBodyQuaternion(k), selectedAltitudeM: 1000, timestampMs: frame * 1000 / fps });
      assert.ok(Object.values(view.destination).every(Number.isFinite));
      assert.ok(Math.abs(Cartesian3.magnitude(view.orientation.direction) - 1) < 1e-8);
      assert.ok(Math.abs(Cartesian3.dot(view.orientation.direction, view.orientation.up)) < 1e-8,
        `${mode}: orthogonal camera frame, including bank`);
    }
    endpoints.push(view);
    controller.destroy();
    assert.equal(listeners.size, 0, 'Camera listeners released');
  }
  assert.ok(Cartesian3.distance(endpoints[0].destination, endpoints[2].destination) < 1,
    `${mode}: 30/120 FPS destination difference < 1 m`);
  assert.ok(Cartesian3.dot(endpoints[0].orientation.direction, endpoints[2].orientation.direction) > .9999);
}
console.log('Six camera modes × 30/60/120 FPS: finite poses, orthonormal frames, bounded frame-rate difference and cleanup passed.');
