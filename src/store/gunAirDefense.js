import { getGunSystemSpec } from '../data/gunSystems.js';
import { SIMPLE_TARGET_TYPE } from '../data/airTargetProfiles.js';
import { getDestinationPoint, getDistanceKm } from './geo.js';
import { TRACK_STATE } from './trackSystem.js';

const normalizeHeadingDelta = delta => ((delta + 540) % 360) - 180;

export const GUN_ENGAGEMENT_PHASE = Object.freeze({
  TRACKING: 'TRACKING',
  FIRING: 'FIRING',
  PROJECTILE_FLIGHT: 'PROJECTILE_FLIGHT',
});

export const GUN_ENGAGEMENT_REASON = Object.freeze({
  READY: 'READY',
  NO_STABLE_TRACK: 'NO_STABLE_TRACK',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  TARGET_TOO_FAST: 'TARGET_TOO_FAST',
  TARGET_TOO_HIGH: 'TARGET_TOO_HIGH',
  UNSUITABLE_TARGET: 'UNSUITABLE_TARGET',
  COOLDOWN: 'COOLDOWN',
  NO_AMMO: 'NO_AMMO',
});

export function quantizeGepardHeading(heading) {
  return (Math.round((((heading % 360) + 360) % 360) / 45) * 45) % 360;
}

const clamp01 = value => Math.max(0, Math.min(1, value));

export function getGunProjectileFlightTimeSec(distanceKm, gunSpec) {
  const table = gunSpec.projectileTimeTable;
  const distance = Math.max(0, distanceKm);
  for (let index = 1; index < table.length; index += 1) {
    const previous = table[index - 1];
    const next = table[index];
    if (distance <= next.distanceKm) {
      const fraction = (distance - previous.distanceKm)
        / (next.distanceKm - previous.distanceKm);
      return previous.timeSec + (next.timeSec - previous.timeSec) * fraction;
    }
  }
  const previous = table.at(-2);
  const last = table.at(-1);
  const secondsPerKm = (last.timeSec - previous.timeSec)
    / (last.distanceKm - previous.distanceKm);
  return last.timeSec + (distance - last.distanceKm) * secondsPerKm;
}

const projectTargetPosition = (track, target, seconds) => getDestinationPoint(
  track.reportedPosition.lat,
  track.reportedPosition.lng,
  track.reportedHeading ?? target.heading,
  (track.reportedSpeedKmh ?? target.speedKmh) * seconds / 3600,
);

export function solveGunAim({ unit, track, target, gunSpec }) {
  let aimPosition = { ...track.reportedPosition };
  let distanceKm = getDistanceKm(unit.lat, unit.lng, aimPosition.lat, aimPosition.lng);
  let projectileFlightTimeSec = getGunProjectileFlightTimeSec(distanceKm, gunSpec);
  for (let iteration = 0; iteration < 4; iteration += 1) {
    aimPosition = projectTargetPosition(track, target, projectileFlightTimeSec);
    distanceKm = getDistanceKm(unit.lat, unit.lng, aimPosition.lat, aimPosition.lng);
    projectileFlightTimeSec = getGunProjectileFlightTimeSec(distanceKm, gunSpec);
  }
  return {
    aimPosition,
    distanceKm,
    projectileFlightTimeSec,
    averageProjectileSpeedMps: projectileFlightTimeSec > 0
      ? distanceKm * 1000 / projectileFlightTimeSec
      : gunSpec.muzzleVelocityMps,
  };
}

const estimateTimeRemainingInZoneSec = ({ unit, track, target, rangeKm }) => {
  for (let seconds = 0.25; seconds <= 60; seconds += 0.25) {
    const projected = projectTargetPosition(track, target, seconds);
    if (getDistanceKm(unit.lat, unit.lng, projected.lat, projected.lng) > rangeKm) return seconds;
  }
  return 60;
};

export function evaluateGunEngagement({ battery, track, target, simulationTime = 0 }) {
  const spec = getGunSystemSpec(battery?.gunSpecId);
  const unit = battery?.components?.launchers?.[0];
  if (!spec || !unit || battery.missilesLeft < spec.roundsPerBurst) {
    return { ready: false, reason: GUN_ENGAGEMENT_REASON.NO_AMMO, distanceKm: null };
  }
  if ((battery.gunNextBurstTime ?? 0) > simulationTime) {
    return { ready: false, reason: GUN_ENGAGEMENT_REASON.COOLDOWN, distanceKm: null };
  }
  if (
    !track
    || (track.state !== TRACK_STATE.TRACKED && track.state !== TRACK_STATE.IDENTIFIED)
    || (track.trackQuality ?? 0) < spec.requiredTrackQuality
  ) {
    return { ready: false, reason: GUN_ENGAGEMENT_REASON.NO_STABLE_TRACK, distanceKm: null };
  }
  if (!target || !spec.permittedTargetTypes.includes(target.type)) {
    return { ready: false, reason: GUN_ENGAGEMENT_REASON.UNSUITABLE_TARGET, distanceKm: null };
  }
  const distanceKm = getDistanceKm(unit.lat, unit.lng, track.reportedPosition.lat, track.reportedPosition.lng);
  if (distanceKm > spec.engagementRangeKm) {
    return { ready: false, reason: GUN_ENGAGEMENT_REASON.OUT_OF_RANGE, distanceKm };
  }
  if ((track.reportedSpeedKmh ?? target.speedKmh) > spec.maximumTargetSpeedKmh) {
    return { ready: false, reason: GUN_ENGAGEMENT_REASON.TARGET_TOO_FAST, distanceKm };
  }
  const aimSolution = solveGunAim({ unit, track, target, gunSpec: spec });
  const timeRemainingInZoneSec = estimateTimeRemainingInZoneSec({
    unit,
    track,
    target,
    rangeKm: spec.engagementRangeKm,
  });
  return {
    ready: true,
    reason: GUN_ENGAGEMENT_REASON.READY,
    distanceKm,
    ...aimSolution,
    timeRemainingInZoneSec,
  };
}

export function resolveGunBurst({ battery, track, target }) {
  const spec = getGunSystemSpec(battery.gunSpecId);
  const unit = battery.components.launchers[0];
  const solution = evaluateGunEngagement({
    battery: {
      ...battery,
      missilesLeft: Math.max(spec.roundsPerBurst, battery.missilesLeft),
      gunNextBurstTime: 0,
    },
    track,
    target,
    simulationTime: 0,
  });
  if (!solution.ready && solution.reason !== GUN_ENGAGEMENT_REASON.COOLDOWN) {
    return { destroyed: false, reason: solution.reason, effectiveness: 0, distanceKm: solution.distanceKm };
  }

  const headingErrorDeg = Math.abs(normalizeHeadingDelta(
    (target.desiredHeading ?? target.heading) - target.heading,
  ));
  const rangeFactor = clamp01(1 - solution.distanceKm / spec.engagementRangeKm);
  const speedFactor = clamp01(1 - target.speedKmh / spec.maximumTargetSpeedKmh);
  const straightFlightFactor = clamp01(1 - headingErrorDeg / 18);
  const trackFactor = clamp01(track.trackQuality ?? 0);
  const firingWindowSec = solution.timeRemainingInZoneSec
    - spec.reactionTimeSec
    - solution.projectileFlightTimeSec;
  const firingWindowFactor = clamp01(firingWindowSec / 10);
  const projectileTimeFactor = clamp01(1 - solution.projectileFlightTimeSec / 10);
  const targetClassFactor = target.type === SIMPLE_TARGET_TYPE.CRUISE_MISSILE ? 0.62 : 1;
  const effectiveness = (
    rangeFactor * 0.22
    + speedFactor * 0.15
    + straightFlightFactor * 0.18
    + trackFactor * 0.2
    + firingWindowFactor * 0.2
    + projectileTimeFactor * 0.05
  ) * targetClassFactor;
  return {
    destroyed: effectiveness >= 0.5,
    reason: effectiveness >= 0.5 ? 'KINEMATIC_BURST_SOLUTION' : 'BURST_INEFFECTIVE',
    effectiveness,
    distanceKm: getDistanceKm(unit.lat, unit.lng, target.position.lat, target.position.lng),
    headingErrorDeg,
    projectileFlightTimeSec: solution.projectileFlightTimeSec,
    averageProjectileSpeedMps: solution.averageProjectileSpeedMps,
    timeRemainingInZoneSec: solution.timeRemainingInZoneSec,
    firingWindowSec,
  };
}
