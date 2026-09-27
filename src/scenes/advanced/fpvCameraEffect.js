import { Cartesian3, PostProcessStage, PostProcessStageSampleMode } from 'cesium';
import { CONTROLLABLE_AIR_PROFILES, CONTROLLABLE_AIR_PROFILE_IDS } from '../../data/controllableAirProfiles.js';

// Cosmetic lens only: the simulation and camera world transform are unchanged.
export const FPV_LENS_STRENGTH = CONTROLLABLE_AIR_PROFILES[CONTROLLABLE_AIR_PROFILE_IDS.SKYFALL_FPV].camera.fpvLensDistortion;
export const fpvLensSample = (x, y, strength = FPV_LENS_STRENGTH) => {
  const factor = (1 + strength * (x * x + y * y)) / (1 + 2 * strength);
  return { x: x * factor, y: y * factor };
};

export const createFpvCameraEffect = (scene, getMode) => {
  const stage = scene.postProcessStages.add(new PostProcessStage({
    name: 'advanced-onboard-lens',
    sampleMode: PostProcessStageSampleMode.LINEAR,
    uniforms: {
      lens: () => getMode().fpv ? FPV_LENS_STRENGTH : 0,
      thermal: () => getMode().thermal ? 1 : 0,
      optical: () => getMode().ols ? 1 : 0,
      lowLight: () => getMode().lowLight ? 1 : 0,
      flash: () => getMode().flash ?? 0,
      opticalZoom: () => getMode().zoom ?? 1,
      opticalRange: () => getMode().rangeM ?? 10000,
      flashAge: () => Math.min(100, getMode().flashAgeSec ?? 100),
      heatLoad: () => getMode().heatLoad ?? 0,
      launchLightPosition: () => getMode().launchLight?.position ?? Cartesian3.ZERO,
      launchLightStrength: () => getMode().fpv ? 0 : getMode().launchLight?.strength ?? 0,
      grainTime: () => Math.floor(performance.now() / 40),
    },
    fragmentShader: `
      uniform sampler2D colorTexture;
      uniform sampler2D depthTexture;
      uniform vec3 launchLightPosition;
      uniform float launchLightStrength;
      uniform float lens;
      uniform float thermal;
      uniform float optical;
      uniform float lowLight;
      uniform float flash;
      uniform float grainTime;
      uniform float opticalZoom;
      uniform float opticalRange;
      uniform float flashAge;
      uniform float heatLoad;
      in vec2 v_textureCoordinates;
      void main() {
        vec2 p = v_textureCoordinates * 2.0 - 1.0;
        float r2 = dot(p, p);
        vec2 uv = 0.5 + 0.5 * p * (1.0 + lens * r2) / (1.0 + 2.0 * lens);
        vec3 color = texture(colorTexture, uv).rgb;
        if (launchLightStrength > .005) {
          float depth = texture(depthTexture, uv).r;
          if (depth > 0.0 && depth < 1.0) {
            vec4 eye = czm_windowToEyeCoordinates(gl_FragCoord.xy, depth);
            float distanceToFlash = length(eye.xyz / eye.w - launchLightPosition);
            float illumination = pow(max(0.0, 1.0 - distanceToFlash / 95.0), 2.0)
              * launchLightStrength;
            color += vec3(1.0, .69, .32) * illumination * (lowLight > .5 ? 2.4 : 1.4);
          }
        }
        // Restrained highlight halo for Advanced/EO, without softening the whole image.
        if (lens < .001) {
          vec2 pixel = 1.0 / vec2(textureSize(colorTexture, 0));
          vec3 halo = vec3(0.0);
          for (int i = 0; i < 8; i++) {
            float angle = float(i) * .785398;
            vec2 offset = vec2(cos(angle), sin(angle)) * pixel * 5.0;
            halo += max(texture(colorTexture, uv + offset).rgb - vec3(.8), vec3(0.0));
          }
          color += halo * (lowLight > .5 ? .55 : thermal > .5 ? .3 : .18);
        }
        if (optical > 0.5) {
          vec2 texel = 1.0 / vec2(textureSize(colorTexture, 0));
          float softness = 0.55 + min(1.5, log2(max(1.0, opticalZoom)) * .22)
            + min(.7, opticalRange / 50000.0);
          vec2 d = texel * softness;
          color = color * .36 + .16 * (texture(colorTexture, uv + vec2(d.x, 0)).rgb
            + texture(colorTexture, uv - vec2(d.x, 0)).rgb
            + texture(colorTexture, uv + vec2(0, d.y)).rgb
            + texture(colorTexture, uv - vec2(0, d.y)).rgb);
        }
        if (thermal > 0.5) {
          vec2 thermalTexel = 0.75 / vec2(textureSize(colorTexture, 0));
          vec3 softened = .60 * color + .10 * (
            texture(colorTexture, uv + vec2(thermalTexel.x, 0.0)).rgb
            + texture(colorTexture, uv - vec2(thermalTexel.x, 0.0)).rgb
            + texture(colorTexture, uv + vec2(0.0, thermalTexel.y)).rgb
            + texture(colorTexture, uv - vec2(0.0, thermalTexel.y)).rgb);
          float heat = dot(softened, vec3(0.2126, 0.7152, 0.0722));
          float surface = .15 + .78 * pow(smoothstep(.025, .92, heat), .82);
          color = vec3(surface);
        } else if (lowLight > .5 && optical < .5) {
          color = pow(clamp(color * 1.55, 0.0, 1.0), vec3(.78)) * vec3(.78, .84, .8);
        } else if (lens > 0.0) {
          vec2 fringe = p * r2 * 0.00032;
          color.r = texture(colorTexture, uv + fringe).r;
          color.b = texture(colorTexture, uv - fringe).b;
          color = mix(vec3(dot(color, vec3(0.2126, 0.7152, 0.0722))), color, 0.87);
        }
        if (lens > 0.0) color *= 1.0 - 0.14 * smoothstep(0.45, 1.9, r2);
        if (optical > 0.5) {
          // A restrained camera texture, with no geometric jitter or lens warp:
          // the optical bracket still projects the exact rendered entity.
          vec2 texel = 1.0 / vec2(textureSize(colorTexture, 0));
          float neighbor = dot(texture(colorTexture, uv + texel).rgb, vec3(0.2126, 0.7152, 0.0722));
          if (lowLight > 0.5) {
            float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
            float amplified = pow(clamp(luminance * 1.8 + neighbor * 0.2, 0.0, 1.0), 0.7);
            color = amplified * vec3(0.74, 0.8, 0.77);
          } else if (thermal < 0.5) {
            float haze = .04 + min(.16, opticalRange / 180000.0) + min(.06, opticalZoom / 600.0);
            color = mix(color, vec3(neighbor), .16);
            color = mix(color, vec3(.51, .57, .6), haze);
          } else {
            color = mix(color, vec3(neighbor), .08);
          }
          color *= 1.0 - 0.12 * smoothstep(0.4, 1.8, r2);
        }
        float recovery = flashAge > .12 ? .28 * exp(-(flashAge - .12) / 1.1) : 0.0;
        float gain = 1.0 - heatLoad * (thermal > .5 ? .18 : lowLight > .5 ? .22 : .035)
          - recovery * (lowLight > .5 ? .7 : thermal > .5 ? .45 : .14);
        color *= gain;
        color += vec3(flash * (thermal > .5 ? 1.3 : lowLight > .5 ? 1.0 : .32));
        if (thermal > .5 || lowLight > .5 || optical > .5) {
          float noise = fract(sin(dot(floor(gl_FragCoord.xy / 1.5), vec2(12.9898, 78.233))
            + grainTime) * 43758.5453) - 0.5;
          color += noise * (lowLight > .5 ? .026 : thermal > .5 ? .014 : .01);
        }
        out_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
      }`,
  }));
  stage.enabled = false;
  return stage;
};
