import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { SIMPLE_TARGET_TYPE } from '../src/data/airTargetProfiles.js';
import { createAirTarget } from '../src/store/airTargetSystem.js';
import { BATTERY_CONTROL_MODE } from '../src/store/autoDefense.js';
import { PHYSICS_UPDATE_HZ, useEngine } from '../src/store/engine.js';
import { getDestinationPoint } from '../src/store/geo.js';
import { TRACK_STATE } from '../src/store/trackSystem.js';
import {
  samplePerformance,
  setPerformanceMonitoringEnabled,
} from '../src/store/performanceMonitor.js';

const store = useEngine;
const clone = value => structuredClone(value);

const deployBattery = (category, lat, lng) => {
  store.getState().startDeploy(category);
  store.getState().handleMapClick(lat, lng);
  if (store.getState().deployPhase === 'RADAR_HEADING') {
    store.getState().confirmRadarHeading();
  }
  store.getState().handleMapClick(lat - 0.015, lng - 0.02);
  store.getState().handleMapClick(lat + 0.015, lng + 0.02);
};

const createFixture = ({ targetCount, missileCount, radarCount = 9 }) => {
  store.getState().resetScenario('SANDBOX');
  store.getState().configureSimulationProfile({ physicsLevel: 'BASIC', uiDetail: 'OPERATIONAL' });
  const categories = Array.from(
    { length: radarCount },
    (_, index) => index % 2 === 0 ? 'MEDIUM' : 'SHORT',
  );
  categories.forEach((category, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    deployBattery(category, 48.7 + row * 0.22, 29.4 + column * 0.32);
  });
  ['RADAR_P18', 'RADAR_35D6', 'RADAR_79K6'].forEach((profileId, index) => {
    store.getState().startDeploy(profileId);
    store.getState().handleMapClick(48.82 + index * 0.08, 29.68 + index * 0.1);
  });
  store.getState().setAllBatteriesControlMode(BATTERY_CONTROL_MODE.ASSIST);

  const batteries = store.getState().batteries;
  assert.equal(batteries.filter(battery => battery.components.radar).length, radarCount);
  assert.equal(store.getState().searchRadars.length, 3);
  const origin = batteries[0].components.radar;
  const targets = [];
  const tracks = [];
  for (let index = 0; index < targetCount; index += 1) {
    const bearing = 5 + (index * 347 / targetCount);
    const spawnPosition = getDestinationPoint(origin.lat, origin.lng, bearing, 14 + (index % 9) * 1.2);
    const destination = getDestinationPoint(spawnPosition.lat, spawnPosition.lng, bearing, 120);
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
      sourceBatteryId: batteries[0].id,
    });
  }
  store.setState({ airTargets: targets, tracks });

  if (missileCount > 0) {
    const battery = batteries[0];
    store.getState().setBatteryControlMode(battery.id, BATTERY_CONTROL_MODE.MANUAL);
    const templateMissileId = store.getState().queueEngagement(battery.id, tracks[0].id);
    for (let step = 0; step < 120 && !store.getState().missiles.length; step += 1) {
      store.getState().tick(1);
    }
    const templateMissile = store.getState().missiles.find(missile => missile.id === templateMissileId);
    assert.ok(templateMissile, 'Performance fixture missile must launch');
    const missiles = Array.from({ length: missileCount }, (_, index) => ({
      ...clone(templateMissile),
      id: `PERF-MSL-${index}`,
      targetId: targets[index].id,
      trackId: tracks[index].id,
      guidance: {
        ...clone(templateMissile.guidance),
        trackId: tracks[index].id,
        targetId: targets[index].id,
        reportedPosition: { ...tracks[index].reportedPosition },
      },
    }));
    store.setState({ missiles, pendingLaunches: [], launchQueue: [] });
    store.getState().setAllBatteriesControlMode(BATTERY_CONTROL_MODE.ASSIST);
  }

  const state = store.getState();
  return clone({
    simulationTime: state.simulationTime,
    batteries: state.batteries,
    searchRadars: state.searchRadars,
    airTargets: state.airTargets,
    tracks: state.tracks,
    sensorContacts: state.sensorContacts,
    missiles: state.missiles,
    launchQueue: state.launchQueue,
    pendingLaunches: state.pendingLaunches,
    gunEngagements: state.gunEngagements,
    gunTracers: state.gunTracers,
    events: state.events,
    nextAutoDecisionTime: state.simulationTime,
    nextTrackSequence: state.nextTrackSequence,
    nextMissileSequence: state.nextMissileSequence,
    nextEventSequence: state.nextEventSequence,
    spawnedTargetIds: state.spawnedTargetIds,
    announcedGroupIds: state.announcedGroupIds,
    autoEngagementAttempts: state.autoEngagementAttempts,
  });
};

const run = (fixture, timeScale) => {
  store.setState({ ...clone(fixture), timeScale });
  setPerformanceMonitoringEnabled(true);
  const durations = [];
  const tickCount = PHYSICS_UPDATE_HZ * timeScale;
  for (let step = 0; step < tickCount; step += 1) {
    const startedAt = performance.now();
    store.getState().tick(timeScale);
    durations.push(performance.now() - startedAt);
  }
  const totalMs = durations.reduce((sum, duration) => sum + duration, 0);
  const profile = samplePerformance();
  const activeSeekerCount = store.getState().missiles.filter(missile => (
    missile.seeker?.state && missile.seeker.state !== 'OFF'
  )).length;
  setPerformanceMonitoringEnabled(false);
  return {
    timeScale,
    tickCount,
    averageTickMs: totalMs / tickCount,
    maximumTickMs: Math.max(...durations),
    cpuMsPerRealSecond: totalMs,
    cpuLoadPercentOfOneCore: totalMs / 10,
    activeSeekerCount,
    subsystems: profile.subsystems,
  };
};

const targetsOnly = createFixture({ targetCount: 39, missileCount: 0 });
const radarStress = createFixture({ targetCount: 120, missileCount: 0, radarCount: 10 });
const withMissiles = createFixture({ targetCount: 20, missileCount: 10 });
const requestedScales = process.argv.slice(2).map(Number).filter(Number.isFinite);
const scales = requestedScales.length ? requestedScales : [1, 5, 20];
const result = {
  targets39Radars9: scales.map(timeScale => run(targetsOnly, timeScale)),
  targets120Radars10: [run(radarStress, 1)],
  targets20Missiles10: scales.map(timeScale => run(withMissiles, timeScale)),
};

assert.ok(result.targets20Missiles10.every(sample => sample.averageTickMs < 10),
  'Mass seeker fixture must stay below 10 ms average fixed tick');
assert.ok(result.targets20Missiles10.every(sample => sample.activeSeekerCount >= 4),
  'Mass seeker fixture must keep several seekers active simultaneously');

console.log(JSON.stringify(result, null, 2));
