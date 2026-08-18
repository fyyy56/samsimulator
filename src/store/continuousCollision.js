const EARTH_RADIUS_KM = 6371;

const clamp01 = value => Math.max(0, Math.min(1, value));

const getLongitude = position => position.lng ?? position.lon ?? 0;
const getAltitudeM = position => position.altitudeM ?? position.alt ?? 0;

const toCartesianKm = (position) => {
  const latitudeRad = position.lat * Math.PI / 180;
  const longitudeRad = getLongitude(position) * Math.PI / 180;
  const radiusKm = EARTH_RADIUS_KM + getAltitudeM(position) / 1000;
  const latitudeRadiusKm = radiusKm * Math.cos(latitudeRad);
  return {
    x: latitudeRadiusKm * Math.cos(longitudeRad),
    y: latitudeRadiusKm * Math.sin(longitudeRad),
    z: radiusKm * Math.sin(latitudeRad),
  };
};

const subtract = (first, second) => ({
  x: first.x - second.x,
  y: first.y - second.y,
  z: first.z - second.z,
});

const addScaled = (origin, direction, scale) => ({
  x: origin.x + direction.x * scale,
  y: origin.y + direction.y * scale,
  z: origin.z + direction.z * scale,
});

const dot = (first, second) => (
  first.x * second.x + first.y * second.y + first.z * second.z
);

const length = vector => Math.sqrt(dot(vector, vector));

const interpolatePosition = (start, end, fraction) => {
  const startLongitude = getLongitude(start);
  let longitudeDelta = getLongitude(end) - startLongitude;
  if (longitudeDelta > 180) longitudeDelta -= 360;
  if (longitudeDelta < -180) longitudeDelta += 360;
  const lng = startLongitude + longitudeDelta * fraction;
  return {
    lat: start.lat + (end.lat - start.lat) * fraction,
    lng,
    lon: lng,
    altitudeM: getAltitudeM(start)
      + (getAltitudeM(end) - getAltitudeM(start)) * fraction,
  };
};

/**
 * Finds the closest simultaneous approach of two objects moving linearly during
 * one simulation step. Positions are converted to Earth-centred Cartesian
 * coordinates, so altitude is part of the collision geometry.
 */
export function getSweptClosestApproach({
  interceptorStart,
  interceptorEnd,
  targetStart,
  targetEnd,
}) {
  const interceptorStartCartesian = toCartesianKm(interceptorStart);
  const targetStartCartesian = toCartesianKm(targetStart);
  const interceptorDelta = subtract(toCartesianKm(interceptorEnd), interceptorStartCartesian);
  const targetDelta = subtract(toCartesianKm(targetEnd), targetStartCartesian);
  const relativeStart = subtract(interceptorStartCartesian, targetStartCartesian);
  const relativeDelta = subtract(interceptorDelta, targetDelta);
  const relativeSpeedSquared = dot(relativeDelta, relativeDelta);
  const timeFraction = relativeSpeedSquared > Number.EPSILON
    ? clamp01(-dot(relativeStart, relativeDelta) / relativeSpeedSquared)
    : 0;
  const interceptorClosest = addScaled(
    interceptorStartCartesian,
    interceptorDelta,
    timeFraction,
  );
  const targetClosest = addScaled(targetStartCartesian, targetDelta, timeFraction);
  const closestDistanceKm = length(subtract(interceptorClosest, targetClosest));

  return {
    closestDistanceKm,
    distanceKm: closestDistanceKm,
    timeFraction,
    interceptorPosition: interpolatePosition(interceptorStart, interceptorEnd, timeFraction),
    targetPosition: interpolatePosition(targetStart, targetEnd, timeFraction),
  };
}

export function didSweptPathsEnterRadius(paths, radiusKm) {
  const approach = getSweptClosestApproach(paths);
  return {
    ...approach,
    intersects: approach.closestDistanceKm <= radiusKm,
  };
}
