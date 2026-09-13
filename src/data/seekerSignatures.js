/** Normalized gameplay IR signatures. These are not temperatures or real sensor data. */
export const IR_SEEKER_SIGNATURES = Object.freeze({
  GERBERA: 0.28,
  GERAN_2: 0.48,
  KH_555: 0.68,
  KALIBR: 0.72,
  ISKANDER_M: 0.58,
  UAV_TARGET: 0.4,
  CRUISE_TARGET: 0.68,
  BALLISTIC_TARGET: 0.58,
  DEFAULT: 0.45,
});

const POWERED_PHASES = new Set(['BOOST', 'POWERED', 'LAUNCH']);

export function getGameplayIrSignature(target) {
  const baseSignature = target?.seekerIrSignature
    ?? IR_SEEKER_SIGNATURES[target?.modelId]
    ?? IR_SEEKER_SIGNATURES[target?.type]
    ?? IR_SEEKER_SIGNATURES.DEFAULT;
  const phase = target?.ballisticPhysics?.phase ?? target?.motorPhase ?? target?.flightPhase;
  if (POWERED_PHASES.has(phase)) return Math.min(1, baseSignature + 0.34);
  return Math.max(0, Math.min(1, baseSignature));
}
