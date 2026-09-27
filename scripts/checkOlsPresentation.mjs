import assert from 'node:assert/strict';
import { olsWheelZoom } from '../src/scenes/advanced/OlsCameraController.js';
import { useGameStore } from '../src/store/gameStore.js';
import { useOlsViewStore } from '../src/store/olsViewStore.js';
import { useEngine } from '../src/store/engine.js';

// Trackpads emit many small pixel deltas; wheels may emit lines. Equal motion
// must have equal magnification without frame-rate-dependent increments.
let smooth = 5;
for (let i = 0; i < 24; i++) smooth = olsWheelZoom(smooth, -5);
assert.ok(Math.abs(smooth - olsWheelZoom(5, -120)) < 1e-10);
assert.equal(olsWheelZoom(5, -3, 1), olsWheelZoom(5, -48, 0));
assert.equal(olsWheelZoom(40, -240), 40);
assert.equal(olsWheelZoom(1, 240), 1);

const view = { longitude: 30, latitude: 50, zoom: 8, bearing: 21, pitch: 0 };
useGameStore.getState().saveCommandViewState(view);
const before = useEngine.getState();
useGameStore.getState().openOlsFeed('SANDBOX', 'RADAR-TEST');
useOlsViewStore.getState().setZoom(7);
useOlsViewStore.getState().setMode('THERMAL');
useOlsViewStore.getState().release();
assert.equal(useGameStore.getState().presentationMode, 'OLS_FEED');
assert.equal(useEngine.getState(), before, 'Camera actions must not alter simulation or Tracks');
useGameStore.getState().returnToCommand();
assert.equal(useGameStore.getState().scene, 'SANDBOX_2D');
assert.deepEqual(useGameStore.getState().commandViewState, view);
assert.equal(useGameStore.getState().resumeCommandSimulation, true);
console.log('OLS: wheel/trackpad equivalence, zoom bounds, simulation isolation and COMMAND restoration passed.');
