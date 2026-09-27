import { getEffectiveTurnPerformance } from './interceptorPhysics.js';
import { applyMissileAutopilot, normalizeHeadingDelta, velocityFromFlightPath } from './missileGuidanceCore.js';
import { getBearing, getDestinationPoint, getDistanceKm } from './geo.js';

const DEG_TO_RAD = Math.PI / 180;
const GRAVITY_MPS2 = 9.81;
export const TOR_MANUAL_COMMAND_HOLD_SEC = 3;

function directionToSightLine(interceptor, sight, speedMps) {
  const origin = sight.origin;
  if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) {
    return { heading: sight.azimuthDeg, pitch: sight.elevationDeg };
  }
  const distanceFromStationM = getDistanceKm(origin.lat, origin.lng,
    interceptor.lat, interceptor.lng) * 1000;
  const bearingFromStation = getBearing(origin.lat, origin.lng,
    interceptor.lat, interceptor.lng);
  const alongSightM = distanceFromStationM * Math.cos(
    normalizeHeadingDelta(bearingFromStation - sight.azimuthDeg) * DEG_TO_RAD);
  const lookAheadM = Math.max(250, Math.min(1100, speedMps * 1.2));
  const sightDistanceM = Math.max(200, alongSightM + lookAheadM);
  const aimPoint = getDestinationPoint(origin.lat, origin.lng,
    sight.azimuthDeg, sightDistanceM / 1000);
  const horizontalToAimM = getDistanceKm(interceptor.lat, interceptor.lng,
    aimPoint.lat, aimPoint.lng) * 1000;
  const sightAltitudeM = origin.altitudeM
    + Math.tan(sight.elevationDeg * DEG_TO_RAD) * sightDistanceM;
  return {
    heading: getBearing(interceptor.lat, interceptor.lng, aimPoint.lat, aimPoint.lng),
    pitch: Math.atan2(sightAltitudeM - interceptor.altitudeM,
      Math.max(horizontalToAimM, 1)) / DEG_TO_RAD,
  };
}

// Tor manual control uses only the operator's OLS direction. The shared
// autopilot still imposes inertia, turn response, G and energy limits.
export function advanceTorManualGuidance({ interceptor, sight, simulationTime, deltaTimeSec,
  physics, steeringEnabled = true, guidanceSource = 'TOR_MANUAL_OLS' }) {
  const previousPitchDeg = interceptor.flightPathAngleDeg ?? 0;
  const speedMps = Math.max(1, interceptor.speedKmh / 3.6);
  const active = steeringEnabled && sight
    && simulationTime - sight.updatedAt <= TOR_MANUAL_COMMAND_HOLD_SEC;
  const sightDirection = active ? directionToSightLine(interceptor, sight, speedMps) : null;
  const desiredHeading = steeringEnabled
    ? active ? sightDirection.heading : interceptor.heading
    : interceptor.pitchOverHeading ?? interceptor.heading;
  const desiredPitchDeg = steeringEnabled
    ? active ? sightDirection.pitch : previousPitchDeg : previousPitchDeg;
  const current = velocityFromFlightPath(interceptor.heading, 1, previousPitchDeg);
  const desired = velocityFromFlightPath(desiredHeading, 1, desiredPitchDeg);
  const dot = current.eastMps * desired.eastMps + current.northMps * desired.northMps
    + current.upMps * desired.upMps;
  const lateral = {
    eastMps: desired.eastMps - current.eastMps * dot,
    northMps: desired.northMps - current.northMps * dot,
    upMps: desired.upMps - current.upMps * dot,
  };
  const errorMagnitude = Math.hypot(lateral.eastMps, lateral.northMps, lateral.upMps);
  const turnPerformance = getEffectiveTurnPerformance(interceptor, physics);
  const availableAccelerationMps2 = Math.min(
    speedMps * turnPerformance.effectiveTurnRateDegPerSec * DEG_TO_RAD,
    (physics.referenceMaximumLoadFactorG ?? 42) * GRAVITY_MPS2,
  );
  const demand = active && errorMagnitude > 1e-6
    ? Math.min(availableAccelerationMps2, speedMps * errorMagnitude / 0.14) / errorMagnitude
    : 0;
  const commandedAccelerationVectorMps2 = {
    eastMps: lateral.eastMps * demand,
    northMps: lateral.northMps * demand,
    upMps: lateral.upMps * demand,
  };
  const autopilot = steeringEnabled ? applyMissileAutopilot({ interceptor,
    command: { commandedAccelerationVectorMps2, availableAccelerationMps2 },
    deltaTimeSec, physics }) : {
    heading: desiredHeading, flightPathAngleDeg: previousPitchDeg,
    turnRateDegPerSec: 0, headingTurnRateDegPerSec: 0, pitchRateDegPerSec: 0,
    actualAccelerationVectorMps2: { eastMps: 0, northMps: 0, upMps: 0 },
    actualLateralAccelerationMps2: 0, currentG: 0,
  };
  const headingCorrectionDeg = normalizeHeadingDelta(desiredHeading - interceptor.heading);
  const pitchErrorDeg = desiredPitchDeg - previousPitchDeg;
  return {
    guidance: { guidanceSource, commandHeading: desiredHeading,
      commandPitchDeg: desiredPitchDeg },
    heading: autopilot.heading,
    desiredHeading,
    flightPathAngleDeg: autopilot.flightPathAngleDeg,
    desiredFlightPathAngleDeg: desiredPitchDeg,
    headingCorrectionDeg,
    directionCorrectionDeg: Math.hypot(headingCorrectionDeg * Math.cos(previousPitchDeg * DEG_TO_RAD), pitchErrorDeg),
    pitchErrorDeg,
    turnRateDegPerSec: autopilot.turnRateDegPerSec,
    headingTurnRateDegPerSec: autopilot.headingTurnRateDegPerSec,
    pitchRateDegPerSec: autopilot.pitchRateDegPerSec,
    maximumTurnRateDegPerSec: turnPerformance.baseTurnRateDegPerSec,
    energyFactor: turnPerformance.energyFactor,
    speedFactor: turnPerformance.speedFactor,
    turnRadiusKm: turnPerformance.turnRadiusKm,
    guidanceState: !steeringEnabled ? 'BOOST' : active ? 'MANUAL_COMMAND' : 'MANUAL_COAST',
    guidanceEnabled: Boolean(active),
    commandedAccelerationVectorMps2,
    commandedLateralAccelerationMps2: Math.hypot(commandedAccelerationVectorMps2.eastMps,
      commandedAccelerationVectorMps2.northMps),
    actualAccelerationVectorMps2: autopilot.actualAccelerationVectorMps2,
    actualLateralAccelerationMps2: autopilot.actualLateralAccelerationMps2,
    currentG: autopilot.currentG,
    availableG: availableAccelerationMps2 / GRAVITY_MPS2,
    maximumG: physics.referenceMaximumLoadFactorG ?? 42,
    guidanceSource,
    failedReason: null,
  };
}
