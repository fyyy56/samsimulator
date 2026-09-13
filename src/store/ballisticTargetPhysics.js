import {
  BALLISTIC_MANEUVER_MODE,
  BALLISTIC_PHASE,
  BALLISTIC_TERMINAL_SOLUTION,
  SANDBOX_BALLISTIC_TEST_PROFILE,
  TERMINAL_CORRECTION_STATE,
} from '../data/ballisticTargetProfiles.js';
import { getBearing, getDestinationPoint, getDistanceKm } from './geo.js';
import { createWorldPosition } from './worldPosition.js';
import { getAltitudeBand } from '../data/airTargetProfiles.js';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const normalizeDelta = delta => ((delta + 540) % 360) - 180;

// The 2D ballistic integrator advances a constant local compass course. A
// great-circle initial bearing slowly drifts away from the aim point over long
// ranges, so an unguided shot must use the matching rhumb-line bearing.
const getRhumbBearing = (from, to) => {
  const fromLat = from.lat * DEG_TO_RAD;
  const toLat = to.lat * DEG_TO_RAD;
  let longitudeDelta = (to.lng - from.lng) * DEG_TO_RAD;
  if (Math.abs(longitudeDelta) > Math.PI) {
    longitudeDelta += longitudeDelta > 0 ? -2 * Math.PI : 2 * Math.PI;
  }
  const latitudeScale = Math.log(
    Math.tan(Math.PI / 4 + toLat / 2) / Math.tan(Math.PI / 4 + fromLat / 2),
  );
  return (Math.atan2(longitudeDelta, latitudeScale) * RAD_TO_DEG + 360) % 360;
};

const getRhumbDistanceKm = (from, to) => {
  const fromLat = from.lat * DEG_TO_RAD;
  const toLat = to.lat * DEG_TO_RAD;
  const latitudeDelta = toLat - fromLat;
  let longitudeDelta = (to.lng - from.lng) * DEG_TO_RAD;
  if (Math.abs(longitudeDelta) > Math.PI) {
    longitudeDelta += longitudeDelta > 0 ? -2 * Math.PI : 2 * Math.PI;
  }
  const latitudeScale = Math.log(
    Math.tan(Math.PI / 4 + toLat / 2) / Math.tan(Math.PI / 4 + fromLat / 2),
  );
  const projectionScale = Math.abs(latitudeScale) > 1e-12
    ? latitudeDelta / latitudeScale
    : Math.cos(fromLat);
  return Math.hypot(latitudeDelta, projectionScale * longitudeDelta) * 6_371;
};

const getLocalVectorMeters = (from, to) => {
  const meanLatitudeRad = ((from.lat + to.lat) * 0.5) * DEG_TO_RAD;
  return {
    x: (to.lng - from.lng) * 111_320 * Math.cos(meanLatitudeRad),
    y: (to.lat - from.lat) * 110_540,
  };
};

export function getBallisticAirDensity(
  altitudeM,
  profile = SANDBOX_BALLISTIC_TEST_PROFILE,
) {
  return profile.seaLevelAirDensityKgM3
    * Math.exp(-Math.max(0, altitudeM) / profile.atmosphereScaleHeightM);
}

const velocityFromHeading = (headingDeg, horizontalSpeedMps, verticalSpeedMps) => ({
  vx: Math.sin(headingDeg * DEG_TO_RAD) * horizontalSpeedMps,
  vy: Math.cos(headingDeg * DEG_TO_RAD) * horizontalSpeedMps,
  vz: verticalSpeedMps,
});

const getVelocityHeading = velocity => (
  Math.atan2(velocity.vx, velocity.vy) * RAD_TO_DEG + 360
) % 360;

const deterministicRandomSign = (seed = 1, index = 0) => {
  let value = (seed + index * 0x9E3779B9) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) % 2 === 0 ? 1 : -1;
};

const getCorrectionSide = (configuration, correctionIndex) => {
  if (configuration.side === 'LEFT') return -1;
  if (configuration.side === 'RIGHT') return 1;
  if (configuration.side === 'RANDOM') {
    return deterministicRandomSign((configuration.seed ?? Date.now()) ^ 0xA51C, correctionIndex);
  }
  return correctionIndex % 2 === 0 ? 1 : -1;
};

const simulateBallisticRangeKm = (elevationDeg, burnTimeSec, profile) => {
  // Keep launch-solution integration aligned with the fixed 20 Hz simulation.
  // The former coarse 0.25 s step accumulated kilometres of range error when
  // terminal control was deliberately disabled.
  const stepSec = 0.05;
  const elevationRad = elevationDeg * DEG_TO_RAD;
  let horizontalSpeedMps = profile.initialLaunchSpeedMps * Math.cos(elevationRad);
  let verticalSpeedMps = profile.initialLaunchSpeedMps * Math.sin(elevationRad);
  let altitudeM = 20;
  let distanceM = 0;
  let massKg = profile.massKg;
  let fuelRemainingKg = profile.fuelMassKg;
  const fuelFlowKgSec = profile.fuelMassKg / Math.max(burnTimeSec, 0.1);
  for (let timeSec = 0; timeSec < 600 && altitudeM >= 0; timeSec += stepSec) {
    const burning = timeSec + stepSec <= burnTimeSec && fuelRemainingKg > 0;
    const burnedFuelKg = burning ? Math.min(fuelRemainingKg, fuelFlowKgSec * stepSec) : 0;
    massKg = Math.max(profile.massKg - profile.fuelMassKg, massKg - burnedFuelKg);
    fuelRemainingKg -= burnedFuelKg;
    const speedMps = Math.max(0.1, Math.hypot(horizontalSpeedMps, verticalSpeedMps));
    const density = getBallisticAirDensity(altitudeM, profile);
    const dragMps2 = 0.5 * density * profile.dragCoefficient
      * profile.referenceAreaM2 * speedMps ** 2 / massKg;
    const thrustMps2 = burning ? profile.motorThrustN / massKg : 0;
    const axialAccelerationMps2 = thrustMps2 - dragMps2;
    horizontalSpeedMps += horizontalSpeedMps / speedMps * axialAccelerationMps2 * stepSec;
    verticalSpeedMps += (verticalSpeedMps / speedMps * axialAccelerationMps2
      - profile.gravityMps2) * stepSec;
    distanceM += Math.max(0, horizontalSpeedMps) * stepSec;
    altitudeM += verticalSpeedMps * stepSec;
  }
  return distanceM / 1000;
};

const getRangeLaunchSolution = (rangeKm, profile) => {
  const rangeFactor = clamp(rangeKm / 420, 0, 1);
  const elevationDeg = 32 + rangeFactor * 24;
  let lowerBurnSec = profile.minimumBurnTimeSec;
  let upperBurnSec = profile.burnTimeSec;
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const candidateBurnSec = (lowerBurnSec + upperBurnSec) * 0.5;
    const candidateRangeKm = simulateBallisticRangeKm(elevationDeg, candidateBurnSec, profile);
    if (candidateRangeKm < rangeKm) lowerBurnSec = candidateBurnSec;
    else upperBurnSec = candidateBurnSec;
  }
  return {
    elevationDeg,
    commandedBurnTimeSec: (lowerBurnSec + upperBurnSec) * 0.5,
  };
};

export function createBallisticPhysicsState({
  launchPosition,
  aimPoint,
  terminalCorrection = {},
  profile = SANDBOX_BALLISTIC_TEST_PROFILE,
  simulationTime = 0,
}) {
  const rangeKm = getRhumbDistanceKm(launchPosition, aimPoint);
  const launchHeading = getRhumbBearing(launchPosition, aimPoint);
  const launchSolution = getRangeLaunchSolution(rangeKm, profile);
  const elevationRad = launchSolution.elevationDeg * DEG_TO_RAD;
  const horizontalSpeedMps = profile.initialLaunchSpeedMps * Math.cos(elevationRad);
  const velocityMps = velocityFromHeading(
    launchHeading,
    horizontalSpeedMps,
    profile.initialLaunchSpeedMps * Math.sin(elevationRad),
  );
  const correctionAngleDeg = Math.max(0, terminalCorrection.angleDeg ?? 0);
  const correctionCount = correctionAngleDeg > 0
    ? clamp(Math.round(terminalCorrection.count ?? 1), 0, 2)
    : 0;
  return {
    enabled: true,
    profileId: profile.id,
    phase: BALLISTIC_PHASE.BOOST,
    launchPosition: { ...launchPosition },
    aimPoint: { ...aimPoint },
    positionM: { x: 0, y: 0, altitude: launchPosition.altitudeM ?? 20 },
    velocityMps,
    initialMassKg: profile.massKg,
    massKg: profile.massKg,
    fuelRemainingKg: profile.fuelMassKg,
    commandedBurnTimeSec: launchSolution.commandedBurnTimeSec,
    launchHeadingDeg: launchHeading,
    launchElevationDeg: launchSolution.elevationDeg,
    horizontalSpeedMps,
    verticalSpeedMps: velocityMps.vz,
    totalSpeedMps: profile.initialLaunchSpeedMps,
    flightPathAngleDeg: launchSolution.elevationDeg,
    distanceToAimPointKm: rangeKm,
    distanceTraveledKm: 0,
    timeOfFlightSec: 0,
    apogeeReachedM: launchPosition.altitudeM ?? 20,
    predictedApogeeM: launchPosition.altitudeM ?? 20,
    predictedImpactPoint: { ...aimPoint },
    predictedImpactDistanceKm: rangeKm,
    impactErrorMeters: rangeKm * 1000,
    timeToGroundSec: 0,
    terminalSolution: BALLISTIC_TERMINAL_SOLUTION.VALID,
    ballisticMiss: false,
    impactPoint: null,
    lastImpactPredictionTime: -Infinity,
    airDensityKgM3: getBallisticAirDensity(launchPosition.altitudeM ?? 20, profile),
    dragAccelerationMps2: 0,
    gravityAccelerationMps2: profile.gravityMps2,
    currentControlG: 0,
    terminalCorrection: {
      mode: terminalCorrection.mode === BALLISTIC_MANEUVER_MODE.NONE
        ? BALLISTIC_MANEUVER_MODE.NONE
        : BALLISTIC_MANEUVER_MODE.AUTO,
      angleDeg: correctionAngleDeg,
      count: correctionCount,
      side: terminalCorrection.side ?? 'AUTO',
      seed: terminalCorrection.seed ?? 1,
      used: 0,
      state: correctionCount > 0 ? TERMINAL_CORRECTION_STATE.WAITING : TERMINAL_CORRECTION_STATE.OFF,
      activeSince: null,
      activeSide: 0,
      maneuverWaypoint: null,
    },
    spawnedAt: simulationTime,
  };
}

export function predictBallisticImpact({ position, velocityMps, profile, massKg }) {
  const altitudeM = Math.max(0, position.altitudeM ?? position.alt ?? 0);
  let predictedAltitudeM = altitudeM;
  let predictedHorizontalSpeedMps = Math.hypot(velocityMps.vx, velocityMps.vy);
  let predictedVerticalSpeedMps = velocityMps.vz;
  let horizontalDistanceM = 0;
  let timeToGroundSec = 0;
  const predictionMassKg = Math.max(1,
    massKg ?? profile.massKg - profile.fuelMassKg);
  while (predictedAltitudeM > 0 && timeToGroundSec < 600) {
    const stepSec = predictedAltitudeM < 5_000 ? 0.5 : 2;
    const density = getBallisticAirDensity(predictedAltitudeM, profile);
    const speedMps = Math.max(1,
      Math.hypot(predictedHorizontalSpeedMps, predictedVerticalSpeedMps));
    const dragMps2 = 0.5 * density * profile.dragCoefficient
      * profile.referenceAreaM2 * speedMps ** 2 / predictionMassKg;
    const horizontalAccelerationMps2 = -predictedHorizontalSpeedMps / speedMps * dragMps2;
    const verticalAccelerationMps2 = -predictedVerticalSpeedMps / speedMps * dragMps2
      - profile.gravityMps2;
    predictedHorizontalSpeedMps = Math.max(0,
      predictedHorizontalSpeedMps + horizontalAccelerationMps2 * stepSec);
    predictedVerticalSpeedMps += verticalAccelerationMps2 * stepSec;
    horizontalDistanceM += predictedHorizontalSpeedMps * stepSec;
    predictedAltitudeM += predictedVerticalSpeedMps * stepSec;
    timeToGroundSec += stepSec;
  }
  const horizontalDistanceKm = horizontalDistanceM / 1000;
  return {
    ...getDestinationPoint(
      position.lat,
      position.lng,
      getVelocityHeading(velocityMps),
      horizontalDistanceKm,
    ),
    timeToImpactSec: timeToGroundSec,
    horizontalDistanceKm,
  };
}

const getImpactGeometry = ({ currentPosition, velocityMps, predictedImpactPoint, aimPoint }) => {
  const horizontalSpeedMps = Math.max(0.01, Math.hypot(velocityMps.vx, velocityMps.vy));
  const velocityUnit = {
    x: velocityMps.vx / horizontalSpeedMps,
    y: velocityMps.vy / horizontalSpeedMps,
  };
  const toAim = getLocalVectorMeters(currentPosition, aimPoint);
  const toPredictedImpact = getLocalVectorMeters(currentPosition, predictedImpactPoint);
  const alongToAimM = toAim.x * velocityUnit.x + toAim.y * velocityUnit.y;
  const crossToAimM = velocityUnit.y * toAim.x - velocityUnit.x * toAim.y;
  const predictedAlongM = toPredictedImpact.x * velocityUnit.x
    + toPredictedImpact.y * velocityUnit.y;
  const predictedCrossM = velocityUnit.y * toPredictedImpact.x
    - velocityUnit.x * toPredictedImpact.y;
  const predictedDownrangeErrorM = predictedAlongM - alongToAimM;
  // Positive means the aim point lies to the right of the currently predicted
  // ground impact. Guidance must null this error, not chase current aim X/Y.
  const predictedCrossTrackErrorM = crossToAimM - predictedCrossM;
  const aimBehind = alongToAimM < -250;
  let solution = BALLISTIC_TERMINAL_SOLUTION.VALID;
  if (aimBehind) solution = BALLISTIC_TERMINAL_SOLUTION.LOST;
  else if (predictedDownrangeErrorM > 600) solution = BALLISTIC_TERMINAL_SOLUTION.OVERSHOOT;
  else if (predictedDownrangeErrorM < -600) solution = BALLISTIC_TERMINAL_SOLUTION.UNDERSHOOT;
  return {
    alongToAimM,
    crossToAimM,
    predictedAlongM,
    predictedCrossM,
    predictedDownrangeErrorM,
    predictedCrossTrackErrorM,
    aimBehind,
    solution,
  };
};

const maybeStartTerminalCorrection = (state, currentPosition) => {
  const correction = state.terminalCorrection;
  if (correction.mode === BALLISTIC_MANEUVER_MODE.NONE) return state;
  if (correction.used >= correction.count || correction.angleDeg <= 0) return state;
  const triggerFractions = correction.count === 2 ? [0.82, 0.48] : [0.68];
  const initialRangeKm = getDistanceKm(
    state.launchPosition.lat, state.launchPosition.lng, state.aimPoint.lat, state.aimPoint.lng,
  );
  const triggerDistanceKm = Math.max(6, initialRangeKm * triggerFractions[correction.used]);
  if (state.distanceToAimPointKm > triggerDistanceKm) return state;
  const nominalHeading = getBearing(currentPosition.lat, currentPosition.lng,
    state.aimPoint.lat, state.aimPoint.lng);
  const side = getCorrectionSide(correction, correction.used);
  const waypointDistanceKm = Math.max(3, state.distanceToAimPointKm * 0.55);
  const lateralOffsetKm = Math.tan(correction.angleDeg * DEG_TO_RAD) * waypointDistanceKm;
  const nominalWaypoint = getDestinationPoint(
    currentPosition.lat, currentPosition.lng, nominalHeading, waypointDistanceKm,
  );
  const maneuverWaypoint = getDestinationPoint(
    nominalWaypoint.lat, nominalWaypoint.lng, nominalHeading + side * 90, lateralOffsetKm,
  );
  return {
    ...state,
    terminalCorrection: {
      ...correction,
      used: correction.used + 1,
      state: TERMINAL_CORRECTION_STATE.ACTIVE,
      activeSince: state.timeOfFlightSec,
      activeSide: side,
      maneuverWaypoint,
    },
  };
};

const updateCorrectionState = (state, predictedImpactErrorM, profile) => {
  const correction = state.terminalCorrection;
  if (correction.state === TERMINAL_CORRECTION_STATE.ACTIVE
    && state.timeOfFlightSec - correction.activeSince >= profile.terminalCorrectionDurationSec) {
    return { ...state, terminalCorrection: { ...correction,
      state: TERMINAL_CORRECTION_STATE.RETURNING, maneuverWaypoint: null } };
  }
  if (correction.state === TERMINAL_CORRECTION_STATE.RETURNING
    && predictedImpactErrorM <= profile.correctionReturnErrorThresholdM) {
    return { ...state, terminalCorrection: { ...correction,
      state: correction.used < correction.count
        ? TERMINAL_CORRECTION_STATE.WAITING
        : TERMINAL_CORRECTION_STATE.COMPLETE } };
  }
  return state;
};

export function advanceBallisticTarget(
  target,
  deltaTimeSec,
  profile = SANDBOX_BALLISTIC_TEST_PROFILE,
) {
  let state = target.ballisticPhysics;
  if (!state?.enabled || target.state !== 'ALIVE') return target;
  const currentPosition = target.worldPosition ?? { ...target.position, altitudeM: target.altitudeM };
  const currentVelocity = state.velocityMps;
  const totalSpeedMps = Math.max(0.1, Math.hypot(currentVelocity.vx, currentVelocity.vy, currentVelocity.vz));
  const nextFlightTimeSec = state.timeOfFlightSec + deltaTimeSec;
  const burning = nextFlightTimeSec <= state.commandedBurnTimeSec && state.fuelRemainingKg > 0;
  const fuelFlowKgSec = profile.fuelMassKg / Math.max(state.commandedBurnTimeSec, 0.1);
  const burnedFuelKg = burning ? Math.min(state.fuelRemainingKg, fuelFlowKgSec * deltaTimeSec) : 0;
  const massKg = Math.max(profile.massKg - profile.fuelMassKg, state.massKg - burnedFuelKg);
  const airDensityKgM3 = getBallisticAirDensity(target.altitudeM, profile);
  const dragAccelerationMps2 = 0.5 * airDensityKgM3 * profile.dragCoefficient
    * profile.referenceAreaM2 * totalSpeedMps ** 2 / Math.max(massKg, 1);
  const thrustAccelerationMps2 = burning ? profile.motorThrustN / Math.max(massKg, 1) : 0;
  const thrustDirectionScale = thrustAccelerationMps2 / totalSpeedMps;
  let acceleration = {
    x: currentVelocity.vx * thrustDirectionScale - currentVelocity.vx / totalSpeedMps * dragAccelerationMps2,
    y: currentVelocity.vy * thrustDirectionScale - currentVelocity.vy / totalSpeedMps * dragAccelerationMps2,
    z: currentVelocity.vz * thrustDirectionScale - currentVelocity.vz / totalSpeedMps * dragAccelerationMps2
      - profile.gravityMps2,
  };

  const descending = currentVelocity.vz < -5;
  const terminal = descending && (
    target.altitudeM <= profile.terminalStartAltitudeM
    || state.distanceToAimPointKm <= profile.terminalStartDistanceKm
  );
  let phase = burning ? BALLISTIC_PHASE.BOOST
    : currentVelocity.vz > 35 ? BALLISTIC_PHASE.ASCENT
      : Math.abs(currentVelocity.vz) <= 35 ? BALLISTIC_PHASE.MIDCOURSE
        : terminal ? BALLISTIC_PHASE.TERMINAL : BALLISTIC_PHASE.DESCENT;

  if (terminal && state.terminalSolution !== BALLISTIC_TERMINAL_SOLUTION.LOST) {
    state = maybeStartTerminalCorrection(state, currentPosition);
  }
  // Control always uses a fresh impact projection. The throttled copy stored in
  // state remains suitable for UI, but was too stale for terminal convergence.
  const currentPrediction = predictBallisticImpact({
    position: { ...currentPosition, altitudeM: target.altitudeM },
    velocityMps: currentVelocity,
    profile,
    massKg,
  });
  const impactGeometry = getImpactGeometry({
    currentPosition,
    velocityMps: currentVelocity,
    predictedImpactPoint: currentPrediction,
    aimPoint: state.aimPoint,
  });
  const terminalSolution = state.terminalSolution === BALLISTIC_TERMINAL_SOLUTION.LOST
    ? BALLISTIC_TERMINAL_SOLUTION.LOST
    : impactGeometry.solution;
  const ballisticMiss = state.ballisticMiss
    || (descending && terminalSolution === BALLISTIC_TERMINAL_SOLUTION.LOST);
  let currentControlG = 0;
  let currentLateralControlMps2 = 0;
  const maneuveringEnabled = state.terminalCorrection.mode !== BALLISTIC_MANEUVER_MODE.NONE;
  if (descending && terminalSolution !== BALLISTIC_TERMINAL_SOLUTION.LOST) {
    const currentHeading = getVelocityHeading(currentVelocity);
    const impactCorrectionDeg = maneuveringEnabled ? clamp(
      Math.atan2(
        impactGeometry.predictedCrossTrackErrorM,
        Math.max(5_000, currentPrediction.horizontalDistanceKm * 1000),
      ) * RAD_TO_DEG,
      -18,
      18,
    ) : 0;
    const manoeuvreCorrectionDeg = maneuveringEnabled && terminal
      && state.terminalCorrection.state === TERMINAL_CORRECTION_STATE.ACTIVE
      ? state.terminalCorrection.activeSide * state.terminalCorrection.angleDeg
      : 0;
    const desiredHeading = currentHeading + impactCorrectionDeg + manoeuvreCorrectionDeg;
    const headingErrorRad = normalizeDelta(desiredHeading - currentHeading) * DEG_TO_RAD;
    // The vehicle retains limited high-altitude control authority; the old
    // 0.12 floor delayed impact correction until it was physically too late.
    const aerodynamicAuthority = clamp(airDensityKgM3 / 0.12, 0.32, 1);
    const maxLateralAccelerationMps2 = profile.maxControlG * profile.gravityMps2
      * profile.terminalControlAuthority * aerodynamicAuthority;
    const commandedLateralAccelerationMps2 = maneuveringEnabled && terminal ? clamp(
      headingErrorRad * Math.max(1, Math.hypot(currentVelocity.vx, currentVelocity.vy)) / 8,
      -maxLateralAccelerationMps2,
      maxLateralAccelerationMps2,
    ) : 0;
    currentLateralControlMps2 = commandedLateralAccelerationMps2;
    const lateralHeading = currentHeading + (commandedLateralAccelerationMps2 >= 0 ? 90 : -90);
    acceleration.x += Math.sin(lateralHeading * DEG_TO_RAD) * Math.abs(commandedLateralAccelerationMps2);
    acceleration.y += Math.cos(lateralHeading * DEG_TO_RAD) * Math.abs(commandedLateralAccelerationMps2);
    const predictedTimeToImpactSec = Math.max(2, currentPrediction.timeToImpactSec);
    // For displacement error under bounded acceleration, 2*error/t² is the
    // useful first-order command. It starts correcting before crossing aim X/Y.
    const verticalGuidanceGain = terminal ? 7.0 : 4.0;
    const availableVerticalAccelerationMps2 = Math.sqrt(Math.max(0,
      maxLateralAccelerationMps2 ** 2 - commandedLateralAccelerationMps2 ** 2));
    const impactErrorControlMps2 =
      -impactGeometry.predictedDownrangeErrorM * verticalGuidanceGain
        / predictedTimeToImpactSec ** 2;
    const requestedVerticalControlMps2 = clamp(
      impactErrorControlMps2,
      -availableVerticalAccelerationMps2,
      availableVerticalAccelerationMps2,
    );
    // Terminal range management may brake the descent, but may not reverse it
    // into a climb. The former clamp incorrectly forced net acceleration to
    // stay negative, making recovery from an UNDERSHOOT impossible.
    const maximumControlWithoutClimbMps2 = (-1 - currentVelocity.vz)
      / Math.max(deltaTimeSec, 0.001) - acceleration.z;
    const verticalControlMps2 = Math.min(
      requestedVerticalControlMps2,
      Math.max(0, maximumControlWithoutClimbMps2),
    );
    acceleration.z += verticalControlMps2;
    const controlRatio = Math.abs(commandedLateralAccelerationMps2)
      / Math.max(maxLateralAccelerationMps2, 0.01);
    const maneuverLossMps2 = totalSpeedMps * profile.maneuverDragFactor * controlRatio ** 2;
    acceleration.x -= currentVelocity.vx / totalSpeedMps * maneuverLossMps2;
    acceleration.y -= currentVelocity.vy / totalSpeedMps * maneuverLossMps2;
    acceleration.z -= currentVelocity.vz / totalSpeedMps * maneuverLossMps2;
    currentControlG = Math.hypot(commandedLateralAccelerationMps2, verticalControlMps2)
      / profile.gravityMps2;
  }

  const velocityMps = {
    vx: currentVelocity.vx + acceleration.x * deltaTimeSec,
    vy: currentVelocity.vy + acceleration.y * deltaTimeSec,
    vz: currentVelocity.vz + acceleration.z * deltaTimeSec,
  };
  const horizontalSpeedMps = Math.hypot(velocityMps.vx, velocityMps.vy);
  const nextTotalSpeedMps = Math.hypot(horizontalSpeedMps, velocityMps.vz);
  const horizontalDistanceKm = horizontalSpeedMps * deltaTimeSec / 1000;
  const nextPosition2d = getDestinationPoint(
    currentPosition.lat, currentPosition.lng, getVelocityHeading(velocityMps), horizontalDistanceKm,
  );
  const altitudeM = target.altitudeM + velocityMps.vz * deltaTimeSec;
  const distanceToAimPointKm = getDistanceKm(
    nextPosition2d.lat, nextPosition2d.lng, state.aimPoint.lat, state.aimPoint.lng,
  );
  const stepDistanceKm = nextTotalSpeedMps * deltaTimeSec / 1000;
  const positionM = {
    x: state.positionM.x + velocityMps.vx * deltaTimeSec,
    y: state.positionM.y + velocityMps.vy * deltaTimeSec,
    altitude: Math.max(0, altitudeM),
  };
  const predictedApogeeM = altitudeM + Math.max(0, velocityMps.vz) ** 2
    / (2 * profile.gravityMps2);
  let predictedImpactPoint = state.predictedImpactPoint;
  let predictedImpactDistanceKm = state.predictedImpactDistanceKm;
  let impactErrorMeters = state.impactErrorMeters;
  let timeToGroundSec = state.timeToGroundSec;
  let lastImpactPredictionTime = state.lastImpactPredictionTime;
  if (nextFlightTimeSec - lastImpactPredictionTime >= profile.predictionIntervalSec) {
    predictedImpactPoint = predictBallisticImpact({
      position: { ...nextPosition2d, altitudeM: Math.max(0, altitudeM) },
      velocityMps,
      profile,
      massKg,
    });
    impactErrorMeters = getDistanceKm(
      predictedImpactPoint.lat, predictedImpactPoint.lng, state.aimPoint.lat, state.aimPoint.lng,
    ) * 1000;
    predictedImpactDistanceKm = getDistanceKm(
      nextPosition2d.lat, nextPosition2d.lng,
      predictedImpactPoint.lat, predictedImpactPoint.lng,
    );
    timeToGroundSec = predictedImpactPoint.timeToImpactSec;
    lastImpactPredictionTime = nextFlightTimeSec;
  }
  state = updateCorrectionState({
    ...state,
    phase,
    positionM,
    velocityMps,
    massKg,
    fuelRemainingKg: state.fuelRemainingKg - burnedFuelKg,
    horizontalSpeedMps,
    verticalSpeedMps: velocityMps.vz,
    totalSpeedMps: nextTotalSpeedMps,
    flightPathAngleDeg: Math.atan2(velocityMps.vz, Math.max(horizontalSpeedMps, 0.01)) * RAD_TO_DEG,
    distanceToAimPointKm,
    distanceTraveledKm: state.distanceTraveledKm + stepDistanceKm,
    timeOfFlightSec: nextFlightTimeSec,
    apogeeReachedM: Math.max(state.apogeeReachedM, altitudeM),
    predictedApogeeM,
    predictedImpactPoint,
    predictedImpactDistanceKm,
    impactErrorMeters,
    timeToGroundSec,
    terminalSolution,
    ballisticMiss,
    lastImpactPredictionTime,
    airDensityKgM3,
    dragAccelerationMps2,
    gravityAccelerationMps2: profile.gravityMps2,
    currentControlG,
    currentLateralControlMps2,
  }, impactErrorMeters, profile);

  const impacted = altitudeM <= profile.impactAltitudeM && velocityMps.vz < 0;
  if (impacted) phase = BALLISTIC_PHASE.IMPACT;
  const finalPosition = nextPosition2d;
  const finalAltitudeM = impacted ? 0 : Math.max(0, altitudeM);
  const worldPosition = createWorldPosition(finalPosition.lat, finalPosition.lng, finalAltitudeM);
  const previousTrajectoryPoint = target.trajectory?.at(-1);
  const shouldAddTrajectoryPoint = !previousTrajectoryPoint || getDistanceKm(
    previousTrajectoryPoint.lat, previousTrajectoryPoint.lng, finalPosition.lat, finalPosition.lng,
  ) >= 2;
  return {
    ...target,
    state: impacted ? 'COMPLETED' : 'ALIVE',
    position: { ...finalPosition, lon: finalPosition.lng },
    worldPosition,
    altitudeM: finalAltitudeM,
    targetAltitudeM: finalAltitudeM,
    altitudeBand: getAltitudeBand(finalAltitudeM),
    speedKmh: nextTotalSpeedMps * 3.6,
    heading: getVelocityHeading(velocityMps),
    desiredHeading: state.terminalSolution === BALLISTIC_TERMINAL_SOLUTION.LOST
      ? getVelocityHeading(velocityMps)
      : getBearing(finalPosition.lat, finalPosition.lng,
        state.aimPoint.lat, state.aimPoint.lng),
    verticalSpeedMps: velocityMps.vz,
    velocity: {
      speedKmh: nextTotalSpeedMps * 3.6,
      heading: getVelocityHeading(velocityMps),
      verticalSpeedMps: velocityMps.vz,
      vx: velocityMps.vx,
      vy: velocityMps.vy,
      vz: velocityMps.vz,
    },
    distanceTraveledKm: state.distanceTraveledKm,
    routeProgress: clamp(1 - distanceToAimPointKm
      / Math.max(getDistanceKm(state.launchPosition.lat, state.launchPosition.lng,
        state.aimPoint.lat, state.aimPoint.lng), 0.01), 0, 1),
    flightPhase: phase,
    ballisticPhysics: {
      ...state,
      phase,
      impactPoint: impacted ? { ...finalPosition } : state.impactPoint,
      impactErrorMeters: impacted
        ? getDistanceKm(finalPosition.lat, finalPosition.lng,
          state.aimPoint.lat, state.aimPoint.lng) * 1000
        : state.impactErrorMeters,
    },
    trajectory: shouldAddTrajectoryPoint
      ? [...(target.trajectory ?? []), { ...finalPosition, altitudeM: finalAltitudeM }].slice(-48)
      : target.trajectory,
  };
}
