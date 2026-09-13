import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  advanceControllableAirEntity,
  CONTROLLABLE_CAMERA_MODE,
  CONTROLLABLE_STATUS,
  createControllableAirEntity,
  hasFiniteControllableState,
} from '../src/store/controllableAirEntity.js';
import { useManualControlStore } from '../src/store/manualControlStore.js';
import { useEngine } from '../src/store/engine.js';

const makeEntity = (id, overrides = {}) => createControllableAirEntity({
  id,
  initialPosition: { lat: 50.45, lng: 30.52, altitudeM: 150 },
  initialOrientation: { heading: 0, pitch: 0, roll: 0, speedMps: 18 },
  ...overrides,
});

const spawned = makeEntity('TEST-001');
assert.equal(spawned.status, CONTROLLABLE_STATUS.ACTIVE);
assert.ok(hasFiniteControllableState(spawned));

let controlled = spawned;
for (let index = 0; index < 200; index += 1) {
  controlled = advanceControllableAirEntity(controlled, 0.05, {
    throttle: 0.8,
    pitch: index < 80 ? 0.35 : 0,
    yaw: 0.3,
    roll: 0.2,
  });
}
assert.ok(hasFiniteControllableState(controlled));
assert.ok(controlled.heading > spawned.heading);
assert.ok(controlled.altitudeM > spawned.altitudeM);

Object.values(CONTROLLABLE_CAMERA_MODE).forEach(cameraMode => {
  const withCamera = { ...controlled, cameraMode };
  assert.equal(withCamera.cameraMode, cameraMode);
});

const paused = advanceControllableAirEntity(controlled, 0, { throttle: 1, yaw: 1 });
assert.equal(paused, controlled);

let crashing = makeEntity('CRASH-001', {
  initialPosition: { lat: 50.45, lng: 30.52, altitudeM: 2 },
  initialOrientation: { heading: 0, pitch: -55, speedMps: 30 },
});
for (let index = 0; index < 40 && crashing.status === CONTROLLABLE_STATUS.ACTIVE; index += 1) {
  crashing = advanceControllableAirEntity(crashing, 0.05, { throttle: 0.6, pitch: -1 });
}
assert.equal(crashing.status, CONTROLLABLE_STATUS.CRASHED);
assert.equal(crashing.lastCollision.kind, 'GROUND');

const engine = useEngine.getState();
engine.resetScenario('SIMPLE');
const batteryId = useEngine.getState().batteries[0].id;
useEngine.getState().setSelectedBattery(batteryId);
useEngine.getState().setHoveredTrack('GHOST-TRACK');
useEngine.getState().tick(1);
assert.equal(useEngine.getState().selectedBatteryId, batteryId,
  'Battery selection must not depend on selected Track lifecycle');
assert.equal(useEngine.getState().hoveredTrackId, null,
  'A despawned Track must release hovered state');
const ids = Array.from({ length: 5 }, (_, index) => useEngine.getState().launchControllableEntity({
  initialPosition: { lat: 49.2 + index * 0.001, lng: 28.45, altitudeM: 120 },
  initialOrientation: { heading: 0, speedMps: 18 },
}));
assert.equal(useEngine.getState().controllableAirEntities.length, 5);
assert.equal(useEngine.getState().setControlledControllableEntity(ids[0]), true);
useManualControlStore.getState().setCommand(ids[0], { throttle: 0.8, yaw: 0.7, pitch: 0, roll: 0 });
const before = new Map(useEngine.getState().controllableAirEntities.map(entity => [entity.id, entity]));
for (let index = 0; index < 20; index += 1) useEngine.getState().tick(1);
const after = new Map(useEngine.getState().controllableAirEntities.map(entity => [entity.id, entity]));
assert.notEqual(after.get(ids[0]).heading, before.get(ids[0]).heading);
ids.slice(1).forEach(id => assert.equal(after.get(id).heading, before.get(id).heading));

useEngine.getState().setTimeScale(0);
const pausedPosition = after.get(ids[0]).position;
useEngine.getState().tick(1);
assert.deepEqual(useEngine.getState().controllableAirEntities.find(entity => entity.id === ids[0]).position,
  pausedPosition);
useEngine.getState().setTimeScale(1);

useEngine.getState().setControllableCameraMode(ids[0], CONTROLLABLE_CAMERA_MODE.FPV);
assert.equal(useEngine.getState().controllableAirEntities.find(entity => entity.id === ids[0]).cameraMode,
  CONTROLLABLE_CAMERA_MODE.FPV);
useEngine.getState().destroyControllableEntity(ids[0]);
assert.equal(useEngine.getState().controlledControllableEntityId, null);
assert.equal(useManualControlStore.getState().ownerEntityId, null);
assert.ok(!useEngine.getState().controllableAirEntities.some(entity => entity.id === ids[0]));

const stress = Array.from({ length: 10 }, (_, index) => makeEntity(`PERF-${index}`));
const startedAt = performance.now();
let stressState = stress;
for (let step = 0; step < 2_000; step += 1) {
  stressState = stressState.map((entity, index) => advanceControllableAirEntity(
    entity,
    0.05,
    index === 0 ? { throttle: 0.7, yaw: 0.1, pitch: 0.05, roll: 0.1 } : undefined,
  ));
}
const elapsedMs = performance.now() - startedAt;
assert.ok(stressState.every(hasFiniteControllableState));

console.log('Controllable Air Entity V0 deterministic checks passed.');
console.log(`10 entities × 2,000 fixed steps: ${elapsedMs.toFixed(2)} ms`);
