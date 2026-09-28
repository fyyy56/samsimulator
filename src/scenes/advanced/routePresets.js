import { getBearing, getDestinationPoint, getDistanceKm } from '../../store/geo.js';

export const TARGET_ROUTE_PRESET = Object.freeze({
  MANUAL: 'MANUAL', STRAIGHT: 'STRAIGHT', S_TURN: 'S_TURN',
  ZIGZAG: 'ZIGZAG', TURN: 'TURN', SNAKE: 'SNAKE',
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Build a fixed, geographic waypoint route for the existing target route pipeline. */
export function generateTargetRoute(start, end, preset, style = 'CRUISE', altitudeM = 100) {
  if (!start || !end || preset === TARGET_ROUTE_PRESET.MANUAL) return [];
  const distance = getDistanceKm(start.lat, start.lng, end.lat, end.lng);
  if (!Number.isFinite(distance) || distance < .1) return [];
  const bearing = getBearing(start.lat, start.lng, end.lat, end.lng);
  if (preset === TARGET_ROUTE_PRESET.STRAIGHT) return [
    { lat: start.lat, lng: start.lng, altitudeM },
    { lat: end.lat, lng: end.lng, altitudeM },
  ];

  const fighter = style === 'FIGHTER';
  const definitions = {
    [TARGET_ROUTE_PRESET.S_TURN]: { cycles: 1, amplitude: fighter ? .16 : .09 },
    [TARGET_ROUTE_PRESET.ZIGZAG]: { cycles: fighter ? 4 : 2, amplitude: fighter ? .13 : .075 },
    [TARGET_ROUTE_PRESET.TURN]: { cycles: .5, amplitude: fighter ? .2 : .12 },
    [TARGET_ROUTE_PRESET.SNAKE]: { cycles: fighter ? 3 : 1.5, amplitude: fighter ? .16 : .085 },
  };
  const shape = definitions[preset];
  if (!shape) return [];
  const amplitudeKm = Math.min(distance * shape.amplitude, fighter ? 12 : 8);
  const samples = fighter ? 24 : 14;
  return Array.from({ length: samples + 1 }, (_, index) => {
    const t = index / samples;
    if (index === 0) return { lat: start.lat, lng: start.lng, altitudeM };
    if (index === samples) return { lat: end.lat, lng: end.lng, altitudeM };
    const center = getDestinationPoint(start.lat, start.lng, bearing, distance * t);
    const wave = preset === TARGET_ROUTE_PRESET.TURN
      ? Math.sin(Math.PI * t)
      : Math.sin(Math.PI * 2 * shape.cycles * t);
    const crossTrackKm = clamp(wave * amplitudeKm, -12, 12);
    const point = getDestinationPoint(center.lat, center.lng,
      bearing + (crossTrackKm >= 0 ? -90 : 90), Math.abs(crossTrackKm));
    return { ...point, altitudeM };
  });
}

export function getTargetRouteDistanceKm(route = []) {
  let distance = 0;
  for (let index = 1; index < route.length; index += 1) {
    distance += getDistanceKm(route[index - 1].lat, route[index - 1].lng,
      route[index].lat, route[index].lng);
  }
  return distance;
}

export function formatRouteEta(distanceKm, speedKmh) {
  if (!(distanceKm > 0) || !(speedKmh > 0)) return '—';
  const totalSeconds = Math.round(distanceKm / speedKmh * 3600);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}
