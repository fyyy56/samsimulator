import { Cartesian3, Cartesian4, Color, ColorBlendMode, CustomShader, LightingModel, Matrix4, Model,
  Quaternion, TranslationRotationScale, Transforms, UniformType } from 'cesium';
import cloudModelUrl from '../../assets/environment/clouds/cloud_test.glb?url';
import { ENVIRONMENT_PRESETS } from './environmentSettings.js';

// A fixed world-space field. Weather changes reshape pooled lobes; camera motion
// only changes visibility, never their positions or random seeds.
const CLUSTERS = 36;
const LOBES = 4;
const PROFILES = {
  THIN_SCATTERED: { count: 32, lobes: 2, spacing: 1.0, width: 4200, height: 140, opacity: 1.4 },
  CUMULUS: { count: 36, lobes: 4, spacing: 1.0, width: 2100, height: 1250, opacity: 7 },
  OVERCAST: { count: 12, lobes: 4, spacing: .68, width: 8500, height: 1600, opacity: 10 },
};
function variation(index, salt) {
  const value = Math.sin((index + 1) * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}
function smoothstep(a, b, value) {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function createEnvironmentCloudLod(scene) {
  const slots = Array.from({ length: CLUSTERS * LOBES }, (_, index) => ({
    index, cluster: Math.floor(index / LOBES), lobe: index % LOBES,
    localPosition: new Cartesian3(), position: new Cartesian3(), matrix: new Matrix4(),
    rx: 1, ry: 1, rz: 1, cosine: 1, sine: 0, active: false, fade: 0, baseFade: 1,
    lobeCount: 1,
    model: null, requested: false, color: new Color(), shade: variation(index, 12),
    appearanceAlpha: null, readyAt: null,
  })).sort((a, b) => a.lobe - b.lobe || a.cluster - b.cluster);
  const engines = Array.from({ length: 4 }, () => new Cartesian4());
  const uniforms = {
    u_density: { type: UniformType.FLOAT, value: 1 },
    u_night: { type: UniformType.FLOAT, value: 0 },
    u_ambient: { type: UniformType.FLOAT, value: .70 },
    u_tint: { type: UniformType.VEC3, value: new Cartesian3(1, 1, 1) },
  };
  engines.forEach((engine, i) => { uniforms['u_engine' + i] = { type: UniformType.VEC4, value: engine }; });
  // The GLB contains textured double-sided cloud cards, not solid PBR surfaces.
  // Explicit diffuse scattering avoids back-facing cards going black or changing
  // brightness when Cesium flips their normals. No specular/emissive white fill.
  const material = new CustomShader({ uniforms, lightingModel: LightingModel.UNLIT, fragmentShaderText: `
    float cloudLamp(vec3 positionEC, vec4 engine) {
      vec3 delta = positionEC - (czm_view * vec4(engine.xyz, 1.0)).xyz;
      return engine.w * exp(-dot(delta, delta) / 14400.0);
    }
    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      // Beer-style opacity preserves the texture's feathered edges.
      material.alpha = 1.0 - exp(-material.alpha * u_density);
      float bakedShade = clamp(dot(material.diffuse, vec3(.2126,.7152,.0722)), 0.0, 1.0);
      vec3 albedo = vec3(.50 + .50 * sqrt(bakedShade));
      float height = clamp((fsInput.attributes.positionMC.z + 1.94213) / 5.59144, 0.0, 1.0);
      // The absolute normal/light angle is invariant to which side of a card is
      // facing the camera. Texture shading and height preserve a darker base.
      float sunlight = abs(dot(normalize(fsInput.attributes.normalEC), normalize(czm_lightDirectionEC)));
      vec3 scattering = vec3(u_ambient) + u_tint * (sunlight * mix(.24,.018,u_night)
        + height * mix(.12,.008,u_night));
      material.diffuse = albedo * scattering * mix(.68, 1.0, height);
      float light = cloudLamp(fsInput.attributes.positionEC, u_engine0)
        + cloudLamp(fsInput.attributes.positionEC, u_engine1)
        + cloudLamp(fsInput.attributes.positionEC, u_engine2)
        + cloudLamp(fsInput.attributes.positionEC, u_engine3);
      material.diffuse += vec3(1.0,.61,.28) * min(light, 1.2);
    }
  ` });
  const frame = new Matrix4(), inverse = new Matrix4();
  const surface = new Cartesian3(), cameraLocal = new Cartesian3(), point = new Cartesian3();
  const normalizedOrigin = new Cartesian3(), normalizedPoint = new Cartesian3();
  const trs = new TranslationRotationScale(), localMatrix = new Matrix4();
  const tint = new Cartesian3(1, 1, 1);
  let anchored = false, enabled = false, destroyed = false, layout = '', density = .65, pendingLoads = 0;
  let profile = PROFILES.CUMULUS;

  function configure(settings) {
    profile = PROFILES[settings.cloudType] ?? PROFILES.CUMULUS;
    const thin = settings.cloudType === 'THIN_SCATTERED';
    const overcast = settings.cloudType === 'OVERCAST';
    const spread = profile.spacing * (overcast ? 1.18 - settings.cover * .28 : 1);
    for (const slot of slots) {
      const { cluster, lobe, index } = slot;
      // Interleave distance bands so low cover still samples near, mid and far sky.
      // Cumulus: 8 near, 20 mid, 8 far at full cover, interleaved so lower
      // coverage keeps all three bands. Mid-distance is the principal sky layer.
      const band = [0, 1, 1, 2, 1, 0, 1, 2, 1][cluster % 9];
      const ordinal = Math.floor(cluster / 9) * [2, 5, 2][band]
        + [0, 0, 1, 0, 2, 1, 3, 1, 4][cluster % 9];
      const bandCount = [8, 20, 8][band];
      // Distribute each band around the whole sky independently. Interleaving
      // the insertion order also avoids an empty sector at partial coverage.
      const angle = overcast || thin ? cluster * 2.399963 + .35 * variation(cluster, 1)
        : ((ordinal * [3, 7, 3][band]) % bandCount) * Math.PI * 2 / bandCount
          + [0, .15, .4][band] + (variation(cluster, 1) - .5) * .14;
      const radius = (overcast ? (cluster === 0 ? 2100 : 2800 + Math.sqrt(cluster) * 2600)
        : thin ? 2600 + (cluster % 4) * 10500 + variation(cluster, 2) * 5500
          : [3000, 8000, 19000][band] + variation(cluster, 2) * [2500, 6000, 14000][band]) * spread;
      // Keep LOD tied to the fixed cloud field. Camera rotation must not move
      // transparent GLBs across per-frame distance gates (visible as flicker).
      // Preserve full volume nearby, then use fewer GLB lobes in the distance.
      // Every cluster keeps its main lobe so clouds still reach the horizon.
      slot.lobeCount = overcast ? profile.lobes
        : thin ? (radius < 30000 ? 2 : 1)
          : band < 2 ? 2 : 1;
      const lobeWeight = overcast ? 1 : [1, .88, .72, .56][lobe];
      slot.baseFade = lobeWeight;
      const size = overcast ? .52 + variation(cluster, 3) * .8 + (cluster === 7 ? .7 : 0)
        : thin ? [.38, .7, 1.05, .55, 1.65][cluster % 5] * (.8 + variation(cluster, 3) * .4)
          : (band === 0 ? .65 + variation(cluster, 3) * .3
            : [.7, 1, 1.4, .9, 1.65][cluster % 5] * (.85 + variation(cluster, 3) * .3));
      const tall = settings.cloudType === 'CUMULUS' && cluster % 3 === 1;
      const width = profile.width * size * (.7 + variation(index, 4) * .6)
        * (!thin && !overcast && band === 1 ? 1.2 : 1)
        * (thin && lobe > 0 ? .62 : !overcast && !thin && lobe > 0 ? .68 : 1);
      const depth = width * (thin ? .12 + variation(index, 5) * .12 : .62 + variation(index, 5) * .46);
      const height = profile.height * size * (tall ? 1.5 : .7 + variation(index, 6) * .55);
      // Thin lobes share a prevailing direction and taper into offset wisps.
      const heading = thin ? .55 + variation(cluster, 10) * .55 + lobe * .12
        : variation(index, 10) * Math.PI * 2;
      const lobeAngle = thin ? heading + .16 : lobe * 2.4 + variation(cluster, 8);
      const offset = lobe === 0 ? 0 : profile.width * size * (thin ? .38
        : overcast ? .18 + variation(index, 7) * .17 : .48 + variation(index, 7) * .12);
      const x = Math.sin(angle) * radius + Math.cos(lobeAngle) * offset;
      const y = Math.cos(angle) * radius + Math.sin(lobeAngle) * offset;
      // Altitude is the base of the field; flatter bases for overcast, tall lobes for cumulus.
      const z = settings.altitude + (thin ? 1800 : 0) + height * .42 + (settings.cloudType === 'OVERCAST'
        ? variation(index, 9) * 120 : variation(cluster, 13) * (thin ? 900 : 600) + variation(index, 9) * height * .25);
      Cartesian3.fromElements(x, y, z - (x * x + y * y) / 12740000, slot.localPosition);
      Matrix4.multiplyByPoint(frame, slot.localPosition, slot.position);
      slot.cosine = Math.cos(heading); slot.sine = Math.sin(heading);
      slot.rx = width * .42; slot.ry = depth * .42; slot.rz = height * .42;
      Cartesian3.clone(slot.localPosition, trs.translation);
      Quaternion.fromAxisAngle(Cartesian3.UNIT_Z, heading, trs.rotation);
      // Positive scales preserve winding/normals. Rotations provide safe variation.
      Cartesian3.fromElements(width / 9.97,
        depth / 6.02, height / 5.59, trs.scale);
      Matrix4.fromTranslationRotationScale(trs, localMatrix);
      Matrix4.multiply(frame, localMatrix, slot.matrix);
      if (slot.model) Matrix4.clone(slot.matrix, slot.model.modelMatrix);
    }
  }
  function applyAppearance(slot) {
    if (!slot.model || slot.appearanceAlpha === slot.fade) return;
    const shade = .95 + slot.shade * .05;
    slot.color.red = slot.color.green = slot.color.blue = shade;
    slot.color.alpha = slot.fade;
    slot.model.color = slot.color;
    slot.appearanceAlpha = slot.fade;
  }
  function load(slot) {
    if (slot.requested) return;
    slot.requested = true;
    pendingLoads += 1;
    Model.fromGltfAsync({ url: cloudModelUrl, show: false, allowPicking: false,
      modelMatrix: slot.matrix, shadows: 0, incrementallyLoadTextures: false,
      customShader: material, colorBlendMode: ColorBlendMode.MULTIPLY,
      credit: 'Cloud Test by Andrey Martyanov, CC BY 4.0' }).then(model => {
      if (destroyed) { model.destroy(); return; }
      slot.model = scene.primitives.add(model);
      if (model.ready) slot.readyAt = performance.now();
      else model.readyEvent.addEventListener(() => { slot.readyAt = performance.now(); });
      Matrix4.clone(slot.matrix, model.modelMatrix);
      applyAppearance(slot);
      model.show = enabled && slot.active;
    }).catch(error => { if (!destroyed) console.warn('Cloud GLB unavailable', error); })
      .finally(() => { pendingLoads -= 1; });
  }
  function update(active, settings, camera) {
    enabled = active && settings.cloudType !== 'CLEAR' && settings.cover > 0;
    if (!enabled) {
      slots.forEach(slot => { slot.active = false; if (slot.model) slot.model.show = false; });
      engines.forEach(engine => { engine.w = 0; });
      return;
    }
    if (!anchored) {
      const c = camera.positionCartographic;
      // AdvancedScene starts in an orbital overview. Its camera footprint is
      // far from the subsequent local scene; do not anchor the field there.
      // Once a local view is entered the anchor remains fixed during movement.
      if (c.height > 30000) return;
      Cartesian3.fromRadians(c.longitude, c.latitude, 0, scene.globe.ellipsoid, surface);
      Transforms.eastNorthUpToFixedFrame(surface, scene.globe.ellipsoid, frame);
      Matrix4.inverseTransformation(frame, inverse);
      anchored = true;
    }
    const signature = `${settings.cloudType}:${settings.altitude}:${settings.cloudType === 'OVERCAST' ? settings.cover : ''}`;
    if (signature !== layout) { configure(settings); layout = signature; }
    density = settings.density;
    const night = settings.preset === 'NIGHT';
    const twilight = settings.preset === 'SUNRISE' || settings.preset === 'SUNSET';
    material.setUniform('u_density', profile.opacity * (.25 + density * 1.5));
    material.setUniform('u_night', night ? 1 : 0);
    material.setUniform('u_ambient', night ? .022 : twilight ? .53 : .70);
    Cartesian3.fromArray(ENVIRONMENT_PRESETS[settings.preset].tint, 0, tint);
    material.setUniform('u_tint', tint);
    Matrix4.multiplyByPoint(inverse, camera.positionWC, cameraLocal);
    const count = profile.count * Math.min(1, settings.cover *
      (settings.cloudType === 'THIN_SCATTERED' ? 2 : settings.cloudType === 'CUMULUS' ? 1.65 : 1.1));
    const now = performance.now();
    let loadsRemaining = 1;
    for (const slot of slots) {
      const coverFade = smoothstep(slot.cluster, slot.cluster + 1, count);
      slot.active = coverFade > .001 && slot.lobe < slot.lobeCount && slot.lobe < profile.lobes;
      slot.fade = slot.baseFade * coverFade * (slot.readyAt === null ? 0 : smoothstep(0, 650, now - slot.readyAt));
      if (slot.active && !slot.requested && loadsRemaining > 0 && pendingLoads < 2) {
        load(slot);
        loadsRemaining -= 1;
      }
      if (slot.model) {
        if (slot.model.show !== slot.active) slot.model.show = slot.active;
        applyAppearance(slot);
      }
    }
  }
  function normalized(slot, local, result) {
    const x = local.x - slot.localPosition.x, y = local.y - slot.localPosition.y;
    return Cartesian3.fromElements((x * slot.cosine + y * slot.sine) / slot.rx,
      (-x * slot.sine + y * slot.cosine) / slot.ry,
      (local.z - slot.localPosition.z) / slot.rz, result);
  }
  function estimateDensity(worldPosition) {
    if (!enabled || !anchored) return 0;
    Matrix4.multiplyByPoint(inverse, worldPosition, point);
    let value = 0;
    for (const slot of slots) {
      if (!slot.active || !slot.model) continue;
      const {x,y,z} = normalized(slot, point, normalizedPoint);
      value += Math.max(0, 1 - x*x - y*y - z*z) ** 2 * density * slot.fade;
    }
    return Math.min(1, value);
  }
  // Integrate a smooth ellipsoidal lobe along the camera-to-effect segment.
  // This also attenuates old smoke behind a cloud, not just smoke inside it.
  function transmittance(worldPosition) {
    if (!enabled || !anchored) return 1;
    Matrix4.multiplyByPoint(inverse, worldPosition, point);
    const length = Cartesian3.distance(cameraLocal, point);
    if (length < .01) return 1;
    let opticalDepth = 0;
    for (const slot of slots) {
      if (!slot.active || !slot.model) continue;
      const {x:ox,y:oy,z:oz} = normalized(slot, cameraLocal, normalizedOrigin);
      const {x:px,y:py,z:pz} = normalized(slot, point, normalizedPoint);
      const dx = px-ox, dy = py-oy, dz = pz-oz;
      const a = dx*dx+dy*dy+dz*dz, b = ox*dx+oy*dy+oz*dz;
      const c = ox*ox+oy*oy+oz*oz-1, discriminant = b*b-a*c;
      if (a < 1e-12 || discriminant <= 0) continue;
      const root = Math.sqrt(discriminant);
      const entry = Math.max(0,(-b-root)/a), exit = Math.min(1,(-b+root)/a);
      if (exit <= entry) continue;
      const mid = (entry+exit)*.5, half = (exit-entry)*.5;
      const left = mid-half*.7745966692, right = mid+half*.7745966692;
      const integral = half * (8/9*Math.max(0,-(a*mid*mid+2*b*mid+c))**2
        + 5/9*(Math.max(0,-(a*left*left+2*b*left+c))**2 + Math.max(0,-(a*right*right+2*b*right+c))**2));
      opticalDepth += integral * length * .0045 * density * slot.fade;
      if (opticalDepth > 8) return .0003;
    }
    return Math.exp(-opticalDepth);
  }
  function beginLights() { engines.forEach((engine, i) => {
    engine.w = 0; material.setUniform('u_engine' + i, engine);
  }); }
  function setLight(index, position, power) {
    const engine = engines[index];
    if (!engine) return;
    const inside = estimateDensity(position);
    Cartesian4.fromElements(position.x, position.y, position.z,
      power * inside * Math.sqrt(transmittance(position)), engine);
    material.setUniform('u_engine' + index, engine);
  }
  return {
    update, estimateDensity, transmittance, beginLights, setLight,
    getNearCloudCenter(result) {
      const slot = slots.find(candidate => candidate.active && candidate.model);
      return slot ? Cartesian3.clone(slot.position, result) : undefined;
    },
    destroy() {
      destroyed = true;
      slots.forEach(slot => { if (slot.model) scene.primitives.remove(slot.model); });
      material.destroy();
    },
  };
}
