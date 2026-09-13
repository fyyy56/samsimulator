import assert from 'node:assert/strict';
import {
  AIR_TARGET_GAMEPLAY_PROFILES,
  ROUTE_PATTERN,
  SIMPLE_TARGET_TYPE,
} from '../src/data/airTargetProfiles.js';
import { advanceAirTarget, createAirTarget } from '../src/store/airTargetSystem.js';
import { getDistanceKm } from '../src/store/geo.js';
import { getRouteDiagnostics } from '../src/store/routeGenerator.js';
import {
  createManualTargetDefinitions,
  createMassRaidScenario,
} from '../src/store/scenarios.js';
import {
  ageSensorEvidenceContact,
  applySensorScanOpportunities,
  getTargetSensorProfile,
  SENSOR_EVIDENCE_STAGE,
} from '../src/store/sensorDetection.js';
import { TRACK_STATE } from '../src/store/trackSystem.js';

const headingDelta = (first, second) => Math.abs((((second - first) + 540) % 360) - 180);

const observedPatterns = new Set();
let checkedTargetCount = 0;
let groupedDefinitions = null;
let altitudeDefinition = null;

for (let seed = 1; seed <= 40; seed += 1) {
  const scenario = createMassRaidScenario(seed);
  scenario.targets.forEach(definition => {
    checkedTargetCount += 1;
    observedPatterns.add(definition.routeType);
    observedPatterns.add(definition.baseRouteType);
    assert.ok(definition.route.length <= 5, `${definition.id} has too many waypoints`);

    const diagnostics = getRouteDiagnostics(definition.spawnPosition, definition.route);
    assert.ok(
      diagnostics.maximumTurnDeg <= definition.routeCorridor.maximumTurnAngleDeg + 0.01,
      `${definition.id} exceeds its route turn limit`,
    );

    let previousDistanceKm = getDistanceKm(
      definition.spawnPosition.lat,
      definition.spawnPosition.lng,
      definition.destination.lat,
      definition.destination.lng,
    );
    definition.route.forEach(waypoint => {
      const remainingDistanceKm = getDistanceKm(
        waypoint.lat,
        waypoint.lng,
        definition.destination.lat,
        definition.destination.lng,
      );
      assert.ok(
        remainingDistanceKm <= previousDistanceKm + 0.05,
        `${definition.id} backtracks away from its destination`,
      );
      previousDistanceKm = remainingDistanceKm;
    });

    if (!groupedDefinitions && definition.groupSize > 1) {
      groupedDefinitions = scenario.targets.filter(candidate => (
        candidate.routePlanId === definition.routePlanId
      ));
    }
    if (
      !altitudeDefinition
      && definition.altitudeProfile
      && definition.altitudeProfile.startAltitudeM !== definition.altitudeProfile.cruiseAltitudeM
    ) altitudeDefinition = definition;
  });
}

for (const pattern of [
  ROUTE_PATTERN.DIRECT,
  ROUTE_PATTERN.OFFSET,
  ROUTE_PATTERN.WEAVING,
  ROUTE_PATTERN.GROUP,
  ROUTE_PATTERN.CRUISE,
]) assert.ok(observedPatterns.has(pattern), `${pattern} was not generated`);

assert.ok(groupedDefinitions?.length > 1, 'No grouped route was generated');
assert.equal(
  new Set(groupedDefinitions.map(definition => (
    `${definition.spawnPosition.lat.toFixed(5)}:${definition.spawnPosition.lng.toFixed(5)}`
  ))).size,
  groupedDefinitions.length,
  'Grouped targets overlap at spawn',
);

let altitudeTarget = createAirTarget(altitudeDefinition, 0);
const initialAltitudeM = altitudeTarget.altitudeM;
for (let tick = 0; tick < 900 && altitudeTarget.state === 'ALIVE'; tick += 1) {
  const previousHeading = altitudeTarget.heading;
  altitudeTarget = advanceAirTarget(altitudeTarget, 0.5);
  assert.ok(
    headingDelta(previousHeading, altitudeTarget.heading)
      <= altitudeDefinition.turnRateDegPerSec * 0.5 + 0.001,
    `${altitudeDefinition.id} turns faster than its profile allows`,
  );
}
assert.notEqual(Math.round(altitudeTarget.altitudeM), Math.round(initialAltitudeM));

const ballisticDefinition = createManualTargetDefinitions({
  type: SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE,
  count: 1,
  speedKmh: 6_000,
  altitudeM: 250,
  startPosition: { lat: 44.4, lng: 35.8 },
  objectiveId: 'KYIV',
  seed: 410,
  idStart: 1,
})[0];
let ballisticTarget = createAirTarget(ballisticDefinition, 0);
const ballisticHeading = ballisticTarget.heading;
for (let tick = 0; tick < 120 && ballisticTarget.state === 'ALIVE'; tick += 1) {
  ballisticTarget = advanceAirTarget(ballisticTarget, 0.5);
  assert.equal(headingDelta(ballisticHeading, ballisticTarget.heading), 0);
}

const sensorBattery = {
  id: 'TEST-RADAR',
  category: 'SHORT',
  status: 'ACTIVE',
  operational: true,
  radarRangeKm: 100,
  radarSector: 360,
  radarHeading: 0,
  radarScanType: 'MECHANICAL_ROTATION',
  components: {
    radar: { id: 'TEST-RADAR-SENSOR', lat: 48, lng: 31, operational: true },
    launchers: [],
  },
};

const makeSensorTarget = ({ id, type, lng, altitudeM }) => ({
  id,
  type,
  position: { lat: 48, lng },
  altitudeM,
  sensorSignature: AIR_TARGET_GAMEPLAY_PROFILES[type].sensorSignature,
});

const scansUntil = (target, wantedStage) => {
  const stageRank = { DETECTED: 1, TRACKED: 2, IDENTIFIED: 3 };
  let contact = null;
  for (let scan = 1; scan <= 40; scan += 1) {
    const result = applySensorScanOpportunities({
      existingContact: contact,
      battery: sensorBattery,
      target,
      opportunityCount: 1,
      simulationTime: scan,
    });
    contact = result.contact;
    if ((stageRank[contact.stage] ?? 0) >= stageRank[wantedStage]) {
      return { scan, contact };
    }
  }
  throw new Error(`${target.id} did not reach ${wantedStage}`);
};

const closeLowUav = makeSensorTarget({
  id: 'CLOSE-UAV',
  type: SIMPLE_TARGET_TYPE.UAV,
  lng: 31.05,
  altitudeM: 120,
});
const farLowUav = makeSensorTarget({
  id: 'FAR-UAV',
  type: SIMPLE_TARGET_TYPE.UAV,
  lng: 31.45,
  altitudeM: 120,
});
const closeCruise = makeSensorTarget({
  id: 'CLOSE-CRUISE',
  type: SIMPLE_TARGET_TYPE.CRUISE_MISSILE,
  lng: 31.05,
  altitudeM: 120,
});
const closeMediumUav = { ...closeLowUav, id: 'MEDIUM-UAV', altitudeM: 5_000 };

const closeUavDetection = scansUntil(closeLowUav, SENSOR_EVIDENCE_STAGE.DETECTED);
const farUavDetection = scansUntil(farLowUav, SENSOR_EVIDENCE_STAGE.DETECTED);
const cruiseDetection = scansUntil(closeCruise, SENSOR_EVIDENCE_STAGE.DETECTED);
const mediumUavDetection = scansUntil(closeMediumUav, SENSOR_EVIDENCE_STAGE.DETECTED);
assert.ok(farUavDetection.scan > closeUavDetection.scan);
assert.ok(cruiseDetection.scan < closeUavDetection.scan);
assert.ok(mediumUavDetection.scan <= closeUavDetection.scan);

const trackedUav = scansUntil(closeLowUav, SENSOR_EVIDENCE_STAGE.TRACKED);
const lostAtTime = trackedUav.contact.lastScanTime + 10;
const agedContact = ageSensorEvidenceContact(trackedUav.contact, lostAtTime, 10);
const reacquired = applySensorScanOpportunities({
  existingContact: agedContact,
  battery: sensorBattery,
  target: closeLowUav,
  opportunityCount: 1,
  simulationTime: lostAtTime + 1,
  existingTrack: { state: TRACK_STATE.LOST, lastUpdateTime: trackedUav.contact.lastScanTime },
});
assert.ok(reacquired.observation, 'Recent LOST contact was not reacquired on the next scan');
assert.equal(getTargetSensorProfile({ type: 'UNKNOWN' }).radarSignature, 0.58);

console.log(JSON.stringify({
  checkedTargetCount,
  patterns: [...observedPatterns].sort(),
  closeUavDetectedOnScan: closeUavDetection.scan,
  farUavDetectedOnScan: farUavDetection.scan,
  cruiseDetectedOnScan: cruiseDetection.scan,
  mediumAltitudeUavDetectedOnScan: mediumUavDetection.scan,
  reacquisitionStage: reacquired.observation.stage,
}, null, 2));
