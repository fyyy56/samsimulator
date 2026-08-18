import assert from 'node:assert/strict';
import { SIMPLE_TARGET_TYPE } from '../src/data/airTargetProfiles.js';
import { createAirTarget } from '../src/store/airTargetSystem.js';
import { getGunSystemSpec } from '../src/data/gunSystems.js';
import { useEngine } from '../src/store/engine.js';
import { getDistanceKm } from '../src/store/geo.js';
import {
  evaluateGunEngagement,
  getGunProjectileFlightTimeSec,
  quantizeGepardHeading,
  resolveGunBurst,
} from '../src/store/gunAirDefense.js';
import { TRACK_STATE } from '../src/store/trackSystem.js';

assert.deepEqual(
  [2, 44, 89, 136, 181, 224, 271, 316, 359].map(quantizeGepardHeading),
  [0, 45, 90, 135, 180, 225, 270, 315, 0],
);
const gepardSpec = getGunSystemSpec('GEPARD_1A2');
assert.equal(gepardSpec.ammunitionRounds, 640);
assert.equal(gepardSpec.roundsPerBurst, 10);
assert.equal(gepardSpec.reloadDurationSec, 20);
assert.equal(getGunProjectileFlightTimeSec(1, gepardSpec), 1);
assert.equal(getGunProjectileFlightTimeSec(2, gepardSpec), 2.17);
assert.equal(getGunProjectileFlightTimeSec(4, gepardSpec), 6.05);

const store = useEngine;
store.getState().resetScenario('SANDBOX');
store.getState().startDeploy('GUN');
store.getState().handleMapClick(48.2, 31.5);
const battery = store.getState().batteries[0];
assert.equal(battery.type, 'Gepard 1A2');
assert.equal(battery.components.launchers.length, 1);
assert.equal(battery.components.radar.lat, battery.components.launchers[0].lat);

const makeTarget = ({ id, type = SIMPLE_TARGET_TYPE.UAV, speedKmh = 220, altitudeM = 180 }) => createAirTarget({
  id,
  type,
  modelId: 'GERAN_2',
  speedKmh,
  altitudeM,
  targetAltitudeM: altitudeM,
  spawnPosition: { lat: 48.2, lng: 31.525 },
  destination: { lat: 50.4501, lng: 30.5234 },
  route: [{ lat: 50.4501, lng: 30.5234, altitudeM }],
  routeType: 'DIRECT',
  turnRateDegPerSec: type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE ? 0 : 3,
  sensorSignature: 0.5,
  objectivePriority: 1,
}, store.getState().simulationTime);

const target = makeTarget({ id: 'GEPARD-UAV' });
const track = {
  id: 'TRK-GEPARD',
  targetId: target.id,
  state: TRACK_STATE.IDENTIFIED,
  reportedPosition: { ...target.position, alt: target.altitudeM },
  reportedHeading: target.heading,
  reportedSpeedKmh: target.speedKmh,
  trackQuality: 1,
  consecutiveUpdates: 8,
  totalUpdates: 8,
  identifiedType: target.type,
  lastUpdateTime: store.getState().simulationTime,
  velocity: { speedKmh: target.speedKmh, heading: target.heading },
};
store.setState({ airTargets: [target], tracks: [track] });

const engagementId = store.getState().queueEngagement(battery.id, track.id);
assert.ok(engagementId?.startsWith('GUN-'));
let firingObserved = false;
let hitTracerObserved = false;
for (let step = 0; step < 180; step += 1) {
  store.getState().tick();
  firingObserved ||= store.getState().batteries[0].components.launchers[0].launchState === 'FIRING';
  hitTracerObserved ||= store.getState().gunTracers.some(tracer => tracer.willHit);
  if (store.getState().events.some(event => (
    event.type === 'TARGET_INTERCEPTED' && event.details.weaponType === 'GUN_AA'
  ))) break;
}
assert.equal(firingObserved, true);
assert.equal(hitTracerObserved, true);
assert.equal(store.getState().airTargets.some(candidate => candidate.id === target.id), false);
assert.equal(store.getState().batteries[0].missilesLeft, 630);
assert.ok([0, 45, 90, 135, 180, 225, 270, 315].includes(
  store.getState().batteries[0].components.launchers[0].heading,
));

const ballistic = makeTarget({
  id: 'GEPARD-BALLISTIC',
  type: SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE,
  speedKmh: 2_800,
  altitudeM: 6_000,
});
const rejected = evaluateGunEngagement({
  battery: store.getState().batteries[0],
  track: { ...track, targetId: ballistic.id, reportedSpeedKmh: ballistic.speedKmh },
  target: ballistic,
  simulationTime: store.getState().simulationTime + 10,
});
assert.equal(rejected.ready, false);
assert.equal(rejected.reason, 'UNSUITABLE_TARGET');

const cruiseMissile = makeTarget({
  id: 'GEPARD-CRUISE',
  type: SIMPLE_TARGET_TYPE.CRUISE_MISSILE,
  speedKmh: 800,
  altitudeM: 100,
});
const cruiseTrack = {
  ...track,
  targetId: cruiseMissile.id,
  reportedPosition: { ...cruiseMissile.position, alt: cruiseMissile.altitudeM },
  reportedHeading: cruiseMissile.heading,
  reportedSpeedKmh: cruiseMissile.speedKmh,
};
const cruiseSolution = evaluateGunEngagement({
  battery: store.getState().batteries[0],
  track: cruiseTrack,
  target: cruiseMissile,
  simulationTime: store.getState().simulationTime + 10,
});
assert.equal(cruiseSolution.ready, true);
const cruiseOutcome = resolveGunBurst({
  battery: store.getState().batteries[0],
  track: cruiseTrack,
  target: cruiseMissile,
});
assert.ok(cruiseOutcome.effectiveness < 0.6);
assert.equal(cruiseOutcome.destroyed, false, 'A single 10-round burst should rarely solve a 2 km cruise-missile shot');

store.setState({
  airTargets: [cruiseMissile],
  tracks: [cruiseTrack],
  gunEngagements: [],
  gunTracers: [],
  batteries: store.getState().batteries.map(currentBattery => ({
    ...currentBattery,
    missilesLeft: 630,
    gunNextBurstTime: 0,
    reloadRemainingSec: null,
    components: {
      ...currentBattery.components,
      launchers: currentBattery.components.launchers.map(launcher => ({
        ...launcher,
        ready: true,
        launchState: 'READY',
      })),
    },
  })),
});
assert.ok(store.getState().queueEngagement(store.getState().batteries[0].id, cruiseTrack.id));
for (let step = 0; step < 90 && store.getState().gunTracers.length === 0; step += 1) {
  store.getState().tick();
}
assert.equal(store.getState().gunTracers.length, 3);
assert.equal(store.getState().gunTracers.every(tracer => !tracer.willHit), true);
const missTracer = store.getState().gunTracers[0];
assert.ok(getDistanceKm(
  missTracer.startPosition.lat,
  missTracer.startPosition.lng,
  missTracer.endPosition.lat,
  missTracer.endPosition.lng,
) > cruiseSolution.distanceKm + 0.7);

store.getState().resetScenario('SANDBOX');
store.getState().startDeploy('GUN');
store.getState().handleMapClick(48.2, 31.5);
store.getState().startDeploy('SHORT');
store.getState().handleMapClick(48.2, 31.49);
store.getState().handleMapClick(48.2, 31.48);
store.getState().handleMapClick(48.2, 31.5);
const coordinatedTarget = makeTarget({ id: 'GEPARD-PRIORITY-UAV' });
const coordinatedTrack = {
  ...track,
  id: 'TRK-GEPARD-PRIORITY',
  targetId: coordinatedTarget.id,
  reportedPosition: { ...coordinatedTarget.position, alt: coordinatedTarget.altitudeM },
  reportedHeading: coordinatedTarget.heading,
  reportedSpeedKmh: coordinatedTarget.speedKmh,
  lastUpdateTime: store.getState().simulationTime,
};
store.setState({ airTargets: [coordinatedTarget], tracks: [coordinatedTrack] });
store.getState().setAllBatteriesControlMode('AUTO');
store.getState().tick();
assert.equal(store.getState().gunEngagements.length, 1);
assert.equal(store.getState().launchQueue.length, 0, 'IRIS-T must not be spent while nearby Gepard owns the UAV');

store.getState().resetScenario('SANDBOX');
store.getState().startDeploy('SHORT');
store.getState().handleMapClick(48.2, 31.5);
store.getState().handleMapClick(48.2, 31.49);
store.getState().handleMapClick(48.2, 31.51);
const outsideTarget = {
  ...makeTarget({ id: 'OUTSIDE-RADAR' }),
  position: { lat: 48.2, lng: 32.1, lon: 32.1 },
};
const outsideTrack = {
  ...track,
  id: 'TRK-OUTSIDE-RADAR',
  targetId: outsideTarget.id,
  reportedPosition: { ...outsideTarget.position, alt: outsideTarget.altitudeM },
  lastUpdateTime: store.getState().simulationTime,
};
store.setState({ airTargets: [outsideTarget], tracks: [outsideTrack] });
store.getState().tick();
assert.equal(store.getState().tracks[0].state, TRACK_STATE.LOST);

console.log('Gepard integration checks passed.');
