import assert from 'node:assert/strict';
import {
  countRadarMeasurements,
  RADAR_SCAN_TYPE,
  selectNetworkRadarScanOpportunity,
} from '../src/store/radarSystem.js';
import { getAdaptiveVisualUpdateHz } from '../src/store/engine.js';

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

console.log(JSON.stringify({
  targets: targets.length,
  radars: batteries.length,
  legacyPairUpdates,
  networkUpdates,
  sensorEvidenceUpdateReductionPercent: Math.round((1 - networkUpdates / legacyPairUpdates) * 100),
}, null, 2));
