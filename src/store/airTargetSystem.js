import { getBearing, getDistanceKm } from './geo.js';

export function createAirTarget(definition, spawnedAt) {
  const firstWaypoint = definition.route[0];
  return {
    id: definition.id,
    type: definition.type,
    state: 'ALIVE',
    speedKmh: definition.speedKmh,
    altitudeM: definition.altitudeM,
    position: { ...definition.spawnPosition },
    heading: getBearing(
      definition.spawnPosition.lat,
      definition.spawnPosition.lng,
      firstWaypoint.lat,
      firstWaypoint.lng,
    ),
    route: definition.route.map(waypoint => ({ ...waypoint })),
    waypointIndex: 0,
    spawnedAt,
  };
}

export function advanceAirTarget(target, deltaTimeSec) {
  const waypoint = target.route[target.waypointIndex];
  if (!waypoint) return { ...target, state: 'COMPLETED' };

  const remainingDistanceKm = getDistanceKm(
    target.position.lat,
    target.position.lng,
    waypoint.lat,
    waypoint.lng,
  );
  const travelDistanceKm = (target.speedKmh / 3600) * deltaTimeSec;
  const heading = getBearing(target.position.lat, target.position.lng, waypoint.lat, waypoint.lng);

  if (remainingDistanceKm <= Math.max(0.15, travelDistanceKm)) {
    const reachedFinalWaypoint = target.waypointIndex >= target.route.length - 1;
    return {
      ...target,
      state: reachedFinalWaypoint ? 'COMPLETED' : target.state,
      position: { ...waypoint },
      heading,
      waypointIndex: target.waypointIndex + 1,
    };
  }

  const progress = travelDistanceKm / remainingDistanceKm;
  return {
    ...target,
    heading,
    position: {
      lat: target.position.lat + (waypoint.lat - target.position.lat) * progress,
      lng: target.position.lng + (waypoint.lng - target.position.lng) * progress,
    },
  };
}
