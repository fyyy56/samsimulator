import { getBearing, getDestinationPoint, getDistanceKm, getSlantDistanceKm } from './geo.js';
import { getInterceptorSpec } from '../data/interceptors.js';
import {
  advanceInterceptorFlight,
  applyAltitudeEnergyExchange,
  getEffectiveTurnPerformance,
} from './interceptorPhysics.js';
import {
  measureSimulationSubsystem,
  SIMULATION_SUBSYSTEM,
} from './performanceMonitor.js';

export const INTERCEPT_FEASIBILITY = Object.freeze({
  VALID: 'VALID',
  MARGINAL: 'MARGINAL',
  NO_SOLUTION: 'NO_SOLUTION',
});

export const INTERCEPT_SOLUTION_REASON = Object.freeze({
  SOLUTION_AVAILABLE: 'SOLUTION_AVAILABLE',
  NARROW_MARGIN: 'NARROW_MARGIN',
  TOO_LATE: 'TOO_LATE',
  KINEMATICALLY_UNREACHABLE: 'KINEMATICALLY_UNREACHABLE',
  NO_OPERATIONAL_LAUNCHER: 'NO_OPERATIONAL_LAUNCHER',
  INVALID_INPUT: 'INVALID_INPUT',
});

export const INTERCEPT_FEASIBILITY_CONFIG = Object.freeze({
  solverStepSec: 0.5,
  solverRefinementIterations: 6,
  solverBracketGrowth: 1.8,
  courseChangePathPenaltyAt180Deg: 0.14,
  marginalMinimumTimeMarginSec: 4,
  marginalTimeMarginRatio: 0.12,
  marginalRangeReserveRatio: 0.1,
  marginalEnergyReserveRatio: 1.2,
});

const normalizeHeadingDelta = delta => ((delta + 540) % 360) - 180;

const asPosition = (entity) => {
  const position = entity?.position ?? entity?.reportedPosition ?? entity;
  if (!position || !Number.isFinite(position.lat)) return null;
  const lng = position.lng ?? position.lon;
  if (!Number.isFinite(lng)) return null;
  return {
    lat: position.lat,
    lng,
    altitudeM: entity?.altitudeM ?? position.altitudeM ?? position.alt ?? 0,
  };
};

const getWaypointAltitudeM = (waypoint, fallbackAltitudeM) => (
  waypoint.altitudeM ?? waypoint.alt ?? fallbackAltitudeM
);

const getTargetSpeedKmh = target => (
  target.reportedSpeedKmh
  ?? target.velocity?.speedKmh
  ?? target.speedKmh
  ?? 0
);

const getTargetHeadingDeg = target => (
  target.reportedHeading
  ?? target.velocity?.heading
  ?? target.heading
  ?? 0
);

const getTargetVerticalSpeedMps = target => (
  target.reportedVerticalSpeedMps
  ?? target.velocity?.verticalSpeedMps
  ?? target.verticalSpeedMps
  ?? 0
);

const resolveTargetState = (target, track, { includeKnownRoute = false } = {}) => {
  const source = track ?? target;
  const position = asPosition(source);
  if (!position) return null;
  const isPhysicsBallisticTarget = target?.ballisticPhysics?.enabled === true;
  return {
    position,
    speedKmh: target?.ballisticPhysics?.enabled
      ? target.ballisticPhysics.horizontalSpeedMps * 3.6
      : (source?.reportedHorizontalSpeedKmh
        ?? (getTargetSpeedKmh(source) || getTargetSpeedKmh(target))),
    heading: getTargetHeadingDeg(source) ?? getTargetHeadingDeg(target),
    verticalSpeedMps: getTargetVerticalSpeedMps(source) || getTargetVerticalSpeedMps(target),
    // Ballistic entities update targetAltitudeM to their current altitude for
    // rendering. Treating that value as an altitude hold made the feasibility
    // projection freeze a descending target tens of kilometres above ground.
    targetAltitudeM: isPhysicsBallisticTarget
      ? null
      : (target?.targetAltitudeM ?? source?.targetAltitudeM ?? null),
    // A fire-control solution may extrapolate only the measured course and
    // speed. Scenario waypoints remain available for strategic ETA, but are
    // not exposed to interceptor prediction as perfect future knowledge.
    route: includeKnownRoute ? (target?.route ?? []) : [],
    waypointIndex: target?.waypointIndex ?? 0,
  };
};

const advanceAltitude = (state, durationSec) => {
  const verticalTravelM = state.verticalSpeedMps * durationSec;
  if (!Number.isFinite(state.targetAltitudeM)) {
    return Math.max(0, state.position.altitudeM + verticalTravelM);
  }
  const altitudeDeltaM = state.targetAltitudeM - state.position.altitudeM;
  return Math.max(0, state.position.altitudeM + Math.sign(altitudeDeltaM) * Math.min(
    Math.abs(altitudeDeltaM),
    Math.abs(verticalTravelM),
  ));
};

export function projectTargetState(targetState, durationSec) {
  const duration = Math.max(0, durationSec);
  const travelBudgetKm = targetState.speedKmh * duration / 3600;
  const remainingWaypoints = targetState.route.slice(targetState.waypointIndex);
  if (remainingWaypoints.length === 0) {
    const position = getDestinationPoint(
      targetState.position.lat,
      targetState.position.lng,
      targetState.heading,
      travelBudgetKm,
    );
    return {
      position: { ...position, altitudeM: advanceAltitude(targetState, duration) },
      heading: targetState.heading,
      reachesDestination: false,
    };
  }

  let position = { ...targetState.position };
  let altitudeM = targetState.position.altitudeM;
  let remainingDistanceKm = travelBudgetKm;
  let heading = targetState.heading;
  for (const waypoint of remainingWaypoints) {
    const segmentDistanceKm = getDistanceKm(
      position.lat,
      position.lng,
      waypoint.lat,
      waypoint.lng,
    );
    heading = segmentDistanceKm > Number.EPSILON
      ? getBearing(position.lat, position.lng, waypoint.lat, waypoint.lng)
      : heading;
    const waypointAltitudeM = getWaypointAltitudeM(waypoint, altitudeM);
    if (remainingDistanceKm < segmentDistanceKm) {
      const fraction = segmentDistanceKm > 0 ? remainingDistanceKm / segmentDistanceKm : 1;
      const projected = getDestinationPoint(
        position.lat,
        position.lng,
        heading,
        remainingDistanceKm,
      );
      altitudeM += (waypointAltitudeM - altitudeM) * fraction;
      return {
        position: { ...projected, altitudeM },
        heading,
        reachesDestination: false,
      };
    }
    remainingDistanceKm -= segmentDistanceKm;
    position = { lat: waypoint.lat, lng: waypoint.lng, altitudeM: waypointAltitudeM };
    altitudeM = waypointAltitudeM;
  }

  return {
    position,
    heading,
    reachesDestination: true,
  };
}

export function estimateTargetTimeAvailableSec(target, track = null) {
  const ballisticTimeToGroundSec = target?.ballisticPhysics?.timeToGroundSec;
  if (target?.ballisticPhysics?.enabled
    && Number.isFinite(ballisticTimeToGroundSec)
    && ballisticTimeToGroundSec > 0) {
    return ballisticTimeToGroundSec;
  }
  const state = resolveTargetState(target, track, { includeKnownRoute: true });
  if (!state || state.speedKmh <= 0 || state.route.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  let previous = state.position;
  let remainingDistanceKm = 0;
  state.route.slice(state.waypointIndex).forEach(waypoint => {
    remainingDistanceKm += getDistanceKm(
      previous.lat,
      previous.lng,
      waypoint.lat,
      waypoint.lng,
    );
    previous = waypoint;
  });
  return remainingDistanceKm / state.speedKmh * 3600;
}

/** Estimates travel from the interceptor's current energy state without FPS integration. */
export function estimateInterceptorKinematics({
  physics,
  durationSec,
  initialSpeedKmh = physics.launchSpeedKmh,
  elapsedFlightTimeSec = 0,
  distanceTraveledKm = 0,
  altitudeM = 0,
  targetAltitudeM = altitudeM,
  totalTurnDeg = 0,
}) {
  const maximumDurationSec = Math.max(0, Math.min(
    durationSec,
    physics.maxFlightTimeSec - elapsedFlightTimeSec,
  ));
  let interceptor = {
    speedKmh: initialSpeedKmh,
    flightTime: elapsedFlightTimeSec,
    distanceTraveledKm,
    altitudeM,
    criticalEnergyTimeSec: 0,
  };
  let simulatedDurationSec = 0;
  let poweredTimeSec = 0;
  let coastTimeSec = 0;
  let terminated = false;
  const integrationStepSec = 0.5;
  while (simulatedDurationSec < maximumDurationSec && !terminated) {
    const stepSec = Math.min(integrationStepSec, maximumDurationSec - simulatedDurationSec);
    const progress = maximumDurationSec > 0 ? simulatedDurationSec / maximumDurationSec : 1;
    const currentAltitudeM = altitudeM + (targetAltitudeM - altitudeM) * progress;
    const headingChangeDeg = maximumDurationSec > 0
      ? totalTurnDeg * stepSec / maximumDurationSec
      : 0;
    const rawAdvanced = advanceInterceptorFlight(interceptor, stepSec, physics, {
      altitudeM: currentAltitudeM,
      headingChangeDeg,
    });
    const nextProgress = maximumDurationSec > 0
      ? Math.min(1, (simulatedDurationSec + stepSec) / maximumDurationSec)
      : 1;
    const nextAltitudeM = altitudeM + (targetAltitudeM - altitudeM) * nextProgress;
    const advanced = applyAltitudeEnergyExchange(
      rawAdvanced,
      nextAltitudeM - currentAltitudeM,
      stepSec,
      physics,
    );
    if (advanced.phase === 'POWERED') poweredTimeSec += stepSec;
    else coastTimeSec += stepSec;
    interceptor = { ...interceptor, ...advanced, altitudeM: nextAltitudeM };
    simulatedDurationSec += stepSec;
    terminated = advanced.terminated;
  }
  const travelDistanceKm = interceptor.distanceTraveledKm - distanceTraveledKm;
  const nominalRemainingRangeKm = Math.max(
    0,
    physics.maxGameRangeKm - interceptor.distanceTraveledKm,
  );

  return {
    travelDistanceKm,
    speedKmh: interceptor.speedKmh,
    flightTimeSec: interceptor.flightTime,
    poweredTimeSec,
    coastTimeSec,
    remainingRangeKm: nominalRemainingRangeKm,
    energyState: interceptor.energyState,
    energyRatio: interceptor.energyRatio,
    terminated,
  };
}

const solveFlightTime = ({
  origin,
  originAltitudeM,
  targetState,
  targetProjectionOffsetSec,
  initialCourseHeading,
  physics,
  initialSpeedKmh,
  elapsedFlightTimeSec,
  distanceTraveledKm,
  staticTargetPosition = null,
  config,
}) => {
  const maximumFlightDurationSec = Math.max(0, physics.maxFlightTimeSec - elapsedFlightTimeSec);
  const minimumControlledFlightTimeSec = Math.max(
    physics.minimumControlledFlightTimeSec ?? 0,
    physics.guidanceReactionTimeSec ?? 0,
  );

  const sampleAt = (flightTimeSec) => {
    const targetProjection = staticTargetPosition
      ? { position: staticTargetPosition, heading: targetState.heading, reachesDestination: false }
      : projectTargetState(targetState, targetProjectionOffsetSec + flightTimeSec);
    const interceptBearing = getBearing(
      origin.lat,
      origin.lng,
      targetProjection.position.lat,
      targetProjection.position.lng,
    );
    const requiredCourseChangeDeg = Math.abs(normalizeHeadingDelta(
      interceptBearing - initialCourseHeading,
    ));
    const directDistanceKm = getSlantDistanceKm(
      origin,
      originAltitudeM,
      targetProjection.position,
      targetProjection.position.altitudeM,
    );
    const coursePenalty = config.courseChangePathPenaltyAt180Deg
      * (requiredCourseChangeDeg / 180) ** 2;
    const requiredPathDistanceKm = directDistanceKm * (1 + coursePenalty);
    const kinematics = estimateInterceptorKinematics({
      physics,
      durationSec: flightTimeSec,
      initialSpeedKmh,
      elapsedFlightTimeSec,
      distanceTraveledKm,
      altitudeM: originAltitudeM,
      targetAltitudeM: targetProjection.position.altitudeM,
      totalTurnDeg: requiredCourseChangeDeg,
    });
    const turnPerformance = getEffectiveTurnPerformance({
      speedKmh: kinematics.speedKmh,
      energyRatio: kinematics.energyRatio,
    }, physics, directDistanceKm <= physics.terminalRangeKm);
    const minimumTurnTimeSec = requiredCourseChangeDeg
      / Math.max(turnPerformance.effectiveTurnRateDegPerSec, Number.EPSILON);
    return {
      flightTimeSec,
      targetProjection,
      interceptBearing,
      requiredCourseChangeDeg,
      directDistanceKm,
      requiredPathDistanceKm,
      minimumTurnTimeSec,
      kinematics,
      hasReached: flightTimeSec >= minimumControlledFlightTimeSec
        && flightTimeSec >= minimumTurnTimeSec
        && kinematics.travelDistanceKm >= requiredPathDistanceKm,
    };
  };

  let previousTimeSec = 0;
  let sampleTimeSec = Math.min(
    maximumFlightDurationSec,
    Math.max(config.solverStepSec, minimumControlledFlightTimeSec),
  );
  while (sampleTimeSec > previousTimeSec) {
    const boundedSampleTimeSec = sampleTimeSec;
    const sample = sampleAt(boundedSampleTimeSec);
    if (sample.hasReached) {
      let lowerBoundSec = previousTimeSec;
      let upperBoundSec = boundedSampleTimeSec;
      for (let iteration = 0; iteration < config.solverRefinementIterations; iteration += 1) {
        const midpointSec = (lowerBoundSec + upperBoundSec) / 2;
        if (sampleAt(midpointSec).hasReached) upperBoundSec = midpointSec;
        else lowerBoundSec = midpointSec;
      }
      return sampleAt(upperBoundSec);
    }
    if (sample.kinematics.terminated) break;
    previousTimeSec = boundedSampleTimeSec;
    sampleTimeSec = Math.min(
      maximumFlightDurationSec,
      Math.max(
        boundedSampleTimeSec + config.solverStepSec,
        boundedSampleTimeSec * config.solverBracketGrowth,
      ),
    );
  }
  return null;
};

const invalidSolution = targetEtaSec => ({
  status: INTERCEPT_FEASIBILITY.NO_SOLUTION,
  feasibility: INTERCEPT_FEASIBILITY.NO_SOLUTION,
  reason: INTERCEPT_SOLUTION_REASON.INVALID_INPUT,
  targetEtaSec,
  minimumTimeToInterceptSec: null,
  predictedInterceptTimeSec: null,
  predictedPosition: null,
  predictedInterceptPoint: null,
});

/**
 * Calculates a deterministic, data-driven intercept solution. `track` can be
 * supplied to use reported sensor data while `target` continues to provide the
 * known route/destination. The result never applies system-specific bans.
 */
function evaluateInterceptFeasibilityImplementation({
  launcher,
  target,
  track = null,
  interceptorSpec,
  currentInterceptor = null,
  targetTimeAvailableSec = null,
  launchDelaySec = null,
  config: configOverrides = {},
}) {
  const physics = interceptorSpec?.gameplayPhysics ?? interceptorSpec;
  const originEntity = currentInterceptor ?? launcher;
  const origin = asPosition(originEntity);
  const targetState = resolveTargetState(target, track);
  const targetEtaSec = targetTimeAvailableSec
    ?? estimateTargetTimeAvailableSec(target, track);
  if (!origin || !targetState || !physics || targetState.speedKmh < 0) {
    return invalidSolution(targetEtaSec);
  }

  const config = { ...INTERCEPT_FEASIBILITY_CONFIG, ...configOverrides };
  const originAltitudeM = origin.altitudeM;
  const currentHeading = currentInterceptor?.heading
    ?? launcher?.heading
    ?? getBearing(origin.lat, origin.lng, targetState.position.lat, targetState.position.lng);
  const baseLaunchDelaySec = currentInterceptor
    ? 0
    : (launchDelaySec ?? physics.launchPreparationSec ?? 0);
  let rotationDelaySec = 0;
  let launchCourseHeading = currentHeading;
  if (
    !currentInterceptor
    && physics.launchMode !== 'VERTICAL'
    && Number.isFinite(launcher?.heading)
  ) {
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const targetAtLaunch = projectTargetState(
        targetState,
        baseLaunchDelaySec + rotationDelaySec,
      );
      launchCourseHeading = getBearing(
        origin.lat,
        origin.lng,
        targetAtLaunch.position.lat,
        targetAtLaunch.position.lng,
      );
      const rotationAngleDeg = Math.abs(normalizeHeadingDelta(launchCourseHeading - launcher.heading));
      rotationDelaySec = rotationAngleDeg
        / Math.max(physics.launcherRotationRateDegPerSec ?? 360, Number.EPSILON);
    }
  } else if (!currentInterceptor && physics.launchMode === 'VERTICAL') {
    // A vertical launcher has no meaningful horizontal launch azimuth. In the
    // 2D command model the missile appears after clearing the canister, so its
    // first horizontal course is the bearing to the projected target instead
    // of the (purely visual) launcher heading.
    const targetAtVerticalExit = projectTargetState(targetState, baseLaunchDelaySec);
    launchCourseHeading = getBearing(
      origin.lat,
      origin.lng,
      targetAtVerticalExit.position.lat,
      targetAtVerticalExit.position.lng,
    );
  }
  const totalLaunchDelaySec = baseLaunchDelaySec + rotationDelaySec;
  const initialSpeedKmh = currentInterceptor?.speedKmh ?? physics.launchSpeedKmh;
  const elapsedFlightTimeSec = currentInterceptor?.flightTime ?? 0;
  const distanceTraveledKm = currentInterceptor?.distanceTraveledKm ?? 0;
  const targetAtLaunch = projectTargetState(targetState, totalLaunchDelaySec);

  const predictedSolution = solveFlightTime({
    origin,
    originAltitudeM,
    targetState,
    targetProjectionOffsetSec: totalLaunchDelaySec,
    initialCourseHeading: launchCourseHeading,
    physics,
    initialSpeedKmh,
    elapsedFlightTimeSec,
    distanceTraveledKm,
    config,
  });

  if (!predictedSolution) {
    const directDistanceKm = getSlantDistanceKm(
      origin,
      originAltitudeM,
      targetAtLaunch.position,
      targetAtLaunch.position.altitudeM,
    );
    const theoreticalMinimumTimeSec = totalLaunchDelaySec
      + directDistanceKm / Math.max(physics.maxSpeedKmh, 1) * 3600;
    const isProvablyTooLate = Number.isFinite(targetEtaSec)
      && targetEtaSec < theoreticalMinimumTimeSec;
    return {
      ...invalidSolution(targetEtaSec),
      reason: isProvablyTooLate
        ? INTERCEPT_SOLUTION_REASON.TOO_LATE
        : INTERCEPT_SOLUTION_REASON.KINEMATICALLY_UNREACHABLE,
      minimumTimeToInterceptSec: theoreticalMinimumTimeSec,
      staticTargetTimeToInterceptSec: null,
      launchDelaySec: baseLaunchDelaySec,
      rotationDelaySec,
      totalLaunchDelaySec,
      requiredCourseChangeDeg: null,
      interceptDistanceKm: null,
      interceptorPathDistanceKm: null,
      timeMarginSec: Number.isFinite(targetEtaSec) ? targetEtaSec : null,
      rangeMarginKm: 0,
    };
  }

  const predictedInterceptTimeSec = totalLaunchDelaySec + predictedSolution.flightTimeSec;
  const staticTargetTimeToInterceptSec = predictedInterceptTimeSec;
  const minimumTimeToInterceptSec = predictedInterceptTimeSec;
  const timeMarginSec = Number.isFinite(targetEtaSec)
    ? targetEtaSec - predictedInterceptTimeSec
    : Number.POSITIVE_INFINITY;
  const rangeMarginKm = Math.max(0, predictedSolution.kinematics.remainingRangeKm);
  const rangeReserveRatio = rangeMarginKm / Math.max(physics.maxGameRangeKm, 1);
  const energyReserveRatio = predictedSolution.kinematics.speedKmh
    / Math.max(physics.minimumEffectiveSpeedKmh, 1);
  const tooLate = timeMarginSec < 0 || predictedSolution.targetProjection.reachesDestination;
  const marginalTimeThresholdSec = Math.max(
    config.marginalMinimumTimeMarginSec,
    predictedInterceptTimeSec * config.marginalTimeMarginRatio,
  );
  const marginal = !tooLate && (
    timeMarginSec <= marginalTimeThresholdSec
    || rangeReserveRatio <= config.marginalRangeReserveRatio
    || energyReserveRatio <= config.marginalEnergyReserveRatio
  );
  const status = tooLate
    ? INTERCEPT_FEASIBILITY.NO_SOLUTION
    : (marginal ? INTERCEPT_FEASIBILITY.MARGINAL : INTERCEPT_FEASIBILITY.VALID);
  const reason = tooLate
    ? INTERCEPT_SOLUTION_REASON.TOO_LATE
    : (marginal
      ? INTERCEPT_SOLUTION_REASON.NARROW_MARGIN
      : INTERCEPT_SOLUTION_REASON.SOLUTION_AVAILABLE);

  return {
    status,
    feasibility: status,
    reason,
    targetEtaSec,
    minimumTimeToInterceptSec,
    staticTargetTimeToInterceptSec,
    minimumFlightTimeSec: predictedSolution.flightTimeSec,
    predictedInterceptTimeSec,
    interceptorFlightTimeSec: predictedSolution.flightTimeSec,
    predictedInterceptPoint: {
      lat: predictedSolution.targetProjection.position.lat,
      lng: predictedSolution.targetProjection.position.lng,
      altitudeM: predictedSolution.targetProjection.position.altitudeM,
    },
    predictedPosition: {
      lat: predictedSolution.targetProjection.position.lat,
      lng: predictedSolution.targetProjection.position.lng,
      altitudeM: predictedSolution.targetProjection.position.altitudeM,
    },
    launchCourseHeadingDeg: launchCourseHeading,
    interceptBearingDeg: predictedSolution.interceptBearing,
    requiredCourseChangeDeg: predictedSolution.requiredCourseChangeDeg,
    interceptDistanceKm: predictedSolution.directDistanceKm,
    interceptorPathDistanceKm: predictedSolution.requiredPathDistanceKm,
    interceptorTravelDistanceKm: predictedSolution.kinematics.travelDistanceKm,
    interceptorSpeedAtInterceptKmh: predictedSolution.kinematics.speedKmh,
    launchDelaySec: baseLaunchDelaySec,
    rotationDelaySec,
    totalLaunchDelaySec,
    timeMarginSec,
    rangeMarginKm,
    rangeReserveRatio,
    energyReserveRatio,
  };
}

export function evaluateInterceptFeasibility(options) {
  return measureSimulationSubsystem(
    SIMULATION_SUBSYSTEM.INTERCEPT_SOLVER,
    () => evaluateInterceptFeasibilityImplementation(options),
  );
}

export const calculateInterceptSolution = evaluateInterceptFeasibility;

/** Convenience adapter for battery-level MANUAL, ASSIST and AUTO decisions. */
export function evaluateBatteryInterceptFeasibility({
  battery,
  track,
  target,
  interceptorSpec = null,
  launchDelaySec = null,
  targetTimeAvailableSec = null,
}) {
  const targetPosition = asPosition(track ?? target);
  const launchers = battery?.components?.launchers
    ?.filter(launcher => launcher.operational !== false)
    .map(launcher => ({
      launcher,
      readyRank: launcher.ready === false ? 1 : 0,
      distanceKm: targetPosition
        ? getDistanceKm(launcher.lat, launcher.lng, targetPosition.lat, targetPosition.lng)
        : Number.POSITIVE_INFINITY,
    }))
    .sort((first, second) => (
      first.readyRank - second.readyRank
      || first.distanceKm - second.distanceKm
      || first.launcher.id.localeCompare(second.launcher.id)
    ))
    ?? [];
  const launcher = launchers[0]?.launcher;
  const resolvedSpec = interceptorSpec
    ?? (battery?.interceptorSpecId ? getInterceptorSpec(battery.interceptorSpecId) : null);
  if (!launcher) {
    return {
      ...invalidSolution(targetTimeAvailableSec ?? estimateTargetTimeAvailableSec(target, track)),
      reason: INTERCEPT_SOLUTION_REASON.NO_OPERATIONAL_LAUNCHER,
      batteryId: battery?.id ?? null,
      launcherId: null,
    };
  }
  const solution = evaluateInterceptFeasibility({
    launcher,
    target,
    track,
    interceptorSpec: resolvedSpec,
    launchDelaySec,
    targetTimeAvailableSec,
  });
  return {
    ...solution,
    batteryId: battery.id,
    launcherId: launcher.id,
  };
}
