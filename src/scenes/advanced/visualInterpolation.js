import { Cartesian3, Cartographic, HeadingPitchRoll, Math as CesiumMath,
  Matrix4, Quaternion, Transforms } from 'cesium';

export const VISUAL_DELAY_SEC = 0.05;
export const MAX_VISUAL_EXTRAPOLATION_SEC = 0.05;
const MAX_SNAPSHOTS = 32;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Local ENU body: +X is nose, +Z is up. Axis corrections belong to the model,
// never to these authoritative snapshots. No TrackData enters this buffer.
export const visualBodyQuaternion = k => Quaternion.fromHeadingPitchRoll(new HeadingPitchRoll(
  CesiumMath.toRadians((k.headingDeg ?? 0) - 90),
  CesiumMath.toRadians(k.pitchDeg ?? 0), CesiumMath.toRadians(k.rollDeg ?? 0),
), new Quaternion());

export function pushVisualSnapshot(cache, key, position, kinematics, time) {
  let state = cache.get(key);
  if (!state || time < state.samples.at(-1).time) {
    state = { samples: [], result: null };
    cache.set(key, state);
  }
  if (state.samples.at(-1)?.time === time) return state;
  const world = Cartesian3.fromDegrees(position.lng, position.lat, position.altitudeM);
  const velocity = Matrix4.multiplyByPointAsVector(Transforms.eastNorthUpToFixedFrame(world),
    new Cartesian3(kinematics.eastMps ?? 0, kinematics.northMps ?? 0, kinematics.upMps ?? 0),
    new Cartesian3());
  state.samples.push({ time, world, velocity, kinematics: { ...kinematics },
    quaternion: visualBodyQuaternion(kinematics) });
  if (state.samples.length > MAX_SNAPSHOTS) state.samples.shift();
  return state;
}

export function sampleVisualState(cache, key, time) {
  const state = cache.get(key);
  if (!state) return null;
  const samples = state.samples;
  // Cesium's model visualizer and our camera read at different phases of the
  // same frame. Both must receive this exact pose, without resampling it.
  if (state.result && state.resultTime === time && state.resultLatest === samples.at(-1)) {
    return state.result;
  }
  let index = samples.length - 1;
  while (index > 0 && samples[index].time > time) index--;
  const from = samples[index];
  const to = samples[Math.min(index + 1, samples.length - 1)];
  const duration = to.time - from.time;
  const alpha = duration > 0 ? clamp((time - from.time) / duration, 0, 1) : 0;
  const extrapolation = clamp(time - to.time, 0, MAX_VISUAL_EXTRAPOLATION_SEC);
  const world = Cartesian3.lerp(from.world, to.world, alpha, new Cartesian3());
  if (extrapolation > 0) Cartesian3.add(world,
    Cartesian3.multiplyByScalar(to.velocity, extrapolation, new Cartesian3()), world);
  const quaternion = Quaternion.slerp(from.quaternion, to.quaternion, alpha, new Quaternion());
  const hpr = HeadingPitchRoll.fromQuaternion(quaternion, new HeadingPitchRoll());
  const cartographic = Cartographic.fromCartesian(world);
  const orientation = {
    headingDeg: (CesiumMath.toDegrees(hpr.heading) + 450) % 360,
    pitchDeg: CesiumMath.toDegrees(hpr.pitch), rollDeg: CesiumMath.toDegrees(hpr.roll),
  };
  const kinematics = { ...to.kinematics, ...orientation };
  for (const field of ['eastMps', 'northMps', 'upMps', 'speedMps', 'speedKmh']) {
    if (Number.isFinite(from.kinematics[field]) && Number.isFinite(to.kinematics[field])) {
      kinematics[field] = from.kinematics[field]
        + (to.kinematics[field] - from.kinematics[field]) * alpha;
    }
  }
  const result = { worldPosition: world, quaternion, kinematics,
    position: { lat: CesiumMath.toDegrees(cartographic.latitude),
      lng: CesiumMath.toDegrees(cartographic.longitude), altitudeM: cartographic.height },
    diagnostics: { previousPhysicsTime: from.time, currentPhysicsTime: to.time,
      interpolationAlpha: alpha, interpolationDurationMs: duration * 1000,
      physicsIntervalMs: duration * 1000, extrapolationMs: extrapolation * 1000 } };
  result.diagnostics.renderPosition = result.position;
  result.diagnostics.renderOrientation = orientation;
  state.result = result;
  state.resultTime = time;
  state.resultLatest = samples.at(-1);
  return result;
}

// Compatibility entry for existing deterministic callers. Advanced uses the
// same push/sample functions, driven by the existing fixed-step accumulator.
export function interpolateControllableVisualState(cache, key, position, kinematics,
  simulationTime, renderTimeMs, paused = false) {
  const state = pushVisualSnapshot(cache, key, position, kinematics, simulationTime);
  if (!state.clock) state.clock = { origin: simulationTime - renderTimeMs / 1000, pauseMs: null };
  if (paused) {
    state.clock.pauseMs ??= state.clock.lastMs ?? renderTimeMs;
    return state.result ?? sampleVisualState(cache, key, simulationTime);
  }
  if (state.clock.pauseMs != null) {
    state.clock.origin -= (renderTimeMs - state.clock.pauseMs) / 1000;
    state.clock.pauseMs = null;
  }
  state.clock.lastMs = renderTimeMs;
  return sampleVisualState(cache, key, state.clock.origin + renderTimeMs / 1000 - VISUAL_DELAY_SEC);
}
