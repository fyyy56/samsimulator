import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ADVANCED_OVERLAY_DEFAULTS, useViewStore } from '../src/store/viewStore.js';
import { useEngine } from '../src/store/engine.js';

const debugKeys = [
  'seekerFov', 'seekerBoresight', 'seekerTargetLos', 'seekerLabels', 'radarBeams',
  'irSeekerFov', 'arhSeekerFov', 'seekerState', 'trackUncertainty', 'sensorSource',
  'rawRadarMeasurements', 'interceptPoint', 'missileAimPoint', 'networkTrackEstimate',
  'seekerEstimate', 'networkOwner', 'performance',
];
const sceneSource = fs.readFileSync(new URL('../src/scenes/AdvancedScene.jsx', import.meta.url), 'utf8');
const menuSource = fs.readFileSync(
  new URL('../src/scenes/advanced/AdvancedOverlayMenu.jsx', import.meta.url), 'utf8');

for (const key of debugKeys) {
  assert.equal(ADVANCED_OVERLAY_DEFAULTS[key], false, `${key}: debug default must be OFF`);
  assert.ok(menuSource.includes(`'${key}'`), `${key}: must be exposed in OVERLAYS menu`);
  assert.ok(sceneSource.includes(`.${key}`), `${key}: must control AdvancedScene visibility`);
  useViewStore.setState({ advancedOverlays: { ...ADVANCED_OVERLAY_DEFAULTS } });
  useViewStore.getState().toggleAdvancedOverlay(key);
  assert.equal(useViewStore.getState().advancedOverlays[key], true,
    `${key}: toggle must make its visibility state true`);
  useViewStore.getState().toggleAdvancedOverlay(key);
  assert.equal(useViewStore.getState().advancedOverlays[key], false,
    `${key}: second toggle must hide it`);
}

useEngine.setState({ seekerEnabled: true });
useEngine.getState().setSeekerEnabled(false);
assert.equal(useEngine.getState().seekerEnabled, false, 'Seeker debug override must disable seekers');
useEngine.getState().toggleSeekerEnabled();
assert.equal(useEngine.getState().seekerEnabled, true, 'Seeker debug override must restore seekers');

console.log(JSON.stringify({ status: 'PASS', debugKeys, default: 'OFF' }, null, 2));
