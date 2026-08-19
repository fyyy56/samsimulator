import assert from 'node:assert/strict';
import { SIMPLE_TARGET_TYPE } from '../src/data/airTargetProfiles.js';
import { createAirTarget } from '../src/store/airTargetSystem.js';
import { useEngine } from '../src/store/engine.js';
import { getDestinationPoint } from '../src/store/geo.js';
import { TRACK_STATE } from '../src/store/trackSystem.js';

const cases = [
  { category: 'SHORT', distanceKm: 4 },
  { category: 'MEDIUM', distanceKm: 8 },
  { category: 'LONG', distanceKm: 12 },
];

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
  const spawnPosition = getDestinationPoint(
    launcher.lat,
    launcher.lng,
    90,
    testCase.distanceKm,
  );
  const destination = getDestinationPoint(
    spawnPosition.lat,
    spawnPosition.lng,
    90,
    120,
  );
  const target = createAirTarget({
    id: `CLOSE-${testCase.category}`,
    type: SIMPLE_TARGET_TYPE.CRUISE_MISSILE,
    modelId: 'KH_101',
    speedKmh: 500,
    altitudeM: 200,
    targetAltitudeM: 200,
    spawnPosition,
    destination,
    route: [{ ...destination, altitudeM: 200 }],
    routeType: 'DIRECT',
    turnRateDegPerSec: 0,
    sensorSignature: 0.8,
    detectability: 0.8,
    objectivePriority: 1,
  }, store.getState().simulationTime);
  const track = {
    id: `TRK-CLOSE-${testCase.category}`,
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

  const missileId = store.getState().queueEngagement(battery.id, track.id);
  assert.ok(missileId, `${testCase.category} close-range launch must be accepted`);
  const startTime = store.getState().simulationTime;
  while (store.getState().simulationTime - startTime < 8) store.getState().tick();

  const prematureFailure = store.getState().events.find(event => (
    event.type === 'INTERCEPTOR_FAILED'
    && event.details.missileId === missileId
    && ['MISS', 'GEOMETRY_LOST'].includes(event.details.reason)
  ));
  assert.equal(
    prematureFailure,
    undefined,
    `${testCase.category} must not self-destruct while the nearby target remains ahead`,
  );
}

console.log('Close-range interceptor launch checks passed.');
