export const TRACK_STATE = Object.freeze({
  DETECTED: 'DETECTED',
  TRACKED: 'TRACKED',
  IDENTIFIED: 'IDENTIFIED',
  LOST: 'LOST',
});

export const TRACK_MEMORY_SECONDS = 30;

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
  };
}
