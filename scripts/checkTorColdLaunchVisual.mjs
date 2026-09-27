import assert from 'node:assert/strict';
import { advanceColdLaunch } from '../src/store/coldLaunch.js';
import { MISSILE_SMOKE_PROFILES, getMissileSmokeProfile } from '../src/data/visualEffectProfiles.js';
const interceptor = { coldLaunchPhase: 'ORIENT', flightTime: 1, pitchOverFlightPathAngleDeg: 8,
  launchProfile: { pitchOverMaxTurnRateDegPerSec: 58,
    coldLaunch: { minimumIgnitionSec: .75, orientToleranceDeg: 10 } } };
const sample = (pitch, rate = -40, overrides = {}) => advanceColdLaunch({
  interceptor: { ...interceptor, ...overrides }, flight: { flightTime: 1.05, motorPhase: 'COLD' },
  altitudeFlight: { flightPathAngleDeg: pitch, pitchOverAngularRateDegPerSec: rate, altitudeM: 25 },
});
assert.equal(sample(60).coldLaunchPhase, 'ORIENT', 'time alone cannot ignite motor');
assert.ok(sample(60).attitudeJetsIntensity > sample(25, -20).attitudeJetsIntensity);
assert.equal(sample(16).coldLaunchPhase, 'IGNITION');
assert.equal(sample(16).attitudeJetsIntensity, 0, 'jets stop at ignition');
assert.equal(sample(84, 0, { pitchOverFlightPathAngleDeg: 84 }).attitudeJetsIntensity, 0);
assert.equal(sample(60, -40, { coldLaunchPhase: 'BOOST' }).attitudeJetsIntensity, 0);
assert.deepEqual(getMissileSmokeProfile({ interceptorSpecId: 'INT-MEDIUM-V1' }), MISSILE_SMOKE_PROFILES.CURRENT);
assert.deepEqual(MISSILE_SMOKE_PROFILES.TOR, MISSILE_SMOKE_PROFILES.CURRENT, 'approved smoke preserved');
assert.notEqual(MISSILE_SMOKE_PROFILES.TOR, MISSILE_SMOKE_PROFILES.CURRENT, 'independent Tor tuning slot');
console.log('Tor cold phases, correction-dependent jets, unchanged smoke profiles PASS');
