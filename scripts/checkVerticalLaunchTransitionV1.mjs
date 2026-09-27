import assert from 'node:assert/strict';
import { DEFAULT_LAUNCH_PROFILES } from '../src/data/launchProfiles.js';
import { useEngine } from '../src/store/engine.js';
import {
  advanceVerticalLaunchDeparture,
  getInterceptorLaunchPhase,
  INTERCEPTOR_LAUNCH_PHASE,
} from '../src/store/interceptorLaunch.js';

const DT = 0.05;
const results = [];
for (const specId of ['INT-SHORT-V1', 'INT-ASTER30-V1']) {
  const launchProfile = DEFAULT_LAUNCH_PROFILES[specId];
  let interceptor = {
    flightTime: 0,
    altitudeM: 0,
    flightPathAngleDeg: 90,
    pitchOverAngularRateDegPerSec: 0,
    pitchOverFlightPathAngleDeg: 4,
    launchProfile,
  };
  let previousRate = 0;
  let maximumPitchStepDeg = 0;
  let maximumRateSlewDegPerSec2 = 0;
  let guidanceAtSec = null;
  for (let step = 0; step < 160; step += 1) {
    const phase = getInterceptorLaunchPhase(interceptor);
    if (phase === INTERCEPTOR_LAUNCH_PHASE.GUIDANCE) {
      guidanceAtSec = interceptor.flightTime;
      break;
    }
    const next = advanceVerticalLaunchDeparture({
      interceptor,
      flight: { travelDistanceKm: 0.02, speedMps: 400 },
      deltaTimeSec: DT,
      launchPhase: phase,
    });
    maximumPitchStepDeg = Math.max(maximumPitchStepDeg,
      Math.abs(next.flightPathAngleDeg - interceptor.flightPathAngleDeg));
    maximumRateSlewDegPerSec2 = Math.max(maximumRateSlewDegPerSec2,
      Math.abs(next.pitchOverAngularRateDegPerSec - previousRate) / DT);
    previousRate = next.pitchOverAngularRateDegPerSec;
    interceptor = { ...interceptor, ...next, flightTime: interceptor.flightTime + DT };
  }
  assert.ok(guidanceAtSec != null && guidanceAtSec < 4,
    `${specId}: pitch-over must reach guidance without a fixed scripted snap`);
  assert.ok(maximumPitchStepDeg <= launchProfile.pitchOverMaxTurnRateDegPerSec * DT + 1e-6,
    `${specId}: pitch step must respect the profile turn-rate bound`);
  assert.ok(maximumRateSlewDegPerSec2
    <= launchProfile.pitchOverAngularAccelerationDegPerSec2 + 1e-6,
  `${specId}: pitch rate must respect angular-acceleration slew`);
  results.push({ specId, guidanceAtSec, maximumPitchStepDeg, maximumRateSlewDegPerSec2 });
}

const store = useEngine;
store.getState().resetScenario('SANDBOX');
const simulationTime = store.getState().simulationTime;
store.setState({
  missiles: [{
    id: 'GROUND-MISS', interceptorSpecId: 'INT-SHORT-V1', trackId: 'TRK-MISS',
    targetId: 'NO-TARGET', lifecycleState: 'MISSED', missedAtTime: simulationTime,
    lat: 48, lng: 31, position: { lat: 48, lng: 31, lon: 31 },
    worldPosition: { lat: 48, lng: 31, altitudeM: 1 }, altitudeM: 1,
    heading: 90, flightPathAngleDeg: 0, verticalSpeedMps: 0,
    speedKmh: 500, flightTime: 5, distanceTraveledKm: 2,
    criticalEnergyTimeSec: 0,
  }],
});
store.getState().tick();
const missed = store.getState().missiles.find(missile => missile.id === 'GROUND-MISS');
assert.equal(missed?.lifecycleState, 'SELF_DESTRUCT',
  'A missed interceptor at ground clearance must self-destruct instead of travelling along terrain');
assert.ok(store.getState().events.some(event => event.type === 'INTERCEPTOR_SELF_DESTRUCT'
  && event.details.missileId === 'GROUND-MISS'), 'Self-destruct event must be emitted');

console.table(results.map(result => ({
  ...result,
  guidanceAtSec: result.guidanceAtSec.toFixed(2),
  maximumPitchStepDeg: result.maximumPitchStepDeg.toFixed(2),
  maximumRateSlewDegPerSec2: result.maximumRateSlewDegPerSec2.toFixed(1),
})));
console.log('Vertical launch transition and missed-interceptor lifecycle checks passed.');
