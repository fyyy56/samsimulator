import assert from 'node:assert/strict';
import { WEAPON_SYSTEM_TYPE } from '../src/data/gunSystems.js';
import {
  AUTO_ENGAGEMENT_DECISION,
  buildTargetDefenseAssessments,
  calculateInterceptProbability,
  planAutomaticEngagement,
} from '../src/store/autoEngagementPlanner.js';
import { SIMPLE_TARGET_TYPE } from '../src/store/scenarios.js';

const launcher = (id, lat, lng) => ({ id, lat, lng, operational: true, ready: true, heading: 0 });
const battery = ({ id, category, lat, lng, interceptorSpecId, weaponType = WEAPON_SYSTEM_TYPE.MISSILE }) => ({
  id,
  category,
  type: id,
  interceptorSpecId,
  weaponType,
  gunSpecId: weaponType === WEAPON_SYSTEM_TYPE.GUN_AA ? 'GEPARD_1A2' : null,
  missilesLeft: weaponType === WEAPON_SYSTEM_TYPE.GUN_AA ? 640 : 8,
  controlMode: 'AUTO',
  components: {
    radar: { lat, lng },
    launchers: [launcher(`${id}-L1`, lat, lng)],
  },
});

const patriot = battery({ id: 'PATRIOT-01', category: 'LONG', lat: 49, lng: 30, interceptorSpecId: 'INT-LONG-V1' });
const nasams = battery({ id: 'NASAMS-01', category: 'MEDIUM', lat: 49, lng: 30, interceptorSpecId: 'INT-MEDIUM-V1' });
const iris = battery({ id: 'IRIS-01', category: 'SHORT', lat: 49, lng: 30, interceptorSpecId: 'INT-SHORT-V1' });
const gepard = battery({ id: 'GEPARD-01', category: 'GUN', lat: 49.35, lng: 30, weaponType: WEAPON_SYSTEM_TYPE.GUN_AA });

const target = (type, speedKmh = 800) => ({
  id: `TARGET-${type}`,
  type,
  speedKmh,
  position: { lat: 49, lng: 30 },
  route: [{ lat: 50, lng: 30 }],
  waypointIndex: 0,
});
const track = targetEntity => ({
  id: `TRK-${targetEntity.id}`,
  targetId: targetEntity.id,
  reportedPosition: { ...targetEntity.position },
  reportedSpeedKmh: targetEntity.speedKmh,
  reportedHeading: 0,
  trackQuality: 0.9,
});
const threat = (interceptDistanceKm) => ({
  score: 80,
  distanceKm: interceptDistanceKm,
  etaSec: 420,
  interceptSolution: {
    status: 'VALID',
    interceptDistanceKm,
    predictedInterceptTimeSec: 45,
    energyReserveRatio: 2,
    rangeReserveRatio: 0.3,
  },
});

const ballistic = {
  ...target(SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE, 5_500),
  position: { lat: 49, lng: 31.45 },
};
const farBallisticPlan = planAutomaticEngagement({
  battery: patriot,
  track: track(ballistic),
  target: ballistic,
  threat: threat(105),
  allBatteries: [patriot],
});
assert.equal(farBallisticPlan.decision, AUTO_ENGAGEMENT_DECISION.HOLD_OPTIMAL_WINDOW);

const impossiblePlan = planAutomaticEngagement({
  battery: patriot,
  track: track(ballistic),
  target: ballistic,
  threat: {
    ...threat(70),
    interceptSolution: { status: 'NO_SOLUTION', reason: 'KINEMATICALLY_UNREACHABLE' },
  },
  allBatteries: [patriot],
});
assert.equal(impossiblePlan.decision, AUTO_ENGAGEMENT_DECISION.NO_SOLUTION);
assert.equal(impossiblePlan.interceptProbability, 0);

const cruise = target(SIMPLE_TARGET_TYPE.CRUISE_MISSILE, 800);
const nasamsPlan = planAutomaticEngagement({
  battery: nasams,
  track: track(cruise),
  target: cruise,
  threat: threat(45),
  allBatteries: [nasams],
});
assert.equal(nasamsPlan.decision, AUTO_ENGAGEMENT_DECISION.ENGAGE);

const layeredIrisPlan = planAutomaticEngagement({
  battery: iris,
  track: track(cruise),
  target: cruise,
  threat: threat(20),
  allBatteries: [iris, gepard],
});
assert.equal(layeredIrisPlan.decision, AUTO_ENGAGEMENT_DECISION.DEFER_TO_BETTER_LAYER);
assert.equal(layeredIrisPlan.deferredToBatteryId, gepard.id);

const fallbackIrisPlan = planAutomaticEngagement({
  battery: iris,
  track: track(cruise),
  target: cruise,
  threat: threat(20),
  allBatteries: [iris],
});
assert.equal(fallbackIrisPlan.decision, AUTO_ENGAGEMENT_DECISION.ENGAGE);

const strongProbability = calculateInterceptProbability({
  battery: nasams,
  track: track(cruise),
  target: { ...cruise, altitudeM: 100 },
  interceptSolution: {
    ...threat(30).interceptSolution,
    timeMarginSec: 100,
  },
});
const weakProbability = calculateInterceptProbability({
  battery: nasams,
  track: { ...track(cruise), trackQuality: 0.3, reportedSpeedKmh: 2_200 },
  target: { ...cruise, speedKmh: 2_200, altitudeM: 18_000 },
  interceptSolution: {
    ...threat(75).interceptSolution,
    status: 'MARGINAL',
    energyReserveRatio: 1.04,
    rangeReserveRatio: 0.03,
    timeMarginSec: 3,
  },
});
assert.ok(strongProbability > weakProbability);

const assessments = buildTargetDefenseAssessments({
  targets: [cruise],
  tracks: [track(cruise)],
  batteries: [nasams, gepard],
  simulationTime: 100,
});
const assessment = assessments.get(cruise.id);
assert.equal(assessment.targetType, SIMPLE_TARGET_TYPE.CRUISE_MISSILE);
assert.ok(Number.isFinite(assessment.etaSec));
assert.ok(Number.isFinite(assessment.distanceToNearestEffectiveZoneKm));
assert.ok(Number.isFinite(assessment.timeToNearestEffectiveZoneSec));

console.log('Auto-engagement planner checks passed.');
