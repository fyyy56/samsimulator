import { SENSOR_EVIDENCE_CONFIG } from '../data/sensorDetectionProfiles.js';
import { getTrackCoastSeconds } from './sensorCadence.js';
import { propagateTrackEstimate, updateTrackEstimate } from './trackEstimator.js';

export const TRACK_STATE = Object.freeze({
  DETECTED: 'DETECTED', TRACKED: 'TRACKED', IDENTIFIED: 'IDENTIFIED', LOST: 'LOST',
});
export const TRACK_MEMORY_SECONDS = SENSOR_EVIDENCE_CONFIG.reacquisitionMemorySec;

const INITIAL_QUALITY = 0.18;
const QUALITY_DECAY_PER_SECOND = 0.025;

export function formatTrackId(sequence) {
  return `TRK-${sequence.toString().padStart(3, '0')}`;
}

const positionWithAltitude = (position, altitudeM) => ({
  lat: position.lat,
  lng: position.lng ?? position.lon,
  lon: position.lng ?? position.lon,
  alt: altitudeM ?? position.alt ?? position.altitudeM ?? 0,
});

/** Extrapolates only the last estimated Track state; true target data never enters. */
export function predictTrack(track, simulationTime) {
  if (!track?.reportedPosition || track.lastUpdateTime == null) return track;
  const predictionAnchor = track.lastPredictionTime ?? track.lastUpdateTime;
  const deltaTimeSec = Math.max(0, simulationTime - predictionAnchor);
  if (deltaTimeSec <= 0) return {
    ...track,
    measurementAgeSec: Math.max(0, simulationTime - track.lastUpdateTime),
  };
  const propagated = propagateTrackEstimate(track, deltaTimeSec);
  return {
    ...track,
    ...propagated,
    estimatedPosition: propagated.reportedPosition,
    lastPredictionTime: simulationTime,
    measurementAgeSec: Math.max(0, simulationTime - track.lastUpdateTime),
    positionUncertaintyM: (track.positionUncertaintyM ?? 0)
      + SENSOR_EVIDENCE_CONFIG.trackPositionUncertaintyGrowthMps * deltaTimeSec,
    altitudeUncertaintyM: (track.altitudeUncertaintyM ?? 0)
      + SENSOR_EVIDENCE_CONFIG.trackAltitudeUncertaintyGrowthMps * deltaTimeSec,
    velocityUncertaintyMps: (track.velocityUncertaintyMps ?? 0)
      + SENSOR_EVIDENCE_CONFIG.trackVelocityUncertaintyGrowthMps * deltaTimeSec,
  };
}

/** Ideal sandbox/reference observation; deliberately bypasses realistic errors. */
export function applyRadarObservation({ existingTrack, target, sourceBatteryId, simulationTime, trackId }) {
  const measurement = {
    position: positionWithAltitude(target.position, target.altitudeM),
    altitudeM: target.altitudeM,
    speedKmh: target.ballisticPhysics?.horizontalSpeedMps != null
      ? target.ballisticPhysics.horizontalSpeedMps * 3.6 : target.speedKmh,
    headingDeg: target.heading,
    verticalSpeedMps: target.verticalSpeedMps ?? target.velocity?.verticalSpeedMps ?? 0,
    quality: 1,
    positionUncertaintyM: 0,
    altitudeUncertaintyM: 0,
    velocityUncertaintyMps: 0,
    headingUncertaintyDeg: 0,
  };
  return applySensorEvidenceObservation({
    existingTrack,
    target,
    observation: {
      targetId: target.id,
      stage: TRACK_STATE.IDENTIFIED,
      evidence: 1,
      classificationConfidence: 1,
      identificationConfidence: 1,
      broadClassification: target.type,
      identifiedType: target.type,
      identifiedModelId: target.modelId ?? null,
      sourceBatteryId,
      sourceRadarId: `${sourceBatteryId ?? 'IDEAL'}-IDEAL`,
      measurement,
      contributorCount: 1,
      scanOpportunityCount: 1,
    },
    simulationTime,
    trackId,
  });
}

/** Creates or refreshes a Track strictly from a sensor Measurement. */
export function applySensorEvidenceObservation({ existingTrack, target, observation, simulationTime, trackId }) {
  const measurement = observation?.measurement;
  if (!observation?.stage || !measurement?.position) return existingTrack ?? null;
  const predictedExisting = existingTrack ? predictTrack(existingTrack, simulationTime) : null;
  const wasLost = existingTrack?.state === TRACK_STATE.LOST;
  const hasTrackSolution = [TRACK_STATE.TRACKED, TRACK_STATE.IDENTIFIED].includes(observation.stage);
  const hasIdentification = observation.stage === TRACK_STATE.IDENTIFIED;
  const sourceChanged = Boolean(existingTrack?.sourceRadarId && observation.sourceRadarId
    && existingTrack.sourceRadarId !== observation.sourceRadarId);
  const estimate = updateTrackEstimate({
    existingTrack,
    predictedTrack: predictedExisting,
    measurement,
    simulationTime,
    sourceChanged,
    hasTrackSolution,
  });
  const evidenceMaximum = observation.thresholds?.identified
    ?? SENSOR_EVIDENCE_CONFIG.thresholds.identified;
  const trackQuality = Math.max(INITIAL_QUALITY,
    Math.min(1, observation.evidence / evidenceMaximum)) * (0.7 + measurement.quality * 0.3);
  const reportedSpeedKmh = estimate.reportedSpeedKmh;
  const reportedHeading = estimate.reportedHeading;
  const reportedPosition = estimate.reportedPosition;
  return {
    id: existingTrack?.id ?? trackId,
    targetId: observation.targetId ?? target?.id,
    state: observation.stage,
    reportedPosition,
    estimatedPosition: reportedPosition,
    lastMeasuredPosition: positionWithAltitude(measurement.position, measurement.altitudeM),
    lastUpdateTime: simulationTime,
    lastMeasurementTime: simulationTime,
    lastPredictionTime: simulationTime,
    measurementAgeSec: 0,
    trackQuality,
    consecutiveUpdates: existingTrack && !wasLost ? (existingTrack.consecutiveUpdates ?? 0) + 1 : 1,
    totalUpdates: (existingTrack?.totalUpdates ?? 0) + 1,
    identifiedType: hasIdentification ? (observation.identifiedType ?? target?.type ?? null) : null,
    identifiedModelId: hasIdentification ? (observation.identifiedModelId ?? target?.modelId ?? null) : null,
    classifiedType: hasTrackSolution
      ? (observation.broadClassification ?? existingTrack?.classifiedType ?? 'AIR_TARGET') : null,
    classificationConfidence: observation.classificationConfidence ?? 0,
    identificationConfidence: observation.identificationConfidence ?? 0,
    reportedSpeedKmh,
    reportedHorizontalSpeedKmh: reportedSpeedKmh,
    reportedHeading,
    reportedVerticalSpeedMps: estimate.reportedVerticalSpeedMps,
    estimatedVelocityEnuMps: estimate.estimatedVelocityEnuMps,
    estimatedAccelerationEnuMps2: estimate.estimatedAccelerationEnuMps2,
    estimatedAccelerationMps2: estimate.estimatedAccelerationMps2,
    estimatedLongitudinalAccelerationMps2: estimate.estimatedLongitudinalAccelerationMps2,
    estimatedVerticalAccelerationMps2: estimate.estimatedVerticalAccelerationMps2,
    estimatedTurnRateDegPerSec: estimate.estimatedTurnRateDegPerSec,
    reportedAltitudeM: estimate.reportedAltitudeM,
    sourceBatteryId: observation.sourceBatteryId,
    sourceRadarId: observation.sourceRadarId ?? null,
    sourceSelectedAt: sourceChanged || existingTrack?.sourceSelectedAt == null
      ? simulationTime
      : existingTrack.sourceSelectedAt,
    expectedRevisitSec: observation.expectedRevisitSec ?? null,
    contributingSensors: observation.contributingSensors
      ?? existingTrack?.contributingSensors
      ?? [observation.sourceRadarId].filter(Boolean),
    bestSensorId: observation.bestSensorId ?? observation.sourceRadarId ?? null,
    bestSensorScore: observation.bestSensorScore ?? existingTrack?.bestSensorScore ?? null,
    previousSourceScore: observation.previousSourceScore ?? null,
    sourceTakeoverRatio: observation.sourceTakeoverRatio ?? null,
    sourceDwellRemainingSec: observation.sourceDwellRemainingSec ?? 0,
    lastMeasurementSensorId: observation.lastMeasurementSensorId
      ?? observation.sourceRadarId
      ?? null,
    velocity: hasTrackSolution ? {
      speedKmh: reportedSpeedKmh,
      heading: reportedHeading,
      verticalSpeedMps: measurement.verticalSpeedMps,
    } : (existingTrack?.velocity ?? null),
    positionUncertaintyM: estimate.positionUncertaintyM,
    altitudeUncertaintyM: estimate.altitudeUncertaintyM,
    velocityUncertaintyMps: estimate.velocityUncertaintyMps,
    headingUncertaintyDeg: estimate.headingUncertaintyDeg,
    estimatorInnovationM: estimate.estimatorInnovationM,
    estimatorPositionGain: estimate.estimatorPositionGain,
    estimatorVelocityGain: estimate.estimatorVelocityGain,
    estimatorOutlierLimited: estimate.estimatorOutlierLimited,
    lastInnovationEnuM: estimate.lastInnovationEnuM,
    sourceHandoff: sourceChanged ? {
      fromSensorId: existingTrack.sourceRadarId,
      toSensorId: observation.sourceRadarId,
      simulationTime,
    } : existingTrack?.sourceHandoff ?? null,
    detectionEvidence: observation.evidence,
    sensorThresholds: observation.thresholds,
    lastSensorContribution: observation.lastContribution ?? 0,
    lastScanOpportunityCount: observation.scanOpportunityCount ?? 0,
    sensorContributorCount: observation.contributorCount ?? 1,
    reacquired: wasLost || observation.reacquisition === true,
  };
}

export function coastTrack(track, simulationTime, deltaTimeSec, forceLost = false) {
  const predicted = predictTrack(track, simulationTime);
  const measurementAgeSec = Math.max(0, simulationTime - track.lastUpdateTime);
  const stale = forceLost || measurementAgeSec > getTrackCoastSeconds(track);
  return {
    ...predicted,
    state: stale ? TRACK_STATE.LOST : track.state,
    consecutiveUpdates: stale ? 0 : track.consecutiveUpdates,
    trackQuality: Math.max(0, track.trackQuality - QUALITY_DECAY_PER_SECOND * deltaTimeSec),
    classificationConfidence: Math.max(0,
      (track.classificationConfidence ?? 0) - QUALITY_DECAY_PER_SECOND * deltaTimeSec),
    identificationConfidence: Math.max(0,
      (track.identificationConfidence ?? 0) - QUALITY_DECAY_PER_SECOND * deltaTimeSec),
    measurementAgeSec,
  };
}

export function updateLostTrack(track, simulationTime, deltaTimeSec) {
  const ageSeconds = simulationTime - track.lastUpdateTime;
  if (ageSeconds >= TRACK_MEMORY_SECONDS) return null;
  return coastTrack(track, simulationTime, deltaTimeSec, true);
}
