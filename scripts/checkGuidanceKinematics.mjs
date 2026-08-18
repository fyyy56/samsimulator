import assert from 'node:assert/strict';
import { getInterceptorSpec } from '../src/data/interceptors.js';
import {
  advanceInterceptorGuidance,
  createInterceptorGuidance,
  INTERCEPTOR_FAILURE_REASON,
} from '../src/store/interceptorGuidance.js';
import { advanceInterceptorFlight } from '../src/store/interceptorPhysics.js';

const physics = getInterceptorSpec('INT-LONG-V1').gameplayPhysics;
const track = {
  id: 'TRK-GUIDANCE',
  state: 'TRACKED',
  reportedPosition: { lat: 49, lng: 31, alt: 1_000 },
  reportedHeading: 90,
  reportedSpeedKmh: 900,
  lastUpdateTime: 10,
};
const interceptor = {
  id: 'MSL-GUIDANCE',
  lat: 49,
  lng: 30,
  heading: 90,
  speedKmh: 3_000,
  flightTime: 12,
  altitudeM: 1_000,
  energyRatio: 0.8,
  guidance: createInterceptorGuidance(track, 10, null, { lat: 49, lng: 30 }, 'MSL-GUIDANCE'),
};

const leadGuidance = advanceInterceptorGuidance({
  interceptor,
  track,
  simulationTime: 10.5,
  deltaTimeSec: 0.05,
  physics,
});
assert.ok(
  leadGuidance.guidance.commandPosition.lng > track.reportedPosition.lng,
  'Guidance command must lead a target moving east instead of pursuing its current position',
);
assert.ok(
  Math.abs(leadGuidance.heading - interceptor.heading)
    <= leadGuidance.turnRateDegPerSec * 0.05 + 0.001,
  'Heading change must remain bounded by effective turn rate',
);

const behindTrack = {
  ...track,
  reportedPosition: { lat: 49, lng: 29, alt: 1_000 },
  reportedHeading: 270,
  reportedSpeedKmh: 300,
  lastUpdateTime: 20,
};
const turnBackInterceptor = {
  ...interceptor,
  heading: 90,
  guidance: createInterceptorGuidance(
    behindTrack,
    20,
    null,
    { lat: interceptor.lat, lng: interceptor.lng },
    'MSL-TURNBACK',
  ),
};
const firstTurnBackUpdate = advanceInterceptorGuidance({
  interceptor: turnBackInterceptor,
  track: behindTrack,
  simulationTime: 20.1,
  deltaTimeSec: 0.05,
  physics,
});
assert.equal(firstTurnBackUpdate.failedReason, null, 'A transient large correction receives a grace window');
const rejectedTurnBack = advanceInterceptorGuidance({
  interceptor: { ...turnBackInterceptor, guidance: firstTurnBackUpdate.guidance },
  track: behindTrack,
  simulationTime: 21,
  deltaTimeSec: 0.05,
  physics,
});
assert.equal(
  rejectedTurnBack.failedReason,
  INTERCEPTOR_FAILURE_REASON.GEOMETRY_LOST,
  'Sustained reverse-course guidance must be rejected',
);

const flightBase = {
  speedKmh: 3_600,
  flightTime: 25,
  distanceTraveledKm: 25,
  criticalEnergyTimeSec: 0,
  altitudeM: 2_000,
};
const shallowTurn = advanceInterceptorFlight(flightBase, 0.1, physics, {
  headingChangeDeg: 2,
  headingCorrectionDeg: 10,
  altitudeM: 2_000,
});
const hardTurn = advanceInterceptorFlight(flightBase, 0.1, physics, {
  headingChangeDeg: 2,
  headingCorrectionDeg: 100,
  altitudeM: 2_000,
});
assert.ok(hardTurn.speedKmh < shallowTurn.speedKmh, 'A large demanded correction must consume more energy');

console.log('Predictive guidance, bounded turn, geometry-loss and maneuver-energy checks passed.');
