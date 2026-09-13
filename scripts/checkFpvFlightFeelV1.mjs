import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  CONTROLLABLE_AIR_PROFILE_IDS,
  getControllableAirProfile,
} from '../src/data/controllableAirProfiles.js';
import {
  advanceControllableAirEntity,
  CONTROLLABLE_CAMERA_MODE,
  CONTROLLABLE_FLIGHT_PHASE,
  createControllableAirEntity,
  hasFiniteControllableState,
} from '../src/store/controllableAirEntity.js';
import { interpolateControllableVisualState } from '../src/scenes/advanced/visualInterpolation.js';

const makeSkyfall = (id, overrides = {}) => ({
  ...createControllableAirEntity({
    id,
    profileId: CONTROLLABLE_AIR_PROFILE_IDS.SKYFALL_FPV,
    initialPosition: { lat: 50.45, lng: 30.52, altitudeM: 400 },
    initialOrientation: { heading: 0, speedMps: 28 },
  }),
  flightPhase: CONTROLLABLE_FLIGHT_PHASE.MANUAL_FLIGHT,
  manualControlEnabled: true,
  pitch: 0,
  ...overrides,
});

const skyfallProfile = getControllableAirProfile(CONTROLLABLE_AIR_PROFILE_IDS.SKYFALL_FPV);
assert.ok(skyfallProfile.controller.mouseControl.sensitivityX > 0);
assert.ok(skyfallProfile.controller.mouseControl.smoothingTimeSec > 0);
assert.ok(skyfallProfile.controller.mouseControl.responseExponent >= 1);
assert.ok(skyfallProfile.camera.fpvFovDeg > skyfallProfile.camera.firstPersonFovDeg,
  'FPV and clean first-person cameras use deliberately different fields of view');

const advanceFor = (entity, seconds, command, deltaTimeSec = 0.05) => {
  let current = entity;
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += deltaTimeSec) {
    current = advanceControllableAirEntity(current, deltaTimeSec, command);
  }
  return current;
};

const straightStart = makeSkyfall('STRAIGHT');
const straightEnd = advanceFor(straightStart, 30, {
  throttle: 0.4, pitch: 0, yaw: 0, roll: 0,
});
assert.ok(hasFiniteControllableState(straightEnd));
assert.ok(Math.abs(straightEnd.heading - straightStart.heading) < 0.1);

let yawEntity = makeSkyfall('YAW');
yawEntity = advanceControllableAirEntity(yawEntity, 0.05, {
  throttle: 0.4, pitch: 0, yaw: 1, roll: 0,
});
const firstYawRate = yawEntity.controlState.actualRatesDegPerSec.yaw;
assert.ok(firstYawRate > 0 && firstYawRate < 20, 'Yaw rate ramps instead of snapping to max');
yawEntity = advanceFor(yawEntity, 0.8, { throttle: 0.4, pitch: 0, yaw: 1, roll: 0 });
const establishedYawRate = yawEntity.controlState.actualRatesDegPerSec.yaw;
assert.ok(establishedYawRate > firstYawRate);
yawEntity = advanceControllableAirEntity(yawEntity, 0.05, {
  throttle: 0.4, pitch: 0, yaw: -1, roll: 0,
});
assert.ok(yawEntity.controlState.actualRatesDegPerSec.yaw > -establishedYawRate,
  'Rapid reversal first brakes the existing angular velocity');
yawEntity = advanceFor(yawEntity, 0.8, { throttle: 0.4, pitch: 0, yaw: -1, roll: 0 });
assert.ok(yawEntity.controlState.actualRatesDegPerSec.yaw < 0);

let rollEntity = makeSkyfall('ROLL', {
  cameraMode: CONTROLLABLE_CAMERA_MODE.THIRD_PERSON,
});
rollEntity = advanceFor(rollEntity, 0.7, { throttle: 0.4, pitch: 0, yaw: 0, roll: 1 });
const bankedRoll = Math.abs(rollEntity.roll);
rollEntity = advanceFor(rollEntity, 2, { throttle: 0.4, pitch: 0, yaw: 0, roll: 0 });
assert.ok(Math.abs(rollEntity.roll) < bankedRoll, 'Third-person roll stabilization is gradual');

const paused = advanceControllableAirEntity(rollEntity, 0, {
  throttle: 1, pitch: 1, yaw: 1, roll: 1,
});
assert.equal(paused, rollEntity);

const cache = new Map();
interpolateControllableVisualState(cache, 'WRAP',
  { lat: 50, lng: 30, altitudeM: 100 },
  { headingDeg: 359, pitchDeg: 0, rollDeg: 0 }, 0, 0);
interpolateControllableVisualState(cache, 'WRAP',
  { lat: 50, lng: 30.001, altitudeM: 101 },
  { headingDeg: 1, pitchDeg: 0, rollDeg: 0 }, 0.05, 50);
const halfway = interpolateControllableVisualState(cache, 'WRAP',
  { lat: 50, lng: 30.001, altitudeM: 101 },
  { headingDeg: 1, pitchDeg: 0, rollDeg: 0 }, 0.05, 75);
const headingFromNorth = Math.min(
  halfway.kinematics.headingDeg,
  360 - halfway.kinematics.headingDeg,
);
assert.ok(headingFromNorth < 1, 'Quaternion interpolation takes the short path across north');
assert.ok(halfway.position.lng > 30 && halfway.position.lng < 30.001);
const pausedVisual = interpolateControllableVisualState(cache, 'WRAP',
  { lat: 50, lng: 30.001, altitudeM: 101 },
  { headingDeg: 1, pitchDeg: 0, rollDeg: 0 }, 0.05, 80, true);
const stillPausedVisual = interpolateControllableVisualState(cache, 'WRAP',
  { lat: 50, lng: 30.001, altitudeM: 101 },
  { headingDeg: 1, pitchDeg: 0, rollDeg: 0 }, 0.05, 1_080, true);
assert.deepEqual(stillPausedVisual.position, pausedVisual.position,
  'Visual interpolation freezes together with paused physics');

const predictionCache = new Map();
interpolateControllableVisualState(predictionCache, 'PREDICT',
  { lat: 50, lng: 30, altitudeM: 100 },
  { eastMps: 20, northMps: 0, upMps: 1, headingDeg: 0, pitchDeg: 0, rollDeg: 0,
    angularRatesDegPerSec: { pitch: 0, yaw: 30, roll: 0 } }, 0, 0);
interpolateControllableVisualState(predictionCache, 'PREDICT',
  { lat: 50, lng: 30.001, altitudeM: 101 },
  { eastMps: 20, northMps: 0, upMps: 1, headingDeg: 1, pitchDeg: 0, rollDeg: 0,
    angularRatesDegPerSec: { pitch: 0, yaw: 30, roll: 0 } }, 0.05, 50);
const predictedVisual = interpolateControllableVisualState(predictionCache, 'PREDICT',
  { lat: 50, lng: 30.001, altitudeM: 101 },
  { eastMps: 20, northMps: 0, upMps: 1, headingDeg: 1, pitchDeg: 0, rollDeg: 0,
    angularRatesDegPerSec: { pitch: 0, yaw: 30, roll: 0 } }, 0.05, 125);
assert.ok(predictedVisual.position.lng > 30.001,
  'A delayed render frame receives bounded velocity extrapolation instead of freezing');
assert.ok(predictedVisual.diagnostics.extrapolationMs > 20
  && predictedVisual.diagnostics.extrapolationMs <= 72,
  'Prediction spans a delayed visual snapshot while remaining tightly bounded');

const fps30 = advanceFor(makeSkyfall('FPS30'), 6,
  { throttle: 0.55, pitch: 0.25, yaw: 0.35, roll: 0.2 }, 1 / 30);
const fps120 = advanceFor(makeSkyfall('FPS120'), 6,
  { throttle: 0.55, pitch: 0.25, yaw: 0.35, roll: 0.2 }, 1 / 120);
assert.ok(Math.abs(fps30.heading - fps120.heading) < 2.5);
assert.ok(Math.abs(fps30.pitch - fps120.pitch) < 1.5);

let stress = Array.from({ length: 8 }, (_, index) => makeSkyfall(`FEEL-PERF-${index}`));
const startedAt = performance.now();
for (let step = 0; step < 2_000; step += 1) {
  stress = stress.map((entity, index) => advanceControllableAirEntity(
    entity,
    0.05,
    index === 0
      ? { throttle: 0.6, pitch: 0.15, yaw: 0.12, roll: 0.1 }
      : null,
  ));
}
const elapsedMs = performance.now() - startedAt;
assert.ok(stress.every(hasFiniteControllableState));

const visualCache = new Map();
const interpolationStartedAt = performance.now();
for (let frame = 0; frame < 2_000; frame += 1) {
  stress.forEach((entity, index) => interpolateControllableVisualState(
    visualCache,
    entity.id,
    {
      lat: entity.position.lat + Math.floor(frame / 3) * 0.000001,
      lng: entity.position.lng,
      altitudeM: entity.altitudeM,
    },
    {
      headingDeg: (entity.heading + Math.floor(frame / 3) * 0.05) % 360,
      pitchDeg: entity.pitch,
      rollDeg: entity.roll,
    },
    entity.lastUpdateTime + Math.floor(frame / 3) * 0.05,
    frame * (1_000 / 60),
  ));
}
const interpolationElapsedMs = performance.now() - interpolationStartedAt;

console.log('FPV Flight Feel V1 deterministic checks passed.');
console.log(`8 FPV × 2,000 controller steps: ${elapsedMs.toFixed(2)} ms`);
console.log(`8 FPV × 2,000 visual samples: ${interpolationElapsedMs.toFixed(2)} ms`);
