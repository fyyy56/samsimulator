import { getDistanceKm } from './geo.js';
import { TRACK_STATE } from './trackSystem.js';
import {
  evaluateBatteryInterceptFeasibility,
  INTERCEPT_FEASIBILITY,
  INTERCEPT_SOLUTION_REASON,
} from './interceptFeasibility.js';
import { evaluateGunEngagement } from './gunAirDefense.js';

export const ENGAGEMENT_STATUS = Object.freeze({
  READY: 'READY',
  OUT_OF_RANGE: 'OUT OF RANGE',
  NO_TRACK: 'NO TRACK',
  NO_AMMO: 'NO AMMO',
  NO_INTERCEPT_SOLUTION: 'NO INTERCEPT SOLUTION',
  TOO_LATE: 'TOO LATE',
});

export function getOperationalLaunchers(battery) {
  return battery?.components?.launchers?.filter(launcher => launcher.operational !== false) ?? [];
}

// The canonical Track retains its last measured/coasted radar point. Older
// scenario fixtures omit source metadata; the ideal sensor explicitly marks
// its synthetic source and must never authorize a manual radar-cued launch.
export const hasRadarTrackPoint = track => Boolean(track
  && Number.isFinite(track.lastUpdateTime)
  && Number.isFinite(track.reportedPosition?.lat)
  && Number.isFinite(track.reportedPosition?.lng)
  && !track.sourceRadarId?.endsWith('-IDEAL'));

export const canManualLaunch = (battery, track) => Boolean(battery
  && battery.controlMode === 'MANUAL'
  && battery.weaponType !== 'GUN_AA'
  && battery.operational !== false
  && battery.status !== 'DESTROYED'
  && battery.missilesLeft > 0
  && getOperationalLaunchers(battery).length > 0
  && hasRadarTrackPoint(track));

export function getBatteryEngagementStatus(battery, track, target = null) {
  if (battery.missilesLeft <= 0) return ENGAGEMENT_STATUS.NO_AMMO;
  if (!track || track.state === TRACK_STATE.LOST) return ENGAGEMENT_STATUS.NO_TRACK;
  if (!battery.components.radar || !selectBestLauncher(battery, track)) {
    return ENGAGEMENT_STATUS.NO_TRACK;
  }

  if (battery.weaponType === 'GUN_AA') {
    const solution = evaluateGunEngagement({
      battery,
      track,
      target,
      simulationTime: battery.currentSimulationTime ?? 0,
    });
    if (solution.ready) return ENGAGEMENT_STATUS.READY;
    if (solution.reason === 'OUT_OF_RANGE') return ENGAGEMENT_STATUS.OUT_OF_RANGE;
    if (solution.reason === 'NO_AMMO') return ENGAGEMENT_STATUS.NO_AMMO;
    return ENGAGEMENT_STATUS.NO_INTERCEPT_SOLUTION;
  }

  const distanceKm = getDistanceKm(
    track.reportedPosition.lat,
    track.reportedPosition.lng,
    battery.components.radar.lat,
    battery.components.radar.lng,
  );
  if (distanceKm > battery.radarRangeKm) return ENGAGEMENT_STATUS.OUT_OF_RANGE;
  if (target) {
    const solution = evaluateBatteryInterceptFeasibility({ battery, track, target });
    if (solution.status === INTERCEPT_FEASIBILITY.NO_SOLUTION) {
      return solution.reason === INTERCEPT_SOLUTION_REASON.MINIMUM_RANGE
        ? ENGAGEMENT_STATUS.OUT_OF_RANGE
        : solution.reason === INTERCEPT_SOLUTION_REASON.TOO_LATE
        ? ENGAGEMENT_STATUS.TOO_LATE
        : ENGAGEMENT_STATUS.NO_INTERCEPT_SOLUTION;
    }
  }
  return ENGAGEMENT_STATUS.READY;
}

export function selectBestLauncher(battery, track) {
  if (!track) return null;
  const readyLaunchers = getOperationalLaunchers(battery).filter(launcher => (
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
