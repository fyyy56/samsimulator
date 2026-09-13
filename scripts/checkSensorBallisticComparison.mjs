import assert from 'node:assert/strict';
import { INTERCEPTOR_SPECS } from '../src/data/interceptors.js';
import { SIMPLE_TARGET_TYPE } from '../src/data/airTargetProfiles.js';
import { getBearing, getDestinationPoint, getDistanceKm } from '../src/store/geo.js';
import { createAirTarget, advanceAirTarget } from '../src/store/airTargetSystem.js';
import { advanceInterceptorGuidance, createInterceptorGuidance } from '../src/store/interceptorGuidance.js';
import { advanceInterceptorFlight, applyAltitudeEnergyExchange } from '../src/store/interceptorPhysics.js';
import { advanceSimpleAltitude } from '../src/store/interceptorAltitudePhysics.js';
import { INTERCEPTOR_LAUNCH_PHASE } from '../src/store/interceptorLaunch.js';
import { applySensorScanOpportunities } from '../src/store/sensorDetection.js';
import {
  TRACK_STATE,
  applySensorEvidenceObservation,
  coastTrack,
} from '../src/store/trackSystem.js';

const DT = 0.05;
const launch = { lat: 48, lng: 28 };
const aim = getDestinationPoint(launch.lat, launch.lng, 72, 190);
const physics = INTERCEPTOR_SPECS['INT-LONG-V1'].gameplayPhysics;
const radarBattery = {
  id: 'TEST-PATRIOT', category: 'LONG', operational: true, status: 'ACTIVE',
  radarRangeKm: 150, radarSector: 120, radarHeading: 252,
  radarScanType: 'ELECTRONIC_SECTOR',
  components: { radar: { id: 'TEST-PATRIOT-RADAR', lat: aim.lat, lng: aim.lng, operational: true } },
};

const makeTarget = () => createAirTarget({
  id: 'BALLISTIC-SENSOR-V2',
  modelId: 'ISKANDER_M',
  type: SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE,
  spawnPosition: launch,
  destination: aim,
  route: [aim],
  speedKmh: 0,
  altitudeM: 20,
  ballisticPhysics: {
    enabled: true,
    aimPoint: aim,
    terminalCorrection: { angleDeg: 2, count: 1, side: 'RIGHT', seed: 7 },
  },
}, 0);

const makeIdealTrack = (target, time) => ({
  id: 'TRK-BALLISTIC', targetId: target.id, state: TRACK_STATE.TRACKED,
  reportedPosition: { lat: target.position.lat, lng: target.position.lng, alt: target.altitudeM },
  reportedAltitudeM: target.altitudeM,
  reportedHeading: target.heading,
  reportedSpeedKmh: target.ballisticPhysics.horizontalSpeedMps * 3.6,
  reportedHorizontalSpeedKmh: target.ballisticPhysics.horizontalSpeedMps * 3.6,
  reportedVerticalSpeedMps: target.verticalSpeedMps,
  estimatedTurnRateDegPerSec: 0,
  lastUpdateTime: time,
  lastMeasurementTime: time,
  lastPredictionTime: time,
  trackQuality: 1,
});

function seedRealisticTrack(target, time) {
  let contact = null;
  let observation = null;
  for (let pass = 0; pass < 18; pass += 1) {
    const result = applySensorScanOpportunities({
      existingContact: contact,
      battery: radarBattery,
      target,
      opportunityCount: 1,
      simulationTime: time + pass * 0.1,
    });
    contact = result.contact;
    observation = result.observation ?? observation;
  }
  const track = applySensorEvidenceObservation({
    existingTrack: null,
    target,
    observation,
    simulationTime: time,
    trackId: 'TRK-BALLISTIC',
  });
  return { contact, track };
}

const run = (mode) => {
  let target = makeTarget();
  let time = 0;
  while (target.state === 'ALIVE' && time < 400) {
    target = advanceAirTarget(target, DT);
    time += DT;
    if (target.flightPhase === 'TERMINAL'
      && target.ballisticPhysics.terminalCorrection.state === 'ACTIVE') break;
  }
  let sensor = mode === 'REALISTIC' ? seedRealisticTrack(target, time) : null;
  let track = mode === 'IDEAL' ? makeIdealTrack(target, time) : sensor.track;
  assert.ok(track, `${mode}: initial Track exists`);
  const heading = getBearing(aim.lat, aim.lng, track.reportedPosition.lat, track.reportedPosition.lng);
  let missile = {
    id: `PAC3-${mode}`, lat: aim.lat, lng: aim.lng, altitudeM: 20,
    heading, speedKmh: physics.initialSpeedMps * 3.6,
    flightTime: 0, distanceTraveledKm: 0, criticalEnergyTimeSec: 0,
    energyRatio: 0, verticalSpeedMps: 0, timeSinceClosestApproachSec: 0,
    closestApproachKm: Infinity, launchPhase: INTERCEPTOR_LAUNCH_PHASE.GUIDANCE,
    guidanceEnableDelaySec: 0, initialLaunchAccelerationMps2: 0,
    initialAccelerationDurationSec: 0,
    guidance: createInterceptorGuidance(track, time, null, aim),
  };
  let closestApproachM = Infinity;
  let maximumTrackErrorM = 0;
  let nextMeasurementTime = time + 0.1;
  for (let step = 0; step < 2_400 && target.state === 'ALIVE'; step += 1) {
    target = advanceAirTarget(target, DT);
    time += DT;
    if (mode === 'IDEAL') track = makeIdealTrack(target, time);
    else if (time + 1e-6 >= nextMeasurementTime) {
      const result = applySensorScanOpportunities({
        existingContact: sensor.contact,
        existingTrack: track,
        battery: radarBattery,
        target,
        opportunityCount: 1,
        simulationTime: time,
      });
      sensor.contact = result.contact;
      if (result.observation) track = applySensorEvidenceObservation({
        existingTrack: track,
        target,
        observation: result.observation,
        simulationTime: time,
        trackId: track.id,
      });
      nextMeasurementTime += 0.1;
    } else track = coastTrack(track, time, DT);
    const trackErrorM = Math.hypot(
      getDistanceKm(track.reportedPosition.lat, track.reportedPosition.lng,
        target.position.lat, target.position.lng) * 1000,
      (track.reportedAltitudeM ?? track.reportedPosition.alt ?? 0) - target.altitudeM,
    );
    maximumTrackErrorM = Math.max(maximumTrackErrorM, trackErrorM);
    const guidance = advanceInterceptorGuidance({ interceptor: missile, track,
      simulationTime: time, deltaTimeSec: DT, physics });
    if (guidance.failedReason) break;
    const headingChangeDeg = Math.abs(((guidance.heading - missile.heading + 540) % 360) - 180);
    let flight = advanceInterceptorFlight(missile, DT, physics, {
      headingChangeDeg, headingCorrectionDeg: guidance.headingCorrectionDeg,
      altitudeM: missile.altitudeM,
    });
    const altitude = advanceSimpleAltitude({
      interceptor: { ...missile, ...guidance },
      targetAltitudeM: guidance.guidance.commandPosition.alt ?? track.reportedAltitudeM,
      deltaTimeSec: DT, travelDistanceKm: flight.travelDistanceKm, physics,
    });
    flight = applyAltitudeEnergyExchange(
      flight, altitude.altitudeM - missile.altitudeM, DT, physics,
    );
    const position = getDestinationPoint(
      missile.lat, missile.lng, guidance.heading, altitude.horizontalDistanceKm,
    );
    const horizontalM = getDistanceKm(
      position.lat, position.lng, target.position.lat, target.position.lng,
    ) * 1000;
    const distanceM = Math.hypot(horizontalM, altitude.altitudeM - target.altitudeM);
    closestApproachM = Math.min(closestApproachM, distanceM);
    const improved = distanceM / 1000 < missile.closestApproachKm;
    missile = {
      ...missile, ...flight, ...guidance, ...position,
      altitudeM: altitude.altitudeM,
      verticalSpeedMps: altitude.verticalSpeedMps,
      closestApproachKm: improved ? distanceM / 1000 : missile.closestApproachKm,
      timeSinceClosestApproachSec: improved ? 0 : missile.timeSinceClosestApproachSec + DT,
    };
    if (distanceM <= Math.min(
      physics.proximityFuseRadiusM,
      physics.minimumVisualContactDistanceM ?? physics.proximityFuseRadiusM,
    ) || flight.terminated) break;
  }
  return { mode, closestApproachM, maximumTrackErrorM };
};

const results = [run('IDEAL'), run('REALISTIC')];
results.forEach(result => assert.ok(Number.isFinite(result.closestApproachM), `${result.mode}: finite closest approach`));
console.table(results.map(result => ({
  mode: result.mode,
  closestApproachM: Number(result.closestApproachM.toFixed(1)),
  maximumTrackErrorM: Number(result.maximumTrackErrorM.toFixed(1)),
})));
