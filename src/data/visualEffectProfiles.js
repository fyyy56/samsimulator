export const MISSILE_TRAIL_VISUAL_PROFILE = Object.freeze({
  lifetimeMs: 10_000,
  farZoom: 4,
  closeZoom: 11,
  farScale: 0.38,
  closeScale: 1.12,
  farOpacity: 0.42,
  closeOpacity: 1,
  advancedNearDistanceM: 8_000,
  advancedFarDistanceM: 420_000,
  advancedSampleIntervalMs: 320,
  advancedMaxPuffs: 256,
});

// Visual-only tuning; propulsion remains authoritative in the simulation.
export const MISSILE_PLUME_PHASE_PROFILE = Object.freeze({
  BOOST: Object.freeze({ size: 1, opacity: 0.42, glowPixels: 10, lineWidth: 3 }),
  SUSTAIN: Object.freeze({ size: 0.68, opacity: 0.28, glowPixels: 6, lineWidth: 2 }),
});

export const getMissilePlumeProfile = entity => {
  // An explicit burnout must win over stale presentation/kinematic fields.
  const phase = entity.motorPhase ?? entity.motorState;
  if (phase != null) return MISSILE_PLUME_PHASE_PROFILE[phase] ?? null;
  return entity.phase === 'POWERED' || entity.kinematicPhase === 'BOOST'
    ? MISSILE_PLUME_PHASE_PROFILE.BOOST : null;
};

export const INTERCEPT_EFFECT_VISUAL_PROFILE = Object.freeze({
  flashDurationMs: 180,
  fireDurationMs: 680,
  smokeDurationMs: 3_600,
  totalDurationMs: 3_800,
});
