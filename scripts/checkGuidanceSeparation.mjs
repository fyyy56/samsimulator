import assert from 'node:assert/strict';
import { getDistanceKm } from '../src/store/geo.js';
import { createInterceptorGuidance } from '../src/store/interceptorGuidance.js';

const track = {
  reportedPosition: { lat: 49, lng: 31, alt: 1_000 },
  reportedHeading: 15,
  reportedSpeedKmh: 800,
  lastUpdateTime: 10,
  state: 'TRACKED',
};
const interceptSolution = {
  predictedInterceptPoint: { lat: 49.3, lng: 31.1, altitudeM: 1_000 },
};
const launchPosition = { lat: 48.8, lng: 31 };
const first = createInterceptorGuidance(
  track,
  10,
  interceptSolution,
  launchPosition,
  'MSL-001',
);
const second = createInterceptorGuidance(
  track,
  10,
  interceptSolution,
  launchPosition,
  'MSL-002',
);

assert.notEqual(first.lateralSide, second.lateralSide);
assert.ok(first.lateralOffsetM >= 35 && first.lateralOffsetM <= 100);
assert.ok(second.lateralOffsetM >= 35 && second.lateralOffsetM <= 100);
assert.ok(getDistanceKm(
  first.commandPosition.lat,
  first.commandPosition.lng,
  second.commandPosition.lat,
  second.commandPosition.lng,
) > 0.05);

console.log('Independent interceptor guidance-point checks passed.');
