import { PostProcessStage, PostProcessStageSampleMode } from 'cesium';
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
      grainTime: () => Math.floor(performance.now() / 40),
    },
    fragmentShader: `
      uniform sampler2D colorTexture;
      uniform float lens;
      uniform float thermal;
      uniform float optical;
      uniform float lowLight;
      uniform float flash;
      uniform float grainTime;
      in vec2 v_textureCoordinates;
      void main() {
        vec2 p = v_textureCoordinates * 2.0 - 1.0;
        float r2 = dot(p, p);
        vec2 uv = 0.5 + 0.5 * p * (1.0 + lens * r2) / (1.0 + 2.0 * lens);
        vec3 color = texture(colorTexture, uv).rgb;
        if (thermal > 0.5) {
          float heat = dot(color, vec3(0.2126, 0.7152, 0.0722));
          color = vec3(smoothstep(0.035, 0.93, heat));
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
            color = amplified * vec3(0.57, 0.91, 0.65) + vec3(flash * 0.55);
          } else if (thermal < 0.5) {
            color = mix(color, vec3(neighbor), 0.08);
          } else {
            color = vec3(0.23) + color * 0.77;
          }
          float noise = fract(sin(dot(floor(gl_FragCoord.xy / 1.4), vec2(12.9898, 78.233))
            + grainTime) * 43758.5453) - 0.5;
          color += noise * (lowLight > 0.5 ? 0.035 : 0.016);
          color *= 1.0 - 0.12 * smoothstep(0.4, 1.8, r2);
        }
        out_FragColor = vec4(color, 1.0);
      }`,
  }));
  stage.enabled = false;
  return stage;
};
