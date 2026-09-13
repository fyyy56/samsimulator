import assert from 'node:assert/strict';
import { fpvLensSample, FPV_LENS_STRENGTH } from '../src/scenes/advanced/fpvCameraEffect.js';
import { CONTROLLABLE_AIR_PROFILES, CONTROLLABLE_AIR_PROFILE_IDS } from '../src/data/controllableAirProfiles.js';
import { formatTrackLabelData } from '../src/ui/trackLabelFormatting.js';

const camera = CONTROLLABLE_AIR_PROFILES[CONTROLLABLE_AIR_PROFILE_IDS.SKYFALL_FPV].camera;
assert.ok(camera.fpvFovDeg >= 135 && camera.fpvFovDeg <= 155);
assert.equal(camera.firstPersonFovDeg, 70, 'Clean first-person FOV is unchanged');
assert.equal(FPV_LENS_STRENGTH, camera.fpvLensDistortion);
assert.deepEqual(fpvLensSample(0, 0), { x: 0, y: 0 });
for (let row = -100; row <= 100; row++) {
  let previous = -Infinity;
  for (let col = -100; col <= 100; col++) {
    const sample = fpvLensSample(col / 100, row / 100);
    assert.ok(Math.abs(sample.x) <= 1 && Math.abs(sample.y) <= 1, 'Lens stays inside texture: no black edge sampling');
    assert.ok(sample.x > previous, 'Lens remains monotonic: no folded image/pick coordinates');
    previous = sample.x;
    const mirrored = fpvLensSample(-col / 100, -row / 100);
    assert.ok(Math.abs(sample.x + mirrored.x) < 1e-10 && Math.abs(sample.y + mirrored.y) < 1e-10);
  }
}
const track = { id: 'TRK-001', state: 'TRACKED', trackQuality: .9,
  measurementAgeSec: .5, reportedAltitudeM: 451, reportedSpeedKmh: 140.4 };
// Precision was intentionally changed in the preceding vertical-label pass.
assert.equal(formatTrackLabelData(track, 19.492).distanceText, '19.492 km');
assert.equal(formatTrackLabelData({ ...track, measurementAgeSec: 5 }, 19.492).distanceText, '~19.5 km');
assert.equal(formatTrackLabelData(track, 19.492).speedText, '39 m/s');
console.log('FPV OSD: 40,401 lens/picking samples, separate FOV, precise/stale labels passed.');
