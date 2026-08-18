import { SENSOR_EVIDENCE_CONFIG } from '../data/sensorDetectionProfiles.js';

export const TRACK_STATE = Object.freeze({
  DETECTED: 'DETECTED',
  TRACKED: 'TRACKED',
  IDENTIFIED: 'IDENTIFIED',
  LOST: 'LOST',
});

export const TRACK_MEMORY_SECONDS = SENSOR_EVIDENCE_CONFIG.reacquisitionMemorySec;

const INITIAL_QUALITY = 0.18;
const QUALITY_PER_UPDATE = 0.14;
const QUALITY_DECAY_PER_SECOND = 0.025;
const UPDATES_TO_TRACK = 3;
const UPDATES_TO_IDENTIFY = 6;

const getObservedState = (consecutiveUpdates) => {
  if (consecutiveUpdates >= UPDATES_TO_IDENTIFY) return TRACK_STATE.IDENTIFIED;
  if (consecutiveUpdates >= UPDATES_TO_TRACK) return TRACK_STATE.TRACKED;
  return TRACK_STATE.DETECTED;
};

export function formatTrackId(sequence) {
  return `TRK-${sequence.toString().padStart(3, '0')}`;
}

export function applyRadarObservation({ existingTrack, target, sourceBatteryId, simulationTime, trackId }) {
  const wasLost = existingTrack?.state === TRACK_STATE.LOST;
  const consecutiveUpdates = existingTrack && !wasLost
    ? existingTrack.consecutiveUpdates + 1
    : 1;
  const state = getObservedState(consecutiveUpdates);
  const hasTrackSolution = state === TRACK_STATE.TRACKED || state === TRACK_STATE.IDENTIFIED;
  const hasIdentification = state === TRACK_STATE.IDENTIFIED;

  return {
    id: existingTrack?.id ?? trackId,
    targetId: target.id,
    state,
    reportedPosition: {
      lat: target.position.lat,
      lng: target.position.lng,
      lon: target.position.lng,
      alt: target.altitudeM,
    },
    lastUpdateTime: simulationTime,
    trackQuality: Math.min(
      1,
      existingTrack
        ? Math.max(INITIAL_QUALITY, existingTrack.trackQuality + QUALITY_PER_UPDATE)
        : INITIAL_QUALITY,
    ),
    consecutiveUpdates,
    totalUpdates: (existingTrack?.totalUpdates ?? 0) + 1,
    identifiedType: hasIdentification
      ? target.type
      : (existingTrack?.identifiedType ?? null),
    reportedSpeedKmh: hasTrackSolution
      ? target.speedKmh
      : (existingTrack?.reportedSpeedKmh ?? null),
    reportedHeading: hasTrackSolution
      ? target.heading
      : (existingTrack?.reportedHeading ?? null),
    sourceBatteryId,
    velocity: hasTrackSolution
      ? { speedKmh: target.speedKmh, heading: target.heading }
      : (existingTrack?.velocity ?? null),
  };
}

/**
 * Creates or refreshes a Track from confirmed sensor evidence. The caller must
 * invoke this only for an observation produced by a real radar scan opportunity.
 */
export function applySensorEvidenceObservation({
  existingTrack,
  target,
  observation,
  simulationTime,
  trackId,
}) {
  if (!observation?.stage) return existingTrack ?? null;

  const wasLost = existingTrack?.state === TRACK_STATE.LOST;
  const hasTrackSolution = observation.stage === TRACK_STATE.TRACKED
    || observation.stage === TRACK_STATE.IDENTIFIED;
  const hasIdentification = observation.stage === TRACK_STATE.IDENTIFIED;
  const evidenceMaximum = observation.thresholds?.identified
    ?? SENSOR_EVIDENCE_CONFIG.thresholds.identified;
  const trackQuality = Math.max(
    INITIAL_QUALITY,
    Math.min(1, observation.evidence / evidenceMaximum),
  );

  return {
    id: existingTrack?.id ?? trackId,
    targetId: target.id,
    state: observation.stage,
    reportedPosition: {
      lat: target.position.lat,
      lng: target.position.lng,
      lon: target.position.lng,
      alt: target.altitudeM,
    },
    lastUpdateTime: simulationTime,
    trackQuality,
    consecutiveUpdates: existingTrack && !wasLost
      ? (existingTrack.consecutiveUpdates ?? 0) + 1
      : 1,
    totalUpdates: (existingTrack?.totalUpdates ?? 0) + 1,
    identifiedType: hasIdentification ? (observation.identifiedType ?? target.type) : null,
    identifiedModelId: hasIdentification
      ? (observation.identifiedModelId ?? target.modelId ?? null)
      : null,
    classifiedType: hasTrackSolution
      ? (observation.broadClassification ?? existingTrack?.classifiedType ?? 'AIR_TARGET')
      : null,
    classificationConfidence: observation.classificationConfidence ?? 0,
    identificationConfidence: observation.identificationConfidence ?? 0,
    reportedSpeedKmh: hasTrackSolution
      ? target.speedKmh
      : null,
    reportedHeading: hasTrackSolution
      ? target.heading
      : null,
    reportedAltitudeM: target.altitudeM,
    sourceBatteryId: observation.sourceBatteryId,
    sourceRadarId: observation.sourceRadarId ?? null,
    velocity: hasTrackSolution
      ? { speedKmh: target.speedKmh, heading: target.heading }
      : null,
    detectionEvidence: observation.evidence,
    sensorThresholds: observation.thresholds,
    lastSensorContribution: observation.lastContribution ?? 0,
    lastScanOpportunityCount: observation.scanOpportunityCount ?? 0,
    sensorContributorCount: observation.contributorCount ?? 1,
    reacquired: wasLost || observation.reacquisition === true,
  };
}

export function updateLostTrack(track, simulationTime, deltaTimeSec) {
  const ageSeconds = simulationTime - track.lastUpdateTime;
  if (ageSeconds >= TRACK_MEMORY_SECONDS) return null;

  return {
    ...track,
    state: TRACK_STATE.LOST,
    consecutiveUpdates: 0,
    trackQuality: Math.max(0, track.trackQuality - QUALITY_DECAY_PER_SECOND * deltaTimeSec),
    classificationConfidence: Math.max(
      0,
      (track.classificationConfidence ?? 0) - QUALITY_DECAY_PER_SECOND * deltaTimeSec,
    ),
    identificationConfidence: Math.max(
      0,
      (track.identificationConfidence ?? 0) - QUALITY_DECAY_PER_SECOND * deltaTimeSec,
    ),
  };
}
