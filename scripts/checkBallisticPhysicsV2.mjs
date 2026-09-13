import assert from 'node:assert/strict';
import { SIMPLE_TARGET_TYPE } from '../src/data/airTargetProfiles.js';
import { LIGHT_TARGET_MODEL } from '../src/data/lightTargetModels.js';
import { getDestinationPoint, getDistanceKm } from '../src/store/geo.js';
import { createAirTarget, advanceAirTarget } from '../src/store/airTargetSystem.js';

const DT = 0.05;
const launchPosition = { lat: 48, lng: 28 };

const run = ({ distanceKm, angleDeg = 0, count = 0 }) => {
  const aimPoint = getDestinationPoint(launchPosition.lat, launchPosition.lng, 72, distanceKm);
  let target = createAirTarget({
    id: `BALLISTIC-${distanceKm}-${angleDeg}-${count}`,
    type: SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE,
    modelId: LIGHT_TARGET_MODEL.ISKANDER_M,
    spawnPosition: launchPosition,
    destination: aimPoint,
    route: [aimPoint],
    speedKmh: 0,
    altitudeM: 20,
    ballisticPhysics: {
      enabled: true,
      aimPoint,
      terminalCorrection: { angleDeg, count, side: 'RIGHT', seed: 42 },
    },
  }, 0);
  let previousSpeed = target.speedKmh;
  let speedChanged = false;
  let maximumInstantSpeedLossMps = 0;
  let maximumCrossTrackDeviationM = 0;
  let terminalEntryAngleDeg = null;
  let maximumLateralControlMps2 = 0;
  let maximumActiveHeadingOffsetDeg = 0;
  let maximumHeadingDeltaDeg = 0;
  const altitudeByRemainingKm = { 50: null, 25: null, 10: null };
  const solutionByRemainingKm = { 50: null, 25: null, 10: null };
  const phases = new Set([target.flightPhase]);
  for (let step = 0; step < 14_000 && target.state === 'ALIVE'; step += 1) {
    const beforeSpeedMps = target.speedKmh / 3.6;
    target = advanceAirTarget(target, DT);
    phases.add(target.flightPhase);
    maximumLateralControlMps2 = Math.max(maximumLateralControlMps2,
      Math.abs(target.ballisticPhysics.currentLateralControlMps2 ?? 0));
    if (target.ballisticPhysics.terminalCorrection.state === 'ACTIVE') {
      const nominalHeading = 72;
      const headingOffset = Math.abs(((target.heading - nominalHeading + 540) % 360) - 180);
      maximumActiveHeadingOffsetDeg = Math.max(maximumActiveHeadingOffsetDeg, headingOffset);
    }
    maximumHeadingDeltaDeg = Math.max(maximumHeadingDeltaDeg,
      Math.abs(((target.heading - 72 + 540) % 360) - 180));
    if (target.verticalSpeedMps < 0) {
      for (const thresholdKm of [50, 25, 10]) {
        if (altitudeByRemainingKm[thresholdKm] === null
          && target.ballisticPhysics.distanceToAimPointKm <= thresholdKm) {
          altitudeByRemainingKm[thresholdKm] = target.altitudeM;
          solutionByRemainingKm[thresholdKm] = target.ballisticPhysics.terminalSolution;
        }
      }
    }
    const afterSpeedMps = target.speedKmh / 3.6;
    maximumInstantSpeedLossMps = Math.max(maximumInstantSpeedLossMps, beforeSpeedMps - afterSpeedMps);
    if (Math.abs(target.speedKmh - previousSpeed) > 0.01) speedChanged = true;
    previousSpeed = target.speedKmh;
    if (terminalEntryAngleDeg === null && target.flightPhase === 'TERMINAL') {
      terminalEntryAngleDeg = target.ballisticPhysics.flightPathAngleDeg;
    }
    const nominalBearing = 72;
    const alongTrackKm = getDistanceKm(launchPosition.lat, launchPosition.lng,
      target.position.lat, target.position.lng);
    const nominalPoint = getDestinationPoint(launchPosition.lat, launchPosition.lng,
      nominalBearing, alongTrackKm);
    maximumCrossTrackDeviationM = Math.max(maximumCrossTrackDeviationM,
      getDistanceKm(nominalPoint.lat, nominalPoint.lng, target.position.lat, target.position.lng) * 1000);
  }
  const physics = target.ballisticPhysics;
  return {
    distanceKm,
    angleDeg,
    count,
    completed: target.state === 'COMPLETED',
    timeOfFlightSec: physics.timeOfFlightSec,
    apogeeM: physics.apogeeReachedM,
    impactErrorM: getDistanceKm(target.position.lat, target.position.lng,
      aimPoint.lat, aimPoint.lng) * 1000,
    rangeErrorM: (getDistanceKm(launchPosition.lat, launchPosition.lng,
      target.position.lat, target.position.lng) - distanceKm) * 1000,
    predictedImpactErrorM: physics.impactErrorMeters,
    terminalEntryAngleDeg,
    finalAngleDeg: physics.flightPathAngleDeg,
    finalSpeedMps: physics.totalSpeedMps,
    maximumInstantSpeedLossMps,
    maximumCrossTrackDeviationM,
    correctionsUsed: physics.terminalCorrection.used,
    correctionState: physics.terminalCorrection.state,
    aimPointStable: physics.aimPoint.lat === aimPoint.lat && physics.aimPoint.lng === aimPoint.lng,
    maximumLateralControlMps2,
    maximumActiveHeadingOffsetDeg,
    maximumHeadingDeltaDeg,
    altitudeByRemainingKm,
    solutionByRemainingKm,
    phaseSequence: [...phases],
    speedChanged,
  };
};

const cases = [
  run({ distanceKm: 60 }),
  run({ distanceKm: 190 }),
  run({ distanceKm: 330 }),
  run({ distanceKm: 380 }),
  run({ distanceKm: 330, angleDeg: 1, count: 1 }),
  run({ distanceKm: 330, angleDeg: 2, count: 1 }),
  run({ distanceKm: 330, angleDeg: 1, count: 2 }),
];

console.table(cases.map(result => ({
  rangeKm: result.distanceKm,
  correction: `${result.angleDeg}° × ${result.count}`,
  completed: result.completed,
  tofSec: Number(result.timeOfFlightSec.toFixed(1)),
  apogeeKm: Number((result.apogeeM / 1000).toFixed(1)),
  terminalAngleDeg: Number((result.terminalEntryAngleDeg ?? 0).toFixed(1)),
  impactAngleDeg: Number(result.finalAngleDeg.toFixed(1)),
  impactErrorM: Number(result.impactErrorM.toFixed(0)),
  rangeErrorM: Number(result.rangeErrorM.toFixed(0)),
  predictedErrorM: Number(result.predictedImpactErrorM.toFixed(0)),
  deviationM: Number(result.maximumCrossTrackDeviationM.toFixed(0)),
  corrections: result.correctionsUsed,
  lateralControl: Number(result.maximumLateralControlMps2.toFixed(2)),
  headingOffset: Number(result.maximumActiveHeadingOffsetDeg.toFixed(2)),
  finalSpeedMps: Number(result.finalSpeedMps.toFixed(0)),
  altitude50Km: result.altitudeByRemainingKm[50] == null ? null
    : Number((result.altitudeByRemainingKm[50] / 1000).toFixed(1)),
  altitude25Km: result.altitudeByRemainingKm[25] == null ? null
    : Number((result.altitudeByRemainingKm[25] / 1000).toFixed(1)),
  altitude10Km: result.altitudeByRemainingKm[10] == null ? null
    : Number((result.altitudeByRemainingKm[10] / 1000).toFixed(1)),
  solutions: `50:${result.solutionByRemainingKm[50]} 25:${result.solutionByRemainingKm[25]} 10:${result.solutionByRemainingKm[10]}`,
})));

for (const result of cases) {
  assert.equal(result.completed, true, `${result.distanceKm}km shot completes`);
  assert.equal(result.speedChanged, true, 'speed must be physics-derived, not constant');
  assert.ok(result.apogeeM > 3_000, 'trajectory has a physical apogee');
  assert.ok(result.maximumInstantSpeedLossMps < 20, 'correction does not snap away energy');
  assert.ok(result.impactErrorM < 15_000, `impact remains controlled (${result.impactErrorM.toFixed(0)}m)`);
  assert.equal(result.aimPointStable, true, 'terminal manoeuvre never mutates aim point');
  assert.ok(result.maximumHeadingDeltaDeg < 90, 'ballistic target never turns back toward aim point');
}
assert.ok(cases[0].apogeeM < cases[1].apogeeM
  && cases[1].apogeeM < cases[2].apogeeM
  && cases[2].apogeeM < cases[3].apogeeM,
  'apogee grows with launch distance');
assert.ok(cases[2].impactErrorM < 5_000, '330km shot converges to a controlled ground impact');
assert.ok(cases[2].altitudeByRemainingKm[10] < 10_000,
  '330km shot descends below 10km before reaching the final 10km');
for (const phase of ['BOOST', 'ASCENT', 'MIDCOURSE', 'DESCENT', 'TERMINAL', 'IMPACT']) {
  assert.ok(cases[2].phaseSequence.includes(phase), `330km shot includes ${phase}`);
}
assert.equal(cases[4].correctionsUsed, 1, '1 degree correction executes once');
assert.equal(cases[5].correctionsUsed, 1, '2 degree correction executes once');
assert.equal(cases[6].correctionsUsed, 2, 'two corrections execute');
assert.ok(cases[5].maximumLateralControlMps2 >= cases[4].maximumLateralControlMps2,
  '2 degree correction requires at least as much control authority as 1 degree');
assert.ok(cases[5].maximumActiveHeadingOffsetDeg >= cases[4].maximumActiveHeadingOffsetDeg,
  '2 degree correction is not weaker than 1 degree under control saturation');

let benchmarkTargets = Array.from({ length: 100 }, (_, index) => {
  const aimPoint = getDestinationPoint(launchPosition.lat, launchPosition.lng, 72, 190 + index % 5);
  return createAirTarget({
    id: `BENCH-${index}`,
    type: SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE,
    modelId: LIGHT_TARGET_MODEL.ISKANDER_M,
    spawnPosition: launchPosition,
    destination: aimPoint,
    route: [aimPoint],
    speedKmh: 0,
    altitudeM: 20,
    ballisticPhysics: { enabled: true, aimPoint,
      terminalCorrection: { angleDeg: index % 3, count: 1, side: 'AUTO', seed: index } },
  }, 0);
});
const benchmarkStart = performance.now();
for (let tick = 0; tick < 200; tick += 1) {
  benchmarkTargets = benchmarkTargets.map(target => advanceAirTarget(target, DT));
}
const benchmarkElapsedMs = performance.now() - benchmarkStart;
console.log('Ballistic physics benchmark:', {
  targets: benchmarkTargets.length,
  ticks: 200,
  totalMs: Number(benchmarkElapsedMs.toFixed(2)),
  microsecondsPerTargetTick: Number((benchmarkElapsedMs * 1000 / 20_000).toFixed(3)),
});
