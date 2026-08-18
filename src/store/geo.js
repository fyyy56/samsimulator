export function getDistanceKm(lat1, lon1, lat2, lon2) {
  const earthRadiusKm = 6371;
  const latitudeDelta = (lat2 - lat1) * (Math.PI / 180);
  const longitudeDelta = (lon2 - lon1) * (Math.PI / 180);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(lat1 * (Math.PI / 180))
    * Math.cos(lat2 * (Math.PI / 180))
    * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * (2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine)));
}

export function getBearing(lat1, lon1, lat2, lon2) {
  const toRadians = Math.PI / 180;
  const toDegrees = 180 / Math.PI;
  const longitudeDelta = (lon2 - lon1) * toRadians;
  const y = Math.sin(longitudeDelta) * Math.cos(lat2 * toRadians);
  const x = Math.cos(lat1 * toRadians) * Math.sin(lat2 * toRadians)
    - Math.sin(lat1 * toRadians) * Math.cos(lat2 * toRadians) * Math.cos(longitudeDelta);
  return ((Math.atan2(y, x) * toDegrees) + 360) % 360;
}

export function getDestinationPoint(lat, lng, bearingDegrees, distanceKm) {
  const earthRadiusKm = 6371;
  const angularDistance = distanceKm / earthRadiusKm;
  const bearing = bearingDegrees * (Math.PI / 180);
  const latitude = lat * (Math.PI / 180);
  const longitude = lng * (Math.PI / 180);
  const destinationLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance)
    + Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const destinationLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(destinationLatitude),
  );

  return {
    lat: destinationLatitude * (180 / Math.PI),
    lng: destinationLongitude * (180 / Math.PI),
  };
}

export function getSlantDistanceKm(positionA, altitudeAM, positionB, altitudeBM) {
  const horizontalDistanceKm = getDistanceKm(
    positionA.lat,
    positionA.lng,
    positionB.lat,
    positionB.lng,
  );
  const altitudeDifferenceKm = (altitudeBM - altitudeAM) / 1000;
  return Math.sqrt(horizontalDistanceKm ** 2 + altitudeDifferenceKm ** 2);
}
