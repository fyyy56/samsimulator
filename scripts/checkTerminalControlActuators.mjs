import assert from 'node:assert/strict';
import { Cartesian3, JulianDate } from 'cesium';
import { INTERCEPTOR_SPECS } from '../src/data/interceptors.js';
import { applyMissileAutopilot } from '../src/store/missileGuidanceCore.js';
import { advanceInterceptorFlight } from '../src/store/interceptorPhysics.js';
import { advanceInterceptorGuidance, createInterceptorGuidance } from '../src/store/interceptorGuidance.js';
import { getDestinationPoint, getDistanceKm } from '../src/store/geo.js';
import { visualBodyQuaternion, pushVisualSnapshot, sampleVisualState } from '../src/scenes/advanced/visualInterpolation.js';
import { getTerminalJetCommand, getTerminalJetFrame, createTerminalControlVfx } from '../src/scenes/advanced/terminalControlVfx.js';

const magnitude = v => Math.hypot(v.eastMps, v.northMps, v.upMps);
const baseMissile = { heading: 0, flightPathAngleDeg: 0, speedKmh: 3600,
  flightTime: 20, distanceTraveledKm: 10, altitudeM: 5000, criticalEnergyTimeSec: 0 };
const command = { commandedAccelerationVectorMps2: { eastMps: 180, northMps: 0, upMps: 60 },
  availableAccelerationMps2: 350, predictedClosestApproachM: 150, closingSpeedMps: 1200 };
const context = { terminal: true, solutionStatus: 'VALID', timeToGoSec: 1.5, directionErrorDeg: 10 };
const step = (physics, missile = baseMissile, controlContext = context, cmd = command, dt = 0.02) => (
  applyMissileAutopilot({ interceptor: missile, physics, command: cmd, deltaTimeSec: dt, controlContext })
);
const aster = INTERCEPTOR_SPECS['INT-ASTER30-V1'].gameplayPhysics;
const pac = INTERCEPTOR_SPECS['INT-LONG-V1'].gameplayPhysics;
const oldPhysics = p => ({ ...p, controlActuators: null });

// Capability boundaries and the unchanged midcourse response.
assert.deepEqual(Object.entries(INTERCEPTOR_SPECS).filter(([, s]) => s.gameplayPhysics?.controlActuators)
  .map(([id]) => id), ['INT-LONG-V1', 'INT-ASTER30-V1']);
for (const spec of Object.values(INTERCEPTOR_SPECS)) {
  const p = spec.gameplayPhysics;
  if (!p) continue;
  const actual = step(p, baseMissile, { ...context, terminal: false });
  const baseline = step(oldPhysics(p), baseMissile, { ...context, terminal: false });
  for (const key of ['heading', 'flightPathAngleDeg', 'actualTotalAccelerationMps2']) {
    assert.ok(Math.abs(actual[key] - baseline[key]) < 1e-10, `${spec.id}: unchanged midcourse ${key}`);
  }
  if (!p.controlActuators) assert.deepEqual(actual, baseline, `${spec.id}: unchanged autopilot`);
}
for (const p of [aster, pac]) {
  for (const [ctx, cmd] of [[context, { ...command, predictedClosestApproachM: 0 }],
    [{ ...context, solutionStatus: 'INVALID' }, command],
    [context, { ...command, predictedClosestApproachM: 100_000 }],
    [context, { ...command, closingSpeedMps: -100 }]]) {
    const result = step(p, baseMissile, ctx, cmd).controlActuators;
    assert.equal(result.pifActive, false);
    assert.equal(result.acmPulse, undefined);
  }
}

const asterFirst = step(aster);
const asterOff = step(oldPhysics(aster));
assert.ok(asterFirst.actualTotalAccelerationMps2 > asterOff.actualTotalAccelerationMps2);
assert.ok(asterFirst.controlActuators.bodyHeadingDeg < asterFirst.heading,
  'PIF changes flight path before the body follows');
assert.ok(asterFirst.actualTotalAccelerationMps2 <= command.availableAccelerationMps2);
const pacFirst = step(pac);
const pacNoPulse = step({ ...pac, controlActuators: { ...pac.controlActuators, pulseBudget: 0 } });
assert.ok(pacFirst.controlActuators.bodyHeadingDeg > pacNoPulse.controlActuators.bodyHeadingDeg,
  'ACM pulse accelerates attitude response');
assert.ok(pacFirst.controlActuators.bodyHeadingDeg > pacFirst.heading,
  'body attitude changes ahead of the flight path');
assert.equal(magnitude(pacFirst.controlActuators.pifAccelerationVectorMps2), 0);
assert.deepEqual(pacFirst.actualAccelerationVectorMps2,
  pacFirst.controlActuators.aerodynamicAccelerationVectorMps2, 'PAC acceleration is entirely aero');

// Resource exhaustion and timestep bounds: reversing the demand exercises
// repeated discrete corrections rather than a constant thruster command.
for (const [p, name] of [[aster, 'PIF'], [pac, 'ACM']]) {
  let missile = { ...baseMissile }, used = 0, serial = 0;
  const events = [];
  const limited = { ...p, controlActuators: { ...p.controlActuators,
    resourceMps: 4, pulseBudget: 3 } };
  for (let i = 0; i < 300; i++) {
    const sign = Math.floor(i / 20) % 2 ? -1 : 1;
    const result = step(limited, missile, context, { ...command,
      commandedAccelerationVectorMps2: { eastMps: sign * 180, northMps: 0, upMps: 0 } });
    const state = result.controlActuators;
    assert.ok(state.angleOfAttackDeg <= limited.controlActuators.maxAngleOfAttackDeg + 0.01);
    assert.ok(result.actualTotalAccelerationMps2 <= command.availableAccelerationMps2 + 1e-6);
    assert.ok(Math.abs(result.headingTurnRateDegPerSec) * 0.02 < 1, 'no teleport turn');
    used += magnitude(state.pifAccelerationVectorMps2) * 0.02;
    if (state.acmPulse?.id > serial) {
      serial = state.acmPulse.id; events.push(state.acmPulse.flightTimeSec);
    }
    missile = { ...missile, ...result, flightTime: missile.flightTime + 0.02 };
  }
  if (name === 'PIF') {
    assert.ok(used <= 4 + 1e-8);
    assert.ok(missile.controlActuators.pifResourceRemainingMps < 1e-8);
    assert.equal(missile.controlActuators.pifActive, false);
  } else {
    assert.equal(events.length, 3);
    assert.equal(missile.controlActuators.acmPulsesRemaining, 0);
    events.slice(1).forEach((time, i) => assert.ok(time - events[i] >= p.controlActuators.pulseCooldownSec));
  }
}

// Same geometry and same guidance before/after: run through closest approach
// instead of stopping at fuse radius, so distance changes can be compared.
function benchmark(specId, eastKm, enabled, dt = 0.02) {
  const base = INTERCEPTOR_SPECS[specId].gameplayPhysics;
  const physics = enabled ? base : oldPhysics(base);
  const north = getDestinationPoint(49, 31, 0, 1.2);
  const target = getDestinationPoint(north.lat, north.lng, 90, eastKm);
  const track = { id: 'BENCHMARK', state: 'TRACKED', reportedPosition: { ...target, alt: 5000 },
    reportedHeading: 180, reportedSpeedKmh: 0, lastUpdateTime: 0 };
  let missile = { ...baseMissile, lat: 49, lng: 31, closestApproachKm: Infinity,
    timeSinceClosestApproachSec: 0, launchPhase: 'GUIDANCE',
    guidance: createInterceptorGuidance(track, 0), seeker: { enabled: false } };
  let closestM = Infinity, pif = 0, turnLossMps = 0, pulses = 0;
  for (let t = dt; t < 3; t += dt) {
    const guidance = advanceInterceptorGuidance({ interceptor: missile, physics,
      track: { ...track, lastUpdateTime: t }, simulationTime: t, deltaTimeSec: dt });
    if (guidance.failedReason) break;
    const headingChangeDeg = Math.abs(((guidance.heading - missile.heading + 540) % 360) - 180);
    const flight = advanceInterceptorFlight(missile, dt, physics, { headingChangeDeg,
      headingCorrectionDeg: guidance.directionCorrectionDeg, controlActuators: guidance.controlActuators });
    const position = getDestinationPoint(missile.lat, missile.lng, guidance.heading, flight.travelDistanceKm);
    const distanceM = getDistanceKm(position.lat, position.lng, target.lat, target.lng) * 1000;
    const improved = distanceM < closestM;
    closestM = Math.min(closestM, distanceM);
    pif = Math.max(pif, guidance.controlActuators?.pifIntensity ?? 0);
    pulses = guidance.controlActuators?.acmPulse?.id ?? 0;
    turnLossMps += flight.turnLossMps2 * dt;
    missile = { ...missile, ...guidance, ...flight, ...position, closestApproachKm: closestM / 1000,
      timeSinceClosestApproachSec: improved ? 0 : missile.timeSinceClosestApproachSec + dt };
    assert.ok(missile.speedKmh < baseMissile.speedKmh, 'coast correction never grants a speed boost');
    if (!improved && t > 1) break;
  }
  return { closestM, turnLossMps, pif, pulses, speedMps: missile.speedKmh / 3.6 };
}
const rows = [];
for (const [id, east] of [['INT-ASTER30-V1', 0.15], ['INT-LONG-V1', 0.25]]) {
  const before = benchmark(id, east, false), after = benchmark(id, east, true);
  assert.ok(after.closestM < before.closestM, `${id}: useful small terminal correction`);
  if (id === 'INT-ASTER30-V1') {
    assert.ok(after.pif > 0 && after.turnLossMps < before.turnLossMps,
      'PIF does not get charged as an aerodynamic turn');
  } else {
    assert.ok(after.pulses > 0 && after.turnLossMps > before.turnLossMps,
      'attitude-driven aero correction incurs existing turn loss');
  }
  const headOn = benchmark(id, 0, true);
  assert.equal(headOn.pif, 0); assert.equal(headOn.pulses, 0);
  const fine = benchmark(id, east, true, 0.01);
  assert.ok(fine.closestM < 20 && after.closestM < 20, 'bounded response at both timesteps');
  rows.push({ id, beforeMissM: before.closestM.toFixed(2), afterMissM: after.closestM.toFixed(2),
    beforeTurnLossMps: before.turnLossMps.toFixed(2), afterTurnLossMps: after.turnLossMps.toFixed(2),
    pifIntensity: after.pif.toFixed(2), acmPulses: after.pulses });
}

// Visual event timing, force/exhaust direction and persistent resource cleanup.
const worldPosition = Cartesian3.fromDegrees(31, 49, 5000);
const makeVisual = (result, flightTime = 20.02) => ({ worldPosition,
  quaternion: visualBodyQuaternion({ headingDeg: result.controlActuators.bodyHeadingDeg,
    pitchDeg: result.controlActuators.bodyPitchDeg }),
  kinematics: { controlActuators: result.controlActuators, flightTime, guidanceEnabled: true } });
const pacVisual = makeVisual(pacFirst);
assert.equal(getTerminalJetCommand(pacVisual.kinematics).eventId, 1);
assert.equal(getTerminalJetCommand(makeVisual(pacFirst, 20.1).kinematics), null, 'no continuous PAC flame');
assert.equal(getTerminalJetCommand(makeVisual(pacFirst, 19.99).kinematics), null, 'no flash before event');
const presentation = { physicalLengthMeters: 5.2, baseVisualScale: 1.45 };
const frame = getTerminalJetFrame(pacVisual, presentation, getTerminalJetCommand(pacVisual.kinematics));
assert.ok(Cartesian3.distance(frame.origin, worldPosition) < 3, 'compact forward-body attachment');
const pool = [];
const viewer = { entities: { add: e => { pool.push(e); return e; },
  remove: e => pool.splice(pool.indexOf(e), 1) } };
let visual = pacVisual, visualMode = 'DAY';
const vfx = createTerminalControlVfx(viewer, { flash: 'tor-mini-flame' }, {
  getPose: () => visual, getVisualMode: () => visualMode });
vfx.update('PAC', {}, visual, presentation);
assert.equal(pool.length, 6);
assert.equal(pool[0].billboard.disableDepthTestDistance, 0);
const jetOrigin = pool[0].position.getValue(new JulianDate());
const jetTip = pool[5].position.getValue(new JulianDate());
assert.ok(Cartesian3.dot(Cartesian3.subtract(jetTip, jetOrigin, new Cartesian3()), frame.exhaust) > 0);
visual = { ...pacVisual, worldPosition: Cartesian3.add(worldPosition,
  new Cartesian3(100, 0, 0), new Cartesian3()) };
assert.ok(Cartesian3.distance(pool[0].position.getValue(new JulianDate()), jetOrigin) > 99,
  'jet callbacks follow the shared buffered model pose before preRender');
visual = makeVisual(pacFirst, 20.1);
vfx.update('PAC', {}, visual, presentation);
assert.ok(pool.every(e => !e.show));
visual = pacVisual;
for (let i = 0; i < 20; i++) vfx.update('PAC', {}, visual, presentation);
assert.equal(pool.length, 6, 'repeated updates reuse the same mini-flame lobes');
visualMode = 'THERMAL'; vfx.update('PAC', {}, visual, presentation);
assert.ok(pool.every(e => !e.show), 'thermal rendering is untouched');
vfx.destroy(); assert.equal(pool.length, 0, 'all jet resources are removed');

const cache = new Map();
pushVisualSnapshot(cache, 'BODY', { lat: 49, lng: 31, altitudeM: 5000 }, {
  headingDeg: pacFirst.controlActuators.bodyHeadingDeg,
  pitchDeg: pacFirst.controlActuators.bodyPitchDeg, eastMps: 0, northMps: 1000, upMps: 0,
  controlActuators: pacFirst.controlActuators, flightTime: 20.02 }, 1);
const buffered = sampleVisualState(cache, 'BODY', 1);
assert.ok(Math.abs(buffered.kinematics.headingDeg - pacFirst.controlActuators.bodyHeadingDeg) < 1e-8);
assert.equal(buffered.kinematics.eastMps, 0, 'body attitude does not overwrite translational velocity');
console.table(rows);
console.log('Terminal actuators: scoped response, budgets, energy, body/velocity distinction, timed jets and cleanup passed.');
