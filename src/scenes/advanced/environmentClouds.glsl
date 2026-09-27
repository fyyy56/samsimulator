uniform sampler2D depthTexture;
uniform vec3 cameraLocal;
uniform mat3 viewToLocal;
uniform vec3 lightDirection;
uniform vec3 cloudTint;
uniform float cloudBase;
uniform float cloudThickness;
uniform float coverage;
uniform float densityScale;
uniform float cloudKind;
uniform float night;
uniform float drift;
uniform vec4 engine0;
uniform vec4 engine1;
uniform vec4 engine2;
uniform vec4 engine3;
in vec2 v_textureCoordinates;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
    mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}
float volumeNoise(vec3 p) {
  // Skew the sampling lattice so its 2D interpolation planes do not align
  // with world altitude and become visible as horizontal cloud sheets.
  p = vec3(p.x + p.z * .27, p.y - p.z * .19,
    p.z + p.x * .21 + p.y * .13);
  float z = floor(p.z), f = fract(p.z);
  f = f * f * (3.0 - 2.0 * f);
  return mix(noise(p.xy + z * vec2(17.1, 31.7)),
    noise(p.xy + (z + 1.0) * vec2(17.1, 31.7)), f);
}
float field(vec3 p, float detail) {
  vec2 weather = (p.xy + vec2(drift, drift * .31))
    / (cloudKind < 1.5 ? 7000.0 : 14000.0);
  float localBase = cloudBase + (noise(weather + 19.0) - .5) * 420.0;
  float localThickness = cloudThickness * mix(.72, 1.28, noise(weather * 1.7 + 7.0));
  float h = (p.z + dot(p.xy, p.xy) / 12740000.0 - localBase) / localThickness;
  if (h <= 0.0 || h >= 1.0) return 0.0;
  vec2 q = (p.xy + vec2(drift, drift * .31)) / (cloudKind < 1.5 ? 3600.0 : 5800.0);
  if (cloudKind < .5) q *= vec2(.48, 2.8);
  q += (noise(weather * 2.3) - .5) * vec2(.45, .27);
  float coarse = noise(q);
  float medium = volumeNoise(vec3(q * 3.07, h * 1.4));
  float fine = detail > .005 ? volumeNoise(vec3(q * 8.1, h * 2.2)) : .5;
  float shape = mix(coarse * .55 + medium * .45,
    coarse * .40 + medium * .40 + fine * .20, detail);
  float threshold = mix(.78, .20, coverage);
  float body = smoothstep(threshold, threshold + .16, shape);
  float edgeVariation = mix(.5, noise(q * 3.0), detail);
  float edge = smoothstep(.01, .22, h) * (1.0 - smoothstep(.50 + edgeVariation * .24, 1.0, h));
  float erosion = mix(.5, detail > .005 ? volumeNoise(vec3(q * 13.0, h * 2.0)) : .5, detail);
  return max(0.0, body - (1.0 - erosion) * .16) * edge * densityScale;
}
float lamp(vec3 p, vec4 source) {
  return source.w * exp(-dot(p - source.xyz, p - source.xyz) / 14000.0);
}
vec2 shellIntersection(vec3 ray, float altitude) {
  vec3 origin = cameraLocal + vec3(0.0, 0.0, 6370000.0);
  float radius = 6370000.0 + altitude;
  float b = dot(origin, ray);
  float c = (length(origin) - radius) * (length(origin) + radius);
  float discriminant = b * b - c;
  if (discriminant < 0.0) return vec2(-1.0);
  float root = sqrt(discriminant);
  return vec2(-b - root, -b + root);
}
void main() {
  vec4 eyeRay = czm_inverseProjection * vec4(v_textureCoordinates * 2.0 - 1.0, 1.0, 1.0);
  vec3 ray = normalize(viewToLocal * normalize(eyeRay.xyz / eyeRay.w));
  vec2 outer = shellIntersection(ray, cloudBase + cloudThickness * 1.28 + 210.0);
  vec2 inner = shellIntersection(ray, cloudBase - 210.0);
  float altitude = cameraLocal.z + dot(cameraLocal.xy,cameraLocal.xy) / 12740000.0;
  float start = max(0.0, outer.x), finish = min(65000.0, outer.y);
  if (altitude < cloudBase - 210.0) start = max(start, inner.y);
  else if (inner.x > 0.0) finish = min(finish, inner.x);
  float depth = czm_readDepth(depthTexture, v_textureCoordinates);
  bool hasSceneDepth = depth > 0.0 && depth < 1.0;
  if (hasSceneDepth) {
    vec4 point = czm_windowToEyeCoordinates(v_textureCoordinates * czm_viewport.zw, depth);
    finish = min(finish, length(point.xyz / point.w));
  }
  if (finish <= start || coverage < .001) { out_FragColor = vec4(0.0); return; }
  // Low-discrepancy offsets vary between depth strata, but are identical for
  // neighboring pixels. Quadratic spacing resolves the nearby cloud body first.
  float transmittance = 1.0;
  vec3 radiance = vec3(0.0);
  for (int i = 0; i < 56; i++) {
    float nearFraction = float(i) / 56.0;
    float farFraction = float(i + 1) / 56.0;
    float segmentStart = start + (finish - start) * nearFraction * nearFraction;
    float segmentEnd = start + (finish - start) * farFraction * farFraction;
    float stepSize = segmentEnd - segmentStart;
    float stratumOffset = .5 + (fract(float(i) * .754877666) - .5) * .48;
    float distanceAlongRay = segmentStart + stratumOffset * stepSize;
    vec3 p = cameraLocal + ray * distanceAlongRay;
    float detail = 1.0 - smoothstep(2500.0, 16000.0, distanceAlongRay);
    float d = field(p, detail) * (1.0 - smoothstep(35000.0, 65000.0, distanceAlongRay));
    if (d > .0002) {
      float opacity = 1.0 - exp(-d * stepSize * .0032);
      if (hasSceneDepth) opacity *= smoothstep(0.0, max(25.0, stepSize * 1.5),
        finish - distanceAlongRay);
      float h = clamp((p.z - cloudBase) / cloudThickness, 0.0, 1.0);
      float sunlight = exp(-field(p + lightDirection * 260.0, detail) * 1.6);
      float forwardScatter = pow(max(0.0, dot(ray, lightDirection)), 8.0) * .25;
      vec3 shade = mix(vec3(.40,.47,.55), vec3(.96,.98,1.0), h * .65 + sunlight * .35);
      shade = shade * cloudTint * (1.0 + forwardScatter);
      shade *= mix(1.0, .12, night);
      float localGlow = lamp(p,engine0) + lamp(p,engine1) + lamp(p,engine2) + lamp(p,engine3);
      shade += vec3(1.0,.56,.20) * min(localGlow, 1.7);
      vec3 horizon = mix(vec3(.54,.62,.70), vec3(.035,.045,.065), night);
      shade = mix(shade, horizon, 1.0 - exp(-distanceAlongRay / 40000.0));
      radiance += transmittance * opacity * shade;
      transmittance *= 1.0 - opacity;
      if (transmittance < .02) break;
    }
  }
  out_FragColor = vec4(radiance, 1.0 - transmittance);
}
