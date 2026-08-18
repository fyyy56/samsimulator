import { getBearing, getDestinationPoint, getDistanceKm } from './geo.js';
import { TRACK_STATE } from './trackSystem.js';
import { getEffectiveTurnPerformance } from './interceptorPhysics.js';

export const INTERCEPTOR_GUIDANCE_STATE = Object.freeze({
  BOOST: 'BOOST',
  GUIDING: 'GUIDING',
  TERMINAL: 'TERMINAL',
  COAST: 'COAST',
});

export const INTERCEPTOR_FAILURE_REASON = Object.freeze({
  MISS: 'MISS',
  ENERGY_DEPLETED: 'ENERGY_DEPLETED',
  TRACK_LOST: 'TRACK_LOST',
  TARGET_UNAVAILABLE: 'TARGET_UNAVAILABLE',
  GEOMETRY_LOST: 'GEOMETRY_LOST',
});

const normalizeHeadingDelta = delta => ((delta + 540) % 360) - 180;
const clamp01 = value => Math.max(0, Math.min(1, value));

const getDeterministicInterceptOffset = (interceptorId) => {
  if (!interceptorId) return { lateralOffsetM: 0, lateralSide: 1 };
  let hash = 0;
  for (let index = 0; index < interceptorId.length; index += 1) {
    hash = (hash * 31 + interceptorId.charCodeAt(index)) >>> 0;
  }
  return {
    lateralOffsetM: 35 + (hash % 66),
    lateralSide: hash % 2 === 0 ? 1 : -1,
  };
};

const applyInterceptOffset = (position, targetHeading, offset, scale = 1) => {
  if (!position || targetHeading === null || offset.lateralOffsetM <= 0 || scale <= 0) {
    return { ...position };
  }
  const shifted = getDestinationPoint(
    position.lat,
    position.lng,
    targetHeading + offset.lateralSide * 90,
    offset.lateralOffsetM * scale / 1000,
  );
  return { ...position, ...shifted };
};

export function turnTowardHeading(currentHeading, desiredHeading, maximumTurnDegrees) {
  const headingDelta = normalizeHeadingDelta(desiredHeading - currentHeading);
  const appliedTurn = Math.max(-maximumTurnDegrees, Math.min(maximumTurnDegrees, headingDelta));
  return (currentHeading + appliedTurn + 360) % 360;
}

export function createInterceptorGuidance(
  track,
  simulationTime,
  interceptSolution = null,
  launchPosition = null,
  interceptorId = null,
) {
  const predictedPosition = interceptSolution?.predictedInterceptPoint;
  const interceptOffset = getDeterministicInterceptOffset(interceptorId);
  const offsetPredictedPosition = predictedPosition
    ? applyInterceptOffset(predictedPosition, track.reportedHeading, interceptOffset)
    : null;
  return {
    reportedPosition: { ...track.reportedPosition },
    reportedHeading: track.reportedHeading,
    reportedSpeedKmh: track.reportedSpeedKmh,
    trackLastUpdateTime: track.lastUpdateTime,
    commandPosition: offsetPredictedPosition
      ? { ...offsetPredictedPosition, alt: predictedPosition.altitudeM }
      : { ...track.reportedPosition },
    commandHeading: offsetPredictedPosition && launchPosition
      ? getBearing(
        launchPosition.lat,
        launchPosition.lng,
        offsetPredictedPosition.lat,
        offsetPredictedPosition.lng,
      )
      : null,
    ...interceptOffset,
    lastCommandTime: simulationTime,
    trackLostSince: track.state === TRACK_STATE.LOST ? simulationTime : null,
  };
}

const projectPosition = (position, heading, speedKmh, seconds) => {
  if (heading === null || speedKmh === null || seconds <= 0) return { ...position };
  const projected = getDestinationPoint(position.lat, position.lng, heading, speedKmh * seconds / 3600);
  return { ...projected, alt: position.alt };
};

const predictInterceptCommand = ({
  interceptor,
  targetPosition,
  targetHeading,
  targetSpeedKmh,
  physics,
}) => {
  const effectiveInterceptorSpeedKmh = Math.max(
    interceptor.speedKmh,
    (physics.maneuverReferenceSpeedMps ?? 500) * 3.6,
    (physics.maxSpeedMps ?? 800) * 3.6 * 0.62,
  );
  const latitudeScaleKm = 111.32;
  const longitudeScaleKm = latitudeScaleKm * Math.cos(
    ((interceptor.lat + targetPosition.lat) / 2) * Math.PI / 180,
  );
  const relativeEastKm = (targetPosition.lng - interceptor.lng) * longitudeScaleKm;
  const relativeNorthKm = (targetPosition.lat - interceptor.lat) * latitudeScaleKm;
  const targetHeadingRad = (targetHeading ?? 0) * Math.PI / 180;
  const targetSpeedKmSec = Math.max(0, targetSpeedKmh ?? 0) / 3600;
  const targetVelocityEast = Math.sin(targetHeadingRad) * targetSpeedKmSec;
  const targetVelocityNorth = Math.cos(targetHeadingRad) * targetSpeedKmSec;
  const interceptorSpeedKmSec = effectiveInterceptorSpeedKmh / 3600;

  // |relativePosition + targetVelocity * t| = interceptorSpeed * t.
  // Solving this quadratic directly is stable for fast approaching ballistic
  // targets; fixed-point projection could oscillate across the launcher and
  // command the missile in the opposite direction.
  const quadraticA = targetVelocityEast ** 2
    + targetVelocityNorth ** 2
    - interceptorSpeedKmSec ** 2;
  const quadraticB = 2 * (
    relativeEastKm * targetVelocityEast
    + relativeNorthKm * targetVelocityNorth
  );
  const quadraticC = relativeEastKm ** 2 + relativeNorthKm ** 2;
  const positiveSolutions = [];
  if (Math.abs(quadraticA) < 1e-9) {
    if (Math.abs(quadraticB) > 1e-9) positiveSolutions.push(-quadraticC / quadraticB);
  } else {
    const discriminant = quadraticB ** 2 - 4 * quadraticA * quadraticC;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      positiveSolutions.push(
        (-quadraticB - root) / (2 * quadraticA),
        (-quadraticB + root) / (2 * quadraticA),
      );
    }
  }
  const interceptTimeSec = positiveSolutions
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((first, second) => first - second)[0]
    ?? getDistanceKm(
      interceptor.lat,
      interceptor.lng,
      targetPosition.lat,
      targetPosition.lng,
    ) / effectiveInterceptorSpeedKmh * 3600;
  const boundedInterceptTimeSec = Math.min(
    physics.maxPredictionTimeSec,
    Math.max(0, interceptTimeSec),
  );
  const predictedPosition = projectPosition(
    targetPosition,
    targetHeading,
    targetSpeedKmh,
    boundedInterceptTimeSec,
  );

  return {
    predictedPosition,
    interceptTimeSec: boundedInterceptTimeSec,
  };
};

export function advanceInterceptorGuidance({
  interceptor,
  track,
  simulationTime,
  deltaTimeSec,
  physics,
}) {
  let guidance = { ...interceptor.guidance };
  const hasActiveTrack = track && track.state !== TRACK_STATE.LOST;
  const receivedMeasurement = hasActiveTrack
    && track.lastUpdateTime > guidance.trackLastUpdateTime;

  if (receivedMeasurement) {
    guidance = {
      ...guidance,
      reportedPosition: { ...track.reportedPosition },
      reportedHeading: track.reportedHeading,
      reportedSpeedKmh: track.reportedSpeedKmh,
      trackLastUpdateTime: track.lastUpdateTime,
      trackLostSince: null,
    };
  } else if (hasActiveTrack) {
    guidance.trackLostSince = null;
  } else if (guidance.trackLostSince === null) {
    guidance.trackLostSince = simulationTime;
  }

  const lostTrackDurationSec = guidance.trackLostSince === null
    ? 0
    : simulationTime - guidance.trackLostSince;
  if (lostTrackDurationSec > physics.lostTrackContinueSec) {
    return {
      guidance,
      heading: interceptor.heading,
      guidanceState: INTERCEPTOR_GUIDANCE_STATE.COAST,
      failedReason: INTERCEPTOR_FAILURE_REASON.TRACK_LOST,
    };
  }

  const measurementAgeSec = Math.max(0, simulationTime - guidance.trackLastUpdateTime);
  const coastedTrackPosition = projectPosition(
    guidance.reportedPosition,
    guidance.reportedHeading,
    guidance.reportedSpeedKmh,
    measurementAgeSec,
  );
  const distanceToTrackKm = getDistanceKm(
    interceptor.lat,
    interceptor.lng,
    coastedTrackPosition.lat,
    coastedTrackPosition.lng,
  );
  const isTerminal = distanceToTrackKm <= physics.terminalRangeKm;
  const updateIntervalSec = isTerminal
    ? physics.terminalGuidanceIntervalSec
    : physics.midcourseGuidanceIntervalSec;
  const commandDue = receivedMeasurement
    || simulationTime - guidance.lastCommandTime >= updateIntervalSec;

  if (commandDue || guidance.commandHeading === null) {
    const interceptPrediction = predictInterceptCommand({
      interceptor,
      targetPosition: coastedTrackPosition,
      targetHeading: guidance.reportedHeading,
      targetSpeedKmh: guidance.reportedSpeedKmh,
      physics,
    });
    const projectedCommandPosition = interceptPrediction.predictedPosition;
    const terminalOffsetScale = isTerminal
      ? clamp01(distanceToTrackKm / Math.max(physics.terminalRangeKm, 0.001))
      : 1;
    const commandPosition = applyInterceptOffset(
      projectedCommandPosition,
      guidance.reportedHeading,
      guidance,
      terminalOffsetScale,
    );
    guidance = {
      ...guidance,
      commandPosition,
      predictedInterceptTimeSec: interceptPrediction.interceptTimeSec,
      commandHeading: getBearing(
        interceptor.lat,
        interceptor.lng,
        commandPosition.lat,
        commandPosition.lng,
      ),
      lastCommandTime: simulationTime,
    };
  }

  const headingCorrectionDeg = normalizeHeadingDelta(
    guidance.commandHeading - interceptor.heading,
  );
  const excessiveCorrection = Math.abs(headingCorrectionDeg)
    > (physics.maximumGuidanceCorrectionDeg ?? 105);
  guidance.excessiveCorrectionSince = excessiveCorrection
    ? (guidance.excessiveCorrectionSince ?? simulationTime)
    : null;
  const excessiveCorrectionDurationSec = guidance.excessiveCorrectionSince === null
    ? 0
    : simulationTime - guidance.excessiveCorrectionSince;
  if (
    interceptor.flightTime >= (physics.guidanceGeometryCheckDelaySec ?? 2)
    && excessiveCorrectionDurationSec >= (physics.geometryLossGraceSec ?? 0.35)
  ) {
    return {
      guidance,
      heading: interceptor.heading,
      desiredHeading: guidance.commandHeading,
      headingCorrectionDeg,
      guidanceState: INTERCEPTOR_GUIDANCE_STATE.COAST,
      failedReason: INTERCEPTOR_FAILURE_REASON.GEOMETRY_LOST,
    };
  }

  const turnPerformance = getEffectiveTurnPerformance(interceptor, physics, isTerminal);
  const turnRateDegPerSec = turnPerformance.effectiveTurnRateDegPerSec;
  const heading = turnTowardHeading(
    interceptor.heading,
    guidance.commandHeading,
    turnRateDegPerSec * deltaTimeSec,
  );
  let guidanceState = INTERCEPTOR_GUIDANCE_STATE.GUIDING;
  if (interceptor.flightTime <= physics.motorBurnTimeSec) {
    guidanceState = INTERCEPTOR_GUIDANCE_STATE.BOOST;
  } else if (guidance.trackLostSince !== null) {
    guidanceState = INTERCEPTOR_GUIDANCE_STATE.COAST;
  } else if (isTerminal) {
    guidanceState = INTERCEPTOR_GUIDANCE_STATE.TERMINAL;
  }

  return {
    guidance,
    heading,
    desiredHeading: guidance.commandHeading,
    headingCorrectionDeg,
    turnRateDegPerSec,
    maximumTurnRateDegPerSec: turnPerformance.baseTurnRateDegPerSec,
    energyFactor: turnPerformance.energyFactor,
    speedFactor: turnPerformance.speedFactor,
    turnRadiusKm: turnPerformance.turnRadiusKm,
    guidanceState,
    failedReason: null,
  };
}
