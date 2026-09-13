import assert from 'node:assert/strict';
import { setupVisualScenario } from './visual-test-scenarios.js';
import { useEngine } from '../src/store/engine.js';
import { isAvailableNetworkTrack } from '../src/store/trackDataProvider.js';
import { fuseSensorEvidence, isTrackSensorStale } from '../src/store/sensorDetection.js';
import { applySensorEvidenceObservation, coastTrack } from '../src/store/trackSystem.js';
import { getDistanceKm } from '../src/store/geo.js';
import { sampleTrackPresentation } from '../src/ui/trackPresentation.js';

const results = [];
for (const profile of ['RADAR_P18', 'RADAR_35D6', 'RADAR_79K6']) {
  setupVisualScenario(profile);
  const start = useEngine.getState().simulationTime;
  let first = null;
  let lost = 0;
  for (let step = 0; step < 2400; step++) {
    useEngine.getState().tick();
    const state = useEngine.getState();
    assert.equal(state.batteries.length, 0, 'No SAM radar is needed for presentation');
    const track = state.tracks[0];
    if (isAvailableNetworkTrack(track)) first ??= state.simulationTime - start;
    else if (first != null) lost++;
  }
  assert.ok(first != null, `${profile} must build a Geran estimate from real beam passes`);
  assert.equal(lost, 0, `${profile} must retain estimates between normal passes`);
  const state = useEngine.getState();
  const before = state.tracks[0];
  assert.equal(before.sourceBatteryId, state.searchRadars[0].id);
  // Turning the only radar off cannot keep refreshing that estimate forever.
  useEngine.setState({ searchRadars: state.searchRadars.map(r => ({ ...r, operational: false })) });
  for (let step = 0; step < 700; step++) useEngine.getState().tick();
  assert.equal(useEngine.getState().tracks.length, 0, 'No immortal tracks after source shutdown');
  results.push({ profile, firstTrackSec: +first.toFixed(2), lostBetweenPasses: lost });
}

const sample = { id: 'T-TEST', state: 'TRACKED', reportedPosition: { lat: 50, lng: 30 },
  reportedAltitudeM: 1200, reportedHeading: 359, reportedSpeedKmh: 220,
  trackQuality: 0.7, expectedRevisitSec: 10, lastUpdateTime: 0, lastPredictionTime: 0,
  positionUncertaintyM: 200, altitudeUncertaintyM: 100 };
assert.equal(isTrackSensorStale(sample, 10.5), false);
assert.equal(coastTrack(sample, 10.5, 0.05).state, 'TRACKED');
assert.equal(isTrackSensorStale(sample, 12), true);
assert.equal(coastTrack(sample, 12, 0.05).state, 'LOST');
assert.equal(isTrackSensorStale({ ...sample, expectedRevisitSec: 5 }, 7), true);

// Existing owner remains operational but is outside coverage; a second search
// radar is in coverage and has not passed this bearing yet. Coasting is allowed,
// but neither measurement time nor total updates may be refreshed.
setupVisualScenario('RADAR_35D6');
for (let step = 0; step < 150; step++) useEngine.getState().tick();
const prior = useEngine.getState();
const source = prior.searchRadars[0];
assert.ok(prior.tracks.length);
const other = { ...source, id: 'OTHER', components: { radar: {
  ...source.components.radar, id: 'OTHER-SENSOR',
  scanState: { ...source.components.radar.scanState, traversalPhase: 0, previousTraversalPhase: 0 },
} } };
useEngine.setState({ searchRadars: [{ ...source, components: { radar: {
  ...source.components.radar, lng: 5,
} } }, other] });
useEngine.getState().tick();
const after = useEngine.getState().tracks[0];
assert.ok(isAvailableNetworkTrack(after), 'Owner coverage is not network coverage');
assert.equal(after.lastUpdateTime, prior.tracks[0].lastUpdateTime);
assert.equal(after.totalUpdates, prior.tracks[0].totalUpdates);

const contact = (id, time, quality, uncertainty) => ({
  id, targetId: 'TEST', sourceBatteryId: id, sourceRadarId: id,
  evidence: 0.9, confirmedBefore: true, lastScanTime: time, lastOpportunityCount: 1,
  lastMeasurement: { timestamp: time, sensorId: id, quality,
    positionUncertaintyM: uncertainty, velocityUncertaintyMps: 2,
    position: { lat: 50, lng: 30 }, altitudeM: 1200, headingDeg: 0,
    speedKmh: 220, verticalSpeedMps: 0 },
});
const good = contact('GOOD', 9.9, 0.95, 20);
const weak = contact('WEAK', 10, 0.3, 200);
const args = { contacts: [good, weak], target: { id: 'TEST', modelId: 'GERAN_2' }, simulationTime: 10,
  existingTrack: { sourceRadarId: 'GOOD' } };
assert.equal(fuseSensorEvidence(args), null, 'A retained winner is NOT a fresh measurement');
assert.equal(fuseSensorEvidence({ ...args, activeSourceIds: new Set(['WEAK']) }).sourceRadarId,
  'WEAK', 'An offline winner cannot block an available source');
assert.equal(fuseSensorEvidence({ ...args, simulationTime: 17,
  contacts: [good, { ...weak, lastScanTime: 17 }] }).sourceRadarId, 'WEAK', 'Stale winner yields to fresh source');
const first = applySensorEvidenceObservation({ existingTrack: null, target: args.target,
  observation: { stage: 'TRACKED', targetId: 'TEST', sourceRadarId: 'GOOD', evidence: 0.9,
    measurement: good.lastMeasurement }, simulationTime: 10, trackId: 'T-HANDOFF' });
const handoff = applySensorEvidenceObservation({ existingTrack: first, target: args.target,
  observation: { stage: 'TRACKED', targetId: 'TEST', sourceRadarId: 'WEAK', evidence: 0.9,
    measurement: { ...weak.lastMeasurement, position: { lat: 50, lng: 30.01 } } },
  simulationTime: 10.1, trackId: 'T-HANDOFF' });
assert.equal(handoff.reportedSpeedKmh, 220, 'Sensor offset must not become a velocity spike');

// Noise damping is view-only: no target truth input and no mutation of Track.
const runNoise = hz => {
  const cache = new Map();
  let pose = null, maxStepM = 0;
  for (let frame = 0; frame <= hz * 3; frame++) {
    const t = frame / hz;
    const bucket = Math.floor(t * 10 + 1e-8);
    const input = { ...sample, lastPredictionTime: t,
      reportedSpeedKmh: 0, reportedHeading: bucket % 2 ? 1 : 359,
      reportedPosition: { lat: 50, lng: 30 + (bucket % 2 ? 0.002 : -0.002) } };
    const snapshot = JSON.stringify(input);
    const next = sampleTrackPresentation(cache, 'T', input, t, frame * 1000 / hz);
    assert.equal(JSON.stringify(input), snapshot, 'Presentation cannot modify authoritative Track');
    if (pose) maxStepM = Math.max(maxStepM, getDistanceKm(pose.lat, pose.lng, next.lat, next.lng) * 1000);
    assert.ok(Math.abs(next.headingDeg - 360) < 3, 'Heading wraps by short arc');
    pose = next;
  }
  return { pose, maxStepM };
};
const a = runNoise(60), b = runNoise(144);
assert.ok(a.maxStepM < 30, `Correction must not teleport: ${a.maxStepM} m/frame`);
assert.ok(getDistanceKm(a.pose.lat, a.pose.lng, b.pose.lat, b.pose.lng) * 1000 < 20,
  'Damping must be time based across render rates');
const cache = new Map();
sampleTrackPresentation(cache, 'T', sample, 0, 0);
const large = { ...sample, reportedPosition: { lat: 50, lng: 30.05 }, reportedSpeedKmh: 0 };
let pose;
for (let n = 1; n <= 75; n++) pose = sampleTrackPresentation(cache, 'T', large, n / 60, n * 1000 / 60);
assert.ok(getDistanceKm(pose.lat, pose.lng, 50, 30.05) * 1000 < 30, 'Large corrections catch up promptly');
assert.equal(sampleTrackPresentation(cache, 'T', { ...sample, state: 'LOST' }, 2, 2000), null);
console.log(JSON.stringify({ status: 'PASS', singleRadars: results,
  noise: { maxStep60HzM: +a.maxStepM.toFixed(2), maxStep144HzM: +b.maxStepM.toFixed(2) },
  ownerCoverage: 'PASS', shutdownCleanup: 'PASS', sourceArbitration: 'PASS' }, null, 2));
