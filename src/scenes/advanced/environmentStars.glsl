uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform sampler2D starMap;
uniform vec3 hazeColor;
uniform vec3 worldUp;
uniform float starVisibility;
uniform float horizonStrength;
uniform float twilightSky;
in vec2 v_textureCoordinates;

void main() {
  vec4 color = texture(colorTexture, v_textureCoordinates);
  float rawDepth = texture(depthTexture, v_textureCoordinates).r;
  float sceneDepth = czm_readDepth(depthTexture, v_textureCoordinates);
  if (sceneDepth > 0.0 && sceneDepth < 0.99999) {
    // windowToEyeCoordinates expects the original log-depth value. Passing the
    // output of czm_readDepth here converts it twice and fogs nearby terrain.
    vec4 eye = czm_windowToEyeCoordinates(v_textureCoordinates * czm_viewport.zw, rawDepth);
    float distanceMeters = length(eye.xyz / eye.w);
    float distanceWeight = smoothstep(9000.0, 80000.0, distanceMeters);
    color.rgb = mix(color.rgb, hazeColor, distanceWeight * 0.60);
  } else {
    vec4 eye = czm_inverseProjection * vec4(v_textureCoordinates * 2.0 - 1.0, 1.0, 1.0);
    vec3 direction = normalize(czm_inverseViewRotation * normalize(eye.xyz / eye.w));
    float elevation = dot(direction, worldUp);
    // Cesium's sky atmosphere can turn black above a low sun once the stock
    // skybox is hidden. Lift only distant sky; scene-depth pixels keep their color.
    vec3 twilightFloor = vec3(0.13, 0.22, 0.33) *
      (0.22 + 0.78 * smoothstep(-0.03, 0.55, elevation));
    color.rgb = max(color.rgb, twilightFloor * twilightSky);
    if (starVisibility > 0.001) {
      vec2 uv = vec2(fract(atan(direction.y, direction.x) / 6.2831853 + 0.5),
        acos(clamp(direction.z, -1.0, 1.0)) / 3.14159265);
      vec2 texel = 1.0 / vec2(textureSize(starMap, 0));
      vec3 center = textureLod(starMap, uv, 0.0).rgb;
      vec3 surround = (textureLod(starMap, uv + vec2(texel.x, 0.0), 0.0).rgb
        + textureLod(starMap, uv - vec2(texel.x, 0.0), 0.0).rgb
        + textureLod(starMap, uv + vec2(0.0, texel.y), 0.0).rgb
        + textureLod(starMap, uv - vec2(0.0, texel.y), 0.0).rgb) * 0.25;
      float point = max(0.0, dot(center - surround, vec3(0.2126, 0.7152, 0.0722)));
      float star = pow(smoothstep(0.05, 0.19, point), 2.0);
      color.rgb += vec3(0.75, 0.82, 1.0) * star * starVisibility * 0.32;
    }
    float horizon = exp(-pow(elevation / 0.11, 2.0)) * horizonStrength;
    color.rgb = mix(color.rgb, hazeColor, horizon);
  }
  out_FragColor = color;
}
