export const INTERCEPTOR_PHASE = Object.freeze({
  POWERED: 'POWERED',
  COAST: 'COAST',
});

export function advanceInterceptorFlight(interceptor, deltaTimeSec, physics) {
  const nextFlightTime = interceptor.flightTime + deltaTimeSec;
  const poweredDurationSec = Math.max(
    0,
    Math.min(nextFlightTime, physics.motorBurnTimeSec) - interceptor.flightTime,
  );
  const coastDurationSec = deltaTimeSec - poweredDurationSec;
  const poweredSpeedKmh = Math.min(
    physics.maxSpeedKmh,
    interceptor.speedKmh + physics.poweredAccelerationKmhPerSec * poweredDurationSec,
  );

  // Stable integration of dv/dt = -k * v² / referenceSpeed.
  // Fast interceptors initially shed energy faster, then decelerate more gently.
  const dragFactor = 1 + physics.quadraticDragPerSecond
    * (poweredSpeedKmh / physics.dragReferenceSpeedKmh)
    * coastDurationSec;
  const nextSpeedKmh = poweredSpeedKmh / dragFactor;
  const phase = nextFlightTime <= physics.motorBurnTimeSec
    ? INTERCEPTOR_PHASE.POWERED
    : INTERCEPTOR_PHASE.COAST;

  const poweredDistanceKm = ((interceptor.speedKmh + poweredSpeedKmh) / 2 / 3600)
    * poweredDurationSec;
  const coastDistanceKm = ((poweredSpeedKmh + nextSpeedKmh) / 2 / 3600)
    * coastDurationSec;
  const travelDistanceKm = poweredDistanceKm + coastDistanceKm;
  const distanceTraveledKm = interceptor.distanceTraveledKm + travelDistanceKm;
  const terminated = nextFlightTime >= physics.maxFlightTimeSec
    || distanceTraveledKm >= physics.maxGameRangeKm
    || (phase === INTERCEPTOR_PHASE.COAST
      && nextSpeedKmh < physics.minimumEffectiveSpeedKmh);

  return {
    phase,
    speedKmh: nextSpeedKmh,
    flightTime: nextFlightTime,
    distanceTraveledKm,
    travelDistanceKm,
    terminated,
  };
}
