import { Cartesian3, Matrix4, Transforms, CallbackPositionProperty, CallbackProperty,
  Color, ColorMaterialProperty } from 'cesium';

export const IMPACT_VFX_LIFETIME_MS = 8000;
export const IMPACT_FRAGMENT_COUNT = 64;
const clamp = x => Math.max(0, Math.min(1, x));
export function impactEnvelope(ageMs) {
  const t = Math.max(0, ageMs) / 1000;
  return { flash: Math.exp(-t / .105), heat: Math.exp(-t / 1.35),
    smoke: clamp(t / .28) * (1 - clamp(t / 8)) ** 1.2,
    radiusM: 8 + 72 * (1 - Math.exp(-t / 2.0)) };
}
// Deterministic cosmetic particles in local ENU, never engine entities.
export function fragmentOffset(index, ageMs) {
  const t = Math.max(0, ageMs) / 1000;
  const angle = index * 2.39996323;
  const speed = 28 + (index % 11) * 12;
  const travel = speed * .9 * (1 - Math.exp(-t / .8));
  return new Cartesian3(Math.cos(angle) * travel, Math.sin(angle) * travel,
    (index % 5 - 1.6) * travel * .32 - 4.4 * t * t);
}

export function createImpactVfx(viewer, position, textures, isThermal, now = () => performance.now()) {
  const startedAt = now(), frame = Transforms.eastNorthUpToFixedFrame(position);
  const age = () => now() - startedAt;
  const envelope = () => impactEnvelope(age());
  const dynamic = fn => new CallbackProperty(fn, false);
  const world = local => Matrix4.multiplyByPoint(frame, local, new Cartesian3());
  const entities = [];
  const cloud = (image, diameter, tint, opacity, offset) => entities.push(viewer.entities.add({
    position: offset ? new CallbackPositionProperty(() => world(offset()), false) : position,
    billboard: { image, sizeInMeters: true, width: 64, height: 64, scale: dynamic(() => diameter() / 64),
      rotation: entities.length * 2.399,
      color: dynamic(() => tint().withAlpha(opacity())), disableDepthTestDistance: 0 },
  }));
  cloud(textures.flash, () => 22 + envelope().flash * 130, () => Color.WHITE,
    () => envelope().flash, null);
  cloud(textures.flash, () => 42 + envelope().flash * 210,
    () => isThermal() ? Color.WHITE : new Color(1, .63, .29),
    () => envelope().flash * .42, null);
  // Overlapping lobes, with lift and lateral drift; no fixed screen-space blob.
  for (let i = 0; i < 18; i++) {
    const angle = i * 2.4;
    cloud([textures.smoke, textures.smoke2 ?? textures.smoke, textures.smoke3 ?? textures.smoke][i % 3], () => envelope().radiusM * (1.15 + (i % 4) * .12),
      () => isThermal()
        ? new Color(.25 + envelope().heat * .75, .25 + envelope().heat * .75,
          .25 + envelope().heat * .75)
        : new Color(.22 + envelope().heat * .14, .24 + envelope().heat * .1,
          .25 + envelope().heat * .06),
      () => envelope().smoke * (isThermal() ? .22 + envelope().heat * .7 : .3 + envelope().heat * .17),
      () => new Cartesian3(Math.cos(angle) * envelope().radiusM * (.23 + (i % 3) * .04)
          + age() * .001,
        Math.sin(angle) * envelope().radiusM * (.22 + (i % 2) * .05),
        age() * .002 + (i % 3) * 1.5));
  }
  cloud(textures.fire, () => 14 + envelope().radiusM * 1.9,
    () => isThermal() ? Color.WHITE : new Color(1, .58, .22),
    () => envelope().heat * .95, () => new Cartesian3(0, 0, age() * .001));
  for (let i = 0; i < 12; i++) {
    const angle = i * 2.4;
    cloud(textures.fire, () => 4 + envelope().radiusM * (.4 + (i % 3) * .12),
      () => isThermal() ? Color.WHITE : new Color(1, .42 + (i % 2) * .14, .12),
      () => envelope().heat * .55,
      () => new Cartesian3(Math.cos(angle) * envelope().radiusM * .18,
        Math.sin(angle) * envelope().radiusM * .18, age() * .0015));
  }
  for (let i = 0; i < IMPACT_FRAGMENT_COUNT; i++) {
    const lifetime = 1600 + (i % 9) * 360;
    cloud(textures.flash, () => .45 + (i % 7) * .23,
      () => isThermal() ? Color.WHITE : new Color(1, .72, .37),
      () => (1 - clamp(age() / lifetime)) ** .6,
      () => fragmentOffset(i, Math.min(age(), lifetime)));
    // A short world-space streak follows the same deterministic fragment path.
    const entity = entities.at(-1);
    entity.polyline = { positions: dynamic(() => {
      const current = Math.min(age(), lifetime);
      return [world(fragmentOffset(i, Math.max(0, current - 95))),
        world(fragmentOffset(i, current))];
    }), width: 1.4, material: new ColorMaterialProperty(
      dynamic(() => (isThermal() ? Color.WHITE : new Color(1, .68, .32))
        .withAlpha((1 - clamp(age() / lifetime)) * .72)),
    ) };
  }
  return { entities, expiresAt: startedAt + IMPACT_VFX_LIFETIME_MS };
}
