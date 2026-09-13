import assert from 'node:assert/strict';
import { Cartesian3, Cartographic, Math as CMath, Quaternion } from 'cesium';
import { pushVisualSnapshot, sampleVisualState, VISUAL_DELAY_SEC,
  MAX_VISUAL_EXTRAPOLATION_SEC } from '../src/scenes/advanced/visualInterpolation.js';
import { createVisualPoseProperties, createOrientation } from '../src/scenes/advanced/modelOrientation.js';

const origin = Cartesian3.fromDegrees(30, 50, 20000);
const positionAt = time => {
  const p = Cartographic.fromCartesian(Cartesian3.add(origin,
    new Cartesian3(100 * time, 50 * time, 20 * time), new Cartesian3()));
  return { lat: CMath.toDegrees(p.latitude), lng: CMath.toDegrees(p.longitude), altitudeM: p.height };
};
const kinematics = { headingDeg: 359, pitchDeg: 0, rollDeg: 0, eastMps: 100 };

// Regression: Cesium reads model properties BEFORE preRender updates camera.
// Advancing the clock must not require imperative property.setValue first.
const phaseCache = new Map();
pushVisualSnapshot(phaseCache, 'phase', positionAt(0), kinematics, 0);
pushVisualSnapshot(phaseCache, 'phase', positionAt(.05), kinematics, .05);
let phaseTime = 0;
const readPhase = () => sampleVisualState(phaseCache, 'phase', phaseTime);
const properties = createVisualPoseProperties(readPhase, { yawOffsetDeg: -90 });
const before = properties.position.getValue();
phaseTime = .025;
const modelPhase = properties.position.getValue();
const modelRotation = properties.orientation.getValue();
const cameraPhase = readPhase();
assert.ok(Cartesian3.distance(before, modelPhase) > 1);
assert.deepEqual(modelPhase, cameraPhase.worldPosition);
assert.deepEqual(modelRotation, createOrientation(cameraPhase.worldPosition,
  cameraPhase.kinematics, { yawOffsetDeg: -90 }, cameraPhase.quaternion));
assert.equal(readPhase(), cameraPhase, 'all consumers share the same cached pose');

// Real fixed-step timestamps (also batches of substeps), NOT a restarted lerp.
for (const fps of [30, 60, 120]) for (const scale of [1, 2, 5, 10, 20]) {
  const cache = new Map();
  let tick = 0;
  let previous;
  for (let frame = 0; frame <= fps * 60; frame++) {
    const time = frame / fps * scale;
    while (tick * .05 <= time + 1e-9) {
      pushVisualSnapshot(cache, 'MODEL', positionAt(tick * .05), kinematics, tick * .05);
      tick++;
    }
    const visualTime = Math.max(0, time - VISUAL_DELAY_SEC);
    const visual = sampleVisualState(cache, 'MODEL', visualTime);
    const expected = Cartesian3.add(origin,
      new Cartesian3(100 * visualTime, 50 * visualTime, 20 * visualTime), new Cartesian3());
    assert.ok(Cartesian3.distance(visual.worldPosition, expected) < 1e-6, `${fps}fps ${scale}x: continuous world position`);
    if (previous && time > VISUAL_DELAY_SEC + scale / fps) {
      const distance = Cartesian3.distance(previous, visual.worldPosition);
      assert.ok(Math.abs(distance - Math.hypot(100, 50, 20) * scale / fps) < 1e-6,
        `${fps}fps ${scale}x: no repeated frame, backward correction or tick spike`);
    }
    previous = visual.worldPosition;
    assert.ok(cache.get('MODEL').samples.length <= 32);
  }
}
const turns = new Map();
for (let i = 0; i <= 1200; i++) {
  const time = i * .05;
  pushVisualSnapshot(turns, 'TURN', positionAt(time), {
    ...kinematics, headingDeg: (359 + time * 30) % 360,
    pitchDeg: 80 * Math.cos(time / 60 * Math.PI), rollDeg: 25 * Math.sin(time),
  }, time);
  const a = sampleVisualState(turns, 'TURN', time - .025);
  const b = sampleVisualState(turns, 'TURN', time);
  assert.ok(Math.abs(Quaternion.magnitude(a.quaternion) - 1) < 1e-10);
  assert.ok(Math.abs(Quaternion.dot(a.quaternion, b.quaternion)) > .999,
    'North wrap / apex / steep descent remain on the short quaternion arc');
}
const final = sampleVisualState(turns, 'TURN', 500);
assert.equal(final.diagnostics.extrapolationMs, MAX_VISUAL_EXTRAPOLATION_SEC * 1000);
const paused = sampleVisualState(turns, 'TURN', 59.975);
assert.deepEqual(sampleVisualState(turns, 'TURN', 59.975).worldPosition, paused.worldPosition);

for (const count of [20, 40, 60]) {
  const cache = new Map();
  const costs = [];
  for (let frame = 0; frame < 3600; frame++) {
    const time = frame / 60;
    if (frame % 3 === 0) for (let id = 0; id < count; id++) {
      pushVisualSnapshot(cache, id, positionAt(time), kinematics, time);
    }
    const start = performance.now();
    for (let id = 0; id < count; id++) sampleVisualState(cache, id, time - .05);
    costs.push(performance.now() - start);
  }
  costs.sort((a, b) => a - b);
  console.log(`${count} visual entities CPU/frame: avg ${(costs.reduce((s, n) => s + n, 0) / costs.length).toFixed(3)} ms, p95 ${costs[Math.floor(costs.length * .95)].toFixed(3)}, max ${costs.at(-1).toFixed(3)}`);
}
console.log('60-second golden movement: 30/60/120 FPS × 1/2/5/10/20x passed; quaternion turns, pause and bounded extrapolation passed.');
