// Isolated visual poses, NOT a guidance/weapon test. Uses the production model
// registry, buffered pose, anchors, FOLLOW controller and OLS controller.
import { Viewer, Cartesian3, CallbackProperty, CallbackPositionProperty, Color,
  Matrix3, Matrix4, Transforms, SceneTransforms, EllipsoidTerrainProvider,
  ArcType, Math as CesiumMath } from 'cesium';
import { getAdvancedInterceptorPresentation } from '../src/data/advanced3dRegistry.js';
import { createVisualPoseProperties, createWorldMissileBillboard, bodyToWorldQuaternion,
  getVisualExhaustPosition, getVisualModelAnchorPosition } from '../src/scenes/advanced/modelOrientation.js';
import { pushVisualSnapshot, sampleVisualState } from '../src/scenes/advanced/visualInterpolation.js';
import { createAdvancedCameraController } from '../src/scenes/advanced/AdvancedCameraController.js';
import { createOlsCameraController } from '../src/scenes/advanced/OlsCameraController.js';
import { useOlsViewStore } from '../src/store/olsViewStore.js';
import { createFpvCameraEffect } from '../src/scenes/advanced/fpvCameraEffect.js';
import { INTERCEPTOR_SPECS } from '../src/data/interceptors.js';
import { applyMissileAutopilot, velocityFromFlightPath } from '../src/store/missileGuidanceCore.js';
import { createTerminalControlVfx } from '../src/scenes/advanced/terminalControlVfx.js';

const viewer = new Viewer('viewer', { baseLayer: false, terrainProvider: new EllipsoidTerrainProvider(),
  animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
  sceneModePicker: false, navigationHelpButton: false, infoBox: false, selectionIndicator: false });
viewer.scene.globe.baseColor = Color.fromCssColorString('#152a37');
viewer.scene.skyAtmosphere.show = false;
viewer.scene.backgroundColor = Color.fromCssColorString('#102333');
const controls = document.getElementById('controls');
const output = document.createElement('output');
const errors = [];
viewer.scene.renderError.addEventListener((_scene, error) => errors.push(String(error)));
let id = 'INT-LONG-V1', presentation, time = 0, moving = false, view = 'SIDE', thermal = false;
let controlSample = null;
let pose, cache = new Map(), lastTick = -Infinity, previousMs = performance.now(), frames = 0;
const metadata = new Map();
const camera = createAdvancedCameraController(viewer);
const ols = createOlsCameraController(viewer, { getMetadata: () => metadata,
  getBracket: () => document.getElementById('bracket'), onExit: () => setView('SIDE') });
const effect = createFpvCameraEffect(viewer.scene, () => ({ fpv: false, ols: view === 'OLS',
  thermal, lowLight: false, signal: 1 }));
const button = (name, action) => {
  const b = document.createElement('button'); b.textContent = name; b.onclick = action; controls.append(b); return b;
};
const modelButtons = new Map();
for (const [key, label] of [['INT-LONG-V1', 'PAC-3'], ['INT-MEDIUM-V1', 'AIM-120'],
  ['INT-SHORT-V1', 'IRIS-T'], ['INT-ASTER30-V1', 'Aster 30']]) {
  modelButtons.set(key, button(label, () => load(key)));
}
const viewButtons = new Map();
for (const mode of ['SIDE', 'FRONT', 'REAR', 'FOLLOW', 'OLS']) viewButtons.set(mode, button(mode, () => setView(mode)));
const motionButton = button('MOVEMENT', () => { moving = !moving; motionButton.setAttribute('aria-pressed', moving); });
const heatButton = button('HOTSPOT / THERMAL', () => { thermal = !thermal; heatButton.setAttribute('aria-pressed', thermal); });
button('OLS ZOOM 10', () => useOlsViewStore.getState().setZoom(10));
button('OLS ZOOM 40', () => useOlsViewStore.getState().setZoom(40));
const sampleControl = specId => {
  const physics = INTERCEPTOR_SPECS[specId].gameplayPhysics;
  const result = applyMissileAutopilot({ physics, deltaTimeSec: 0.02,
    interceptor: { heading: 0, flightPathAngleDeg: 0, speedKmh: 3600, flightTime: 20 },
    command: { commandedAccelerationVectorMps2: { eastMps: 0, northMps: 0, upMps: 190 },
      availableAccelerationMps2: 350, predictedClosestApproachM: 150, closingSpeedMps: 1200 },
    controlContext: { terminal: true, solutionStatus: 'VALID', timeToGoSec: 1.5, directionErrorDeg: 10 } });
  controlSample = { specId, result };
  moving = false; load(specId);
};
button('PIF SNAPSHOT', () => sampleControl('INT-ASTER30-V1'));
button('ACM SNAPSHOT', () => sampleControl('INT-LONG-V1'));
button('CONTROL OFF', () => { controlSample = null; load(id); });
controls.append(output);

function updatePose() {
  // Slow sinusoidal eastward movement makes pitch/heading visibly change.
  const lat = 50.0009 + Math.sin(time / 5) * 0.00005;
  const lng = 30 + time * 0.000018;
  const east = 1.29, north = Math.cos(time / 5) * 1.11, up = Math.cos(time / 4) * 0.5;
  const kinematics = { headingDeg: Math.atan2(east, north) * 180 / Math.PI,
    pitchDeg: Math.atan2(up, Math.hypot(east, north)) * 180 / Math.PI,
    rollDeg: 0, eastMps: east, northMps: north, upMps: up };
  if (controlSample) {
    const result = controlSample.result;
    Object.assign(kinematics, velocityFromFlightPath(result.heading, 1000, result.flightPathAngleDeg), {
      headingDeg: result.controlActuators.bodyHeadingDeg,
      pitchDeg: result.controlActuators.bodyPitchDeg,
      controlActuators: result.controlActuators, flightTime: 20.02, guidanceEnabled: true,
    });
  }
  if (time - lastTick >= 0.05 || !pose) {
    pushVisualSnapshot(cache, id, { lat, lng, altitudeM: 60 + Math.sin(time / 4) * 2 }, kinematics, time);
    lastTick = time;
  }
  pose = sampleVisualState(cache, id, Math.max(0, time - 0.05));
  metadata.set(id, { id, kind: 'INTERCEPTOR', presentation, visualState: pose });
}
const readPose = () => pose;
// Same inexpensive radial FLASH texture used by the Tor/production mini jet.
const flash = document.createElement('canvas'); flash.width = 128; flash.height = 128;
const ctx = flash.getContext('2d');
const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 60);
gradient.addColorStop(0, 'rgba(255,255,255,1)');
gradient.addColorStop(0.12, 'rgba(255,255,255,.98)');
gradient.addColorStop(0.38, 'rgba(255,255,255,.38)');
gradient.addColorStop(1, 'rgba(84,67,55,0)');
ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
const controlVfx = createTerminalControlVfx(viewer, { flash }, {
  getPose: readPose, getVisualMode: () => thermal ? 'THERMAL' : 'DAY' });
const anchor = key => new CallbackPositionProperty((_t, result) => Cartesian3.clone(
  key === 'exhaust' ? getVisualExhaustPosition(pose, pose.worldPosition, presentation)
    : getVisualModelAnchorPosition(pose, presentation, presentation.thermalAnchorModelM), result), false);

function load(nextId) {
  controlVfx.destroy();
  if (controlSample?.specId !== nextId) controlSample = null;
  ols.leave(); id = nextId; time = 0; pose = null; lastTick = -Infinity; cache = new Map(); metadata.clear();
  presentation = getAdvancedInterceptorPresentation({ interceptorSpecId: id,
    motorPhase: controlSample ? 'BURNOUT' : 'BOOST' });
  viewer.entities.removeAll(); updatePose();
  viewer.entities.add({ id, ...createVisualPoseProperties(readPose, presentation),
    model: presentation.modelUri ? { uri: presentation.modelUri, scale: presentation.baseVisualScale,
      minimumPixelSize: presentation.minPixelSize, maximumScale: presentation.maxVisualScale,
      runAnimations: false, shadows: 0 } : undefined,
    billboard: presentation.modelUri ? undefined : { image: presentation.fallbackBillboard,
      ...createWorldMissileBillboard(readPose, presentation, viewer.camera) } });
  viewer.entities.add({ position: anchor('exhaust'), point: { pixelSize: 5,
    color: Color.fromCssColorString('#fff2b0'), outlineColor: Color.ORANGE, outlineWidth: 2 } });
  viewer.entities.add({ position: anchor('heat'), show: new CallbackProperty(() => thermal, false),
    point: { pixelSize: 6, color: Color.WHITE, outlineColor: Color.WHITE.withAlpha(0.3), outlineWidth: 2 } });
  viewer.entities.add({ polyline: { arcType: ArcType.NONE, width: 3, material: Color.ORANGE.withAlpha(0.6),
    positions: new CallbackProperty(() => {
      const tail = getVisualExhaustPosition(pose, pose.worldPosition, presentation);
      const forward = Matrix3.multiplyByVector(Matrix3.fromQuaternion(bodyToWorldQuaternion(pose.worldPosition,
        pose.quaternion)), Cartesian3.UNIT_X, new Cartesian3());
      return [tail, Cartesian3.subtract(tail, Cartesian3.multiplyByScalar(forward, 2, new Cartesian3()), new Cartesian3())];
    }, false) } });
  for (const [key, b] of modelButtons) b.setAttribute('aria-pressed', key === id);
  setView(view);
}
function setView(mode) {
  ols.leave(); view = mode; viewer.camera.lookAtTransform(Matrix4.IDENTITY);
  camera.setMode(mode === 'FOLLOW' ? 'FOLLOW' : 'FREE', true);
  viewer.camera.frustum.fov = CesiumMath.toRadians(mode === 'FOLLOW' ? 5 : 45);
  if (mode === 'OLS') {
    useOlsViewStore.getState().setZoom(40);
    ols.enter({ lat: 50, lng: 30, altitudeM: 0 }, { reportedPosition: { lat: 50.0009, lng: 30 }, reportedAltitudeM: 60 });
    useOlsViewStore.setState({ selectedKey: id, status: 'TRACKING' });
  }
  for (const [key, b] of viewButtons) b.setAttribute('aria-pressed', key === mode);
}
viewer.scene.preRender.addEventListener(() => {
  const now = performance.now(); if (moving) time += Math.min(0.05, (now - previousMs) / 1000); previousMs = now;
  updatePose(); effect.enabled = thermal || view === 'OLS';
  controlVfx.update(id, {}, pose, presentation);
  if (view === 'OLS') ols.update(now);
  else if (view === 'FOLLOW') {
    camera.update({ selectedPosition: pose.worldPosition, ...pose.kinematics, bodyQuaternion: pose.quaternion,
      selectedAltitudeM: 60, timestampMs: now });
    // A fixture inspection lens; uses the unchanged production FOLLOW motion.
    viewer.camera.frustum.fov = CesiumMath.toRadians(5);
  } else {
    const rotation = Matrix3.fromQuaternion(bodyToWorldQuaternion(pose.worldPosition, pose.quaternion));
    const offset = view === 'SIDE' ? new Cartesian3(0, -18, 2) : new Cartesian3(view === 'FRONT' ? 18 : -18, 0, 0);
    const destination = Cartesian3.add(pose.worldPosition, Matrix3.multiplyByVector(rotation, offset, new Cartesian3()), new Cartesian3());
    viewer.camera.setView({ destination, orientation: {
      direction: Cartesian3.normalize(Cartesian3.subtract(pose.worldPosition, destination, new Cartesian3()), new Cartesian3()),
      up: Matrix4.multiplyByPointAsVector(Transforms.eastNorthUpToFixedFrame(pose.worldPosition), Cartesian3.UNIT_Z, new Cartesian3()) } });
  }
});
viewer.scene.postRender.addEventListener(() => {
  frames++; if (view === 'OLS') ols.project(performance.now());
  const tail = getVisualExhaustPosition(pose, pose.worldPosition, presentation);
  const engine = getVisualModelAnchorPosition(pose, presentation, presentation.thermalAnchorModelM);
  const projected = SceneTransforms.worldToWindowCoordinates(viewer.scene, tail);
  output.textContent = `${presentation.displayName} | ${presentation.modelUri ? 'GLB' : '2D FALLBACK — no supplied GLB'} | ${view}\n`
    + `uniform scale ${presentation.baseVisualScale} | minimumPixelSize ${presentation.minPixelSize} | heat/exhaust gap ${Cartesian3.distance(tail, engine).toFixed(3)} m\n`
    + `pose t=${time.toFixed(2)} | frames ${frames} | exhaust on screen ${Boolean(projected)} | errors ${errors.join('; ') || 'none'}`;
  if (controlSample) output.textContent += `\nFROZEN CORE CONTROL SAMPLE (not a hit test): ${controlSample.result.controlActuators.kind}`
    + ` | PIF ${controlSample.result.controlActuators.pifIntensity.toFixed(2)}`
    + ` | ACM event ${controlSample.result.controlActuators.acmPulse?.id ?? 0}`
    + ` | jet lobes ${viewer.entities.values.filter(e => e.billboard?.image?.getValue() === flash && e.show).length}`;
});
load(id);
