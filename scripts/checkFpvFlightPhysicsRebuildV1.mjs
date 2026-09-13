import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  CONTROLLABLE_FLIGHT_PHASE,
  advanceControllableAirEntity,
  createControllableAirEntity,
  hasFiniteControllableState,
} from '../src/store/controllableAirEntity.js';
import {
  CONTROLLABLE_AIR_PROFILE_IDS,
  getControllableAirProfile,
} from '../src/data/controllableAirProfiles.js';
import { interpolateControllableVisualState } from '../src/scenes/advanced/visualInterpolation.js';

const profile = getControllableAirProfile(CONTROLLABLE_AIR_PROFILE_IDS.SKYFALL_FPV);

assert.equal(profile.battery.seriesCells, 6);
assert.equal(profile.battery.parallelCells, 2);
assert.equal(profile.battery.capacityMah, 7_000);
assert.equal(profile.battery.nominalVoltageV, 22.2);
assert.equal(profile.battery.fullVoltageV, 25.2);
assert.equal(profile.battery.minimumLoadedVoltageV, 19.2);

const makeLevelEntity = (id, speedMps = 25, altitudeM = 1_000) => {
  const entity = createControllableAirEntity({
    id,
    profileId: CONTROLLABLE_AIR_PROFILE_IDS.SKYFALL_FPV,
    initialPosition: { lat: 50.45, lng: 30.52, altitudeM },
    initialOrientation: { heading: 0 },
  });
  return {
    ...entity,
    manualControlEnabled: true,
    flightPhase: CONTROLLABLE_FLIGHT_PHASE.MANUAL_FLIGHT,
    launchElapsedSec: profile.launch.verticalClimbSec + profile.launch.pitchOverSec,
    heading: 0,
    pitch: 0,
    roll: 0,
    vx: 0,
    vy: speedMps,
    vz: 0,
    eastMps: 0,
    northMps: speedMps,
    upMps: 0,
    speedMps,
    speedKmh: speedMps * 3.6,
    velocity: {
      eastMps: 0, northMps: speedMps, upMps: 0, speedKmh: speedMps * 3.6,
    },
  };
};

const advanceFor = (entity, seconds, command, dt = 0.05) => {
  let current = entity;
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += dt) {
    current = advanceControllableAirEntity(current, dt, command);
  }
  return current;
};

const straight = advanceFor(makeLevelEntity('STRAIGHT'), 30,
  { throttle: 1, pitch: 0, yaw: 0, roll: 0 });
assert.ok(hasFiniteControllableState(straight));
assert.ok(straight.speedKmh > 285 && straight.speedKmh < 325,
  `Natural full-throttle speed is gameplay-tuned near 300 km/h, got ${straight.speedKmh}`);
assert.ok(straight.forceTelemetry.thrustN > 0 && straight.forceTelemetry.dragN > 0);

const zeroStart = makeLevelEntity('ZERO', 55);
const zeroFirstTick = advanceControllableAirEntity(zeroStart, 0.05,
  { throttle: 0, pitch: 0, yaw: 0, roll: 0 });
const zeroEnd = advanceFor(zeroFirstTick, 10,
  { throttle: 0, pitch: 0, yaw: 0, roll: 0 });
assert.ok(zeroFirstTick.speedMps > zeroStart.speedMps * 0.97, 'Throttle zero preserves momentum');
assert.ok(zeroEnd.speedMps < zeroFirstTick.speedMps, 'Quadratic drag reduces speed');
assert.ok(zeroEnd.altitudeM < zeroStart.altitudeM, 'Gravity produces altitude loss');

const turnStart = makeLevelEntity('TURN', 80);
const turnEnd = advanceFor(turnStart, 1,
  { throttle: 1, pitch: 0, yaw: 1, roll: 1 });
const velocityHeading = (Math.atan2(turnEnd.vx, turnEnd.vy) * 180 / Math.PI + 360) % 360;
assert.ok(turnEnd.heading > velocityHeading + 25,
  'Body turns before the inertial velocity vector catches up');

let reversal = makeLevelEntity('REVERSAL', 55);
reversal = advanceFor(reversal, 0.7, { throttle: 0.6, pitch: 0, yaw: 1, roll: 0 });
const positiveYawRate = reversal.angularVelocity.yaw;
reversal = advanceControllableAirEntity(reversal, 0.05,
  { throttle: 0.6, pitch: 0, yaw: -1, roll: 0 });
assert.ok(reversal.angularVelocity.yaw > -positiveYawRate, 'Direction reversal first brakes rotation');
reversal = advanceFor(reversal, 0.8, { throttle: 0.6, pitch: 0, yaw: -1, roll: 0 });
assert.ok(reversal.angularVelocity.yaw < 0, 'Angular velocity crosses zero naturally');

const climb = advanceFor(makeLevelEntity('CLIMB', 60), 3,
  { throttle: 1, pitch: 0.65, yaw: 0, roll: 0 });
const descent = advanceFor(climb, 3,
  { throttle: 0.45, pitch: -0.8, yaw: 0, roll: 0 });
assert.ok(climb.vz > 0 && descent.vz < climb.vz, 'Pitch changes force direction, not velocity directly');

let launch = createControllableAirEntity({
  id: 'LAUNCH',
  profileId: CONTROLLABLE_AIR_PROFILE_IDS.SKYFALL_FPV,
  initialPosition: { lat: 50.45, lng: 30.52, altitudeM: 2 },
  initialOrientation: { heading: 90 },
});
let maximumPitchStep = 0;
let previousPitch = launch.pitch;
for (let step = 0; step < 60; step += 1) {
  launch = advanceControllableAirEntity(launch, 0.05);
  maximumPitchStep = Math.max(maximumPitchStep, Math.abs(launch.pitch - previousPitch));
  previousPitch = launch.pitch;
}
assert.equal(launch.flightPhase, CONTROLLABLE_FLIGHT_PHASE.MANUAL_FLIGHT);
assert.ok(launch.altitudeM > 10 && maximumPitchStep < 6, 'Vertical launch pitches over without a snap');
const unattendedLaunch = advanceFor(launch, 27, undefined);
assert.equal(unattendedLaunch.status, 'ACTIVE');
assert.ok(unattendedLaunch.altitudeM > 20,
  'Tail-sitter has enough force and launch energy to remain airborne after transition');

const flyUntilBatteryEmpty = (id, command, maximumSeconds = 700) => {
  // Высотный стенд не даёт ground collision остановить длительный energy-run.
  let current = makeLevelEntity(id, 45, 100_000);
  const startingVoltage = current.batteryVoltageV;
  let elapsedSec = 0;
  while (current.batteryRemaining > 0 && elapsedSec < maximumSeconds) {
    current = advanceControllableAirEntity(current, 0.1, command);
    elapsedSec += 0.1;
  }
  return { current, elapsedSec, startingVoltage };
};

const moderateBattery = flyUntilBatteryEmpty('BAT-MODERATE',
  { throttle: 0.55, pitch: 0.05, yaw: 0, roll: 0 });
const aggressiveBattery = flyUntilBatteryEmpty('BAT-AGGRESSIVE',
  { throttle: 1, pitch: 0.18, yaw: 0.25, roll: 0.2 });
assert.ok(moderateBattery.elapsedSec >= 480 && moderateBattery.elapsedSec <= 600,
  `Moderate gameplay endurance should be 8-10 minutes, got ${moderateBattery.elapsedSec.toFixed(1)} s`);
assert.ok(aggressiveBattery.elapsedSec < moderateBattery.elapsedSec * 0.7,
  'Aggressive throttle and manoeuvring drain the battery materially faster');
assert.ok(moderateBattery.current.batteryVoltageV <= moderateBattery.startingVoltage);
assert.ok(moderateBattery.current.currentAmps > 0 && moderateBattery.current.currentPowerKw > 0,
  'HUD electrical telemetry is derived from current power demand');

const registrySource = readFileSync(new URL('../src/data/advanced3dRegistry.js', import.meta.url), 'utf8');
assert.match(registrySource, /source mesh nose is local \+Z[\s\S]*forwardAxis: '\+Y',[\s\S]*pitchOffsetDeg: 0,/,
  'Skyfall GLB root transform is respected without applying the same X-axis correction twice');
assert.doesNotMatch(registrySource, /SKYFALL_P1_SUN[\s\S]{0,700}modelQuaternionOffset/,
  'Skyfall does not receive a duplicate model-axis quaternion');

const interpolationCache = new Map();
const samples = [];
for (let frame = 0; frame <= 6; frame += 1) {
  const physicsStep = Math.floor(frame / 3);
  const point = { lat: 50, lng: 30 + physicsStep * 0.001, altitudeM: 100 };
  const sample = interpolateControllableVisualState(
    interpolationCache,
    'SMOOTH',
    point,
    { headingDeg: physicsStep * 3, pitchDeg: 0, rollDeg: 0 },
    physicsStep * 0.05,
    frame * (1_000 / 60),
  );
  samples.push(sample.position.lng);
}
assert.ok(samples.every((value, index) => index === 0 || value >= samples[index - 1]),
  'Render interpolation is continuous and never resets backwards at a physics tick');

const pausedPhysics = advanceControllableAirEntity(turnEnd, 0,
  { throttle: 0, pitch: -1, yaw: -1, roll: -1 });
assert.equal(pausedPhysics, turnEnd, 'Pause does not mutate the authoritative state');
const pausedVisual = interpolateControllableVisualState(interpolationCache, 'SMOOTH',
  { lat: 50, lng: 30.002, altitudeM: 100 },
  { headingDeg: 6, pitchDeg: 0, rollDeg: 0 }, 0.1, 120, true);
const resumedVisual = interpolateControllableVisualState(interpolationCache, 'SMOOTH',
  { lat: 50, lng: 30.002, altitudeM: 100 },
  { headingDeg: 6, pitchDeg: 0, rollDeg: 0 }, 0.1, 1_120, false);
assert.ok(Math.abs(resumedVisual.position.lng - pausedVisual.position.lng) < 1e-9,
  'Resume shifts interpolation time anchors instead of producing a giant delta');

const coarseDt = advanceFor(makeLevelEntity('DT-50'), 8,
  { throttle: 0.7, pitch: 0.2, yaw: 0.25, roll: 0.18 }, 0.05);
const fineDt = advanceFor(makeLevelEntity('DT-25'), 8,
  { throttle: 0.7, pitch: 0.2, yaw: 0.25, roll: 0.18 }, 0.025);
assert.ok(Math.abs(coarseDt.speedMps - fineDt.speedMps) < 1.5);
assert.ok(Math.abs(coarseDt.heading - fineDt.heading) < 2.5,
  'Controller integration remains stable when a fixed step is subdivided');

const stressStart = performance.now();
let entities = Array.from({ length: 8 }, (_, index) => makeLevelEntity(`PERF-${index}`));
for (let step = 0; step < 2_000; step += 1) {
  entities = entities.map((entity, index) => advanceControllableAirEntity(entity, 0.05,
    index === 0
      ? { throttle: 0.7, pitch: 0.12, yaw: 0.15, roll: 0.1 }
      : null));
}
const stressElapsedMs = performance.now() - stressStart;
assert.ok(entities.every(hasFiniteControllableState));

console.log('FPV Flight Physics Rebuild V1 deterministic checks passed.');
console.log(`Natural level speed: ${straight.speedKmh.toFixed(1)} km/h`);
console.log(`Moderate/aggressive endurance: ${(moderateBattery.elapsedSec / 60).toFixed(2)} / ${(aggressiveBattery.elapsedSec / 60).toFixed(2)} min`);
console.log(`8 FPV × 2,000 force-based steps: ${stressElapsedMs.toFixed(2)} ms`);
