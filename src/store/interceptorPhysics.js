import { MOTOR_PHASE } from '../data/interceptors.js';

export const INTERCEPTOR_PHASE = Object.freeze({
  POWERED: 'POWERED',
  COAST: 'COAST',
});

export const INTERCEPTOR_KINEMATIC_PHASE = Object.freeze({
  BOOST: 'BOOST',
  MIDCOURSE: 'MIDCOURSE',
  TERMINAL: 'TERMINAL',
});

export const INTERCEPTOR_ENERGY_STATE = Object.freeze({
  GOOD: 'ENERGY_GOOD',
  LOW: 'ENERGY_LOW',
  CRITICAL: 'ENERGY_CRITICAL',
});

const AIR_DENSITY_PROFILE = Object.freeze([
  { altitudeM: 0, multiplier: 1 },
  { altitudeM: 2_000, multiplier: 0.82 },
  { altitudeM: 5_000, multiplier: 0.6 },
  { altitudeM: 10_000, multiplier: 0.35 },
  { altitudeM: 15_000, multiplier: 0.2 },
  { altitudeM: 20_000, multiplier: 0.11 },
  { altitudeM: 30_000, multiplier: 0.045 },
]);

export function getAirDensityMultiplier(altitudeM = 0) {
  const boundedAltitudeM = Math.max(0, altitudeM);
  const upperIndex = AIR_DENSITY_PROFILE.findIndex(point => point.altitudeM >= boundedAltitudeM);
  if (upperIndex <= 0) return AIR_DENSITY_PROFILE[Math.max(0, upperIndex)].multiplier;
  if (upperIndex === -1) return AIR_DENSITY_PROFILE.at(-1).multiplier;
  const lower = AIR_DENSITY_PROFILE[upperIndex - 1];
  const upper = AIR_DENSITY_PROFILE[upperIndex];
  const fraction = (boundedAltitudeM - lower.altitudeM) / (upper.altitudeM - lower.altitudeM);
  return lower.multiplier + (upper.multiplier - lower.multiplier) * fraction;
}

const getMotorBurnTimeSec = physics => (
  physics.motorBurnTimeSec
  ?? physics.motorPhases.reduce((sum, phase) => sum + phase.durationSec, 0)
);

export function getMotorState(physics, flightTimeSec) {
  let phaseStartSec = 0;
  for (const motorPhase of physics.motorPhases) {
    const phaseEndSec = phaseStartSec + motorPhase.durationSec;
    if (flightTimeSec < phaseEndSec) {
      return {
        phase: motorPhase.id,
        accelerationMps2: motorPhase.accelerationMps2,
        phaseTimeLeftSec: phaseEndSec - flightTimeSec,
        motorTimeLeftSec: getMotorBurnTimeSec(physics) - flightTimeSec,
      };
    }
    phaseStartSec = phaseEndSec;
  }
  return {
    phase: MOTOR_PHASE.BURNOUT,
    accelerationMps2: 0,
    phaseTimeLeftSec: 0,
    motorTimeLeftSec: 0,
  };
}

const getAverageMotorAcceleration = (physics, fromTimeSec, toTimeSec) => {
  if (toTimeSec <= fromTimeSec) return 0;
  let phaseStartSec = 0;
  let accelerationIntegral = 0;
  physics.motorPhases.forEach(motorPhase => {
    const phaseEndSec = phaseStartSec + motorPhase.durationSec;
    const overlapSec = Math.max(
      0,
      Math.min(toTimeSec, phaseEndSec) - Math.max(fromTimeSec, phaseStartSec),
    );
    accelerationIntegral += overlapSec * motorPhase.accelerationMps2;
    phaseStartSec = phaseEndSec;
  });
  return accelerationIntegral / (toTimeSec - fromTimeSec);
};

export function getInterceptorEnergyState(speedMps, physics) {
  const ratio = speedMps / Math.max(physics.minimumEffectiveSpeedMps, 1);
  if (ratio < 1) return INTERCEPTOR_ENERGY_STATE.CRITICAL;
  if (ratio < 1.55) return INTERCEPTOR_ENERGY_STATE.LOW;
  return INTERCEPTOR_ENERGY_STATE.GOOD;
}

export function getEffectiveTurnPerformance(interceptor, physics, isTerminal = false) {
  const baseTurnRateDegPerSec = isTerminal
    ? physics.terminalTurnRateDegPerSec
    : physics.turnRateDegPerSec;
  const speedMps = interceptor.speedMps ?? interceptor.speedKmh / 3.6;
  const energyRatio = interceptor.energyRatio
    ?? getEnergyRatio(speedMps, physics);
  const energyFactor = Math.max(0.18, Math.min(1, 0.35 + 0.65 * Math.sqrt(energyRatio)));
  const speedFactor = Math.max(0.18, Math.min(
    1,
    speedMps / Math.max(physics.maneuverReferenceSpeedMps, 1),
  ));
  const effectiveTurnRateDegPerSec = baseTurnRateDegPerSec * energyFactor * speedFactor;
  const angularRateRadPerSec = effectiveTurnRateDegPerSec * Math.PI / 180;
  const turnRadiusKm = angularRateRadPerSec > 0
    ? speedMps / angularRateRadPerSec / 1000
    : Number.POSITIVE_INFINITY;
  return {
    baseTurnRateDegPerSec,
    effectiveTurnRateDegPerSec,
    energyFactor,
    speedFactor,
    turnRadiusKm,
  };
}

const getEnergyRatio = (speedMps, physics) => Math.max(
  0,
  Math.min(1, (speedMps / Math.max(physics.maxSpeedMps, 1)) ** 2),
);

export function applyAltitudeEnergyExchange(
  flight,
  altitudeDeltaM,
  deltaTimeSec,
  physics,
) {
  if (!(deltaTimeSec > 0) || altitudeDeltaM === 0) {
    return { ...flight, altitudeEnergyLossMps2: 0, energyRatio: getEnergyRatio(flight.speedMps, physics) };
  }
  const verticalSpeedMps = altitudeDeltaM / deltaTimeSec;
  const gravityMps2 = 9.81;
  const climbFactor = physics.climbEnergyLossFactor ?? 1;
  const descentRecovery = physics.descentEnergyRecoveryFactor ?? 0.35;
  const pathSpeedMps = Math.max(flight.speedMps, Math.abs(verticalSpeedMps), 50);
  const gravityAlongPathMps2 = gravityMps2 * Math.abs(verticalSpeedMps) / pathSpeedMps;
  const altitudeAccelerationMps2 = verticalSpeedMps > 0
    ? -gravityAlongPathMps2 * climbFactor
    : gravityAlongPathMps2 * descentRecovery;
  const adjustedSpeedMps = Math.max(
    0,
    Math.min(physics.maxSpeedMps, flight.speedMps + altitudeAccelerationMps2 * deltaTimeSec),
  );
  const adjustedSpeedKmh = adjustedSpeedMps * 3.6;
  const energyState = getInterceptorEnergyState(adjustedSpeedMps, physics);
  const criticalEnergyTimeSec = energyState === INTERCEPTOR_ENERGY_STATE.CRITICAL
    ? flight.criticalEnergyTimeSec
    : 0;
  return {
    ...flight,
    speedMps: adjustedSpeedMps,
    speedKmh: adjustedSpeedKmh,
    currentAccelerationMps2: flight.currentAccelerationMps2 + altitudeAccelerationMps2,
    altitudeEnergyLossMps2: Math.max(0, -altitudeAccelerationMps2),
    descentEnergyRecoveryMps2: Math.max(0, altitudeAccelerationMps2),
    energyState,
    energyRatio: getEnergyRatio(adjustedSpeedMps, physics),
    criticalEnergyTimeSec,
  };
}

export function advanceInterceptorFlight(
  interceptor,
  deltaTimeSec,
  physics,
  {
    headingChangeDeg = 0,
    headingCorrectionDeg = headingChangeDeg,
    altitudeM = interceptor.altitudeM ?? 0,
  } = {},
) {
  const nextFlightTime = interceptor.flightTime + deltaTimeSec;
  const currentSpeedMps = Math.max(0, interceptor.speedKmh / 3.6);
  const motorAccelerationMps2 = getAverageMotorAcceleration(
    physics,
    interceptor.flightTime,
    nextFlightTime,
  );
  const speedAfterThrustMps = Math.min(
    physics.maxSpeedMps,
    currentSpeedMps + motorAccelerationMps2 * deltaTimeSec,
  );
  const densityMultiplier = getAirDensityMultiplier(altitudeM);
  const dragRatePerMeter = physics.dragCoefficientGame
    * physics.referenceAreaGame
    * densityMultiplier
    / Math.max(physics.massKg, 1);
  const dragFactor = 1 + dragRatePerMeter * speedAfterThrustMps * deltaTimeSec;
  const speedAfterDragMps = speedAfterThrustMps / dragFactor;
  const dragLossMps = Math.max(0, speedAfterThrustMps - speedAfterDragMps);
  const normalizedTurn = Math.min(1, Math.abs(headingChangeDeg) / 90);
  const normalizedCorrectionDemand = Math.min(1, Math.abs(headingCorrectionDeg) / 90);
  const normalizedSpeed = speedAfterDragMps / Math.max(physics.maxSpeedMps, 1);
  const highAngleTurnLossMultiplier = 1
    + ((physics.highAngleTurnLossMultiplier ?? 1) - 1) * normalizedCorrectionDemand ** 1.5;
  const turnLossMps = speedAfterDragMps
    * physics.turnEnergyLossFactor
    * normalizedTurn
    * normalizedSpeed ** 1.2
    * highAngleTurnLossMultiplier;
  const nextSpeedMps = Math.max(0, speedAfterDragMps - turnLossMps);
  const nextSpeedKmh = nextSpeedMps * 3.6;
  const averageSpeedKmh = (interceptor.speedKmh + nextSpeedKmh) / 2;
  const travelDistanceKm = averageSpeedKmh * deltaTimeSec / 3600;
  const distanceTraveledKm = interceptor.distanceTraveledKm + travelDistanceKm;
  const motor = getMotorState(physics, nextFlightTime);
  const phase = motor.motorTimeLeftSec > 0
    ? INTERCEPTOR_PHASE.POWERED
    : INTERCEPTOR_PHASE.COAST;
  const energyState = getInterceptorEnergyState(nextSpeedMps, physics);
  const criticalEnergyTimeSec = energyState === INTERCEPTOR_ENERGY_STATE.CRITICAL
    ? (interceptor.criticalEnergyTimeSec ?? 0) + deltaTimeSec
    : 0;
  const terminated = nextFlightTime >= physics.maxFlightTimeSec
    || criticalEnergyTimeSec >= physics.criticalEnergyGraceSec;

  return {
    phase,
    motorPhase: motor.phase,
    motorTimeLeftSec: motor.motorTimeLeftSec,
    motorPhaseTimeLeftSec: motor.phaseTimeLeftSec,
    speedKmh: nextSpeedKmh,
    speedMps: nextSpeedMps,
    flightTime: nextFlightTime,
    distanceTraveledKm,
    travelDistanceKm,
    densityMultiplier,
    motorAccelerationMps2,
    dragDecelerationMps2: deltaTimeSec > 0 ? dragLossMps / deltaTimeSec : 0,
    turnLossMps2: deltaTimeSec > 0 ? turnLossMps / deltaTimeSec : 0,
    headingCorrectionDeg,
    highAngleTurnLossMultiplier,
    currentAccelerationMps2: deltaTimeSec > 0
      ? (nextSpeedMps - currentSpeedMps) / deltaTimeSec
      : 0,
    energyState,
    energyRatio: getEnergyRatio(nextSpeedMps, physics),
    criticalEnergyTimeSec,
    terminated,
  };
}
