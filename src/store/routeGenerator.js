import { ROUTE_GENERATION_CONFIG, ROUTE_PATTERN } from '../data/airTargetProfiles.js';
import { getBearing, getDestinationPoint, getDistanceKm } from './geo.js';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const between = (random, minimum, maximum) => minimum + (maximum - minimum) * random();

const angleDifferenceDeg = (first, second) => (
  Math.abs((((second - first) + 540) % 360) - 180)
);

const getIntermediateCount = (distanceKm, patternConfig, random) => {
  const [minimumCount, maximumCount] = patternConfig.intermediateWaypointCount;
  const spacingLimitedCount = Math.max(
    0,
    Math.floor(distanceKm / patternConfig.minimumWaypointSpacingKm) - 1,
  );
  const configuredMaximum = Math.min(
    maximumCount,
    ROUTE_GENERATION_CONFIG.maximumWaypointCount - 1,
    spacingLimitedCount,
  );
  if (configuredMaximum <= minimumCount) return configuredMaximum;
  return minimumCount + Math.floor(random() * (configuredMaximum - minimumCount + 1));
};

const createProgresses = (count, random) => {
  if (count === 0) return [];
  const interval = 1 / (count + 1);
  return Array.from({ length: count }, (_, index) => {
    const center = interval * (index + 1);
    const jitter = between(random, -interval * 0.12, interval * 0.12);
    return clamp(center + jitter, interval * (index + 0.72), interval * (index + 1.28));
  });
};

const createLateralOffsets = (routeType, progresses, maximumDeviationKm, random) => {
  const side = random() < 0.5 ? -1 : 1;
  return progresses.map((progress, index) => {
    const routeEnvelope = Math.sin(Math.PI * progress);
    if (routeType === ROUTE_PATTERN.DIRECT) {
      return side * maximumDeviationKm * between(random, 0.08, 0.3) * routeEnvelope;
    }
    if (routeType === ROUTE_PATTERN.OFFSET) {
      return side * maximumDeviationKm * between(random, 0.68, 0.94) * routeEnvelope;
    }
    if (routeType === ROUTE_PATTERN.WEAVING) {
      const alternatingSide = index % 2 === 0 ? side : -side;
      return alternatingSide * maximumDeviationKm * between(random, 0.48, 0.78) * routeEnvelope;
    }
    return side * maximumDeviationKm * between(random, 0.18, 0.48) * routeEnvelope;
  });
};

const projectCorridorPoint = (startPosition, routeBearing, routeDistanceKm, progress, lateralKm) => {
  const centerlinePoint = getDestinationPoint(
    startPosition.lat,
    startPosition.lng,
    routeBearing,
    routeDistanceKm * progress,
  );
  if (Math.abs(lateralKm) < 0.001) return centerlinePoint;
  return getDestinationPoint(
    centerlinePoint.lat,
    centerlinePoint.lng,
    routeBearing + (lateralKm >= 0 ? 90 : -90),
    Math.abs(lateralKm),
  );
};

const createRoutePoints = ({
  startPosition,
  destination,
  routeBearing,
  routeDistanceKm,
  progresses,
  lateralOffsetsKm,
}) => [
  ...progresses.map((progress, index) => ({
    ...projectCorridorPoint(
      startPosition,
      routeBearing,
      routeDistanceKm,
      progress,
      lateralOffsetsKm[index],
    ),
    routeProgress: progress,
  })),
  { ...destination, routeProgress: 1 },
];

const getMaximumRouteTurnDeg = (startPosition, route) => {
  let previousPosition = startPosition;
  let incomingBearing = null;
  let maximumTurnDeg = 0;
  route.forEach(waypoint => {
    const outgoingBearing = getBearing(
      previousPosition.lat,
      previousPosition.lng,
      waypoint.lat,
      waypoint.lng,
    );
    if (incomingBearing !== null) {
      maximumTurnDeg = Math.max(maximumTurnDeg, angleDifferenceDeg(incomingBearing, outgoingBearing));
    }
    incomingBearing = outgoingBearing;
    previousPosition = waypoint;
  });
  return maximumTurnDeg;
};

export function createLogicalRoute({
  startPosition,
  destination,
  routeType,
  random,
}) {
  const normalizedRouteType = routeType === ROUTE_PATTERN.GROUP
    ? ROUTE_PATTERN.DIRECT
    : routeType;
  const patternConfig = ROUTE_GENERATION_CONFIG.patterns[normalizedRouteType]
    ?? ROUTE_GENERATION_CONFIG.patterns[ROUTE_PATTERN.DIRECT];
  const routeDistanceKm = getDistanceKm(
    startPosition.lat,
    startPosition.lng,
    destination.lat,
    destination.lng,
  );
  const routeBearing = getBearing(
    startPosition.lat,
    startPosition.lng,
    destination.lat,
    destination.lng,
  );
  const intermediateCount = getIntermediateCount(routeDistanceKm, patternConfig, random);
  const progresses = createProgresses(intermediateCount, random);
  let lateralOffsetsKm = createLateralOffsets(
    normalizedRouteType,
    progresses,
    patternConfig.maximumLateralDeviationKm,
    random,
  );
  let route = createRoutePoints({
    startPosition,
    destination,
    routeBearing,
    routeDistanceKm,
    progresses,
    lateralOffsetsKm,
  });

  // Scaling the corridor offsets preserves forward progress while keeping every
  // generated turn inside the gameplay profile's maneuvering envelope.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (getMaximumRouteTurnDeg(startPosition, route) <= patternConfig.maximumTurnAngleDeg) break;
    lateralOffsetsKm = lateralOffsetsKm.map(offsetKm => offsetKm * 0.78);
    route = createRoutePoints({
      startPosition,
      destination,
      routeBearing,
      routeDistanceKm,
      progresses,
      lateralOffsetsKm,
    });
  }

  return {
    route,
    corridor: {
      maximumLateralDeviationKm: patternConfig.maximumLateralDeviationKm,
      maximumTurnAngleDeg: patternConfig.maximumTurnAngleDeg,
      minimumWaypointSpacingKm: patternConfig.minimumWaypointSpacingKm,
      maximumWaypointCount: ROUTE_GENERATION_CONFIG.maximumWaypointCount,
    },
  };
}

export function getGroupMemberOffsetKm(memberIndex, groupSize) {
  const centeredIndex = memberIndex - (groupSize - 1) / 2;
  return clamp(
    centeredIndex * ROUTE_GENERATION_CONFIG.groupFormationSpacingKm,
    -ROUTE_GENERATION_CONFIG.groupMaximumOffsetKm,
    ROUTE_GENERATION_CONFIG.groupMaximumOffsetKm,
  );
}

export function offsetPositionForFormation(position, routeBearing, lateralOffsetKm) {
  if (Math.abs(lateralOffsetKm) < 0.001) return { ...position };
  return getDestinationPoint(
    position.lat,
    position.lng,
    routeBearing + (lateralOffsetKm >= 0 ? 90 : -90),
    Math.abs(lateralOffsetKm),
  );
}

export function createGroupMemberRoute({
  baseStartPosition,
  destination,
  sharedRoute,
  memberIndex,
  groupSize,
}) {
  const routeBearing = getBearing(
    baseStartPosition.lat,
    baseStartPosition.lng,
    destination.lat,
    destination.lng,
  );
  const lateralOffsetKm = getGroupMemberOffsetKm(memberIndex, groupSize);
  const spawnPosition = offsetPositionForFormation(
    baseStartPosition,
    routeBearing,
    lateralOffsetKm,
  );
  const route = sharedRoute.map((waypoint, waypointIndex) => {
    if (waypointIndex === sharedRoute.length - 1) return { ...destination, routeProgress: 1 };
    const remainingFormationFactor = Math.max(0.18, 1 - (waypoint.routeProgress ?? 0));
    return {
      ...offsetPositionForFormation(
        waypoint,
        routeBearing,
        lateralOffsetKm * remainingFormationFactor,
      ),
      routeProgress: waypoint.routeProgress,
    };
  });
  return { spawnPosition, route, formationOffsetKm: lateralOffsetKm };
}

export function getRouteDiagnostics(startPosition, route) {
  const waypointSpacingKm = [];
  let previousPosition = startPosition;
  route.forEach(waypoint => {
    waypointSpacingKm.push(getDistanceKm(
      previousPosition.lat,
      previousPosition.lng,
      waypoint.lat,
      waypoint.lng,
    ));
    previousPosition = waypoint;
  });
  return {
    waypointCount: route.length,
    maximumTurnDeg: getMaximumRouteTurnDeg(startPosition, route),
    minimumWaypointSpacingKm: Math.min(...waypointSpacingKm),
  };
}
