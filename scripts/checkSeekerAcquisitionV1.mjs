import assert from 'node:assert/strict';
import { getDestinationPoint } from '../src/store/geo.js';
import {
  SEEKER_PROFILE_ID,
  SEEKER_PROFILES,
  SEEKER_STATE,
} from '../src/data/seekerProfiles.js';
import {
  advanceMissileSeekerSensing,
  createMissileSeeker,
  evaluateSeekerAcquisition,
} from '../src/store/seekerSystem.js';

const origin = { lat: 50, lng: 30 };
const missile = {
  id: 'SEEKER-TEST', position: origin, lat: origin.lat, lng: origin.lng,
  altitudeM: 2_000, heading: 0, flightPathAngleDeg: 0,
};
const pointNorth = distanceKm => getDestinationPoint(origin.lat, origin.lng, 0, distanceKm);
const targetAt = ({ id = 'TARGET', modelId = 'GERAN_2', type = 'UAV_TARGET',
  distanceKm = 7, heading = 0, flightPhase = 'CRUISE' } = {}) => {
  const position = pointNorth(distanceKm);
  return { id, modelId, type, position, altitudeM: 2_000, heading,
    speedKmh: 220, flightPhase };
};
const trackFor = target => ({
  id: 'TRK-TEST', targetId: target.id, state: 'TRACKED',
  reportedPosition: { ...target.position, alt: target.altitudeM },
  reportedAltitudeM: target.altitudeM, reportedHeading: target.heading,
  reportedSpeedKmh: target.speedKmh, lastUpdateTime: 0,
});

const iris = SEEKER_PROFILES[SEEKER_PROFILE_ID.IRIS_T_SLM];
const rearTarget = targetAt({ heading: 0 });
const frontTarget = targetAt({ heading: 180 });
const rear = evaluateSeekerAcquisition({ seeker: createMissileSeeker(iris.id),
  profile: iris, missile, target: rearTarget, networkTrack: trackFor(rearTarget) });
const front = evaluateSeekerAcquisition({ seeker: createMissileSeeker(iris.id),
  profile: iris, missile, target: frontTarget, networkTrack: trackFor(frontTarget) });
assert.ok(rear.acquisitionScore > front.acquisitionScore,
  'F/G: IR rear aspect must provide stronger acquisition than front aspect');
assert.ok(rear.effectiveRangeKm > front.effectiveRangeKm,
  'F/G: rear-aspect effective range must exceed front-aspect range');

const gerbera = targetAt({ modelId: 'GERBERA' });
const hotBallistic = targetAt({ modelId: 'ISKANDER_M', type: 'BALLISTIC_TARGET',
  flightPhase: 'BOOST' });
const lowIr = evaluateSeekerAcquisition({ seeker: createMissileSeeker(iris.id),
  profile: iris, missile, target: gerbera, networkTrack: trackFor(gerbera) });
const highIr = evaluateSeekerAcquisition({ seeker: createMissileSeeker(iris.id),
  profile: iris, missile, target: hotBallistic, networkTrack: trackFor(hotBallistic) });
assert.ok(highIr.acquisitionScore > lowIr.acquisitionScore,
  'H: powered/high-signature target must build stronger IR evidence than Gerbera');

const aim = SEEKER_PROFILES[SEEKER_PROFILE_ID.AIM_120C7];
const outsideTarget = targetAt({ modelId: 'KH_555', type: 'CRUISE_TARGET', distanceKm: 26 });
const outside = evaluateSeekerAcquisition({ seeker: createMissileSeeker(aim.id),
  profile: aim, missile, target: outsideTarget, networkTrack: trackFor(outsideTarget) });
assert.equal(outside.canSense, false, 'L: acquisition outside hardMax range is impossible');
assert.equal(outside.acquisitionScore, 0, 'L: hard range must zero acquisition score');

let seeker = createMissileSeeker(aim.id, 0);
const lockTarget = targetAt({ modelId: 'KH_555', type: 'CRUISE_TARGET', distanceKm: 8 });
const lockTrack = trackFor(lockTarget);
for (let step = 1; step <= 120 && ![SEEKER_STATE.ACQUIRED, SEEKER_STATE.TERMINAL]
  .includes(seeker.state); step += 1) {
  seeker = advanceMissileSeekerSensing({ seeker, profile: aim, missile,
    target: lockTarget, networkTrack: lockTrack, simulationTime: step * 0.05,
    deltaTimeSec: 0.05 });
}
assert.ok([SEEKER_STATE.ACQUIRED, SEEKER_STATE.TERMINAL].includes(seeker.state),
  'I: deterministic evidence must acquire a valid assigned target');
const evidenceAtLock = seeker.evidence;
seeker = advanceMissileSeekerSensing({ seeker, profile: aim, missile,
  target: outsideTarget, networkTrack: lockTrack, simulationTime: seeker.lastUpdateTime + 0.05,
  deltaTimeSec: 0.05 });
assert.notEqual(seeker.state, SEEKER_STATE.LOST,
  'M: one transient bad update must not drop lock');
assert.ok(seeker.evidence < evidenceAtLock, 'M: bad conditions must reduce evidence');
for (let step = 1; step <= 100 && seeker.state !== SEEKER_STATE.LOST; step += 1) {
  seeker = advanceMissileSeekerSensing({ seeker, profile: aim, missile,
    target: outsideTarget, networkTrack: lockTrack,
    simulationTime: seeker.lastUpdateTime + 0.05, deltaTimeSec: 0.05 });
}
assert.equal(seeker.state, SEEKER_STATE.LOST,
  'N: persistent bad conditions must transition ACQUIRED/TERMINAL to LOST');
for (let step = 1; step <= 160 && ![SEEKER_STATE.ACQUIRED, SEEKER_STATE.TERMINAL]
  .includes(seeker.state); step += 1) {
  seeker = advanceMissileSeekerSensing({ seeker, profile: aim, missile,
    target: lockTarget, networkTrack: lockTrack,
    simulationTime: seeker.lastUpdateTime + 0.05, deltaTimeSec: 0.05 });
}
assert.ok([SEEKER_STATE.ACQUIRED, SEEKER_STATE.TERMINAL].includes(seeker.state),
  'O: target must be reacquirable when valid conditions return');
assert.equal(seeker.reacquisitionCount, 1);

console.log(JSON.stringify({
  status: 'PASS',
  irAspect: {
    rearScore: +rear.acquisitionScore.toFixed(3),
    frontScore: +front.acquisitionScore.toFixed(3),
    rearEffectiveRangeKm: +rear.effectiveRangeKm.toFixed(2),
    frontEffectiveRangeKm: +front.effectiveRangeKm.toFixed(2),
  },
  irSignature: {
    lowTargetScore: +lowIr.acquisitionScore.toFixed(3),
    poweredTargetScore: +highIr.acquisitionScore.toFixed(3),
  },
  hardRange: { distanceKm: 26, score: outside.acquisitionScore },
  memoryLostReacquire: { finalState: seeker.state, reacquisitionCount: seeker.reacquisitionCount },
}, null, 2));
