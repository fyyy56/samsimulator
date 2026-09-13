import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { WEAPON_SYSTEM_TYPE } from '../src/data/gunSystems.js';
import {
  coordinateEngagements,
  ENGAGEMENT_COORDINATION_STATE,
  ENGAGEMENT_WINDOW,
} from '../src/store/engagementCoordinator.js';
import { BATTERY_CONTROL_MODE, DEFENSE_DOCTRINE } from '../src/store/autoDefense.js';
import { SIMPLE_TARGET_TYPE } from '../src/store/scenarios.js';
import { TRACK_STATE } from '../src/store/trackSystem.js';

const objective = { lat: 50.45, lng: 30.52, altitudeM: 0 };
const makeTarget = (id, type, position, speedKmh = 750, altitudeM = 100) => ({
  id,
  type,
  position: { ...position, alt: altitudeM, altitudeM },
  worldPosition: { ...position, altitudeM },
  speedKmh,
  heading: 270,
  altitudeM,
  verticalSpeedMps: 0,
  route: [objective],
  waypointIndex: 0,
  objectiveName: 'Kyiv',
  objectivePriority: 0.9,
  defenseAssessment: {
    etaSec: Math.max(15, Math.abs(position.lng - objective.lng) * 82 * 3600 / speedKmh),
  },
});

const makeTrack = target => ({
  id: `TRK-${target.id}`,
  targetId: target.id,
  state: TRACK_STATE.IDENTIFIED,
  trackQuality: 0.96,
  sourceBatteryId: 'NETWORK-RADAR',
  reportedPosition: { ...target.position, alt: target.altitudeM },
  reportedSpeedKmh: target.speedKmh,
  reportedHeading: target.heading,
  identifiedType: target.type,
});

const makeBattery = (id, category, lat, lng) => {
  const profiles = {
    GUN: { type: 'Gepard 1A2', weaponType: WEAPON_SYSTEM_TYPE.GUN_AA, gunSpecId: 'GEPARD_1A2', interceptorSpecId: null, ammo: 640, range: 12 },
    SHORT: { type: 'IRIS-T SLM', interceptorSpecId: 'INT-SHORT-V1', ammo: 8, range: 40 },
    MEDIUM: { type: 'NASAMS', interceptorSpecId: 'INT-MEDIUM-V1', ammo: 8, range: 80 },
    SAMP_T: { type: 'SAMP/T', interceptorSpecId: 'INT-ASTER30-V1', ammo: 8, range: 80 },
    LONG: { type: 'PATRIOT', interceptorSpecId: 'INT-LONG-V1', ammo: 16, range: 150 },
  };
  const profile = profiles[category];
  const launcher = { id: `${id}-L1`, lat, lng, altitudeM: 0, operational: true, ready: true, heading: 0 };
  return {
    id,
    category,
    type: profile.type,
    displayName: profile.type,
    weaponType: profile.weaponType ?? WEAPON_SYSTEM_TYPE.MISSILE,
    gunSpecId: profile.gunSpecId ?? null,
    interceptorSpecId: profile.interceptorSpecId,
    missilesLeft: profile.ammo,
    ammoCapacity: profile.ammo,
    radarRangeKm: profile.range,
    gunNextBurstTime: 0,
    controlMode: BATTERY_CONTROL_MODE.AUTO,
    doctrine: DEFENSE_DOCTRINE.BALANCED,
    currentSimulationTime: 100,
    components: {
      radar: { id: `${id}-R`, lat, lng, operational: true },
      launchers: [launcher],
    },
  };
};

const run = ({ target, batteries, missiles = [], previousAssignments = {} }) => {
  const track = makeTrack(target);
  return {
    track,
    result: coordinateEngagements({
      targets: [target], tracks: [track], batteries, missiles,
      previousAssignments, simulationTime: 100,
    }),
  };
};

const defenses = [
  makeBattery('GEPARD-1', 'GUN', 50.45, 30.56),
  makeBattery('IRIS-1', 'SHORT', 50.45, 30.58),
  makeBattery('NASAMS-1', 'MEDIUM', 50.46, 30.6),
  makeBattery('ASTER-1', 'SAMP_T', 50.44, 30.59),
  makeBattery('PATRIOT-1', 'LONG', 50.43, 30.57),
];

// A: future Gepard layer reserves a UAV; expensive missiles hold.
const a = run({
  target: makeTarget('A', SIMPLE_TARGET_TYPE.UAV, { lat: 50.45, lng: 31.05 }, 250, 180),
  batteries: [defenses[0], defenses[1], defenses[3]],
});
assert.equal(a.result.assignments[a.track.id].assignedBatteryId, 'GEPARD-1');

// B: one cruise target creates one global reservation.
const b = run({
  target: makeTarget('B', SIMPLE_TARGET_TYPE.CRUISE_MISSILE, { lat: 50.45, lng: 30.9 }, 850, 110),
  batteries: [defenses[1], defenses[2], defenses[3]],
});
assert.equal(Object.keys(b.result.assignments).length, 1);
assert.ok(b.result.assignments[b.track.id].assignedBatteryId);

// C: a failed NASAMS engagement is reassigned to another system.
const failedMissile = {
  id: 'MSL-FAILED', trackId: b.track.id, sourceBatteryId: 'NASAMS-1',
  lifecycleState: 'MISSED', guidanceState: 'INTERCEPT_LOST', interceptQuality: 0,
};
const c = coordinateEngagements({
  targets: [makeTarget('B', SIMPLE_TARGET_TYPE.CRUISE_MISSILE, { lat: 50.45, lng: 30.9 }, 850, 110)],
  tracks: [b.track], batteries: [defenses[1], defenses[2], defenses[3]], missiles: [failedMissile],
  previousAssignments: { [b.track.id]: { state: ENGAGEMENT_COORDINATION_STATE.ENGAGED, assignedBatteryId: 'NASAMS-1' } },
  simulationTime: 101,
});
assert.notEqual(c.assignments[b.track.id].assignedBatteryId, 'NASAMS-1');
assert.equal(c.assignments[b.track.id].reason, 'REENGAGE_REQUIRED');

// D: an existing good interceptor blocks every new automatic action.
const dTarget = makeTarget('D', SIMPLE_TARGET_TYPE.CRUISE_MISSILE, { lat: 50.45, lng: 30.86 }, 800, 100);
const dTrack = makeTrack(dTarget);
const d = coordinateEngagements({
  targets: [dTarget], tracks: [dTrack], batteries: defenses,
  missiles: [{ id: 'MSL-GOOD', trackId: dTrack.id, sourceBatteryId: 'IRIS-1', lifecycleState: 'FLYING', interceptQuality: 0.82, predictedClosestApproachM: 40 }],
  simulationTime: 100,
});
assert.equal(d.assignments[dTrack.id].state, ENGAGEMENT_COORDINATION_STATE.ENGAGED);
assert.equal(d.autoActions.length, 0);

// E: with the gun unavailable and ETA short, a missile may enter LAST_CHANCE.
const emptyGepard = { ...defenses[0], missilesLeft: 0 };
const e = run({
  target: makeTarget('E', SIMPLE_TARGET_TYPE.UAV, { lat: 50.45, lng: 30.59 }, 650, 150),
  batteries: [emptyGepard, defenses[1], defenses[3]],
});
assert.notEqual(e.result.assignments[e.track.id].assignedBatteryId, 'GEPARD-1');
assert.equal(e.result.assignments[e.track.id].window, ENGAGEMENT_WINDOW.LAST_CHANCE);

// F: only ABM-capable gameplay classes are considered for a ballistic target.
const f = run({
  target: makeTarget('F', SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE, { lat: 50.45, lng: 31.15 }, 2_300, 20_000),
  batteries: defenses,
});
assert.ok(['ASTER-1', 'PATRIOT-1'].includes(f.result.assignments[f.track.id].assignedBatteryId));

// G: a mixed raid is distributed instead of every target reserving the same unit.
const mixedTargets = Array.from({ length: 8 }, (_, index) => makeTarget(
  `MIX-${index}`,
  index < 4 ? SIMPLE_TARGET_TYPE.UAV : SIMPLE_TARGET_TYPE.CRUISE_MISSILE,
  { lat: 50.3 + index * 0.025, lng: 30.78 + index * 0.018 },
  index < 4 ? 250 : 820,
  index < 4 ? 180 : 110,
));
const mixed = coordinateEngagements({
  targets: mixedTargets,
  tracks: mixedTargets.map(makeTrack),
  batteries: defenses,
  simulationTime: 100,
});
const mixedBatteryIds = new Set(Object.values(mixed.assignments)
  .map(item => item.assignedBatteryId)
  .filter(Boolean));
assert.ok(mixedBatteryIds.size >= 2);
assert.ok(Object.values(mixed.assignments).every(item => item.currentInterceptorId == null));

// Synthetic coordinator load: 120 tracks, 20 units, bounded to two heavy solves
// for each of the twelve tracks evaluated in one rotating coordinator slice.
const syntheticTargets = Array.from({ length: 120 }, (_, index) => makeTarget(
  `LOAD-${index}`,
  index < 100 ? SIMPLE_TARGET_TYPE.UAV : SIMPLE_TARGET_TYPE.CRUISE_MISSILE,
  { lat: 48 + (index % 10) * 0.04, lng: 29 + Math.floor(index / 10) * 0.06 },
  index < 100 ? 250 : 820,
  index < 100 ? 180 : 110,
));
const syntheticTracks = syntheticTargets.map(makeTrack);
const syntheticBatteries = Array.from({ length: 20 }, (_, index) => makeBattery(
  `LOAD-DEF-${index}`,
  ['GUN', 'SHORT', 'MEDIUM', 'SAMP_T', 'LONG'][index % 5],
  48.2 + (index % 5) * 0.25,
  29.2 + Math.floor(index / 5) * 0.4,
));
const loadStart = performance.now();
const load = coordinateEngagements({
  targets: syntheticTargets, tracks: syntheticTracks, batteries: syntheticBatteries,
  simulationTime: 100,
});
const loadMs = performance.now() - loadStart;
assert.ok(load.metrics.heavySolverCalls <= 12 * 2);
const cachedLoad = coordinateEngagements({
  targets: syntheticTargets, tracks: syntheticTracks, batteries: syntheticBatteries,
  simulationTime: 100.5,
  evaluationCursor: 0,
  candidateCache: load.candidateCache,
});
assert.ok(cachedLoad.metrics.cacheHits > 0);
assert.ok(cachedLoad.metrics.heavySolverCalls < load.metrics.heavySolverCalls);

console.log(JSON.stringify({
  A: a.result.assignments[a.track.id],
  B: b.result.assignments[b.track.id],
  C: c.assignments[b.track.id],
  D: d.assignments[dTrack.id],
  E: e.result.assignments[e.track.id],
  F: f.result.assignments[f.track.id],
  mixed: {
    assignments: Object.values(mixed.assignments).map(item => ({ targetId: item.targetId, batteryId: item.assignedBatteryId, window: item.window })),
    distinctBatteries: mixedBatteryIds.size,
  },
  synthetic: { ...load.metrics, measuredMs: loadMs, cachedPass: cachedLoad.metrics },
}, null, 2));
