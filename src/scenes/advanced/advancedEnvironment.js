import { Cartesian3, Cartesian4, Color, DirectionalLight, JulianDate, Matrix3, Matrix4,
  PostProcessStage, PostProcessStageComposite, PostProcessStageSampleMode, SunLight,
  Transforms, Simon1994PlanetaryPositions } from 'cesium';
import { ENVIRONMENT_PRESETS, useEnvironmentSettings } from './environmentSettings.js';
import cloudShader from './environmentClouds.glsl?raw';
import { getVisualExhaustPosition } from './modelOrientation.js';
import { createCloudSmokeOverlay } from './cloudSmokeOverlay.js';

// Rendering clock only. Neither simulation time nor weather/sensor state is changed.
export function createAdvancedEnvironment(viewer) {
  const scene = viewer.scene;
  const frame = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(30.5, 50.4));
  const inverse = Matrix4.inverseTransformation(frame, new Matrix4());
  const fixedToLocal = Matrix4.getMatrix3(inverse, new Matrix3());
  const cameraLocal = new Cartesian3(), viewToLocal = new Matrix3();
  const lightDirection = new Cartesian3(0, 0, 1);
  const engines = Array.from({ length: 4 }, () => new Cartesian4());
  const smokeOverlay = createCloudSmokeOverlay(scene);
  let current = useEnvironmentSettings.getState(), applied = null, enabled = false;
  let drift = 0, previousNow = 0;
  const snapshot = {
    time: JulianDate.clone(viewer.clock.currentTime), animate: viewer.clock.shouldAnimate,
    light: scene.light, lighting: scene.globe.enableLighting, shadows: viewer.shadows,
    atmosphereFromSun: scene.globe.dynamicAtmosphereLightingFromSun,
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
  };
  const clouds = new PostProcessStage({
    name: 'advanced-cloud-volume', fragmentShader: cloudShader, textureScale: .75,
    sampleMode: PostProcessStageSampleMode.LINEAR,
    uniforms: {
      cameraLocal: () => cameraLocal, viewToLocal: () => viewToLocal,
      lightDirection: () => lightDirection,
      cloudTint: () => Cartesian3.fromArray(ENVIRONMENT_PRESETS[current.preset].tint),
      cloudBase: () => current.altitude,
      cloudThickness: () => current.cloudType === 'THIN_SCATTERED' ? 280
        : current.cloudType === 'OVERCAST' ? 1100 : 1700,
      coverage: () => current.cover,
      densityScale: () => current.density * (current.cloudType === 'THIN_SCATTERED' ? .28 : 1),
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
        hazeColor: () => Cartesian3.fromArray(current.preset === 'NIGHT' ? [.065,.075,.10]
          : current.preset === 'DAY' ? [.57,.63,.63] : [.59,.49,.45]),
        hazeStrength: () => current.preset === 'NIGHT' ? .58 : .92,
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
        uniform vec3 hazeColor;
        uniform float hazeStrength;
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
          vec2 outer = shellIntersection(ray, cloudBase + cloudThickness + 300.0);
          vec2 inner = shellIntersection(ray, cloudBase - 300.0);
          float altitude = cameraLocal.z + dot(cameraLocal.xy, cameraLocal.xy) / 12740000.0;
          float firstCloud = max(0.0, outer.x);
          if (altitude < cloudBase - 300.0) firstCloud = max(firstCloud, inner.y);
          float smokeDistance = (smokeDepth.r + smokeDepth.g / 255.0) * 80000.0;
          float smokeInFront = smokeDepth.a *
            (1.0 - smoothstep(firstCloud - 40.0, firstCloud + 180.0, smokeDistance));
          vec3 combined = sceneColor.rgb * (1.0 - cloud.a) + cloud.rgb;
          combined = mix(combined, smokeColor.rgb, cloud.a * smokeColor.a * smokeInFront);
          float horizon = exp(-abs(ray.z) * 30.0) * hazeStrength;
          combined = mix(combined, hazeColor, horizon);
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
    applied = null;
  };
  return {
    isEnabled: () => enabled,
    update(active, now) {
      if (!active) {
        if (enabled) restore();
        enabled = false; composite.enabled = false; previousNow = now;
        return;
      }
      enabled = true;
      current = useEnvironmentSettings.getState();
      const preset = ENVIRONMENT_PRESETS[current.preset];
      const signature = [current.preset, current.cloudType, current.cover, current.density].join(':');
      if (applied !== signature) {
        const date = new Date('2026-09-24T00:00:00Z');
        date.setTime(date.getTime() + preset.hour * 3600000);
        viewer.clock.currentTime = JulianDate.fromDate(date);
        viewer.clock.shouldAnimate = false;
        const night = current.preset === 'NIGHT';
        const lightScale = current.cloudType === 'OVERCAST' ? 1 - current.cover * current.density * .5 : 1;
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
            current.preset === 'DAY' ? '#fff9ef' : '#ffd4ac'), intensity: preset.intensity * lightScale });
          const sun = Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(viewer.clock.currentTime);
          const rotation = Transforms.computeIcrfToFixedMatrix(viewer.clock.currentTime)
            ?? Transforms.computeTemeToPseudoFixedMatrix(viewer.clock.currentTime);
          Matrix3.multiplyByVector(fixedToLocal, Matrix3.multiplyByVector(rotation, sun, new Cartesian3()), lightDirection);
          Cartesian3.normalize(lightDirection, lightDirection);
        }
        scene.globe.enableLighting = true;
        scene.globe.dynamicAtmosphereLightingFromSun = true;
        viewer.shadows = true; scene.shadowMap.softShadows = true;
        scene.shadowMap.size = 1024; scene.shadowMap.maximumDistance = 15000;
        scene.postProcessStages.exposure = preset.exposure;
        scene.fog.density = preset.fog;
        scene.atmosphere.dynamicLighting = 2;
        scene.atmosphere.lightIntensity = night ? 6 : 10;
        scene.skyAtmosphere.brightnessShift = night ? -.35 : -.03;
        scene.skyAtmosphere.hueShift = 0;
        scene.skyAtmosphere.saturationShift = -.08;
        scene.skyAtmosphere.show = true;
        scene.backgroundColor = Color.BLACK;
        scene.globe.showGroundAtmosphere = false;
        if (scene.skyBox) scene.skyBox.show = true;
        if (scene.sun) scene.sun.show = true;
        if (scene.moon) scene.moon.show = true;
        viewer.imageryLayers.get(0).brightness = preset.brightness;
        viewer.imageryLayers.get(0).saturation = night ? .32 : 1;
        applied = signature;
      }
      drift += Math.min(.1, previousNow ? (now - previousNow) / 1000 : 0) * 6;
      previousNow = now;
      composite.enabled = current.cloudType !== 'CLEAR' && current.cover > 0
        && viewer.camera.positionCartographic.height < 120000;
    },
    sync(metadata, missiles, smokePuffs = []) {
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
        const point = Matrix4.multiplyByPoint(inverse, exhaust, new Cartesian3());
        engines[count].x = point.x; engines[count].y = point.y; engines[count].z = point.z;
        engines[count].w = phase === 'BOOST' ? 1.2 : .55;
        if (++count === engines.length) break;
      }
    },
    destroy() { if (enabled) restore(); scene.postProcessStages.remove(composite); smokeOverlay.destroy(); },
  };
}
