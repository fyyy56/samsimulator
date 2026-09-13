import assert from 'node:assert/strict';
import { SIMPLE_TARGET_TYPE } from '../src/data/airTargetProfiles.js';
import { getInterceptorSeekerProfile, SEEKER_REFERENCE_SOURCE } from '../src/data/seekerProfiles.js';
import { createAirTarget } from '../src/store/airTargetSystem.js';
import { useEngine } from '../src/store/engine.js';
import { getDestinationPoint } from '../src/store/geo.js';
import { TRACK_STATE } from '../src/store/trackSystem.js';

const cases = [
  { category: 'SHORT', distanceKm: 9, profileId: 'IRIS_T_SLM_GAMEPLAY_IR_V1' },
  { category: 'MEDIUM', distanceKm: 14, profileId: 'AIM_120C7_GAMEPLAY_ARH_V1' },
  { category: 'SAMP_T', distanceKm: 14, profileId: 'ASTER_30_GAMEPLAY_ARH_V1' },
  { category: 'LONG', distanceKm: 12, profileId: 'PAC3_MSE_GAMEPLAY_ARH_V1' },
];

const results = [];
for (const testCase of cases) {
  const store = useEngine;
  store.getState().resetScenario('SANDBOX');
  store.getState().configureSimulationProfile({ physicsLevel: 'BASIC', uiDetail: 'OPERATIONAL' });
  store.getState().startDeploy(testCase.category);
  store.getState().handleMapClick(48.2, 31.5);
  if (store.getState().deployPhase === 'RADAR_HEADING') {
    store.getState().rotateRadar(90);
    store.getState().confirmRadarHeading();
  }
  store.getState().handleMapClick(48.2, 31.49);
  store.getState().handleMapClick(48.2, 31.51);

  const battery = store.getState().batteries[0];
  const launcher = battery.components.launchers[0];
  const spawnPosition = getDestinationPoint(launcher.lat, launcher.lng, 90,
    testCase.distanceKm);
  const destination = getDestinationPoint(spawnPosition.lat, spawnPosition.lng, 90, 120);
  const target = createAirTarget({
    id: `SEEKER-${testCase.category}-TARGET`,
    type: SIMPLE_TARGET_TYPE.CRUISE_MISSILE,
    modelId: 'KH_101',
    speedKmh: 500,
    altitudeM: 800,
    targetAltitudeM: 800,
    spawnPosition,
    destination,
    route: [{ ...destination, altitudeM: 800 }],
    routeType: 'DIRECT',
    turnRateDegPerSec: 0,
    sensorSignature: 0.9,
    detectability: 0.9,
    objectivePriority: 1,
  }, store.getState().simulationTime);
  const track = {
    id: `TRK-SEEKER-${testCase.category}`,
    targetId: target.id,
    state: TRACK_STATE.IDENTIFIED,
    reportedPosition: { ...target.position, alt: target.altitudeM },
    reportedHeading: target.heading,
    reportedSpeedKmh: target.speedKmh,
    reportedHorizontalSpeedKmh: target.speedKmh,
    reportedVerticalSpeedMps: 0,
    reportedAltitudeM: target.altitudeM,
    positionUncertaintyM: 80,
    velocityUncertaintyMps: 4,
    headingUncertaintyDeg: 1.5,
    trackQuality: 1,
    consecutiveUpdates: 8,
    totalUpdates: 8,
    identifiedType: target.type,
    lastUpdateTime: store.getState().simulationTime,
    velocity: { speedKmh: target.speedKmh, heading: target.heading },
  };
  store.setState({ airTargets: [target], tracks: [track] });
  const missileId = store.getState().queueEngagement(battery.id, track.id);
  assert.ok(missileId, `${testCase.category}: engagement must be accepted`);

  const states = new Set();
  const sources = new Set();
  let profileId = null;
  for (let step = 0; step < 2_400; step += 1) {
    store.getState().tick();
    const missile = store.getState().missiles.find(candidate => candidate.id === missileId);
    if (missile?.seeker) {
      profileId = missile.seeker.profileId;
      states.add(missile.seeker.state);
      sources.add(missile.guidanceSource ?? missile.guidance?.guidanceSource);
    }
    if (store.getState().events.some(event => event.type === 'TARGET_INTERCEPTED'
      && event.details.missileId === missileId)) break;
  }

  assert.equal(profileId, testCase.profileId, `${testCase.category}: missile-specific profile`);
  for (const expected of ['SEARCH', 'ACQUIRED', 'TERMINAL']) {
    assert.ok(states.has(expected), `${testCase.category}: must reach ${expected}`);
  }
  assert.ok(sources.has('NETWORK_TRACK'), `${testCase.category}: must use network midcourse`);
  assert.ok(sources.has('OWN_SEEKER'), `${testCase.category}: must hand off to own estimate`);
  assert.ok(store.getState().events.some(event => event.type === 'TARGET_INTERCEPTED'
    && event.details.missileId === missileId), `${testCase.category}: physical intercept`);
  results.push({ category: testCase.category, profileId, states: [...states], sources: [...sources] });
}

assert.equal(getInterceptorSeekerProfile('INT-LONG-V1').reference.source,
  SEEKER_REFERENCE_SOURCE.GAMEPLAY_ESTIMATE,
  'PAC-3 seeker profile must remain explicitly labelled GAMEPLAY_ESTIMATE');

console.log(JSON.stringify({ status: 'PASS', results }, null, 2));
