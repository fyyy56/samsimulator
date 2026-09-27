import { LAUNCH_MODE } from '../data/launchProfiles.js';
import { SIMPLE_FLIGHT_PHASE } from './interceptorAltitudePhysics.js';

export const INTERCEPTOR_LAUNCH_PHASE = Object.freeze({
  PRE_LAUNCH: 'PRE_LAUNCH',
  LAUNCH_EXIT: 'LAUNCH_EXIT',
  PITCH_OVER: 'PITCH_OVER',
  GUIDANCE: 'GUIDANCE',
});

const clamp01 = value => Math.max(0, Math.min(1, value));
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const moveToward = (value, target, maximumDelta) => (
  value < target
    ? Math.min(value + maximumDelta, target)
    : Math.max(value - maximumDelta, target)
);

export function getInterceptorLaunchPhase(interceptor, flightTime = interceptor.flightTime ?? 0) {
  const launchProfile = interceptor.launchProfile;
  if (!launchProfile) return INTERCEPTOR_LAUNCH_PHASE.GUIDANCE;
  if (launchProfile.coldLaunch) {
    if (interceptor.coldLaunchPhase === 'EJECT') return INTERCEPTOR_LAUNCH_PHASE.LAUNCH_EXIT;
    const pitchErrorDeg = Math.abs(
      (interceptor.pitchOverFlightPathAngleDeg ?? 0) - (interceptor.flightPathAngleDeg ?? 90),
    );
    if (flightTime < (launchProfile.guidanceEnableDelaySec ?? 0)
      || pitchErrorDeg > (launchProfile.coldLaunch.orientToleranceDeg ?? 10)) {
      return INTERCEPTOR_LAUNCH_PHASE.PITCH_OVER;
    }
    return INTERCEPTOR_LAUNCH_PHASE.GUIDANCE;
  }
  if (launchProfile.launchMode !== LAUNCH_MODE.VERTICAL) {
    return flightTime < Math.max(0.1, launchProfile.visualDepartureDurationSec ?? 0.5)
      ? INTERCEPTOR_LAUNCH_PHASE.LAUNCH_EXIT
      : INTERCEPTOR_LAUNCH_PHASE.GUIDANCE;
  }
  const exitDurationSec = Math.max(0.1, launchProfile.verticalDepartureDurationSec ?? 0.5);
  if (flightTime < exitDurationSec) return INTERCEPTOR_LAUNCH_PHASE.LAUNCH_EXIT;
  // Pitch-over controls the launch attitude for a bounded interval. Any
  // residual angle is handed to the normal, G-limited autopilot rather than
  // keeping target guidance disabled until an arbitrary angle tolerance.
  return flightTime < exitDurationSec + Math.max(0.1,
    launchProfile.turnToTargetDurationSec ?? 0.6)
    ? INTERCEPTOR_LAUNCH_PHASE.PITCH_OVER
    : INTERCEPTOR_LAUNCH_PHASE.GUIDANCE;
}

export function advanceVerticalLaunchDeparture({
  interceptor,
  flight,
  deltaTimeSec,
  launchPhase,
}) {
  const pathDistanceM = Math.max(0, flight.travelDistanceKm * 1000);
  const initialFlightPathAngleDeg = interceptor.launchProfile?.launchMode === LAUNCH_MODE.VERTICAL
    ? 90 : interceptor.launchProfile?.launchTubeElevationDeg ?? 0;
  const targetFlightPathAngleDeg = Math.max(0, interceptor.pitchOverFlightPathAngleDeg ?? 0);
  const currentFlightPathAngleDeg = interceptor.flightPathAngleDeg ?? initialFlightPathAngleDeg;
  const maximumRateDegPerSec = Math.max(5,
    interceptor.launchProfile?.pitchOverMaxTurnRateDegPerSec ?? 35);
  const angularAccelerationDegPerSec2 = Math.max(10,
    interceptor.launchProfile?.pitchOverAngularAccelerationDegPerSec2 ?? 60);
  const angleErrorDeg = targetFlightPathAngleDeg - currentFlightPathAngleDeg;
  const desiredAngularRateDegPerSec = launchPhase === INTERCEPTOR_LAUNCH_PHASE.PITCH_OVER
    ? clamp(angleErrorDeg * 2.2, -maximumRateDegPerSec, maximumRateDegPerSec)
    : 0;
  const previousAngularRateDegPerSec = interceptor.pitchOverAngularRateDegPerSec ?? 0;
  const angularRateDegPerSec = moveToward(
    previousAngularRateDegPerSec,
    desiredAngularRateDegPerSec,
    angularAccelerationDegPerSec2 * Math.max(deltaTimeSec, 0),
  );
  const proposedAngleDeg = currentFlightPathAngleDeg + angularRateDegPerSec * deltaTimeSec;
  const overshot = Math.sign(targetFlightPathAngleDeg - currentFlightPathAngleDeg)
    !== Math.sign(targetFlightPathAngleDeg - proposedAngleDeg);
  const flightPathAngleDeg = launchPhase === INTERCEPTOR_LAUNCH_PHASE.LAUNCH_EXIT
    ? initialFlightPathAngleDeg
    : overshot ? targetFlightPathAngleDeg : proposedAngleDeg;
  const pitchRad = flightPathAngleDeg * Math.PI / 180;
  const horizontalShare = Math.max(0, Math.cos(pitchRad));
  const verticalShare = Math.sin(pitchRad);
  const verticalTravelM = pathDistanceM * verticalShare;

  return {
    altitudeM: Math.max(0, (interceptor.altitudeM ?? 0) + verticalTravelM),
    verticalSpeedMps: deltaTimeSec > 0 ? verticalTravelM / deltaTimeSec : 0,
    horizontalDistanceKm: pathDistanceM * horizontalShare / 1000,
    flightPathAngleDeg,
    flightPhase: launchPhase === INTERCEPTOR_LAUNCH_PHASE.LAUNCH_EXIT
      ? SIMPLE_FLIGHT_PHASE.LAUNCH
      : SIMPLE_FLIGHT_PHASE.CLIMB,
    pitchOverProgress: clamp01(Math.abs((initialFlightPathAngleDeg - flightPathAngleDeg)
      / Math.max(Math.abs(initialFlightPathAngleDeg - targetFlightPathAngleDeg), 0.001))),
    pitchOverAngularRateDegPerSec: overshot ? 0 : angularRateDegPerSec,
  };
}
