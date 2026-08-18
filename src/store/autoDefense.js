import { getDistanceKm } from './geo.js';
import { SIMPLE_TARGET_TYPE } from './scenarios.js';
import { TRACK_STATE } from './trackSystem.js';
import {
  evaluateBatteryInterceptFeasibility,
  INTERCEPT_FEASIBILITY,
} from './interceptFeasibility.js';
import { evaluateGunEngagement } from './gunAirDefense.js';
import { isTargetInRadarCoverage } from './radarSystem.js';
import { isRadarSensorOperational } from './sensorDetection.js';

export const BATTERY_CONTROL_MODE = Object.freeze({
  HOLD: 'HOLD',
  MANUAL: 'MANUAL',
  ASSIST: 'ASSIST',
  AUTO: 'AUTO',
});

export const DEFENSE_DOCTRINE = Object.freeze({
  CONSERVE: 'CONSERVE',
  BALANCED: 'BALANCED',
  AGGRESSIVE: 'AGGRESSIVE',
});

export const AUTO_DEFENSE_STATUS = Object.freeze({
  HOLDING: 'HOLDING',
  MANUAL: 'MANUAL',
  TRACKING: 'TRACKING',
  ENGAGING: 'ENGAGING',
  NO_TARGETS: 'NO_TARGETS',
  NO_AMMO: 'NO_AMMO',
});

export const DOCTRINE_CONFIG = Object.freeze({
  [DEFENSE_DOCTRINE.CONSERVE]: {
    minimumThreatScore: 62,
    ordinaryInterceptorLimit: 1,
    dangerousInterceptorLimit: 1,
    dangerousThreatScore: 92,
    reserveMissiles: 2,
    automaticTrackStates: Object.freeze([TRACK_STATE.IDENTIFIED]),
  },
  [DEFENSE_DOCTRINE.BALANCED]: {
    minimumThreatScore: 38,
    ordinaryInterceptorLimit: 1,
    dangerousInterceptorLimit: 2,
    dangerousThreatScore: 82,
    reserveMissiles: 0,
    automaticTrackStates: Object.freeze([TRACK_STATE.TRACKED, TRACK_STATE.IDENTIFIED]),
  },
  [DEFENSE_DOCTRINE.AGGRESSIVE]: {
    minimumThreatScore: 20,
    ordinaryInterceptorLimit: 2,
    dangerousInterceptorLimit: 2,
    dangerousThreatScore: 70,
    reserveMissiles: 0,
    automaticTrackStates: Object.freeze([TRACK_STATE.TRACKED, TRACK_STATE.IDENTIFIED]),
  },
});

const TARGET_TYPE_WEIGHT = Object.freeze({
  [SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE]: 1,
  [SIMPLE_TARGET_TYPE.CRUISE_MISSILE]: 0.78,
  [SIMPLE_TARGET_TYPE.UAV]: 0.46,
});

const TRACK_STATE_WEIGHT = Object.freeze({
  [TRACK_STATE.DETECTED]: 0.42,
  [TRACK_STATE.TRACKED]: 0.78,
  [TRACK_STATE.IDENTIFIED]: 1,
  [TRACK_STATE.LOST]: 0,
});

const clamp01 = value => Math.max(0, Math.min(1, value));

export const isPatriotBattery = battery => (
  battery?.category === 'LONG' || battery?.type?.toUpperCase().includes('PATRIOT')
);

export const isBallisticTarget = target => (
  target?.type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE
);

export const getRolePriorityTier = (battery, target) => {
  const category = battery?.category
    ?? (isPatriotBattery(battery) ? 'LONG' : null);
  if (category === 'GUN') {
    if (target?.type === SIMPLE_TARGET_TYPE.UAV) return 0;
    if (target?.type === SIMPLE_TARGET_TYPE.CRUISE_MISSILE) return 1;
    return 9;
  }
  if (category === 'MEDIUM') {
    if (target?.type === SIMPLE_TARGET_TYPE.CRUISE_MISSILE) return 0;
    if (target?.type === SIMPLE_TARGET_TYPE.UAV) return 2;
    return 3;
  }
  if (category === 'SHORT') {
    if (target?.type === SIMPLE_TARGET_TYPE.UAV) return 1;
    if (target?.type === SIMPLE_TARGET_TYPE.CRUISE_MISSILE) return 2;
    return 4;
  }
  if (isPatriotBattery(battery)) {
    if (isBallisticTarget(target)) return 0;
    if (target?.type === SIMPLE_TARGET_TYPE.CRUISE_MISSILE) return 3;
    return 4;
  }
  return isBallisticTarget(target) ? 4 : 2;
};

export function getRemainingRouteDistanceKm(target) {
  if (!target?.route?.length) return Number.POSITIVE_INFINITY;
  const waypoints = target.route.slice(target.waypointIndex);
  if (waypoints.length === 0) return 0;
  let distanceKm = getDistanceKm(
    target.position.lat,
    target.position.lng,
    waypoints[0].lat,
    waypoints[0].lng,
  );
  for (let index = 1; index < waypoints.length; index += 1) {
    distanceKm += getDistanceKm(
      waypoints[index - 1].lat,
      waypoints[index - 1].lng,
      waypoints[index].lat,
      waypoints[index].lng,
    );
  }
  return distanceKm;
}

export function getTargetEtaSec(target) {
  if (!target?.speedKmh) return Number.POSITIVE_INFINITY;
  return getRemainingRouteDistanceKm(target) / target.speedKmh * 3600;
}

export function buildEngagementRegistry({ missiles = [], pendingLaunches = [], launchQueue = [], gunEngagements = [] }) {
  const registry = new Map();
  const add = (engagement, stage) => {
    if (!engagement.trackId) return;
    const entry = registry.get(engagement.trackId) ?? {
      trackId: engagement.trackId,
      total: 0,
      missileTotal: 0,
      gunTotal: 0,
      batteryIds: new Set(),
      stages: { queued: 0, preparing: 0, inFlight: 0 },
    };
    const isGun = engagement.weaponType === 'GUN_AA' || engagement.id?.startsWith('GUN-');
    entry.total += 1;
    entry.missileTotal += isGun ? 0 : 1;
    entry.gunTotal += isGun ? 1 : 0;
    entry.batteryIds.add(engagement.sourceBatteryId);
    entry.stages[stage] += 1;
    registry.set(engagement.trackId, entry);
  };
  launchQueue.forEach(item => add(item, 'queued'));
  pendingLaunches.forEach(item => add(item, 'preparing'));
  missiles.forEach(item => add(item, 'inFlight'));
  gunEngagements.forEach(item => add({
    ...item,
    sourceBatteryId: item.batteryId,
    weaponType: 'GUN_AA',
  }, 'inFlight'));
  return registry;
}

export function getInterceptorEngagementPolicy(battery) {
  if (battery?.category === 'LONG' || isPatriotBattery(battery)) {
    return { maximumActiveInterceptors: 2, maximumAutomaticAttempts: 2 };
  }
  if (battery?.category === 'MEDIUM' || battery?.type?.includes('NASAMS')) {
    return {
      maximumActiveInterceptors: battery.doctrine === DEFENSE_DOCTRINE.AGGRESSIVE ? 2 : 1,
      maximumAutomaticAttempts: 2,
    };
  }
  if (battery?.category === 'SHORT' || battery?.type?.includes('IRIS')) {
    return { maximumActiveInterceptors: 1, maximumAutomaticAttempts: 1 };
  }
  return { maximumActiveInterceptors: 1, maximumAutomaticAttempts: 1 };
}

export function getInterceptorLimit(battery) {
  return getInterceptorEngagementPolicy(battery).maximumActiveInterceptors;
}

export function scoreTrackForBattery({ battery, track, target, registry }) {
  if (!battery?.components?.radar || !track || !target || track.state === TRACK_STATE.LOST) return null;
  if (!isRadarSensorOperational(battery)) return null;
  const hasSharedNetworkTrack = Boolean(
    track.sourceBatteryId && track.sourceBatteryId !== battery.id
  );
  const hasOwnRadarCoverage = isTargetInRadarCoverage(battery, target);
  if (!hasOwnRadarCoverage && !hasSharedNetworkTrack) return null;
  if (battery.weaponType === 'GUN_AA' && !hasOwnRadarCoverage) return null;
  const doctrine = DOCTRINE_CONFIG[battery.doctrine]
    ?? DOCTRINE_CONFIG[DEFENSE_DOCTRINE.BALANCED];
  if (
    (battery.controlMode === BATTERY_CONTROL_MODE.AUTO
      || battery.controlMode === BATTERY_CONTROL_MODE.ASSIST)
    && !doctrine.automaticTrackStates.includes(track.state)
  ) return null;
  const engagementOrigin = battery.components.launchers?.[0] ?? battery.components.radar;
  const radarDistanceKm = getDistanceKm(
    engagementOrigin.lat,
    engagementOrigin.lng,
    track.reportedPosition.lat,
    track.reportedPosition.lng,
  );
  if (!hasSharedNetworkTrack && radarDistanceKm > battery.radarRangeKm) return null;
  const interceptSolution = battery.weaponType === 'GUN_AA'
    ? evaluateGunEngagement({
      battery,
      track,
      target,
      simulationTime: battery.currentSimulationTime ?? 0,
    })
    : evaluateBatteryInterceptFeasibility({ battery, track, target });
  if (
    battery.weaponType === 'GUN_AA'
      ? !interceptSolution.ready
      : interceptSolution.status === INTERCEPT_FEASIBILITY.NO_SOLUTION
  ) return null;

  const etaSec = getTargetEtaSec(target);
  const etaUrgency = clamp01(1 - etaSec / 1500);
  const batteryProximity = clamp01(1 - radarDistanceKm / battery.radarRangeKm);
  const objectiveImportance = target.objectivePriority ?? 0.62;
  const typeWeight = TARGET_TYPE_WEIGHT[target.type] ?? 0.35;
  const stateWeight = TRACK_STATE_WEIGHT[track.state] ?? 0;
  const qualityWeight = clamp01(track.trackQuality ?? 0);
  const assignment = registry.get(track.id);
  const assignmentPenalty = assignment
    ? assignment.total * 18 + Math.max(0, assignment.batteryIds.size - 1) * 8
    : 0;
  const ammoCapacity = Math.max(1, battery.ammoCapacity ?? battery.missilesLeft);
  const ammoReadiness = clamp01(battery.missilesLeft / ammoCapacity);

  const score = (
    objectiveImportance * 22
    + etaUrgency * 25
    + batteryProximity * 15
    + typeWeight * 18
    + stateWeight * 8
    + qualityWeight * 8
    + ammoReadiness * 4
    - assignmentPenalty
  );
  return {
    trackId: track.id,
    targetId: target.id,
    batteryId: battery.id,
    score: Math.max(0, Math.round(score * 10) / 10),
    etaSec,
    distanceKm: radarDistanceKm,
    objectiveName: target.objectiveName,
    assignedInterceptors: assignment?.total ?? 0,
    assignedMissileInterceptors: assignment?.missileTotal ?? 0,
    rolePriorityTier: getRolePriorityTier(battery, target),
    interceptSolution,
  };
}

export function rankThreatsForBattery({ battery, tracks, targets, registry }) {
  const targetsById = new Map(targets.map(target => [target.id, target]));
  return tracks
    .map(track => {
      const target = targetsById.get(track.targetId);
      const threat = scoreTrackForBattery({ battery, track, target, registry });
      if (!threat) return null;
      const limit = getInterceptorLimit(battery);
      const assignedCount = battery.weaponType === 'GUN_AA'
        ? threat.assignedInterceptors
        : threat.assignedMissileInterceptors;
      return assignedCount < limit ? { ...threat, interceptorLimit: limit } : null;
    })
    .filter(Boolean)
    .sort((first, second) => (
      first.rolePriorityTier - second.rolePriorityTier
      || second.score - first.score
      || first.etaSec - second.etaSec
      || first.trackId.localeCompare(second.trackId)
    ));
}
