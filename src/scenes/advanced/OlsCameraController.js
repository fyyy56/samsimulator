import { Cartesian3, Ellipsoid, EllipsoidalOccluder, Math as CesiumMath,
  Matrix4, SceneTransforms, Transforms } from 'cesium';
import { useOlsViewStore } from '../../store/olsViewStore.js';
import { getBearing } from '../../store/geo.js';

const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
export const olsWheelZoom = (zoom, deltaY, deltaMode = 0) => clamp(
  zoom * Math.exp(-clamp(deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 600 : 1), -240, 240) * 0.002), 1, 40);

// One fixed station camera in the existing Viewer. All entity poses come from
// the renderer's memoized visual state, never a second motion interpolation.
export function createOlsCameraController(viewer, { getMetadata, getBracket, onExit }) {
  const canvas = viewer.scene.canvas;
  let active = false, origin, frame, inverseFrame;
  let heading = 0, pitch = 0.1, displayedHeading = 0, displayedPitch = 0.1;
  let lastMs = 0, lastPublish = 0, heldUntil = 0, heldPosition = null, impactAt = -Infinity;
  let zoom = 1, drag = null, moved = false, savedFov, savedInputs;
  let previousLockGoal = null;
  let visible = new Map();
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
    if (!active || !visible.has(key)) return;
    heldUntil = 0; heldPosition = null;
    previousLockGoal = null;
    useOlsViewStore.setState({ selectedKey: key, status: 'TRACKING' });
  };
  const onWheel = event => {
    if (!active) return;
    event.preventDefault();
    const state = useOlsViewStore.getState();
    state.setZoom(olsWheelZoom(state.zoom, event.deltaY, event.deltaMode));
  };
  const onDown = event => {
    if (!active || event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY }; moved = false;
    canvas.setPointerCapture?.(event.pointerId);
  };
  const onMove = event => {
    if (!active || !drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) < 2) return;
    moved = true;
    useOlsViewStore.getState().release();
    const sensitivity = viewer.camera.frustum.fov / Math.max(1, canvas.clientWidth);
    heading -= dx * sensitivity; pitch = clamp(pitch + dy * sensitivity, -0.12, 1.48);
    drag = { x: event.clientX, y: event.clientY };
  };
  const onUp = event => {
    if (!active || !drag) return;
    drag = null;
    if (moved) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const closest = [...visible.values()].sort((a, b) =>
      Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    if (closest && Math.hypot(closest.x - x, closest.y - y) <= 30) select(closest.key);
  };
  const onKey = event => {
    if (active && event.code === 'Escape') { event.preventDefault(); onExit(); }
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey);
  const leave = () => {
    if (!active) return;
    active = false; drag = null;
    viewer.camera.frustum.fov = savedFov;
    viewer.scene.screenSpaceCameraController.enableInputs = savedInputs;
    const bracket = getBracket(); if (bracket) bracket.style.display = 'none';
  };
  return {
    select, leave,
    enter(station, track) {
      leave();
      active = true; lastMs = 0; lastPublish = 0; heldUntil = 0; heldPosition = null; impactAt = -Infinity;
      previousLockGoal = null;
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
      const state = useOlsViewStore.getState(); zoom = state.zoom;
      useOlsViewStore.setState({ selectedKey: null, visibleEntities: [], status: 'FREE' });
      savedFov = viewer.camera.frustum.fov;
      savedInputs = viewer.scene.screenSpaceCameraController.enableInputs;
      viewer.scene.screenSpaceCameraController.enableInputs = false;
      viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    },
    update(now) {
      if (!active) return;
      const dt = lastMs ? clamp((now - lastMs) / 1000, 0, 0.1) : 1 / 60; lastMs = now;
      const state = useOlsViewStore.getState();
      const meta = getMetadata().get(state.selectedKey);
      if (state.selectedKey && !heldUntil && meta?.visualState) {
        const angles = anglesTo(meta.visualState.worldPosition);
        heading = angles.heading; pitch = angles.pitch;
      } else if (state.selectedKey && !heldUntil && !meta) state.release();
      if (heldUntil && now >= heldUntil) { heldUntil = 0; heldPosition = null; state.release(); }
      if (heldPosition && state.selectedKey) {
        const angles = anglesTo(heldPosition); heading = angles.heading; pitch = angles.pitch;
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
      displayedHeading += Math.atan2(Math.sin(heading - displayedHeading), Math.cos(heading - displayedHeading)) * alpha;
      displayedPitch += (pitch - displayedPitch) * alpha;
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
        useOlsViewStore.setState({ visibleEntities: [...next.values()] });
      }
    },
    impact(key, position) {
      if (!active) return;
      if (project(position)) impactAt = performance.now();
      const selectedKey = useOlsViewStore.getState().selectedKey;
      if (selectedKey === key || getMetadata().get(selectedKey)?.visualImpact?.effectKey === key) {
        heldPosition = Cartesian3.clone(position); heldUntil = performance.now() + 1800;
        useOlsViewStore.setState({ status: 'IMPACT' });
      }
    },
    flash: () => active ? Math.exp(-Math.max(0, performance.now() - impactAt) / 180) : 0,
    destroy() {
      leave();
      canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    },
  };
}
