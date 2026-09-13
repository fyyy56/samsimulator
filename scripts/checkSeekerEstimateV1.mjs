import assert from 'node:assert/strict';
import { SEEKER_PROFILE_ID, SEEKER_PROFILES, SEEKER_STATE } from '../src/data/seekerProfiles.js';
import { getDestinationPoint, getDistanceKm } from '../src/store/geo.js';
import {
  SEEKER_GUIDANCE_SOURCE,
  advanceMissileSeeker,
  createMissileSeeker,
  getSeekerGuidanceTrack,
} from '../src/store/seekerSystem.js';

const profile = SEEKER_PROFILES[SEEKER_PROFILE_ID.AIM_120C7];
const origin = { lat: 50, lng: 30 };
const targetPosition = getDestinationPoint(origin.lat, origin.lng, 0, 8);
const target = {
  id: 'EST-TARGET', modelId: 'KH_555', type: 'CRUISE_TARGET',
  position: targetPosition, altitudeM: 2_000, heading: 0, speedKmh: 720,
  verticalSpeedMps: 0, flightPhase: 'CRUISE',
};
const networkPosition = getDestinationPoint(targetPosition.lat, targetPosition.lng, 90, 0.3);
const networkTrack = {
  id: 'TRK-EST', targetId: target.id, state: 'TRACKED',
  reportedPosition: { ...networkPosition, alt: 2_080 }, reportedAltitudeM: 2_080,
  reportedHeading: 2, reportedSpeedKmh: 700, reportedVerticalSpeedMps: 0,
  trackQuality: 0.68, lastUpdateTime: 0, positionUncertaintyM: 500,
  altitudeUncertaintyM: 180, velocityUncertaintyMps: 12, headingUncertaintyDeg: 4,
};
const missile = {
  id: 'MSL-EST', position: origin, lat: origin.lat, lng: origin.lng,
  altitudeM: 2_000, heading: 0, flightPathAngleDeg: 0,
  guidance: {
    reportedPosition: networkTrack.reportedPosition,
    reportedAltitudeM: networkTrack.reportedAltitudeM,
    reportedHeading: networkTrack.reportedHeading,
    reportedSpeedKmh: networkTrack.reportedSpeedKmh,
    reportedVerticalSpeedMps: 0,
    commandPosition: networkTrack.reportedPosition,
  },
};

const run = () => {
  let seeker = createMissileSeeker(profile.id, 0);
  let firstOwnEstimate = null;
  for (let step = 1; step <= 140; step += 1) {
    seeker = advanceMissileSeeker({ seeker, missile, target, networkTrack,
      simulationTime: step * 0.05, deltaTimeSec: 0.05 });
    if (!firstOwnEstimate && seeker.targetEstimate) firstOwnEstimate = seeker.targetEstimate;
  }
  return { seeker, firstOwnEstimate };
};

const firstRun = run();
const repeatRun = run();
assert.deepEqual(firstRun, repeatRun,
  'seeker measurements and estimates must be deterministic');
assert.equal(firstRun.seeker.state, SEEKER_STATE.TERMINAL,
  'I: seeker must reach terminal state through evidence acquisition');
assert.equal(firstRun.seeker.guidanceSource, SEEKER_GUIDANCE_SOURCE.OWN_SEEKER);
assert.ok(firstRun.firstOwnEstimate,
  'own seeker estimate must be created only after acquisition');
const seedCorrectionM = getDistanceKm(networkTrack.reportedPosition.lat,
  networkTrack.reportedPosition.lng, firstRun.firstOwnEstimate.position.lat,
  firstRun.firstOwnEstimate.position.lng) * 1000;
assert.ok(seedCorrectionM < 250,
  `handoff from network estimate must be bounded (${seedCorrectionM.toFixed(1)} m)`);
assert.notDeepEqual(firstRun.seeker.targetEstimate.position,
  { ...target.position, alt: target.altitudeM },
  'own seeker estimate must not expose perfect target truth');
assert.ok(firstRun.seeker.targetEstimate.positionUncertaintyM
  < networkTrack.positionUncertaintyM,
  'terminal seeker estimate should become more precise than ground Track');
const ownGuidanceTrack = getSeekerGuidanceTrack(firstRun.seeker, networkTrack);
assert.equal(ownGuidanceTrack.guidanceSource, SEEKER_GUIDANCE_SOURCE.OWN_SEEKER);
assert.deepEqual(ownGuidanceTrack.reportedPosition, firstRun.seeker.targetEstimate.position,
  'guidance receives an estimate-shaped Track view');

const lostNetworkTrack = { ...networkTrack, state: 'LOST' };
const continued = advanceMissileSeeker({ seeker: firstRun.seeker, missile, target,
  networkTrack: lostNetworkTrack, simulationTime: firstRun.seeker.lastUpdateTime + 0.05,
  deltaTimeSec: 0.05 });
assert.equal(continued.guidanceSource, SEEKER_GUIDANCE_SOURCE.OWN_SEEKER,
  'P: missile must continue on own estimate after network Track is lost');
assert.ok(continued.targetEstimate.timestamp > firstRun.seeker.targetEstimate.timestamp);

const blindMissile = { ...missile, id: 'MSL-BLIND', guidance: {} };
let blind = createMissileSeeker(profile.id, 0);
for (let step = 1; step <= 100; step += 1) {
  blind = advanceMissileSeeker({ seeker: blind, missile: blindMissile, target,
    networkTrack: null, simulationTime: step * 0.05, deltaTimeSec: 0.05 });
}
assert.equal(blind.state, SEEKER_STATE.OFF,
  'Q: seeker cannot use target truth to point itself before any Track/guidance cue');
assert.equal(blind.targetEstimate, null);

const disabled = advanceMissileSeeker({ seeker: createMissileSeeker(profile.id, 0),
  missile, target, networkTrack, simulationTime: 1, deltaTimeSec: 0.05, enabled: false });
assert.equal(disabled.state, SEEKER_STATE.OFF,
  'R: debug-disabled seeker must preserve network guidance comparison path');
assert.equal(disabled.guidanceSource, SEEKER_GUIDANCE_SOURCE.NETWORK_TRACK);

console.log(JSON.stringify({
  status: 'PASS',
  handoff: {
    initialCorrectionM: +seedCorrectionM.toFixed(1),
    networkUncertaintyM: networkTrack.positionUncertaintyM,
    seekerUncertaintyM: +firstRun.seeker.targetEstimate.positionUncertaintyM.toFixed(1),
    guidanceSource: firstRun.seeker.guidanceSource,
  },
  networkLostAfterLock: continued.guidanceSource,
  networkLostBeforeLock: { state: blind.state, estimate: blind.targetEstimate },
  disabledComparison: disabled.guidanceSource,
}, null, 2));
