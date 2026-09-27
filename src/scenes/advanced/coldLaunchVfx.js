import { Cartesian3, CallbackProperty, CallbackPositionProperty, Color, Matrix3 } from 'cesium';
import { bodyToWorldQuaternion, getVisualExhaustPosition } from './modelOrientation.js';

const clamp = value => Math.max(0, Math.min(1, value));
// Gameplay abstraction only: a short lateral impulse at the forward body,
// expressed in the same buffered body frame as the model, not real hardware.
export function createColdLaunchVfx(viewer, textures, { getVisualMode, getPose, onIgnition }) {
  const active = new Map();
  const transient = [];
  const thermal = () => getVisualMode() === 'THERMAL';
  const removeEntities = entities => entities.forEach(entity => {
    entity.show = false;
    viewer.entities.remove(entity);
  });
  const gas = (missile, now) => {
    const launch = missile.launchWorldPosition;
    if (!launch) return;
    const center = Cartesian3.fromDegrees(launch.lng, launch.lat, launch.altitudeM ?? 3.5);
    const up = Cartesian3.normalize(center, new Cartesian3());
    const side = Cartesian3.normalize(Cartesian3.cross(up, Cartesian3.UNIT_X, new Cartesian3()), new Cartesian3());
    const across = Cartesian3.cross(up, side, new Cartesian3());
    const age = () => Math.max(0, (performance.now() - now) / 1000);
    const entities = Array.from({ length: 9 }, (_, i) => {
      const angle = i * 2.399963;
      return viewer.entities.add({
        position: new CallbackPositionProperty((_t, result) => {
          const t = age(), offset = Cartesian3.multiplyByScalar(side, Math.cos(angle) * t * 2.5, new Cartesian3());
          Cartesian3.add(offset, Cartesian3.multiplyByScalar(across, Math.sin(angle) * t * 2.5, new Cartesian3()), offset);
          Cartesian3.add(offset, Cartesian3.multiplyByScalar(up, t * 1.2, new Cartesian3()), offset);
          return Cartesian3.add(center, offset, result ?? new Cartesian3());
        }, false),
        billboard: { image: [textures.smoke, textures.smoke2, textures.smoke3][i % 3],
          width: 3 + i % 3, height: 3 + i % 3, sizeInMeters: true, rotation: angle,
          scale: new CallbackProperty(() => 1 + age() * 1.8, false),
          color: new CallbackProperty(() => {
            const heat = .28 + .3 * Math.exp(-age() * 3);
            return (thermal() ? new Color(heat, heat, heat) : new Color(.72, .73, .72))
              .withAlpha(.22 * Math.pow(clamp(1 - age() / 2.2), 1.3));
          }, false), disableDepthTestDistance: 0 },
      });
    });
    transient.push({ entities, expiresAt: now + 2200 });
  };
  return {
    update(key, missile, visual, presentation) {
      if (!missile.coldLaunchPhase || !visual?.worldPosition) return;
      const data = visual.kinematics ?? missile;
      const phase = data.coldLaunchPhase ?? missile.coldLaunchPhase;
      const now = performance.now();
      let entry = active.get(key);
      if (!entry) {
        if (!['EJECT', 'ORIENT', 'IGNITION'].includes(phase) || active.size >= 16) return;
        entry = { phase, jets: [], ignitionAt: null, visual };
        active.set(key, entry);
        if (phase === 'EJECT') gas(missile, now);
      }
      if (['IGNITION', 'BOOST'].includes(phase) && ['EJECT', 'ORIENT'].includes(entry.phase)) {
        entry.ignitionAt = now;
        onIgnition(getVisualExhaustPosition(visual, visual.worldPosition, presentation), now);
      }
      entry.phase = phase;
      entry.visual = visual;
      const intensity = data.attitudeJetsIntensity ?? 0;
      if (intensity > .002 && !entry.jets.length) {
        entry.jets = Array.from({ length: 8 }, (_, i) => viewer.entities.add({
          position: new CallbackPositionProperty((_time, result) => {
            const pose = getPose(key) ?? entry.visual;
            const rotation = Matrix3.fromQuaternion(bodyToWorldQuaternion(pose.worldPosition, pose.quaternion), new Matrix3());
            return Cartesian3.add(pose.worldPosition, Matrix3.multiplyByVector(rotation,
              new Cartesian3(entry.forwardOffset ?? 0, 0, (entry.jetSign ?? 1) * i * (entry.jetSpacing ?? 0)),
              new Cartesian3()), result ?? new Cartesian3());
          }, false),
          billboard: { image: textures.flash, sizeInMeters: true, width: 1, height: 1,
            disableDepthTestDistance: 0 },
        }));
      }
      const length = (presentation.physicalLengthMeters ?? 2.9) * (presentation.baseVisualScale ?? 1);
      const pulse = .55 + .45 * Math.pow(Math.sin((data.flightTime ?? 0) * 26), 2);
      entry.forwardOffset = length * .3;
      entry.jetSign = -Math.sign(data.attitudeCorrectionDeg || -1);
      entry.jetSpacing = .08 * (.3 + intensity) * pulse;
      entry.jets.forEach((entity, i) => {
        entity.show = intensity > .002;
        entity.billboard.scale = (.25 + .33 * intensity) * (1 - i / 10) * pulse;
        entity.billboard.color = (thermal() || i < 2 ? Color.WHITE : new Color(1, .75, .43))
          .withAlpha(clamp(intensity * 2) * (1 - i / 9) * pulse);
      });
      if (intensity <= .002 && entry.jets.length) {
        removeEntities(entry.jets); entry.jets = [];
      }
      const ignitionAge = entry.ignitionAt == null ? Infinity : (now - entry.ignitionAt) / 1000;
      if (ignitionAge < .3) {
        entry.flash ??= viewer.entities.add({ position: new CallbackPositionProperty(() => {
          const pose = getPose(key) ?? entry.visual;
          return getVisualExhaustPosition(pose, pose.worldPosition, presentation);
        }, false),
          billboard: { image: textures.flash, sizeInMeters: true, width: 1, height: 1,
            disableDepthTestDistance: 0 } });
        entry.flash.billboard.scale = 2 + 7 * (1 - Math.exp(-ignitionAge * 24));
        entry.flash.billboard.color = (thermal() ? Color.WHITE : new Color(1, .85, .59))
          .withAlpha(.95 * Math.exp(-ignitionAge * 12));
      } else if (entry.flash) { removeEntities([entry.flash]); entry.flash = null; }
    },
    remove(key) {
      const entry = active.get(key);
      if (!entry) return;
      removeEntities([...entry.jets, ...(entry.flash ? [entry.flash] : [])]);
      active.delete(key);
    },
    prune(now) {
      for (let i = transient.length - 1; i >= 0; i--) {
        if (now < transient[i].expiresAt) continue;
        removeEntities(transient[i].entities); transient.splice(i, 1);
      }
    },
    destroy() {
      for (const key of active.keys()) this.remove(key);
      transient.forEach(item => removeEntities(item.entities)); transient.length = 0;
    },
  };
}
