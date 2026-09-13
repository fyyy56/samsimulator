import assert from 'node:assert/strict';
import { SIMPLE_TARGET_TYPE } from '../src/data/airTargetProfiles.js';
import { getLaunchProfile, useLaunchProfileStore } from '../src/store/launchProfileStore.js';
import { createAirTarget } from '../src/store/airTargetSystem.js';
import { useEngine } from '../src/store/engine.js';
import { getDestinationPoint, getDistanceKm } from '../src/store/geo.js';
import { TRACK_STATE } from '../src/store/trackSystem.js';
import { getVisualLaunchOffset } from '../src/ui/launchVisuals.js';

const approximatelyEqual = (first, second, tolerance, label) => assert.ok(
  Math.abs(first - second) <= tolerance,
  `${label}: ${first} != ${second}`,
);

function runNasamsIntercept(renderZoom) {
  useLaunchProfileStore.setState({ savedProfiles: {} });
  const store = useEngine;
  store.getState().resetScenario('SANDBOX');
  store.getState().configureSimulationProfile({ physicsLevel: 'BASIC', uiDetail: 'OPERATIONAL' });
  store.getState().startDeploy('MEDIUM');
  store.getState().handleMapClick(48.4, 31.2);
  store.getState().handleMapClick(48.4, 31.19);
  store.getState().handleMapClick(48.4, 31.21);
  const battery = store.getState().batteries[0];
  const launcher = battery.components.launchers[0];
  const spawnPosition = getDestinationPoint(launcher.lat, launcher.lng, 90, 18);
  const destination = getDestinationPoint(spawnPosition.lat, spawnPosition.lng, 270, 50);
  const target = createAirTarget({
    id: 'ZOOM-UAV', type: SIMPLE_TARGET_TYPE.UAV, modelId: 'SHAHED_136',
    speedKmh: 220, altitudeM: 350, targetAltitudeM: 350,
    spawnPosition, destination, route: [{ ...destination, altitudeM: 350 }],
    routeType: 'DIRECT', turnRateDegPerSec: 0, sensorSignature: 0.8,
    detectability: 0.8, objectivePriority: 1,
  }, store.getState().simulationTime);
  const track = {
    id: 'TRK-ZOOM', targetId: target.id, state: TRACK_STATE.IDENTIFIED,
    reportedPosition: { ...target.position, alt: target.altitudeM },
    reportedHeading: target.heading, reportedSpeedKmh: target.speedKmh,
    reportedAltitudeM: target.altitudeM, trackQuality: 1,
    lastUpdateTime: store.getState().simulationTime, identifiedType: target.type,
  };
  store.setState({ airTargets: [target], tracks: [track], timeScale: 1 });
  const missileId = store.getState().queueEngagement(battery.id, track.id);
  assert.ok(missileId);
  store.getState().tick();
  const pending = store.getState().pendingLaunches.find(item => item.missileId === missileId);
  assert.ok(pending);
  const selectedLauncher = battery.components.launchers.find(candidate => candidate.id === pending.launcherId);
  assert.ok(getDistanceKm(pending.lat, pending.lng, selectedLauncher.lat, selectedLauncher.lng) < 0.000001);
  const visualOffsetAtLaunch = getVisualLaunchOffset({
    ...pending,
    flightTime: 0,
    mapZoom: renderZoom,
  });
  const visualOffsetAfterDeparture = getVisualLaunchOffset({
    ...pending,
    flightTime: 0.5,
    mapZoom: renderZoom,
  });

  let finalMissile = null;
  let outcome = null;
  for (let step = 0; step < 3_000 && !outcome; step += 1) {
    store.getState().tick();
    const missile = store.getState().missiles.find(candidate => candidate.id === missileId);
    if (missile) finalMissile = missile;
    outcome = store.getState().events.find(event => (
      event.details?.missileId === missileId
      && ['TARGET_INTERCEPTED', 'INTERCEPTOR_FAILED'].includes(event.type)
    ));
  }
  assert.ok(outcome, 'NASAMS zoom invariance run must finish');
  return {
    outcome: outcome.type,
    simulationTime: outcome.simulationTime,
    flightTime: finalMissile?.flightTime ?? 0,
    distanceTraveledKm: finalMissile?.distanceTraveledKm ?? 0,
    speedKmh: finalMissile?.speedKmh ?? 0,
    physicalHitDistanceM: outcome.details?.closestApproachM ?? finalMissile?.sweptClosestApproachM ?? 0,
    hitRadiusM: finalMissile?.hitRadiusM,
    visualOffsetAtLaunch,
    visualOffsetAfterDeparture,
  };
}

const far = runNasamsIntercept(5.5);
const close = runNasamsIntercept(10.5);
assert.equal(far.outcome, close.outcome);
approximatelyEqual(far.simulationTime, close.simulationTime, 1e-9, 'intercept time');
approximatelyEqual(far.flightTime, close.flightTime, 1e-9, 'flight time');
approximatelyEqual(far.distanceTraveledKm, close.distanceTraveledKm, 1e-9, 'flight distance');
approximatelyEqual(far.speedKmh, close.speedKmh, 1e-9, 'speed');
approximatelyEqual(far.physicalHitDistanceM, close.physicalHitDistanceM, 1e-6, 'physical hit distance');
assert.equal(far.hitRadiusM, close.hitRadiusM);
assert.notEqual(far.visualOffsetAtLaunch.x, close.visualOffsetAtLaunch.x);
approximatelyEqual(far.visualOffsetAfterDeparture.x, 0, 1e-9, 'far visual departure completion');
approximatelyEqual(close.visualOffsetAfterDeparture.x, 0, 1e-9, 'close visual departure completion');

console.log('NASAMS zoom invariance passed: world intercept is identical; only launch sprite offset changes with zoom.');
