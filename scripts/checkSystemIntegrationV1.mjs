import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GAME_SCENE, PRESENTATION_MODE, useGameStore } from '../src/store/gameStore.js';
const placementSource = readFileSync(new URL('../src/scenes/advanced/groundPlacement.js', import.meta.url), 'utf8');
assert.match(placementSource, /item\.placementManaged[\s\S]*item\.category === entry\.category/,
  'compatible placed components must use deterministic battery pairing');
assert.match(placementSource, /components: \{ \.\.\.item\.components, launchers:/,
  'launcher placement must modify the real battery components');
assert.match(placementSource, /components: \{ \.\.\.item\.components, radar:/,
  'radar placement must modify the real battery sensor component');
assert.match(placementSource, /partKind === 'RADAR'[\s\S]*radar: null/,
  'radar delete must remove the simulation sensor');

const engineSource = readFileSync(new URL('../src/store/engine.js', import.meta.url), 'utf8');
const controllableSource = readFileSync(new URL('../src/store/controllableAirEntity.js', import.meta.url), 'utf8');
assert.match(controllableSource, /MANUAL:[\s\S]*HOLD:[\s\S]*AUTO_NAV:/);
assert.match(engineSource, /setControllableNavigationWaypoint:[\s\S]*targetType: 'WAYPOINT'/);
assert.match(engineSource, /setControllableNavigationTrack:[\s\S]*track\.reportedPosition/,
  'AUTO NAV track reference must use reported TrackData');
assert.match(engineSource, /FPV_TRACK_COAST_SEC[\s\S]*status: 'TRACK LOST'/);

useGameStore.getState().openFpvFeed('SANDBOX', 'CTRL-TEST');
assert.equal(useGameStore.getState().presentationMode, PRESENTATION_MODE.FPV_FEED);
assert.equal(useGameStore.getState().commandScene, GAME_SCENE.SANDBOX_2D);
useGameStore.getState().returnToCommand();
assert.equal(useGameStore.getState().scene, GAME_SCENE.SANDBOX_2D);

const spawnStoreSource = readFileSync(new URL('../src/store/sandboxSpawnDraftStore.js', import.meta.url), 'utf8');
const simpleSceneSource = readFileSync(new URL('../src/scenes/SimpleModeScene.jsx', import.meta.url), 'utf8');
assert.match(spawnStoreSource, /count: 5[\s\S]*speedKmh: 250[\s\S]*altitudeM: 250/);
assert.match(simpleSceneSource, /useSandboxSpawnDraftStore\(state => state\.draft\)/,
  'spawn form must use the scene-independent draft store');

useGameStore.getState().openOlsFeed(GAME_SCENE.SANDBOX_2D, 'RADAR-1', 'TARGET:T-1');
assert.equal(useGameStore.getState().olsRequestedTargetKey, 'TARGET:T-1');

console.log('System Integration V1: real placement grouping, FPV modes/routes, spawn persistence and OLS context passed.');
