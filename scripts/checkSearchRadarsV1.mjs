import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { SEARCH_RADAR_PROFILES } from '../src/data/searchRadarProfiles.js';
import {
  applySensorScanBatch,
  calculateRadarDetection,
  getRadarSensorProfile,
  isRadarSensorOperational,
} from '../src/store/sensorDetection.js';
import {
  advanceRadarScan,
  countRadarMeasurements,
  createRadarScanState,
  getNetworkRadarScanOpportunities,
} from '../src/store/radarSystem.js';
import { getDestinationPoint } from '../src/store/geo.js';
import { useEngine } from '../src/store/engine.js';

const makeRadar = (profileId, sequence = 1, lat = 50, lng = 30) => {
  const profile = SEARCH_RADAR_PROFILES[profileId];
  return {
    id: `${profile.id}-${sequence}`, profileId, entityType: 'SEARCH_RADAR',
    operational: true, status: 'ACTIVE', capabilities: { radar: true, weapon: false },
    sensorProfileId: profile.sensorProfileId, radarRangeKm: profile.nominalRangeKm,
    radarSector: profile.sectorDeg, radarHeading: 0, radarScanType: profile.scanType,
    scanRateSec: profile.scanPeriodSec, radarBeamWidthDeg: profile.beamWidthDeg,
    components: { radar: {
      id: `${profile.id}-${sequence}-SENSOR`, lat, lng, operational: true,
      antennaHeightM: profile.antennaHeightM, sensorProfileId: profile.sensorProfileId,
      scanState: createRadarScanState({
        sector: profile.sectorDeg, heading: 0, scanPeriodSec: profile.scanPeriodSec,
        beamWidthDeg: profile.beamWidthDeg, scanType: profile.scanType,
      }),
    } },
  };
};

const targetAt = (id, distanceKm, altitudeM, modelId = 'KH_555', bearing = 90) => {
  const position = getDestinationPoint(50, 30, bearing, distanceKm);
  return {
    id, modelId, type: modelId === 'GERAN_2' ? 'UAV_TARGET' : 'CRUISE_TARGET',
    position, altitudeM, speedKmh: 800, heading: 270,
    velocity: { speedKmh: 800, heading: 270, verticalSpeedMps: 0 },
  };
};

const p18 = makeRadar('RADAR_P18');
const d35 = makeRadar('RADAR_35D6');
const pelikan = makeRadar('RADAR_79K6');
const highTarget = targetAt('T-HIGH', 100, 12_000);
const lowTarget = targetAt('T-LOW', 40, 100, 'GERAN_2');

// A/B/C: role differentiation and horizon-limited low altitude response.
assert.ok(calculateRadarDetection({ battery: p18, target: highTarget }).detectable,
  'A: P-18 detects a large/high target at useful early-warning range');
assert.ok(calculateRadarDetection({ battery: d35, target: highTarget }).detectable,
  'A: 35D6 detects a large/high target at useful general-purpose range');
assert.ok(getRadarSensorProfile(p18).altitudeUncertaintyMultiplier
  > getRadarSensorProfile(d35).altitudeUncertaintyMultiplier * 4,
  'A: P-18 2D altitude estimate is materially worse');
assert.ok(calculateRadarDetection({ battery: d35, target: lowTarget }).detectionScore
  > calculateRadarDetection({ battery: p18, target: lowTarget }).detectionScore,
  'B: 35D6 handles a low/small target better than P-18');
assert.ok(calculateRadarDetection({ battery: d35, target: lowTarget }).detectable,
  'B: 35D6 detects a low target inside the radio horizon');
assert.ok(calculateRadarDetection({ battery: pelikan, target: lowTarget }).detectionScore
  > calculateRadarDetection({ battery: p18, target: lowTarget }).detectionScore,
  'B/C: Pelikan handles low/small targets better than P-18');
assert.equal(calculateRadarDetection({ battery: pelikan, target: targetAt('T-HORIZON', 110, 50, 'GERAN_2') }).detectable, false,
  'C: high tier sensor cannot see through the radio horizon');

// D: three sensors contribute to one fused observation and best quality wins.
const fusion = applySensorScanBatch({
  contacts: [], target: highTarget, simulationTime: 10,
  scanOpportunities: [p18, d35, pelikan].map(battery => ({ battery, opportunityCount: 2 })),
});
assert.equal(fusion.observation?.contributingSensors.length, 3, 'D: one observation keeps three contributors');
assert.equal(fusion.observation?.bestSensorId, pelikan.components.radar.id,
  'D: the best measurement wins instead of the last measurement');

// E/F/G: active toggle, one-track association, and authoritative scan cadence.
const offRadar = { ...p18, operational: false, components: {
  radar: { ...p18.components.radar, operational: false },
} };
assert.equal(isRadarSensorOperational(offRadar), false, 'E: OFF radar produces no sensor work');
assert.equal(getNetworkRadarScanOpportunities([offRadar], highTarget, getRadarSensorProfile).length, 0,
  'E: OFF radar has no scan opportunity');
assert.equal(fusion.observation.targetId, highTarget.id, 'F: fusion remains associated with one target/Track key');
const advancedP18 = { ...p18, components: { radar: {
  ...p18.components.radar,
  scanState: advanceRadarScan(p18.components.radar.scanState, p18.scanRateSec * 0.3, 360, 0),
} } };
assert.ok(countRadarMeasurements(advancedP18, targetAt('T-SWEEP', 50, 10_000, 'KH_555', 90)) >= 1,
  'G: mechanical opportunity is driven by the authoritative sweep');

const countPasses = (sourceRadar, durationSec) => {
  let radar = sourceRadar;
  let count = 0;
  const target = targetAt('T-CADENCE', 50, 10_000, 'KH_555', 90);
  for (let elapsed = 0; elapsed < durationSec; elapsed += 0.05) {
    const scanState = advanceRadarScan(
      radar.components.radar.scanState, 0.05, radar.radarSector, radar.radarHeading,
    );
    radar = { ...radar, components: { radar: { ...radar.components.radar, scanState } } };
    count += countRadarMeasurements(radar, target, getRadarSensorProfile(radar));
  }
  return count;
};
const p18Passes = countPasses(p18, 20);
const d35Passes = countPasses(d35, 20);
assert.equal(p18Passes, 2, 'P-18 completes about two revolutions in 20 seconds');
assert.equal(d35Passes, 4, '35D6 crosses a bearing twice as often as P-18');

// Runtime deployment path: both entries create radar-only entities with their
// own sensor profiles and can never enter the weapon engagement path.
for (const [profileId, lat] of [['RADAR_P18', 50], ['RADAR_35D6', 50.1]]) {
  useEngine.getState().startDeploy(profileId);
  assert.equal(useEngine.getState().deployPhase, 'SEARCH_RADAR');
  useEngine.getState().handleMapClick(lat, 30);
}
const deployedSearchRadars = useEngine.getState().searchRadars;
assert.equal(deployedSearchRadars.length, 2);
for (const radar of deployedSearchRadars) {
  const profile = SEARCH_RADAR_PROFILES[radar.profileId];
  assert.ok(profile, `Unknown deployed search radar profile: ${radar.profileId}`);
  assert.deepEqual(radar.capabilities, { radar: true, weapon: false });
  assert.equal(radar.sensorProfileId, profile.sensorProfileId);
  assert.equal(radar.components.radar.sensorProfileId, profile.sensorProfileId);
  assert.equal(radar.components.radar.operational, true);
  assert.equal('interceptorSpecId' in radar, false);
  assert.equal('gunSpecId' in radar, false);
}

// 120 targets / 10 radars: bounded shared batch, no per-entity timers.
const radars = Array.from({ length: 10 }, (_, index) => {
  const radar = makeRadar(['RADAR_P18', 'RADAR_35D6', 'RADAR_79K6'][index % 3], index + 1);
  return { ...radar, components: { radar: {
    ...radar.components.radar,
    scanState: { ...radar.components.radar.scanState, previousTraversalPhase: 0, traversalPhase: 1.1 },
  } } };
});
const targets = Array.from({ length: 120 }, (_, index) => targetAt(
  `LOAD-${index}`, 25 + (index % 12) * 8, 3_000 + (index % 4) * 2_000,
));
const start = performance.now();
let opportunityTotal = 0;
for (const target of targets) {
  opportunityTotal += getNetworkRadarScanOpportunities(radars, target, getRadarSensorProfile).length;
}
const elapsedMs = performance.now() - start;
assert.ok(elapsedMs < 250, `load pass should remain bounded, got ${elapsedMs.toFixed(1)} ms`);

console.log(JSON.stringify({
  profiles: Object.keys(SEARCH_RADAR_PROFILES), fusedSensors: fusion.observation.contributingSensors,
  bestSensor: fusion.observation.bestSensorId,
  cadence: { p18Passes, d35Passes },
  loadCase: { targets: 120, radars: 10, opportunityTotal, elapsedMs },
}, null, 2));
