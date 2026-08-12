import { getDistanceKm } from './geo.js';
import { TRACK_STATE } from './trackSystem.js';

export const ENGAGEMENT_STATUS = Object.freeze({
  READY: 'READY',
  OUT_OF_RANGE: 'OUT OF RANGE',
  NO_TRACK: 'NO TRACK',
  NO_AMMO: 'NO AMMO',
});

export function getBatteryEngagementStatus(battery, track) {
  if (!track || track.state === TRACK_STATE.LOST) return ENGAGEMENT_STATUS.NO_TRACK;
  if (battery.missilesLeft <= 0) return ENGAGEMENT_STATUS.NO_AMMO;
  if (!battery.components.radar || !selectBestLauncher(battery, track)) {
    return ENGAGEMENT_STATUS.NO_TRACK;
  }

  const distanceKm = getDistanceKm(
    track.reportedPosition.lat,
    track.reportedPosition.lng,
    battery.components.radar.lat,
    battery.components.radar.lng,
  );
  return distanceKm <= battery.radarRangeKm
    ? ENGAGEMENT_STATUS.READY
    : ENGAGEMENT_STATUS.OUT_OF_RANGE;
}

export function selectBestLauncher(battery, track) {
  if (!track) return null;
  const readyLaunchers = battery.components.launchers.filter(launcher => (
    launcher.operational !== false && launcher.ready !== false
  ));

  return readyLaunchers.reduce((closest, launcher) => {
    const distanceKm = getDistanceKm(
      launcher.lat,
      launcher.lng,
      track.reportedPosition.lat,
      track.reportedPosition.lng,
    );
    if (!closest || distanceKm < closest.distanceKm) return { launcher, distanceKm };
    return closest;
  }, null)?.launcher ?? null;
}
