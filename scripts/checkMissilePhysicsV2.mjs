import assert from 'node:assert/strict';
import { getInterceptorSpec } from '../src/data/interceptors.js';
import {
  advanceInterceptorFlight,
  applyAltitudeEnergyExchange,
  getEffectiveTurnPerformance,
} from '../src/store/interceptorPhysics.js';
import {
  advanceInterceptorGuidance,
  createInterceptorGuidance,
} from '../src/store/interceptorGuidance.js';

const TIME_STEP_SEC = 0.05;

const simulate = ({
  specId,
  altitudeM,
  targetAltitudeM = altitudeM,
  targetDistanceKm = Number.POSITIVE_INFINITY,
  durationSec = Number.POSITIVE_INFINITY,
  turnRateDegPerSec = 0,
  timeStepSec = TIME_STEP_SEC,
}) => {
  const spec = getInterceptorSpec(specId);
  const physics = spec.gameplayPhysics;
  let missile = {
    speedKmh: physics.launchSpeedKmh,
    flightTime: 0,
    distanceTraveledKm: 0,
    altitudeM,
    criticalEnergyTimeSec: 0,
  };
  let burnoutSpeedKmh = null;
  while (
    missile.distanceTraveledKm < targetDistanceKm
    && missile.flightTime < durationSec
    && !missile.terminated
  ) {
    const stepSec = Math.min(timeStepSec, durationSec - missile.flightTime);
    if (!(stepSec > 0)) break;
    const rawResult = advanceInterceptorFlight(missile, stepSec, physics, {
      altitudeM: missile.altitudeM,
      headingChangeDeg: turnRateDegPerSec * stepSec,
    });
    const altitudeDeltaM = Math.sign(targetAltitudeM - missile.altitudeM) * Math.min(
      Math.abs(targetAltitudeM - missile.altitudeM),
      physics.climbRateMps * stepSec,
    );
    const result = applyAltitudeEnergyExchange(rawResult, altitudeDeltaM, stepSec, physics);
    missile = { ...missile, ...result };
    missile.altitudeM += altitudeDeltaM;
    if (burnoutSpeedKmh === null && missile.flightTime >= physics.motorBurnTimeSec) {
      burnoutSpeedKmh = missile.speedKmh;
    }
  }
  return {
    profile: spec.publicDisplay.displayName,
    altitudeM,
    finalAltitudeM: missile.altitudeM,
    requestedDistanceKm: Number.isFinite(targetDistanceKm) ? targetDistanceKm : null,
    reached: missile.distanceTraveledKm >= targetDistanceKm,
    flightTimeSec: missile.flightTime,
    distanceKm: missile.distanceTraveledKm,
    speedKmh: missile.speedKmh,
    burnoutSpeedKmh,
    motorPhase: missile.motorPhase,
    energyState: missile.energyState,
    terminated: missile.terminated,
  };
};

const iris = getInterceptorSpec('INT-SHORT-V1').gameplayPhysics;
const aim120 = getInterceptorSpec('INT-MEDIUM-V1').gameplayPhysics;
const pac3 = getInterceptorSpec('INT-LONG-V1').gameplayPhysics;

assert.equal(aim120.initialSpeedMps, 0);
assert.equal(iris.physicsConfidence, 'GAME_REFERENCE');
assert.equal(aim120.physicsConfidence, 'GAME_REFERENCE');
assert.equal(pac3.physicsConfidence, 'UNVERIFIED_REFERENCE');
assert.equal(pac3.motorBurnTimeSec, 19);
assert.equal(iris.turnRateDegPerSec, 60);
assert.equal(aim120.turnRateDegPerSec, 20);
assert.equal(pac3.turnRateDegPerSec, 35);

const sharedManeuverState = { speedMps: 700, energyRatio: 0.75 };
const irisTurn = getEffectiveTurnPerformance(sharedManeuverState, iris);
const aimTurn = getEffectiveTurnPerformance(sharedManeuverState, aim120);
const pacTurn = getEffectiveTurnPerformance(sharedManeuverState, pac3);
assert.ok(irisTurn.effectiveTurnRateDegPerSec > pacTurn.effectiveTurnRateDegPerSec);
assert.ok(pacTurn.effectiveTurnRateDegPerSec > aimTurn.effectiveTurnRateDegPerSec);
assert.ok(irisTurn.turnRadiusKm < aimTurn.turnRadiusKm);
const depletedIrisTurn = getEffectiveTurnPerformance({ speedMps: 280, energyRatio: 0.12 }, iris);
assert.ok(depletedIrisTurn.effectiveTurnRateDegPerSec < irisTurn.effectiveTurnRateDegPerSec * 0.5);

const maneuveringTrack = {
  id: 'TRK-MANEUVER',
  state: 'TRACKED',
  reportedPosition: { lat: 0.05, lng: 0.08, alt: 1_000 },
  reportedHeading: 95,
  reportedSpeedKmh: 700,
  lastUpdateTime: 1,
};
const compareGuidanceTurn = physics => {
  const interceptor = {
    lat: 0,
    lng: 0,
    heading: 0,
    speedKmh: 2_520,
    speedMps: 700,
    energyRatio: 0.75,
    flightTime: 12,
    guidance: createInterceptorGuidance(maneuveringTrack, 0),
  };
  return advanceInterceptorGuidance({
    interceptor,
    track: maneuveringTrack,
    simulationTime: 1,
    deltaTimeSec: 1,
    physics,
  });
};
const irisGuidanceTurn = compareGuidanceTurn(iris);
const aimGuidanceTurn = compareGuidanceTurn(aim120);
assert.ok(irisGuidanceTurn.heading > aimGuidanceTurn.heading);

for (const specId of ['INT-SHORT-V1', 'INT-MEDIUM-V1', 'INT-LONG-V1']) {
  const physics = getInterceptorSpec(specId).gameplayPhysics;
  const atBurnout = simulate({ specId, altitudeM: 500, durationSec: physics.motorBurnTimeSec });
  const afterCoast = simulate({ specId, altitudeM: 500, durationSec: physics.motorBurnTimeSec + 12 });
  assert.ok(atBurnout.speedKmh > physics.launchSpeedKmh);
  assert.ok(afterCoast.speedKmh < atBurnout.speedKmh);

  const lowAltitude = simulate({ specId, altitudeM: 100, durationSec: physics.motorBurnTimeSec + 20 });
  const highAltitude = simulate({ specId, altitudeM: 10_000, durationSec: physics.motorBurnTimeSec + 20 });
  assert.ok(highAltitude.speedKmh > lowAltitude.speedKmh);

  const straight = simulate({ specId, altitudeM: 2_000, durationSec: physics.motorBurnTimeSec + 8 });
  const turning = simulate({
    specId,
    altitudeM: 2_000,
    durationSec: physics.motorBurnTimeSec + 8,
    turnRateDegPerSec: physics.turnRateDegPerSec * 0.7,
  });
  assert.ok(turning.speedKmh < straight.speedKmh);
}

const pac3DistanceTests = [30, 50, 80].flatMap(distanceKm => [
  simulate({ specId: 'INT-LONG-V1', altitudeM: 100, targetDistanceKm: distanceKm }),
  simulate({ specId: 'INT-LONG-V1', altitudeM: 10_000, targetDistanceKm: distanceKm }),
]);

const engagementDistanceTests = ['INT-SHORT-V1', 'INT-MEDIUM-V1', 'INT-LONG-V1']
  .flatMap(specId => [20, 50].map(targetDistanceKm => simulate({
    specId,
    altitudeM: 100,
    targetDistanceKm,
  })));
const lowTargetTest = simulate({
  specId: 'INT-MEDIUM-V1',
  altitudeM: 0,
  targetAltitudeM: 100,
  targetDistanceKm: 20,
});
const ballisticTargetTest = simulate({
  specId: 'INT-LONG-V1',
  altitudeM: 0,
  targetAltitudeM: 20_000,
  targetDistanceKm: 50,
});
assert.ok(lowTargetTest.reached);
assert.ok(ballisticTargetTest.finalAltitudeM > 10_000);

const pacAtFineStep = simulate({
  specId: 'INT-LONG-V1',
  altitudeM: 2_000,
  durationSec: 60,
  timeStepSec: 1 / 30,
});
const pacAtTwentyTimesStep = simulate({
  specId: 'INT-LONG-V1',
  altitudeM: 2_000,
  durationSec: 60,
  timeStepSec: 20 / 30,
});
assert.ok(Math.abs(pacAtFineStep.speedKmh - pacAtTwentyTimesStep.speedKmh) / pacAtFineStep.speedKmh < 0.03);
assert.ok(Math.abs(pacAtFineStep.distanceKm - pacAtTwentyTimesStep.distanceKm) / pacAtFineStep.distanceKm < 0.03);

console.log(JSON.stringify({
  pac3MotorBurnTimeSec: pac3.motorBurnTimeSec,
  pac3DistanceTests,
  engagementDistanceTests,
  lowTargetTest,
  ballisticTargetTest,
  timeScaleStability: {
    fineStep: pacAtFineStep,
    twentyTimesStep: pacAtTwentyTimesStep,
  },
}, null, 2));
