import {
  Cartesian3, Color, ColorBlendMode, Matrix4, Quaternion, Transforms,
} from 'cesium';
import { createOrientation, getVisualModelAnchorPosition } from './modelOrientation.js';

const LIFETIME_SEC = 10;

export function createAsterBoosterDebris(viewer, visual, presentation, simulationTime, id) {
  const position = getVisualModelAnchorPosition(visual, presentation, { x: 0, y: 0, z: 0 });
  const { headingDeg = 0, pitchDeg = 0, speedKmh = 0 } = visual.kinematics;
  const heading = headingDeg * Math.PI / 180;
  const pitch = pitchDeg * Math.PI / 180;
  const speed = speedKmh / 3.6;
  const enu = Transforms.eastNorthUpToFixedFrame(position);
  const velocity = Matrix4.multiplyByPointAsVector(enu, new Cartesian3(
    Math.sin(heading) * Math.cos(pitch) * speed,
    Math.cos(heading) * Math.cos(pitch) * speed,
    Math.sin(pitch) * speed,
  ), new Cartesian3());
  const up = Cartesian3.normalize(position, new Cartesian3());
  const orientation = createOrientation(visual.worldPosition, visual.kinematics,
    presentation, visual.quaternion);
  const entity = viewer.entities.add({
    id: `aster-booster:${id}`,
    position: Cartesian3.clone(position),
    orientation,
    model: {
      uri: presentation.boosterModelUri,
      scale: presentation.baseVisualScale,
      minimumPixelSize: 0,
      maximumScale: presentation.baseVisualScale,
      color: Color.WHITE,
      colorBlendMode: ColorBlendMode.MIX,
      colorBlendAmount: 0.35,
      shadows: 0,
    },
  });
  return { entity, position, velocity, up, orientation,
    createdAt: simulationTime };
}

export function updateAsterBoosterDebris(debris, simulationTime, thermal) {
  const age = Math.max(0, simulationTime - debris.createdAt);
  if (age >= LIFETIME_SEC) return false;
  const travelled = Cartesian3.multiplyByScalar(debris.velocity, age, new Cartesian3());
  const gravity = Cartesian3.multiplyByScalar(debris.up, -0.5 * 9.81 * age * age,
    new Cartesian3());
  const position = Cartesian3.add(debris.position, travelled, new Cartesian3());
  Cartesian3.add(position, gravity, position);
  debris.entity.position = position;
  const tumble = Quaternion.fromAxisAngle(Cartesian3.UNIT_Y, age * 2.4,
    new Quaternion());
  debris.entity.orientation = Quaternion.multiply(debris.orientation, tumble,
    new Quaternion());
  debris.entity.model.color = thermal && age < 5
    ? Color.fromCssColorString(age < 2.5 ? '#fffaf0' : '#dda16c')
    : Color.WHITE;
  return true;
}
