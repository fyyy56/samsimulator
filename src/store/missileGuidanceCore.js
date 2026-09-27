import { getBearing, getDestinationPoint } from './geo.js';
import { getEffectiveTurnPerformance } from './interceptorPhysics.js';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const EARTH_LATITUDE_KM = 111.32;
const GRAVITY_MPS2 = 9.81;

export const INTERCEPT_SOLUTION_STATUS = Object.freeze({
  VALID: 'VALID', MARGINAL: 'MARGINAL', INVALID: 'INVALID',
});

export const normalizeHeadingDelta = delta => ((delta + 540) % 360) - 180;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const clamp01 = value => clamp(value, 0, 1);
const components = vector => ({
  east: vector.eastMps ?? vector.eastM ?? 0,
  north: vector.northMps ?? vector.northM ?? 0,
  up: vector.upMps ?? vector.upM ?? 0,
});
const magnitude = vector => {
  const value = components(vector);
  return Math.hypot(value.east, value.north, value.up);
};
const dot = (a, b) => {
  const av = components(a); const bv = components(b);
  return av.east * bv.east + av.north * bv.north + av.up * bv.up;
};
const cross = (a, b) => {
  const av = components(a); const bv = components(b);
  return {
    eastMps: av.north * bv.up - av.up * bv.north,
    northMps: av.up * bv.east - av.east * bv.up,
    upMps: av.east * bv.north - av.north * bv.east,
  };
};
const scale = (vector, factor) => {
  const value = components(vector);
  return { eastMps: value.east * factor, northMps: value.north * factor, upMps: value.up * factor };
};
const add = (a, b) => {
  const av = components(a); const bv = components(b);
  return { eastMps: av.east + bv.east, northMps: av.north + bv.north, upMps: av.up + bv.up };
};
const subtract = (a, b) => add(a, scale(b, -1));
const normalize = vector => scale(vector, 1 / Math.max(magnitude(vector), 1e-6));
const clampVector = (vector, maximum) => {
  const length = magnitude(vector);
  return length > maximum && length > 0 ? scale(vector, maximum / length) : vector;
};
const rejectFrom = (vector, axis) => subtract(vector, scale(axis, dot(vector, axis)));

export const velocityFromFlightPath = (headingDeg = 0, speedMps = 0, flightPathAngleDeg = 0) => {
  const headingRad = headingDeg * DEG_TO_RAD;
  const pitchRad = flightPathAngleDeg * DEG_TO_RAD;
  const horizontalSpeedMps = speedMps * Math.cos(pitchRad);
  return {
    eastMps: Math.sin(headingRad) * horizontalSpeedMps,
    northMps: Math.cos(headingRad) * horizontalSpeedMps,
    upMps: Math.sin(pitchRad) * speedMps,
  };
};

const velocityFromHeading = (headingDeg = 0, speedMps = 0, verticalSpeedMps = 0) => {
  const headingRad = headingDeg * DEG_TO_RAD;
  return {
    eastMps: Math.sin(headingRad) * speedMps,
    northMps: Math.cos(headingRad) * speedMps,
    upMps: verticalSpeedMps,
  };
};

const relativeLocalPosition = (origin, target) => {
  const longitudeKm = EARTH_LATITUDE_KM * Math.cos(((origin.lat + target.lat) * 0.5) * DEG_TO_RAD);
  return {
    eastM: (target.lng - origin.lng) * longitudeKm * 1000,
    northM: (target.lat - origin.lat) * EARTH_LATITUDE_KM * 1000,
    upM: (target.altitudeM ?? target.alt ?? 0) - (origin.altitudeM ?? origin.alt ?? 0),
  };
};

const smoothPosition = (previous, next, alpha) => !previous ? { ...next } : ({
  lat: previous.lat + (next.lat - previous.lat) * alpha,
  lng: previous.lng + (next.lng - previous.lng) * alpha,
  alt: (previous.alt ?? 0) + ((next.alt ?? 0) - (previous.alt ?? 0)) * alpha,
});

export function projectEstimatedTarget(targetState, seconds) {
  const durationSec = Math.max(0, seconds);
  const turnRateDegPerSec = targetState.turnRateDegPerSec ?? 0;
  const midpointHeading = (targetState.heading ?? 0) + turnRateDegPerSec * durationSec * 0.5;
  const distanceKm = Math.max(0, targetState.speedMps ?? 0) * durationSec / 1000;
  const projected = getDestinationPoint(targetState.position.lat, targetState.position.lng,
    midpointHeading, distanceKm);
  return {
    lat: projected.lat,
    lng: projected.lng,
    alt: Math.max(0, (targetState.position.alt ?? 0)
      + (targetState.verticalSpeedMps ?? 0) * durationSec),
  };
}

export function estimateTargetState(guidance, simulationTime) {
  // Network tracks are already propagated between scans. Extrapolate from the
  // estimate timestamp, never from the older radar measurement timestamp.
  const measurementAgeSec = Math.max(0, simulationTime
    - (guidance.trackStateTime ?? guidance.trackLastUpdateTime ?? simulationTime));
  const measuredState = {
    position: guidance.reportedPosition,
    heading: guidance.reportedHeading ?? 0,
    speedMps: Math.max(0,
      guidance.reportedHorizontalSpeedKmh ?? guidance.reportedSpeedKmh ?? 0) / 3.6,
    verticalSpeedMps: guidance.reportedVerticalSpeedMps ?? 0,
    turnRateDegPerSec: guidance.estimatedTurnRateDegPerSec ?? 0,
  };
  const position = projectEstimatedTarget(measuredState, measurementAgeSec);
  const heading = (measuredState.heading + measuredState.turnRateDegPerSec * measurementAgeSec + 360) % 360;
  return {
    ...measuredState, position, heading,
    velocity: velocityFromHeading(heading, measuredState.speedMps, measuredState.verticalSpeedMps),
    measurementAgeSec,
  };
}

const estimateAvailableAverageSpeedMps = (interceptor, physics, timeSec) => {
  const currentSpeedMps = Math.max(interceptor.speedKmh / 3.6, 1);
  const remainingBurnSec = Math.max(0, physics.motorBurnTimeSec - interceptor.flightTime);
  const poweredFraction = clamp01(remainingBurnSec / Math.max(timeSec, 0.1));
  const poweredSpeedMps = Math.min(physics.maxSpeedMps,
    Math.max(currentSpeedMps, physics.maxSpeedMps * 0.72));
  const coastSpeedMps = Math.max(physics.minimumEffectiveSpeedMps,
    currentSpeedMps * (0.88 - 0.16 * clamp01(timeSec / physics.maxFlightTimeSec)));
  return poweredSpeedMps * poweredFraction + coastSpeedMps * (1 - poweredFraction);
};

export function solveDynamicIntercept({ interceptor, targetState, physics,
  previousSolution = null, terminal = false }) {
  const initialDistanceM = magnitude(relativeLocalPosition(interceptor, targetState.position));
  let timeToGoSec = clamp(initialDistanceM
    / Math.max(interceptor.speedKmh / 3.6, physics.minimumEffectiveSpeedMps),
  0.05, physics.maxPredictionTimeSec);
  let rawInterceptPoint = targetState.position;
  for (let iteration = 0; iteration < 6; iteration += 1) {
    rawInterceptPoint = projectEstimatedTarget(targetState, timeToGoSec);
    const pathDistanceM = magnitude(relativeLocalPosition(interceptor, rawInterceptPoint));
    const revisedTimeSec = clamp(pathDistanceM
      / Math.max(estimateAvailableAverageSpeedMps(interceptor, physics, timeToGoSec), 1),
    0.05, physics.maxPredictionTimeSec);
    timeToGoSec += (revisedTimeSec - timeToGoSec) * 0.7;
  }
  const smoothing = terminal
    ? (physics.terminalInterceptSolutionSmoothing ?? 0.58)
    : (physics.midcourseInterceptSolutionSmoothing ?? 0.28);
  const interceptPoint = smoothPosition(previousSolution?.interceptPoint, rawInterceptPoint, smoothing);
  const interceptVector = relativeLocalPosition(interceptor, interceptPoint);
  const horizontalDistanceM = Math.hypot(interceptVector.eastM, interceptVector.northM);
  const interceptDistanceKm = magnitude(interceptVector) / 1000;
  const desiredHeading = getBearing(interceptor.lat, interceptor.lng, interceptPoint.lat, interceptPoint.lng);
  const desiredFlightPathAngleDeg = Math.atan2(interceptVector.upM,
    Math.max(horizontalDistanceM, 0.01)) * RAD_TO_DEG;
  const currentFlightPathAngleDeg = interceptor.flightPathAngleDeg
    ?? Math.atan2(interceptor.verticalSpeedMps ?? 0,
      Math.max(interceptor.speedKmh / 3.6, 1)) * RAD_TO_DEG;
  const headingErrorDeg = normalizeHeadingDelta(desiredHeading - interceptor.heading);
  const pitchErrorDeg = desiredFlightPathAngleDeg - currentFlightPathAngleDeg;
  const directionErrorDeg = Math.hypot(
    headingErrorDeg * Math.cos(currentFlightPathAngleDeg * DEG_TO_RAD), pitchErrorDeg);
  const turnPerformance = getEffectiveTurnPerformance(interceptor, physics, terminal);
  const requiredTurnTimeSec = directionErrorDeg
    / Math.max(turnPerformance.effectiveTurnRateDegPerSec, 0.01);
  const remainingFlightTimeSec = Math.max(0, physics.maxFlightTimeSec - interceptor.flightTime);
  const remainingRangeKm = Math.max(0, physics.maxGameRangeKm - interceptor.distanceTraveledKm);
  const energyRatio = interceptor.energyRatio
    ?? clamp01((interceptor.speedKmh / 3.6 / physics.maxSpeedMps) ** 2);
  const currentVelocity = velocityFromFlightPath(interceptor.heading,
    Math.max(interceptor.speedKmh / 3.6, 1), currentFlightPathAngleDeg);
  const requiredVerticalSpeedMps = interceptVector.upM / Math.max(timeToGoSec, 0.1);
  const requiredVerticalAccelerationMps2 = 2
    * (interceptVector.upM - currentVelocity.upMps * timeToGoSec)
    / Math.max(timeToGoSec ** 2, 0.01);
  const availableAccelerationMps2 = Math.max(interceptor.speedKmh / 3.6, 1)
    * turnPerformance.effectiveTurnRateDegPerSec * DEG_TO_RAD;
  let status = INTERCEPT_SOLUTION_STATUS.VALID;
  if (!Number.isFinite(timeToGoSec) || timeToGoSec >= remainingFlightTimeSec
    || interceptDistanceKm > remainingRangeKm
    || Math.abs(requiredVerticalAccelerationMps2) > availableAccelerationMps2 * 1.2
    || requiredTurnTimeSec > timeToGoSec * 1.05) status = INTERCEPT_SOLUTION_STATUS.INVALID;
  else if (requiredTurnTimeSec > timeToGoSec * 0.7
    || Math.abs(requiredVerticalAccelerationMps2) > availableAccelerationMps2 * 0.72
    || energyRatio < 0.16 || timeToGoSec > remainingFlightTimeSec * 0.82) {
    status = INTERCEPT_SOLUTION_STATUS.MARGINAL;
  }
  return {
    interceptPoint, rawInterceptPoint, desiredHeading, desiredFlightPathAngleDeg,
    headingErrorDeg, pitchErrorDeg, directionErrorDeg, timeToGoSec, interceptDistanceKm,
    horizontalInterceptDistanceKm: horizontalDistanceM / 1000,
    requiredTurnTimeSec, requiredVerticalSpeedMps, requiredVerticalAccelerationMps2,
    availableAccelerationMps2, remainingFlightTimeSec, remainingRangeKm, status,
  };
}

export function computeProportionalNavigation({ interceptor, targetState, solution,
  navigationConstant, physics, terminal = false }) {
  const relative = relativeLocalPosition(interceptor, targetState.position);
  const currentFlightPathAngleDeg = interceptor.flightPathAngleDeg
    ?? Math.atan2(interceptor.verticalSpeedMps ?? 0,
      Math.max(interceptor.speedKmh / 3.6, 1)) * RAD_TO_DEG;
  const missileVelocity = velocityFromFlightPath(interceptor.heading,
    Math.max(0, interceptor.speedKmh / 3.6), currentFlightPathAngleDeg);
  const relativeVelocity = subtract(targetState.velocity, missileVelocity);
  const rangeM = Math.max(1, magnitude(relative));
  const losUnit = normalize(relative);
  const closingSpeedMps = -dot(relativeVelocity, losUnit);
  const losOmega = scale(cross(relative, relativeVelocity), 1 / Math.max(rangeM ** 2, 1));
  const losRateRadPerSec = magnitude(losOmega);
  const pnAcceleration = scale(cross(losOmega, losUnit),
    navigationConstant * Math.max(0, closingSpeedMps));
  const speedMps = Math.max(interceptor.speedKmh / 3.6, 1);
  const velocityUnit = normalize(missileVelocity);
  const desiredDirection = normalize(relativeLocalPosition(interceptor, solution.interceptPoint));
  const captureDirection = rejectFrom(desiredDirection, velocityUnit);
  const captureAcceleration = scale(captureDirection,
    speedMps * (terminal ? 0.9 : 0.48) / Math.max(solution.timeToGoSec, 0.35));
  const turnPerformance = getEffectiveTurnPerformance(interceptor, physics, terminal);
  let availableAccelerationMps2 = speedMps
    * turnPerformance.effectiveTurnRateDegPerSec * DEG_TO_RAD;
  const aeroAvailableAccelerationMps2 = speedMps
    * turnPerformance.baseTurnRateDegPerSec * DEG_TO_RAD;
  const energyLimitedAccelerationMps2 = availableAccelerationMps2;
  const referenceMaxG = physics.referenceMaximumLoadFactorG;
  if (Number.isFinite(referenceMaxG)) availableAccelerationMps2 = Math.min(
    availableAccelerationMps2, referenceMaxG * GRAVITY_MPS2);
  const commandedAccelerationVectorMps2 = clampVector(
    rejectFrom(add(pnAcceleration, captureAcceleration), velocityUnit), availableAccelerationMps2);
  const commandedHorizontalAccelerationMps2 = Math.hypot(
    commandedAccelerationVectorMps2.eastMps, commandedAccelerationVectorMps2.northMps);
  const commandedVerticalAccelerationMps2 = commandedAccelerationVectorMps2.upMps;
  const commandedTotalAccelerationMps2 = magnitude(commandedAccelerationVectorMps2);
  const relativeVelocitySquared = Math.max(dot(relativeVelocity, relativeVelocity), 0.01);
  const linearClosestTimeSec = clamp(-dot(relative, relativeVelocity) / relativeVelocitySquared,
    0, Math.max(solution.timeToGoSec * 1.5, 0.1));
  const predictedClosestApproachM = magnitude(add(relative,
    scale(relativeVelocity, linearClosestTimeSec)));
  const horizontalRangeM = Math.max(0.01, Math.hypot(relative.eastM, relative.northM));
  const losAzimuthDeg = (Math.atan2(relative.eastM, relative.northM) * RAD_TO_DEG + 360) % 360;
  const losElevationDeg = Math.atan2(relative.upM, horizontalRangeM) * RAD_TO_DEG;
  const horizontalRangeRateMps = (relative.eastM * relativeVelocity.eastMps
    + relative.northM * relativeVelocity.northMps) / horizontalRangeM;
  const losAzimuthRateDegPerSec = (relative.northM * relativeVelocity.eastMps
    - relative.eastM * relativeVelocity.northMps)
    / Math.max(horizontalRangeM ** 2, 1) * RAD_TO_DEG;
  const losElevationRateDegPerSec = (horizontalRangeM * relativeVelocity.upMps
    - relative.upM * horizontalRangeRateMps) / Math.max(rangeM ** 2, 1) * RAD_TO_DEG;
  return {
    navigationConstant, losAngleDeg: losAzimuthDeg, losAzimuthDeg, losElevationDeg,
    losRateDegPerSec: losRateRadPerSec * RAD_TO_DEG,
    losAzimuthRateDegPerSec, losElevationRateDegPerSec, closingSpeedMps,
    predictedClosestApproachM, commandedAccelerationVectorMps2,
    commandedLateralAccelerationMps2: commandedHorizontalAccelerationMps2,
    commandedHorizontalAccelerationMps2, commandedVerticalAccelerationMps2,
    commandedTotalAccelerationMps2,
    availableLateralAccelerationMps2: availableAccelerationMps2,
    availableAccelerationMps2,
    profileMaxG: Number.isFinite(referenceMaxG) ? referenceMaxG : null,
    aeroAvailableG: aeroAvailableAccelerationMps2 / GRAVITY_MPS2,
    energyLimitedG: energyLimitedAccelerationMps2 / GRAVITY_MPS2,
    autopilotAllowedG: availableAccelerationMps2 / GRAVITY_MPS2,
    availableG: availableAccelerationMps2 / GRAVITY_MPS2,
    maximumG: Number.isFinite(referenceMaxG) ? referenceMaxG : availableAccelerationMps2 / GRAVITY_MPS2,
    turnPerformance,
  };
}

export function applyMissileAutopilot({ interceptor, command, deltaTimeSec, physics }) {
  const responseTimeSec = Math.max(0.04, physics.autopilotResponseTimeSec ?? 0.22);
  const responseAlpha = 1 - Math.exp(-deltaTimeSec / responseTimeSec);
  const previous = interceptor.actualAccelerationVectorMps2
    ?? { eastMps: 0, northMps: 0, upMps: 0 };
  let actualAccelerationVectorMps2 = {
    eastMps: previous.eastMps + (command.commandedAccelerationVectorMps2.eastMps
      - previous.eastMps) * responseAlpha,
    northMps: previous.northMps + (command.commandedAccelerationVectorMps2.northMps
      - previous.northMps) * responseAlpha,
    upMps: previous.upMps + (command.commandedAccelerationVectorMps2.upMps
      - previous.upMps) * responseAlpha,
  };
  const speedMps = Math.max(interceptor.speedKmh / 3.6, 1);
  const previousPitchDeg = interceptor.flightPathAngleDeg
    ?? Math.atan2(interceptor.verticalSpeedMps ?? 0, speedMps) * RAD_TO_DEG;
  const currentVelocity = velocityFromFlightPath(interceptor.heading, speedMps, previousPitchDeg);
  const velocityUnit = normalize(currentVelocity);
  actualAccelerationVectorMps2 = clampVector(
    rejectFrom(actualAccelerationVectorMps2, velocityUnit), command.availableAccelerationMps2);
  const nextDirection = normalize(add(currentVelocity,
    scale(actualAccelerationVectorMps2, deltaTimeSec)));
  const horizontalDirection = Math.hypot(nextDirection.eastMps, nextDirection.northMps);
  const heading = (Math.atan2(nextDirection.eastMps, nextDirection.northMps) * RAD_TO_DEG + 360) % 360;
  const flightPathAngleDeg = Math.atan2(nextDirection.upMps,
    Math.max(horizontalDirection, 1e-6)) * RAD_TO_DEG;
  const headingTurnRateDegPerSec = normalizeHeadingDelta(heading - interceptor.heading)
    / Math.max(deltaTimeSec, 1e-6);
  const pitchRateDegPerSec = (flightPathAngleDeg - previousPitchDeg) / Math.max(deltaTimeSec, 1e-6);
  const turnRateDegPerSec = magnitude(actualAccelerationVectorMps2) / speedMps * RAD_TO_DEG;
  const actualHorizontalAccelerationMps2 = Math.hypot(actualAccelerationVectorMps2.eastMps,
    actualAccelerationVectorMps2.northMps);
  const actualTotalAccelerationMps2 = magnitude(actualAccelerationVectorMps2);
  return {
    heading, flightPathAngleDeg, headingTurnRateDegPerSec, pitchRateDegPerSec,
    turnRateDegPerSec, actualAccelerationVectorMps2,
    actualLateralAccelerationMps2: actualHorizontalAccelerationMps2,
    actualHorizontalAccelerationMps2,
    actualVerticalAccelerationMps2: actualAccelerationVectorMps2.upMps,
    actualTotalAccelerationMps2,
    currentG: actualTotalAccelerationMps2 / GRAVITY_MPS2,
  };
}

export function calculateInterceptQuality({ solution, command, interceptor, physics }) {
  if (solution.status === INTERCEPT_SOLUTION_STATUS.INVALID) return 0;
  const accelerationMargin = 1 - clamp01(command.commandedTotalAccelerationMps2
    / Math.max(command.availableAccelerationMps2, 0.01));
  const energy = interceptor.energyRatio
    ?? clamp01((interceptor.speedKmh / 3.6 / physics.maxSpeedMps) ** 2);
  const timeMargin = clamp01((solution.remainingFlightTimeSec - solution.timeToGoSec)
    / Math.max(solution.remainingFlightTimeSec, 1));
  const losStability = 1 - clamp01(Math.abs(command.losRateDegPerSec) / 10);
  const contactEnvelopeM = Math.max(
    physics.minimumVisualContactDistanceM ?? physics.proximityFuseRadiusM,
    physics.proximityFuseRadiusM, 1);
  const approachQuality = Math.exp(-command.predictedClosestApproachM
    / Math.max(contactEnvelopeM * 1.8, 1));
  const verticalDemand = 1 - clamp01(Math.abs(solution.requiredVerticalAccelerationMps2)
    / Math.max(solution.availableAccelerationMps2, 0.01));
  const statusFactor = solution.status === INTERCEPT_SOLUTION_STATUS.VALID ? 1 : 0.48;
  return clamp01(statusFactor * (approachQuality * 0.48 + accelerationMargin * 0.14
    + energy * 0.12 + timeMargin * 0.09 + losStability * 0.09 + verticalDemand * 0.08));
}
