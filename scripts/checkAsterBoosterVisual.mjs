import assert from 'node:assert/strict';
import { Cartesian3, Quaternion } from 'cesium';
import { createAsterBoosterDebris, updateAsterBoosterDebris } from '../src/scenes/advanced/asterBoosterDebris.js';

const entities = [];
const viewer = { entities: { add: options => { entities.push(options); return options; } } };
const position = Cartesian3.fromDegrees(30, 50, 1000);
const visual = { worldPosition: position, quaternion: Quaternion.IDENTITY,
  kinematics: { headingDeg: 90, pitchDeg: 0, rollDeg: 0, speedKmh: 720 } };
const presentation = { boosterModelUri: '/aster30-booster.glb', baseVisualScale: 1.08,
  yawOffsetDeg: -90, modelQuaternionOffset: { axis: 'Y', angleDeg: 90.539 },
  modelCenterOffsetMeters: { x: .22, y: -2.47, z: 3.38 } };
const debris = createAsterBoosterDebris(viewer, visual, presentation, 10, 'test');
assert.equal(entities.length, 1);
assert.equal(entities[0].model.scale, 1.08);
assert.ok(updateAsterBoosterDebris(debris, 11, true));
assert.ok(Cartesian3.distance(debris.entity.position, debris.position) > 190,
  'detached booster keeps launch velocity and falls under gravity');
assert.ok(!updateAsterBoosterDebris(debris, 20, true),
  'detached booster expires after ten simulation seconds');
console.log('Aster booster visual ballistics and 10-second lifetime passed.');
