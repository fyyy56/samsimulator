import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THROTTLE_ASSIST_MODE } from '../src/store/manualControlStore.js';
import { getAssistTargetSpeedMps, updateAssistedThrottle } from '../src/scenes/advanced/fpvThrottleAssist.js';
import { thermalLuminance, THERMAL_PROFILES } from '../src/data/thermalProfiles.js';

const track = { reportedSpeedKmh: 150 };
assert.equal(getAssistTargetSpeedMps({ mode: THROTTLE_ASSIST_MODE.MATCH_SPEED }, track), 150 / 3.6);
assert.ok(Math.abs(getAssistTargetSpeedMps({ mode: THROTTLE_ASSIST_MODE.APPROACH }, track)
  - (150 / 3.6 + 4.2)) < 1e-9);
assert.equal(getAssistTargetSpeedMps({ mode: THROTTLE_ASSIST_MODE.MATCH_SPEED }, {}), null);
assert.ok(updateAssistedThrottle({ throttle: .4, speedMps: 30, targetSpeedMps: 40, deltaSec: 1 }) > .4);
assert.ok(updateAssistedThrottle({ throttle: .4, speedMps: 50, targetSpeedMps: 40, deltaSec: 1 }) < .4);
assert.equal(updateAssistedThrottle({ throttle: .4, speedMps: 30, targetSpeedMps: null, deltaSec: 1 }), .4);

const geran = THERMAL_PROFILES.GERAN_2;
assert.ok(geran.engineHeat > geran.bodyHeat && geran.exhaustHeat > geran.bodyHeat);
assert.ok(thermalLuminance(geran, 0) < .8, 'Body tone mapping avoids a pure-white blob');
assert.ok(thermalLuminance(geran, 1000) > thermalLuminance(geran, 0));

const gameStore = readFileSync(new URL('../src/store/gameStore.js', import.meta.url), 'utf8');
const advanced = readFileSync(new URL('../src/scenes/AdvancedScene.jsx', import.meta.url), 'utf8');
assert.match(gameStore, /FPV_FEED/);
assert.match(gameStore, /gameMode: GAME_MODE\.SIMPLE[\s\S]{0,250}presentationMode: PRESENTATION_MODE\.FPV_FEED/);
assert.match(advanced, /fpvFeedMode[\s\S]{0,500}returnToCommandSafely/);
assert.match(advanced, /getAssistTargetSpeedMps/);
assert.match(advanced, /selectedTrackClosingMps/);
console.log('FPV gameplay V1 presentation, throttle assists and thermal profiles passed.');
