import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { SIMPLE_TARGET_TYPE } from '../src/data/airTargetProfiles.js';
import { createAirTarget } from '../src/store/airTargetSystem.js';
import { useEngine } from '../src/store/engine.js';
import { getDestinationPoint } from '../src/store/geo.js';
import { TRACK_STATE } from '../src/store/trackSystem.js';

const store = useEngine;
store.getState().resetScenario('SANDBOX');
store.getState().configureSimulationProfile({ physicsLevel: 'BASIC', uiDetail: 'OPERATIONAL' });
store.getState().startDeploy('LONG');
store.getState().handleMapClick(49.23, 28.47);
store.getState().rotateRadar(90);
store.getState().confirmRadarHeading();
store.getState().handleMapClick(49.22, 28.45);
store.getState().handleMapClick(49.24, 28.49);

const battery = store.getState().batteries[0];
const launcher = battery.components.launchers[0];
const targets = [];
const tracks = [];
for (let index = 0; index < 20; index += 1) {
  const bearing = 60 + index * 2;
  const spawnPosition = getDestinationPoint(launcher.lat, launcher.lng, bearing, 38 + index * 0.25);
  const destination = getDestinationPoint(spawnPosition.lat, spawnPosition.lng, bearing, 80);
  const target = createAirTarget({
    id: `PERF-TGT-${index}`,
    type: SIMPLE_TARGET_TYPE.UAV,
    modelId: 'SHAHED_136',
    speedKmh: 220,
    altitudeM: 450,
    targetAltitudeM: 450,
    spawnPosition,
    destination,
    route: [{ ...destination, altitudeM: 450 }],
    routeType: 'DIRECT',
    turnRateDegPerSec: 0,
    sensorSignature: 0.8,
    detectability: 0.8,
    objectivePriority: 1,
  }, store.getState().simulationTime);
  targets.push(target);
  tracks.push({
    id: `TRK-PERF-${index}`,
    targetId: target.id,
    state: TRACK_STATE.IDENTIFIED,
    reportedPosition: { ...target.position, alt: target.altitudeM },
    reportedHeading: target.heading,
    reportedSpeedKmh: target.speedKmh,
    reportedAltitudeM: target.altitudeM,
    trackQuality: 1,
    lastUpdateTime: store.getState().simulationTime,
    identifiedType: target.type,
  });
}
store.setState({ airTargets: targets, tracks });

const templateMissileId = store.getState().queueEngagement(battery.id, tracks[0].id);
for (let step = 0; step < 100 && !store.getState().missiles.length; step += 1) store.getState().tick();
const templateMissile = store.getState().missiles.find(missile => missile.id === templateMissileId);
assert.ok(templateMissile, 'Performance fixture missile must launch');

const missiles = targets.map((target, index) => ({
  ...templateMissile,
  id: `PERF-MSL-${index}`,
  targetId: target.id,
  trackId: tracks[index].id,
  guidance: {
    ...templateMissile.guidance,
    trackId: tracks[index].id,
    targetId: target.id,
    reportedPosition: { ...tracks[index].reportedPosition },
  },
  trajectory: templateMissile.trajectory.map(point => ({ ...point })),
}));
store.setState({ missiles, pendingLaunches: [], launchQueue: [], timeScale: 1 });

const durations = [];
for (let step = 0; step < 240; step += 1) {
  const startedAt = performance.now();
  store.getState().tick();
  durations.push(performance.now() - startedAt);
}
const averageMs = durations.reduce((sum, value) => sum + value, 0) / durations.length;
const maximumMs = Math.max(...durations);
assert.ok(averageMs < 10, `20+20 average physics update is too slow: ${averageMs.toFixed(2)} ms`);
assert.ok(maximumMs < 50, `20+20 maximum physics update is too slow: ${maximumMs.toFixed(2)} ms`);

console.log(`20 targets + 20 missiles: avg ${averageMs.toFixed(2)} ms, max ${maximumMs.toFixed(2)} ms over ${durations.length} fixed ticks.`);
