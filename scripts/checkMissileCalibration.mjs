import assert from 'node:assert/strict';
import { getInterceptorSpec } from '../src/data/interceptors.js';
import { advanceInterceptorFlight } from '../src/store/interceptorPhysics.js';

const STEP_SEC = 0.05;
const ALTITUDE_M = 500;

const simulate = ({ specId, distanceKm, maneuver = false }) => {
  const physics = getInterceptorSpec(specId).gameplayPhysics;
  let missile = {
    speedKmh: physics.launchSpeedKmh,
    flightTime: 0,
    distanceTraveledKm: 0,
    altitudeM: ALTITUDE_M,
    criticalEnergyTimeSec: 0,
  };
  let peakSpeedMps = 0;
  let burnoutSpeedMps = null;
  let maximumDragDecelerationMps2 = 0;
  let accumulatedTurnLossMps = 0;
  const telemetry = [];

  while (missile.distanceTraveledKm < distanceKm && !missile.terminated) {
    const maneuverStartSec = physics.motorBurnTimeSec + 2;
    const maneuverActive = maneuver
      && missile.flightTime >= maneuverStartSec
      && missile.flightTime < maneuverStartSec + 3;
    const headingChangeDeg = maneuverActive
      ? physics.turnRateDegPerSec * 0.45 * STEP_SEC
      : 0;
    const headingCorrectionDeg = maneuverActive ? 30 : headingChangeDeg;
    const next = advanceInterceptorFlight(missile, STEP_SEC, physics, {
      altitudeM: ALTITUDE_M,
      headingChangeDeg,
      headingCorrectionDeg,
    });
    missile = { ...missile, ...next };
    peakSpeedMps = Math.max(peakSpeedMps, next.speedMps);
    maximumDragDecelerationMps2 = Math.max(
      maximumDragDecelerationMps2,
      next.dragDecelerationMps2,
    );
    accumulatedTurnLossMps += next.turnLossMps2 * STEP_SEC;
    if (burnoutSpeedMps === null && next.motorTimeLeftSec <= 0) {
      burnoutSpeedMps = next.speedMps;
    }
    if (Math.abs((next.flightTime / 2) - Math.round(next.flightTime / 2)) < 1e-6) {
      telemetry.push({
        timeSec: Number(next.flightTime.toFixed(2)),
        distanceKm: Number(next.distanceTraveledKm.toFixed(3)),
        speedMps: Number(next.speedMps.toFixed(1)),
        motorTimeLeftSec: Number(next.motorTimeLeftSec.toFixed(2)),
        dragDecelerationMps2: Number(next.dragDecelerationMps2.toFixed(2)),
        turnLossMps2: Number(next.turnLossMps2.toFixed(2)),
        energyState: next.energyState,
      });
    }
  }

  return {
    specId,
    distanceKm,
    maneuver,
    reached: missile.distanceTraveledKm >= distanceKm,
    flightTimeSec: Number(missile.flightTime.toFixed(2)),
    traveledDistanceKm: Number(missile.distanceTraveledKm.toFixed(3)),
    peakSpeedMps: Number(peakSpeedMps.toFixed(1)),
    burnoutSpeedMps: Number((burnoutSpeedMps ?? missile.speedMps).toFixed(1)),
    interceptSpeedMps: Number(missile.speedMps.toFixed(1)),
    maximumDragDecelerationMps2: Number(maximumDragDecelerationMps2.toFixed(2)),
    accumulatedTurnLossMps: Number(accumulatedTurnLossMps.toFixed(2)),
    energyState: missile.energyState,
    telemetry,
  };
};

const cases = ['INT-MEDIUM-V1', 'INT-SHORT-V1'].flatMap(specId => [
  simulate({ specId, distanceKm: 5 }),
  simulate({ specId, distanceKm: 20 }),
  simulate({ specId, distanceKm: 20, maneuver: true }),
]);

const byCase = (specId, distanceKm, maneuver = false) => cases.find(result => (
  result.specId === specId
  && result.distanceKm === distanceKm
  && result.maneuver === maneuver
));

for (const result of cases) assert.equal(result.reached, true, `${result.specId} must reach ${result.distanceKm} km`);

const aimFive = byCase('INT-MEDIUM-V1', 5);
const irisFive = byCase('INT-SHORT-V1', 5);
const irisTwenty = byCase('INT-SHORT-V1', 20);
assert.ok(aimFive.peakSpeedMps >= 760 && aimFive.peakSpeedMps <= 785);
assert.ok(irisFive.peakSpeedMps >= 850 && irisFive.peakSpeedMps <= 980);
assert.ok(irisTwenty.peakSpeedMps >= 940 && irisTwenty.peakSpeedMps <= 980);

for (const specId of ['INT-MEDIUM-V1', 'INT-SHORT-V1']) {
  const straight = byCase(specId, 20);
  const maneuvering = byCase(specId, 20, true);
  assert.ok(maneuvering.interceptSpeedMps < straight.interceptSpeedMps);
  assert.ok(maneuvering.interceptSpeedMps > straight.interceptSpeedMps * 0.55);
}

const getTurnLoss = (specId, headingChangeDeg, headingCorrectionDeg) => {
  const physics = getInterceptorSpec(specId).gameplayPhysics;
  const result = advanceInterceptorFlight({
    speedKmh: physics.maxSpeedKmh * 0.85,
    flightTime: physics.motorBurnTimeSec + 1,
    distanceTraveledKm: 10,
    altitudeM: ALTITUDE_M,
    criticalEnergyTimeSec: 0,
  }, STEP_SEC, physics, { altitudeM: ALTITUDE_M, headingChangeDeg, headingCorrectionDeg });
  return result.turnLossMps2;
};

const turnLossCurves = ['INT-MEDIUM-V1', 'INT-SHORT-V1'].map(specId => {
  const tiny = getTurnLoss(specId, 0.05, 2);
  const moderate = getTurnLoss(specId, 0.5, 30);
  const extreme = getTurnLoss(specId, 2, 90);
  assert.ok(tiny < moderate && moderate < extreme);
  assert.ok(extreme / tiny > 80, `${specId} turn-loss must strongly penalize extreme corrections`);
  return {
    specId,
    tinyTurnLossMps2: Number(tiny.toFixed(3)),
    moderateTurnLossMps2: Number(moderate.toFixed(3)),
    extremeTurnLossMps2: Number(extreme.toFixed(3)),
  };
});

console.log(JSON.stringify({ cases, turnLossCurves }, null, 2));
