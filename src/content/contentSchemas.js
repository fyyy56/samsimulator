export const CONTENT_SCHEMA_VERSION = 1;

export const CONTENT_KIND = Object.freeze({
  AIR_DEFENSE: 'AIR_DEFENSE',
  GUN_AA: 'GUN_AA',
  INTERCEPTOR: 'INTERCEPTOR',
  THREAT: 'THREAT',
  FAQ: 'FAQ',
});

export const EDITOR_OBJECT_TYPE = Object.freeze({
  UAV: 'UAV',
  CRUISE_MISSILE: 'CRUISE_MISSILE',
  BALLISTIC_MISSILE: 'BALLISTIC_MISSILE',
  AIRCRAFT: 'AIRCRAFT',
  INTERCEPTOR: 'INTERCEPTOR',
  GROUND_VEHICLE: 'GROUND_VEHICLE',
  RADAR: 'RADAR',
  LAUNCHER: 'LAUNCHER',
  AA_GUN: 'AA_GUN',
});

export const isCatalogRecord = record => Boolean(
  record && typeof record.id === 'string' && typeof record.name === 'string' && typeof record.kind === 'string',
);

export const normalizeEditorObject = (object = {}) => ({
  id: object.id ?? `OBJ-${Date.now()}`,
  objectType: object.objectType ?? EDITOR_OBJECT_TYPE.UAV,
  name: object.name ?? 'Новый объект',
  contentId: object.contentId ?? null,
  assetId: object.assetId ?? null,
  position: {
    lat: Number(object.position?.lat) || 49,
    lng: Number(object.position?.lng) || 31,
  },
  size: Math.max(0.25, Number(object.size) || 1),
  speedKmh: Math.max(0, Number(object.speedKmh) || 160),
  altitudeM: Math.max(0, Number(object.altitudeM) || 120),
  heading: ((Number(object.heading) || 0) + 360) % 360,
  route: Array.isArray(object.route) ? object.route.map(point => ({ lat: Number(point.lat), lng: Number(point.lng) })) : [],
  count: Math.min(100, Math.max(1, Math.round(Number(object.count) || 1))),
  intervalSec: Math.max(0, Number(object.intervalSec) || 0),
});
