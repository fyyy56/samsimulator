import { Cartesian3, Ellipsoid, EllipsoidalOccluder, Math as CesiumMath,
  Matrix4, SceneTransforms, Transforms } from 'cesium';
import { useOlsViewStore } from '../../store/olsViewStore.js';
import { getBearing } from '../../store/geo.js';

const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
export const olsWheelZoom = (zoom, deltaY, deltaMode = 0) => clamp(
  zoom * Math.exp(-clamp(deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 600 : 1), -240, 240) * 0.002), 1, 40);

// One fixed station camera in the existing Viewer. All entity poses come from
// the renderer's memoized visual state, never a second motion interpolation.
export function createOlsCameraController(viewer, { getMetadata, getBracket, onExit,
  onManualAim, onLaunch }) {
  const canvas = viewer.scene.canvas;
  let active = false, origin, frame, inverseFrame;
  let heading = 0, pitch = 0.1, displayedHeading = 0, displayedPitch = 0.1;
  let lastMs = 0, lastPublish = 0, heldUntil = 0, heldPosition = null, impactAt = -Infinity;
  let zoom = 1, lastPointer = null, savedFov, savedInputs, hadPointerLock = false;
  let captureEnabled = true;
  let lockOffsetHeading = 0, lockOffsetPitch = 0;
  let previousLockGoal = null, rangeM = null;
  let visible = new Map();
  let manualControl = false, stationId = null, lastAimPublishMs = 0;
  const publishAim = (now = performance.now()) => {
    if (!manualControl) return;
    lastAimPublishMs = now;
    onManualAim?.(stationId, CesiumMath.toDegrees(displayedHeading),
      CesiumMath.toDegrees(displayedPitch));
  };
  const anglesTo = position => {
    const local = Matrix4.multiplyByPoint(inverseFrame, position, new Cartesian3());
    return { heading: Math.atan2(local.x, local.y), pitch: Math.atan2(local.z, Math.hypot(local.x, local.y)) };
  };
  const project = position => {
    const distance = Cartesian3.distance(origin, position);
    if (distance > 80_000 || distance < 2) return null;
    const occluder = new EllipsoidalOccluder(Ellipsoid.WGS84, origin);
    if (!occluder.isPointVisible(position)) return null;
    if (Cartesian3.dot(viewer.camera.directionWC,
      Cartesian3.subtract(position, viewer.camera.positionWC, new Cartesian3())) <= 0) return null;
    const p = SceneTransforms.worldToWindowCoordinates(viewer.scene, position);
    return p && p.x >= 0 && p.y >= 0 && p.x <= canvas.clientWidth && p.y <= canvas.clientHeight ? p : null;
  };
  const select = key => {
    if (!active || !key?.startsWith('TARGET:') || !visible.has(key)) return;
    heldUntil = 0; heldPosition = null;
    previousLockGoal = null;
    lockOffsetHeading = 0; lockOffsetPitch = 0;
    useOlsViewStore.setState({ selectedKey: key, status: 'LOCKED' });
  };
  const releaseLock = () => {
    useOlsViewStore.getState().release();
    previousLockGoal = null;
    heading = displayedHeading; pitch = displayedPitch;
    lockOffsetHeading = 0; lockOffsetPitch = 0;
    publishAim();
  };
  const centerTarget = () => {
    const centerX = canvas.clientWidth / 2, centerY = canvas.clientHeight / 2;
    const centered = [...visible.values()].filter(item => item.key.startsWith('TARGET:'))
      .sort((a, b) => Math.hypot(a.x - centerX, a.y - centerY)
        - Math.hypot(b.x - centerX, b.y - centerY))[0];
    return centered && Math.hypot(centered.x - centerX, centered.y - centerY) <= 36
      ? centered.key : null;
  };
  const lockCrosshair = () => {
    if (useOlsViewStore.getState().selectedKey) { releaseLock(); return false; }
    const key = centerTarget();
    if (!key) return false;
    select(key);
    return true;
  };
  const onWheel = event => {
    if (!active) return;
    event.preventDefault();
    const state = useOlsViewStore.getState();
    state.setZoom(olsWheelZoom(state.zoom, event.deltaY, event.deltaMode));
  };
  const onMove = event => {
    if (!active || !captureEnabled) return;
    const locked = document.pointerLockElement === canvas;
    if (!locked && event.target !== canvas) return;
    const dx = locked ? event.movementX : lastPointer ? event.clientX - lastPointer.x : 0;
    const dy = locked ? event.movementY : lastPointer ? event.clientY - lastPointer.y : 0;
    lastPointer = locked ? null : { x: event.clientX, y: event.clientY };
    if (!dx && !dy) return;
    const sensitivity = viewer.camera.frustum.fov / Math.max(1, canvas.clientWidth);
    if (useOlsViewStore.getState().selectedKey) {
      // Fine aim correction stays near the optically tracked target. The lock
      // square remains on the target while the operator nudges the sight.
      const limit = CesiumMath.toRadians(2);
      lockOffsetHeading = clamp(lockOffsetHeading + dx * sensitivity * 0.06, -limit, limit);
      lockOffsetPitch = clamp(lockOffsetPitch - dy * sensitivity * 0.06, -limit, limit);
    } else {
      heading = (heading + dx * sensitivity) % (Math.PI * 2);
      pitch = clamp(pitch - dy * sensitivity, -1.55, 1.55);
      displayedHeading = heading; displayedPitch = pitch;
    }
    publishAim();
  };
  const capturePointer = () => {
    if (!active || document.pointerLockElement === canvas) return;
    try {
      const request = canvas.requestPointerLock?.();
      request?.catch?.(() => {});
    } catch { /* A scene click can retry if entry lacked user activation. */ }
  };
  const onPointerLockChange = () => {
    lastPointer = null;
    if (!active) return;
    if (document.pointerLockElement === canvas) hadPointerLock = true;
    else if (hadPointerLock && captureEnabled) onExit();
  };
  const fireAtCrosshair = () => {
    const targetKey = useOlsViewStore.getState().selectedKey ?? centerTarget();
    onLaunch?.(stationId, targetKey, CesiumMath.toDegrees(displayedHeading),
      CesiumMath.toDegrees(displayedPitch));
  };
  const onPointerDown = event => {
    if (!active || !captureEnabled || event.button !== 0) return;
    // Cesium still has a pointer-capture handler when camera inputs are off.
    // The OLS sight owns this press, so it must not reach that handler.
    event.preventDefault();
    event.stopImmediatePropagation();
    capturePointer();
    fireAtCrosshair();
  };
  const onKey = event => {
    if (!active) return;
    const editing = event.target instanceof HTMLElement
      && event.target.closest('input, textarea, select, [contenteditable="true"]');
    if (event.code === 'Escape') { event.preventDefault(); onExit(); }
    else if (event.code === 'KeyF' && !editing && !event.repeat) {
      event.preventDefault(); lockCrosshair();
    } else if ((event.code === 'ControlLeft' || event.code === 'ControlRight') && !event.repeat) {
      event.preventDefault();
      captureEnabled = !captureEnabled;
      lastPointer = null;
      canvas.style.cursor = captureEnabled ? 'none' : '';
      if (captureEnabled) capturePointer();
      else if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    } else if (event.code === 'KeyE' && !editing && !event.repeat) {
      event.preventDefault();
      const modes = ['DAY', 'LOW-LIGHT', 'THERMAL'];
      const state = useOlsViewStore.getState();
      state.setMode(modes[(modes.indexOf(state.mode) + 1) % modes.length]);
    } else if (event.code === 'Space' && !editing && !event.repeat) {
      event.preventDefault(); fireAtCrosshair();
    }
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  window.addEventListener('keydown', onKey);
  const leave = () => {
    if (!active) return;
    active = false; lastPointer = null; hadPointerLock = false;
    captureEnabled = true;
    manualControl = false; stationId = null;
    canvas.style.cursor = '';
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    viewer.camera.frustum.fov = savedFov;
    viewer.scene.screenSpaceCameraController.enableInputs = savedInputs;
    const bracket = getBracket(); if (bracket) bracket.style.display = 'none';
  };
  return {
    select, leave,
    releaseLock,
    lockCrosshair() {
      return lockCrosshair();
    },
    enter(station, track, requestedKey = null, options = {}) {
      leave();
      manualControl = Boolean(options.manualControl);
      stationId = station.id;
      lastPointer = null; hadPointerLock = false; captureEnabled = true;
      lastAimPublishMs = 0;
      canvas.style.cursor = 'none';
      active = true; lastMs = 0; lastPublish = 0; heldUntil = 0; heldPosition = null; impactAt = -Infinity;
      previousLockGoal = null;
      lockOffsetHeading = 0; lockOffsetPitch = 0;
      visible = new Map();
      const p = station.components?.radar ?? station.components?.fdc ?? station;
      const lat = p.lat ?? p.position?.lat, lng = p.lng ?? p.position?.lng;
      origin = Cartesian3.fromDegrees(lng, lat, (p.altitudeM ?? 0) + 8);
      frame = Transforms.eastNorthUpToFixedFrame(origin);
      inverseFrame = Matrix4.inverseTransformation(frame, new Matrix4());
      heading = CesiumMath.toRadians(track?.reportedPosition
        ? getBearing(lat, lng, track.reportedPosition.lat, track.reportedPosition.lng)
        : station.radarHeading ?? p.heading ?? 90);
      pitch = 0.12;
      if (track?.reportedPosition) pitch = anglesTo(Cartesian3.fromDegrees(track.reportedPosition.lng,
        track.reportedPosition.lat, track.reportedAltitudeM ?? track.reportedPosition.alt ?? 0)).pitch;
      displayedHeading = heading; displayedPitch = pitch;
      const requestedPosition = requestedKey && getMetadata().get(requestedKey)?.visualState?.worldPosition;
      if (requestedPosition) {
        const aim = anglesTo(requestedPosition);
        heading = aim.heading; pitch = aim.pitch;
        displayedHeading = heading; displayedPitch = pitch;
      }
      // Seed the Tor sight from the camera's actual entry direction.
      publishAim();
      const state = useOlsViewStore.getState(); zoom = state.zoom;
      useOlsViewStore.setState({ selectedKey: null, visibleEntities: [],
        status: manualControl ? 'MANUAL' : 'FREE' });
      savedFov = viewer.camera.frustum.fov;
      savedInputs = viewer.scene.screenSpaceCameraController.enableInputs;
      viewer.scene.screenSpaceCameraController.enableInputs = false;
      viewer.camera.lookAtTransform(Matrix4.IDENTITY);
      capturePointer();
    },
    update(now) {
      if (!active) return;
      const dt = lastMs ? clamp((now - lastMs) / 1000, 0, 0.1) : 1 / 60; lastMs = now;
      const state = useOlsViewStore.getState();
      const meta = getMetadata().get(state.selectedKey);
      rangeM = meta?.visualState ? Cartesian3.distance(origin, meta.visualState.worldPosition)
        : heldPosition ? Cartesian3.distance(origin, heldPosition) : null;
      if (state.selectedKey && !heldUntil && meta?.visualState) {
        const angles = anglesTo(meta.visualState.worldPosition);
        heading = angles.heading + lockOffsetHeading;
        pitch = angles.pitch + lockOffsetPitch;
      } else if (state.selectedKey && !heldUntil && !meta) releaseLock();
      if (heldUntil && now >= heldUntil) { heldUntil = 0; heldPosition = null; releaseLock(); }
      if (heldPosition && state.selectedKey) {
        const angles = anglesTo(heldPosition);
        heading = angles.heading + lockOffsetHeading;
        pitch = angles.pitch + lockOffsetPitch;
      }
      // Follow motion on the shared visual timeline without a steady angular
      // lag (which becomes hundreds of pixels at high zoom). Damp only the
      // acquisition residual; changing the selected entity never snaps.
      if (state.selectedKey && previousLockGoal?.key === state.selectedKey) {
        displayedHeading += Math.atan2(Math.sin(heading - previousLockGoal.heading),
          Math.cos(heading - previousLockGoal.heading));
        displayedPitch += pitch - previousLockGoal.pitch;
      }
      previousLockGoal = state.selectedKey ? { key: state.selectedKey, heading, pitch } : null;
      const alpha = 1 - Math.exp(-dt / 0.12);
      displayedHeading += Math.atan2(Math.sin(heading - displayedHeading), Math.cos(heading - displayedHeading)) * (manualControl ? 1 : alpha);
      displayedPitch += (pitch - displayedPitch) * (manualControl ? 1 : alpha);
      if (state.selectedKey && now - lastAimPublishMs >= 50) publishAim(now);
      zoom += (state.zoom - zoom) * (1 - Math.exp(-dt / 0.09));
      viewer.camera.frustum.fov = 2 * Math.atan(Math.tan(CesiumMath.toRadians(48) / 2) / zoom);
      viewer.camera.setView({ destination: origin, orientation: {
        heading: displayedHeading, pitch: displayedPitch, roll: 0,
      } });
    },
    project(now) {
      if (!active) return;
      const state = useOlsViewStore.getState();
      const next = new Map();
      for (const [key, meta] of getMetadata()) {
        if (meta.kind === 'SEARCH_RADAR' || meta.holdUntilMs || !meta.visualState) continue;
        const point = project(meta.visualState.worldPosition);
        if (point) next.set(key, { key, id: meta.id, name: meta.presentation.displayName, x: point.x, y: point.y });
      }
      visible = next;
      const bracket = getBracket(), locked = next.get(state.selectedKey);
      if (bracket) {
        bracket.style.display = locked ? 'block' : 'none';
        if (locked) bracket.style.transform = `translate3d(${locked.x}px,${locked.y}px,0)`;
      }
      if (now - lastPublish >= 150) {
        lastPublish = now;
        useOlsViewStore.setState({ visibleEntities: [...next.values()], opticalTelemetry: {
          azimuthDeg: (CesiumMath.toDegrees(displayedHeading) % 360 + 360) % 360,
          elevationDeg: CesiumMath.toDegrees(displayedPitch), rangeM,
          fovDeg: CesiumMath.toDegrees(viewer.camera.frustum.fov),
        } });
      }
    },
    impact(key, position) {
      if (!active) return;
      if (project(position)) impactAt = performance.now();
      const selectedKey = useOlsViewStore.getState().selectedKey;
      if (selectedKey === key || getMetadata().get(selectedKey)?.visualImpact?.effectKey === key) {
        heldPosition = Cartesian3.clone(position); heldUntil = performance.now() + 3200;
        useOlsViewStore.setState({ status: 'IMPACT' });
      }
    },
    optics: () => ({ zoom, rangeM: rangeM ?? 10000,
      flashAgeSec: active ? Math.max(0, performance.now() - impactAt) / 1000 : 100 }),
    flash: () => active ? Math.exp(-Math.max(0, performance.now() - impactAt) / 180) : 0,
    destroy() {
      leave();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      window.removeEventListener('keydown', onKey);
    },
  };
}
