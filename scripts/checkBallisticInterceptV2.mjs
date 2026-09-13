import assert from 'node:assert/strict';
import { INTERCEPTOR_SPECS } from '../src/data/interceptors.js';
import { SIMPLE_TARGET_TYPE } from '../src/data/airTargetProfiles.js';
import { getBearing, getDestinationPoint, getDistanceKm } from '../src/store/geo.js';
import { createAirTarget, advanceAirTarget } from '../src/store/airTargetSystem.js';
import { advanceInterceptorGuidance, createInterceptorGuidance } from '../src/store/interceptorGuidance.js';
import { advanceInterceptorFlight, applyAltitudeEnergyExchange } from '../src/store/interceptorPhysics.js';
import { advanceSimpleAltitude } from '../src/store/interceptorAltitudePhysics.js';
import { INTERCEPTOR_LAUNCH_PHASE } from '../src/store/interceptorLaunch.js';
import { TRACK_STATE } from '../src/store/trackSystem.js';

const DT = 0.05;
const launch = { lat: 48, lng: 28 };
const aim = getDestinationPoint(launch.lat, launch.lng, 72, 190);

const makeBallistic = angleDeg => createAirTarget({
  id: `BALLISTIC-${angleDeg}`,
  type: SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE,
  spawnPosition: launch,
  destination: aim,
  route: [aim],
  speedKmh: 0,
  altitudeM: 20,
  ballisticPhysics: { enabled: true, aimPoint: aim,
    terminalCorrection: { angleDeg, count: angleDeg > 0 ? 1 : 0, side: 'RIGHT', seed: 7 } },
}, 0);

const makeTrack = (target, time) => ({
  id: 'TRK-BALLISTIC', targetId: target.id, state: TRACK_STATE.TRACKED,
  reportedPosition: { lat: target.position.lat, lng: target.position.lng, alt: target.altitudeM },
  reportedHeading: target.heading, reportedSpeedKmh: target.speedKmh,
  reportedVerticalSpeedMps: target.verticalSpeedMps,
  estimatedTurnRateDegPerSec: 0, lastUpdateTime: time,
});

const run = (specId, angleDeg) => {
  const physics = INTERCEPTOR_SPECS[specId].gameplayPhysics;
  let target = makeBallistic(angleDeg);
  let time = 0;
  while (target.state === 'ALIVE' && time < 400) {
    target = advanceAirTarget(target, DT);
    time += DT;
    const correctionReady = angleDeg === 0
      || target.ballisticPhysics.terminalCorrection.state === 'ACTIVE';
    if (target.flightPhase === 'TERMINAL' && correctionReady) break;
  }
  const initialTrack = makeTrack(target, time);
  const heading = getBearing(aim.lat, aim.lng, target.position.lat, target.position.lng);
  let missile = {
    id: `${specId}-${angleDeg}`, lat: aim.lat, lng: aim.lng, altitudeM: 20,
    heading, speedKmh: physics.initialSpeedMps * 3.6,
    flightTime: 0, distanceTraveledKm: 0, criticalEnergyTimeSec: 0,
    energyRatio: 0, verticalSpeedMps: 0, timeSinceClosestApproachSec: 0,
    closestApproachKm: Infinity, launchPhase: INTERCEPTOR_LAUNCH_PHASE.GUIDANCE,
    guidanceEnableDelaySec: 0, initialLaunchAccelerationMps2: 0,
    initialAccelerationDurationSec: 0,
    guidance: createInterceptorGuidance(initialTrack, time, null, aim),
  };
  let closestApproachM = Infinity;
  let maximumLosRateDegPerSec = 0;
  for (let step = 0; step < 2_400 && target.state === 'ALIVE'; step += 1) {
    target = advanceAirTarget(target, DT);
    time += DT;
    const track = makeTrack(target, time);
    const guidance = advanceInterceptorGuidance({ interceptor: missile, track,
      simulationTime: time, deltaTimeSec: DT, physics });
    if (guidance.failedReason) break;
    const headingChangeDeg = Math.abs(((guidance.heading - missile.heading + 540) % 360) - 180);
    let flight = advanceInterceptorFlight(missile, DT, physics, {
      headingChangeDeg, headingCorrectionDeg: guidance.headingCorrectionDeg,
      altitudeM: missile.altitudeM,
    });
    const altitude = advanceSimpleAltitude({ interceptor: { ...missile, ...guidance },
      targetAltitudeM: guidance.guidance.commandPosition.alt ?? target.altitudeM,
      deltaTimeSec: DT, travelDistanceKm: flight.travelDistanceKm, physics });
    flight = applyAltitudeEnergyExchange(flight, altitude.altitudeM - missile.altitudeM, DT, physics);
    const position = getDestinationPoint(missile.lat, missile.lng,
      guidance.heading, altitude.horizontalDistanceKm);
    const horizontalM = getDistanceKm(position.lat, position.lng,
      target.position.lat, target.position.lng) * 1000;
    const distanceM = Math.hypot(horizontalM, altitude.altitudeM - target.altitudeM);
    const improved = distanceM / 1000 < missile.closestApproachKm;
    closestApproachM = Math.min(closestApproachM, distanceM);
    maximumLosRateDegPerSec = Math.max(maximumLosRateDegPerSec,
      Math.abs(guidance.losRateDegPerSec ?? 0));
    missile = { ...missile, ...flight, ...guidance, ...position,
      altitudeM: altitude.altitudeM, verticalSpeedMps: altitude.verticalSpeedMps,
      closestApproachKm: improved ? distanceM / 1000 : missile.closestApproachKm,
      timeSinceClosestApproachSec: improved ? 0 : missile.timeSinceClosestApproachSec + DT };
    if (distanceM <= Math.min(physics.proximityFuseRadiusM,
      physics.minimumVisualContactDistanceM ?? physics.proximityFuseRadiusM)) break;
    if (flight.terminated) break;
  }
  return { specId, angleDeg, closestApproachM, maximumLosRateDegPerSec };
};

const results = ['INT-LONG-V1', 'INT-ASTER30-V1'].flatMap(specId => [0, 1, 2]
  .map(angleDeg => run(specId, angleDeg)));
results.forEach(result => {
  assert.ok(Number.isFinite(result.closestApproachM), 'intercept comparison remains finite');
  assert.ok(result.maximumLosRateDegPerSec > 0, 'guidance observes ballistic LOS motion');
});
console.table(results.map(result => ({
  interceptor: INTERCEPTOR_SPECS[result.specId].publicDisplay.displayName,
  correction: `${result.angleDeg}°`,
  closestApproachM: Number(result.closestApproachM.toFixed(1)),
  maximumLosRateDegPerSec: Number(result.maximumLosRateDegPerSec.toFixed(3)),
})));
