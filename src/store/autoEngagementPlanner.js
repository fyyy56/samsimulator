import { getInterceptorSpec } from '../data/interceptors.js';
import { getGunSystemSpec, WEAPON_SYSTEM_TYPE } from '../data/gunSystems.js';
import { getBearing, getDestinationPoint, getDistanceKm } from './geo.js';
import { getRolePriorityTier, getTargetEtaSec } from './autoDefense.js';
import { INTERCEPT_FEASIBILITY } from './interceptFeasibility.js';

export const AUTO_ENGAGEMENT_DECISION = Object.freeze({
  ENGAGE: 'ENGAGE',
  HOLD_OPTIMAL_WINDOW: 'HOLD_OPTIMAL_WINDOW',
  DEFER_TO_BETTER_LAYER: 'DEFER_TO_BETTER_LAYER',
  HOLD_LOW_CONFIDENCE: 'HOLD_LOW_CONFIDENCE',
  NO_SOLUTION: 'NO_SOLUTION',
});

export const INTERCEPT_SOLUTION_STATE = Object.freeze({
  READY: 'READY',
  LOW_CHANCE: 'LOW_CHANCE',
  NO_SOLUTION: 'NO_SOLUTION',
});

const clamp01 = value => Math.max(0, Math.min(1, value));

const getBatteryCategory = battery => {
  if (battery?.category) return battery.category;
  if (battery?.weaponType === WEAPON_SYSTEM_TYPE.GUN_AA) return 'GUN';
  if (battery?.type?.includes('PATRIOT')) return 'LONG';
  if (battery?.type?.includes('NASAMS')) return 'MEDIUM';
  return 'SHORT';
};

const PREFERRED_ENGAGEMENT_RANGE_RATIO = Object.freeze({
  GUN: 1,
  SHORT: 0.64,
  MEDIUM: 0.66,
  LONG: 0.54,
});

const TARGET_RANGE_ADJUSTMENT = Object.freeze({
  BALLISTIC_TARGET: Object.freeze({ LONG: 1, MEDIUM: 0.58, SHORT: 0.5, GUN: 0 }),
  CRUISE_TARGET: Object.freeze({ LONG: 0.55, MEDIUM: 1, SHORT: 0.92, GUN: 1 }),
  UAV_TARGET: Object.freeze({ LONG: 0.42, MEDIUM: 0.72, SHORT: 1, GUN: 1 }),
});

// Automatic fire control uses the target's current range for the launch
// window. The feasibility solver's interceptDistanceKm is the shorter path to
// a predicted meeting point and must not be treated as current target range.
const MAXIMUM_AUTOMATIC_RANGE_RATIO = Object.freeze({
  GUN: 1,
  SHORT: 1.12,
  MEDIUM: 1.12,
  LONG: 1.08,
});

const ROLE_CONFIDENCE = Object.freeze({
  GUN: Object.freeze({ UAV_TARGET: 0.86, CRUISE_TARGET: 0.48, BALLISTIC_TARGET: 0 }),
  SHORT: Object.freeze({ UAV_TARGET: 0.78, CRUISE_TARGET: 0.74, BALLISTIC_TARGET: 0.32 }),
  MEDIUM: Object.freeze({ UAV_TARGET: 0.64, CRUISE_TARGET: 0.86, BALLISTIC_TARGET: 0.42 }),
  LONG: Object.freeze({ UAV_TARGET: 0.32, CRUISE_TARGET: 0.58, BALLISTIC_TARGET: 0.9 }),
});

const getMaximumRangeKm = (battery) => {
  if (battery.weaponType === WEAPON_SYSTEM_TYPE.GUN_AA) {
    return getGunSystemSpec(battery.gunSpecId)?.engagementRangeKm ?? battery.engagementRangeKm ?? 0;
  }
  return getInterceptorSpec(battery.interceptorSpecId)?.gameplayPhysics.maxGameRangeKm ?? 0;
};

export function getPreferredEngagementRangeKm(battery, target) {
  const category = getBatteryCategory(battery);
  const maximumRangeKm = getMaximumRangeKm(battery);
  const roleAdjustment = TARGET_RANGE_ADJUSTMENT[target?.type]?.[category] ?? 0.6;
  return maximumRangeKm
    * (PREFERRED_ENGAGEMENT_RANGE_RATIO[category] ?? 0.6)
    * roleAdjustment;
}

const getTargetRoutePoints = (target, track) => [
  track?.reportedPosition ?? target.position,
  ...(target.route ?? []).slice(target.waypointIndex ?? 0),
];

/**
 * Returns distance along the planned target route before it enters a defense
 * zone. Sampling at <= 2 km is sufficient for command-layer planning and is
 * intentionally separate from the interception physics solver.
 */
export function getRouteDistanceToZoneKm({ target, track, center, radiusKm }) {
  if (!center || radiusKm <= 0) return Number.POSITIVE_INFINITY;
  const routePoints = getTargetRoutePoints(target, track);
  if (routePoints.length === 0) return Number.POSITIVE_INFINITY;
  if (getDistanceKm(routePoints[0].lat, routePoints[0].lng, center.lat, center.lng) <= radiusKm) {
    return 0;
  }

  let traveledKm = 0;
  for (let index = 1; index < routePoints.length; index += 1) {
    const start = routePoints[index - 1];
    const end = routePoints[index];
    const segmentDistanceKm = getDistanceKm(start.lat, start.lng, end.lat, end.lng);
    const sampleCount = Math.max(1, Math.ceil(segmentDistanceKm / 2));
    const bearing = getBearing(start.lat, start.lng, end.lat, end.lng);
    for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex += 1) {
      const sampleDistanceKm = segmentDistanceKm * sampleIndex / sampleCount;
      const sample = getDestinationPoint(start.lat, start.lng, bearing, sampleDistanceKm);
      if (getDistanceKm(sample.lat, sample.lng, center.lat, center.lng) <= radiusKm) {
        return traveledKm + sampleDistanceKm;
      }
    }
    traveledKm += segmentDistanceKm;
  }
  return Number.POSITIVE_INFINITY;
}

const getBatteryZoneCenter = battery => (
  battery.components?.launchers?.[0]
  ?? battery.components?.radar
  ?? battery.components?.fdc
  ?? null
);

const batteryCanPlanForTarget = (battery, target) => {
  if (!battery || battery.controlMode === 'HOLD' || battery.missilesLeft <= 0) return false;
  if (battery.components?.radar?.operational === false) return false;
  if (!battery.components?.launchers?.some(launcher => launcher.operational !== false)) return false;
  if (battery.weaponType !== WEAPON_SYSTEM_TYPE.GUN_AA) return true;
  const spec = getGunSystemSpec(battery.gunSpecId);
  return Boolean(
    spec
    && spec.permittedTargetTypes.includes(target.type)
    && target.speedKmh <= spec.maximumTargetSpeedKmh
  );
};

export function buildTargetDefenseAssessments({ targets, tracks, batteries, simulationTime }) {
  const tracksByTargetId = new Map(tracks.map(track => [track.targetId, track]));
  return new Map(targets.map(target => {
    const track = tracksByTargetId.get(target.id) ?? null;
    const zones = batteries
      .filter(battery => batteryCanPlanForTarget(battery, target))
      .map(battery => {
        const effectiveRangeKm = getPreferredEngagementRangeKm(battery, target);
        const distanceToZoneKm = getRouteDistanceToZoneKm({
          target,
          track,
          center: getBatteryZoneCenter(battery),
          radiusKm: effectiveRangeKm,
        });
        return { battery, effectiveRangeKm, distanceToZoneKm };
      })
      .filter(zone => Number.isFinite(zone.distanceToZoneKm))
      .sort((first, second) => (
        first.distanceToZoneKm - second.distanceToZoneKm
        || getRolePriorityTier(first.battery, target) - getRolePriorityTier(second.battery, target)
      ));
    const nearestZone = zones[0] ?? null;
    const etaSec = getTargetEtaSec(target);
    const speedKmh = track?.reportedSpeedKmh ?? target.speedKmh;
    return [target.id, {
      targetType: target.type,
      etaSec,
      distanceToNearestEffectiveZoneKm: nearestZone?.distanceToZoneKm ?? null,
      timeToNearestEffectiveZoneSec: nearestZone && speedKmh > 0
        ? nearestZone.distanceToZoneKm / speedKmh * 3600
        : null,
      nearestEffectiveBatteryId: nearestZone?.battery.id ?? null,
      updatedAt: simulationTime,
    }];
  }));
}

export const calculateInterceptProbability = ({ battery, track, target, interceptSolution }) => {
  if (
    !interceptSolution
    || interceptSolution.status === INTERCEPT_FEASIBILITY.NO_SOLUTION
  ) return 0;
  const category = getBatteryCategory(battery);
  if (battery.weaponType === WEAPON_SYSTEM_TYPE.GUN_AA) {
    const roleConfidence = ROLE_CONFIDENCE[category]?.[target.type] ?? 0.35;
    const trackFactor = clamp01(track.trackQuality ?? 0);
    const rangeFactor = clamp01(1 - interceptSolution.distanceKm / Math.max(1, getMaximumRangeKm(battery)));
    const speedFactor = clamp01(1 - target.speedKmh / 1_300);
    const timeFactor = clamp01((interceptSolution.timeRemainingInZoneSec ?? 0) / 12);
    return clamp01(
      roleConfidence * 0.35
      + trackFactor * 0.2
      + rangeFactor * 0.2
      + speedFactor * 0.15
      + timeFactor * 0.1
    );
  }
  const physics = getInterceptorSpec(battery.interceptorSpecId)?.gameplayPhysics;
  const roleConfidence = ROLE_CONFIDENCE[category]?.[target.type] ?? 0.4;
  const trackFactor = clamp01(track.trackQuality ?? 0);
  const energyFactor = clamp01((interceptSolution.energyReserveRatio - 1) / 1.25);
  const rangeFactor = clamp01(interceptSolution.rangeReserveRatio / 0.38);
  const interceptDistanceKm = interceptSolution.interceptDistanceKm ?? 0;
  const distanceFactor = clamp01(1 - interceptDistanceKm / Math.max(getMaximumRangeKm(battery), 1));
  const targetSpeedKmh = track.reportedSpeedKmh ?? target.speedKmh ?? 0;
  const speedFactor = clamp01(1 - targetSpeedKmh / Math.max((physics?.maxSpeedKmh ?? 1) * 1.8, 1));
  const targetAltitudeM = track.reportedPosition?.alt
    ?? track.reportedPosition?.altitudeM
    ?? target.altitudeM
    ?? 0;
  const launcherAltitudeM = battery.components?.launchers?.[0]?.altitudeM ?? 0;
  const climbDemandM = Math.max(0, targetAltitudeM - launcherAltitudeM);
  const altitudeFactor = clamp01(1 - climbDemandM / 35_000 * 0.65);
  const predictedTimeSec = interceptSolution.predictedInterceptTimeSec ?? 0;
  const timeFactor = Number.isFinite(interceptSolution.timeMarginSec)
    ? clamp01(interceptSolution.timeMarginSec / Math.max(20, predictedTimeSec + 25))
    : 0.8;
  const feasibilityFactor = interceptSolution.status === INTERCEPT_FEASIBILITY.VALID ? 1 : 0.48;
  return clamp01(
    roleConfidence * 0.16
    + trackFactor * 0.15
    + energyFactor * 0.18
    + rangeFactor * 0.12
    + distanceFactor * 0.1
    + speedFactor * 0.1
    + altitudeFactor * 0.08
    + timeFactor * 0.07
    + feasibilityFactor * 0.04
  );
};

export const getInterceptSolutionState = (interceptSolution, interceptProbability) => {
  if (
    !interceptSolution
    || interceptSolution.status === INTERCEPT_FEASIBILITY.NO_SOLUTION
  ) return INTERCEPT_SOLUTION_STATE.NO_SOLUTION;
  return interceptProbability >= 0.52
    ? INTERCEPT_SOLUTION_STATE.READY
    : INTERCEPT_SOLUTION_STATE.LOW_CHANCE;
};

const getBetterLayerOpportunity = ({ battery, track, target, allBatteries, interceptSolution }) => {
  const currentTier = getRolePriorityTier(battery, target);
  const targetSpeedKmh = track.reportedSpeedKmh ?? target.speedKmh;
  const targetEtaSec = getTargetEtaSec(target);
  return allBatteries
    .filter(other => (
      other.id !== battery.id
      && batteryCanPlanForTarget(other, target)
      && getRolePriorityTier(other, target) < currentTier
    ))
    .map(other => {
      const distanceToZoneKm = getRouteDistanceToZoneKm({
        target,
        track,
        center: getBatteryZoneCenter(other),
        radiusKm: getPreferredEngagementRangeKm(other, target),
      });
      const timeToZoneSec = distanceToZoneKm / Math.max(targetSpeedKmh, 1) * 3600;
      const zoneCrossingSec = other.weaponType === WEAPON_SYSTEM_TYPE.GUN_AA
        ? getPreferredEngagementRangeKm(other, target) * 2 / Math.max(targetSpeedKmh, 1) * 3600
        : 0;
      const waitForLayerSec = timeToZoneSec + zoneCrossingSec;
      const backupTimeRequiredSec = (interceptSolution.predictedInterceptTimeSec ?? 0) + 12;
      return {
        battery: other,
        distanceToZoneKm,
        waitForLayerSec,
        safeToDefer: Number.isFinite(distanceToZoneKm)
          && targetEtaSec - waitForLayerSec > backupTimeRequiredSec,
      };
    })
    .filter(opportunity => opportunity.safeToDefer)
    .sort((first, second) => first.waitForLayerSec - second.waitForLayerSec)[0] ?? null;
};

export function planAutomaticEngagement({
  battery,
  track,
  target,
  threat,
  allBatteries,
}) {
  const interceptSolution = threat.interceptSolution;
  const interceptProbability = calculateInterceptProbability({
    battery,
    track,
    target,
    interceptSolution,
  });
  const interceptSolutionState = getInterceptSolutionState(
    interceptSolution,
    interceptProbability,
  );
  const preferredRangeKm = getPreferredEngagementRangeKm(battery, target);
  const launchOrigin = getBatteryZoneCenter(battery);
  const reportedTargetPosition = track?.reportedPosition ?? target.position;
  const currentTargetDistanceKm = launchOrigin && reportedTargetPosition
    ? getDistanceKm(
      launchOrigin.lat,
      launchOrigin.lng,
      reportedTargetPosition.lat,
      reportedTargetPosition.lng,
    )
    : threat.distanceKm;
  const maximumAutomaticRangeKm = preferredRangeKm
    * (MAXIMUM_AUTOMATIC_RANGE_RATIO[getBatteryCategory(battery)] ?? 1.1);
  const interceptDistanceKm = interceptSolution.interceptDistanceKm
    ?? interceptSolution.distanceKm
    ?? threat.distanceKm;
  const predictedInterceptTimeSec = interceptSolution.predictedInterceptTimeSec
    ?? interceptSolution.projectileFlightTimeSec
    ?? 0;
  const timeToTargetSec = threat.etaSec;
  const timing = {
    timeToInterceptSec: predictedInterceptTimeSec,
    timeToTargetSec,
  };
  const launchUrgent = timeToTargetSec <= predictedInterceptTimeSec + 28;

  if (interceptSolutionState === INTERCEPT_SOLUTION_STATE.NO_SOLUTION) {
    return {
      decision: AUTO_ENGAGEMENT_DECISION.NO_SOLUTION,
      reason: interceptSolution?.reason ?? 'NO_INTERCEPT_SOLUTION',
      successConfidence: 0,
      interceptProbability: 0,
      interceptSolutionState,
      preferredRangeKm,
      currentTargetDistanceKm,
      maximumAutomaticRangeKm,
      interceptDistanceKm,
      optimalLaunchDelaySec: null,
      deferredToBatteryId: null,
      ...timing,
    };
  }

  if (
    Number.isFinite(timeToTargetSec)
    && timeToTargetSec <= predictedInterceptTimeSec
  ) {
    return {
      decision: AUTO_ENGAGEMENT_DECISION.NO_SOLUTION,
      reason: 'INTERCEPT_TIME_EXCEEDS_TARGET_TIME',
      successConfidence: 0,
      interceptProbability: 0,
      interceptSolutionState: INTERCEPT_SOLUTION_STATE.NO_SOLUTION,
      preferredRangeKm,
      currentTargetDistanceKm,
      maximumAutomaticRangeKm,
      interceptDistanceKm,
      optimalLaunchDelaySec: null,
      deferredToBatteryId: null,
      ...timing,
    };
  }

  if (
    battery.weaponType !== WEAPON_SYSTEM_TYPE.GUN_AA
    && currentTargetDistanceKm > maximumAutomaticRangeKm
  ) {
    const distanceToWindowKm = currentTargetDistanceKm - maximumAutomaticRangeKm;
    const closingSpeedKmh = Math.max(track.reportedSpeedKmh ?? target.speedKmh, 1);
    return {
      decision: AUTO_ENGAGEMENT_DECISION.HOLD_OPTIMAL_WINDOW,
      reason: 'TARGET_OUTSIDE_AUTOMATIC_LAUNCH_ENVELOPE',
      successConfidence: interceptProbability,
      interceptProbability,
      interceptSolutionState,
      preferredRangeKm,
      currentTargetDistanceKm,
      maximumAutomaticRangeKm,
      interceptDistanceKm,
      optimalLaunchDelaySec: distanceToWindowKm / closingSpeedKmh * 3600,
      deferredToBatteryId: null,
      ...timing,
    };
  }

  const betterLayer = battery.weaponType === WEAPON_SYSTEM_TYPE.GUN_AA
    ? null
    : getBetterLayerOpportunity({
      battery,
      track,
      target,
      allBatteries,
      interceptSolution,
    });
  if (betterLayer && !launchUrgent) {
    return {
      decision: AUTO_ENGAGEMENT_DECISION.DEFER_TO_BETTER_LAYER,
      reason: `LAYER_${betterLayer.battery.id}`,
      successConfidence: interceptProbability,
      interceptProbability,
      interceptSolutionState,
      preferredRangeKm,
      currentTargetDistanceKm,
      maximumAutomaticRangeKm,
      interceptDistanceKm,
      optimalLaunchDelaySec: betterLayer.waitForLayerSec,
      deferredToBatteryId: betterLayer.battery.id,
      ...timing,
    };
  }

  if (
    battery.weaponType !== WEAPON_SYSTEM_TYPE.GUN_AA
    && currentTargetDistanceKm > preferredRangeKm
    && !launchUrgent
  ) {
    const distanceToWindowKm = Math.max(0, currentTargetDistanceKm - preferredRangeKm);
    const closingSpeedKmh = Math.max(track.reportedSpeedKmh ?? target.speedKmh, 1);
    return {
      decision: AUTO_ENGAGEMENT_DECISION.HOLD_OPTIMAL_WINDOW,
      reason: 'TARGET_OUTSIDE_PREFERRED_ENVELOPE',
      successConfidence: interceptProbability,
      interceptProbability,
      interceptSolutionState,
      preferredRangeKm,
      currentTargetDistanceKm,
      maximumAutomaticRangeKm,
      interceptDistanceKm,
      optimalLaunchDelaySec: distanceToWindowKm / closingSpeedKmh * 3600,
      deferredToBatteryId: null,
      ...timing,
    };
  }

  const minimumProbability = launchUrgent ? 0.3 : 0.52;
  if (interceptProbability < minimumProbability) {
    return {
      decision: AUTO_ENGAGEMENT_DECISION.HOLD_LOW_CONFIDENCE,
      reason: 'INSUFFICIENT_KINEMATIC_CONFIDENCE',
      successConfidence: interceptProbability,
      interceptProbability,
      interceptSolutionState: INTERCEPT_SOLUTION_STATE.LOW_CHANCE,
      preferredRangeKm,
      currentTargetDistanceKm,
      maximumAutomaticRangeKm,
      interceptDistanceKm,
      optimalLaunchDelaySec: null,
      deferredToBatteryId: null,
      ...timing,
    };
  }

  const minimumSafeTimeMarginSec = Math.max(5, predictedInterceptTimeSec * 0.08);
  if (
    Number.isFinite(timeToTargetSec)
    && timeToTargetSec - predictedInterceptTimeSec < minimumSafeTimeMarginSec
  ) {
    return {
      decision: AUTO_ENGAGEMENT_DECISION.HOLD_LOW_CONFIDENCE,
      reason: 'INSUFFICIENT_TIME_MARGIN',
      successConfidence: interceptProbability,
      interceptProbability,
      interceptSolutionState: INTERCEPT_SOLUTION_STATE.LOW_CHANCE,
      preferredRangeKm,
      currentTargetDistanceKm,
      maximumAutomaticRangeKm,
      interceptDistanceKm,
      optimalLaunchDelaySec: null,
      deferredToBatteryId: null,
      ...timing,
    };
  }

  return {
    decision: AUTO_ENGAGEMENT_DECISION.ENGAGE,
    reason: launchUrgent ? 'LAST_SAFE_LAUNCH_WINDOW' : 'OPTIMAL_ENGAGEMENT_WINDOW',
    successConfidence: interceptProbability,
    interceptProbability,
    interceptSolutionState,
    preferredRangeKm,
    currentTargetDistanceKm,
    maximumAutomaticRangeKm,
    interceptDistanceKm,
    optimalLaunchDelaySec: 0,
    deferredToBatteryId: null,
    ...timing,
  };
}
