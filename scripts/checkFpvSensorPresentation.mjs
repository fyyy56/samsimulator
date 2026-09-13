import assert from 'node:assert/strict';
import { useEngine } from '../src/store/engine.js';
import { createAirTarget } from '../src/store/airTargetSystem.js';
import { createTrackDataView, isAvailableNetworkTrack } from '../src/store/trackDataProvider.js';
import { formatTrackCesiumLabel } from '../src/ui/trackLabelFormatting.js';

const engine = () => useEngine.getState();
for (const radarId of ['RADAR_P18', 'RADAR_35D6', 'RADAR_79K6']) {
  engine().resetScenario('SANDBOX');
  engine().startDeploy(radarId);
  engine().handleMapClick(50, 30);
  const destination = { lat: 50, lng: 35 };
  useEngine.setState({ airTargets: [createAirTarget({
    id: 'TEST-SENSOR', type: 'CRUISE_TARGET', modelId: 'KH_555',
    spawnPosition: { lat: 50, lng: 30.25 }, destination, route: [destination],
    speedKmh: 150, altitudeM: 12000,
  }, engine().simulationTime)] });
  for (let tick = 0; tick < 2400 && !engine().tracks.some(isAvailableNetworkTrack); tick++) engine().tick(0.05);
  const track = engine().tracks.find(isAvailableNetworkTrack);
  assert.ok(track, `${radarId}: observation must reach the network without a weapon`);
  assert.equal(engine().batteries.length, 0);
  assert.equal(engine().missiles.length, 0);
  assert.equal(track.sourceBatteryId, engine().searchRadars[0].id);
  const view = createTrackDataView(track, engine().simulationTime);
  assert.deepEqual(view.positionEstimate, track.reportedPosition);
  assert.equal(view.trackId, track.id);
  engine().setSelectedTrack(track.id);
  const id = engine().spawnControllableTestEntity();
  assert.equal(engine().controllableAirEntities.find(entity => entity.id === id).selectedTrackId, track.id);
  engine().setControllableSelectedTrack(id, null);
  engine().setSelectedControllableEntity(id);
  assert.equal(engine().controllableAirEntities.find(entity => entity.id === id).selectedTrackId, track.id,
    'Map selection transfers before the map selection is cleared');
  assert.equal(engine().selectedTrackId, null);
  const lost = { ...track, state: 'LOST' };
  assert.equal(isAvailableNetworkTrack(lost), false);
  useEngine.setState({ tracks: [lost] });
  engine().setControllableSelectedTrack(id, track.id);
  assert.equal(engine().controllableAirEntities.find(entity => entity.id === id).selectedTrackId, null);
  console.log(`${radarId}: network Track -> FPV assignment passed (no SAM launch)`);
}
assert.equal(isAvailableNetworkTrack({ state: 'TRACKED', reportedPosition: { lat: NaN, lng: 30 } }), false);
const precise = { id: 'TRK-001', state: 'TRACKED', trackQuality: 0.9, measurementAgeSec: 0,
  reportedAltitudeM: 451, reportedSpeedKmh: 140.4 };
assert.deepEqual(formatTrackCesiumLabel(precise, 19.492).split('\n'), ['T-001', '19.492 km', '451 m', '39 m/s']);
assert.match(formatTrackCesiumLabel({ ...precise, state: 'COASTING', measurementAgeSec: 8 }, 19.492), /~19.5 km\n~450 m\n~40 m\/s/);
console.log('Track precision, stale formatting and LOST exclusion passed.');
