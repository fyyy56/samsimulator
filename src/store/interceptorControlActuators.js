// Bounded game actuators, not a hardware/6DOF model. Guidance supplies the same
// estimated correction as before; this module only changes its response.
const RAD = Math.PI / 180;
const zero = () => ({ eastMps: 0, northMps: 0, upMps: 0 });
const scale = (v, n) => ({ eastMps: v.eastMps * n, northMps: v.northMps * n, upMps: v.upMps * n });
const add = (a, b) => ({ eastMps: a.eastMps + b.eastMps,
  northMps: a.northMps + b.northMps, upMps: a.upMps + b.upMps });
const subtract = (a, b) => add(a, scale(b, -1));
const dot = (a, b) => a.eastMps * b.eastMps + a.northMps * b.northMps + a.upMps * b.upMps;
const length = v => Math.hypot(v.eastMps, v.northMps, v.upMps);
const unit = v => scale(v, 1 / Math.max(length(v), 1e-9));
const limit = (v, max) => scale(v, Math.min(1, max / Math.max(length(v), 1e-9)));
const lateral = (v, axis) => subtract(v, scale(axis, dot(v, axis)));
const mix = (a, b, alpha) => add(scale(a, 1 - alpha), scale(b, alpha));
const clamp01 = n => Math.max(0, Math.min(1, n));
const response = (dt, seconds) => 1 - Math.exp(-dt / Math.max(seconds, 0.001));
const angleDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) / RAD;
const headingPitch = v => ({
  bodyHeadingDeg: (Math.atan2(v.eastMps, v.northMps) / RAD + 360) % 360,
  bodyPitchDeg: Math.atan2(v.upMps, Math.hypot(v.eastMps, v.northMps)) / RAD,
});

function correctionNeed(command, context, physics, config, speedMps) {
  const tgo = context?.timeToGoSec;
  const miss = command.predictedClosestApproachM;
  const contactM = Math.max(physics.proximityFuseRadiusM ?? 1, 1);
  if (!context?.terminal || context.solutionStatus === 'INVALID'
    || !(command.closingSpeedMps > 0) || !(tgo > 0.12) || !Number.isFinite(tgo)
    || !Number.isFinite(miss) || speedMps < physics.minimumEffectiveSpeedMps
    || Math.abs(context.directionErrorDeg ?? 0) > config.maxCorrectionAngleDeg) return 0;
  // Miss and demand gates, rather than an arbitrary fixed terminal countdown.
  const correctionAccel = 2 * Math.max(0, miss - contactM * 0.5) / (tgo * tgo);
  const demand = correctionAccel / Math.max(command.availableAccelerationMps2, 1);
  if (demand > 1.08) return 0; // no rescue of an unreachable geometry
  return clamp01((miss / contactM - 0.5) / 1.5)
    * clamp01(demand / config.correctionDemandRatio);
}

export function advanceControlActuators({ interceptor, command, context, physics,
  deltaTimeSec: dt, velocityUnit, speedMps, aerodynamicAcceleration }) {
  const config = physics.controlActuators;
  if (!config?.enabled || !(dt > 0)) return null;
  const previous = interceptor.controlActuators;
  const demand = lateral(command.commandedAccelerationVectorMps2, velocityUnit);
  const available = command.availableAccelerationMps2;
  const need = correctionNeed(command, context, physics, config, speedMps);
  const state = { ...previous, kind: config.kind, pifAccelerationVectorMps2: zero(),
    pifIntensity: 0, pifActive: false, attitudeActive: context?.terminal === true };
  let aero = aerodynamicAcceleration;
  let bodyDirection = previous?.bodyDirection ?? velocityUnit;

  if (config.kind === 'PIF_PAF') {
    const remaining = previous?.pifResourceRemainingMps ?? config.resourceMps;
    // Fill only the useful lag in the existing command. PIF is not extra max G.
    const residual = subtract(demand, aero);
    const useful = length(demand) > 0 && dot(residual, demand) > 0;
    const requested = useful && need > 0 && remaining > 0
      ? scale(limit(residual, config.maxLateralAccelerationMps2), need) : zero();
    const oldPif = lateral(previous?.pifAccelerationVectorMps2 ?? zero(), velocityUnit);
    let pif = mix(oldPif, requested, response(dt, config.responseTimeSec));
    if (!useful) pif = scale(pif, 1 - response(dt, config.responseTimeSec));
    // Keep the resultant inside the existing authority and requested correction.
    const headroom = Math.max(0, Math.min(available, length(demand)) - length(aero));
    pif = limit(pif, Math.min(headroom, remaining / dt, config.maxLateralAccelerationMps2));
    if (dot(pif, demand) <= 0) pif = zero();
    state.pifAccelerationVectorMps2 = pif;
    state.pifResourceRemainingMps = Math.max(0, remaining - length(pif) * dt);
    state.pifIntensity = length(pif) / config.maxLateralAccelerationMps2;
    state.pifActive = state.pifIntensity > 0.002;
  } else if (config.kind === 'ACM_ATTITUDE' && state.attitudeActive) {
    const maxTilt = Math.tan(config.maxAngleOfAttackDeg * RAD);
    const desiredTilt = scale(demand, maxTilt / Math.max(available, 1));
    // This small body/flight-path separation is the rotational abstraction.
    // ACM adds angular rate here, never a translational acceleration.
    const oldTilt = lateral(previous?.attitudeTilt ?? scale(
      interceptor.actualAccelerationVectorMps2 ?? zero(), maxTilt / Math.max(available, 1)), velocityUnit);
    const gap = subtract(desiredTilt, oldTilt);
    let angularImpulse = lateral(previous?.acmAngularRateRadSec ?? zero(), velocityUnit);
    let remaining = previous?.acmPulsesRemaining ?? config.pulseBudget;
    const now = interceptor.flightTime ?? 0;
    const previousPulse = previous?.acmPulse;
    if (need > config.minimumNeed && remaining > 0
      && length(gap) / Math.max(maxTilt, 1e-6) > config.minimumAttitudeErrorRatio
      && now - (previousPulse?.flightTimeSec ?? -Infinity) >= config.pulseCooldownSec) {
      const kick = limit(scale(gap, config.pulseGain / config.angularDampingTimeSec),
        config.maxAngularImpulseRadSec);
      angularImpulse = limit(add(angularImpulse, kick), config.maxAngularImpulseRadSec);
      remaining--;
      state.acmPulse = { id: (previousPulse?.id ?? 0) + 1, flightTimeSec: now,
        durationSec: config.pulseDurationSec, direction: unit(kick),
        intensity: clamp01(length(kick) / config.maxAngularImpulseRadSec) };
    }
    const decay = Math.exp(-dt / config.angularDampingTimeSec);
    const impulseTilt = scale(angularImpulse, config.angularDampingTimeSec * (1 - decay));
    const normalTilt = mix(oldTilt, desiredTilt, response(dt, config.attitudeResponseTimeSec));
    const tilt = limit(add(normalTilt, impulseTilt), maxTilt);
    bodyDirection = unit(add(velocityUnit, tilt));
    const lift = limit(scale(tilt, available / Math.max(maxTilt, 1e-6)), available);
    const oldAero = lateral(previous?.aerodynamicAccelerationVectorMps2
      ?? interceptor.actualAccelerationVectorMps2 ?? zero(), velocityUnit);
    aero = limit(mix(oldAero, lift, response(dt, config.aerodynamicResponseTimeSec)), available);
    state.attitudeTilt = tilt;
    state.acmAngularRateRadSec = scale(angularImpulse, decay);
    state.acmPulsesRemaining = remaining;
  } else if (config.kind === 'ACM_ATTITUDE') {
    // Midcourse keeps the unmodified shared autopilot; no ACM or second lag.
    state.attitudeTilt = scale(aero, Math.tan(config.maxAngleOfAttackDeg * RAD) / Math.max(available, 1));
    state.acmAngularRateRadSec = zero();
    state.acmPulsesRemaining = previous?.acmPulsesRemaining ?? config.pulseBudget;
    bodyDirection = velocityUnit;
  }
  state.bodyDirection = bodyDirection;
  state.aerodynamicAccelerationVectorMps2 = aero;
  state.aerodynamicAccelerationMps2 = length(aero);
  return state;
}

export function finishControlAttitude({ state, interceptor, physics, velocityUnit,
  nextDirection, speedMps, deltaTimeSec: dt }) {
  const config = physics.controlActuators;
  let body = state.bodyDirection;
  if (config.kind === 'ACM_ATTITUDE' && !state.attitudeActive) body = nextDirection;
  if (config.kind === 'PIF_PAF') {
    body = unit(mix(body, nextDirection, response(dt, config.attitudeResponseTimeSec)));
    const error = angleDeg(body, nextDirection);
    if (error > config.maxAngleOfAttackDeg) body = unit(mix(nextDirection, body,
      config.maxAngleOfAttackDeg / error));
  }
  const attitude = headingPitch(body);
  const previousHeading = interceptor.controlActuators?.bodyHeadingDeg ?? interceptor.heading;
  const previousPitch = interceptor.controlActuators?.bodyPitchDeg ?? interceptor.flightPathAngleDeg ?? 0;
  const aeroDirection = unit(add(scale(velocityUnit, speedMps),
    scale(state.aerodynamicAccelerationVectorMps2, dt)));
  return { ...state, ...attitude, bodyDirection: body,
    bodyYawRateDegPerSec: (((attitude.bodyHeadingDeg - previousHeading + 540) % 360) - 180) / dt,
    bodyPitchRateDegPerSec: (attitude.bodyPitchDeg - previousPitch) / dt,
    angleOfAttackDeg: angleDeg(body, nextDirection),
    aerodynamicTurnDeg: angleDeg(velocityUnit, aeroDirection) };
}
