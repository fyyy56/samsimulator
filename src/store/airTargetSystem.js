import { getAltitudeBand } from '../data/airTargetProfiles.js';
import { getBearing, getDestinationPoint, getDistanceKm } from './geo.js';
import { getSimpleBallisticState } from './simpleBallisticProfile.js';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const turnTowards = (currentHeading, desiredHeading, maximumTurnDeg) => {
  const differenceDeg = (((desiredHeading - currentHeading) + 540) % 360) - 180;
  return (currentHeading + clamp(differenceDeg, -maximumTurnDeg, maximumTurnDeg) + 360) % 360;
};

const getRouteDistanceKm = (startPosition, route) => {
  let distanceKm = 0;
  let previous = startPosition;
  route.forEach(waypoint => {
    distanceKm += getDistanceKm(previous.lat, previous.lng, waypoint.lat, waypoint.lng);
    previous = waypoint;
  });
  return Math.max(1, distanceKm);
};

export function createAirTarget(definition, spawnedAt) {
  const firstWaypoint = definition.route[0];
  const initialHeading = getBearing(
    definition.spawnPosition.lat,
    definition.spawnPosition.lng,
    firstWaypoint.lat,
    firstWaypoint.lng,
  );
  const altitudeM = definition.altitudeM ?? 0;
  return {
    id: definition.id,
    type: definition.type,
    modelId: definition.modelId ?? null,
    customAssetUrl: definition.customAssetUrl ?? null,
    customAssetScale: definition.customAssetScale ?? 1,
    customAssetOffsetX: definition.customAssetOffsetX ?? 0,
    customAssetOffsetY: definition.customAssetOffsetY ?? 0,
    state: 'ALIVE',
    speedKmh: definition.speedKmh,
    altitudeM,
    targetAltitudeM: definition.targetAltitudeM ?? altitudeM,
    verticalSpeedMps: definition.verticalSpeedMps ?? 0,
    altitudeBand: definition.altitudeBand ?? getAltitudeBand(altitudeM),
    altitudeProfile: definition.altitudeProfile ? { ...definition.altitudeProfile } : null,
    turnRateDegPerSec: definition.turnRateDegPerSec ?? 3,
    sensorSignature: definition.sensorSignature ?? definition.detectability ?? 0.5,
    detectability: definition.detectability ?? definition.sensorSignature ?? 0.5,
    position: {
      ...definition.spawnPosition,
      lon: definition.spawnPosition.lng,
    },
    heading: initialHeading,
    desiredHeading: initialHeading,
    route: definition.route.map(waypoint => ({ ...waypoint })),
    routeType: definition.routeType ?? 'DIRECT',
    baseRouteType: definition.baseRouteType ?? definition.routeType ?? 'DIRECT',
    routePlanId: definition.routePlanId ?? null,
    routeCorridor: definition.routeCorridor ? { ...definition.routeCorridor } : null,
    destination: definition.destination ? { ...definition.destination } : { ...definition.route.at(-1) },
    waypointIndex: 0,
    routeProgress: 0,
    spawnedAt,
    totalRouteDistanceKm: getRouteDistanceKm(definition.spawnPosition, definition.route),
    distanceTraveledKm: 0,
    flightPhase: definition.type === 'BALLISTIC_TARGET' ? 'LAUNCH' : 'CRUISE',
    objectiveId: definition.objectiveId ?? null,
    objectiveName: definition.objectiveName ?? null,
    objectiveCategory: definition.objectiveCategory ?? null,
    objectivePriority: definition.objectivePriority ?? 0.62,
    groupId: definition.groupId ?? null,
    groupSize: definition.groupSize ?? 1,
    launchPattern: definition.launchPattern ?? 'SINGLE',
    trajectory: [{
      lat: definition.spawnPosition.lat,
      lng: definition.spawnPosition.lng,
      altitudeM,
    }],
    velocity: {
      speedKmh: definition.speedKmh,
      heading: initialHeading,
      verticalSpeedMps: definition.verticalSpeedMps ?? 0,
    },
  };
}

const advanceTargetAltitude = (target, routeProgress, ballisticState, deltaTimeSec) => {
  if (ballisticState) {
    const altitudeM = ballisticState.altitudeM;
    return {
      altitudeM,
      targetAltitudeM: altitudeM,
      verticalSpeedMps: deltaTimeSec > 0 ? (altitudeM - target.altitudeM) / deltaTimeSec : 0,
      altitudeBand: getAltitudeBand(altitudeM),
    };
  }

  const profile = target.altitudeProfile;
  if (!profile) {
    return {
      altitudeM: target.altitudeM,
      targetAltitudeM: target.targetAltitudeM ?? target.altitudeM,
      verticalSpeedMps: 0,
      altitudeBand: getAltitudeBand(target.altitudeM),
    };
  }

  let targetAltitudeM = profile.cruiseAltitudeM;
  if (routeProgress < profile.cruiseTransitionEndProgress) {
    const climbProgress = clamp(
      routeProgress / Math.max(0.01, profile.cruiseTransitionEndProgress),
      0,
      1,
    );
    targetAltitudeM = profile.startAltitudeM
      + (profile.cruiseAltitudeM - profile.startAltitudeM) * climbProgress;
  } else if (routeProgress >= profile.terminalTransitionStartProgress) {
    const terminalProgress = clamp(
      (routeProgress - profile.terminalTransitionStartProgress)
        / Math.max(0.01, 1 - profile.terminalTransitionStartProgress),
      0,
      1,
    );
    targetAltitudeM = profile.cruiseAltitudeM
      + (profile.terminalAltitudeM - profile.cruiseAltitudeM) * terminalProgress;
  }
  const altitudeDifferenceM = targetAltitudeM - target.altitudeM;
  const maximumChangeM = profile.maximumVerticalSpeedMps * deltaTimeSec;
  const altitudeChangeM = clamp(altitudeDifferenceM, -maximumChangeM, maximumChangeM);
  const altitudeM = Math.max(0, target.altitudeM + altitudeChangeM);
  return {
    altitudeM,
    targetAltitudeM,
    verticalSpeedMps: deltaTimeSec > 0 ? altitudeChangeM / deltaTimeSec : 0,
    altitudeBand: getAltitudeBand(altitudeM),
  };
};

export function advanceAirTarget(target, deltaTimeSec) {
  const waypoint = target.route[target.waypointIndex];
  if (!waypoint) return { ...target, state: 'COMPLETED' };

  const remainingDistanceKm = getDistanceKm(
    target.position.lat,
    target.position.lng,
    waypoint.lat,
    waypoint.lng,
  );
  const currentRouteProgress = target.distanceTraveledKm / target.totalRouteDistanceKm;
  const currentBallisticState = target.type === 'BALLISTIC_TARGET'
    ? getSimpleBallisticState(currentRouteProgress)
    : null;
  const travelDistanceKm = (target.speedKmh / 3600) * deltaTimeSec
    * (currentBallisticState?.horizontalSpeedFactor ?? 1);
  const desiredHeading = getBearing(
    target.position.lat,
    target.position.lng,
    waypoint.lat,
    waypoint.lng,
  );
  const heading = target.type === 'BALLISTIC_TARGET'
    ? target.heading
    : turnTowards(
      target.heading ?? desiredHeading,
      desiredHeading,
      (target.turnRateDegPerSec ?? 3) * deltaTimeSec,
    );
  const reachesWaypoint = remainingDistanceKm <= Math.max(0.15, travelDistanceKm * 1.15);
  const traveledDistanceKm = reachesWaypoint ? remainingDistanceKm : travelDistanceKm;
  const nextDistanceTraveledKm = Math.min(
    target.totalRouteDistanceKm,
    target.distanceTraveledKm + traveledDistanceKm,
  );
  const routeProgress = nextDistanceTraveledKm / target.totalRouteDistanceKm;
  const ballisticState = target.type === 'BALLISTIC_TARGET'
    ? getSimpleBallisticState(routeProgress)
    : null;
  const altitudeState = advanceTargetAltitude(target, routeProgress, ballisticState, deltaTimeSec);

  if (reachesWaypoint) {
    const reachedFinalWaypoint = target.waypointIndex >= target.route.length - 1;
    return {
      ...target,
      state: reachedFinalWaypoint ? 'COMPLETED' : target.state,
      position: { ...waypoint, lon: waypoint.lng },
      ...altitudeState,
      heading,
      desiredHeading,
      velocity: { speedKmh: target.speedKmh, heading, verticalSpeedMps: altitudeState.verticalSpeedMps },
      waypointIndex: target.waypointIndex + 1,
      routeProgress: reachedFinalWaypoint ? 1 : routeProgress,
      distanceTraveledKm: reachedFinalWaypoint
        ? target.totalRouteDistanceKm
        : nextDistanceTraveledKm,
      flightPhase: ballisticState?.phase ?? target.flightPhase,
    };
  }

  const destinationPoint = target.type === 'BALLISTIC_TARGET'
    ? {
      lat: target.position.lat + (waypoint.lat - target.position.lat) * (travelDistanceKm / remainingDistanceKm),
      lng: target.position.lng + (waypoint.lng - target.position.lng) * (travelDistanceKm / remainingDistanceKm),
    }
    : getDestinationPoint(
      target.position.lat,
      target.position.lng,
      heading,
      travelDistanceKm,
    );
  const nextPosition = { ...destinationPoint, lon: destinationPoint.lng };
  const previousTrajectoryPoint = target.trajectory?.at(-1);
  const shouldAddTrajectoryPoint = !previousTrajectoryPoint || getDistanceKm(
    previousTrajectoryPoint.lat,
    previousTrajectoryPoint.lng,
    nextPosition.lat,
    nextPosition.lng,
  ) >= 3;
  return {
    ...target,
    heading,
    desiredHeading,
    ...altitudeState,
    position: nextPosition,
    trajectory: shouldAddTrajectoryPoint
      ? [...(target.trajectory ?? []), { ...nextPosition, altitudeM: altitudeState.altitudeM }].slice(-28)
      : target.trajectory,
    velocity: { speedKmh: target.speedKmh, heading, verticalSpeedMps: altitudeState.verticalSpeedMps },
    routeProgress,
    distanceTraveledKm: nextDistanceTraveledKm,
    flightPhase: ballisticState?.phase ?? target.flightPhase,
  };
}
