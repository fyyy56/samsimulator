import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  SENSOR_EVIDENCE_STAGE,
  applySensorScanBatch,
  applySensorScanOpportunities,
  calculateRadarDetection,
} from '../src/store/sensorDetection.js';
import {
  applyRadarObservation,
  applySensorEvidenceObservation,
  coastTrack,
} from '../src/store/trackSystem.js';
import {
  RADAR_SCAN_TYPE,
  calculateRadioHorizonKm,
  countRadarMeasurements,
  createRadarScanState,
  getRadarGeometry,
} from '../src/store/radarSystem.js';
import { getDestinationPoint } from '../src/store/geo.js';

const makeBattery = (id, lat, lng, category = 'MEDIUM', rangeKm = 80) => ({
  id,
  category,
  operational: true,
  status: 'ACTIVE',
  radarRangeKm: rangeKm,
  radarSector: 360,
  radarHeading: 0,
  radarScanType: RADAR_SCAN_TYPE.MECHANICAL_ROTATION,
  components: {
    radar: {
      id: `${id}-RADAR`, lat, lng, operational: true,
      scanState: createRadarScanState({
        sector: 360, heading: 0, scanPeriodSec: 2, beamWidthDeg: 6,
        scanType: RADAR_SCAN_TYPE.MECHANICAL_ROTATION,
      }),
    },
  },
});

const makeTarget = ({ id, modelId, type, lat, lng, altitudeM, speedKmh = 800, heading = 90 }) => ({
  id, modelId, type, position: { lat, lng }, altitudeM, speedKmh, heading,
  velocity: { speedKmh, heading, verticalSpeedMps: 0 },
});

const battery = makeBattery('RADAR-A', 50, 30, 'MEDIUM', 80);
const highCruise = makeTarget({
  id: 'T-HIGH', modelId: 'KH_555', type: 'CRUISE_TARGET',
  lat: 50.28, lng: 30, altitudeM: 4_000,
});
const lowCruise = makeTarget({
  id: 'T-LOW', modelId: 'KALIBR', type: 'CRUISE_TARGET',
  lat: 50.72, lng: 30, altitudeM: 30,
});

assert.ok(calculateRadioHorizonKm(7, 4_000) > 80, 'high target must clear the horizon');
assert.equal(getRadarGeometry(battery, highCruise).hasLineOfSight, true, 'A: high target has LOS');
assert.equal(getRadarGeometry(battery, lowCruise).hasLineOfSight, false, 'B: low distant target is horizon masked');

const geran = makeTarget({
  id: 'T-GERAN', modelId: 'GERAN_2', type: 'UAV_TARGET',
  lat: 50.18, lng: 30, altitudeM: 250, speedKmh: 180,
});
const gerbera = { ...geran, id: 'T-GERBERA', modelId: 'GERBERA' };
const geranScore = calculateRadarDetection({ battery, target: geran }).detectionScore;
const gerberaScore = calculateRadarDetection({ battery, target: gerbera }).detectionScore;
assert.ok(geranScore > gerberaScore, 'C: Gerbera is harder to detect than Geran');

const boundaryPoint = getDestinationPoint(50, 30, 90, 79.5);
const boundaryTarget = makeTarget({
  id: 'T-BOUNDARY', modelId: 'KH_555', type: 'CRUISE_TARGET',
  lat: boundaryPoint.lat, lng: boundaryPoint.lng, altitudeM: 20_000,
});
const beyondPoint = getDestinationPoint(50, 30, 90, 80.5);
const beyondTarget = { ...boundaryTarget, id: 'T-BEYOND', position: beyondPoint };
assert.equal(getRadarGeometry(battery, boundaryTarget).insideNominalCoverage, true, 'D: target just inside range');
assert.equal(getRadarGeometry(battery, beyondTarget).insideNominalCoverage, false, 'D: target just outside range');

const sectorBattery = { ...battery, radarSector: 90, radarHeading: 0 };
const sectorEdgePoint = getDestinationPoint(50, 30, 45, 20);
const sectorOutsidePoint = getDestinationPoint(50, 30, 46, 20);
assert.equal(getRadarGeometry(sectorBattery, {
  ...highCruise, position: sectorEdgePoint,
}).insideSector, true, 'E: exact sector edge is included');
assert.equal(getRadarGeometry(sectorBattery, {
  ...highCruise, position: sectorOutsidePoint,
}).insideSector, false, 'E: outside sector edge is rejected');

const sweepPoint = getDestinationPoint(50, 30, 90, 20);
const sweepTarget = { ...highCruise, id: 'T-0', position: sweepPoint, altitudeM: 10_000 };
const sweepingBattery = makeBattery('SWEEP', 50, 30);
sweepingBattery.components.radar.scanState = {
  ...sweepingBattery.components.radar.scanState,
  previousTraversalPhase: 0.24,
  traversalPhase: 0.26,
};
assert.ok(countRadarMeasurements(sweepingBattery, sweepTarget) > 0,
  'E: mechanical measurement occurs when the authoritative sweep crosses the bearing');
sweepingBattery.components.radar.scanState = {
  ...sweepingBattery.components.radar.scanState,
  previousTraversalPhase: 0.27,
  traversalPhase: 0.3,
};
assert.equal(countRadarMeasurements(sweepingBattery, sweepTarget), 0,
  'E: mechanical radar does not update between sweep crossings');
const electronicBattery = makeBattery('ELECTRONIC', 50, 30, 'LONG', 150);
electronicBattery.radarScanType = RADAR_SCAN_TYPE.ELECTRONIC_SECTOR;
electronicBattery.components.radar.scanState = {
  ...electronicBattery.components.radar.scanState,
  scanType: RADAR_SCAN_TYPE.ELECTRONIC_SECTOR,
  previousTraversalPhase: -0.1,
  traversalPhase: 0.1,
};
assert.ok(countRadarMeasurements(electronicBattery, sweepTarget) > 0,
  'F: electronic radar produces a configured cadence opportunity');

let contact = null;
let firstObservation = null;
for (let scan = 1; scan <= 12; scan += 1) {
  const result = applySensorScanOpportunities({
    existingContact: contact,
    battery,
    target: highCruise,
    opportunityCount: 1,
    simulationTime: scan * 2,
  });
  contact = result.contact;
  firstObservation ??= result.observation;
}
assert.ok(firstObservation, 'D: repeated evidence creates a contact');
assert.equal(contact.stage, SENSOR_EVIDENCE_STAGE.IDENTIFIED, 'D: evidence reaches identification');

const repeatA = applySensorScanOpportunities({
  battery, target: highCruise, opportunityCount: 1, simulationTime: 2,
});
const repeatB = applySensorScanOpportunities({
  battery, target: highCruise, opportunityCount: 1, simulationTime: 2,
});
assert.deepEqual(
  repeatA.observation?.measurement,
  repeatB.observation?.measurement,
  'measurement error must be deterministic',
);

const establishedObservation = applySensorScanOpportunities({
  existingContact: contact,
  battery,
  target: highCruise,
  opportunityCount: 1,
  simulationTime: 26,
}).observation;
let track = applySensorEvidenceObservation({
  existingTrack: null,
  target: highCruise,
  observation: establishedObservation,
  simulationTime: 26,
  trackId: 'TRK-001',
});
const initialUncertainty = track.positionUncertaintyM;
track = coastTrack(track, 30, 4);
assert.ok(track.measurementAgeSec >= 4, 'E: measurement age increases while coasting');
assert.ok(track.positionUncertaintyM > initialUncertainty, 'E: uncertainty grows without scans');

const batteryB = makeBattery('RADAR-B', 50.02, 30.02, 'LONG', 150);
const fusion = applySensorScanBatch({
  contacts: [],
  target: highCruise,
  scanOpportunities: [
    { battery, opportunityCount: 5 },
    { battery: batteryB, opportunityCount: 5 },
  ],
  simulationTime: 10,
});
assert.equal(fusion.observation?.contributorCount, 2, 'F: two sensors contribute to fusion');
assert.ok(fusion.observation?.measurement, 'F: fused observation carries a real measurement');

const lostTrack = coastTrack(track, 40, 10, true);
assert.equal(lostTrack.state, 'LOST', 'F: stale Track enters LOST/MEMORY');
const reacquiredContact = applySensorScanOpportunities({
  existingContact: contact,
  existingTrack: lostTrack,
  battery: batteryB,
  target: highCruise,
  opportunityCount: 5,
  simulationTime: 42,
});
assert.ok(reacquiredContact.observation, 'F: another radar can reacquire the Track');

const ballisticTarget = makeTarget({
  id: 'T-BALLISTIC', modelId: 'ISKANDER_M', type: 'BALLISTIC_TARGET',
  lat: 50.35, lng: 30.15, altitudeM: 45_000, speedKmh: 4_500, heading: 210,
});
ballisticTarget.verticalSpeedMps = -420;
ballisticTarget.ballisticPhysics = { horizontalSpeedMps: 1_180 };
const ballisticScan = applySensorScanOpportunities({
  battery: batteryB,
  target: ballisticTarget,
  opportunityCount: 10,
  simulationTime: 5,
});
const ballisticTrack = applySensorEvidenceObservation({
  existingTrack: null,
  target: ballisticTarget,
  observation: ballisticScan.observation,
  simulationTime: 5,
  trackId: 'TRK-BALLISTIC',
});
assert.ok(ballisticTrack, 'G: corrected ballistic measurement creates a Track');
assert.notEqual(ballisticTrack.reportedPosition.lat, ballisticTarget.position.lat,
  'G: realistic ballistic Track does not copy true position');

const ideal = applyRadarObservation({
  existingTrack: null,
  target: highCruise,
  sourceBatteryId: 'IDEAL',
  simulationTime: 1,
  trackId: 'TRK-IDEAL',
});
assert.equal(ideal.reportedPosition.lat, highCruise.position.lat, 'IDEAL regression: exact latitude');
assert.equal(ideal.positionUncertaintyM, 0, 'IDEAL regression: no uncertainty');

const radars = Array.from({ length: 10 }, (_, index) => makeBattery(
  `PERF-${index}`, 49.5 + index * 0.04, 29.5 + index * 0.04, 'LONG', 180,
));
const targets = Array.from({ length: 120 }, (_, index) => makeTarget({
  id: `PERF-T-${index}`,
  modelId: index % 3 === 0 ? 'GERBERA' : index % 3 === 1 ? 'GERAN_2' : 'KH_555',
  type: index % 3 === 2 ? 'CRUISE_TARGET' : 'UAV_TARGET',
  lat: 49.7 + (index % 20) * 0.025,
  lng: 29.7 + Math.floor(index / 20) * 0.04,
  altitudeM: 200 + (index % 8) * 450,
  speedKmh: 180 + (index % 5) * 120,
}));
const startedAt = performance.now();
let visiblePairs = 0;
const passDurationsMs = [];
const activeTrackTargets = new Set();
for (let pass = 0; pass < 20; pass += 1) {
  const passStartedAt = performance.now();
  for (const radar of radars) for (const target of targets) {
    if (calculateRadarDetection({ battery: radar, target }).detectable) {
      visiblePairs += 1;
      activeTrackTargets.add(target.id);
    }
  }
  passDurationsMs.push(performance.now() - passStartedAt);
}
const elapsedMs = performance.now() - startedAt;
assert.ok(visiblePairs > 0, 'G: performance fixture has visible pairs');
assert.ok(elapsedMs < 1_500, `G: 120 targets × 10 radars should stay bounded (${elapsedMs.toFixed(1)}ms)`);

console.log(JSON.stringify({
  status: 'PASS',
  geranScore: Number(geranScore.toFixed(3)),
  gerberaScore: Number(gerberaScore.toFixed(3)),
  horizonLowKm: Number(calculateRadioHorizonKm(7, 30).toFixed(1)),
  performanceMs: Number(elapsedMs.toFixed(1)),
  sensorUpdateAverageMs: Number((passDurationsMs.reduce((sum, value) => sum + value, 0)
    / passDurationsMs.length).toFixed(3)),
  sensorUpdateMaximumMs: Number(Math.max(...passDurationsMs).toFixed(3)),
  measurementsPerSecondEquivalent: Math.round(visiblePairs / 20 / 2),
  activeTracks: activeTrackTargets.size,
  visiblePairs,
}, null, 2));
