import assert from 'node:assert/strict';
import { getInterceptorSpec } from '../src/data/interceptors.js';
import { advanceTorManualGuidance } from '../src/store/torManualSight.js';
import { useEngine } from '../src/store/engine.js';
import { SIMPLE_TARGET_TYPE } from '../src/data/airTargetProfiles.js';
import { createAirTarget } from '../src/store/airTargetSystem.js';
import { getDestinationPoint } from '../src/store/geo.js';
import { TRACK_STATE } from '../src/store/trackSystem.js';

const physics = getInterceptorSpec('INT-9M331-V1').gameplayPhysics;
const missile = {
  heading: 0, flightPathAngleDeg: 0, speedKmh: 1800,
  actualAccelerationVectorMps2: { eastMps: 0, northMps: 0, upMps: 0 },
  guidance: { guidanceSource: 'NETWORK_TRACK' },
};
const sight = { azimuthDeg: 90, elevationDeg: 12, updatedAt: 0 };
const first = advanceTorManualGuidance({ interceptor: missile, sight,
  simulationTime: 0.05, deltaTimeSec: 0.05, physics });
assert.equal(first.guidanceSource, 'TOR_MANUAL_OLS');
assert.equal(first.guidance.guidanceSource, 'TOR_MANUAL_OLS');
assert.ok(first.heading > 0 && first.heading < 2, 'missile turns gradually toward sight');
assert.ok(first.currentG <= 42, 'existing G limit remains');
const elevatedMissile = { ...missile, lat: 48.2, lng: 31.5, altitudeM: 200 };
const lineCommand = advanceTorManualGuidance({ interceptor: elevatedMissile,
  sight: { ...sight, azimuthDeg: 90, elevationDeg: 0,
    origin: { lat: 48.2, lng: 31.5, altitudeM: 8 } },
  simulationTime: 0.05, deltaTimeSec: 0.05, physics });
assert.ok(lineCommand.desiredFlightPathAngleDeg < 0,
  'missile above the OLS line is commanded back down to that line');
const cold = advanceTorManualGuidance({ interceptor: { ...missile, pitchOverHeading: 35 }, sight,
  simulationTime: 0.05, deltaTimeSec: 0.05, physics, steeringEnabled: false });
assert.equal(cold.heading, 35, 'cold launch uses pitch-over heading without steering');
assert.equal(cold.currentG, 0);
const stale = advanceTorManualGuidance({ interceptor: missile, sight,
  simulationTime: 4, deltaTimeSec: 0.05, physics });
assert.equal(stale.guidanceState, 'MANUAL_COAST');
assert.equal(stale.commandedLateralAccelerationMps2, 0);

useEngine.getState().resetScenario('SANDBOX');
useEngine.getState().configureSimulationProfile({ physicsLevel: 'BASIC', uiDetail: 'OPERATIONAL' });
useEngine.getState().startDeploy('TOR_M1');
useEngine.getState().handleMapClick(48.2, 31.5);
const battery = useEngine.getState().batteries.at(-1);
const now = useEngine.getState().simulationTime;
const spawnPosition = getDestinationPoint(48.2, 31.5, 90, 5);
const destination = getDestinationPoint(spawnPosition.lat, spawnPosition.lng, 90, 50);
const target = createAirTarget({ id: 'TOR-TEST-UAV', type: SIMPLE_TARGET_TYPE.UAV,
  modelId: 'SHAHED_136', speedKmh: 180, altitudeM: 350, targetAltitudeM: 350,
  spawnPosition, destination, route: [{ ...destination, altitudeM: 350 }],
  routeType: 'DIRECT', turnRateDegPerSec: 0, sensorSignature: 0.8,
  detectability: 0.8, objectivePriority: 1 }, now);
const track = { id: 'TRK-TOR-TEST-UAV', targetId: target.id,
  state: TRACK_STATE.IDENTIFIED,
  reportedPosition: { ...target.position, alt: target.altitudeM },
  reportedHeading: target.heading, reportedSpeedKmh: target.speedKmh,
  reportedAltitudeM: target.altitudeM, trackQuality: 1,
  consecutiveUpdates: 8, totalUpdates: 8, identifiedType: target.type,
  lastUpdateTime: now, velocity: { speedKmh: target.speedKmh, heading: target.heading } };
useEngine.setState({ airTargets: [target], tracks: [track] });
useEngine.getState().setTorManualSight(battery.id, 65, 8);
const missileId = useEngine.getState().queueTorManualSight(battery.id, track.id);
assert.ok(missileId, 'OLS manual launch is queued');
let guidedMissile;
for (let step = 0; step < 180; step += 1) {
  useEngine.getState().setTorManualSight(battery.id, 65, 8);
  useEngine.getState().tick();
  const candidate = useEngine.getState().missiles.find(item => item.id === missileId);
  if (candidate?.launchPhase === 'GUIDANCE') { guidedMissile = candidate; break; }
}
assert.ok(guidedMissile, `manual missile reaches guidance after vertical launch: ${JSON.stringify({
  missiles: useEngine.getState().missiles.map(item => [item.id, item.launchPhase,
    item.lifecycleState, item.flightTime, item.failureReason]),
  events: useEngine.getState().events.slice(-6).map(item => [item.type, item.details]),
})}`);
assert.equal(guidedMissile.manualOlsControl, true);
assert.equal(guidedMissile.guidanceSource, 'TOR_MANUAL_OLS');
assert.equal(guidedMissile.guidance.guidanceSource, 'TOR_MANUAL_OLS');
assert.ok(Math.abs(guidedMissile.pitchOverHeading - 65) < 1e-6,
  'pitch-over follows operator sight rather than radar track');
useEngine.getState().resetScenario('SANDBOX');
const start = useEngine.getState().simulationTime;
useEngine.getState().setTimeScale(0.5);
useEngine.getState().tick(0.5);
assert.ok(Math.abs(useEngine.getState().simulationTime - start - 0.05) < 1e-8,
  'shared time-scale advances one fixed tick at 0.5×');
console.log('Tor manual OLS and 0.5× checks passed');
