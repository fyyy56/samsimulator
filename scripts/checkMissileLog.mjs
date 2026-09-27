import assert from 'node:assert/strict';
import { appendMissileLog } from '../src/store/missileLog.js';
import { createSimulationEvent, EVENT_TYPE } from '../src/store/simulationEvents.js';

let log = [];
let sequence = 0;
const event = (type, missileId) => createSimulationEvent(++sequence, type, sequence,
  { missileId, batteryId: 'SAM-01' });
for (let index = 1; index <= 6; index++) {
  log = appendMissileLog(log, event(EVENT_TYPE.INTERCEPTOR_LAUNCHED, `MSL-${index}`));
}
assert.deepEqual(log.map(entry => entry.id), ['MSL-6', 'MSL-5', 'MSL-4', 'MSL-3', 'MSL-2']);
log = appendMissileLog(log, event(EVENT_TYPE.STAGE_SEPARATION, 'MSL-2'));
assert.deepEqual(log.map(entry => entry.id), ['MSL-6', 'MSL-5', 'MSL-4', 'MSL-3', 'MSL-2']);
assert.equal(log.at(-1).events.length, 2);
log = appendMissileLog(log, event(EVENT_TYPE.TARGET_INTERCEPTED, 'MSL-1'));
log = appendMissileLog(log, event(EVENT_TYPE.TARGET_INTERCEPTED, 'GUN-01'));
assert.deepEqual(log.map(entry => entry.id), ['MSL-6', 'MSL-5', 'MSL-4', 'MSL-3', 'MSL-2']);
console.log('Missile log keeps five latest launches, ordered events and excludes gun events.');
