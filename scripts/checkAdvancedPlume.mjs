import assert from 'node:assert/strict';
import { INTERCEPTOR_SPECS } from '../src/data/interceptors.js';
import { getMotorState } from '../src/store/interceptorPhysics.js';
import { getMissilePlumeProfile, MISSILE_TRAIL_VISUAL_PROFILE,
  INTERCEPT_EFFECT_VISUAL_PROFILE } from '../src/data/visualEffectProfiles.js';

let phases = 0;
for (const [id, spec] of Object.entries(INTERCEPTOR_SPECS)) {
  const physics = spec.gameplayPhysics;
  if (!physics?.motorPhases) continue;
  let time = 0;
  for (const phase of physics.motorPhases) {
    const motor = getMotorState(physics, time + phase.durationSec / 2);
    assert.ok(getMissilePlumeProfile({ motorPhase: motor.phase }), `${id}: ${motor.phase}`);
    time += phase.durationSec;
    phases++;
  }
  const burnout = getMotorState(physics, time + 1);
  assert.equal(getMissilePlumeProfile({ motorPhase: burnout.phase,
    kinematicPhase: 'BOOST', phase: 'POWERED' }), null, `${id}: burnout takes precedence`);
}
assert.ok(phases > 0);
const boost = getMissilePlumeProfile({ motorPhase: 'BOOST' });
const sustain = getMissilePlumeProfile({ motorPhase: 'SUSTAIN' });
assert.ok(sustain.size < boost.size && sustain.opacity < boost.opacity);
assert.equal(getMissilePlumeProfile({ motorPhase: 'COAST' }), null);
assert.equal(getMissilePlumeProfile({ motorPhase: 'UNKNOWN' }), null);
assert.ok(MISSILE_TRAIL_VISUAL_PROFILE.advancedMaxPuffs <= 1024);
assert.ok(INTERCEPT_EFFECT_VISUAL_PROFILE.totalDurationMs
  >= INTERCEPT_EFFECT_VISUAL_PROFILE.fireDurationMs);
console.log(`Advanced plume: ${phases} real profile phases, burnout precedence and visual bounds passed.`);
