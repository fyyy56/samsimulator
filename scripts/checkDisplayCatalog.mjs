import assert from 'node:assert/strict';

import {
  LIGHT_TARGET_MODEL,
  LIGHT_TARGET_MODEL_OPTIONS,
  LIGHT_TARGET_NAMES,
  normalizeLightTargetModelId,
} from '../src/data/lightTargetModels.js';
import { WEAPON_SYSTEM_TYPE } from '../src/data/gunSystems.js';
import { DEPLOYABLE_SYSTEM_IDS, SYSTEM_CATALOG, useEngine } from '../src/store/engine.js';

assert.deepEqual(
  LIGHT_TARGET_MODEL_OPTIONS.map(option => option.id),
  [
    LIGHT_TARGET_MODEL.GERAN_2,
    LIGHT_TARGET_MODEL.GERBERA,
    LIGHT_TARGET_MODEL.KH_555,
    LIGHT_TARGET_MODEL.KALIBR,
    LIGHT_TARGET_MODEL.ISKANDER_M,
  ],
);
assert.equal(new Set(LIGHT_TARGET_MODEL_OPTIONS.map(option => option.id)).size, LIGHT_TARGET_MODEL_OPTIONS.length);
assert.equal(
  LIGHT_TARGET_MODEL_OPTIONS.filter(option => option.id === LIGHT_TARGET_MODEL.ISKANDER_M).length,
  1,
  'Sandbox must expose exactly one Iskander model',
);
assert.equal(
  LIGHT_TARGET_MODEL_OPTIONS.filter(option => option.displayName === 'Искандер-М').length,
  1,
  'Sandbox must render exactly one Iskander button',
);
assert.equal(LIGHT_TARGET_NAMES[LIGHT_TARGET_MODEL.KH_555], 'Х-555');
assert.equal(normalizeLightTargetModelId('KH_101'), LIGHT_TARGET_MODEL.KH_555);
assert.equal(normalizeLightTargetModelId('X_555'), LIGHT_TARGET_MODEL.KH_555);
assert.equal(normalizeLightTargetModelId('ISKANDER'), LIGHT_TARGET_MODEL.ISKANDER_M);

assert.deepEqual(
  DEPLOYABLE_SYSTEM_IDS.map(id => SYSTEM_CATALOG[id].displayName),
  ['Patriot', 'NASAMS', 'IRIS-T SLM', 'SAMP/T', 'Gepard 1A2', 'Humvee MBG'],
);
assert.equal(new Set(DEPLOYABLE_SYSTEM_IDS).size, DEPLOYABLE_SYSTEM_IDS.length);

for (const id of ['LONG', 'MEDIUM', 'SHORT', 'SAMP_T']) {
  assert.equal(SYSTEM_CATALOG[id].weaponType, WEAPON_SYSTEM_TYPE.MISSILE, `${id} must remain a missile system`);
  assert.equal(SYSTEM_CATALOG[id].gunSpecId, null, `${id} must not inherit a gun profile`);
  assert.ok(SYSTEM_CATALOG[id].interceptorSpecId, `${id} must retain an interceptor profile`);
}
assert.equal(SYSTEM_CATALOG.GUN.weaponType, WEAPON_SYSTEM_TYPE.GUN_AA);
assert.equal(SYSTEM_CATALOG.GAZ.weaponType, WEAPON_SYSTEM_TYPE.GUN_AA);
assert.equal(Object.isFrozen(SYSTEM_CATALOG), true);
assert.equal(Object.isFrozen(SYSTEM_CATALOG.LONG), true);

useEngine.getState().startDeploy('LONG');
const patriotDraft = useEngine.getState().draftBattery;
assert.equal(patriotDraft.category, 'LONG');
assert.equal(patriotDraft.displayName, 'Patriot');
assert.equal(patriotDraft.weaponType, WEAPON_SYSTEM_TYPE.MISSILE);
assert.equal(patriotDraft.gunSpecId, null);
assert.equal(patriotDraft.interceptorSpecId, 'INT-LONG-V1');

console.log('Display catalog regression checks passed.');
