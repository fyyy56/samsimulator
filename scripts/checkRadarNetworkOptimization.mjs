import assert from 'node:assert/strict';
import {
  countRadarMeasurements,
  RADAR_SCAN_TYPE,
  selectNetworkRadarScanOpportunity,
} from '../src/store/radarSystem.js';
import { getAdaptiveVisualUpdateHz } from '../src/store/engine.js';
import { applySensorScanBatch } from '../src/store/sensorDetection.js';

const batteries = Array.from({ length: 8 }, (_, index) => ({
  id: `RADAR-${index + 1}`,
  status: 'ACTIVE',
  radarRangeKm: 180,
  radarSector: 360,
  radarHeading: 0,
  radarScanType: RADAR_SCAN_TYPE.ELECTRONIC_SECTOR,
  components: {
    radar: {
      id: `RADAR-${index + 1}-SENSOR`,
      lat: 49 + index * 0.005,
      lng: 30,
      operational: true,
      scanState: {
        previousTraversalPhase: 0,
        traversalPhase: 1,
        currentAzimuth: 0,
        direction: 1,
        scanPeriodSec: 0.1,
        beamWidthDeg: 5,
        scanType: RADAR_SCAN_TYPE.ELECTRONIC_SECTOR,
      },
    },
    launchers: [],
  },
}));

const targets = Array.from({ length: 100 }, (_, index) => ({
  id: `TARGET-${index + 1}`,
  position: {
    lat: 49 + (index % 10) * 0.03,
    lng: 30.3 + Math.floor(index / 10) * 0.025,
  },
}));

const legacyPairUpdates = targets.reduce((total, target) => (
  total + batteries.filter(battery => countRadarMeasurements(battery, target) > 0).length
), 0);
const networkUpdates = targets.filter(target => (
  selectNetworkRadarScanOpportunity(batteries, target) != null
)).length;
const preferredSourceUpdates = targets.filter(target => (
  selectNetworkRadarScanOpportunity(batteries, target, 'RADAR-4')?.battery.id === 'RADAR-4'
)).length;

assert.equal(legacyPairUpdates, 800);
assert.equal(networkUpdates, 100);
assert.equal(preferredSourceUpdates, 100);
assert.equal(legacyPairUpdates / networkUpdates, batteries.length);
assert.equal(getAdaptiveVisualUpdateHz(10), 30);
assert.equal(getAdaptiveVisualUpdateHz(25), 24);
assert.equal(getAdaptiveVisualUpdateHz(45), 20);
assert.equal(getAdaptiveVisualUpdateHz(100), 15);

const handoffTarget = {
  id: 'TARGET-HANDOFF-1',
  type: 'CRUISE_TARGET',
  modelId: 'KH_101',
  position: { lat: 49, lng: 31 },
  altitudeM: 120,
  speedKmh: 800,
  heading: 90,
};
const handoffRadars = [
  {
    ...batteries[0],
    id: 'RADAR-OLD',
    radarRangeKm: 90,
    components: {
      ...batteries[0].components,
      radar: {
        ...batteries[0].components.radar,
        id: 'RADAR-OLD-SENSOR',
        lat: 49,
        lng: 30,
        scanState: {
          ...batteries[0].components.radar.scanState,
          previousTraversalPhase: 1,
          traversalPhase: 1,
        },
      },
    },
  },
  {
    ...batteries[1],
    id: 'RADAR-NEW',
    radarRangeKm: 90,
    components: {
      ...batteries[1].components,
      radar: {
        ...batteries[1].components.radar,
        id: 'RADAR-NEW-SENSOR',
        lat: 49,
        lng: 31.1,
        scanState: {
          ...batteries[1].components.radar.scanState,
          previousTraversalPhase: 0,
          traversalPhase: 1,
        },
      },
    },
  },
];
const handoffOpportunity = selectNetworkRadarScanOpportunity(
  handoffRadars,
  handoffTarget,
  'RADAR-OLD',
);
assert.equal(
  handoffOpportunity?.battery.id,
  'RADAR-NEW',
  'A closer radar with a real scan must take ownership when the old source cannot update',
);
const handoffTrack = {
  id: 'TRK-HANDOFF',
  targetId: handoffTarget.id,
  state: 'TRACKED',
  sourceBatteryId: 'RADAR-OLD',
  lastUpdateTime: 9.5,
  detectionEvidence: 0.7,
  classifiedType: 'CRUISE_MISSILE',
};
const handoffScan = applySensorScanBatch({
  contacts: [],
  target: handoffTarget,
  scanOpportunities: [handoffOpportunity],
  simulationTime: 10,
  existingTrack: handoffTrack,
});
assert.equal(handoffScan.observation?.sourceBatteryId, 'RADAR-NEW');
assert.ok(handoffScan.observation?.stage, 'The first valid handoff scan must refresh the shared Track');

console.log(JSON.stringify({
  targets: targets.length,
  radars: batteries.length,
  legacyPairUpdates,
  networkUpdates,
  sensorEvidenceUpdateReductionPercent: Math.round((1 - networkUpdates / legacyPairUpdates) * 100),
}, null, 2));
