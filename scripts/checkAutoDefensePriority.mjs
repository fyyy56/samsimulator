import assert from 'node:assert/strict';
import {
  buildEngagementRegistry,
  getInterceptorEngagementPolicy,
  getRolePriorityTier,
  isBallisticTarget,
  isPatriotBattery,
  scoreTrackForBattery,
} from '../src/store/autoDefense.js';
import { SIMPLE_TARGET_TYPE } from '../src/store/scenarios.js';

const patriot = { category: 'LONG', type: 'PATRIOT' };
const nasams = { category: 'MEDIUM', type: 'NASAMS' };
const ballistic = { type: SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE };
const cruise = { type: SIMPLE_TARGET_TYPE.CRUISE_MISSILE };
const uav = { type: SIMPLE_TARGET_TYPE.UAV };

assert.equal(isPatriotBattery(patriot), true);
assert.equal(isPatriotBattery(nasams), false);
assert.equal(isBallisticTarget(ballistic), true);
assert.deepEqual(getInterceptorEngagementPolicy(patriot), {
  maximumActiveInterceptors: 2,
  maximumAutomaticAttempts: 2,
});
assert.deepEqual(getInterceptorEngagementPolicy(nasams), {
  maximumActiveInterceptors: 1,
  maximumAutomaticAttempts: 2,
});
assert.deepEqual(getInterceptorEngagementPolicy({ category: 'SHORT', type: 'IRIS-T SLM' }), {
  maximumActiveInterceptors: 1,
  maximumAutomaticAttempts: 1,
});

const registry = buildEngagementRegistry({
  missiles: [{ id: 'MSL-001', trackId: 'TRK-001', sourceBatteryId: 'PATRIOT-01' }],
  pendingLaunches: [{ id: 'PREP-MSL-002', trackId: 'TRK-001', sourceBatteryId: 'PATRIOT-01' }],
  gunEngagements: [{ id: 'GUN-003', trackId: 'TRK-001', batteryId: 'GEPARD-01' }],
});
assert.equal(registry.get('TRK-001').missileTotal, 2);
assert.equal(registry.get('TRK-001').gunTotal, 1);

assert.ok(
  getRolePriorityTier(patriot, ballistic) < getRolePriorityTier(patriot, cruise),
  'Patriot must rank a feasible ballistic target before slower threats',
);
assert.ok(
  getRolePriorityTier(nasams, cruise) < getRolePriorityTier(nasams, ballistic),
  'NASAMS must rank cruise missiles before ballistic fallback targets',
);
assert.ok(
  getRolePriorityTier(nasams, uav) < getRolePriorityTier(nasams, ballistic),
  'NASAMS must rank UAVs before ballistic fallback targets',
);

const sectorPatriot = {
  ...patriot,
  id: 'PATRIOT-SECTOR',
  controlMode: 'AUTO',
  doctrine: 'BALANCED',
  radarRangeKm: 150,
  radarSector: 120,
  radarHeading: 0,
  radarScanType: 'ELECTRONIC_SECTOR',
  missilesLeft: 8,
  ammoCapacity: 8,
  interceptorSpecId: 'INT-LONG-V1',
  components: {
    radar: { lat: 49, lng: 30, operational: true },
    launchers: [{ id: 'PAC-L1', lat: 49, lng: 30, altitudeM: 0, heading: 0, operational: true, ready: true }],
  },
};
const outsideSectorTarget = {
  id: 'OUTSIDE-SECTOR',
  type: 'CRUISE_TARGET',
  position: { lat: 49, lng: 31 },
  altitudeM: 100,
  speedKmh: 800,
  heading: 90,
  route: [{ lat: 49, lng: 32 }],
  waypointIndex: 0,
};
const outsideSectorTrack = {
  id: 'TRK-OUTSIDE',
  targetId: outsideSectorTarget.id,
  state: 'IDENTIFIED',
  trackQuality: 1,
  reportedPosition: { lat: 49, lng: 31, alt: 100 },
  reportedSpeedKmh: 800,
  reportedHeading: 90,
};
assert.equal(scoreTrackForBattery({
  battery: sectorPatriot,
  track: outsideSectorTrack,
  target: outsideSectorTarget,
  registry: new Map(),
}), null, 'Patriot must not launch at a target outside its own radar sector');

assert.notEqual(scoreTrackForBattery({
  battery: sectorPatriot,
  track: {
    ...outsideSectorTrack,
    sourceBatteryId: 'NETWORK-RADAR-01',
    reportedHeading: 270,
  },
  target: {
    ...outsideSectorTarget,
    heading: 270,
    route: [{ lat: 49, lng: 29 }],
  },
  registry: new Map(),
}), null, 'Patriot may use a fresh shared network Track inside its interceptor envelope');

console.log('Auto-defense ballistic priority checks passed.');
