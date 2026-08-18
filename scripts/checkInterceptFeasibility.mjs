import assert from 'node:assert/strict';
import { getInterceptorSpec } from '../src/data/interceptors.js';
import {
  evaluateInterceptFeasibility,
  estimateInterceptorKinematics,
  INTERCEPT_FEASIBILITY,
  INTERCEPT_SOLUTION_REASON,
} from '../src/store/interceptFeasibility.js';
import { didSweptPathsEnterRadius } from '../src/store/continuousCollision.js';
import { getBearing } from '../src/store/geo.js';

const longRangeSpec = getInterceptorSpec('INT-LONG-V1');
const shortRangeSpec = getInterceptorSpec('INT-SHORT-V1');

const lateBallisticTarget = {
  id: 'TEST-BALLISTIC-LATE',
  position: { lat: 46.48, lng: 30.72 },
  altitudeM: 12_000,
  speedKmh: 6_000,
  heading: 200,
  route: [{ lat: 46.45, lng: 30.7, altitudeM: 100 }],
  waypointIndex: 0,
};
const remoteLauncher = {
  id: 'TEST-LAUNCHER',
  lat: 46.8,
  lng: 29.5,
  altitudeM: 0,
  heading: 90,
};
const lateSolution = evaluateInterceptFeasibility({
  launcher: remoteLauncher,
  target: lateBallisticTarget,
  interceptorSpec: longRangeSpec,
});
assert.equal(lateSolution.status, INTERCEPT_FEASIBILITY.NO_SOLUTION);
assert.equal(lateSolution.reason, INTERCEPT_SOLUTION_REASON.TOO_LATE);
assert.ok(lateSolution.minimumTimeToInterceptSec > lateSolution.targetEtaSec);

const earlyBallisticTarget = {
  id: 'TEST-BALLISTIC-EARLY',
  position: { lat: 47.2, lng: 31.5 },
  altitudeM: 20_000,
  speedKmh: 3_000,
  heading: 225,
  route: [{ lat: 46.45, lng: 30.7, altitudeM: 100 }],
  waypointIndex: 0,
};
const earlySolution = evaluateInterceptFeasibility({
  launcher: { ...remoteLauncher, lat: 46.45, lng: 30.7, heading: 45 },
  target: earlyBallisticTarget,
  interceptorSpec: longRangeSpec,
});
assert.notEqual(earlySolution.status, INTERCEPT_FEASIBILITY.NO_SOLUTION);
assert.ok(earlySolution.predictedInterceptTimeSec < earlySolution.targetEtaSec);

const nearbyUav = {
  id: 'TEST-UAV',
  position: { lat: 46.47, lng: 30.72 },
  altitudeM: 120,
  speedKmh: 150,
  heading: 225,
  route: [{ lat: 46.45, lng: 30.7, altitudeM: 120 }],
  waypointIndex: 0,
};
const uavSolution = evaluateInterceptFeasibility({
  launcher: { ...remoteLauncher, lat: 46.45, lng: 30.7 },
  target: nearbyUav,
  interceptorSpec: shortRangeSpec,
});
assert.notEqual(uavSolution.status, INTERCEPT_FEASIBILITY.NO_SOLUTION);
assert.equal(uavSolution.rotationDelaySec, 0);
assert.ok(
  Math.abs(uavSolution.requiredCourseChangeDeg) < 15,
  'IRIS-T vertical launch must acquire the short-range intercept course after canister exit',
);

const groundAimSolution = evaluateInterceptFeasibility({
  launcher: { ...remoteLauncher, lat: 46.45, lng: 30.7, heading: 180 },
  target: nearbyUav,
  interceptorSpec: getInterceptorSpec('INT-MEDIUM-V1'),
});
assert.ok(groundAimSolution.rotationDelaySec > 0);

const maneuveringTarget = {
  id: 'TEST-NO-PERFECT-ROUTE',
  position: { lat: 46.75, lng: 31 },
  altitudeM: 1_000,
  speedKmh: 400,
  heading: 0,
  route: [{ lat: 47.4, lng: 29.5, altitudeM: 1_000 }],
  waypointIndex: 0,
};
const measuredTrack = {
  reportedPosition: { lat: 46.75, lng: 31, alt: 1_000 },
  reportedSpeedKmh: 400,
  reportedHeading: 0,
  reportedVerticalSpeedMps: 0,
};
const measuredCourseSolution = evaluateInterceptFeasibility({
  launcher: { ...remoteLauncher, lat: 46.68, lng: 31, heading: 0 },
  target: maneuveringTarget,
  track: measuredTrack,
  interceptorSpec: getInterceptorSpec('INT-MEDIUM-V1'),
});
assert.notEqual(measuredCourseSolution.status, INTERCEPT_FEASIBILITY.NO_SOLUTION);
const predictedBearing = getBearing(
  measuredTrack.reportedPosition.lat,
  measuredTrack.reportedPosition.lng,
  measuredCourseSolution.predictedInterceptPoint.lat,
  measuredCourseSolution.predictedInterceptPoint.lng,
);
assert.ok(
  Math.min(predictedBearing, 360 - predictedBearing) < 3,
  'Intercept prediction must extrapolate measured heading instead of reading future waypoints',
);

const altitudeTestTarget = altitudeM => ({
  id: `TEST-ALT-${altitudeM}`,
  position: { lat: 46.75, lng: 31 },
  altitudeM,
  speedKmh: 300,
  heading: 225,
  route: [{ lat: 45.5, lng: 29.5, altitudeM }],
  waypointIndex: 0,
});
const lowSolution = evaluateInterceptFeasibility({
  launcher: { ...remoteLauncher, lat: 46.45, lng: 30.7 },
  target: altitudeTestTarget(100),
  interceptorSpec: longRangeSpec,
});
const highSolution = evaluateInterceptFeasibility({
  launcher: { ...remoteLauncher, lat: 46.45, lng: 30.7 },
  target: altitudeTestTarget(20_000),
  interceptorSpec: longRangeSpec,
});
assert.ok(highSolution.interceptDistanceKm > lowSolution.interceptDistanceKm);
assert.ok(highSolution.interceptorSpeedAtInterceptKmh > lowSolution.interceptorSpeedAtInterceptKmh);

const firstSecond = estimateInterceptorKinematics({
  physics: shortRangeSpec.gameplayPhysics,
  durationSec: 1,
});
assert.ok(firstSecond.speedKmh > shortRangeSpec.gameplayPhysics.launchSpeedKmh);
assert.ok(firstSecond.speedKmh < shortRangeSpec.gameplayPhysics.maxSpeedKmh);

const sweptApproach = didSweptPathsEnterRadius({
  interceptorStart: { lat: 46, lng: 30, altitudeM: 1_000 },
  interceptorEnd: { lat: 46, lng: 30.2, altitudeM: 1_000 },
  targetStart: { lat: 45.9, lng: 30.1, altitudeM: 1_000 },
  targetEnd: { lat: 46.1, lng: 30.1, altitudeM: 1_000 },
}, 0.1);
assert.equal(sweptApproach.intersects, true);
assert.ok(sweptApproach.timeFraction > 0.49 && sweptApproach.timeFraction < 0.51);

console.log('Intercept feasibility checks passed.');
