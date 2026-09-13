import assert from 'node:assert/strict';
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

assert.notStrictEqual(first, second);
assert.notStrictEqual(first.commandPosition, second.commandPosition);
assert.deepEqual(first.commandPosition, second.commandPosition,
  'Identical measurements should produce the same deterministic PN initial solution');
first.commandPosition.lat += 1;
assert.notEqual(first.commandPosition.lat, second.commandPosition.lat,
  'Each interceptor owns an independent mutable guidance state');

console.log('Independent interceptor guidance-point checks passed.');
