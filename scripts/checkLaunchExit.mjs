import assert from 'node:assert/strict';
import { SIMPLE_TARGET_TYPE } from '../src/data/airTargetProfiles.js';
import { getLaunchProfile, useLaunchProfileStore } from '../src/store/launchProfileStore.js';
import { createAirTarget } from '../src/store/airTargetSystem.js';
import { useEngine } from '../src/store/engine.js';
import { getDestinationPoint, getDistanceKm } from '../src/store/geo.js';
import { TRACK_STATE } from '../src/store/trackSystem.js';

const headingDelta = (first, second) => Math.abs(((second - first + 540) % 360) - 180);

function deploy(category) {
  const store = useEngine;
  store.getState().resetScenario('SANDBOX');
  store.getState().configureSimulationProfile({ physicsLevel: 'BASIC', uiDetail: 'OPERATIONAL' });
  store.getState().startDeploy(category);
  store.getState().handleMapClick(48.2, 31.5);
  if (store.getState().deployPhase === 'RADAR_HEADING') {
    store.getState().rotateRadar(90);
    store.getState().confirmRadarHeading();
  }
  store.getState().handleMapClick(48.2, 31.49);
  store.getState().handleMapClick(48.2, 31.51);
  return store;
}

function prepareTarget(store, battery, bearing, distanceKm, id) {
  const launcher = battery.components.launchers[0];
  const spawnPosition = getDestinationPoint(launcher.lat, launcher.lng, bearing, distanceKm);
  const destination = getDestinationPoint(spawnPosition.lat, spawnPosition.lng, bearing, 60);
  const target = createAirTarget({
    id,
    type: SIMPLE_TARGET_TYPE.UAV,
    modelId: 'SHAHED_136',
    speedKmh: 180,
    altitudeM: 350,
    targetAltitudeM: 350,
    spawnPosition,
    destination,
    route: [{ ...destination, altitudeM: 350 }],
    routeType: 'DIRECT',
    turnRateDegPerSec: 0,
    sensorSignature: 0.8,
    detectability: 0.8,
    objectivePriority: 1,
  }, store.getState().simulationTime);
  const track = {
    id: `TRK-${id}`,
    targetId: target.id,
    state: TRACK_STATE.IDENTIFIED,
    reportedPosition: { ...target.position, alt: target.altitudeM },
    reportedHeading: target.heading,
    reportedSpeedKmh: target.speedKmh,
    reportedAltitudeM: target.altitudeM,
    trackQuality: 1,
    lastUpdateTime: store.getState().simulationTime,
    identifiedType: target.type,
  };
  store.setState({ airTargets: [target], tracks: [track] });
  return track;
}

function checkLaunch(category, bearing, distanceKm) {
  useLaunchProfileStore.setState({ savedProfiles: {} });
  const store = deploy(category);
  const battery = store.getState().batteries[0];
  const launcher = battery.components.launchers[0];
  const track = prepareTarget(store, battery, bearing, distanceKm, `${category}-${bearing}`);
  const missileId = store.getState().queueEngagement(battery.id, track.id);
  assert.ok(missileId, `${category}: launch must be accepted`);
  store.getState().tick();
  const pending = store.getState().pendingLaunches.find(item => item.missileId === missileId);
  assert.ok(pending, `${category}: PRE_LAUNCH must exist before spawn`);
  assert.equal(pending.launchPhase, 'PRE_LAUNCH');
  assert.equal(store.getState().missiles.some(item => item.id === missileId), false);
  const selectedLauncher = battery.components.launchers.find(item => item.id === pending.launcherId);
  const launcherHeadingBefore = selectedLauncher.heading;

  const profile = getLaunchProfile(battery.interceptorSpecId);
  const expectedPosition = selectedLauncher.worldPosition ?? selectedLauncher;
  const launchPointErrorKm = getDistanceKm(
    pending.lat,
    pending.lng,
    expectedPosition.lat,
    expectedPosition.lng,
  );
  assert.ok(
    launchPointErrorKm < 0.001,
    `${category}: physical spawn must use launcher worldPosition (${launchPointErrorKm.toFixed(6)} km)`,
  );

  let firstMissile;
  for (let step = 0; step < 100 && !firstMissile; step += 1) {
    store.getState().tick();
    firstMissile = store.getState().missiles.find(item => item.id === missileId);
  }
  assert.ok(firstMissile, `${category}: missile must spawn after PRE_LAUNCH`);
  assert.equal(firstMissile.launchPhase, 'LAUNCH_EXIT');
  assert.ok(firstMissile.speedKmh > 0, `${category}: launch velocity must be non-zero`);
  if (profile.launchMode === 'VERTICAL') {
    assert.equal(
      store.getState().batteries[0].components.launchers.find(item => item.id === pending.launcherId).heading,
      launcherHeadingBefore,
    );
    assert.ok(firstMissile.altitudeM > pending.altitudeM);
    assert.ok(firstMissile.verticalSpeedMps > 0);
    assert.ok(getDistanceKm(firstMissile.lat, firstMissile.lng, pending.lat, pending.lng) < 0.00001);
  } else {
    assert.ok(headingDelta(firstMissile.heading, pending.heading) < 0.01);
    assert.ok(getDistanceKm(firstMissile.lat, firstMissile.lng, pending.lat, pending.lng) > 0);
    assert.equal(firstMissile.flightPathAngleDeg, profile.launchTubeElevationDeg);
    assert.ok(firstMissile.altitudeM > pending.altitudeM,
      `${category}: inclined launcher must give the missile a climbing exit`);
  }
}

checkLaunch('MEDIUM', 90, 8);
checkLaunch('LONG', 90, 12);
checkLaunch('SHORT', 90, 4);
checkLaunch('SHORT', 270, 4);

console.log('Launch exit checks passed for NASAMS, Patriot and IRIS-T on both sides.');
