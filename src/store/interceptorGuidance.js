import { getBearing, getDistanceKm } from './geo.js';
import { TRACK_STATE } from './trackSystem.js';
import { INTERCEPTOR_LAUNCH_PHASE } from './interceptorLaunch.js';
import { LAUNCH_MODE } from '../data/launchProfiles.js';
import {
  INTERCEPT_SOLUTION_STATUS,
  applyMissileAutopilot,
  calculateInterceptQuality,
  computeProportionalNavigation,
  estimateTargetState,
  normalizeHeadingDelta,
  solveDynamicIntercept,
} from './missileGuidanceCore.js';
import { SEEKER_STATE, SEEKER_TYPE } from '../data/seekerProfiles.js';
import {
  getSeekerGuidanceTrack,
  SEEKER_GUIDANCE_SOURCE,
} from './seekerSystem.js';

export const INTERCEPTOR_GUIDANCE_STATE = Object.freeze({
  BOOST: 'BOOST', MIDCOURSE: 'MIDCOURSE', GUIDING: 'MIDCOURSE',
  TERMINAL: 'TERMINAL', REATTACK: 'REATTACK',
  INTERCEPT_LOST: 'INTERCEPT_LOST', COAST: 'COAST',
});

export const INTERCEPTOR_FAILURE_REASON = Object.freeze({
  MISS: 'MISS', ENERGY_DEPLETED: 'ENERGY_DEPLETED', TRACK_LOST: 'TRACK_LOST',
  TARGET_UNAVAILABLE: 'TARGET_UNAVAILABLE', GEOMETRY_LOST: 'GEOMETRY_LOST',
  INTERCEPT_LOST: 'INTERCEPT_LOST',
});

export function turnTowardHeading(currentHeading, desiredHeading, maximumTurnDegrees) {
  const delta = normalizeHeadingDelta(desiredHeading - currentHeading);
  return (currentHeading + Math.max(-maximumTurnDegrees, Math.min(maximumTurnDegrees, delta)) + 360) % 360;
}

export function createInterceptorGuidance(track, simulationTime, interceptSolution = null, launchPosition = null) {
  const predicted = interceptSolution?.predictedInterceptPoint;
  const commandPosition = predicted
    ? { ...predicted, alt: predicted.altitudeM ?? predicted.alt ?? 0 }
    : { ...track.reportedPosition };
  return {
    reportedPosition: { ...track.reportedPosition },
    reportedHeading: track.reportedHeading,
    reportedSpeedKmh: track.reportedSpeedKmh,
    reportedHorizontalSpeedKmh: track.reportedHorizontalSpeedKmh ?? track.reportedSpeedKmh,
    reportedVerticalSpeedMps: track.reportedVerticalSpeedMps ?? 0,
    estimatedTurnRateDegPerSec: track.estimatedTurnRateDegPerSec ?? 0,
    trackLastUpdateTime: track.lastUpdateTime,
    commandPosition,
    commandHeading: launchPosition
      ? getBearing(launchPosition.lat, launchPosition.lng, commandPosition.lat, commandPosition.lng)
      : null,
    interceptSolution: null,
    lastCommandTime: simulationTime,
    trackLostSince: track.state === TRACK_STATE.LOST ? simulationTime : null,
    guidanceSource: SEEKER_GUIDANCE_SOURCE.NETWORK_TRACK,
  };
}

const getNavigationConstant = (physics, state) => {
  if (state === INTERCEPTOR_GUIDANCE_STATE.TERMINAL) return physics.navigationConstantTerminal ?? 4.8;
  if (state === INTERCEPTOR_GUIDANCE_STATE.REATTACK) return physics.navigationConstantReattack ?? 3.6;
  return physics.navigationConstantMidcourse ?? physics.referenceProportionalNavigationConstant ?? 3.8;
};

const canAttemptReattack = ({ interceptor, solution, physics, turnRateDegPerSec }) => {
  const timeLeft = Math.max(0, physics.maxFlightTimeSec - interceptor.flightTime);
  const rangeLeft = Math.max(0, physics.maxGameRangeKm - interceptor.distanceTraveledKm);
  const requiredTurnDeg = Math.abs(solution.directionErrorDeg ?? solution.headingErrorDeg);
  const turnTime = requiredTurnDeg / Math.max(Math.abs(turnRateDegPerSec), 0.1);
  const turnArcDistanceKm = interceptor.speedKmh / 3.6 * turnTime / 1000;
  const energyRatio = interceptor.energyRatio ?? 0;
  const projectedTurnEnergyCost = requiredTurnDeg / 180
    * (physics.turnEnergyLossFactor ?? 0.02) * 4;
  const projectedEnergyRatio = Math.max(0, energyRatio - projectedTurnEnergyCost);
  return solution.status !== INTERCEPT_SOLUTION_STATUS.INVALID
    && timeLeft > Math.max(2, solution.timeToGoSec * 0.75)
    && rangeLeft > (solution.interceptDistanceKm + turnArcDistanceKm) * 1.12
    && interceptor.speedKmh / 3.6 > physics.minimumEffectiveSpeedMps * 1.08
    && projectedEnergyRatio > 0.14
    && turnTime < Math.min(timeLeft * 0.38, 10);
};

const disabledResult = (interceptor, guidance, physics, heading) => ({
  guidance, heading, desiredHeading: heading, headingCorrectionDeg: 0,
  flightPathAngleDeg: interceptor.flightPathAngleDeg ?? 0,
  desiredFlightPathAngleDeg: interceptor.flightPathAngleDeg ?? 0,
  pitchErrorDeg: 0, pitchRateDegPerSec: 0, headingTurnRateDegPerSec: 0,
  turnRateDegPerSec: 0, maximumTurnRateDegPerSec: physics.turnRateDegPerSec,
  guidanceState: INTERCEPTOR_GUIDANCE_STATE.BOOST, guidanceEnabled: false,
  commandedAccelerationVectorMps2: { eastMps: 0, northMps: 0, upMps: 0 },
  actualAccelerationVectorMps2: interceptor.actualAccelerationVectorMps2
    ?? { eastMps: 0, northMps: 0, upMps: 0 },
  commandedLateralAccelerationMps2: 0,
  actualLateralAccelerationMps2: interceptor.actualLateralAccelerationMps2 ?? 0,
  failedReason: null,
});

export function advanceInterceptorGuidance({ interceptor, track, simulationTime, deltaTimeSec, physics }) {
  let guidance = { ...interceptor.guidance };
  const guidanceTrack = getSeekerGuidanceTrack(interceptor.seeker, track);
  const inputGuidanceSource = guidanceTrack?.guidanceSource
    ?? SEEKER_GUIDANCE_SOURCE.NETWORK_TRACK;
  const guidanceSourceChanged = inputGuidanceSource !== guidance.guidanceSource;
  const activeTrack = guidanceTrack && guidanceTrack.state !== TRACK_STATE.LOST;
  const receivedMeasurement = activeTrack && (guidanceSourceChanged
    || guidanceTrack.lastUpdateTime > guidance.trackLastUpdateTime);
  if (receivedMeasurement) {
    guidance = {
      ...guidance,
      reportedPosition: { ...guidanceTrack.reportedPosition },
      reportedHeading: guidanceTrack.reportedHeading,
      reportedSpeedKmh: guidanceTrack.reportedSpeedKmh,
      reportedHorizontalSpeedKmh: guidanceTrack.reportedHorizontalSpeedKmh
        ?? guidanceTrack.reportedSpeedKmh,
      reportedVerticalSpeedMps: guidanceTrack.reportedVerticalSpeedMps ?? 0,
      estimatedTurnRateDegPerSec: guidanceTrack.estimatedTurnRateDegPerSec ?? 0,
      trackLastUpdateTime: guidanceTrack.lastUpdateTime,
      trackLostSince: null,
      guidanceSource: inputGuidanceSource,
    };
  } else if (activeTrack) guidance.trackLostSince = null;
  else if (guidance.trackLostSince === null) guidance.trackLostSince = simulationTime;

  const lostDuration = guidance.trackLostSince === null ? 0 : simulationTime - guidance.trackLostSince;
  if (lostDuration > physics.lostTrackContinueSec) {
    return { ...disabledResult(interceptor, guidance, physics, interceptor.heading),
      guidanceState: INTERCEPTOR_GUIDANCE_STATE.INTERCEPT_LOST,
      failedReason: INTERCEPTOR_FAILURE_REASON.TRACK_LOST };
  }

  if (interceptor.launchPhase === INTERCEPTOR_LAUNCH_PHASE.LAUNCH_EXIT
    || interceptor.launchPhase === INTERCEPTOR_LAUNCH_PHASE.PITCH_OVER) {
    const heading = interceptor.launchMode === LAUNCH_MODE.VERTICAL
      ? (interceptor.pitchOverHeading ?? interceptor.initialLaunchHeading ?? interceptor.heading)
      : (interceptor.initialLaunchHeading ?? interceptor.heading);
    return disabledResult(interceptor, guidance, physics, heading);
  }
  if (interceptor.flightTime < (interceptor.guidanceEnableDelaySec ?? 0)) {
    return disabledResult(interceptor, guidance, physics, interceptor.initialLaunchHeading ?? interceptor.heading);
  }

  const targetState = estimateTargetState(guidance, simulationTime);
  const distanceKm = getDistanceKm(interceptor.lat, interceptor.lng,
    targetState.position.lat, targetState.position.lng);
  const previousTgo = guidance.interceptSolution?.timeToGoSec ?? Infinity;
  const seekerControlsTerminal = interceptor.seeker?.enabled !== false
    && interceptor.seeker?.seekerType !== SEEKER_TYPE.NONE;
  const terminal = seekerControlsTerminal
    ? interceptor.seeker?.state === SEEKER_STATE.TERMINAL
    : distanceKm <= physics.terminalRangeKm
      || previousTgo <= Math.max(5,
        physics.terminalRangeKm * 1000 / Math.max(interceptor.speedKmh / 3.6, 1));
  const interval = terminal ? physics.terminalGuidanceIntervalSec : physics.midcourseGuidanceIntervalSec;
  if (receivedMeasurement || !guidance.interceptSolution || simulationTime - guidance.lastCommandTime >= interval) {
    const solution = solveDynamicIntercept({ interceptor, targetState, physics,
      previousSolution: guidance.interceptSolution, terminal });
    guidance = { ...guidance, interceptSolution: solution,
      commandPosition: solution.interceptPoint, commandHeading: solution.desiredHeading,
      predictedInterceptTimeSec: solution.timeToGoSec, lastCommandTime: simulationTime };
  }

  let solution = guidance.interceptSolution;
  const bearingToTrack = getBearing(interceptor.lat, interceptor.lng,
    targetState.position.lat, targetState.position.lng);
  const passedTarget = Math.abs(normalizeHeadingDelta(bearingToTrack - interceptor.heading)) > 95
    && (interceptor.timeSinceClosestApproachSec ?? 0) >= physics.postPassContinueSec;
  let guidanceState = terminal ? INTERCEPTOR_GUIDANCE_STATE.TERMINAL : INTERCEPTOR_GUIDANCE_STATE.MIDCOURSE;
  if (guidance.trackLostSince !== null) guidanceState = INTERCEPTOR_GUIDANCE_STATE.COAST;
  let command = computeProportionalNavigation({ interceptor, targetState, solution,
    navigationConstant: getNavigationConstant(physics, guidanceState), physics, terminal });

  if (passedTarget) {
    if (!canAttemptReattack({ interceptor, solution, physics,
      turnRateDegPerSec: command.turnPerformance.effectiveTurnRateDegPerSec })) {
      return { guidance, heading: interceptor.heading, desiredHeading: solution.desiredHeading,
        headingCorrectionDeg: solution.headingErrorDeg,
        guidanceState: INTERCEPTOR_GUIDANCE_STATE.INTERCEPT_LOST, guidanceEnabled: true,
        interceptSolutionStatus: solution.status,
        failedReason: INTERCEPTOR_FAILURE_REASON.INTERCEPT_LOST };
    }
    guidanceState = INTERCEPTOR_GUIDANCE_STATE.REATTACK;
    command = computeProportionalNavigation({ interceptor, targetState, solution,
      navigationConstant: getNavigationConstant(physics, guidanceState), physics, terminal: true });
  }

  // A short time-to-go with a multi-kilometre predicted miss is not a viable
  // solution even if the range/time budget itself still looks healthy.
  const correctionTimeSec = Math.max(solution.timeToGoSec, 0.15);
  const requiredCorrectionAccelerationMps2 = 2 * command.predictedClosestApproachM
    / (correctionTimeSec ** 2);
  const correctionAuthorityRatio = requiredCorrectionAccelerationMps2
    / Math.max(command.availableAccelerationMps2, 0.01);
  const contactEnvelopeM = Math.max(
    physics.minimumVisualContactDistanceM ?? physics.proximityFuseRadiusM,
    physics.proximityFuseRadiusM,
    1,
  );
  let refinedStatus = solution.status;
  if (correctionAuthorityRatio > 1.08
    || (solution.timeToGoSec < 8 && command.predictedClosestApproachM > contactEnvelopeM * 6)) {
    refinedStatus = INTERCEPT_SOLUTION_STATUS.INVALID;
  } else if (refinedStatus === INTERCEPT_SOLUTION_STATUS.VALID
    && (correctionAuthorityRatio > 0.68
      || command.predictedClosestApproachM > contactEnvelopeM * 3)) {
    refinedStatus = INTERCEPT_SOLUTION_STATUS.MARGINAL;
  }
  if (refinedStatus !== solution.status) {
    solution = { ...solution, status: refinedStatus };
    guidance = { ...guidance, interceptSolution: solution };
  }

  const autopilot = applyMissileAutopilot({ interceptor, command, deltaTimeSec, physics });
  const interceptQuality = calculateInterceptQuality({ solution, command, interceptor, physics });
  return {
    guidance, heading: autopilot.heading, desiredHeading: solution.desiredHeading,
    flightPathAngleDeg: autopilot.flightPathAngleDeg,
    desiredFlightPathAngleDeg: solution.desiredFlightPathAngleDeg,
    headingCorrectionDeg: solution.headingErrorDeg,
    directionCorrectionDeg: solution.directionErrorDeg,
    horizontalHeadingErrorDeg: solution.headingErrorDeg,
    pitchErrorDeg: solution.pitchErrorDeg,
    turnRateDegPerSec: autopilot.turnRateDegPerSec,
    headingTurnRateDegPerSec: autopilot.headingTurnRateDegPerSec,
    pitchRateDegPerSec: autopilot.pitchRateDegPerSec,
    maximumTurnRateDegPerSec: command.turnPerformance.baseTurnRateDegPerSec,
    energyFactor: command.turnPerformance.energyFactor,
    speedFactor: command.turnPerformance.speedFactor,
    turnRadiusKm: command.turnPerformance.turnRadiusKm,
    guidanceState, guidanceEnabled: true,
    navigationConstant: command.navigationConstant,
    closingSpeedMps: command.closingSpeedMps,
    losAngleDeg: command.losAngleDeg,
    losRateDegPerSec: command.losRateDegPerSec,
    losAzimuthDeg: command.losAzimuthDeg,
    losElevationDeg: command.losElevationDeg,
    losAzimuthRateDegPerSec: command.losAzimuthRateDegPerSec,
    losElevationRateDegPerSec: command.losElevationRateDegPerSec,
    commandedAccelerationVectorMps2: command.commandedAccelerationVectorMps2,
    commandedLateralAccelerationMps2: command.commandedLateralAccelerationMps2,
    commandedHorizontalAccelerationMps2: command.commandedHorizontalAccelerationMps2,
    commandedVerticalAccelerationMps2: command.commandedVerticalAccelerationMps2,
    commandedTotalAccelerationMps2: command.commandedTotalAccelerationMps2,
    actualAccelerationVectorMps2: autopilot.actualAccelerationVectorMps2,
    actualLateralAccelerationMps2: autopilot.actualLateralAccelerationMps2,
    actualHorizontalAccelerationMps2: autopilot.actualHorizontalAccelerationMps2,
    actualVerticalAccelerationMps2: autopilot.actualVerticalAccelerationMps2,
    actualTotalAccelerationMps2: autopilot.actualTotalAccelerationMps2,
    currentG: autopilot.currentG, availableG: command.availableG, maximumG: command.maximumG,
    profileMaxG: command.profileMaxG,
    aeroAvailableG: command.aeroAvailableG,
    energyLimitedG: command.energyLimitedG,
    autopilotAllowedG: command.autopilotAllowedG,
    predictedInterceptDistanceKm: solution.interceptDistanceKm,
    estimatedTimeToGoSec: solution.timeToGoSec,
    predictedClosestApproachM: command.predictedClosestApproachM,
    requiredVerticalSpeedMps: solution.requiredVerticalSpeedMps,
    requiredVerticalAccelerationMps2: solution.requiredVerticalAccelerationMps2,
    requiredCorrectionAccelerationMps2,
    correctionAuthorityRatio,
    interceptSolutionStatus: solution.status,
    interceptQuality,
    guidanceSource: guidance.guidanceSource,
    failedReason: null,
  };
}
