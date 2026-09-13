import { getMapObjectSizePx, MAP_OBJECT_CLASS } from '../data/mapVisualProfiles.js';

const clamp01 = value => Math.max(0, Math.min(1, value));

const rotateScreenOffset = (x, y, rotationDeg) => {
  const radians = rotationDeg * Math.PI / 180;
  return {
    x: x * Math.cos(radians) - y * Math.sin(radians),
    y: x * Math.sin(radians) + y * Math.cos(radians),
  };
};

export function getVisualLaunchOffset({
  launchProfile,
  launchPoint,
  launchVisualRotationDeg = 0,
  flightTime = 0,
  mapZoom,
}) {
  if (!launchProfile || !launchPoint) return { x: 0, y: 0, scale: 1, progress: 1 };
  const launcherSizePx = getMapObjectSizePx(MAP_OBJECT_CLASS.LAUNCHER, mapZoom);
  const startOffset = rotateScreenOffset(
    (launchPoint.x - 0.5) * launcherSizePx,
    (launchPoint.y - 0.5) * launcherSizePx,
    launchVisualRotationDeg,
  );
  const durationSec = Math.min(
    0.5,
    Math.max(0.3, launchProfile.visualDepartureDurationSec ?? 0.5),
  );
  const progress = clamp01(flightTime / durationSec);
  const easedProgress = progress * progress * (3 - 2 * progress);
  const retention = 1 - easedProgress;
  const verticalScale = launchProfile.launchMode === 'VERTICAL'
    ? 1 + 0.14 * Math.sin(progress * Math.PI)
    : 1;
  return {
    x: startOffset.x * retention,
    y: startOffset.y * retention,
    scale: verticalScale,
    progress: easedProgress,
  };
}
