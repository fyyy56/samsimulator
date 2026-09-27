import assert from 'node:assert/strict';
import { SIMPLE_TARGET_TYPE } from '../src/data/airTargetProfiles.js';
import { createAirTarget } from '../src/store/airTargetSystem.js';
import { BATTERY_CONTROL_MODE, buildEngagementRegistry } from '../src/store/autoDefense.js';
import { useEngine } from '../src/store/engine.js';
import { getDestinationPoint } from '../src/store/geo.js';
import { evaluateBatteryInterceptFeasibility, INTERCEPT_FEASIBILITY,
  INTERCEPT_SOLUTION_REASON } from '../src/store/interceptFeasibility.js';
import { TRACK_STATE } from '../src/store/trackSystem.js';

const store = useEngine;
store.getState().resetScenario('SANDBOX');
store.getState().configureSimulationProfile({ physicsLevel: 'BASIC', uiDetail: 'OPERATIONAL' });
store.getState().startDeploy('TOR_M1');
assert.equal(store.getState().deployPhase, 'UNIT');
store.getState().handleMapClick(48.2, 31.5);
const battery = store.getState().batteries.at(-1);
assert.equal(battery.category, 'TOR_M1');
assert.equal(battery.components.launchers.length, 1);
assert.ok(battery.components.radar);
assert.equal(battery.missilesLeft, 8);
const retiredEngagements = buildEngagementRegistry({ missiles: [
  { id: 'TOR-OLD-MISS', trackId: 'TRK-TOR-TEST-UAV', sourceBatteryId: battery.id,
    lifecycleState: 'MISSED' },
  { id: 'TOR-OLD-DESTRUCT', trackId: 'TRK-TOR-TEST-UAV', sourceBatteryId: battery.id,
    lifecycleState: 'SELF_DESTRUCT' },
] });
assert.equal(retiredEngagements.size, 0,
  'retired Tor missiles cannot block a valid AUTO retry while they remain visible');

const spawnPosition = getDestinationPoint(48.2, 31.5, 90, 5);
const destination = getDestinationPoint(spawnPosition.lat, spawnPosition.lng, 90, 50);
const target = createAirTarget({
  id: 'TOR-TEST-UAV', type: SIMPLE_TARGET_TYPE.UAV, modelId: 'SHAHED_136',
  speedKmh: 180, altitudeM: 350, targetAltitudeM: 350,
  spawnPosition, destination, route: [{ ...destination, altitudeM: 350 }],
  routeType: 'DIRECT', turnRateDegPerSec: 0, sensorSignature: 0.8,
  detectability: 0.8, objectivePriority: 1,
}, store.getState().simulationTime);
const track = {
  id: 'TRK-TOR-TEST-UAV', targetId: target.id, state: TRACK_STATE.IDENTIFIED,
  reportedPosition: { ...target.position, alt: target.altitudeM },
  reportedHeading: target.heading, reportedSpeedKmh: target.speedKmh,
  reportedAltitudeM: target.altitudeM, trackQuality: 1,
  consecutiveUpdates: 8, totalUpdates: 8, identifiedType: target.type,
  lastUpdateTime: store.getState().simulationTime,
  velocity: { speedKmh: target.speedKmh, heading: target.heading },
};
store.setState({ airTargets: [target], tracks: [track] });
const nearPosition = getDestinationPoint(48.2, 31.5, 90, 0.5);
const nearTrack = { ...track, reportedPosition: { ...nearPosition, alt: 100, altitudeM: 100 } };
const nearSolution = evaluateBatteryInterceptFeasibility({ battery, track: nearTrack, target });
assert.equal(nearSolution.status, INTERCEPT_FEASIBILITY.NO_SOLUTION);
assert.equal(nearSolution.reason, INTERCEPT_SOLUTION_REASON.MINIMUM_RANGE);
const missileId = store.getState().queueEngagement(battery.id, track.id);
assert.ok(missileId, 'manual Tor launch accepted');
assert.equal(store.getState().batteries.at(-1).missilesLeft, 8);

const samples = [];
let launchTime;
for (let step = 0; step < 180; step += 1) {
  store.getState().tick();
  const missile = store.getState().missiles.find(item => item.id === missileId);
  if (!missile) continue;
  launchTime ??= missile.launchTime;
  samples.push({ time: missile.flightTime, cold: missile.coldLaunchPhase,
    motor: missile.motorPhase, phase: missile.launchPhase,
    pitch: missile.flightPathAngleDeg, altitude: missile.altitudeM,
    desiredPitch: missile.pitchOverFlightPathAngleDeg,
    speed: missile.speedKmh, ignition: missile.motorIgnitedAtFlightTime });
  if (missile.flightTime > 6) break;
}
assert.ok(samples.length > 20, 'missile launches and flies');
assert.equal(samples[0].cold, 'EJECT');
assert.equal(samples[0].motor, 'COLD');
const ignition = samples.find(sample => sample.ignition != null);
assert.ok(ignition, 'motor ignites');
assert.ok(ignition.ignition >= 0.75, 'ignition respects minimum delay');
assert.ok(Math.abs(ignition.pitch - ignition.desiredPitch) <= 10,
  'ignition waits for bounded attitude correction');
assert.ok(samples.some(sample => sample.cold === 'ORIENT'));
assert.ok(samples.some(sample => sample.phase === 'GUIDANCE'), 'command guidance activates');
assert.ok(samples.some(sample => sample.motor === 'BOOST'), 'powered boost follows cold launch');
assert.ok(samples.every(sample => Number.isFinite(sample.altitude) && sample.altitude >= 0));
assert.equal(store.getState().batteries.at(-1).missilesLeft, 7, 'one round consumed');
assert.equal(store.getState().missiles.find(item => item.id === missileId)?.seekerProfileId, 'NONE');
for (let step = 0; step < 600
  && store.getState().missiles.some(item => item.id === missileId); step += 1) {
  store.getState().tick();
}
const secondTarget = createAirTarget({
  id: 'TOR-SECOND-UAV', type: SIMPLE_TARGET_TYPE.UAV, modelId: 'SHAHED_136',
  speedKmh: 180, altitudeM: 350, targetAltitudeM: 350,
  spawnPosition, destination, route: [{ ...destination, altitudeM: 350 }],
  routeType: 'DIRECT', turnRateDegPerSec: 0, sensorSignature: 0.8,
  detectability: 0.8, objectivePriority: 1,
}, store.getState().simulationTime);
const secondTrack = { ...track, id: 'TRK-TOR-SECOND-UAV', targetId: secondTarget.id,
  reportedPosition: { ...secondTarget.position, alt: secondTarget.altitudeM },
  lastUpdateTime: store.getState().simulationTime };
store.setState(state => ({ airTargets: [...state.airTargets, secondTarget],
  tracks: [...state.tracks, secondTrack] }));
const secondId = store.getState().queueEngagement(battery.id, secondTrack.id);
assert.ok(secondId, 'Tor accepts a later manual launch');
for (let step = 0; step < 100
  && !store.getState().missiles.some(item => item.id === secondId); step += 1) store.getState().tick();
assert.equal(store.getState().batteries.at(-1).missilesLeft, 6, 'second round consumed');

store.getState().resetScenario('SANDBOX');
store.getState().configureSimulationProfile({ physicsLevel: 'BASIC', uiDetail: 'OPERATIONAL' });
store.getState().startDeploy('TOR_M1');
store.getState().handleMapClick(48.2, 31.5);
const autoBattery = store.getState().batteries.at(-1);
const autoSpawn = getDestinationPoint(48.2, 31.5, 90, 4);
const autoDestination = getDestinationPoint(autoSpawn.lat, autoSpawn.lng, 270, 20);
const autoTarget = createAirTarget({
  id: 'TOR-AUTO-UAV', type: SIMPLE_TARGET_TYPE.UAV, modelId: 'SHAHED_136',
  speedKmh: 180, altitudeM: 350, targetAltitudeM: 350,
  spawnPosition: autoSpawn, destination: autoDestination,
  route: [{ ...autoDestination, altitudeM: 350 }],
  routeType: 'DIRECT', turnRateDegPerSec: 0, sensorSignature: 0.8,
  detectability: 0.8, objectivePriority: 1,
}, store.getState().simulationTime);
store.setState({ airTargets: [autoTarget], tracks: [{ ...track,
  targetId: autoTarget.id,
  reportedPosition: { ...autoTarget.position, alt: autoTarget.altitudeM },
  reportedHeading: autoTarget.heading,
  sourceBatteryId: autoBattery.id, lastUpdateTime: store.getState().simulationTime }] });
store.getState().setBatteryControlMode(autoBattery.id, BATTERY_CONTROL_MODE.AUTO);
store.setState(state => ({ autoEngagementAttempts: {
  ...state.autoEngagementAttempts, [`${autoBattery.id}:${track.id}`]: 2,
} }));
assert.equal(store.getState().batteries.at(-1).controlMode, BATTERY_CONTROL_MODE.AUTO);
let autoQueued = false;
for (let step = 0; step < 600 && !autoQueued; step += 1) {
  store.getState().tick();
  autoQueued = store.getState().events.some(event => event.type === 'INTERCEPTOR_QUEUED'
    && event.details.batteryId === autoBattery.id
    && event.details.requestedBy === BATTERY_CONTROL_MODE.AUTO);
}
assert.ok(autoQueued, `AUTO mode queues a Tor engagement: ${JSON.stringify({
  trackStates: store.getState().tracks.map(item => [item.state, item.trackQuality]),
  autoDecision: store.getState().batteries.at(-1).autoDecision,
  autoStatus: store.getState().batteries.at(-1).autoStatus,
  events: store.getState().events.slice(-4).map(item => item.type),
})}`);
for (let step = 0; step < 600 && store.getState().airTargets.some(item => item.id === autoTarget.id); step += 1) {
  store.getState().tick();
}
assert.ok(store.getState().events.some(event => event.type === 'TARGET_INTERCEPTED'
  && event.details?.targetId === autoTarget.id), 'AUTO Tor intercepts an approaching UAV');

console.log('Tor-M1 gameplay checks passed:', {
  ignitionSec: ignition.ignition,
  maxAltitudeM: Math.round(Math.max(...samples.map(sample => sample.altitude))),
  phases: [...new Set(samples.map(sample => sample.cold))],
  autoIntercept: true,
});
