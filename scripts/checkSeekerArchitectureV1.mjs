import assert from 'node:assert/strict';
import {
  INTERCEPTOR_SEEKER_PROFILE,
  SEEKER_PROFILES,
  SEEKER_PROFILE_ID,
  SEEKER_REFERENCE_SOURCE,
  SEEKER_STATE,
  SEEKER_TYPE,
  getInterceptorSeekerProfile,
} from '../src/data/seekerProfiles.js';
import {
  SEEKER_TRANSITION_EVENT,
  advanceSeekerState,
  createMissileSeeker,
} from '../src/store/seekerSystem.js';

const requiredFields = [
  'id', 'seekerType', 'warmupSec', 'seekerActivationRangeKm',
  'baselineLockRangeKm', 'hardMaxLockRangeKm', 'fovDeg', 'gimbalLimitDeg',
  'trackRateDegSec', 'searchDurationSec', 'breakLockMemorySec', 'lockAfterLaunch',
  'datalink', 'datalinkReconnect', 'acquisitionEvidenceRate', 'lossEvidenceRate',
  'signatureSensitivity', 'aspectSensitivity', 'reference',
];
for (const profile of Object.values(SEEKER_PROFILES)) {
  for (const field of requiredFields) assert.ok(field in profile,
    `${profile.id} must define ${field}`);
  assert.ok(Object.values(SEEKER_TYPE).includes(profile.seekerType));
}

assert.notEqual(SEEKER_PROFILES[SEEKER_PROFILE_ID.AIM_120C7],
  SEEKER_PROFILES[SEEKER_PROFILE_ID.ASTER_30],
  'AIM-120 and Aster must remain separate missile-specific profiles');
assert.equal(getInterceptorSeekerProfile('INT-SHORT-V1').seekerType, SEEKER_TYPE.IR);
assert.equal(getInterceptorSeekerProfile('INT-MEDIUM-V1').seekerType,
  SEEKER_TYPE.ACTIVE_RADAR);
assert.equal(getInterceptorSeekerProfile('INT-LONG-V1').reference.source,
  SEEKER_REFERENCE_SOURCE.GAMEPLAY_ESTIMATE,
  'PAC-3 profile must be explicitly marked GAMEPLAY_ESTIMATE');
assert.equal(Object.keys(INTERCEPTOR_SEEKER_PROFILE).length, 4);

const profile = SEEKER_PROFILES[SEEKER_PROFILE_ID.AIM_120C7];
let seeker = createMissileSeeker(profile.id, 0);
assert.equal(seeker.state, SEEKER_STATE.OFF);
seeker = advanceSeekerState({ seeker, profile, simulationTime: 1, deltaTimeSec: 0.05,
  activationReady: true, canSense: true, acquisitionScore: 0.9, distanceKm: 18 });
assert.equal(seeker.state, SEEKER_STATE.WARMUP);
seeker = advanceSeekerState({ seeker, profile, simulationTime: 1.3, deltaTimeSec: 0.05,
  activationReady: true, canSense: true, acquisitionScore: 0.9, distanceKm: 18 });
assert.equal(seeker.state, SEEKER_STATE.SEARCH);
assert.equal(seeker.transition.type, SEEKER_TRANSITION_EVENT.SEARCH);
for (let step = 1; step < 40 && seeker.state === SEEKER_STATE.SEARCH; step += 1) {
  seeker = advanceSeekerState({ seeker, profile, simulationTime: 1.3 + step * 0.05,
    deltaTimeSec: 0.05, activationReady: true, canSense: true,
    acquisitionScore: 0.9, distanceKm: 18 });
}
assert.equal(seeker.state, SEEKER_STATE.ACQUIRED);
assert.equal(seeker.transition.type, SEEKER_TRANSITION_EVENT.ACQUIRED);
const acquiredAt = seeker.stateEnteredAt;
seeker = advanceSeekerState({ seeker, profile,
  simulationTime: acquiredAt + profile.terminalConfirmationSec + 0.01,
  deltaTimeSec: profile.terminalConfirmationSec + 0.01,
  activationReady: true, canSense: true, acquisitionScore: 0.9, distanceKm: 15 });
assert.equal(seeker.state, SEEKER_STATE.TERMINAL);

console.log(JSON.stringify({
  status: 'PASS',
  seekerTypes: Object.values(SEEKER_TYPE),
  seekerStates: Object.values(SEEKER_STATE),
  profiles: Object.values(SEEKER_PROFILES).map(item => ({
    id: item.id, type: item.seekerType, source: item.reference.source,
  })),
  stateMachine: 'OFF→WARMUP→SEARCH→ACQUIRED→TERMINAL',
}, null, 2));
