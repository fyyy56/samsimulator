import { MOTOR_PHASE } from '../data/interceptors.js';

// Generic gameplay cold-launch sequence. These thresholds are estimates, not
// parameters of any real attitude-control or ejection equipment.
export const COLD_LAUNCH_PHASE = Object.freeze({
  EJECT: 'EJECT',
  ORIENT: 'ORIENT',
  IGNITION: 'IGNITION',
  BOOST: 'BOOST',
  MIDCOURSE: 'MIDCOURSE',
});

export function advanceColdLaunch({ interceptor, flight, altitudeFlight }) {
  const config = interceptor.launchProfile?.coldLaunch;
  if (!config) return null;
  const phase = interceptor.coldLaunchPhase ?? COLD_LAUNCH_PHASE.EJECT;
  const flightTime = flight.flightTime;
  const launchAltitudeM = interceptor.launchWorldPosition?.altitudeM ?? 0;
  const angularErrorDeg = (interceptor.pitchOverFlightPathAngleDeg ?? 0)
    - altitudeFlight.flightPathAngleDeg;
  let nextPhase = phase;
  if (phase === COLD_LAUNCH_PHASE.EJECT
    && flightTime >= config.minimumEjectSec
    && altitudeFlight.altitudeM - launchAltitudeM >= config.ejectClearanceM) {
    nextPhase = COLD_LAUNCH_PHASE.ORIENT;
  } else if (phase === COLD_LAUNCH_PHASE.ORIENT
    && flightTime >= config.minimumIgnitionSec
    && Math.abs(angularErrorDeg) <= config.orientToleranceDeg) {
    nextPhase = COLD_LAUNCH_PHASE.IGNITION;
  } else if (phase === COLD_LAUNCH_PHASE.IGNITION
    && flightTime > (interceptor.motorIgnitedAtFlightTime ?? Infinity)) {
    nextPhase = COLD_LAUNCH_PHASE.BOOST;
  } else if (phase === COLD_LAUNCH_PHASE.BOOST
    && flight.motorPhase !== MOTOR_PHASE.BOOST) {
    nextPhase = COLD_LAUNCH_PHASE.MIDCOURSE;
  }
  const maximumRate = Math.max(1, interceptor.launchProfile.pitchOverMaxTurnRateDegPerSec);
  const angularRate = Math.abs(altitudeFlight.pitchOverAngularRateDegPerSec ?? 0);
  const attitudeJetsActive = nextPhase === COLD_LAUNCH_PHASE.ORIENT
    && angularRate > 0.1 && Math.abs(angularErrorDeg) > 0.5;
  return {
    coldLaunchPhase: nextPhase,
    motorIgnitedAtFlightTime: nextPhase === COLD_LAUNCH_PHASE.IGNITION
      ? flightTime : interceptor.motorIgnitedAtFlightTime ?? null,
    attitudeJetsActive,
    attitudeCorrectionDeg: angularErrorDeg,
    attitudeJetsIntensity: attitudeJetsActive ? Math.min(1, angularRate / maximumRate) * Math.min(1, Math.abs(angularErrorDeg) / 35) : 0,
    attitudeJetsDurationSec: attitudeJetsActive
      ? (interceptor.attitudeJetsDurationSec ?? 0) + (flightTime - interceptor.flightTime)
      : interceptor.attitudeJetsDurationSec ?? 0,
  };
}
