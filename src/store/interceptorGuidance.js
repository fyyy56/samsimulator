import { getBearing, getDestinationPoint, getDistanceKm } from './geo.js';
import { TRACK_STATE } from './trackSystem.js';

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
});

const normalizeHeadingDelta = delta => ((delta + 540) % 360) - 180;

export function turnTowardHeading(currentHeading, desiredHeading, maximumTurnDegrees) {
  const headingDelta = normalizeHeadingDelta(desiredHeading - currentHeading);
  const appliedTurn = Math.max(-maximumTurnDegrees, Math.min(maximumTurnDegrees, headingDelta));
  return (currentHeading + appliedTurn + 360) % 360;
}

export function createInterceptorGuidance(track, simulationTime) {
  return {
    reportedPosition: { ...track.reportedPosition },
    reportedHeading: track.reportedHeading,
    reportedSpeedKmh: track.reportedSpeedKmh,
    trackLastUpdateTime: track.lastUpdateTime,
    commandPosition: { ...track.reportedPosition },
    commandHeading: null,
    lastCommandTime: simulationTime,
    trackLostSince: track.state === TRACK_STATE.LOST ? simulationTime : null,
  };
}

const projectPosition = (position, heading, speedKmh, seconds) => {
  if (heading === null || speedKmh === null || seconds <= 0) return { ...position };
  const projected = getDestinationPoint(position.lat, position.lng, heading, speedKmh * seconds / 3600);
  return { ...projected, alt: position.alt };
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
    const timeToTrackSec = distanceToTrackKm / Math.max(interceptor.speedKmh, 1) * 3600;
    const leadTimeSec = Math.min(
      physics.maxPredictionTimeSec,
      timeToTrackSec * (isTerminal ? 0.3 : 0.6),
    );
    const commandPosition = projectPosition(
      coastedTrackPosition,
      guidance.reportedHeading,
      guidance.reportedSpeedKmh,
      leadTimeSec,
    );
    guidance = {
      ...guidance,
      commandPosition,
      commandHeading: getBearing(
        interceptor.lat,
        interceptor.lng,
        commandPosition.lat,
        commandPosition.lng,
      ),
      lastCommandTime: simulationTime,
    };
  }

  const turnRateDegPerSec = isTerminal
    ? physics.terminalTurnRateDegPerSec
    : physics.maxTurnRateDegPerSec;
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

  return { guidance, heading, guidanceState, failedReason: null };
}
