import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONTROLLABLE_AIR_PROFILE_IDS,
  getControllableAirProfile,
} from '../src/data/controllableAirProfiles.js';
import {
  formatTrackLabelData,
  getTrackLabelQuality,
} from '../src/ui/trackLabelFormatting.js';

const profile = getControllableAirProfile(CONTROLLABLE_AIR_PROFILE_IDS.SKYFALL_FPV);
assert.ok(profile.camera.fpvFovDeg > profile.camera.firstPersonFovDeg,
  'FPV uses a wider configurable field of view than clean first person');
assert.ok(profile.camera.fpvRotationDampingSec > profile.camera.firstPersonRotationDampingSec,
  'FPV has its own softer render-time orientation smoothing');
assert.ok(profile.camera.fpvLensDistortion > 0 && profile.camera.fpvLensDistortion < 0.05,
  'FPV uses a subtle wide-angle lens treatment instead of a caricature effect');
assert.ok(profile.controller.mouseControl.rollCoupling > 0,
  'Horizontal mouse input can create natural bank as well as yaw');

const registrySource = readFileSync(new URL('../src/data/advanced3dRegistry.js', import.meta.url), 'utf8');
assert.match(registrySource, /SKYFALL_P1_SUN[\s\S]{0,700}forwardAxis: '\+Y'/);
assert.doesNotMatch(registrySource, /SKYFALL_P1_SUN[\s\S]{0,700}modelQuaternionOffset/,
  'The GLB root transform must not be applied a second time');

const advancedSource = readFileSync(new URL('../src/scenes/AdvancedScene.jsx', import.meta.url), 'utf8');
assert.match(advancedSource, /ADVANCED_VISUAL_MODE[\s\S]*THERMAL/);
assert.match(advancedSource, /selectedTrackVisibleLineOfSight/);
assert.match(advancedSource, /getTargetDisplayName\(track\.identifiedModelId\)/);
assert.match(advancedSource, /controlledMeta\?\.visualState\?\.position/,
  'The controlled model and camera share the same render-time visual state');
assert.match(advancedSource, /thermalTrailEntitiesRef/,
  'Thermal heat traces reuse the shared render update instead of a per-entity RAF');
assert.match(advancedSource, /currentAmps/);
assert.match(advancedSource, /flightTimeSec/);
assert.match(advancedSource, /rollCoupling/);

const stableTrack = {
  id: 'TRK-001', state: 'TRACKED', trackQuality: 0.9, measurementAgeSec: 0.4,
  reportedAltitudeM: 451, reportedSpeedKmh: 140.4,
};
const staleTrack = { ...stableTrack, trackQuality: 0.3, measurementAgeSec: 3.5 };
assert.equal(getTrackLabelQuality(stableTrack).approximate, false);
assert.equal(getTrackLabelQuality(staleTrack).approximate, true);
const approximateLabel = formatTrackLabelData(staleTrack, 19.492);
assert.match(approximateLabel.distanceText, /^~/);
assert.match(approximateLabel.altitudeText, /^~/);
assert.match(approximateLabel.speedText, /^~/,
  'Low-quality/stale TrackData is visibly approximate across render modes');

const commandSource = readFileSync(new URL('../src/scenes/SimpleModeScene.jsx', import.meta.url), 'utf8');
assert.match(commandSource, /setSelectedControllableEntity\(entity\.id\)[\s\S]*setControlledControllableEntity\(entity\.id\)[\s\S]*CONTROLLABLE_CAMERA_MODE\.FPV[\s\S]*openFpvFeed/,
  'Clicking the own FPV marker performs the complete temporary COMMAND feed handoff');
assert.match(commandSource, /duration: 900,[\s\S]{0,300}openFpvFeed[\s\S]{0,120}, 920\);/,
  'COMMAND briefly focuses the launch area before entering the FPV feed');
assert.match(commandSource, /const sweepWidths = isElectronic[\s\S]*radar\.scanState\.currentAzimuth/,
  'Mechanical and electronic radar visuals use authoritative scan state');
assert.doesNotMatch(commandSource, /if \(!isElectronic\) \{[\s\S]{0,400}kind: 'sweep'/,
  'Electronic radar visuals are not suppressed');
assert.match(commandSource, /formatTrackLabelData\(track/,
  'COMMAND uses the same TrackData label formatter as Advanced/FPV');

console.log('FPV visual/camera/radar regression checks passed.');
