import { getDestinationPoint } from './geo.js';

/**
 * Lightweight deterministic Track estimator. It consumes sensor measurements only;
 * simulation truth is never accepted by this module.
 */
export const TRACK_ESTIMATOR_CONFIG = Object.freeze({
  maximumAccelerationMps2: 80,
  maximumVerticalAccelerationMps2: 120,
  maximumTurnRateDegPerSec: 25,
  accelerationMemorySec: 3.5,
  minimumPositionUncertaintyM: 8,
  minimumVelocityUncertaintyMps: 0.6,
  minimumHeadingUncertaintyDeg: 0.15,
});

const EARTH_METERS_PER_DEGREE = 111_195;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const clamp01 = value => clamp(value, 0, 1);
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const normalizeHeading = heading => ((heading % 360) + 360) % 360;
export const normalizeTrackHeadingDelta = delta => ((delta + 540) % 360) - 180;

const positionWithAltitude = (position, altitudeM) => ({
  lat: position.lat,
  lng: position.lng ?? position.lon,
  lon: position.lng ?? position.lon,
  alt: altitudeM ?? position.alt ?? position.altitudeM ?? 0,
});

const velocityFromHeading = (speedKmh = 0, headingDeg = 0, verticalSpeedMps = 0) => {
  const radians = headingDeg * DEG_TO_RAD;
  const speedMps = Math.max(0, finite(speedKmh)) / 3.6;
  return {
    eastMps: Math.sin(radians) * speedMps,
    northMps: Math.cos(radians) * speedMps,
    upMps: finite(verticalSpeedMps),
  };
};

const magnitude2d = vector => Math.hypot(vector.eastMps ?? vector.eastM ?? 0,
  vector.northMps ?? vector.northM ?? 0);
const magnitude3d = vector => Math.hypot(vector.eastMps ?? 0, vector.northMps ?? 0,
  vector.upMps ?? 0);
const clampVector = (vector, maximum) => {
  const magnitude = magnitude3d(vector);
  if (!(magnitude > maximum) || magnitude <= 0) return vector;
  const scale = maximum / magnitude;
  return {
    eastMps: vector.eastMps * scale,
    northMps: vector.northMps * scale,
    upMps: vector.upMps * scale,
  };
};

const headingFromVelocity = (velocity, fallback = 0) => {
  if (magnitude2d(velocity) < 0.05) return normalizeHeading(fallback);
  return normalizeHeading(Math.atan2(velocity.eastMps, velocity.northMps) * RAD_TO_DEG);
};

const positionResidualMeters = (origin, measured, originAltitudeM, measuredAltitudeM) => {
  const meanLatitudeRad = ((origin.lat + measured.lat) * 0.5) * DEG_TO_RAD;
  return {
    eastM: (measured.lng - origin.lng) * EARTH_METERS_PER_DEGREE * Math.cos(meanLatitudeRad),
    northM: (measured.lat - origin.lat) * EARTH_METERS_PER_DEGREE,
    upM: measuredAltitudeM - originAltitudeM,
  };
};

const offsetPosition = (origin, residual, gain, altitudeM) => ({
  lat: origin.lat + residual.northM * gain / EARTH_METERS_PER_DEGREE,
  lng: origin.lng + residual.eastM * gain
    / Math.max(EARTH_METERS_PER_DEGREE * Math.cos(origin.lat * DEG_TO_RAD), 1),
  alt: Math.max(0, altitudeM + residual.upM * gain),
});

const residualMagnitude = residual => Math.hypot(residual.eastM, residual.northM, residual.upM);
const residualDirectionConsistency = (previous, next) => {
  if (!previous) return 0;
  const previousMagnitude = Math.hypot(previous.eastM, previous.northM);
  const nextMagnitude = Math.hypot(next.eastM, next.northM);
  if (previousMagnitude < 1 || nextMagnitude < 1) return 0;
  return clamp01(((previous.eastM * next.eastM + previous.northM * next.northM)
    / (previousMagnitude * nextMagnitude) - 0.35) / 0.65);
};

const combineUncertainty = (prior, measurement, floor) => {
  const priorValue = Math.max(floor, finite(prior, measurement));
  const measurementValue = Math.max(floor, finite(measurement, priorValue));
  return Math.max(floor, 1 / Math.sqrt(
    1 / (priorValue * priorValue) + 1 / (measurementValue * measurementValue),
  ));
};

const initialEstimate = (measurement, hasTrackSolution) => {
  // A tentative detection still has a measured motion cue. Keep it internal
  // for coasting between scans; public speed/heading remain unavailable until
  // the sensor has established a Track solution.
  const velocity = velocityFromHeading(measurement.speedKmh, measurement.headingDeg,
    measurement.verticalSpeedMps);
  return {
    reportedPosition: positionWithAltitude(measurement.position, measurement.altitudeM),
    reportedAltitudeM: measurement.altitudeM,
    reportedSpeedKmh: hasTrackSolution ? measurement.speedKmh : null,
    reportedHorizontalSpeedKmh: hasTrackSolution ? measurement.speedKmh : null,
    reportedHeading: hasTrackSolution ? measurement.headingDeg : null,
    reportedVerticalSpeedMps: hasTrackSolution ? measurement.verticalSpeedMps : 0,
    estimatedVelocityEnuMps: velocity,
    estimatedAccelerationEnuMps2: { eastMps: 0, northMps: 0, upMps: 0 },
    estimatedAccelerationMps2: 0,
    estimatedTurnRateDegPerSec: 0,
    estimatorInnovationM: 0,
    estimatorPositionGain: 1,
    estimatorVelocityGain: hasTrackSolution ? 1 : 0,
    estimatorOutlierLimited: false,
    lastInnovationEnuM: null,
    positionUncertaintyM: measurement.positionUncertaintyM,
    altitudeUncertaintyM: measurement.altitudeUncertaintyM,
    velocityUncertaintyMps: measurement.velocityUncertaintyMps,
    headingUncertaintyDeg: measurement.headingUncertaintyDeg,
  };
};

export function propagateTrackEstimate(track, deltaTimeSec) {
  const durationSec = Math.max(0, deltaTimeSec);
  if (durationSec <= 0 || !track?.reportedPosition) return {};
  const tentative = track.state === 'DETECTED';
  const priorHeading = tentative
    ? headingFromVelocity(track.estimatedVelocityEnuMps ?? {}, 0)
    : finite(track.reportedHeading);
  const priorSpeedMps = tentative
    ? magnitude2d(track.estimatedVelocityEnuMps ?? {})
    : Math.max(0, finite(track.reportedHorizontalSpeedKmh, track.reportedSpeedKmh) / 3.6);
  const retainedAcceleration = finite(track.estimatedLongitudinalAccelerationMps2)
    * Math.exp(-durationSec / TRACK_ESTIMATOR_CONFIG.accelerationMemorySec);
  const retainedTurnRate = clamp(finite(track.estimatedTurnRateDegPerSec),
    -TRACK_ESTIMATOR_CONFIG.maximumTurnRateDegPerSec,
    TRACK_ESTIMATOR_CONFIG.maximumTurnRateDegPerSec)
    * Math.exp(-durationSec / TRACK_ESTIMATOR_CONFIG.accelerationMemorySec);
  const nextSpeedMps = Math.max(0, priorSpeedMps + retainedAcceleration * durationSec);
  const midpointHeading = priorHeading + retainedTurnRate * durationSec * 0.5;
  const nextHeading = normalizeHeading(priorHeading + retainedTurnRate * durationSec);
  const distanceKm = (priorSpeedMps + nextSpeedMps) * 0.5 * durationSec / 1000;
  const position = getDestinationPoint(track.reportedPosition.lat, track.reportedPosition.lng,
    midpointHeading, distanceKm);
  const verticalAcceleration = clamp(finite(track.estimatedVerticalAccelerationMps2),
    -TRACK_ESTIMATOR_CONFIG.maximumVerticalAccelerationMps2,
    TRACK_ESTIMATOR_CONFIG.maximumVerticalAccelerationMps2)
    * Math.exp(-durationSec / TRACK_ESTIMATOR_CONFIG.accelerationMemorySec);
  const priorVerticalSpeed = finite(track.reportedVerticalSpeedMps);
  const nextVerticalSpeed = priorVerticalSpeed + verticalAcceleration * durationSec;
  const altitudeM = Math.max(0, finite(track.reportedAltitudeM, track.reportedPosition.alt)
    + (priorVerticalSpeed + nextVerticalSpeed) * 0.5 * durationSec);
  return {
    reportedPosition: positionWithAltitude(position, altitudeM),
    reportedAltitudeM: altitudeM,
    reportedHeading: tentative ? null : nextHeading,
    reportedSpeedKmh: tentative ? null : nextSpeedMps * 3.6,
    reportedHorizontalSpeedKmh: tentative ? null : nextSpeedMps * 3.6,
    reportedVerticalSpeedMps: tentative ? track.reportedVerticalSpeedMps : nextVerticalSpeed,
    estimatedVelocityEnuMps: velocityFromHeading(nextSpeedMps * 3.6, nextHeading,
      nextVerticalSpeed),
    estimatedTurnRateDegPerSec: retainedTurnRate,
    estimatedLongitudinalAccelerationMps2: retainedAcceleration,
    estimatedVerticalAccelerationMps2: verticalAcceleration,
  };
}

export function updateTrackEstimate({ existingTrack, predictedTrack, measurement,
  simulationTime, sourceChanged = false, hasTrackSolution = true }) {
  if (!existingTrack) return initialEstimate(measurement, hasTrackSolution);

  const prior = predictedTrack ?? existingTrack;
  const measurementDeltaSec = Math.max(0.05,
    simulationTime - (existingTrack.lastMeasurementTime ?? existingTrack.lastUpdateTime
      ?? simulationTime - 0.05));
  const hadVelocitySolution = Number.isFinite(existingTrack.reportedHorizontalSpeedKmh
    ?? existingTrack.reportedSpeedKmh);
  const idealMeasurement = measurement.quality >= 0.999
    && (measurement.positionUncertaintyM ?? 0) <= 0
    && (measurement.velocityUncertaintyMps ?? 0) <= 0;
  const priorAltitudeM = finite(prior.reportedAltitudeM, prior.reportedPosition.alt);
  const innovation = positionResidualMeters(prior.reportedPosition, measurement.position,
    priorAltitudeM, measurement.altitudeM);
  const innovationM = residualMagnitude(innovation);
  const consistency = residualDirectionConsistency(existingTrack.lastInnovationEnuM, innovation);
  const expectedPositionErrorM = Math.max(20, Math.hypot(
    finite(prior.positionUncertaintyM), finite(measurement.positionUncertaintyM),
    finite(prior.altitudeUncertaintyM), finite(measurement.altitudeUncertaintyM),
  ));
  const priorSpeedMps = Math.max(0,
    finite(prior.reportedHorizontalSpeedKmh, prior.reportedSpeedKmh) / 3.6);
  const baseOutlierLimitM = Math.max(expectedPositionErrorM * 3.5,
    120 + priorSpeedMps * measurementDeltaSec * 0.45);
  const outlierLimitM = baseOutlierLimitM * (1 + consistency * 1.5);
  const innovationScale = innovationM > outlierLimitM
    ? outlierLimitM / Math.max(innovationM, 1)
    : 1;
  const limitedInnovation = {
    eastM: innovation.eastM * innovationScale,
    northM: innovation.northM * innovationScale,
    upM: innovation.upM * innovationScale,
  };
  const quality = clamp01(measurement.quality ?? 0.5);
  const cadenceFactor = 0.7 + 0.3 * clamp01(measurementDeltaSec / 2);
  const persistentManeuver = consistency * clamp01(
    (innovationM - expectedPositionErrorM) / Math.max(expectedPositionErrorM * 2.5, 1),
  );
  let positionGain = (0.08 + quality * 0.22) * cadenceFactor
    + persistentManeuver * 0.34;
  if (sourceChanged) positionGain = Math.min(positionGain, 0.18);
  if (idealMeasurement) positionGain = 1;
  positionGain = clamp(positionGain, 0.06, 0.68);
  const correctedPosition = offsetPosition(prior.reportedPosition, limitedInnovation,
    positionGain, priorAltitudeM);

  const priorVelocity = prior.estimatedVelocityEnuMps
    ?? velocityFromHeading(prior.reportedHorizontalSpeedKmh ?? prior.reportedSpeedKmh,
      prior.reportedHeading, prior.reportedVerticalSpeedMps);
  const measurementVelocity = velocityFromHeading(measurement.speedKmh,
    measurement.headingDeg, measurement.verticalSpeedMps);
  let directVelocityGain = hasTrackSolution
    ? 0.04 + quality * 0.22 * measurementDeltaSec / (measurementDeltaSec + 1.25)
    : 0.03 + quality * 0.1 * measurementDeltaSec / (measurementDeltaSec + 1.25);
  if (!hadVelocitySolution && hasTrackSolution) directVelocityGain = 1;
  if (idealMeasurement) directVelocityGain = 1;
  const innovationVelocityGain = sourceChanged || !hasTrackSolution || idealMeasurement
    ? 0
    : positionGain * measurementDeltaSec / (measurementDeltaSec + 1.5)
      * (0.3 + persistentManeuver * 0.28);
  const candidateVelocity = {
    eastMps: priorVelocity.eastMps
      + (measurementVelocity.eastMps - priorVelocity.eastMps) * directVelocityGain
      + limitedInnovation.eastM / measurementDeltaSec * innovationVelocityGain,
    northMps: priorVelocity.northMps
      + (measurementVelocity.northMps - priorVelocity.northMps) * directVelocityGain
      + limitedInnovation.northM / measurementDeltaSec * innovationVelocityGain,
    upMps: priorVelocity.upMps
      + (measurementVelocity.upMps - priorVelocity.upMps) * directVelocityGain
      + limitedInnovation.upM / measurementDeltaSec * innovationVelocityGain,
  };
  const maximumVelocityDelta = TRACK_ESTIMATOR_CONFIG.maximumAccelerationMps2
    * measurementDeltaSec;
  const velocityDelta = clampVector({
    eastMps: candidateVelocity.eastMps - priorVelocity.eastMps,
    northMps: candidateVelocity.northMps - priorVelocity.northMps,
    upMps: candidateVelocity.upMps - priorVelocity.upMps,
  }, maximumVelocityDelta);
  const estimatedVelocity = {
    eastMps: priorVelocity.eastMps + velocityDelta.eastMps,
    northMps: priorVelocity.northMps + velocityDelta.northMps,
    upMps: priorVelocity.upMps + velocityDelta.upMps,
  };
  const rawAcceleration = clampVector({
    eastMps: velocityDelta.eastMps / measurementDeltaSec,
    northMps: velocityDelta.northMps / measurementDeltaSec,
    upMps: velocityDelta.upMps / measurementDeltaSec,
  }, TRACK_ESTIMATOR_CONFIG.maximumAccelerationMps2);
  const priorAcceleration = prior.estimatedAccelerationEnuMps2
    ?? { eastMps: 0, northMps: 0, upMps: 0 };
  const accelerationGain = 0.16 + persistentManeuver * 0.28;
  const estimatedAcceleration = clampVector({
    eastMps: priorAcceleration.eastMps
      + (rawAcceleration.eastMps - priorAcceleration.eastMps) * accelerationGain,
    northMps: priorAcceleration.northMps
      + (rawAcceleration.northMps - priorAcceleration.northMps) * accelerationGain,
    upMps: priorAcceleration.upMps
      + (rawAcceleration.upMps - priorAcceleration.upMps) * accelerationGain,
  }, TRACK_ESTIMATOR_CONFIG.maximumAccelerationMps2);
  const speedMps = magnitude2d(estimatedVelocity);
  const headingDeg = headingFromVelocity(estimatedVelocity,
    measurement.headingDeg ?? prior.reportedHeading);
  const rawTurnRate = clamp(normalizeTrackHeadingDelta(
    headingDeg - finite(existingTrack.reportedHeading, headingDeg),
  ) / measurementDeltaSec, -TRACK_ESTIMATOR_CONFIG.maximumTurnRateDegPerSec,
  TRACK_ESTIMATOR_CONFIG.maximumTurnRateDegPerSec);
  const turnRateGain = 0.18 + persistentManeuver * 0.34;
  const turnRateDegPerSec = idealMeasurement ? 0 : clamp(
    finite(existingTrack.estimatedTurnRateDegPerSec)
      + (rawTurnRate - finite(existingTrack.estimatedTurnRateDegPerSec)) * turnRateGain,
    -TRACK_ESTIMATOR_CONFIG.maximumTurnRateDegPerSec,
    TRACK_ESTIMATOR_CONFIG.maximumTurnRateDegPerSec,
  );
  const priorHorizontalSpeedMps = magnitude2d(priorVelocity);
  const longitudinalAccelerationMps2 = clamp(
    (speedMps - priorHorizontalSpeedMps) / measurementDeltaSec,
    -TRACK_ESTIMATOR_CONFIG.maximumAccelerationMps2,
    TRACK_ESTIMATOR_CONFIG.maximumAccelerationMps2,
  );
  const verticalAccelerationMps2 = clamp(
    (estimatedVelocity.upMps - priorVelocity.upMps) / measurementDeltaSec,
    -TRACK_ESTIMATOR_CONFIG.maximumVerticalAccelerationMps2,
    TRACK_ESTIMATOR_CONFIG.maximumVerticalAccelerationMps2,
  );

  const positionUncertaintyM = idealMeasurement ? 0 : combineUncertainty(
    prior.positionUncertaintyM, measurement.positionUncertaintyM,
    TRACK_ESTIMATOR_CONFIG.minimumPositionUncertaintyM,
  ) + Math.min(expectedPositionErrorM * 0.18, innovationM * 0.035);
  const altitudeUncertaintyM = idealMeasurement ? 0 : combineUncertainty(
    prior.altitudeUncertaintyM, measurement.altitudeUncertaintyM,
    TRACK_ESTIMATOR_CONFIG.minimumPositionUncertaintyM,
  ) + Math.min(finite(measurement.altitudeUncertaintyM) * 0.15,
    Math.abs(innovation.upM) * 0.035);
  const velocityUncertaintyMps = idealMeasurement ? 0 : combineUncertainty(
    prior.velocityUncertaintyMps, measurement.velocityUncertaintyMps,
    TRACK_ESTIMATOR_CONFIG.minimumVelocityUncertaintyMps,
  ) + Math.min(5, magnitude3d(velocityDelta) * 0.08);
  const headingUncertaintyDeg = idealMeasurement ? 0 : combineUncertainty(
    prior.headingUncertaintyDeg, measurement.headingUncertaintyDeg,
    TRACK_ESTIMATOR_CONFIG.minimumHeadingUncertaintyDeg,
  ) + Math.min(2, Math.abs(rawTurnRate) * 0.035);

  return {
    reportedPosition: positionWithAltitude(correctedPosition, correctedPosition.alt),
    reportedAltitudeM: correctedPosition.alt,
    reportedSpeedKmh: hasTrackSolution ? speedMps * 3.6 : existingTrack.reportedSpeedKmh,
    reportedHorizontalSpeedKmh: hasTrackSolution
      ? speedMps * 3.6 : existingTrack.reportedHorizontalSpeedKmh,
    reportedHeading: hasTrackSolution ? headingDeg : existingTrack.reportedHeading,
    reportedVerticalSpeedMps: hasTrackSolution
      ? estimatedVelocity.upMps : finite(existingTrack.reportedVerticalSpeedMps),
    estimatedVelocityEnuMps: estimatedVelocity,
    estimatedAccelerationEnuMps2: estimatedAcceleration,
    estimatedAccelerationMps2: magnitude3d(estimatedAcceleration),
    estimatedLongitudinalAccelerationMps2: longitudinalAccelerationMps2,
    estimatedVerticalAccelerationMps2: verticalAccelerationMps2,
    estimatedTurnRateDegPerSec: turnRateDegPerSec,
    estimatorInnovationM: innovationM,
    estimatorPositionGain: positionGain,
    estimatorVelocityGain: directVelocityGain + innovationVelocityGain,
    estimatorOutlierLimited: innovationScale < 1,
    lastInnovationEnuM: innovation,
    positionUncertaintyM,
    altitudeUncertaintyM,
    velocityUncertaintyMps,
    headingUncertaintyDeg,
  };
}
