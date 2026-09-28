import { Cartesian3, Cartesian4, Color, DirectionalLight, JulianDate, Matrix3, Matrix4,
  PostProcessStage, PostProcessStageComposite, PostProcessStageSampleMode, SunLight,
  Transforms, Simon1994PlanetaryPositions } from 'cesium';
import { ENVIRONMENT_PRESETS, useEnvironmentSettings } from './environmentSettings.js';
import cloudShader from './environmentClouds.glsl?raw';
import starsShader from './environmentStars.glsl?raw';
import starMap from '../../assets/environment/sky/stars/starmap_2020_2k.jpg';
import { HDRI_PRESETS } from './environmentHdri.js';
import { getVisualExhaustPosition } from './modelOrientation.js';
import { createCloudSmokeOverlay } from './cloudSmokeOverlay.js';
import { createEnvironmentCloudLod } from './environmentCloudLod.js';

const cloudTints = Object.fromEntries(Object.entries(ENVIRONMENT_PRESETS)
  .map(([key, preset]) => [key, Cartesian3.fromArray(preset.tint)]));
const hazeColors = Object.fromEntries(Object.entries(ENVIRONMENT_PRESETS)
  .map(([key, preset]) => [key, Cartesian3.fromArray(preset.haze)]));
const diffuseLighting = Object.fromEntries(Object.entries(ENVIRONMENT_PRESETS)
  .map(([key, preset]) => [key, HDRI_PRESETS[key].diffuse.map(value =>
    Cartesian3.multiplyByScalar(value, preset.ibl, new Cartesian3()))]));

// Rendering clock only. Neither simulation time nor weather/sensor state is changed.
export function createAdvancedEnvironment(viewer) {
  const scene = viewer.scene;
  const frame = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(30.5, 50.4));
  const inverse = Matrix4.inverseTransformation(frame, new Matrix4());
  const fixedToLocal = Matrix4.getMatrix3(inverse, new Matrix3());
  const cameraLocal = new Cartesian3(), viewToLocal = new Matrix3();
  const worldUp = new Cartesian3();
  const lightDirection = new Cartesian3(0, 0, 1);
  const engines = Array.from({ length: 4 }, () => new Cartesian4());
  const smokeOverlay = createCloudSmokeOverlay(scene);
  const cloudLod = createEnvironmentCloudLod(scene);
  let current = useEnvironmentSettings.getState(), applied = null, enabled = false;
  let drift = 0, previousNow = 0, starVisibility = 0, desiredStarVisibility = 0;
  const snapshot = {
    time: JulianDate.clone(viewer.clock.currentTime), animate: viewer.clock.shouldAnimate,
    light: scene.light, lighting: scene.globe.enableLighting, shadows: viewer.shadows,
    atmosphereFromSun: scene.globe.dynamicAtmosphereLightingFromSun,
    dynamicAtmosphereLighting: scene.globe.dynamicAtmosphereLighting,
    softShadows: scene.shadowMap.softShadows, shadowSize: scene.shadowMap.size,
    shadowDistance: scene.shadowMap.maximumDistance,
    exposure: scene.postProcessStages.exposure, fog: scene.fog.density,
    brightness: viewer.imageryLayers.get(0).brightness,
    saturation: viewer.imageryLayers.get(0).saturation,
    groundAtmosphere: scene.globe.showGroundAtmosphere,
    atmosphereIntensity: scene.atmosphere.lightIntensity,
    dynamicLighting: scene.atmosphere.dynamicLighting,
    skyBrightness: scene.skyAtmosphere.brightnessShift,
    skyHue: scene.skyAtmosphere.hueShift, skySaturation: scene.skyAtmosphere.saturationShift,
    sphericalHarmonicCoefficients: scene.sphericalHarmonicCoefficients,
    backgroundColor: Color.clone(scene.backgroundColor),
    skyShow: scene.skyAtmosphere.show, skyBoxShow: scene.skyBox?.show,
    sunShow: scene.sun?.show, moonShow: scene.moon?.show,
  };
  // Future depth-aware cloud occlusion, smoke attenuation, heat distortion and
  // soft-particle fade can share this depth-aware presentation boundary.
  const atmosphere = scene.postProcessStages.add(new PostProcessStage({
    name: 'advanced-aerial-perspective', fragmentShader: starsShader,
    uniforms: {
      starMap, starVisibility: () => starVisibility,
      hazeColor: () => hazeColors[current.preset],
      horizonStrength: () => current.preset === 'NIGHT' ? .04
        : current.preset.startsWith('DAY_') ? .12 : .18,
      twilightSky: () => current.preset === 'SUNRISE' || current.preset === 'SUNSET' ? 1 : 0,
      worldUp: () => worldUp,
    },
  }));
  atmosphere.enabled = false;
  const clouds = new PostProcessStage({
    name: 'advanced-cloud-volume', fragmentShader: cloudShader, textureScale: .75,
    sampleMode: PostProcessStageSampleMode.LINEAR,
    uniforms: {
      cameraLocal: () => cameraLocal, viewToLocal: () => viewToLocal,
      lightDirection: () => lightDirection,
      cloudTint: () => cloudTints[current.preset],
      cloudBase: () => current.altitude,
      cloudThickness: () => current.cloudType === 'THIN_SCATTERED' ? 280
        : current.cloudType === 'OVERCAST' ? 1100 : 1700,
      coverage: () => current.cover * (current.cloudType === 'OVERCAST' ? .60 : .45),
      densityScale: () => current.density * (current.cloudType === 'THIN_SCATTERED' ? .06
        : current.cloudType === 'OVERCAST' ? .12 : .15),
      cloudKind: () => current.cloudType === 'THIN_SCATTERED' ? 0 : current.cloudType === 'CUMULUS' ? 1 : 2,
      night: () => current.preset === 'NIGHT' ? 1 : 0, drift: () => drift,
      engine0: () => engines[0], engine1: () => engines[1],
      engine2: () => engines[2], engine3: () => engines[3],
    },
  });
  const composite = scene.postProcessStages.add(new PostProcessStageComposite({
    name: 'advanced-atmosphere-clouds', inputPreviousStageTexture: false,
    stages: [clouds, new PostProcessStage({
      name: 'advanced-cloud-composite', sampleMode: PostProcessStageSampleMode.LINEAR,
      uniforms: {
        cloudTexture: clouds.name,
        smokeColorTexture: () => smokeOverlay.colorTexture(),
        smokeDepthTexture: () => smokeOverlay.depthTexture(),
        cameraLocal: () => cameraLocal, viewToLocal: () => viewToLocal,
        cloudBase: () => current.altitude,
        cloudThickness: () => current.cloudType === 'THIN_SCATTERED' ? 280
          : current.cloudType === 'OVERCAST' ? 1100 : 1700,
      },
      fragmentShader: `
        uniform sampler2D colorTexture;
        uniform sampler2D cloudTexture;
        uniform sampler2D smokeColorTexture;
        uniform sampler2D smokeDepthTexture;
        uniform vec3 cameraLocal;
        uniform mat3 viewToLocal;
        uniform float cloudBase;
        uniform float cloudThickness;
        in vec2 v_textureCoordinates;
        vec2 shellIntersection(vec3 ray, float altitude) {
          vec3 origin = cameraLocal + vec3(0.0, 0.0, 6370000.0);
          float radius = 6370000.0 + altitude;
          float b = dot(origin, ray);
          float c = (length(origin) - radius) * (length(origin) + radius);
          float d = b * b - c;
          if (d < 0.0) return vec2(-1.0);
          float root = sqrt(d);
          return vec2(-b - root, -b + root);
        }
        void main() {
          vec4 sceneColor = texture(colorTexture, v_textureCoordinates);
          vec2 verticalPixel = vec2(0.0, 1.0 / czm_viewport.w);
          vec4 cloud = texture(cloudTexture, v_textureCoordinates) * .32;
          cloud += texture(cloudTexture, v_textureCoordinates + verticalPixel * 3.0) * .22;
          cloud += texture(cloudTexture, v_textureCoordinates - verticalPixel * 3.0) * .22;
          cloud += texture(cloudTexture, v_textureCoordinates + verticalPixel * 9.0) * .12;
          cloud += texture(cloudTexture, v_textureCoordinates - verticalPixel * 9.0) * .12;
          vec4 smokeColor = texture(smokeColorTexture, v_textureCoordinates);
          vec4 smokeDepth = texture(smokeDepthTexture, v_textureCoordinates);
          vec4 eyeRay = czm_inverseProjection * vec4(v_textureCoordinates * 2.0 - 1.0, 1.0, 1.0);
          vec3 ray = normalize(viewToLocal * normalize(eyeRay.xyz / eyeRay.w));
          vec2 outer = shellIntersection(ray, cloudBase + 6300.0 + cloudThickness * 1.55 + 300.0);
          vec2 inner = shellIntersection(ray, cloudBase - 300.0);
          float altitude = cameraLocal.z + dot(cameraLocal.xy, cameraLocal.xy) / 12740000.0;
          float firstCloud = max(0.0, outer.x);
          if (altitude < cloudBase - 300.0) firstCloud = max(firstCloud, inner.y);
          float smokeDistance = (smokeDepth.r + smokeDepth.g / 255.0) * 80000.0;
          float smokeInFront = smokeDepth.a *
            (1.0 - smoothstep(firstCloud - 40.0, firstCloud + 180.0, smokeDistance));
          vec3 combined = sceneColor.rgb * (1.0 - cloud.a) + cloud.rgb;
          combined = mix(combined, smokeColor.rgb, cloud.a * smokeColor.a * smokeInFront);
          out_FragColor = vec4(combined, sceneColor.a);
        }`,
    })],
  }));
  composite.enabled = false;
  const restore = () => {
    viewer.clock.currentTime = JulianDate.clone(snapshot.time);
    viewer.clock.shouldAnimate = snapshot.animate;
    scene.light = snapshot.light; scene.globe.enableLighting = snapshot.lighting;
    scene.globe.dynamicAtmosphereLightingFromSun = snapshot.atmosphereFromSun;
    scene.globe.dynamicAtmosphereLighting = snapshot.dynamicAtmosphereLighting;
    viewer.shadows = snapshot.shadows;
    scene.shadowMap.softShadows = snapshot.softShadows;
    scene.shadowMap.size = snapshot.shadowSize;
    scene.shadowMap.maximumDistance = snapshot.shadowDistance;
    scene.postProcessStages.exposure = snapshot.exposure;
    scene.fog.density = snapshot.fog;
    viewer.imageryLayers.get(0).brightness = snapshot.brightness;
    viewer.imageryLayers.get(0).saturation = snapshot.saturation;
    scene.globe.showGroundAtmosphere = snapshot.groundAtmosphere;
    scene.atmosphere.lightIntensity = snapshot.atmosphereIntensity;
    scene.atmosphere.dynamicLighting = snapshot.dynamicLighting;
    scene.skyAtmosphere.brightnessShift = snapshot.skyBrightness;
    scene.skyAtmosphere.hueShift = snapshot.skyHue;
    scene.skyAtmosphere.saturationShift = snapshot.skySaturation;
    scene.skyAtmosphere.show = snapshot.skyShow;
    if (scene.skyBox) scene.skyBox.show = snapshot.skyBoxShow;
    if (scene.sun) scene.sun.show = snapshot.sunShow;
    if (scene.moon) scene.moon.show = snapshot.moonShow;
    scene.backgroundColor = snapshot.backgroundColor;
    scene.sphericalHarmonicCoefficients = snapshot.sphericalHarmonicCoefficients;
    applied = null;
  };
  return {
    isEnabled: () => enabled,
    cloudTransmission: cloudLod.transmittance,
    // Shared scene-depth boundary for later cloud occlusion, smoke attenuation,
    // heat distortion and soft-particle fades. No new VFX behavior is enabled here.
    depthHooks: Object.freeze({ sceneDepthUniform: 'depthTexture', clouds,
      cloudComposite: composite, aerialPerspective: atmosphere,
      estimateCloudDensity: cloudLod.estimateDensity,
      getNearCloudCenter: cloudLod.getNearCloudCenter }),
    update(active, now) {
      if (!active) {
        if (enabled) restore();
        cloudLod.update(false, current, viewer.camera);
        enabled = false; atmosphere.enabled = false; composite.enabled = false;
        previousNow = now;
        return;
      }
      enabled = true;
      Cartesian3.normalize(viewer.camera.positionWC, worldUp);
      current = useEnvironmentSettings.getState();
      cloudLod.update(true, current, viewer.camera);
      const preset = ENVIRONMENT_PRESETS[current.preset];
      const signature = [current.preset, current.cloudType, current.cover, current.density].join(':');
      if (applied !== signature) {
        const date = new Date('2026-09-24T00:00:00Z');
        date.setTime(date.getTime() + preset.hour * 3600000);
        viewer.clock.currentTime = JulianDate.fromDate(date);
        viewer.clock.shouldAnimate = false;
        const night = current.preset === 'NIGHT';
        const lightScale = current.preset === 'DAY_OVERCAST' ? .86
          : current.cloudType === 'OVERCAST' ? 1 - current.cover * current.density * .5 : 1;
        if (night) {
          const moon = Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(viewer.clock.currentTime);
          const rotation = Transforms.computeIcrfToFixedMatrix(viewer.clock.currentTime)
            ?? Transforms.computeTemeToPseudoFixedMatrix(viewer.clock.currentTime);
          const direction = Cartesian3.normalize(Matrix3.multiplyByVector(rotation, moon, new Cartesian3()), new Cartesian3());
          scene.light = new DirectionalLight({ direction: Cartesian3.negate(direction, new Cartesian3()),
            color: Color.fromCssColorString('#a9bde8'), intensity: preset.intensity * lightScale });
          Matrix3.multiplyByVector(fixedToLocal, direction, lightDirection);
        } else {
          scene.light = new SunLight({ color: Color.fromCssColorString(
            current.preset.startsWith('DAY_') ? '#fff9ef' : '#ffd4ac'), intensity: preset.intensity * lightScale });
          const sun = Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(viewer.clock.currentTime);
          const rotation = Transforms.computeIcrfToFixedMatrix(viewer.clock.currentTime)
            ?? Transforms.computeTemeToPseudoFixedMatrix(viewer.clock.currentTime);
          Matrix3.multiplyByVector(fixedToLocal, Matrix3.multiplyByVector(rotation, sun, new Cartesian3()), lightDirection);
          Cartesian3.normalize(lightDirection, lightDirection);
        }
        scene.globe.enableLighting = true;
        scene.globe.dynamicAtmosphereLighting = true;
        scene.globe.dynamicAtmosphereLightingFromSun = true;
        viewer.shadows = true; scene.shadowMap.softShadows = true;
        scene.shadowMap.size = 1024; scene.shadowMap.maximumDistance = 15000;
        scene.postProcessStages.exposure = preset.exposure;
        scene.fog.density = preset.fog;
        scene.atmosphere.dynamicLighting = 2;
        scene.atmosphere.lightIntensity = night ? 2.2 : 9;
        scene.skyAtmosphere.brightnessShift = night ? -.49 : current.preset === 'DAY_OVERCAST' ? -.12 : -.04;
        scene.skyAtmosphere.hueShift = 0;
        scene.skyAtmosphere.saturationShift = -.08;
        scene.skyAtmosphere.show = true;
        scene.backgroundColor = Color.BLACK;
        // Globe ground-atmosphere scattering adds a hard colored seam at the limb.
        // The sky atmosphere and depth-aware aerial perspective provide the transition.
        scene.globe.showGroundAtmosphere = false;
        // Cesium's default skybox is a second low-resolution star panorama.
        // Keep only the filtered star layer so the Milky Way does not read as blotches.
        if (scene.skyBox) scene.skyBox.show = false;
        if (scene.sun) scene.sun.show = true;
        if (scene.moon) scene.moon.show = true;
        viewer.imageryLayers.get(0).brightness = preset.brightness;
        viewer.imageryLayers.get(0).saturation = night ? .36 : current.preset === 'DAY_OVERCAST' ? .76 : 1;
        scene.sphericalHarmonicCoefficients = diffuseLighting[current.preset];
        const sun = Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(viewer.clock.currentTime);
        const rotation = Transforms.computeIcrfToFixedMatrix(viewer.clock.currentTime)
          ?? Transforms.computeTemeToPseudoFixedMatrix(viewer.clock.currentTime);
        const sunLocal = Matrix3.multiplyByVector(fixedToLocal,
          Matrix3.multiplyByVector(rotation, sun, new Cartesian3()), new Cartesian3());
        desiredStarVisibility = night
          ? Math.max(0, Math.min(1, (-sunLocal.z / Cartesian3.magnitude(sunLocal) - .02) * 8)) : 0;
        applied = signature;
      }
      const frameSeconds = Math.min(.1, previousNow ? (now - previousNow) / 1000 : 0);
      drift += frameSeconds * 6;
      starVisibility += (desiredStarVisibility - starVisibility) * Math.min(1, frameSeconds * 2.5);
      previousNow = now;
      atmosphere.enabled = true;
      composite.enabled = current.cloudType !== 'CLEAR' && current.cover > 0
        && viewer.camera.positionCartographic.height < 120000;
    },
    sync(metadata, missiles, smokePuffs = []) {
      cloudLod.beginLights();
      if (!enabled || !composite.enabled) return;
      smokeOverlay.update(smokePuffs, current.preset === 'NIGHT');
      Matrix4.multiplyByPoint(inverse, viewer.camera.positionWC, cameraLocal);
      Matrix3.multiply(fixedToLocal, Matrix4.getMatrix3(viewer.camera.inverseViewMatrix, new Matrix3()), viewToLocal);
      engines.forEach(engine => { engine.w = 0; });
      let count = 0;
      for (const missile of missiles) {
        const meta = metadata.get('INTERCEPTOR:' + missile.id);
        if (!meta?.visualState?.worldPosition || meta.visualImpact) continue;
        const phase = meta.visualState.kinematics?.motorPhase ?? missile.motorPhase;
        if (phase !== 'BOOST' && phase !== 'SUSTAIN') continue;
        const exhaust = getVisualExhaustPosition(meta.visualState, meta.visualState.worldPosition, meta.presentation);
        cloudLod.setLight(count, exhaust, phase === 'BOOST' ? 1.2 : .55);
        const point = Matrix4.multiplyByPoint(inverse, exhaust, new Cartesian3());
        engines[count].x = point.x; engines[count].y = point.y; engines[count].z = point.z;
        engines[count].w = phase === 'BOOST' ? 1.2 : .55;
        if (++count === engines.length) break;
      }
    },
    destroy() {
      if (enabled) restore();
      scene.postProcessStages.remove(atmosphere);
      scene.postProcessStages.remove(composite);
      cloudLod.destroy();
      smokeOverlay.destroy();
    },
  };
}
