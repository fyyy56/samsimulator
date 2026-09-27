import assert from 'node:assert/strict';
import { useEngine } from '../src/store/engine.js';
import { BATTERY_CONTROL_MODE } from '../src/store/autoDefense.js';
import { getDestinationPoint, getDistanceKm } from '../src/store/geo.js';
import { createInterceptorGuidance } from '../src/store/interceptorGuidance.js';
import { estimateTargetState } from '../src/store/missileGuidanceCore.js';
import { canManualLaunch } from '../src/store/engagement.js';
import { createAirTarget } from '../src/store/airTargetSystem.js';
import { SIMPLE_TARGET_TYPE } from '../src/data/airTargetProfiles.js';
import { INTERCEPT_FEASIBILITY } from '../src/store/interceptFeasibility.js';

// A mechanical radar's coasted position is already at the simulation clock.
const origin = { lat: 48.2, lng: 31.5 };
const predicted = getDestinationPoint(origin.lat, origin.lng, 90, 1);
const coasted = { id: 'TRK-COAST', targetId: 'COAST-TARGET', state: 'TRACKED',
  reportedPosition: { ...predicted, alt: 1000 }, reportedAltitudeM: 1000,
  reportedHeading: 90, reportedSpeedKmh: 360, lastUpdateTime: 0,
  lastPredictionTime: 10 };
const guidance = createInterceptorGuidance(coasted, 10);
const targetAtNow = estimateTargetState(guidance, 10);
assert.ok(getDistanceKm(targetAtNow.position.lat, targetAtNow.position.lng,
  predicted.lat, predicted.lng) < 0.001, 'guidance must not double-extrapolate a coasted Track');

useEngine.getState().resetScenario('SANDBOX');
useEngine.getState().configureSimulationProfile({ physicsLevel: 'BASIC', uiDetail: 'OPERATIONAL' });
useEngine.getState().startDeploy('LONG');
useEngine.getState().handleMapClick(origin.lat, origin.lng);
if (useEngine.getState().deployPhase === 'RADAR_HEADING') {
  useEngine.getState().rotateRadar(90);
  useEngine.getState().confirmRadarHeading();
}
useEngine.getState().handleMapClick(origin.lat, origin.lng - 0.01);
useEngine.getState().handleMapClick(origin.lat, origin.lng + 0.01);
const patriot = useEngine.getState().batteries.at(-1);
assert.ok(patriot && patriot.missilesLeft > 0, 'Patriot fixture has ammunition');
useEngine.getState().setBatteryControlMode(patriot.id, BATTERY_CONTROL_MODE.MANUAL);
assert.equal(canManualLaunch(useEngine.getState().batteries.at(-1), null), false);
assert.equal(useEngine.getState().queueEngagement(patriot.id, null, BATTERY_CONTROL_MODE.MANUAL), undefined,
  'Patriot cannot fire without a radar Track point');
const spawnPosition = getDestinationPoint(origin.lat, origin.lng, 90, 15);
const destination = getDestinationPoint(spawnPosition.lat, spawnPosition.lng, 90, 100);
const target = createAirTarget({ id: 'PATRIOT-MANUAL-TARGET',
  type: SIMPLE_TARGET_TYPE.UAV, modelId: 'GERAN_2', speedKmh: 220,
  altitudeM: 1000, targetAltitudeM: 1000, spawnPosition, destination,
  route: [{ ...destination, altitudeM: 1000 }], routeType: 'DIRECT',
  turnRateDegPerSec: 0, sensorSignature: 0.8, detectability: 0.8,
  objectivePriority: 1 }, useEngine.getState().simulationTime);
const radarTrack = { ...coasted, id: 'TRK-PATRIOT-MANUAL', targetId: target.id,
  reportedPosition: { ...target.position, alt: target.altitudeM },
  reportedAltitudeM: target.altitudeM, reportedHeading: target.heading,
  reportedSpeedKmh: target.speedKmh,
  lastUpdateTime: useEngine.getState().simulationTime,
  lastPredictionTime: useEngine.getState().simulationTime,
  lastMeasuredPosition: { ...target.position, alt: target.altitudeM },
  sourceRadarId: patriot.components.radar.id };
useEngine.setState({ airTargets: [target], tracks: [radarTrack] });
assert.equal(canManualLaunch(useEngine.getState().batteries.at(-1), radarTrack), true);
assert.equal(canManualLaunch(useEngine.getState().batteries.at(-1), {
  ...radarTrack, sourceRadarId: 'IDEAL-SENSOR-IDEAL',
}), false, 'an ideal-sensor point is not a radar Track point');
useEngine.setState({ tracks: [{ ...radarTrack, sourceRadarId: 'IDEAL-SENSOR-IDEAL' }] });
assert.equal(useEngine.getState().queueEngagement(patriot.id, radarTrack.id, BATTERY_CONTROL_MODE.MANUAL),
  undefined, 'a synthetic ideal track cannot authorize manual fire');
useEngine.setState({ tracks: [radarTrack] });
const id = useEngine.getState().queueEngagement(patriot.id, radarTrack.id, BATTERY_CONTROL_MODE.MANUAL);
assert.ok(id, 'manual Patriot fire is accepted from the last radar Track point');
assert.equal(useEngine.getState().launchQueue.at(-1).trackId, radarTrack.id);
for (let step = 0; step < 120; step += 1) useEngine.getState().tick();
const launched = useEngine.getState().missiles.find(item => item.id === id);
assert.ok(launched, 'manual shot enters the shared missile simulation');
assert.equal(launched.seeker?.guidanceSource, 'NETWORK_TRACK');
const missileEvents = useEngine.getState().missileLog.find(entry => entry.id === id)?.events ?? [];
assert.ok(missileEvents.some(event => event.type === 'MISSILE_TRACK_SOURCE'),
  'radar source transition is recorded');
assert.ok(missileEvents.some(event => event.type === 'MISSILE_PREDICTED_INTERCEPT'),
  'intercept prediction transition is recorded');
assert.ok(missileEvents.filter(event => event.type === 'MISSILE_PREDICTED_INTERCEPT').length <= 3,
  'prediction logging stays bounded when solution status oscillates');
const remotePosition = getDestinationPoint(origin.lat, origin.lng, 90, 180);
const remoteDestination = getDestinationPoint(remotePosition.lat, remotePosition.lng, 90, 100);
const remoteTarget = createAirTarget({ id: 'PATRIOT-REMOTE-TARGET',
  type: SIMPLE_TARGET_TYPE.UAV, modelId: 'GERAN_2', speedKmh: 220,
  altitudeM: 1000, targetAltitudeM: 1000, spawnPosition: remotePosition,
  destination: remoteDestination,
  route: [{ ...remoteDestination, altitudeM: 1000 }], routeType: 'DIRECT',
  turnRateDegPerSec: 0, sensorSignature: 0.8, detectability: 0.8,
  objectivePriority: 1 }, useEngine.getState().simulationTime);
const remoteTrack = { ...radarTrack, id: 'TRK-PATRIOT-REMOTE',
  targetId: remoteTarget.id,
  reportedPosition: { ...remoteTarget.position, alt: remoteTarget.altitudeM },
  lastMeasuredPosition: { ...remoteTarget.position, alt: remoteTarget.altitudeM },
  lastUpdateTime: useEngine.getState().simulationTime,
  lastPredictionTime: useEngine.getState().simulationTime };
useEngine.setState({ airTargets: [...useEngine.getState().airTargets, remoteTarget],
  tracks: [...useEngine.getState().tracks, remoteTrack] });
useEngine.getState().setBatteryControlMode(patriot.id, BATTERY_CONTROL_MODE.AUTO);
assert.equal(useEngine.getState().queueEngagement(patriot.id, remoteTrack.id, BATTERY_CONTROL_MODE.MANUAL),
  undefined, 'a manual command cannot bypass AUTO control mode');
useEngine.getState().setBatteryControlMode(patriot.id, BATTERY_CONTROL_MODE.MANUAL);
const remoteId = useEngine.getState().queueEngagement(patriot.id, remoteTrack.id, BATTERY_CONTROL_MODE.MANUAL);
assert.ok(remoteId, 'manual fire can accept an infeasible radar cue');
assert.equal(useEngine.getState().launchQueue.find(item => item.missileId === remoteId)
  .interceptSolution.status, INTERCEPT_FEASIBILITY.NO_SOLUTION);
assert.equal(useEngine.getState().queueEngagement(patriot.id, remoteTrack.id, BATTERY_CONTROL_MODE.AUTO),
  undefined, 'AUTO fire still rejects the infeasible cue');
console.log('Manual fire and coast timestamp checks passed');
