import { LAUNCH_MODE } from '../data/launchProfiles.js';
import { SIMPLE_FLIGHT_PHASE } from './interceptorAltitudePhysics.js';

export const INTERCEPTOR_LAUNCH_PHASE = Object.freeze({
  PRE_LAUNCH: 'PRE_LAUNCH',
  LAUNCH_EXIT: 'LAUNCH_EXIT',
  PITCH_OVER: 'PITCH_OVER',
  GUIDANCE: 'GUIDANCE',
});

const clamp01 = value => Math.max(0, Math.min(1, value));

export function getInterceptorLaunchPhase(interceptor, flightTime = interceptor.flightTime ?? 0) {
  const launchProfile = interceptor.launchProfile;
  if (!launchProfile) return INTERCEPTOR_LAUNCH_PHASE.GUIDANCE;
  if (launchProfile.launchMode !== LAUNCH_MODE.VERTICAL) {
    return flightTime < Math.max(0.1, launchProfile.visualDepartureDurationSec ?? 0.5)
      ? INTERCEPTOR_LAUNCH_PHASE.LAUNCH_EXIT
      : INTERCEPTOR_LAUNCH_PHASE.GUIDANCE;
  }

  const verticalExitDurationSec = Math.max(
    0.1,
    launchProfile.verticalDepartureDurationSec ?? 0.5,
  );
  if (flightTime < verticalExitDurationSec) return INTERCEPTOR_LAUNCH_PHASE.LAUNCH_EXIT;
  const pitchOverDurationSec = Math.max(0.1, launchProfile.turnToTargetDurationSec ?? 0.6);
  if (flightTime < verticalExitDurationSec + pitchOverDurationSec) {
    return INTERCEPTOR_LAUNCH_PHASE.PITCH_OVER;
  }
  return INTERCEPTOR_LAUNCH_PHASE.GUIDANCE;
}

export function advanceVerticalLaunchDeparture({
  interceptor,
  flight,
  deltaTimeSec,
  launchPhase,
}) {
  const pathDistanceM = Math.max(0, flight.travelDistanceKm * 1000);
  const verticalExitDurationSec = Math.max(
    0.1,
    interceptor.launchProfile?.verticalDepartureDurationSec ?? 0.5,
  );
  const pitchOverDurationSec = Math.max(
    0.1,
    interceptor.launchProfile?.turnToTargetDurationSec ?? 0.6,
  );
  const pitchProgress = launchPhase === INTERCEPTOR_LAUNCH_PHASE.PITCH_OVER
    ? clamp01(((interceptor.flightTime ?? 0) - verticalExitDurationSec) / pitchOverDurationSec)
    : 0;
  const easedPitchProgress = pitchProgress * pitchProgress * (3 - 2 * pitchProgress);
  const targetFlightPathAngleDeg = interceptor.pitchOverFlightPathAngleDeg ?? 0;
  const flightPathAngleDeg = launchPhase === INTERCEPTOR_LAUNCH_PHASE.LAUNCH_EXIT
    ? 90
    : 90 + (targetFlightPathAngleDeg - 90) * easedPitchProgress;
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
    pitchOverProgress: easedPitchProgress,
  };
}
