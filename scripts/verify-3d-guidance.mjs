import assert from 'node:assert/strict';
import { getInterceptorSpec } from '../src/data/interceptors.js';
import { getDestinationPoint, getDistanceKm } from '../src/store/geo.js';
import { advanceInterceptorFlight, applyAltitudeEnergyExchange } from '../src/store/interceptorPhysics.js';
import {
  applyMissileAutopilot,
  computeProportionalNavigation,
  solveDynamicIntercept,
} from '../src/store/missileGuidanceCore.js';

const DT = 0.05;
const DEG = Math.PI / 180;

function runScenario({ interceptorSpecId, targetRangeKm, targetAltitudeM,
  targetHeading, targetSpeedMps, targetVerticalSpeedMps, durationSec,
  initialPitchDeg = targetAltitudeM > 3000 ? 35 : 2, captureProfile = false }) {
  const physics = getInterceptorSpec(interceptorSpecId).gameplayPhysics;
  const origin = { lat: 49, lng: 28 };
  const targetOrigin = getDestinationPoint(origin.lat, origin.lng, 90, targetRangeKm);
  let target = {
    position: { ...targetOrigin, alt: targetAltitudeM },
    heading: targetHeading,
    speedMps: targetSpeedMps,
    verticalSpeedMps: targetVerticalSpeedMps,
    turnRateDegPerSec: 0,
  };
  target.velocity = velocity(targetHeading, targetSpeedMps, targetVerticalSpeedMps);
  let missile = {
    lat: origin.lat, lng: origin.lng, altitudeM: 0,
    heading: 90, flightPathAngleDeg: initialPitchDeg,
    verticalSpeedMps: 0,
    speedKmh: Math.max(physics.initialSpeedMps, 120) * 3.6,
    flightTime: 0, distanceTraveledKm: 0, energyRatio: 1,
    criticalEnergyTimeSec: 0,
  };
  let closestM = Infinity;
  let previousSolution = null;
  const samples = [];
  const remainingSampleDistancesKm = [20, 10, 5];
  for (let elapsed = 0; elapsed < durationSec; elapsed += DT) {
    const solution = solveDynamicIntercept({
      interceptor: missile, targetState: target, physics, previousSolution,
      terminal: closestM < physics.terminalRangeKm * 1000,
    });
    previousSolution = solution;
    const terminal = solution.interceptDistanceKm <= physics.terminalRangeKm;
    const command = computeProportionalNavigation({
      interceptor: missile, targetState: target, solution,
      navigationConstant: terminal
        ? physics.navigationConstantTerminal
        : physics.navigationConstantMidcourse,
      physics, terminal,
    });
    const autopilot = applyMissileAutopilot({ interceptor: missile, command, deltaTimeSec: DT, physics });
    let flight = advanceInterceptorFlight(missile, DT, physics, {
      headingChangeDeg: autopilot.turnRateDegPerSec * DT,
      headingCorrectionDeg: solution.directionErrorDeg,
      altitudeM: missile.altitudeM,
    });
    const pitchRad = autopilot.flightPathAngleDeg * DEG;
    const verticalTravelM = flight.travelDistanceKm * 1000 * Math.sin(pitchRad);
    flight = applyAltitudeEnergyExchange(flight, verticalTravelM, DT, physics);
    const moved = getDestinationPoint(missile.lat, missile.lng, autopilot.heading,
      flight.travelDistanceKm * Math.max(0, Math.cos(pitchRad)));
    missile = {
      ...missile, ...flight, ...autopilot,
      lat: moved.lat, lng: moved.lng,
      altitudeM: Math.max(0, missile.altitudeM + verticalTravelM),
      verticalSpeedMps: flight.speedMps * Math.sin(pitchRad),
    };
    const targetMoved = getDestinationPoint(target.position.lat, target.position.lng,
      target.heading, target.speedMps * DT / 1000);
    target = {
      ...target,
      position: {
        ...targetMoved,
        alt: Math.max(0, target.position.alt + target.verticalSpeedMps * DT),
      },
    };
    const horizontalM = getDistanceKm(missile.lat, missile.lng,
      target.position.lat, target.position.lng) * 1000;
    closestM = Math.min(closestM,
      Math.hypot(horizontalM, missile.altitudeM - target.position.alt));
    if (captureProfile) {
      if (samples.length === 0 && elapsed >= 1) {
        samples.push({ label: 'AFTER LAUNCH', missileAltitudeM: missile.altitudeM,
          targetAltitudeM: target.position.alt, pitchDeg: missile.flightPathAngleDeg,
          verticalSpeedMps: missile.verticalSpeedMps });
      } else if (samples.length === 1 && elapsed >= 5) {
        samples.push({ label: 'MIDCOURSE', missileAltitudeM: missile.altitudeM,
          targetAltitudeM: target.position.alt, pitchDeg: missile.flightPathAngleDeg,
          verticalSpeedMps: missile.verticalSpeedMps });
      }
      const nextThresholdKm = remainingSampleDistancesKm[0];
      if (nextThresholdKm && horizontalM / 1000 <= nextThresholdKm) {
        remainingSampleDistancesKm.shift();
        samples.push({ label: `${nextThresholdKm} KM`, missileAltitudeM: missile.altitudeM,
          targetAltitudeM: target.position.alt, pitchDeg: missile.flightPathAngleDeg,
          verticalSpeedMps: missile.verticalSpeedMps });
      }
    }
    if (closestM < 80 || flight.terminated) break;
  }
  return { closestM, samples };
}

function velocity(headingDeg, horizontalMps, verticalMps) {
  const heading = headingDeg * DEG;
  return {
    eastMps: Math.sin(heading) * horizontalMps,
    northMps: Math.cos(heading) * horizontalMps,
    upMps: verticalMps,
  };
}

const cases = [
  ['Aster 30 / ballistic', 'INT-ASTER30-V1', 35, 18_000, 270, 1_000, -320, 45, 2500],
  ['PAC-3 / ballistic', 'INT-LONG-V1', 30, 16_000, 270, 950, -300, 45, 2500],
  ['IRIS-T / cruise', 'INT-SHORT-V1', 18, 120, 270, 230, 0, 40, 1800],
  ['AIM-120 / cruise', 'INT-MEDIUM-V1', 28, 150, 270, 250, 0, 50, 2500],
];

for (const [name, interceptorSpecId, targetRangeKm, targetAltitudeM, targetHeading,
  targetSpeedMps, targetVerticalSpeedMps, durationSec, maximumClosestM] of cases) {
  const { closestM } = runScenario({ interceptorSpecId, targetRangeKm, targetAltitudeM,
    targetHeading, targetSpeedMps, targetVerticalSpeedMps, durationSec });
  assert.ok(closestM < maximumClosestM, `${name}: closest approach ${closestM.toFixed(0)} m`);
  console.log(`${name}: ${closestM.toFixed(0)} m`);
}

const highElevation = runScenario({
  interceptorSpecId: 'INT-ASTER30-V1', targetRangeKm: 6, targetAltitudeM: 18_000,
  targetHeading: 180, targetSpeedMps: 180, targetVerticalSpeedMps: -80,
  durationSec: 40, initialPitchDeg: 78,
});
assert.ok(highElevation.closestM < 2500,
  `Aster high elevation: closest approach ${highElevation.closestM.toFixed(0)} m`);
console.log(`Aster high elevation: ${highElevation.closestM.toFixed(0)} m`);

const asterProfile = runScenario({
  interceptorSpecId: 'INT-ASTER30-V1', targetRangeKm: 35, targetAltitudeM: 25_300,
  targetHeading: 270, targetSpeedMps: 1_407, targetVerticalSpeedMps: -986,
  durationSec: 45, captureProfile: true,
});
console.log('Aster altitude profile:');
for (const sample of asterProfile.samples) {
  console.log(`  ${sample.label}: missile ${(sample.missileAltitudeM / 1000).toFixed(1)} km, target ${(sample.targetAltitudeM / 1000).toFixed(1)} km, pitch ${sample.pitchDeg.toFixed(1)}°, Vz ${sample.verticalSpeedMps.toFixed(0)} m/s`);
}

const benchmarkStart = performance.now();
let maximumUpdateMs = 0;
const benchmarkIterations = 500;
const benchmarkTargets = Array.from({ length: 20 }, (_, targetIndex) => ({
  position: { lat: 49.15 + targetIndex * 0.002, lng: 28.35, alt: 12_000 },
  heading: 250,
  speedMps: 900,
  verticalSpeedMps: -220,
  turnRateDegPerSec: 0,
  velocity: velocity(250, 900, -220),
}));
for (let iteration = 0; iteration < benchmarkIterations; iteration += 1) {
  const updateStart = performance.now();
  for (let missileIndex = 0; missileIndex < 10; missileIndex += 1) {
    const specId = cases[missileIndex % cases.length][1];
    const physics = getInterceptorSpec(specId).gameplayPhysics;
    const interceptor = {
      lat: 49 + missileIndex * 0.005, lng: 28, altitudeM: 4000 + missileIndex * 300,
      heading: 75, flightPathAngleDeg: 12, verticalSpeedMps: 180,
      speedKmh: 2600, flightTime: 12, distanceTraveledKm: 8,
      energyRatio: 0.75,
    };
    const targetState = benchmarkTargets[missileIndex * 2];
    const solution = solveDynamicIntercept({ interceptor, targetState, physics });
    computeProportionalNavigation({ interceptor, targetState, solution,
      navigationConstant: physics.navigationConstantMidcourse, physics });
  }
  maximumUpdateMs = Math.max(maximumUpdateMs, performance.now() - updateStart);
}
const benchmarkTotalMs = performance.now() - benchmarkStart;
console.log(`Guidance benchmark (20 targets, 10 assigned missiles): avg ${(benchmarkTotalMs / benchmarkIterations).toFixed(3)} ms, max ${maximumUpdateMs.toFixed(3)} ms`);
