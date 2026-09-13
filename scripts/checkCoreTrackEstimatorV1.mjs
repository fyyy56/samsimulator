import assert from 'node:assert/strict';
import { INTERCEPTOR_SPECS } from '../src/data/interceptors.js';
import { getBearing, getDestinationPoint, getDistanceKm } from '../src/store/geo.js';
import {
  estimateTargetState,
  normalizeHeadingDelta,
  solveDynamicIntercept,
} from '../src/store/missileGuidanceCore.js';
import {
  applySensorEvidenceObservation,
  coastTrack,
} from '../src/store/trackSystem.js';

const DT = 0.5;
const QUALITY = 0.82;
const SPEED_KMH = 720;
const ALTITUDE_M = 4_000;
const POSITION_UNCERTAINTY_M = 115;
const HEADING_ERRORS = [1.7, -1.5, 1.2, -1.8, 0.9, -0.8, 1.5, -1.1];
const SPEED_ERRORS = [0.028, -0.024, 0.018, -0.03, 0.014, -0.012, 0.025, -0.02];
const ALONG_ERRORS_M = [92, -78, 68, -96, 54, -62, 86, -70];
const CROSS_ERRORS_M = [-64, 71, -58, 82, -47, 55, -75, 61];
const clamp01 = value => Math.max(0, Math.min(1, value));
const positionWithAltitude = (position, altitudeM) => ({
  lat: position.lat, lng: position.lng, lon: position.lng, alt: altitudeM,
});

const offsetPosition = (position, heading, alongM, crossM) => {
  const along = getDestinationPoint(position.lat, position.lng, heading, alongM / 1000);
  return getDestinationPoint(along.lat, along.lng, heading + 90, crossM / 1000);
};

const makeMeasurement = (truth, sequence, sensorId = 'DIAG-RADAR') => {
  const index = sequence % HEADING_ERRORS.length;
  const position = offsetPosition(truth.position, truth.heading,
    ALONG_ERRORS_M[index], CROSS_ERRORS_M[index]);
  const altitudeErrorM = CROSS_ERRORS_M[index] * 0.65;
  return {
    timestamp: truth.time,
    sensorId,
    sourceBatteryId: sensorId,
    targetId: 'DIAG-TARGET',
    position: positionWithAltitude(position, truth.altitudeM + altitudeErrorM),
    altitudeM: truth.altitudeM + altitudeErrorM,
    speedKmh: truth.speedKmh * (1 + SPEED_ERRORS[index]),
    headingDeg: (truth.heading + HEADING_ERRORS[index] + 360) % 360,
    verticalSpeedMps: 0,
    quality: QUALITY,
    positionUncertaintyM: POSITION_UNCERTAINTY_M,
    altitudeUncertaintyM: 75,
    velocityUncertaintyMps: 5.5,
    headingUncertaintyDeg: 1.8,
  };
};

const observation = measurement => ({
  targetId: 'DIAG-TARGET',
  sourceBatteryId: measurement.sourceBatteryId,
  sourceRadarId: measurement.sensorId,
  bestSensorId: measurement.sensorId,
  lastMeasurementSensorId: measurement.sensorId,
  stage: 'IDENTIFIED',
  evidence: 1,
  quality: measurement.quality,
  classificationConfidence: 1,
  identificationConfidence: 1,
  measurement,
});

const advanceTruth = (truth, turnRateDegPerSec = 0) => {
  const midpointHeading = truth.heading + turnRateDegPerSec * DT * 0.5;
  const position = getDestinationPoint(truth.position.lat, truth.position.lng,
    midpointHeading, truth.speedKmh * DT / 3600);
  return {
    ...truth,
    time: truth.time + DT,
    heading: (truth.heading + turnRateDegPerSec * DT + 360) % 360,
    position,
  };
};

const legacyUpdate = (existingTrack, measurement, time) => {
  if (!existingTrack) return {
    reportedPosition: positionWithAltitude(measurement.position, measurement.altitudeM),
    reportedAltitudeM: measurement.altitudeM,
    reportedSpeedKmh: measurement.speedKmh,
    reportedHorizontalSpeedKmh: measurement.speedKmh,
    reportedHeading: measurement.headingDeg,
    reportedVerticalSpeedMps: 0,
    estimatedTurnRateDegPerSec: 0,
    lastMeasuredPosition: measurement.position,
    lastUpdateTime: time,
  };
  const elapsedSec = Math.max(0.05, time - existingTrack.lastUpdateTime);
  const predicted = getDestinationPoint(existingTrack.reportedPosition.lat,
    existingTrack.reportedPosition.lng, existingTrack.reportedHeading,
    existingTrack.reportedSpeedKmh * elapsedSec / 3600);
  const displacementKm = getDistanceKm(existingTrack.lastMeasuredPosition.lat,
    existingTrack.lastMeasuredPosition.lng, measurement.position.lat, measurement.position.lng);
  const displacementSpeedKmh = displacementKm / elapsedSec * 3600;
  const displacementHeading = displacementKm > 0.001
    ? getBearing(existingTrack.lastMeasuredPosition.lat, existingTrack.lastMeasuredPosition.lng,
      measurement.position.lat, measurement.position.lng)
    : measurement.headingDeg;
  const displacementWeight = clamp01(elapsedSec / 2) * (0.12 + measurement.quality * 0.2);
  const stableMeasuredSpeedKmh = existingTrack.reportedSpeedKmh * 0.25
    + measurement.speedKmh * 0.75;
  const speedKmh = displacementSpeedKmh * displacementWeight
    + stableMeasuredSpeedKmh * (1 - displacementWeight);
  const measuredHeading = existingTrack.reportedHeading
    + normalizeHeadingDelta(measurement.headingDeg - existingTrack.reportedHeading)
      * (0.55 + measurement.quality * 0.3);
  const heading = (measuredHeading
    + normalizeHeadingDelta(displacementHeading - measuredHeading) * displacementWeight
    + 360) % 360;
  const rawTurnRate = normalizeHeadingDelta(heading - existingTrack.reportedHeading) / elapsedSec;
  const filterWeight = Math.max(0.35, Math.min(0.88, 0.4 + measurement.quality * 0.45));
  const altitudeM = existingTrack.reportedAltitudeM
    + (measurement.altitudeM - existingTrack.reportedAltitudeM) * filterWeight;
  return {
    ...existingTrack,
    reportedPosition: positionWithAltitude({
      lat: predicted.lat + (measurement.position.lat - predicted.lat) * filterWeight,
      lng: predicted.lng + (measurement.position.lng - predicted.lng) * filterWeight,
    }, altitudeM),
    reportedAltitudeM: altitudeM,
    reportedSpeedKmh: speedKmh,
    reportedHorizontalSpeedKmh: speedKmh,
    reportedHeading: heading,
    estimatedTurnRateDegPerSec: existingTrack.estimatedTurnRateDegPerSec * 0.65
      + rawTurnRate * 0.35,
    lastMeasuredPosition: measurement.position,
    lastUpdateTime: time,
  };
};

const missile = {
  lat: 49.85, lng: 29.75, altitudeM: 4_000, heading: 45,
  speedKmh: 2_300, flightTime: 10, distanceTraveledKm: 5, energyRatio: 0.65,
  verticalSpeedMps: 0,
};
const physics = INTERCEPTOR_SPECS['INT-MEDIUM-V1'].gameplayPhysics;
const guidanceSample = (track, time) => {
  const guidance = {
    reportedPosition: track.reportedPosition,
    reportedHeading: track.reportedHeading,
    reportedSpeedKmh: track.reportedSpeedKmh,
    reportedHorizontalSpeedKmh: track.reportedHorizontalSpeedKmh,
    reportedVerticalSpeedMps: track.reportedVerticalSpeedMps,
    estimatedTurnRateDegPerSec: track.estimatedTurnRateDegPerSec,
    trackLastUpdateTime: time,
  };
  const targetState = estimateTargetState(guidance, time);
  return solveDynamicIntercept({ interceptor: missile, targetState, physics });
};

const calculateStepDistanceM = (first, second) => getDistanceKm(
  first.lat, first.lng, second.lat, second.lng,
) * 1000;

const runStraight = () => {
  let truth = { time: 0, position: { lat: 50, lng: 30 }, altitudeM: ALTITUDE_M,
    heading: 90, speedKmh: SPEED_KMH };
  let track = null;
  let legacy = null;
  let previousAim = null;
  let previousLegacyAim = null;
  const aimDeltas = [];
  const legacyAimDeltas = [];
  const headingErrors = [];
  const speedErrors = [];
  let finalMeasurement = null;
  let finalSolution = null;
  for (let sequence = 0; sequence < 48; sequence += 1) {
    truth = advanceTruth(truth);
    const measurement = makeMeasurement(truth, sequence);
    track = applySensorEvidenceObservation({
      existingTrack: track,
      target: { id: 'DIAG-TARGET', type: 'CRUISE_TARGET', modelId: 'KH_555' },
      observation: observation(measurement),
      simulationTime: truth.time,
      trackId: 'TRK-DIAG',
    });
    legacy = legacyUpdate(legacy, measurement, truth.time);
    const solution = guidanceSample(track, truth.time);
    const legacySolution = guidanceSample(legacy, truth.time);
    if (sequence >= 8) {
      headingErrors.push(Math.abs(normalizeHeadingDelta(track.reportedHeading - truth.heading)));
      speedErrors.push(Math.abs(track.reportedSpeedKmh - truth.speedKmh));
      if (previousAim) aimDeltas.push(calculateStepDistanceM(previousAim, solution.rawInterceptPoint));
      if (previousLegacyAim) legacyAimDeltas.push(calculateStepDistanceM(
        previousLegacyAim, legacySolution.rawInterceptPoint));
    }
    previousAim = solution.rawInterceptPoint;
    previousLegacyAim = legacySolution.rawInterceptPoint;
    finalMeasurement = measurement;
    finalSolution = solution;
  }
  return {
    truth,
    measurement: finalMeasurement,
    track,
    guidance: finalSolution,
    maxHeadingErrorDeg: Math.max(...headingErrors),
    averageSpeedErrorKmh: speedErrors.reduce((sum, value) => sum + value, 0) / speedErrors.length,
    maxAimDeltaM: Math.max(...aimDeltas),
    legacyMaxAimDeltaM: Math.max(...legacyAimDeltas),
  };
};

const runManeuver = () => {
  let truth = { time: 0, position: { lat: 50, lng: 30 }, altitudeM: ALTITUDE_M,
    heading: 90, speedKmh: SPEED_KMH };
  let track = null;
  let errorFourSecondsAfterTurn = null;
  let peakEstimatedTurnRate = 0;
  for (let sequence = 0; sequence < 48; sequence += 1) {
    const turnRate = truth.time >= 6 && truth.time < 14 ? 5 : 0;
    truth = advanceTruth(truth, turnRate);
    const measurement = makeMeasurement(truth, sequence);
    track = applySensorEvidenceObservation({ existingTrack: track,
      target: { id: 'DIAG-TARGET', type: 'CRUISE_TARGET', modelId: 'KH_555' },
      observation: observation(measurement), simulationTime: truth.time, trackId: 'TRK-TURN' });
    peakEstimatedTurnRate = Math.max(peakEstimatedTurnRate,
      Math.abs(track.estimatedTurnRateDegPerSec));
    if (Math.abs(truth.time - 18) < 0.01) {
      errorFourSecondsAfterTurn = Math.abs(normalizeHeadingDelta(
        track.reportedHeading - truth.heading));
    }
  }
  return { truth, track, errorFourSecondsAfterTurn, peakEstimatedTurnRate };
};

const runCoast = () => {
  let truth = { time: 0, position: { lat: 50, lng: 30 }, altitudeM: ALTITUDE_M,
    heading: 90, speedKmh: SPEED_KMH };
  let track = null;
  for (let sequence = 0; sequence < 24; sequence += 1) {
    truth = advanceTruth(truth);
    const measurement = makeMeasurement(truth, sequence);
    track = applySensorEvidenceObservation({ existingTrack: track,
      target: { id: 'DIAG-TARGET', type: 'CRUISE_TARGET', modelId: 'KH_555' },
      observation: observation(measurement), simulationTime: truth.time, trackId: 'TRK-COAST' });
  }
  const uncertaintyBefore = track.positionUncertaintyM;
  for (let step = 0; step < 8; step += 1) {
    truth = advanceTruth(truth);
    track = coastTrack(track, truth.time, DT);
  }
  const uncertaintyAfter = track.positionUncertaintyM;
  const speedBeforeReacquire = track.reportedSpeedKmh;
  const positionBeforeReacquire = track.reportedPosition;
  const measurement = makeMeasurement(truth, 105, 'DIAG-RADAR-2');
  track = applySensorEvidenceObservation({ existingTrack: track,
    target: { id: 'DIAG-TARGET', type: 'CRUISE_TARGET', modelId: 'KH_555' },
    observation: observation(measurement), simulationTime: truth.time, trackId: 'TRK-COAST' });
  return {
    uncertaintyBefore,
    uncertaintyAfter,
    reacquireSpeedDeltaKmh: Math.abs(track.reportedSpeedKmh - speedBeforeReacquire),
    reacquirePositionCorrectionM: calculateStepDistanceM(positionBeforeReacquire,
      track.reportedPosition),
    track,
  };
};

const straight = runStraight();
const maneuver = runManeuver();
const coast = runCoast();

assert.ok(straight.maxHeadingErrorDeg < 2.2,
  `A: straight Track heading must remain stable (${straight.maxHeadingErrorDeg.toFixed(2)}°)`);
assert.ok(straight.averageSpeedErrorKmh < 12,
  `A: straight Track speed error must remain bounded (${straight.averageSpeedErrorKmh.toFixed(1)} km/h)`);
assert.ok(straight.maxAimDeltaM < straight.legacyMaxAimDeltaM * 0.6,
  `A: intercept oscillation must materially improve (${straight.maxAimDeltaM.toFixed(1)} vs ${straight.legacyMaxAimDeltaM.toFixed(1)} m)`);
assert.ok(maneuver.peakEstimatedTurnRate > 1,
  'B: estimator must detect a sustained real turn');
assert.ok(maneuver.errorFourSecondsAfterTurn < 12,
  `B: estimator must converge after a real turn (${maneuver.errorFourSecondsAfterTurn.toFixed(1)}°)`);
assert.ok(coast.uncertaintyAfter > coast.uncertaintyBefore,
  'C: uncertainty must grow while Track is coasting');
assert.ok(coast.reacquireSpeedDeltaKmh < 35,
  `C: reacquisition must not create a velocity spike (${coast.reacquireSpeedDeltaKmh.toFixed(1)} km/h)`);
assert.ok(coast.reacquirePositionCorrectionM < 250,
  `C: reacquisition correction must be bounded (${coast.reacquirePositionCorrectionM.toFixed(1)} m)`);

console.log(JSON.stringify({
  status: 'PASS',
  straight: {
    maxHeadingErrorDeg: +straight.maxHeadingErrorDeg.toFixed(2),
    averageSpeedErrorKmh: +straight.averageSpeedErrorKmh.toFixed(2),
    legacyMaxAimDeltaM: +straight.legacyMaxAimDeltaM.toFixed(1),
    estimatorMaxAimDeltaM: +straight.maxAimDeltaM.toFixed(1),
    improvementPercent: +(100 * (1 - straight.maxAimDeltaM
      / straight.legacyMaxAimDeltaM)).toFixed(1),
  },
  maneuver: {
    peakEstimatedTurnRateDegSec: +maneuver.peakEstimatedTurnRate.toFixed(2),
    headingErrorFourSecAfterTurnDeg: +maneuver.errorFourSecondsAfterTurn.toFixed(2),
  },
  coast: {
    uncertaintyBeforeM: +coast.uncertaintyBefore.toFixed(1),
    uncertaintyAfterM: +coast.uncertaintyAfter.toFixed(1),
    reacquireSpeedDeltaKmh: +coast.reacquireSpeedDeltaKmh.toFixed(1),
    reacquirePositionCorrectionM: +coast.reacquirePositionCorrectionM.toFixed(1),
  },
  diagnosticSample: {
    trueState: {
      position: straight.truth.position,
      velocityKmh: straight.truth.speedKmh,
      courseDeg: straight.truth.heading,
      altitudeM: straight.truth.altitudeM,
    },
    measurement: {
      position: straight.measurement.position,
      altitudeM: straight.measurement.altitudeM,
      quality: straight.measurement.quality,
    },
    track: {
      position: straight.track.reportedPosition,
      speedKmh: straight.track.reportedSpeedKmh,
      headingDeg: straight.track.reportedHeading,
      verticalSpeedMps: straight.track.reportedVerticalSpeedMps,
      positionUncertaintyM: straight.track.positionUncertaintyM,
      velocityUncertaintyMps: straight.track.velocityUncertaintyMps,
      headingUncertaintyDeg: straight.track.headingUncertaintyDeg,
      accelerationMps2: straight.track.estimatedAccelerationMps2,
      turnRateDegSec: straight.track.estimatedTurnRateDegPerSec,
      residualM: straight.track.estimatorInnovationM,
    },
    guidance: {
      predictedIntercept: straight.guidance.rawInterceptPoint,
      timeToGoSec: straight.guidance.timeToGoSec,
      aimPoint: straight.guidance.interceptPoint,
    },
  },
}, null, 2));
