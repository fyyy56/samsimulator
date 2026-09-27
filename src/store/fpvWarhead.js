export const FPV_WARHEAD_RESULT = Object.freeze({
  MISS: 'MISS',
  DAMAGED: 'DAMAGED',
  DESTROYED: 'DESTROYED',
});

const clamp01 = value => Math.max(0, Math.min(1, value));

/**
 * Deterministic gameplay abstraction. The configured distances are balancing
 * values, not inferred real-world fuze or fragmentation parameters.
 */
export function resolveFpvWarhead({ closestApproachM, directContact = false, profile }) {
  if (!profile || !Number.isFinite(closestApproachM)) {
    return { detonated: false, outcome: FPV_WARHEAD_RESULT.MISS, effectiveness: 0 };
  }
  const proximityRadiusM = Math.max(0, profile.proximityRadiusM ?? 0);
  if (!directContact && closestApproachM > proximityRadiusM) {
    return { detonated: false, outcome: FPV_WARHEAD_RESULT.MISS, effectiveness: 0 };
  }
  const effectiveness = directContact
    ? 1
    : Math.pow(clamp01(1 - closestApproachM / Math.max(0.001, proximityRadiusM)),
      Math.max(0.1, profile.falloffExponent ?? 1));
  const outcome = directContact || effectiveness >= (profile.destroyThreshold ?? 0.65)
    ? FPV_WARHEAD_RESULT.DESTROYED
    : effectiveness >= (profile.damageThreshold ?? 0.2)
      ? FPV_WARHEAD_RESULT.DAMAGED
      : FPV_WARHEAD_RESULT.MISS;
  return {
    detonated: true,
    outcome,
    effectiveness,
    closestApproachM,
    directContact,
    warheadId: profile.id,
  };
}
