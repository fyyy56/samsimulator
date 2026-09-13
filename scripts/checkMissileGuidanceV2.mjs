import assert from 'node:assert/strict';
import { INTERCEPTOR_SPECS } from '../src/data/interceptors.js';
import { getDestinationPoint, getDistanceKm } from '../src/store/geo.js';
import {
  INTERCEPTOR_GUIDANCE_STATE,
  advanceInterceptorGuidance,
  createInterceptorGuidance,
} from '../src/store/interceptorGuidance.js';
import { advanceInterceptorFlight } from '../src/store/interceptorPhysics.js';
import { INTERCEPTOR_LAUNCH_PHASE } from '../src/store/interceptorLaunch.js';
import { TRACK_STATE } from '../src/store/trackSystem.js';

const DT = 0.05;
const SPEC_IDS = ['INT-ASTER30-V1', 'INT-LONG-V1', 'INT-SHORT-V1', 'INT-MEDIUM-V1'];

const makeTrack = (target, time) => ({
  id: 'TRK-TEST', targetId: 'TGT-TEST', state: TRACK_STATE.TRACKED,
  reportedPosition: { lat: target.lat, lng: target.lng, alt: target.altitudeM },
  reportedHeading: target.heading, reportedSpeedKmh: target.speedKmh,
  reportedVerticalSpeedMps: target.verticalSpeedMps ?? 0,
  estimatedTurnRateDegPerSec: target.turnRateDegPerSec ?? 0,
  lastUpdateTime: time,
});

const simulate = ({ specId, targetHeading, targetSpeedKmh, turnRateDegPerSec = 0,
  missileHeading = 0, targetEastKm = 10, targetNorthKm = 10 }) => {
  const physics = INTERCEPTOR_SPECS[specId].gameplayPhysics;
  const origin = { lat: 49, lng: 31 };
  const north = getDestinationPoint(origin.lat, origin.lng, 0, targetNorthKm);
  const startTarget = getDestinationPoint(north.lat, north.lng, 90, targetEastKm);
  let target = { ...startTarget, altitudeM: 2_000, heading: targetHeading,
    speedKmh: targetSpeedKmh, turnRateDegPerSec, verticalSpeedMps: 0 };
  const initialTrack = makeTrack(target, 0);
  let missile = {
    id: `TEST-${specId}`, lat: origin.lat, lng: origin.lng, altitudeM: 2_000,
    heading: missileHeading, speedKmh: Math.max(physics.minimumEffectiveSpeedMps * 3.6 * 1.8, 2_100),
    flightTime: physics.motorBurnTimeSec + 0.1, distanceTraveledKm: 5,
    energyRatio: 0.58, criticalEnergyTimeSec: 0, verticalSpeedMps: 0,
    launchPhase: INTERCEPTOR_LAUNCH_PHASE.GUIDANCE, guidanceEnableDelaySec: 0,
    timeSinceClosestApproachSec: 0, closestApproachKm: Infinity,
    guidance: createInterceptorGuidance(initialTrack, 0, null, origin),
  };
  let closestApproachM = Infinity;
  let previousDistanceKm = Infinity;
  let maximumStepTurnDeg = 0;
  let peakActualG = 0;
  let maximumTurnRateDegPerSec = 0;
  let terminalSeen = false;
  for (let time = DT; time <= 70; time += DT) {
    target.heading = (target.heading + turnRateDegPerSec * DT + 360) % 360;
    const targetStep = getDestinationPoint(target.lat, target.lng, target.heading,
      target.speedKmh * DT / 3600);
    target = { ...target, ...targetStep };
    const track = makeTrack(target, time);
    const guidance = advanceInterceptorGuidance({ interceptor: missile, track,
      simulationTime: time, deltaTimeSec: DT, physics });
    if (guidance.failedReason) break;
    const headingDelta = Math.abs(((guidance.heading - missile.heading + 540) % 360) - 180);
    maximumStepTurnDeg = Math.max(maximumStepTurnDeg, headingDelta);
    peakActualG = Math.max(peakActualG, guidance.currentG ?? 0);
    maximumTurnRateDegPerSec = Math.max(maximumTurnRateDegPerSec,
      Math.abs(guidance.turnRateDegPerSec ?? 0));
    const flight = advanceInterceptorFlight(missile, DT, physics, {
      headingChangeDeg: headingDelta,
      headingCorrectionDeg: guidance.headingCorrectionDeg,
      altitudeM: missile.altitudeM,
    });
    const next = getDestinationPoint(missile.lat, missile.lng, guidance.heading, flight.travelDistanceKm);
    const distanceKm = getDistanceKm(next.lat, next.lng, target.lat, target.lng);
    const improved = distanceKm < missile.closestApproachKm;
    missile = { ...missile, ...flight, ...guidance, ...next,
      closestApproachKm: improved ? distanceKm : missile.closestApproachKm,
      timeSinceClosestApproachSec: improved ? 0 : missile.timeSinceClosestApproachSec + DT };
    closestApproachM = Math.min(closestApproachM, distanceKm * 1000);
    terminalSeen ||= guidance.guidanceState === INTERCEPTOR_GUIDANCE_STATE.TERMINAL;
    if (distanceKm * 1000 <= Math.min(physics.proximityFuseRadiusM,
      physics.minimumVisualContactDistanceM ?? physics.proximityFuseRadiusM)) break;
    if (flight.terminated || (distanceKm > previousDistanceKm && distanceKm > 20)) break;
    previousDistanceKm = distanceKm;
  }
  return { closestApproachM, maximumStepTurnDeg, peakActualG,
    maximumTurnRateDegPerSec, terminalSeen, missile };
};

const scenarios = [
  { id: 'A_STATIC', targetHeading: 0, targetSpeedKmh: 0, targetEastKm: 0, targetNorthKm: 14 },
  { id: 'B_CROSSING', targetHeading: 90, targetSpeedKmh: 700, targetEastKm: -5, targetNorthKm: 14 },
  { id: 'C_HEAD_ON', targetHeading: 180, targetSpeedKmh: 900, targetEastKm: 0, targetNorthKm: 18 },
  { id: 'D_TAIL', targetHeading: 0, targetSpeedKmh: 450, targetEastKm: 0, targetNorthKm: 9 },
  { id: 'E_SMOOTH_TURN', targetHeading: 70, targetSpeedKmh: 650, turnRateDegPerSec: 1.2,
    targetEastKm: -4, targetNorthKm: 13 },
  { id: 'F_SHARP_TURN', targetHeading: 70, targetSpeedKmh: 650, turnRateDegPerSec: 5,
    targetEastKm: -4, targetNorthKm: 13 },
];

const results = [];
for (const specId of SPEC_IDS) {
  for (const scenario of scenarios) {
    const result = simulate({ specId, ...scenario });
    assert.ok(Number.isFinite(result.closestApproachM), `${specId} ${scenario.id}: finite closest approach`);
    assert.ok(result.maximumStepTurnDeg < 4, `${specId} ${scenario.id}: no instantaneous course jump`);
    if (scenario.id !== 'F_SHARP_TURN') {
      assert.ok(result.closestApproachM < 1_500,
        `${specId} ${scenario.id}: guidance should form a useful intercept (${result.closestApproachM.toFixed(1)}m)`);
    }
    results.push({ specId, scenario: scenario.id, closestApproachM: result.closestApproachM,
      peakActualG: result.peakActualG, maximumTurnRateDegPerSec: result.maximumTurnRateDegPerSec });
  }
}

const reattackProbe = (specId, energyRatio, speedMultiplier, heading = 180) => {
  const physics = INTERCEPTOR_SPECS[specId].gameplayPhysics;
  const targetPosition = getDestinationPoint(49, 31, 0, 5);
  const target = { ...targetPosition, altitudeM: 1_000, heading: 0, speedKmh: 250 };
  const track = makeTrack(target, 20);
  const missile = { id: 'REATTACK', lat: 49, lng: 31, altitudeM: 1_000,
    heading, speedKmh: physics.minimumEffectiveSpeedMps * 3.6 * speedMultiplier,
    flightTime: physics.motorBurnTimeSec + 3, distanceTraveledKm: 10,
    energyRatio, verticalSpeedMps: 0, launchPhase: INTERCEPTOR_LAUNCH_PHASE.GUIDANCE,
    guidanceEnableDelaySec: 0, timeSinceClosestApproachSec: physics.postPassContinueSec + 0.1,
    closestApproachKm: 0.2, guidance: createInterceptorGuidance(track, 20, null, { lat: 49, lng: 31 }) };
  return advanceInterceptorGuidance({ interceptor: missile, track,
    simulationTime: 20.05, deltaTimeSec: 0.05, physics });
};

const reattack = reattackProbe('INT-ASTER30-V1', 0.7, 2.5, 180);
assert.equal(reattack.guidanceState, INTERCEPTOR_GUIDANCE_STATE.REATTACK,
  'G: energetic missile may enter REATTACK');
const lost = reattackProbe('INT-MEDIUM-V1', 0.03, 0.7, 180);
assert.equal(lost.guidanceState, INTERCEPTOR_GUIDANCE_STATE.INTERCEPT_LOST,
  'H: depleted missile enters INTERCEPT_LOST');

console.table(results.map(result => ({ ...result,
  closestApproachM: Number(result.closestApproachM.toFixed(1)),
  peakActualG: Number(result.peakActualG.toFixed(1)),
  maximumTurnRateDegPerSec: Number(result.maximumTurnRateDegPerSec.toFixed(1)) })));
console.log('G REATTACK:', reattack.guidanceState, 'H LOST:', lost.guidanceState);
