export const SIMPLE_FLIGHT_PHASE = Object.freeze({
  LAUNCH: 'LAUNCH',
  CLIMB: 'CLIMB',
  CRUISE: 'CRUISE',
  TERMINAL: 'TERMINAL',
});

export function advanceSimpleAltitude({ interceptor, targetAltitudeM, deltaTimeSec, travelDistanceKm, physics }) {
  const currentAltitudeM = interceptor.altitudeM ?? 0;
  const altitudeDeltaM = targetAltitudeM - currentAltitudeM;
  const maximumVerticalTravelM = physics.climbRateMps * deltaTimeSec;
  const availablePathM = travelDistanceKm * 1000;
  const verticalTravelM = Math.sign(altitudeDeltaM) * Math.min(
    Math.abs(altitudeDeltaM),
    maximumVerticalTravelM,
    availablePathM * 0.92,
  );
  const horizontalDistanceKm = Math.sqrt(Math.max(
    0,
    travelDistanceKm ** 2 - (verticalTravelM / 1000) ** 2,
  ));
  const altitudeM = Math.max(0, currentAltitudeM + verticalTravelM);

  let flightPhase = SIMPLE_FLIGHT_PHASE.CRUISE;
  if (interceptor.flightTime <= physics.launchPhaseDurationSec) {
    flightPhase = SIMPLE_FLIGHT_PHASE.LAUNCH;
  } else if (interceptor.guidanceState === 'TERMINAL') {
    flightPhase = SIMPLE_FLIGHT_PHASE.TERMINAL;
  } else if (Math.abs(targetAltitudeM - altitudeM) > physics.altitudeCaptureThresholdM) {
    flightPhase = SIMPLE_FLIGHT_PHASE.CLIMB;
  }

  return {
    altitudeM,
    verticalSpeedMps: deltaTimeSec > 0 ? verticalTravelM / deltaTimeSec : 0,
    horizontalDistanceKm,
    flightPhase,
  };
}

export const INTERCEPTOR_PHYSICS_PROFILES = Object.freeze({
  BASIC: {
    id: 'BASIC',
    advanceAltitude: advanceSimpleAltitude,
  },
  ADVANCED: {
    id: 'ADVANCED',
    advanceAltitude: null,
  },
});
