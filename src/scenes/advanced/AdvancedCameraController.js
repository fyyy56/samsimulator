import {
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  Matrix4,
  Matrix3,
  Quaternion,
  Transforms,
} from 'cesium';
import { bodyToWorldQuaternion } from './modelOrientation.js';
import { visualBodyQuaternion } from './visualInterpolation.js';

export const ADVANCED_CAMERA_MODE = Object.freeze({
  FREE: 'FREE',
  FOLLOW: 'FOLLOW',
  SIDE: 'SIDE',
  TACTICAL: 'TACTICAL',
  THIRD_PERSON: 'THIRD_PERSON',
  FIRST_PERSON: 'FIRST_PERSON',
  FPV: 'FPV',
});

const CAMERA_MIN_HEIGHT_M = 35;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const dampingAlpha = (deltaSec, timeConstantSec) => (
  1 - Math.exp(-Math.max(0, deltaSec) / Math.max(0.001, timeConstantSec))
);
// Exact first-order response to a linearly moving goal, rather than treating
// each new goal as stationary for the whole frame (FPS-dependent follow lag).
const dampMovingGoal = (value, previousGoal, goal, dt, tau) => {
  if (dt <= 0) return value;
  const velocity = (goal - previousGoal) / dt;
  return goal - velocity * tau
    + (value - previousGoal + velocity * tau) * Math.exp(-dt / tau);
};

const localOffsetToWorld = (center, eastM, northM, upM) => Matrix4.multiplyByPoint(
  Transforms.eastNorthUpToFixedFrame(center),
  new Cartesian3(eastM, northM, upM),
  new Cartesian3(),
);

const getCameraFrame = (lookAt, destination, rollDeg = 0) => {
  const direction = Cartesian3.normalize(
    Cartesian3.subtract(lookAt, destination, new Cartesian3()),
    new Cartesian3(),
  );
  const radialUp = Cartesian3.normalize(lookAt, new Cartesian3());
  let right = Cartesian3.cross(direction, radialUp, new Cartesian3());
  if (Cartesian3.magnitude(right) < 1e-5) right = Cartesian3.clone(Cartesian3.UNIT_X);
  else Cartesian3.normalize(right, right);
  let up = Cartesian3.normalize(
    Cartesian3.cross(right, direction, new Cartesian3()),
    new Cartesian3(),
  );
  if (Math.abs(rollDeg) > 0.001) {
    const rollRad = CesiumMath.toRadians(rollDeg);
    up = Cartesian3.normalize(Cartesian3.add(
      Cartesian3.multiplyByScalar(up, Math.cos(rollRad), new Cartesian3()),
      Cartesian3.multiplyByScalar(right, Math.sin(rollRad), new Cartesian3()),
      new Cartesian3(),
    ), new Cartesian3());
  }
  return { direction, up };
};

const keepAboveGlobe = (position, minimumHeightM = CAMERA_MIN_HEIGHT_M) => {
  const cartographic = Cartographic.fromCartesian(position);
  if (!cartographic || cartographic.height >= minimumHeightM) return position;
  return Cartesian3.fromRadians(
    cartographic.longitude,
    cartographic.latitude,
    minimumHeightM,
  );
};

export function createAdvancedCameraController(viewer) {
  const canvas = viewer.scene.canvas;
  const screenController = viewer.scene.screenSpaceCameraController;
  const defaultFov = viewer.camera.frustum?.fov;
  const state = {
    mode: ADVANCED_CAMERA_MODE.FREE,
    orbitYawDeg: 180,
    orbitPitchDeg: 18,
    orbitZoomScale: 1,
    smoothedDistanceM: null,
    smoothedAnchor: null,
    previousAnchor: null,
    smoothOrbitYawDeg: 180,
    smoothOrbitPitchDeg: 18,
    smoothedDirection: { east: 0, north: 1 },
    lastHeadingDeg: null,
    smoothHeadingDeg: null,
    smoothedPitchDeg: 0,
    smoothedFovRad: defaultFov,
    smoothedOnboardPosition: null,
    smoothedOnboardDirection: null,
    smoothedOnboardUp: null,
    smoothedOnboardQuaternion: null,
    lastUpdateMs: performance.now(),
    dragging: false,
    pointerId: null,
    pointerX: 0,
    pointerY: 0,
  };

  screenController.inertiaSpin = 0.88;
  screenController.inertiaTranslate = 0.9;
  screenController.inertiaZoom = 0.82;
  screenController.maximumMovementRatio = 0.14;
  screenController.minimumZoomDistance = 10;
  screenController.maximumZoomDistance = 30_000_000;

  const applyPreset = mode => {
    if (mode === ADVANCED_CAMERA_MODE.SIDE) {
      state.orbitYawDeg = 90;
      state.orbitPitchDeg = 12;
    } else if (mode === ADVANCED_CAMERA_MODE.TACTICAL) {
      state.orbitYawDeg = 90;
      state.orbitPitchDeg = 24;
    } else if (mode === ADVANCED_CAMERA_MODE.THIRD_PERSON) {
      state.orbitYawDeg = 180;
      state.orbitPitchDeg = 14;
    } else {
      state.orbitYawDeg = 180;
      state.orbitPitchDeg = 18;
    }
    state.orbitZoomScale = 1;
    state.previousAnchor = null;
    state.lastHeadingDeg = null;
    state.smoothHeadingDeg = null;
    state.smoothedOnboardPosition = null;
    state.smoothedOnboardDirection = null;
    state.smoothedOnboardUp = null;
    state.smoothedOnboardQuaternion = null;
  };

  let fpvTransition = null;
  const beginFpvTransition = (durationSec = 1.5) => {
    fpvTransition = { started: performance.now(), duration: durationSec * 1000,
      position: Cartesian3.clone(viewer.camera.positionWC),
      direction: Cartesian3.clone(viewer.camera.directionWC), up: Cartesian3.clone(viewer.camera.upWC) };
  };
  const setMode = (mode, resetView = true) => {
    if (mode !== ADVANCED_CAMERA_MODE.FPV) fpvTransition = null;
    state.mode = mode;
    screenController.enableInputs = mode === ADVANCED_CAMERA_MODE.FREE;
    if (mode === ADVANCED_CAMERA_MODE.FREE && Number.isFinite(defaultFov)
      && Number.isFinite(viewer.camera.frustum?.fov)) {
      viewer.camera.frustum.fov = defaultFov;
      state.smoothedFovRad = defaultFov;
    }
    if (resetView && mode !== ADVANCED_CAMERA_MODE.FREE) applyPreset(mode);
  };

  const resetView = () => {
    if (state.mode !== ADVANCED_CAMERA_MODE.FREE) applyPreset(state.mode);
  };

  const pointerDown = event => {
    if (state.mode === ADVANCED_CAMERA_MODE.FREE
      || [ADVANCED_CAMERA_MODE.THIRD_PERSON, ADVANCED_CAMERA_MODE.FIRST_PERSON,
        ADVANCED_CAMERA_MODE.FPV].includes(state.mode)
      || event.button !== 0) return;
    state.dragging = true;
    state.pointerId = event.pointerId;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };
  const pointerMove = event => {
    if (!state.dragging || event.pointerId !== state.pointerId) return;
    const deltaX = event.clientX - state.pointerX;
    const deltaY = event.clientY - state.pointerY;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    state.orbitYawDeg = (state.orbitYawDeg - deltaX * 0.22) % 360;
    state.orbitPitchDeg = clamp(state.orbitPitchDeg + deltaY * 0.18, -72, 82);
    event.preventDefault();
    event.stopPropagation();
  };
  const pointerUp = event => {
    if (event.pointerId !== state.pointerId) return;
    state.dragging = false;
    state.pointerId = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  const wheel = event => {
    if (state.mode === ADVANCED_CAMERA_MODE.FREE
      || [ADVANCED_CAMERA_MODE.THIRD_PERSON, ADVANCED_CAMERA_MODE.FIRST_PERSON,
        ADVANCED_CAMERA_MODE.FPV].includes(state.mode)) return;
    state.orbitZoomScale = clamp(
      state.orbitZoomScale * Math.exp(clamp(event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 600 : 1), -240, 240) * 0.0018),
      0.08,
      50,
    );
    event.preventDefault();
    event.stopPropagation();
  };

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);
  canvas.addEventListener('wheel', wheel, { passive: false });

  const update = ({ selectedPosition, targetPosition = null, contactPosition = null, headingDeg = 0, pitchDeg = 0,
    rollDeg = 0, selectedAltitudeM = 0, firstPersonOffsetM = 0.65,
    cameraConfig = null, bodyQuaternion = null,
    timestampMs = performance.now() }) => {
    if (state.mode === ADVANCED_CAMERA_MODE.FREE || !selectedPosition) {
      state.lastUpdateMs = timestampMs;
      return;
    }
    const deltaSec = clamp((timestampMs - state.lastUpdateMs) / 1000, 0, 0.1);
    state.lastUpdateMs = timestampMs;
    const desiredFovRad = state.mode === ADVANCED_CAMERA_MODE.FPV
      ? CesiumMath.toRadians(cameraConfig?.fpvFovDeg ?? 140)
      : state.mode === ADVANCED_CAMERA_MODE.FIRST_PERSON
        ? CesiumMath.toRadians(cameraConfig?.firstPersonFovDeg ?? 68)
        : state.mode === ADVANCED_CAMERA_MODE.THIRD_PERSON
          ? CesiumMath.toRadians(cameraConfig?.thirdPersonFovDeg ?? 58)
          : defaultFov ?? CesiumMath.toRadians(60);
    state.smoothedFovRad = Number.isFinite(state.smoothedFovRad)
      ? state.smoothedFovRad + (desiredFovRad - state.smoothedFovRad)
        * dampingAlpha(deltaSec, cameraConfig?.fovDampingSec ?? 0.14)
      : desiredFovRad;
    if (Number.isFinite(viewer.camera.frustum?.fov)) {
      viewer.camera.frustum.fov = state.smoothedFovRad;
    }
    if (state.mode === ADVANCED_CAMERA_MODE.FIRST_PERSON
      || state.mode === ADVANCED_CAMERA_MODE.FPV) {
      const desiredQuaternion = bodyToWorldQuaternion(selectedPosition,
        bodyQuaternion ?? visualBodyQuaternion({ headingDeg, pitchDeg, rollDeg }));
      const bodyMatrix = Matrix3.fromQuaternion(desiredQuaternion, new Matrix3());
      const forward = Matrix3.getColumn(bodyMatrix, 0, new Cartesian3());
      const bodyUp = Matrix3.getColumn(bodyMatrix, 2, new Cartesian3());
      const desiredCameraPosition = keepAboveGlobe(Cartesian3.add(selectedPosition,
        Cartesian3.add(Cartesian3.multiplyByScalar(forward, firstPersonOffsetM, new Cartesian3()),
          Cartesian3.multiplyByScalar(bodyUp, cameraConfig?.firstPersonUpOffsetM ?? 0.16,
            new Cartesian3()), new Cartesian3()), new Cartesian3()), 1.2);
      const fpvCamera = state.mode === ADVANCED_CAMERA_MODE.FPV;
      const rotationTimeConstantSec = fpvCamera
        ? cameraConfig?.fpvRotationDampingSec ?? 0.085
        : cameraConfig?.firstPersonRotationDampingSec ?? 0.035;
      state.smoothedOnboardQuaternion = state.smoothedOnboardQuaternion
        ? Quaternion.slerp(state.smoothedOnboardQuaternion, desiredQuaternion,
          dampingAlpha(deltaSec, rotationTimeConstantSec), state.smoothedOnboardQuaternion)
        : Quaternion.clone(desiredQuaternion);
      const cameraMatrix = Matrix3.fromQuaternion(state.smoothedOnboardQuaternion, new Matrix3());
      let destination = desiredCameraPosition;
      let direction = Matrix3.getColumn(cameraMatrix, 0, new Cartesian3());
      let up = Matrix3.getColumn(cameraMatrix, 2, new Cartesian3());
      if (fpvTransition) {
        const progress = clamp((timestampMs - fpvTransition.started) / fpvTransition.duration, 0, 1);
        const alpha = progress * progress * (3 - 2 * progress);
        destination = Cartesian3.lerp(fpvTransition.position, destination, alpha, new Cartesian3());
        // Rotate the camera basis with a quaternion; opposite view directions
        // cannot produce a zero-length interpolated direction.
        const basis = (forward, vertical) => {
          const right = Cartesian3.normalize(Cartesian3.cross(forward, vertical, new Cartesian3()), new Cartesian3());
          const correctedUp = Cartesian3.cross(right, forward, new Cartesian3());
          const matrix = Matrix3.clone(Matrix3.IDENTITY);
          Matrix3.setColumn(matrix, 0, right, matrix);
          Matrix3.setColumn(matrix, 1, correctedUp, matrix);
          Matrix3.setColumn(matrix, 2, Cartesian3.negate(forward, new Cartesian3()), matrix);
          return Quaternion.fromRotationMatrix(matrix);
        };
        const rotation = Matrix3.fromQuaternion(Quaternion.slerp(basis(fpvTransition.direction, fpvTransition.up),
          basis(direction, up), alpha, new Quaternion()));
        direction = Cartesian3.negate(Matrix3.getColumn(rotation, 2, new Cartesian3()), new Cartesian3());
        up = Matrix3.getColumn(rotation, 1, new Cartesian3());
        if (progress === 1) fpvTransition = null;
      }
      viewer.camera.setView({
        // Mount follows the shared visual position exactly; no second position
        // lag behind the model. Only the cosmetic rotation has extra damping.
        destination,
        orientation: {
          direction,
          up,
        },
      });
      return;
    }
    const desiredAnchor = contactPosition ?? (state.mode === ADVANCED_CAMERA_MODE.TACTICAL && targetPosition
      ? Cartesian3.midpoint(selectedPosition, targetPosition, new Cartesian3())
      : selectedPosition);
    if (!state.smoothedAnchor) state.smoothedAnchor = Cartesian3.clone(desiredAnchor);
    else {
      if (state.previousAnchor && !contactPosition) Cartesian3.add(state.smoothedAnchor,
        Cartesian3.subtract(desiredAnchor, state.previousAnchor, new Cartesian3()), state.smoothedAnchor);
      Cartesian3.lerp(
      state.smoothedAnchor,
      desiredAnchor,
      dampingAlpha(deltaSec, contactPosition ? .22 : cameraConfig?.positionDampingSec ?? 0.055),
      state.smoothedAnchor,
    );
    }
    state.previousAnchor = Cartesian3.clone(desiredAnchor, state.previousAnchor);

    // FOLLOW is a stabilized world-up chase: it may learn the flight path,
    // but must not reproduce the missile body's turn in the same frame.
    const chaseDampingSec = state.mode === ADVANCED_CAMERA_MODE.FOLLOW
      ? Math.max(2.2, cameraConfig?.rotationDampingSec ?? 0)
      : cameraConfig?.rotationDampingSec ?? 0.55;
    const lastHeading = state.lastHeadingDeg ?? headingDeg;
    const continuousHeading = lastHeading + ((headingDeg - lastHeading + 540) % 360 + 360) % 360 - 180;
    state.smoothHeadingDeg = state.smoothHeadingDeg == null ? headingDeg
      : dampMovingGoal(state.smoothHeadingDeg, lastHeading, continuousHeading, deltaSec,
        chaseDampingSec);
    state.lastHeadingDeg = continuousHeading;
    const headingRad = CesiumMath.toRadians(state.smoothHeadingDeg);
    const directionAlpha = dampingAlpha(deltaSec, chaseDampingSec);
    state.smoothedDirection.east = Math.sin(headingRad);
    state.smoothedDirection.north = Math.cos(headingRad);
    state.smoothedPitchDeg += (pitchDeg - state.smoothedPitchDeg) * directionAlpha;
    const smoothedHeadingDeg = Math.atan2(
      state.smoothedDirection.east,
      state.smoothedDirection.north,
    ) * 180 / Math.PI;

    const separationM = targetPosition ? Cartesian3.distance(selectedPosition, targetPosition) : 0;
    let baseDistanceM;
    if (state.mode === ADVANCED_CAMERA_MODE.TACTICAL && targetPosition) {
      baseDistanceM = clamp(separationM * 0.92 + 1_800, 3_000, 205_000);
    } else if (state.mode === ADVANCED_CAMERA_MODE.SIDE) {
      baseDistanceM = cameraConfig?.sideDistanceM ?? 55;
    } else if (state.mode === ADVANCED_CAMERA_MODE.THIRD_PERSON) {
      baseDistanceM = clamp(
        (cameraConfig?.followDistanceM ?? 16) + selectedAltitudeM * 0.001,
        12,
        55,
      );
    } else {
      baseDistanceM = cameraConfig?.followDistanceM ?? 70;
    }
    const minimumDistanceM = state.mode === ADVANCED_CAMERA_MODE.THIRD_PERSON ? 5 : 10;
    const desiredDistanceM = clamp(
      Math.max(baseDistanceM * state.orbitZoomScale, contactPosition ? 130 : 0),
      minimumDistanceM,
      900_000,
    );
    if (state.smoothedDistanceM == null) state.smoothedDistanceM = desiredDistanceM;
    else state.smoothedDistanceM += (desiredDistanceM - state.smoothedDistanceM)
      * dampingAlpha(deltaSec, 0.16);

    const orbitAlpha = dampingAlpha(deltaSec, 0.32);
    const yawDelta = ((state.orbitYawDeg - state.smoothOrbitYawDeg + 540) % 360 + 360) % 360 - 180;
    state.smoothOrbitYawDeg += yawDelta * orbitAlpha;
    state.smoothOrbitPitchDeg += (state.orbitPitchDeg - state.smoothOrbitPitchDeg) * orbitAlpha;
    const azimuthRad = CesiumMath.toRadians(smoothedHeadingDeg + state.smoothOrbitYawDeg);
    const elevationRad = CesiumMath.toRadians(state.smoothOrbitPitchDeg);
    const horizontalDistanceM = state.smoothedDistanceM * Math.cos(elevationRad);
    const configuredThirdHeightAdjustmentM = state.mode === ADVANCED_CAMERA_MODE.THIRD_PERSON
      ? (cameraConfig?.followHeightM ?? 4.4)
        - Math.sin(CesiumMath.toRadians(14)) * (cameraConfig?.followDistanceM ?? 18)
      : 0;
    const desiredCameraPosition = localOffsetToWorld(
      state.smoothedAnchor,
      Math.sin(azimuthRad) * horizontalDistanceM,
      Math.cos(azimuthRad) * horizontalDistanceM,
      Math.sin(elevationRad) * state.smoothedDistanceM + configuredThirdHeightAdjustmentM,
    );
    const closeFollow = state.mode === ADVANCED_CAMERA_MODE.THIRD_PERSON;
    const safeCameraPosition = keepAboveGlobe(desiredCameraPosition, closeFollow ? 1.5 : 35);
    const lookAheadM = closeFollow ? clamp(cameraConfig?.lookAheadM ?? 0, 0, 45) : 0;
    const lookPitchRad = CesiumMath.toRadians(state.smoothedPitchDeg);
    const lookAt = localOffsetToWorld(
      state.smoothedAnchor,
      state.smoothedDirection.east * Math.cos(lookPitchRad) * lookAheadM,
      state.smoothedDirection.north * Math.cos(lookPitchRad) * lookAheadM,
      Math.sin(lookPitchRad) * lookAheadM,
    );
    const frame = getCameraFrame(lookAt, safeCameraPosition);
    viewer.camera.setView({
      destination: safeCameraPosition,
      orientation: { direction: frame.direction, up: frame.up },
    });
  };

  const destroy = () => {
    canvas.removeEventListener('pointerdown', pointerDown);
    canvas.removeEventListener('pointermove', pointerMove);
    canvas.removeEventListener('pointerup', pointerUp);
    canvas.removeEventListener('pointercancel', pointerUp);
    canvas.removeEventListener('wheel', wheel);
    screenController.enableInputs = true;
  };

  return { setMode, resetView, update, destroy, beginFpvTransition };
}
