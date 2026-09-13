import { SIMPLE_TARGET_TYPE } from './scenarios.js';

const BROAD_TRACK_TYPE = Object.freeze({
  UAV: SIMPLE_TARGET_TYPE.UAV,
  UAV_TARGET: SIMPLE_TARGET_TYPE.UAV,
  CRUISE_MISSILE: SIMPLE_TARGET_TYPE.CRUISE_MISSILE,
  CRUISE_TARGET: SIMPLE_TARGET_TYPE.CRUISE_MISSILE,
  BALLISTIC_MISSILE: SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE,
  BALLISTIC_TARGET: SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE,
});

// Presentation/assignment eligibility, independent of sensor owner or fire control.
// Coasting estimates remain selectable; a LOST or removed track is never truth-filled.
export const isAvailableNetworkTrack = track => Boolean(track && track.state !== 'LOST'
  && Number.isFinite(track.reportedPosition?.lat)
  && Number.isFinite(track.reportedPosition?.lng));

const estimateTimeToGroundSec = (altitudeM, verticalSpeedMps) => {
  const altitude = Math.max(0, altitudeM ?? 0);
  const verticalSpeed = verticalSpeedMps ?? 0;
  const discriminant = Math.max(0, verticalSpeed ** 2 + 2 * 9.81 * altitude);
  return Math.max(0, (verticalSpeed + Math.sqrt(discriminant)) / 9.81);
};

export function createTrackDataView(track, simulationTime) {
  if (!track?.reportedPosition) return null;
  const estimatedVelocity = track.velocity ?? {
    speedKmh: track.reportedSpeedKmh,
    heading: track.reportedHeading,
    verticalSpeedMps: track.reportedVerticalSpeedMps,
  };
  const estimatedAltitude = track.reportedAltitudeM ?? track.reportedPosition.alt ?? 0;
  return {
    trackId: track.id,
    targetId: track.targetId,
    state: track.state,
    trackQuality: track.trackQuality ?? 0,
    updateAgeSec: Math.max(0, simulationTime - (track.lastUpdateTime ?? simulationTime)),
    measurementAgeSec: track.measurementAgeSec
      ?? Math.max(0, simulationTime - (track.lastMeasurementTime ?? track.lastUpdateTime ?? simulationTime)),
    positionEstimate: track.reportedPosition,
    estimatedPosition: track.reportedPosition,
    velocityEstimate: estimatedVelocity,
    estimatedVelocity,
    estimatedVerticalVelocity: estimatedVelocity.verticalSpeedMps ?? 0,
    altitudeEstimate: estimatedAltitude,
    estimatedAltitude,
    classification: track.classifiedType ?? null,
    classificationConfidence: track.classificationConfidence ?? 0,
    identification: track.identifiedType ?? null,
    identificationConfidence: track.identificationConfidence ?? 0,
    positionUncertaintyM: track.positionUncertaintyM ?? 0,
    altitudeUncertaintyM: track.altitudeUncertaintyM ?? 0,
    velocityUncertaintyMps: track.velocityUncertaintyMps ?? 0,
    headingUncertaintyDeg: track.headingUncertaintyDeg ?? 0,
    sourceRadarId: track.sourceRadarId ?? null,
    sourceBatteryId: track.sourceBatteryId ?? null,
    contributingSensors: track.contributingSensors ?? [],
    bestSensorId: track.bestSensorId ?? track.sourceRadarId ?? null,
    lastMeasurementSensorId: track.lastMeasurementSensorId ?? track.sourceRadarId ?? null,
  };
}

/**
 * Fire-control compatible target assembled from Track estimates. Scenario metadata
 * is retained, while true current kinematics and ballistic solver state are removed.
 */
export function createFireControlTargetEstimate(track, targetMetadata, simulationTime) {
  const trackData = createTrackDataView(track, simulationTime);
  if (!trackData) return null;
  const estimatedType = track.identifiedType
    ?? BROAD_TRACK_TYPE[track.classifiedType]
    ?? 'AIR_TARGET';
  const altitudeM = trackData.altitudeEstimate;
  const verticalSpeedMps = trackData.velocityEstimate?.verticalSpeedMps
    ?? track.reportedVerticalSpeedMps
    ?? 0;
  return {
    id: targetMetadata?.id ?? track.targetId,
    targetId: track.targetId,
    type: estimatedType,
    modelId: track.identifiedModelId ?? null,
    position: {
      lat: trackData.positionEstimate.lat,
      lng: trackData.positionEstimate.lng,
      lon: trackData.positionEstimate.lng,
      alt: altitudeM,
    },
    altitudeM,
    speedKmh: track.reportedSpeedKmh ?? 0,
    heading: track.reportedHeading ?? 0,
    verticalSpeedMps,
    velocity: {
      speedKmh: track.reportedSpeedKmh ?? 0,
      heading: track.reportedHeading ?? 0,
      verticalSpeedMps,
    },
    route: targetMetadata?.route ?? [],
    waypointIndex: targetMetadata?.waypointIndex ?? 0,
    objectiveName: targetMetadata?.objectiveName,
    objectiveCategory: targetMetadata?.objectiveCategory,
    objectivePriority: targetMetadata?.objectivePriority,
    defenseAssessment: targetMetadata?.defenseAssessment ?? null,
    decoy: track.identifiedModelId === 'GERBERA',
    sensorEstimated: true,
    trackData,
    ballisticPhysics: estimatedType === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE ? {
      enabled: false,
      timeToGroundSec: estimateTimeToGroundSec(altitudeM, verticalSpeedMps),
    } : null,
  };
}
