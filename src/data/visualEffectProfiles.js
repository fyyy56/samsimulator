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
  advancedSampleIntervalMs: 40,
  advancedMaxPuffs: 1024,
  advancedSmokeLifetimeMs: 6200,
  advancedMaxStrands: 12,
});

// Visual-only tuning; propulsion remains authoritative in the simulation.
export const MISSILE_PLUME_PHASE_PROFILE = Object.freeze({
  BOOST: Object.freeze({ size: 1.7, opacity: 0.7, glowPixels: 18, lineWidth: 5, heat: 1 }),
  SUSTAIN: Object.freeze({ size: 0.94, opacity: 0.38, glowPixels: 9, lineWidth: 3, heat: 0.52 }),
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

// Neutral defaults preserve the existing overlapping world-space smoke exactly.
const smokeProfile = overrides => Object.freeze({
  widthScale: 1, opacityScale: 1, emissionRateScale: 1, expansionScale: 1,
  lifetimeMs: 6200, turbulenceScale: 1, expansionExponent: .7, fadeExponent: 1.4,
  ...overrides,
});
export const MISSILE_SMOKE_PROFILES = Object.freeze({
  CURRENT: smokeProfile({}),
  THIN_DENSE: smokeProfile({ widthScale: .75, opacityScale: 1.15, expansionScale: .8 }),
  WIDE_DENSE: smokeProfile({ widthScale: 1.3, opacityScale: 1.15, emissionRateScale: 1.2 }),
  MEDIUM_LIGHT: smokeProfile({ opacityScale: .65 }),
  // Separate tuning slot; retain the smoke the user has already approved.
  TOR: smokeProfile({}),
});
export const getMissileSmokeProfile = entity => MISSILE_SMOKE_PROFILES[
  entity.interceptorSpecId === 'INT-9M331-V1' ? 'TOR' : 'CURRENT'
];
