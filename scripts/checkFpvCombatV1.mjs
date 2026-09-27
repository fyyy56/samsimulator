import assert from 'node:assert/strict';
import {
  CONTROLLABLE_AIR_PROFILES,
  CONTROLLABLE_AIR_PROFILE_IDS,
} from '../src/data/controllableAirProfiles.js';
import { FPV_WARHEAD_RESULT, resolveFpvWarhead } from '../src/store/fpvWarhead.js';

const profile = CONTROLLABLE_AIR_PROFILES[CONTROLLABLE_AIR_PROFILE_IDS.SKYFALL_FPV].warhead;
assert.equal(profile.id, 'FPV_FRAG_V1');
assert.ok(profile.proximityRadiusM > 0 && profile.proximityRadiusM <= 2,
  'gameplay FPV proximity zone is at most 2 metres');

const direct = resolveFpvWarhead({ closestApproachM: 0.4, directContact: true, profile });
assert.equal(direct.detonated, true);
assert.equal(direct.outcome, FPV_WARHEAD_RESULT.DESTROYED,
  'direct contact must guarantee destruction');

const near = resolveFpvWarhead({ closestApproachM: profile.proximityRadiusM * 0.55, profile });
assert.equal(near.detonated, true);
assert.equal(near.outcome, FPV_WARHEAD_RESULT.DAMAGED,
  'a mid-zone near pass should produce a damaged result');

const edge = resolveFpvWarhead({ closestApproachM: profile.proximityRadiusM * 0.95, profile });
assert.equal(edge.detonated, true);
assert.equal(edge.outcome, FPV_WARHEAD_RESULT.MISS,
  'an edge burst may detonate without deleting the target');

const outside = resolveFpvWarhead({ closestApproachM: profile.proximityRadiusM + 0.1, profile });
assert.equal(outside.detonated, false);
assert.equal(outside.outcome, FPV_WARHEAD_RESULT.MISS);
assert.ok(direct.effectiveness > near.effectiveness && near.effectiveness > edge.effectiveness,
  'fragmentation effectiveness must fall continuously with distance');

console.log(JSON.stringify({ status: 'PASS', warhead: profile.id,
  proximityRadiusM: profile.proximityRadiusM,
  outcomes: [direct.outcome, near.outcome, edge.outcome, outside.outcome] }, null, 2));
