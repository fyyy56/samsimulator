export const MAP_OBJECT_CLASS = Object.freeze({
  TARGET: 'TARGET',
  INTERCEPTOR: 'INTERCEPTOR',
  RADAR: 'RADAR',
  LAUNCHER: 'LAUNCHER',
});

export const MAP_LOD = Object.freeze({
  FAR: 'FAR',
  MEDIUM: 'MEDIUM',
  CLOSE: 'CLOSE',
});

const SIZE_PROFILES = Object.freeze({
  [MAP_OBJECT_CLASS.TARGET]: { far: 25, medium: 40, close: 62 },
  [MAP_OBJECT_CLASS.INTERCEPTOR]: { far: 25, medium: 42, close: 62 },
  [MAP_OBJECT_CLASS.RADAR]: { far: 28, medium: 50, close: 72 },
  [MAP_OBJECT_CLASS.LAUNCHER]: { far: 30, medium: 56, close: 82 },
});

export function getMapLod(zoom) {
  if (zoom < 6.4) return MAP_LOD.FAR;
  if (zoom < 9.2) return MAP_LOD.MEDIUM;
  return MAP_LOD.CLOSE;
}

const interpolate = (from, to, amount) => from + (to - from) * amount;

export function getMapObjectSizePx(objectClass, zoom) {
  const profile = SIZE_PROFILES[objectClass] ?? SIZE_PROFILES[MAP_OBJECT_CLASS.TARGET];
  if (zoom <= 6.4) {
    const amount = Math.max(0, Math.min(1, (zoom - 4.65) / 1.75));
    return interpolate(profile.far * 0.86, profile.far, amount);
  }
  if (zoom <= 9.2) {
    return interpolate(profile.far, profile.medium, (zoom - 6.4) / 2.8);
  }
  return interpolate(profile.medium, profile.close, Math.min(1, (zoom - 9.2) / 3.8));
}
