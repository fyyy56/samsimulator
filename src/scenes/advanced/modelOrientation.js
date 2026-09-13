import { CallbackPositionProperty, CallbackProperty, Cartesian3, HeadingPitchRoll, Math as CesiumMath, Matrix3, Matrix4, Quaternion, Transforms } from 'cesium';
import { visualBodyQuaternion } from './visualInterpolation.js';

export const bodyToWorldQuaternion = (position, body) => Quaternion.multiply(
  Quaternion.fromRotationMatrix(Matrix4.getMatrix3(Transforms.eastNorthUpToFixedFrame(position),
    new Matrix3()), new Quaternion()), body, new Quaternion());

// Visual corrections only. The flight state is never rotated to fit an asset.
export const createOrientation = (position, kinematics, presentation, visualQuaternion) => {
  const bodyOrientation = bodyToWorldQuaternion(position,
    visualQuaternion ?? visualBodyQuaternion(kinematics));
  const meshAxes = Quaternion.fromHeadingPitchRoll(new HeadingPitchRoll(
    CesiumMath.toRadians((presentation.yawOffsetDeg ?? 0) + 90),
    CesiumMath.toRadians(presentation.pitchOffsetDeg ?? 0),
    CesiumMath.toRadians(presentation.rollOffsetDeg ?? 0),
  ), new Quaternion());
  Quaternion.multiply(bodyOrientation, meshAxes, bodyOrientation);
  const correction = presentation.modelQuaternionOffset;
  if (!correction) return bodyOrientation;
  const axis = correction.axis === 'X' ? Cartesian3.UNIT_X
    : correction.axis === 'Y' ? Cartesian3.UNIT_Y : Cartesian3.UNIT_Z;
  return Quaternion.multiply(bodyOrientation, Quaternion.fromAxisAngle(axis,
    CesiumMath.toRadians(correction.angleDeg), new Quaternion()), new Quaternion());
};

// Readable during Cesium's clock/data-source phase, before scene.preRender.
// readVisual is shared with the camera, not a second interpolation path.
export const createVisualPoseProperties = (readVisual, presentation) => ({
  position: new CallbackPositionProperty((_time, result) => Cartesian3.clone(
    readVisual().worldPosition, result), false),
  orientation: new CallbackProperty((_time, result) => {
    const visual = readVisual();
    return Quaternion.clone(createOrientation(visual.worldPosition,
      visual.kinematics, presentation, visual.quaternion), result);
  }, false),
});

// Anchors are in Cesium model coordinates after the GLB root/axis conversion.
// Apply the same model correction as the mesh, never raw simulation heading.
export const getVisualModelAnchorPosition = (visual, presentation, anchor) => {
  const scale = presentation.baseVisualScale ?? 1;
  const rotation = Matrix3.fromQuaternion(createOrientation(visual.worldPosition,
    visual.kinematics, presentation, visual.quaternion), new Matrix3());
  const offset = Matrix3.multiplyByVector(rotation,
    new Cartesian3(anchor.x * scale, anchor.y * scale, anchor.z * scale), new Cartesian3());
  return Cartesian3.add(visual.worldPosition, offset, new Cartesian3());
};

export const getVisualExhaustPosition = (visual, entityPosition, presentation) => {
  if (presentation.exhaustAnchorModelM) {
    return getVisualModelAnchorPosition({ ...visual, worldPosition: entityPosition },
      presentation, presentation.exhaustAnchorModelM);
  }
  const offsetMeters = presentation.exhaustOffsetMeters ?? 0;
  if (offsetMeters <= 0) return entityPosition;
  const rotation = Matrix3.fromQuaternion(bodyToWorldQuaternion(entityPosition,
    visual.quaternion), new Matrix3());
  const offset = Matrix3.multiplyByVector(rotation,
    new Cartesian3(-offsetMeters, 0, 0), new Cartesian3());
  return Cartesian3.add(entityPosition, offset, new Cartesian3());
};

// The missing IRIS-T GLB uses a world-sized image. Its right-facing nose is
// aligned to the projected visual body axis, not to a map heading on screen.
export const createWorldMissileBillboard = (readVisual, presentation, camera) => {
  const dimensions = presentation.billboardDimensionsM;
  if (!dimensions) return {};
  // Cesium packs billboard dimensions as integers, even in metre mode.
  // Keep source dimensions integral and apply one uniform scalar; a height
  // below one metre would otherwise be truncated to zero in its shader.
  const image = presentation.billboardImageSize;
  let lastRotation = 0;
  return {
    width: image.width,
    height: image.height,
    scale: dimensions.width * presentation.baseVisualScale / image.width,
    sizeInMeters: true,
    scaleByDistance: undefined,
    rotation: new CallbackProperty(() => {
      const pose = readVisual();
      const forward = Matrix3.multiplyByVector(Matrix3.fromQuaternion(bodyToWorldQuaternion(
        pose.worldPosition, pose.quaternion), new Matrix3()), Cartesian3.UNIT_X,
      new Cartesian3());
      const x = Cartesian3.dot(forward, camera.rightWC);
      const y = Cartesian3.dot(forward, camera.upWC);
      // A head-on sprite has no projected longitudinal direction.
      if (Math.hypot(x, y) > 1e-4) lastRotation = Math.atan2(y, x);
      return lastRotation;
    }, false),
  };
};
