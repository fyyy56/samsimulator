import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { SIMPLE_TARGET_TYPE } from '../src/data/airTargetProfiles.js';
import { CONTROLLABLE_AIR_PROFILE_IDS } from '../src/data/controllableAirProfiles.js';
import { createAirTarget } from '../src/store/airTargetSystem.js';
import {
  CONTROLLABLE_FLIGHT_PHASE,
  CONTROLLABLE_STATUS,
  advanceControllableAirEntity,
  createControllableAirEntity,
  hasFiniteControllableState,
} from '../src/store/controllableAirEntity.js';
import { useEngine } from '../src/store/engine.js';

const store = useEngine;
store.getState().resetScenario('SANDBOX');
store.getState().startDeploy('GAZ');
store.getState().handleMapClick(50.45, 30.52);
const mwg = store.getState().batteries[0];
assert.equal(mwg.fpvInventory, 4, 'MWG starts with four Skyfall entities');

const firstId = store.getState().launchSkyfallFromMwg(mwg.id);
assert.ok(firstId, 'MWG launches through the controllable entity API');
assert.equal(store.getState().batteries[0].fpvInventory, 3);
let skyfall = store.getState().controllableAirEntities.find(entity => entity.id === firstId);
assert.equal(skyfall.profileId, CONTROLLABLE_AIR_PROFILE_IDS.SKYFALL_FPV);
assert.equal(skyfall.flightPhase, CONTROLLABLE_FLIGHT_PHASE.LAUNCH);
assert.equal(skyfall.manualControlEnabled, false);

store.setState({
  tracks: [{
    id: 'TRK-FPV-TEST',
    state: 'CONFIRMED',
    reportedPosition: { lat: 50.47, lng: 30.55, alt: 250 },
  }],
});
store.getState().setControllableSelectedTrack(firstId, 'TRK-FPV-TEST');
assert.equal(
  store.getState().controllableAirEntities.find(entity => entity.id === firstId).selectedTrackId,
  'TRK-FPV-TEST',
  'A Track can be assigned after launch without enabling guidance',
);
assert.equal(store.getState().setControlledControllableEntity(firstId), true);
assert.equal(store.getState().controlledControllableEntityId, firstId);
store.getState().releaseControllableControl();
assert.equal(store.getState().controlledControllableEntityId, null);
assert.equal(store.getState().setControlledControllableEntity(firstId), true,
  'Control can be released and entered again');
store.getState().releaseControllableControl();

for (let index = 0; index < 45; index += 1) {
  skyfall = advanceControllableAirEntity(skyfall, 0.05, {
    throttle: 1, pitch: -1, yaw: 1, roll: 1,
  });
}
assert.equal(skyfall.flightPhase, CONTROLLABLE_FLIGHT_PHASE.MANUAL_FLIGHT);
assert.equal(skyfall.manualControlEnabled, true);
assert.ok(skyfall.altitudeM > 10, 'Vertical launch gains safe altitude');
assert.ok(hasFiniteControllableState(skyfall));

for (let index = 0; index < 3; index += 1) {
  assert.ok(store.getState().launchSkyfallFromMwg(mwg.id));
}
assert.equal(store.getState().batteries[0].fpvInventory, 0);
assert.equal(store.getState().launchSkyfallFromMwg(mwg.id), null,
  'Inventory prevents a fifth launch');

const collisionPosition = { lat: 50.46, lng: 30.53, altitudeM: 120 };
const collisionEntity = createControllableAirEntity({
  id: 'FPV-COLLISION',
  profileId: CONTROLLABLE_AIR_PROFILE_IDS.SKYFALL_FPV,
  sourceId: mwg.id,
  initialPosition: collisionPosition,
  simulationTime: store.getState().simulationTime,
});
const armedCollisionEntity = {
  ...collisionEntity,
  flightPhase: CONTROLLABLE_FLIGHT_PHASE.MANUAL_FLIGHT,
  manualControlEnabled: true,
  pitch: 0,
  altitudeM: collisionPosition.altitudeM,
};
const destination = { lat: 50.5, lng: 30.53, altitudeM: 120 };
const target = createAirTarget({
  id: 'FPV-TARGET',
  type: SIMPLE_TARGET_TYPE.UAV,
  modelId: 'GERBERA',
  speedKmh: 1,
  altitudeM: 120,
  targetAltitudeM: 120,
  spawnPosition: collisionPosition,
  destination,
  route: [destination],
  turnRateDegPerSec: 0,
  sensorSignature: 0.5,
}, store.getState().simulationTime);
store.setState({
  airTargets: [target],
  controllableAirEntities: [armedCollisionEntity],
  controlledControllableEntityId: null,
});
store.getState().tick(1);
assert.ok(!store.getState().airTargets.some(entity => entity.id === target.id),
  'Air collision resolves through world-space distance');
assert.equal(
  store.getState().controllableAirEntities.find(entity => entity.id === armedCollisionEntity.id)?.status,
  CONTROLLABLE_STATUS.DESTROYED,
);

const impact = store.getState().controllableAirEntities.find(e => e.id === armedCollisionEntity.id).visualImpact;
assert.ok(impact && impact.time <= store.getState().simulationTime);
assert.ok(impact.time >= store.getState().simulationTime - 0.05);
assert.equal(impact.targetId, target.id);
assert.ok(Number.isFinite(impact.missilePosition.altitudeM) && Number.isFinite(impact.targetPosition.lng),
  'FPV collision must publish contact poses for the delayed render timeline');

const stress = Array.from({ length: 8 }, (_, index) => createControllableAirEntity({
  id: `SKYFALL-PERF-${index}`,
  profileId: CONTROLLABLE_AIR_PROFILE_IDS.SKYFALL_FPV,
  initialPosition: { lat: 49 + index * 0.001, lng: 30, altitudeM: 100 },
}));
const startedAt = performance.now();
let stressState = stress;
for (let step = 0; step < 2_000; step += 1) {
  stressState = stressState.map(entity => advanceControllableAirEntity(
    entity,
    0.05,
    { throttle: 0.6, pitch: 0.1, yaw: 0.05, roll: 0.08 },
  ));
}
const elapsedMs = performance.now() - startedAt;
assert.ok(stressState.every(hasFiniteControllableState));

console.log('Skyfall FPV V1 deterministic checks passed.');
console.log(`8 Skyfall entities × 2,000 fixed steps: ${elapsedMs.toFixed(2)} ms`);
