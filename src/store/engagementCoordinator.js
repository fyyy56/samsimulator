import { getInterceptorSpec } from '../data/interceptors.js';
import { WEAPON_SYSTEM_TYPE } from '../data/gunSystems.js';
import {
  BATTERY_CONTROL_MODE,
  buildEngagementRegistry,
  getRolePriorityTier,
  rankThreatsForBattery,
} from './autoDefense.js';
import {
  AUTO_ENGAGEMENT_DECISION,
  getPreferredEngagementRangeKm,
  getRouteDistanceToZoneKm,
  planAutomaticEngagement,
} from './autoEngagementPlanner.js';
import { getBearing, getDistanceKm } from './geo.js';
import { isTargetInRadarCoverage } from './radarSystem.js';
import { SIMPLE_TARGET_TYPE } from './scenarios.js';
import { TRACK_STATE } from './trackSystem.js';
import { createFireControlTargetEstimate } from './trackDataProvider.js';

export const ENGAGEMENT_COORDINATION_STATE = Object.freeze({
  UNASSIGNED: 'UNASSIGNED', EVALUATING: 'EVALUATING', RESERVED: 'RESERVED', ENGAGED: 'ENGAGED',
  ASSESSING: 'ASSESSING', MISS: 'MISS', DEGRADED: 'DEGRADED', REENGAGE_REQUIRED: 'REENGAGE_REQUIRED',
  KILLED: 'KILLED', IMPACTED: 'IMPACTED',
});

export const ENGAGEMENT_WINDOW = Object.freeze({
  TOO_EARLY: 'TOO_EARLY', WAIT: 'WAIT', GOOD_WINDOW: 'GOOD_WINDOW', LATE: 'LATE', LAST_CHANCE: 'LAST_CHANCE',
});

export const ENGAGEMENT_REASON = Object.freeze({
  GOOD_WINDOW: 'GOOD_WINDOW', TARGET_ALREADY_ENGAGED: 'TARGET_ALREADY_ENGAGED',
  WAITING_FOR_ASSESSMENT: 'WAITING_FOR_ASSESSMENT', WAITING_FOR_TRACK_CONFIRMATION: 'WAITING_FOR_TRACK_CONFIRMATION',
  EXPECTED_QUALITY_IMPROVING: 'EXPECTED_QUALITY_IMPROVING', CHEAPER_WEAPON_AVAILABLE: 'CHEAPER_WEAPON_AVAILABLE',
  CAPACITY_REACHED: 'CAPACITY_REACHED', EXPENSIVE: 'EXPENSIVE', ROLE_MISMATCH: 'ROLE_MISMATCH',
  OUT_OF_REACH: 'OUT_OF_REACH', POOR_GEOMETRY: 'POOR_GEOMETRY',
  INSUFFICIENT_ENERGY_RESERVE: 'INSUFFICIENT_ENERGY_RESERVE', TOO_EARLY: 'TOO_EARLY',
  LAST_CHANCE: 'LAST_CHANCE', REENGAGE_REQUIRED: 'REENGAGE_REQUIRED', NO_SOLUTION: 'NO_SOLUTION',
});

export const FIRE_CONTROL_CAPABILITY = Object.freeze({
  SHARED_TRACKS: 'SHARED_TRACKS', ENGAGEMENT_RESERVATION: 'ENGAGEMENT_RESERVATION',
  CROSS_BATTERY_REASSIGNMENT: 'CROSS_BATTERY_REASSIGNMENT', RESOURCE_OPTIMIZATION: 'RESOURCE_OPTIMIZATION',
  PREDICTIVE_WINDOWS: 'PREDICTIVE_WINDOWS', AUTO_FIRE: 'AUTO_FIRE',
});

export const DEFAULT_COORDINATOR_CAPABILITIES = Object.freeze({
  SHARED_TRACKS: true, ENGAGEMENT_RESERVATION: true, CROSS_BATTERY_REASSIGNMENT: true,
  RESOURCE_OPTIMIZATION: true, PREDICTIVE_WINDOWS: true, AUTO_FIRE: true,
  sharedTracks: true, coordinatedEngagements: true, crossBatteryReassignment: true,
  resourceOptimization: true, predictiveWindows: true, automaticFire: true,
});

export const SYSTEM_ENGAGEMENT_CAPACITY = Object.freeze({
  GUN: 1, GAZ: 1, SHORT: 2, MEDIUM: 3, SAMP_T: 4, LONG: 4, DEFAULT: 2,
});

export const COORDINATOR_WEAPON_PROFILES = Object.freeze({
  GUN: Object.freeze({ costWeight: 0.08, scarcityWeight: 0.1, maneuverReserve: 1 }),
  'INT-SHORT-V1': Object.freeze({ costWeight: 0.48, scarcityWeight: 0.45, maneuverReserve: 1.16 }),
  'INT-MEDIUM-V1': Object.freeze({ costWeight: 0.62, scarcityWeight: 0.58, maneuverReserve: 1.2 }),
  'INT-ASTER30-V1': Object.freeze({ costWeight: 0.86, scarcityWeight: 0.78, maneuverReserve: 1.22 }),
  'INT-LONG-V1': Object.freeze({ costWeight: 1, scarcityWeight: 0.92, maneuverReserve: 1.25 }),
  DEFAULT: Object.freeze({ costWeight: 0.7, scarcityWeight: 0.65, maneuverReserve: 1.2 }),
});

const clamp01 = value => Math.max(0, Math.min(1, value));
const normalizeAngle = angle => ((angle + 540) % 360) - 180;
const enabled = (capabilities, currentName, legacyName) => capabilities?.[currentName] ?? capabilities?.[legacyName] ?? true;
const getCapacity = battery => battery.maxSimultaneousEngagements
  ?? SYSTEM_ENGAGEMENT_CAPACITY[battery.category] ?? SYSTEM_ENGAGEMENT_CAPACITY.DEFAULT;
const getWeaponProfile = battery => battery.weaponType === WEAPON_SYSTEM_TYPE.GUN_AA
  ? COORDINATOR_WEAPON_PROFILES.GUN
  : COORDINATOR_WEAPON_PROFILES[battery.interceptorSpecId] ?? COORDINATOR_WEAPON_PROFILES.DEFAULT;
const getWeaponName = battery => battery.weaponType === WEAPON_SYSTEM_TYPE.GUN_AA
  ? (battery.gunSpecId ?? 'GUN')
  : (getInterceptorSpec(battery.interceptorSpecId)?.publicDisplay?.displayName ?? battery.interceptorSpecId);
const getBatteryOrigin = battery => battery.components?.launchers?.[0] ?? battery.components?.radar ?? null;

export const getCoordinatorTargetClass = target => {
  if (target?.type === SIMPLE_TARGET_TYPE.UAV) {
    return target.decoy || String(target.modelId ?? '').toUpperCase().includes('GERBERA') ? 'DECOY' : 'UAV';
  }
  if (target?.type === SIMPLE_TARGET_TYPE.CRUISE_MISSILE) return 'CRUISE';
  if (target?.type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE) return 'BALLISTIC';
  return 'OTHER';
};

const getDoctrineTier = (battery, target) => {
  const targetClass = getCoordinatorTargetClass(target);
  if (targetClass === 'BALLISTIC') return battery.category === 'LONG' ? 0 : battery.category === 'SAMP_T' ? 1 : 9;
  if (targetClass === 'CRUISE') {
    if (battery.category === 'MEDIUM') return 0;
    if (battery.category === 'SHORT') return 1;
    if (battery.category === 'SAMP_T') return 2;
    if (battery.category === 'LONG') return 3;
    return 4;
  }
  if (['UAV', 'DECOY'].includes(targetClass)) {
    if (battery.weaponType === WEAPON_SYSTEM_TYPE.GUN_AA) return 0;
    if (battery.category === 'SHORT') return 1;
    if (battery.category === 'MEDIUM') return 2;
    return 4;
  }
  return getRolePriorityTier(battery, target);
};

const supportsTarget = (battery, target) => getCoordinatorTargetClass(target) !== 'BALLISTIC'
  || battery.category === 'LONG' || battery.category === 'SAMP_T';
const available = battery => Boolean(battery && battery.controlMode !== BATTERY_CONTROL_MODE.HOLD
  && battery.missilesLeft > 0 && battery.components?.radar?.operational !== false
  && battery.components?.launchers?.some(launcher => launcher.operational !== false));
const viableMissile = missile => !['MISSED', 'SELF_DESTRUCT', 'DESTROYED'].includes(missile.lifecycleState)
  && missile.guidanceState !== 'INTERCEPT_LOST' && missile.interceptSolutionStatus !== 'INVALID'
  && (missile.interceptQuality == null || missile.interceptQuality >= 0.18)
  && (missile.predictedClosestApproachM == null || missile.predictedClosestApproachM <= 2_500);
const missileHealth = missile => {
  if (!viableMissile(missile)) return 'LOST';
  if ((missile.interceptQuality ?? 1) < 0.45 || (missile.predictedClosestApproachM ?? 0) > 800
    || (missile.energyFraction ?? 1) < 0.18) return 'DEGRADED';
  return 'GOOD';
};

const buildActiveByTrack = ({ missiles, pendingLaunches, launchQueue, gunEngagements }) => {
  const result = new Map();
  const add = (trackId, entry) => trackId && result.set(trackId, [...(result.get(trackId) ?? []), entry]);
  launchQueue.forEach(item => add(item.trackId, { ...item, id: item.missileId, batteryId: item.sourceBatteryId, stage: 'RESERVED', viable: true, health: 'GOOD' }));
  pendingLaunches.forEach(item => add(item.trackId, { ...item, id: item.missileId, batteryId: item.sourceBatteryId, stage: 'RESERVED', viable: true, health: 'GOOD' }));
  gunEngagements.forEach(item => add(item.trackId, { ...item, batteryId: item.batteryId, stage: 'ENGAGED', viable: true, health: 'GOOD' }));
  missiles.forEach(item => add(item.trackId, {
    ...item, batteryId: item.sourceBatteryId, stage: item.lifecycleState === 'IMPACT' ? 'ASSESSING' : 'ENGAGED',
    viable: viableMissile(item), health: missileHealth(item), quality: item.interceptQuality,
  }));
  return result;
};

const trackEstimate = (track, target, simulationTime) => (
  createFireControlTargetEstimate(track, target, simulationTime)
);

const selectLauncher = (battery, track) => (battery.components?.launchers ?? [])
  .filter(launcher => launcher.operational !== false && launcher.ready !== false)
  .map(launcher => {
    const bearing = getBearing(launcher.lat, launcher.lng, track.reportedPosition.lat, track.reportedPosition.lng);
    return {
      launcher,
      courseChangeDeg: Math.abs(normalizeAngle(bearing - (launcher.heading ?? bearing))),
      distanceKm: getDistanceKm(launcher.lat, launcher.lng, track.reportedPosition.lat, track.reportedPosition.lng),
    };
  })
  .sort((a, b) => a.courseChangeDeg - b.courseChangeDeg || a.distanceKm - b.distanceKm)[0] ?? null;

const futureGunWindow = ({ battery, track, target }) => {
  if (battery.weaponType !== WEAPON_SYSTEM_TYPE.GUN_AA) return null;
  const distanceToZoneKm = getRouteDistanceToZoneKm({
    target, track, center: getBatteryOrigin(battery), radiusKm: getPreferredEngagementRangeKm(battery, target),
  });
  if (!Number.isFinite(distanceToZoneKm)) return null;
  return { distanceToZoneKm, timeToZoneSec: distanceToZoneKm / Math.max(track.reportedSpeedKmh ?? target.speedKmh ?? 1, 1) * 3600 };
};

const forecastWindow = ({ battery, target, track, plan, threat, capabilities }) => {
  const currentQuality = clamp01(plan.interceptProbability ?? plan.successConfidence ?? 0);
  const targetEtaSec = plan.timeToTargetSec ?? target.defenseAssessment?.etaSec ?? Infinity;
  const interceptTimeSec = plan.timeToInterceptSec ?? threat?.interceptSolution?.estimatedTimeSec ?? Infinity;
  const energyReserve = threat?.interceptSolution?.energyReserveRatio ?? (battery.weaponType === WEAPON_SYSTEM_TYPE.GUN_AA ? 1 : 0);
  const requiredReserve = getWeaponProfile(battery).maneuverReserve;
  const trackPenalty = Math.min(0.18, (target.trackData.updateAgeSec ?? 0) * 0.025)
    + Math.max(0, 0.55 - (track.trackQuality ?? 0)) * 0.28;
  const maneuverPenalty = Math.min(0.16, Math.abs(track.estimatedTurnRateDegPerSec ?? 0) / 80);
  const improving = plan.decision === AUTO_ENGAGEMENT_DECISION.HOLD_OPTIMAL_WINDOW
    || plan.reason === 'TARGET_OUTSIDE_PREFERRED_RANGE' || plan.reason === 'WAIT_FOR_CONFIDENT_SOLUTION';
  const expectedQuality = enabled(capabilities, 'PREDICTIVE_WINDOWS', 'predictiveWindows')
    ? clamp01(currentQuality + (improving ? 0.22 : 0.04) - trackPenalty - maneuverPenalty)
    : currentQuality;
  const enoughEnergy = battery.weaponType === WEAPON_SYSTEM_TYPE.GUN_AA || energyReserve >= requiredReserve;
  const urgent = targetEtaSec <= interceptTimeSec + 28 || target.defenseAssessment?.etaSec <= 40;
  let window = ENGAGEMENT_WINDOW.TOO_EARLY;
  if (plan.decision === AUTO_ENGAGEMENT_DECISION.NO_SOLUTION) window = urgent ? ENGAGEMENT_WINDOW.LATE : ENGAGEMENT_WINDOW.TOO_EARLY;
  else if (urgent) window = ENGAGEMENT_WINDOW.LAST_CHANCE;
  else if (!enoughEnergy || expectedQuality >= currentQuality + 0.1 && targetEtaSec > interceptTimeSec + 45) window = ENGAGEMENT_WINDOW.WAIT;
  else if (plan.decision === AUTO_ENGAGEMENT_DECISION.ENGAGE && currentQuality >= 0.58) window = ENGAGEMENT_WINDOW.GOOD_WINDOW;
  return { window, currentQuality, expectedQuality, energyReserve, requiredReserve, enoughEnergy };
};

const scoreCandidate = candidate => {
  const { battery, target, threat, forecast, currentEngagements, launcherGeometry } = candidate;
  const profile = getWeaponProfile(battery);
  const ammoFactor = clamp01(battery.missilesLeft / Math.max(1, battery.ammoCapacity ?? battery.missilesLeft));
  return forecast.currentQuality * 45 + forecast.expectedQuality * 16 + clamp01(forecast.energyReserve / 1.75) * 13
    + clamp01((threat?.interceptSolution?.timeMarginSec ?? 0) / 45) * 8 + ammoFactor * 7
    + Math.max(0, 5 - getDoctrineTier(battery, target)) * 8 + (threat?.score ?? 50) * 0.1
    - profile.costWeight * 8 - profile.scarcityWeight * (1 - ammoFactor) * 14
    - currentEngagements / Math.max(1, getCapacity(battery)) * 18 - launcherGeometry.courseChangeDeg * 0.035;
};

const signatureFor = ({ battery, launcherId, track, registry, currentEngagements }) => [
  Math.round(track.reportedPosition.lat * 1000), Math.round(track.reportedPosition.lng * 1000),
  Math.round((track.reportedPosition.alt ?? 0) / 100), Math.round((track.reportedSpeedKmh ?? 0) / 10),
  Math.round((track.trackQuality ?? 0) * 20), battery.missilesLeft, Math.round(battery.reloadRemainingSec ?? 0),
  registry.get(track.id)?.total ?? 0, currentEngagements, launcherId,
].join(':');

const debugCandidate = ({ battery, launcherId = null, quality = null, expectedQuality = null, score = null, decision = 'OUT', reason, window = null, energyReserve = null }) => ({
  batteryId: battery.id, system: battery.displayName ?? battery.type ?? battery.id, launcherId,
  weapon: getWeaponName(battery), quality, expectedQuality, score, decision, reason, window, energyReserve,
  currentEngagements: battery.currentEngagements ?? 0, maxSimultaneousEngagements: getCapacity(battery),
});

const assignment = ({ track, target, candidate, state, reason, fallback, active, candidates = [], previousState = null }) => ({
  trackId: track.id, targetId: target.id, targetClass: getCoordinatorTargetClass(target),
  threatScore: target.defenseAssessment?.threatScore ?? target.defenseAssessment?.priorityScore ?? null,
  threatLevel: target.defenseAssessment?.threatLevel ?? null, state, previousState,
  assignedBatteryId: candidate?.battery.id ?? active?.batteryId ?? null,
  assignedLauncherId: candidate?.launcherId ?? active?.launcherId ?? null,
  assignedSystem: candidate?.battery.displayName ?? candidate?.battery.type ?? active?.batteryId ?? null,
  assignedWeapon: candidate ? getWeaponName(candidate.battery) : active?.interceptorSpecId ?? null,
  quality: candidate?.forecast.currentQuality ?? active?.quality ?? null,
  expectedQuality: candidate?.forecast.expectedQuality ?? null,
  window: candidate?.forecast.window ?? (active ? ENGAGEMENT_WINDOW.GOOD_WINDOW : ENGAGEMENT_WINDOW.WAIT),
  reservation: candidate?.battery.id ?? active?.batteryId ?? null, currentInterceptorId: active?.id ?? null,
  assessment: active?.health === 'DEGRADED' ? 'DEGRADED' : active?.health === 'LOST' ? 'INVALID' : active ? 'VALID' : candidate?.plan?.decision ?? null,
  bestFallbackBatteryId: fallback?.battery.id ?? null, bestFallbackLauncherId: fallback?.launcherId ?? null,
  bestFallbackQuality: fallback?.forecast.currentQuality ?? null, reason, candidates,
  updatedAt: candidate?.simulationTime ?? null,
});

export function coordinateEngagements({
  targets, tracks, batteries, missiles = [], pendingLaunches = [], launchQueue = [], gunEngagements = [],
  previousAssignments = {}, simulationTime, capabilities = DEFAULT_COORDINATOR_CAPABILITIES,
  evaluationCursor = 0, evaluationBudget = 12, candidateCache = {},
}) {
  const startedAt = globalThis.performance?.now?.() ?? Date.now();
  const registry = buildEngagementRegistry({ missiles, pendingLaunches, launchQueue, gunEngagements });
  const activeByTrack = buildActiveByTrack({ missiles, pendingLaunches, launchQueue, gunEngagements });
  const tracksByTargetId = new Map(tracks.map(track => [track.targetId, track]));
  const assignments = {};
  const recommendations = new Map();
  const autoActions = [];
  let heavySolverCalls = 0;
  let cacheHits = 0;
  const nextCandidateCache = Object.fromEntries(Object.entries(candidateCache).filter(([, entry]) => entry.expiresAt >= simulationTime));
  const activeCounts = new Map(batteries.map(battery => [battery.id, 0]));
  for (const entries of activeByTrack.values()) for (const entry of entries) if (entry.viable) activeCounts.set(entry.batteryId, (activeCounts.get(entry.batteryId) ?? 0) + 1);
  const provisionalCounts = new Map(activeCounts);
  const capacityBatteries = batteries.map(battery => ({ ...battery, currentEngagements: activeCounts.get(battery.id) ?? 0, maxSimultaneousEngagements: getCapacity(battery) }));
  const orderedTargets = [...targets].sort((a, b) => (a.defenseAssessment?.etaSec ?? Infinity) - (b.defenseAssessment?.etaSec ?? Infinity) || a.id.localeCompare(b.id));
  const boundedBudget = Math.max(1, Math.min(evaluationBudget, orderedTargets.length || 1));
  const evaluatedIds = new Set(Array.from({ length: boundedBudget }, (_, offset) => orderedTargets[(evaluationCursor + offset) % Math.max(orderedTargets.length, 1)]?.id).filter(Boolean));

  orderedTargets.forEach(target => {
    const track = tracksByTargetId.get(target.id);
    if (!track || track.state === TRACK_STATE.LOST) return;
    const estimatedTarget = trackEstimate(track, target, simulationTime);
    const activeEntries = activeByTrack.get(track.id) ?? [];
    const active = activeEntries.find(entry => entry.viable);
    const previous = previousAssignments[track.id];
    const needsReengagement = enabled(capabilities, 'CROSS_BATTERY_REASSIGNMENT', 'crossBatteryReassignment')
      && activeEntries.length > 0 && activeEntries.every(entry => !entry.viable) && previous?.assignedBatteryId;
    if (!evaluatedIds.has(target.id)) {
      assignments[track.id] = previous ?? assignment({ track, target, state: ENGAGEMENT_COORDINATION_STATE.EVALUATING, reason: ENGAGEMENT_REASON.TOO_EARLY });
      return;
    }

    const debug = [];
    const cheap = [];
    capacityBatteries.forEach(battery => {
      const currentEngagements = provisionalCounts.get(battery.id) ?? 0;
      if (!available(battery)) return debug.push(debugCandidate({ battery, reason: battery.missilesLeft <= 0 ? 'NO_AMMO' : 'UNAVAILABLE' }));
      if (!supportsTarget(battery, estimatedTarget)) return debug.push(debugCandidate({ battery, reason: ENGAGEMENT_REASON.ROLE_MISMATCH }));
      if (!enabled(capabilities, 'SHARED_TRACKS', 'sharedTracks') && track.sourceBatteryId !== battery.id && !isTargetInRadarCoverage(battery, estimatedTarget)) {
        return debug.push(debugCandidate({ battery, reason: 'NO_SHARED_TRACK' }));
      }
      if (currentEngagements >= getCapacity(battery)) return debug.push(debugCandidate({ battery: { ...battery, currentEngagements }, reason: ENGAGEMENT_REASON.CAPACITY_REACHED }));
      const launcherGeometry = selectLauncher(battery, track);
      if (!launcherGeometry) return debug.push(debugCandidate({ battery, reason: 'NO_READY_LAUNCHER' }));
      return cheap.push({ battery, launcherGeometry, launcherId: launcherGeometry.launcher.id, distanceKm: launcherGeometry.distanceKm,
        futureGun: futureGunWindow({ battery, track, target: estimatedTarget }), currentEngagements });
    });

    const confirmed = [TRACK_STATE.TRACKED, TRACK_STATE.IDENTIFIED].includes(track.state)
      && (track.consecutiveUpdates ?? 3) >= 3 && (track.trackQuality ?? 0) >= 0.34;
    if (!confirmed) {
      cheap.forEach(candidate => debug.push(debugCandidate({ battery: candidate.battery, launcherId: candidate.launcherId, decision: 'HOLD', reason: ENGAGEMENT_REASON.WAITING_FOR_TRACK_CONFIRMATION, window: ENGAGEMENT_WINDOW.WAIT })));
      assignments[track.id] = assignment({ track, target, state: ENGAGEMENT_COORDINATION_STATE.EVALUATING, reason: ENGAGEMENT_REASON.WAITING_FOR_TRACK_CONFIRMATION, candidates: debug });
      return;
    }

    cheap.sort((a, b) => getDoctrineTier(a.battery, estimatedTarget) - getDoctrineTier(b.battery, estimatedTarget)
      || getWeaponProfile(a.battery).costWeight - getWeaponProfile(b.battery).costWeight
      || a.launcherGeometry.courseChangeDeg - b.launcherGeometry.courseChangeDeg || a.distanceKm - b.distanceKm);
    const shortlistLimit = active || needsReengagement ? 3 : 2;
    const shortlist = cheap.slice(0, shortlistLimit);
    cheap.slice(shortlistLimit).forEach(candidate => debug.push(debugCandidate({ battery: candidate.battery, launcherId: candidate.launcherId, decision: 'HOLD', reason: getWeaponProfile(candidate.battery).costWeight > 0.8 ? ENGAGEMENT_REASON.EXPENSIVE : 'LOWER_PRIORITY' })));
    const candidates = [];
    shortlist.forEach(shortlisted => {
      const batteryForLauncher = { ...shortlisted.battery, components: { ...shortlisted.battery.components, launchers: [shortlisted.launcherGeometry.launcher] } };
      const key = `${shortlisted.battery.id}:${shortlisted.launcherId}:${track.id}`;
      const signature = signatureFor({ battery: shortlisted.battery, launcherId: shortlisted.launcherId, track, registry, currentEngagements: shortlisted.currentEngagements });
      const cached = nextCandidateCache[key];
      let threat = cached?.signature === signature ? cached.threat : null;
      let plan = cached?.signature === signature ? cached.plan : null;
      if (cached?.signature === signature) cacheHits += 1;
      else {
        threat = rankThreatsForBattery({ battery: batteryForLauncher, tracks: [track], targets: [estimatedTarget], registry })[0] ?? null;
        heavySolverCalls += 1;
        if (threat) plan = planAutomaticEngagement({ battery: batteryForLauncher, track, target: estimatedTarget, threat, allBatteries: capacityBatteries });
        if (!threat && shortlisted.futureGun) plan = {
          decision: AUTO_ENGAGEMENT_DECISION.HOLD_OPTIMAL_WINDOW, reason: 'FUTURE_GUN_WINDOW', interceptProbability: 0.7,
          successConfidence: 0.7, timeToInterceptSec: shortlisted.futureGun.timeToZoneSec, timeToTargetSec: target.defenseAssessment?.etaSec,
        };
        nextCandidateCache[key] = { signature, expiresAt: simulationTime + 0.75, threat, plan, negative: !plan };
      }
      if (!plan || plan.decision === AUTO_ENGAGEMENT_DECISION.NO_SOLUTION) return debug.push(debugCandidate({ battery: shortlisted.battery, launcherId: shortlisted.launcherId, reason: ENGAGEMENT_REASON.NO_SOLUTION }));
      const forecast = forecastWindow({ battery: shortlisted.battery, target: estimatedTarget, track, plan, threat, capabilities });
      const candidate = { ...shortlisted, track, target: estimatedTarget, threat, plan, forecast, simulationTime };
      candidate.score = scoreCandidate(candidate);
      candidates.push(candidate);
    });

    candidates.sort((a, b) => b.score - a.score || a.battery.id.localeCompare(b.battery.id));
    const reassigned = needsReengagement ? candidates.filter(candidate => candidate.battery.id !== previous.assignedBatteryId) : candidates;
    const pool = reassigned.length ? reassigned : candidates;
    const targetEta = target.defenseAssessment?.etaSec ?? Infinity;
    const preferredGun = ['UAV', 'DECOY'].includes(getCoordinatorTargetClass(estimatedTarget))
      ? pool.find(candidate => candidate.battery.weaponType === WEAPON_SYSTEM_TYPE.GUN_AA && candidate.futureGun && targetEta > candidate.futureGun.timeToZoneSec + 18)
      : null;
    const optimize = enabled(capabilities, 'RESOURCE_OPTIMIZATION', 'resourceOptimization');
    const best = optimize && preferredGun ? preferredGun : pool[0] ?? null;
    const fallback = pool.find(candidate => candidate !== best) ?? null;
    if (!best) {
      assignments[track.id] = assignment({ track, target,
        state: needsReengagement ? ENGAGEMENT_COORDINATION_STATE.REENGAGE_REQUIRED : ENGAGEMENT_COORDINATION_STATE.UNASSIGNED,
        previousState: needsReengagement ? ENGAGEMENT_COORDINATION_STATE.MISS : previous?.state,
        reason: needsReengagement ? ENGAGEMENT_REASON.REENGAGE_REQUIRED : ENGAGEMENT_REASON.NO_SOLUTION, candidates: debug });
      return;
    }

    const activeGood = active?.health === 'GOOD';
    const activeDegraded = active?.health === 'DEGRADED';
    const canLaunch = !activeGood && best.plan.decision === AUTO_ENGAGEMENT_DECISION.ENGAGE
      && [ENGAGEMENT_WINDOW.GOOD_WINDOW, ENGAGEMENT_WINDOW.LAST_CHANCE].includes(best.forecast.window)
      && (best.forecast.enoughEnergy || best.forecast.window === ENGAGEMENT_WINDOW.LAST_CHANCE);
    const reason = activeGood ? ENGAGEMENT_REASON.TARGET_ALREADY_ENGAGED
      : activeDegraded ? ENGAGEMENT_REASON.WAITING_FOR_ASSESSMENT
      : needsReengagement ? ENGAGEMENT_REASON.REENGAGE_REQUIRED
      : best.forecast.window === ENGAGEMENT_WINDOW.LAST_CHANCE ? ENGAGEMENT_REASON.LAST_CHANCE
      : best.forecast.window === ENGAGEMENT_WINDOW.GOOD_WINDOW ? ENGAGEMENT_REASON.GOOD_WINDOW
      : !best.forecast.enoughEnergy ? ENGAGEMENT_REASON.INSUFFICIENT_ENERGY_RESERVE
      : best.forecast.expectedQuality >= best.forecast.currentQuality + 0.1 ? ENGAGEMENT_REASON.EXPECTED_QUALITY_IMPROVING
      : best.battery.weaponType === WEAPON_SYSTEM_TYPE.GUN_AA ? ENGAGEMENT_REASON.CHEAPER_WEAPON_AVAILABLE : ENGAGEMENT_REASON.TOO_EARLY;
    const state = activeGood ? (active.stage === 'ASSESSING' ? ENGAGEMENT_COORDINATION_STATE.ASSESSING : ENGAGEMENT_COORDINATION_STATE.ENGAGED)
      : activeDegraded ? ENGAGEMENT_COORDINATION_STATE.DEGRADED : ENGAGEMENT_COORDINATION_STATE.RESERVED;

    candidates.forEach(candidate => {
      const selected = candidate === best && !activeGood;
      const candidateReason = selected ? reason : activeGood ? ENGAGEMENT_REASON.TARGET_ALREADY_ENGAGED
        : candidate === fallback ? 'BEST_FALLBACK'
        : optimize && getWeaponProfile(candidate.battery).costWeight > getWeaponProfile(best.battery).costWeight ? ENGAGEMENT_REASON.EXPENSIVE : 'RESOURCE_POLICY';
      debug.push(debugCandidate({ battery: candidate.battery, launcherId: candidate.launcherId,
        quality: candidate.forecast.currentQuality, expectedQuality: candidate.forecast.expectedQuality, score: candidate.score,
        decision: selected ? (canLaunch ? 'SELECTED' : 'HOLD') : 'HOLD', reason: candidateReason,
        window: candidate.forecast.window, energyReserve: candidate.forecast.energyReserve }));
    });
    debug.sort((a, b) => Number(b.decision === 'SELECTED') - Number(a.decision === 'SELECTED') || (b.score ?? -Infinity) - (a.score ?? -Infinity));
    assignments[track.id] = assignment({ track, target, candidate: activeGood || activeDegraded ? null : best, active, fallback,
      state, previousState: needsReengagement ? ENGAGEMENT_COORDINATION_STATE.REENGAGE_REQUIRED : previous?.state, reason, candidates: debug });
    if (!activeGood && !activeDegraded) {
      provisionalCounts.set(best.battery.id, (provisionalCounts.get(best.battery.id) ?? 0) + 1);
      const existing = recommendations.get(best.battery.id);
      if (!existing || best.score > existing.score) recommendations.set(best.battery.id, best);
      if (canLaunch && enabled(capabilities, 'AUTO_FIRE', 'automaticFire') && best.battery.controlMode === BATTERY_CONTROL_MODE.AUTO) autoActions.push(best);
    }
  });

  return {
    assignments, recommendations,
    autoActions: autoActions.sort((a, b) => (a.plan.timeToTargetSec ?? Infinity) - (b.plan.timeToTargetSec ?? Infinity) || b.score - a.score),
    candidateCache: nextCandidateCache,
    batteryCapacity: Object.fromEntries(capacityBatteries.map(battery => [battery.id, { currentEngagements: activeCounts.get(battery.id) ?? 0, maxSimultaneousEngagements: getCapacity(battery) }])),
    metrics: { targetCount: targets.length, batteryCount: batteries.length, heavySolverCalls, cacheHits,
      calculationMs: (globalThis.performance?.now?.() ?? Date.now()) - startedAt,
      nextEvaluationCursor: orderedTargets.length ? (evaluationCursor + boundedBudget) % orderedTargets.length : 0 },
  };
}
