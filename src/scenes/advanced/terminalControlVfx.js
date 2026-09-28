import { Cartesian3, Color, Matrix3, Matrix4, Transforms } from 'cesium';
import { bodyToWorldQuaternion } from './modelOrientation.js';
import { createMiniControlJet } from './miniControlJet.js';

// Visual scales only, not hardware port locations. No main-plume identities.
const PROFILES = Object.freeze({
  PIF_PAF: { forwardFraction: 0.16, radiusM: 0.12, lengthM: 0.65, sizeM: 0.4 },
  ACM_ATTITUDE: { forwardFraction: 0.32, radiusM: 0.16, lengthM: 0.38, sizeM: 0.34 },
});

export function getTerminalJetCommand(kinematics) {
  const state = kinematics?.controlActuators;
  if (!state || kinematics.guidanceEnabled === false) return null;
  if (state.kind === 'PIF_PAF') {
    if (!state.pifActive) return null;
    return { kind: state.kind, direction: state.pifAccelerationVectorMps2,
      intensity: state.pifIntensity };
  }
  const event = state.acmPulse;
  if (state.kind !== 'ACM_ATTITUDE' || !event) return null;
  const age = (kinematics.flightTime ?? Infinity) - event.flightTimeSec;
  if (age < 0 || age >= event.durationSec) return null;
  return { kind: state.kind, eventId: event.id, direction: event.direction,
    intensity: event.intensity * Math.pow(1 - age / event.durationSec, 0.6) };
}

export function getTerminalJetFrame(visual, presentation, command) {
  const profile = PROFILES[command.kind];
  const rotation = Matrix3.fromQuaternion(bodyToWorldQuaternion(
    visual.worldPosition, visual.quaternion), new Matrix3());
  const forward = Matrix3.multiplyByVector(rotation, Cartesian3.UNIT_X, new Cartesian3());
  const force = Matrix4.multiplyByPointAsVector(Transforms.eastNorthUpToFixedFrame(visual.worldPosition),
    new Cartesian3(command.direction.eastMps, command.direction.northMps,
      command.direction.upMps), new Cartesian3());
  // Radial exhaust opposite the force at mid-body / ahead of centre of mass.
  const radial = Cartesian3.subtract(force, Cartesian3.multiplyByScalar(forward,
    Cartesian3.dot(force, forward), new Cartesian3()), new Cartesian3());
  const magnitude = Cartesian3.magnitude(radial);
  const exhaust = magnitude > 1e-9 ? Cartesian3.multiplyByScalar(radial, -1 / magnitude, radial)
    : Matrix3.multiplyByVector(rotation, Cartesian3.UNIT_Z, radial);
  const visualScale = presentation.baseVisualScale ?? 1;
  const origin = Cartesian3.add(visual.worldPosition, Cartesian3.multiplyByScalar(forward,
    (presentation.physicalLengthMeters ?? 3) * visualScale * profile.forwardFraction,
    new Cartesian3()), new Cartesian3());
  Cartesian3.add(origin, Cartesian3.multiplyByScalar(exhaust,
    profile.radiusM * visualScale, new Cartesian3()), origin);
  return { origin, exhaust, visualScale, profile };
}

export function createTerminalControlVfx(viewer, textures, { getPose, getVisualMode }) {
  const active = new Map();
  const positionLobes = (entry, visual, presentation, command) => {
    if (entry.positionPose === visual && entry.positionPresentation === presentation) return;
    const { origin, exhaust, visualScale, profile } = getTerminalJetFrame(visual, presentation, command);
    const phase = (visual.kinematics.flightTime ?? 0) * 43;
    const pulse = command.kind === 'PIF_PAF' ? 0.85 + 0.15 * Math.sin(phase) ** 2 : 1;
    const intensity = Math.max(0, Math.min(1, command.intensity));
    for (let index = 0; index < entry.positions.length; index++) {
      Cartesian3.add(origin, Cartesian3.multiplyByScalar(exhaust,
        index / 5 * profile.lengthM * visualScale * (0.35 + intensity * 0.65) * pulse,
        entry.offset), entry.positions[index]);
    }
    entry.positionPose = visual;
    entry.positionPresentation = presentation;
  };
  const updateEntry = (entry, visual, presentation) => {
    const command = getTerminalJetCommand(visual?.kinematics);
    if (!command || getVisualMode() === 'THERMAL') {
      entry.jets.forEach(jet => { jet.show = false; });
      return;
    }
    positionLobes(entry, visual, presentation, command);
    const visualScale = presentation.baseVisualScale ?? 1;
    const profile = PROFILES[command.kind];
    const phase = (visual.kinematics.flightTime ?? 0) * 43;
    const pulse = command.kind === 'PIF_PAF' ? 0.85 + 0.15 * Math.sin(phase) ** 2 : 1;
    const intensity = Math.max(0, Math.min(1, command.intensity));
    entry.jets.forEach((jet, index) => {
      jet.show = intensity > 0.002;
      jet.billboard.scale = profile.sizeM * visualScale * (0.4 + intensity * 0.6)
        * (1 - index / 7) * pulse;
      jet.billboard.color = (index < 2 ? Color.WHITE : entry.warm)
        .withAlpha(Math.min(1, intensity * 2) * (1 - index / 6) * pulse, entry.colors[index]);
    });
  };
  return {
    update(key, missile, visual, presentation) {
      const command = getTerminalJetCommand(visual?.kinematics);
      let entry = active.get(key);
      if (!entry && command && active.size < 32 && getVisualMode() !== 'THERMAL') {
        entry = { positions: Array.from({ length: 6 }, () => new Cartesian3()),
          colors: Array.from({ length: 6 }, () => new Color()), offset: new Cartesian3(),
          warm: new Color(1, 0.75, 0.43), visual, presentation };
        entry.jets = createMiniControlJet(viewer, textures.flash, (index, _time, result) => {
          // Cesium may read positions before preRender. Sample the very same
          // buffered pose as the model, caching the six lobe offsets together.
          const pose = getPose(key) ?? entry.visual;
          const currentCommand = getTerminalJetCommand(pose?.kinematics);
          if (currentCommand) positionLobes(entry, pose, entry.presentation, currentCommand);
          return Cartesian3.clone(entry.positions[index], result);
        }, 6);
        active.set(key, entry);
      }
      if (!entry) return;
      entry.visual = getPose(key) ?? visual;
      entry.presentation = presentation;
      if (['MISSED', 'SELF_DESTRUCT', 'INTERCEPTED'].includes(missile.lifecycleState)) {
        entry.jets.forEach(jet => { jet.show = false; });
      } else updateEntry(entry, entry.visual, presentation);
    },
    remove(key) {
      const entry = active.get(key);
      if (!entry) return;
      entry.jets.forEach(jet => { jet.show = false; viewer.entities.remove(jet); });
      active.delete(key);
    },
    destroy() { for (const key of active.keys()) this.remove(key); },
  };
}
