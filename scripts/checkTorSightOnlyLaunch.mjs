import assert from 'node:assert/strict';
import { useEngine } from '../src/store/engine.js';
const store = useEngine;
store.getState().resetScenario('SANDBOX');
store.getState().startDeploy('TOR_M1');
store.getState().handleMapClick(48.2, 31.5);
const battery = store.getState().batteries[0];
store.getState().setTorManualSight(battery.id, 90, 8);
assert.equal(store.getState().tracks.length, 0);
const missileId = store.getState().queueTorManualSight(battery.id);
assert.ok(missileId, 'manual optical launch accepted without a track or lock');
assert.equal(store.getState().queueTorManualSight(battery.id), null,
  'repeated SPACE cannot queue a second round while launcher is occupied');
let missile;
for (let step = 0; step < 7; step++) {
  store.getState().tick();
  missile = store.getState().missiles.find(item => item.id === missileId);
  if (missile) break;
}
assert.equal(missile?.coldLaunchPhase, 'EJECT');
assert.equal(missile?.manualSightOnly, true);
assert.equal(store.getState().batteries[0].missilesLeft, 7);
for (let step = 0; step < 90; step++) {
  store.getState().setTorManualSight(battery.id, 90, 8);
  store.getState().tick();
}
missile = store.getState().missiles.find(item => item.id === missileId);
assert.ok(missile && missile.flightTime > 3, 'sight-only missile keeps flying without target truth');
assert.equal(missile.guidanceSource, 'TOR_MANUAL_OLS');
console.log('Tor sight-only SPACE launch without track PASS');
