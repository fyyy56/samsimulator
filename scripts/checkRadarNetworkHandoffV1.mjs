import assert from 'node:assert/strict';
import { setupVisualScenario } from './visual-test-scenarios.js';
import { getDestinationPoint, getDistanceKm } from '../src/store/geo.js';
import { useEngine } from '../src/store/engine.js';
import {
  RADAR_SOURCE_TAKEOVER_RATIO,
  fuseSensorEvidence,
  scoreRadarSourceContact,
} from '../src/store/sensorDetection.js';
import { applySensorEvidenceObservation } from '../src/store/trackSystem.js';
import { getInterceptorSpec } from '../src/data/interceptors.js';
import { estimateTargetState, solveDynamicIntercept } from '../src/store/missileGuidanceCore.js';

const target = {
  id: 'NETWORK-TARGET', modelId: 'KH_555', type: 'CRUISE_TARGET',
  position: { lat: 50, lng: 30.1 }, altitudeM: 4_000, speedKmh: 720, heading: 90,
};
const makeMeasurement = (sensorId, position, quality, positionUncertaintyM,
  altitudeUncertaintyM, velocityUncertaintyMps) => ({
  timestamp: 10, sensorId, sourceBatteryId: sensorId, targetId: target.id,
  position: { ...position, alt: target.altitudeM }, altitudeM: target.altitudeM,
  speedKmh: target.speedKmh, headingDeg: target.heading, verticalSpeedMps: 0,
  quality, positionUncertaintyM, altitudeUncertaintyM, velocityUncertaintyMps,
  headingUncertaintyDeg: 1,
});
const makeContact = (id, measurement, evidence = 0.9) => ({
  id: `${id}:${target.id}`, targetId: target.id, sourceBatteryId: id,
  sourceRadarId: id, evidence, confirmedBefore: true, stage: 'IDENTIFIED',
  expectedRevisitSec: 2, lastScanTime: 10, lastOpportunityCount: 1,
  lastContribution: 0.1, lastMeasurement: measurement,
});

// D: exercise the real engine/network path with all three deployable search radars.
setupVisualScenario('RADAR');
for (let step = 0; step < 2_400; step += 1) useEngine.getState().tick();
const networkState = useEngine.getState();
assert.equal(networkState.searchRadars.length, 3,
  'D: fixture must contain P-18, 35D6 and Pelikan');
assert.equal(networkState.tracks.length, 1,
  'D: multiple radar sources must create one logical Track');
assert.ok(networkState.tracks[0].contributingSensors.length >= 2,
  'D: network Track must retain multiple contributing sensor identities');

const initialMeasurement = makeMeasurement('P18', target.position, 0.72, 180, 480, 9);
const initialObservation = {
  targetId: target.id, sourceBatteryId: 'P18', sourceRadarId: 'P18',
  stage: 'IDENTIFIED', evidence: 0.9, classificationConfidence: 1,
  identificationConfidence: 1, measurement: initialMeasurement,
};
const initialTrack = applySensorEvidenceObservation({
  existingTrack: null, target, observation: initialObservation,
  simulationTime: 10, trackId: 'TRK-HANDOFF',
});

const nearMeasurement = makeMeasurement('NEAR-PEER', target.position, 0.74, 172, 450, 8.7);
const currentContact = makeContact('P18', initialMeasurement);
const nearContact = makeContact('NEAR-PEER', nearMeasurement);
const nearRawScore = scoreRadarSourceContact(nearContact, 10);
const currentRawScore = scoreRadarSourceContact(currentContact, 10);
assert.ok(nearRawScore > currentRawScore,
  'E: near-peer fixture must be marginally better before hysteresis');
assert.ok(nearRawScore < currentRawScore * RADAR_SOURCE_TAKEOVER_RATIO,
  'E: near-peer fixture must remain inside hysteresis band');
const retained = fuseSensorEvidence({ contacts: [currentContact, nearContact], target,
  simulationTime: 10, existingTrack: initialTrack });
assert.equal(retained.sourceRadarId, 'P18',
  'E: a marginally better source must not cause scan-to-scan flapping');

const offset = getDestinationPoint(target.position.lat, target.position.lng, 0, 0.8);
const betterMeasurement = makeMeasurement('BETTER-SAM', offset, 0.98, 22, 28, 1.2);
const betterContact = makeContact('BETTER-SAM', betterMeasurement, 1);
const takeover = fuseSensorEvidence({ contacts: [currentContact, betterContact], target,
  simulationTime: 10, existingTrack: initialTrack });
assert.equal(takeover.sourceRadarId, 'BETTER-SAM',
  'E: a materially better source must take ownership');
const handedOffTrack = applySensorEvidenceObservation({ existingTrack: initialTrack,
  target, observation: takeover, simulationTime: 10.1, trackId: initialTrack.id });
assert.equal(handedOffTrack.id, initialTrack.id,
  'E: source handoff must preserve logical Track ID');
assert.equal(handedOffTrack.sourceHandoff.fromSensorId, 'P18');
assert.equal(handedOffTrack.sourceHandoff.toSensorId, 'BETTER-SAM');
assert.ok(Math.abs(handedOffTrack.reportedSpeedKmh - initialTrack.reportedSpeedKmh) < 5,
  'E: cross-sensor position offset must not become target velocity');
assert.ok(getDistanceKm(initialTrack.reportedPosition.lat, initialTrack.reportedPosition.lng,
  handedOffTrack.reportedPosition.lat, handedOffTrack.reportedPosition.lng) * 1000 < 220,
  'E: source handoff correction must be bounded');
const guidanceMissile = {
  lat: 49.82, lng: 29.72, altitudeM: 4_000, heading: 45, speedKmh: 2_300,
  flightTime: 10, distanceTraveledKm: 5, energyRatio: 0.7, verticalSpeedMps: 0,
};
const solveForTrack = (track, simulationTime) => solveDynamicIntercept({
  interceptor: guidanceMissile,
  targetState: estimateTargetState({
    reportedPosition: track.reportedPosition,
    reportedHeading: track.reportedHeading,
    reportedSpeedKmh: track.reportedSpeedKmh,
    reportedHorizontalSpeedKmh: track.reportedHorizontalSpeedKmh,
    reportedVerticalSpeedMps: track.reportedVerticalSpeedMps,
    estimatedTurnRateDegPerSec: track.estimatedTurnRateDegPerSec,
    trackLastUpdateTime: track.lastUpdateTime,
  }, simulationTime),
  physics: getInterceptorSpec('INT-MEDIUM-V1').gameplayPhysics,
});
const beforeHandoffSolution = solveForTrack(initialTrack, 10);
const afterHandoffSolution = solveForTrack(handedOffTrack, 10.1);
const aimPointDeltaM = getDistanceKm(beforeHandoffSolution.rawInterceptPoint.lat,
  beforeHandoffSolution.rawInterceptPoint.lng, afterHandoffSolution.rawInterceptPoint.lat,
  afterHandoffSolution.rawInterceptPoint.lng) * 1000;
assert.ok(aimPointDeltaM < 500,
  `E: source handoff must not teleport missile aim point (${aimPointDeltaM.toFixed(1)} m)`);

const offlineFallback = fuseSensorEvidence({ contacts: [currentContact, betterContact], target,
  simulationTime: 10, existingTrack: handedOffTrack, activeSourceIds: new Set(['P18']) });
assert.equal(offlineFallback.sourceRadarId, 'P18',
  'E: an offline current owner must yield to an available source');

console.log(JSON.stringify({
  status: 'PASS',
  multiRadar: {
    searchRadars: networkState.searchRadars.map(radar => radar.profileId),
    logicalTracks: networkState.tracks.length,
    contributingSensors: networkState.tracks[0].contributingSensors,
  },
  hysteresis: {
    takeoverRatio: RADAR_SOURCE_TAKEOVER_RATIO,
    currentScore: +currentRawScore.toFixed(4),
    nearPeerScore: +nearRawScore.toFixed(4),
    retainedSource: retained.sourceRadarId,
  },
  handoff: {
    trackId: handedOffTrack.id,
    from: handedOffTrack.sourceHandoff.fromSensorId,
    to: handedOffTrack.sourceHandoff.toSensorId,
    positionCorrectionM: +(getDistanceKm(initialTrack.reportedPosition.lat,
      initialTrack.reportedPosition.lng, handedOffTrack.reportedPosition.lat,
      handedOffTrack.reportedPosition.lng) * 1000).toFixed(1),
    speedDeltaKmh: +Math.abs(handedOffTrack.reportedSpeedKmh
      - initialTrack.reportedSpeedKmh).toFixed(2),
    aimPointDeltaM: +aimPointDeltaM.toFixed(1),
    offlineFallback: offlineFallback.sourceRadarId,
  },
}, null, 2));
