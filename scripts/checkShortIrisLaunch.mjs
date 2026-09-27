import assert from 'node:assert/strict';
import { SIMPLE_TARGET_TYPE } from '../src/data/airTargetProfiles.js';
import { createAirTarget } from '../src/store/airTargetSystem.js';
import { useEngine } from '../src/store/engine.js';
import { getBearing, getDistanceKm } from '../src/store/geo.js';
import { TRACK_STATE } from '../src/store/trackSystem.js';

const headingDelta = (fromHeading, toHeading) => (
  ((toHeading - fromHeading + 540) % 360) - 180
);

const store = useEngine;
store.getState().resetScenario('SANDBOX');
store.getState().configureSimulationProfile({ physicsLevel: 'BASIC', uiDetail: 'OPERATIONAL' });
store.getState().startDeploy('SHORT');
store.getState().handleMapClick(48.2, 31.5);
store.getState().handleMapClick(48.2, 31.49);
store.getState().handleMapClick(48.2, 31.51);

const target = createAirTarget({
  id: 'SHORT-IRIS-TARGET',
  type: SIMPLE_TARGET_TYPE.UAV,
  modelId: 'SHAHED_136',
  speedKmh: 220,
  altitudeM: 250,
  targetAltitudeM: 250,
  spawnPosition: { lat: 48.2, lng: 31.62 },
  destination: { lat: 50.4501, lng: 30.5234 },
  route: [{ lat: 50.4501, lng: 30.5234, altitudeM: 250 }],
  routeType: 'DIRECT',
  turnRateDegPerSec: 3,
  sensorSignature: 0.55,
  detectability: 0.55,
  objectivePriority: 1,
}, store.getState().simulationTime);
const track = {
  id: 'TRK-SHORT-IRIS',
  targetId: target.id,
  state: TRACK_STATE.IDENTIFIED,
  reportedPosition: { ...target.position, alt: target.altitudeM },
  reportedHeading: target.heading,
  reportedSpeedKmh: target.speedKmh,
  reportedAltitudeM: target.altitudeM,
  trackQuality: 1,
  consecutiveUpdates: 8,
  totalUpdates: 8,
  identifiedType: target.type,
  lastUpdateTime: store.getState().simulationTime,
  velocity: { speedKmh: target.speedKmh, heading: target.heading },
};
store.setState({ airTargets: [target], tracks: [track] });

const battery = store.getState().batteries[0];
const launcherHeadingBeforeLaunch = battery.components.launchers[0].heading;
const missileId = store.getState().queueEngagement(battery.id, track.id);
assert.ok(missileId, 'Short-range IRIS-T engagement must be accepted');
store.getState().tick();

const pendingLaunch = store.getState().pendingLaunches[0];
assert.ok(pendingLaunch, 'IRIS-T launch must enter preparation');
assert.equal(pendingLaunch.launchPhase, 'PRE_LAUNCH');
assert.ok(
  Math.abs(headingDelta(pendingLaunch.heading, pendingLaunch.interceptSolution.interceptBearingDeg)) < 0.01,
  'Vertical IRIS-T must leave the canister on its calculated horizontal intercept course',
);
assert.equal(
  store.getState().batteries[0].components.launchers[0].heading,
  launcherHeadingBeforeLaunch,
  'Vertical IRIS-T launch must not rotate the launcher',
);

let firstMissile = null;
let visualImpactObserved = false;
let pitchOverObserved = false;
let guidanceObserved = false;
let minimumTargetDistanceKm = Number.POSITIVE_INFINITY;
const seekerStates = new Set();
const guidanceSources = new Set();
for (let step = 0; step < 1_200; step += 1) {
  store.getState().tick();
  const missile = store.getState().missiles.find(candidate => candidate.id === missileId);
  if (missile && !firstMissile) firstMissile = { ...missile };
  if (missile?.launchPhase === 'PITCH_OVER') pitchOverObserved = true;
  if (missile?.launchPhase === 'GUIDANCE') guidanceObserved = true;
  if (missile?.seeker?.state) seekerStates.add(missile.seeker.state);
  if (missile?.guidanceSource) guidanceSources.add(missile.guidanceSource);
  if (missile?.lifecycleState === 'IMPACT') {
    const impactTarget = store.getState().airTargets.find(candidate => candidate.id === target.id);
    assert.equal(missile.lat, impactTarget.position.lat);
    assert.equal(missile.lng, impactTarget.position.lng);
    visualImpactObserved = true;
  }
  if (missile?.distanceToTargetKm < minimumTargetDistanceKm) {
    minimumTargetDistanceKm = missile.distanceToTargetKm;
  }
  if (store.getState().events.some(event => (
    event.type === 'TARGET_INTERCEPTED' && event.details.missileId === missileId
  ))) break;
}

assert.ok(firstMissile, 'IRIS-T missile entity must be created');
assert.equal(firstMissile.launchPhase, 'LAUNCH_EXIT');
assert.ok(firstMissile.altitudeM > pendingLaunch.altitudeM, 'Vertical launch must gain altitude on its first simulation tick');
assert.ok(firstMissile.verticalSpeedMps > 0, 'Vertical launch must have positive vertical speed immediately');
assert.ok(
  getDistanceKm(firstMissile.lat, firstMissile.lng, pendingLaunch.lat, pendingLaunch.lng) < 0.00001,
  'Vertical launch must not translate horizontally during canister exit',
);
const expectedInitialBearing = getBearing(
  firstMissile.lat,
  firstMissile.lng,
  pendingLaunch.interceptSolution.predictedInterceptPoint.lat,
  pendingLaunch.interceptSolution.predictedInterceptPoint.lng,
);
assert.ok(
  Math.abs(headingDelta(firstMissile.heading, expectedInitialBearing)) < 1,
  'IRIS-T initial post-launch course must point toward the predicted intercept area',
);
assert.ok(minimumTargetDistanceKm < 0.2,
  `IRIS-T must close on a nearby target instead of flying away (${minimumTargetDistanceKm.toFixed(3)} km)`);
assert.equal(pitchOverObserved, true, 'IRIS-T must transition through PITCH_OVER');
assert.equal(guidanceObserved, true, 'IRIS-T must enter normal GUIDANCE after pitch-over');
assert.equal(visualImpactObserved, true,
  `Accepted intercept must visually place IRIS-T on the target (closest ${minimumTargetDistanceKm.toFixed(3)} km)`);
assert.ok(seekerStates.has('SEARCH'), 'IRIS-T seeker must enter SEARCH');
assert.ok(seekerStates.has('ACQUIRED'), 'IRIS-T seeker must acquire its assigned target');
assert.ok(seekerStates.has('TERMINAL'), 'IRIS-T seeker must confirm terminal lock');
assert.ok(guidanceSources.has('OWN_SEEKER'), 'IRIS-T guidance must hand off to its own seeker estimate');
assert.ok(store.getState().events.some(event => event.type === 'SEEKER_SEARCH'),
  'Seeker search transition must be logged once');
assert.ok(store.getState().events.some(event => event.type === 'SEEKER_ACQUIRED'),
  'Seeker acquisition transition must be logged once');
assert.ok(
  store.getState().events.some(event => (
    event.type === 'TARGET_INTERCEPTED' && event.details.missileId === missileId
  )),
  'Nearby IRIS-T engagement must end in physical interception',
);

console.log('Short-range IRIS-T launch check passed.');
