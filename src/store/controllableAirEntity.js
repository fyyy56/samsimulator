import {
  CONTROLLABLE_AIR_PROFILE_IDS,
  getControllableAirProfile,
} from '../data/controllableAirProfiles.js';
import { getDestinationPoint } from './geo.js';
import { createWorldPosition, getWorldPosition } from './worldPosition.js';

export const CONTROLLABLE_AIR_ENTITY_TYPE = 'CONTROLLABLE_AIR_ENTITY';

export const CONTROLLABLE_CONTROL_MODE = Object.freeze({
  MANUAL: 'MANUAL',
  ASSISTED: 'ASSISTED',
  AUTONOMOUS: 'AUTONOMOUS',
});

export const CONTROLLABLE_CAMERA_MODE = Object.freeze({
  THIRD_PERSON: 'THIRD_PERSON',
  FIRST_PERSON: 'FIRST_PERSON',
  FPV: 'FPV',
});

export const CONTROLLABLE_STATUS = Object.freeze({
  READY: 'READY',
  ACTIVE: 'ACTIVE',
  LOST_LINK: 'LOST_LINK',
  BATTERY_DEPLETED: 'BATTERY_DEPLETED',
  CRASHED: 'CRASHED',
  DESTROYED: 'DESTROYED',
});

export const CONTROLLABLE_FLIGHT_PHASE = Object.freeze({
  LAUNCH: 'LAUNCH',
  TRANSITION: 'TRANSITION',
  MANUAL_FLIGHT: 'MANUAL_FLIGHT',
  POST_EVENT_HOLD: 'POST_EVENT_HOLD',
});

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const normalizeHeading = heading => ((heading % 360) + 360) % 360;
const approach = (current, target, maximumDelta) => (
  current + clamp(target - current, -maximumDelta, maximumDelta)
);
const smoothStep = value => {
  const normalized = clamp(value, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
};

const createInitialControlState = (profile, speedMps) => {
  const throttle = clamp(
    (speedMps - profile.minimumSpeedMps)
      / Math.max(0.001, profile.maximumSpeedMps - profile.minimumSpeedMps),
    0,
    1,
  );
  return {
    rawInput: { throttle, pitch: 0, yaw: 0, roll: 0 },
    smoothedInput: { throttle, pitch: 0, yaw: 0, roll: 0 },
    desiredRatesDegPerSec: { pitch: 0, yaw: 0, roll: 0 },
    actualRatesDegPerSec: { pitch: 0, yaw: 0, roll: 0 },
    turnAuthority: 1,
  };
};

const normalizeManualInput = (manualControl, fallback) => ({
  throttle: clamp(Number.isFinite(manualControl?.throttle)
    ? manualControl.throttle : fallback.throttle, 0, 1),
  pitch: clamp(Number.isFinite(manualControl?.pitch)
    ? manualControl.pitch : 0, -1, 1),
  yaw: clamp(Number.isFinite(manualControl?.yaw)
    ? manualControl.yaw : 0, -1, 1),
  roll: clamp(Number.isFinite(manualControl?.roll)
    ? manualControl.roll : 0, -1, 1),
});

const smoothInputAxis = (current, target, deltaTimeSec, riseRate, fallRate) => {
  const movingAwayFromNeutral = Math.abs(target) > Math.abs(current);
  return approach(current, target,
    (movingAwayFromNeutral ? riseRate : fallRate) * deltaTimeSec);
};

const getTurnAuthority = (profile, speedMps) => {
  const controller = profile.controller;
  if (!controller) return 1;
  const lowRange = Math.max(0.001,
    controller.fullTurnAuthoritySpeedMps - profile.minimumSpeedMps);
  const lowBlend = smoothStep((speedMps - profile.minimumSpeedMps) / lowRange);
  const lowFactor = controller.lowSpeedAuthorityFloor
    + (1 - controller.lowSpeedAuthorityFloor) * lowBlend;
  const highRange = Math.max(0.001,
    profile.maximumSpeedMps - controller.highSpeedAuthorityStartMps);
  const highBlend = smoothStep(
    (speedMps - controller.highSpeedAuthorityStartMps) / highRange,
  );
  return clamp(lowFactor * (1 - controller.highSpeedAuthorityReduction * highBlend), 0.2, 1);
};

const createVelocity = (speedMps, headingDeg, pitchDeg) => {
  const headingRad = headingDeg * Math.PI / 180;
  const pitchRad = pitchDeg * Math.PI / 180;
  const horizontalSpeedMps = speedMps * Math.cos(pitchRad);
  return {
    vx: Math.sin(headingRad) * horizontalSpeedMps,
    vy: Math.cos(headingRad) * horizontalSpeedMps,
    vz: Math.sin(pitchRad) * speedMps,
    eastMps: Math.sin(headingRad) * horizontalSpeedMps,
    northMps: Math.cos(headingRad) * horizontalSpeedMps,
    upMps: Math.sin(pitchRad) * speedMps,
    speedKmh: speedMps * 3.6,
    heading: headingDeg,
    flightPathAngleDeg: pitchDeg,
  };
};

const multiplyQuaternion = (left, right) => ({
  x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
  y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
  z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
  w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
});

const axisAngleQuaternion = (x, y, z, angleRad) => {
  const halfAngle = angleRad * 0.5;
  const sine = Math.sin(halfAngle);
  return { x: x * sine, y: y * sine, z: z * sine, w: Math.cos(halfAngle) };
};

const createOrientationQuaternion = (headingDeg, pitchDeg, rollDeg) => {
  const heading = axisAngleQuaternion(0, 0, 1, -headingDeg * Math.PI / 180);
  const pitch = axisAngleQuaternion(1, 0, 0, pitchDeg * Math.PI / 180);
  const roll = axisAngleQuaternion(0, 1, 0, rollDeg * Math.PI / 180);
  return multiplyQuaternion(multiplyQuaternion(heading, pitch), roll);
};

const rotateByQuaternion = (quaternion, vector) => {
  const vectorQuaternion = { x: vector.x, y: vector.y, z: vector.z, w: 0 };
  const inverse = {
    x: -quaternion.x, y: -quaternion.y, z: -quaternion.z, w: quaternion.w,
  };
  const rotated = multiplyQuaternion(
    multiplyQuaternion(quaternion, vectorQuaternion),
    inverse,
  );
  return { x: rotated.x, y: rotated.y, z: rotated.z };
};

const getBodyAxesFromQuaternion = quaternion => ({
  forward: rotateByQuaternion(quaternion, { x: 0, y: 1, z: 0 }),
  up: rotateByQuaternion(quaternion, { x: 0, y: 0, z: 1 }),
});

const getElectricalState = (entity, profile, throttle, maneuverDemand, climbDemand,
  deltaTimeSec, powerAvailable) => {
  const battery = profile.battery;
  if (!battery) {
    const batteryRemaining = Math.max(0,
      (entity.batteryRemaining ?? 1) - profile.batteryDrainPerSec * deltaTimeSec);
    return {
      batteryRemaining,
      stateOfCharge: batteryRemaining,
      batteryCapacityWh: null,
      batteryRemainingWh: null,
      nominalVoltageV: null,
      batteryVoltageV: null,
      currentPowerKw: null,
      currentAmps: null,
    };
  }
  const priorStateOfCharge = clamp(
    entity.stateOfCharge ?? entity.batteryRemaining ?? 1,
    0,
    1,
  );
  const priorEnergyWh = clamp(
    entity.batteryRemainingWh ?? priorStateOfCharge * battery.capacityWh,
    0,
    battery.capacityWh,
  );
  const requestedPowerKw = battery.avionicsPowerKw
    + battery.maximumPropulsionPowerKw * throttle ** battery.throttlePowerExponent
    + battery.maneuverPowerKw * maneuverDemand ** 1.35
    + battery.climbPowerKw * Math.max(0, climbDemand);
  const currentPowerKw = powerAvailable ? requestedPowerKw : 0;
  const batteryRemainingWh = Math.max(0,
    priorEnergyWh - currentPowerKw * 1000 * deltaTimeSec / 3600);
  const stateOfCharge = batteryRemainingWh / battery.capacityWh;
  const openCircuitVoltageV = battery.emptyOpenCircuitVoltageV
    + (battery.fullVoltageV - battery.emptyOpenCircuitVoltageV)
      * stateOfCharge ** 0.72;
  const preliminaryCurrentAmps = currentPowerKw > 0
    ? currentPowerKw * 1000 / Math.max(openCircuitVoltageV, 1)
    : 0;
  const batteryVoltageV = stateOfCharge <= 0
    ? battery.minimumLoadedVoltageV
    : Math.max(
      battery.minimumLoadedVoltageV,
      openCircuitVoltageV - preliminaryCurrentAmps * battery.internalResistanceOhm,
    );
  const currentAmps = currentPowerKw > 0
    ? currentPowerKw * 1000 / Math.max(batteryVoltageV, 1)
    : 0;
  return {
    batteryRemaining: stateOfCharge,
    stateOfCharge,
    batteryCapacityWh: battery.capacityWh,
    batteryRemainingWh,
    nominalVoltageV: battery.nominalVoltageV,
    batteryVoltageV,
    currentPowerKw,
    currentAmps,
  };
};

const advanceForceBasedEntity = (entity, deltaTimeSec, manualControl, profile) => {
  const physics = profile.flightPhysics;
  const controller = profile.controller;
  const previousControlState = entity.controlState ?? createInitialControlState(
    profile,
    entity.speedMps,
  );
  const launchActive = profile.launch?.enabled && !entity.manualControlEnabled;
  const launchElapsedSec = (entity.launchElapsedSec ?? 0) + deltaTimeSec;
  const launchProgress = launchActive
    ? clamp((launchElapsedSec - profile.launch.verticalClimbSec)
      / Math.max(0.01, profile.launch.pitchOverSec), 0, 1)
    : 1;
  const rawInput = launchActive
    ? { throttle: 1, pitch: 0, yaw: 0, roll: 0 }
    : normalizeManualInput(manualControl, previousControlState.smoothedInput);
  const smoothedInput = {
    throttle: smoothInputAxis(previousControlState.smoothedInput.throttle, rawInput.throttle,
      deltaTimeSec, controller.throttleRiseRatePerSec, controller.throttleFallRatePerSec),
    pitch: smoothInputAxis(previousControlState.smoothedInput.pitch, rawInput.pitch,
      deltaTimeSec, controller.inputRiseRatePerSec, controller.inputFallRatePerSec),
    yaw: smoothInputAxis(previousControlState.smoothedInput.yaw, rawInput.yaw,
      deltaTimeSec, controller.inputRiseRatePerSec, controller.inputFallRatePerSec),
    roll: smoothInputAxis(previousControlState.smoothedInput.roll, rawInput.roll,
      deltaTimeSec, controller.inputRiseRatePerSec, controller.inputFallRatePerSec),
  };
  const previousVelocity = {
    x: entity.vx ?? entity.velocity?.eastMps ?? 0,
    y: entity.vy ?? entity.velocity?.northMps ?? 0,
    z: entity.vz ?? entity.velocity?.upMps ?? 0,
  };
  const previousSpeedMps = Math.hypot(previousVelocity.x, previousVelocity.y, previousVelocity.z);
  const turnAuthority = getTurnAuthority(profile, previousSpeedMps);
  const targetLaunchPitch = 90
    + ((profile.launch?.exitPitchDeg ?? 7) - 90) * launchProgress;
  const rollStabilization = entity.cameraMode === CONTROLLABLE_CAMERA_MODE.THIRD_PERSON
    ? controller.thirdPersonRollStabilizationPerSec
    : controller.fpvRollStabilizationPerSec;
  const desiredRatesDegPerSec = launchActive ? {
    pitch: clamp((targetLaunchPitch - entity.pitch) * 5,
      -profile.pitchRateDegPerSec * 1.6, profile.pitchRateDegPerSec * 1.6),
    yaw: 0,
    roll: -entity.roll * 2.4,
  } : {
    pitch: smoothedInput.pitch * profile.pitchRateDegPerSec * turnAuthority
      - (Math.abs(smoothedInput.pitch) < 0.02
        ? entity.pitch * controller.pitchStabilizationPerSec : 0),
    yaw: smoothedInput.yaw * profile.yawRateDegPerSec * turnAuthority,
    roll: Math.abs(smoothedInput.roll) >= 0.02
      ? smoothedInput.roll * profile.rollRateDegPerSec * turnAuthority
      : -entity.roll * rollStabilization,
  };
  const previousRates = entity.angularVelocity ?? previousControlState.actualRatesDegPerSec;
  const actualRatesDegPerSec = {
    pitch: approach(previousRates.pitch, desiredRatesDegPerSec.pitch,
      controller.pitchAngularAccelerationDegPerSec2 * deltaTimeSec),
    yaw: approach(previousRates.yaw, desiredRatesDegPerSec.yaw,
      controller.yawAngularAccelerationDegPerSec2 * deltaTimeSec),
    roll: approach(previousRates.roll, desiredRatesDegPerSec.roll,
      controller.rollAngularAccelerationDegPerSec2 * deltaTimeSec),
  };
  const angularDamping = Math.exp(-controller.angularDampingPerSec * deltaTimeSec);
  for (const axis of ['pitch', 'yaw', 'roll']) {
    if (Math.abs(desiredRatesDegPerSec[axis]) < 0.01) actualRatesDegPerSec[axis] *= angularDamping;
  }
  const transitionComplete = launchActive && launchProgress >= 1;
  const pitchLimit = launchActive ? 90 : profile.maximumPitchDeg;
  let pitch = clamp(entity.pitch + actualRatesDegPerSec.pitch * deltaTimeSec,
    -pitchLimit, pitchLimit);
  if (transitionComplete) {
    // Release the temporary tail-sitter pitch-over command cleanly. Carrying
    // its high angular rate into manual flight produced an uncommanded dive.
    actualRatesDegPerSec.pitch *= 0.15;
  }
  const roll = clamp(entity.roll + actualRatesDegPerSec.roll * deltaTimeSec,
    -profile.maximumRollDeg, profile.maximumRollDeg);
  const bankYawRate = Math.sin(roll * Math.PI / 180)
    * profile.yawRateDegPerSec * 0.12 * turnAuthority;
  const heading = normalizeHeading(entity.heading
    + (actualRatesDegPerSec.yaw + bankYawRate) * deltaTimeSec);
  const orientationQuaternion = createOrientationQuaternion(heading, pitch, roll);
  const body = getBodyAxesFromQuaternion(orientationQuaternion);

  const maneuverDemand = Math.min(1, Math.hypot(
    smoothedInput.pitch, smoothedInput.yaw, smoothedInput.roll,
  ) / Math.sqrt(3));
  const throttleDemand = smoothedInput.throttle;
  const priorBatteryRemaining = entity.stateOfCharge ?? entity.batteryRemaining ?? 1;
  const powerAvailable = priorBatteryRemaining > 0;

  const thrustN = powerAvailable ? physics.maximumThrustN * throttleDemand : 0;
  const dragScale = physics.quadraticDragCoefficient * previousSpeedMps;
  const weightN = physics.massKg * physics.gravityMps2;
  const liftN = Math.min(
    weightN * physics.maximumLiftWeightRatio,
    physics.liftCoefficient * previousSpeedMps ** 2,
  );
  const acceleration = {
    x: (body.forward.x * thrustN + body.up.x * liftN
      - previousVelocity.x * dragScale) / physics.massKg,
    y: (body.forward.y * thrustN + body.up.y * liftN
      - previousVelocity.y * dragScale) / physics.massKg,
    z: (body.forward.z * thrustN + body.up.z * liftN
      - previousVelocity.z * dragScale) / physics.massKg - physics.gravityMps2,
  };
  const electricalState = getElectricalState(
    entity,
    profile,
    throttleDemand,
    maneuverDemand,
    body.forward.z * throttleDemand,
    deltaTimeSec,
    powerAvailable,
  );
  const velocity = {
    x: previousVelocity.x + acceleration.x * deltaTimeSec,
    y: previousVelocity.y + acceleration.y * deltaTimeSec,
    z: previousVelocity.z + acceleration.z * deltaTimeSec,
  };
  let speedMps = Math.hypot(velocity.x, velocity.y, velocity.z);
  if (speedMps > physics.integrationSpeedLimitMps) {
    const scale = physics.integrationSpeedLimitMps / speedMps;
    velocity.x *= scale;
    velocity.y *= scale;
    velocity.z *= scale;
    speedMps = physics.integrationSpeedLimitMps;
  }
  const currentPosition = getWorldPosition(entity);
  const horizontalSpeedMps = Math.hypot(velocity.x, velocity.y);
  const travelHeading = horizontalSpeedMps > 0.001
    ? normalizeHeading(Math.atan2(velocity.x, velocity.y) * 180 / Math.PI)
    : heading;
  const destination = getDestinationPoint(currentPosition.lat, currentPosition.lng,
    travelHeading, horizontalSpeedMps * deltaTimeSec / 1000);
  const unclampedAltitudeM = entity.altitudeM + velocity.z * deltaTimeSec;
  const crashed = unclampedAltitudeM <= 0;
  const altitudeM = Math.max(0, unclampedAltitudeM);
  const worldPosition = createWorldPosition(destination.lat, destination.lng, altitudeM);
  const status = crashed
    ? CONTROLLABLE_STATUS.CRASHED
    : electricalState.batteryRemaining <= 0
      ? CONTROLLABLE_STATUS.BATTERY_DEPLETED : CONTROLLABLE_STATUS.ACTIVE;
  return {
    ...entity,
    position: { lat: worldPosition.lat, lng: worldPosition.lng, lon: worldPosition.lon },
    worldPosition,
    altitudeM,
    vx: velocity.x,
    vy: velocity.y,
    vz: velocity.z,
    eastMps: velocity.x,
    northMps: velocity.y,
    upMps: velocity.z,
    velocity: {
      vx: velocity.x, vy: velocity.y, vz: velocity.z,
      eastMps: velocity.x, northMps: velocity.y, upMps: velocity.z,
      speedKmh: speedMps * 3.6,
      heading: travelHeading,
      flightPathAngleDeg: Math.atan2(velocity.z, Math.max(0.001, horizontalSpeedMps)) * 180 / Math.PI,
    },
    acceleration,
    speedMps,
    speedKmh: speedMps * 3.6,
    heading,
    pitch,
    roll,
    angularVelocity: actualRatesDegPerSec,
    orientationQuaternion,
    ...electricalState,
    currentMechanicalPowerKw: thrustN * Math.max(0,
      previousVelocity.x * body.forward.x
      + previousVelocity.y * body.forward.y
      + previousVelocity.z * body.forward.z,
    ) / 1000,
    throttleDemand,
    highPowerState: throttleDemand > 0.82 || maneuverDemand > 0.72,
    flightTimeSec: (entity.flightTimeSec ?? 0) + deltaTimeSec,
    forceTelemetry: {
      massKg: physics.massKg,
      thrustN,
      dragN: physics.quadraticDragCoefficient * previousSpeedMps ** 2,
      liftN,
      gravityN: weightN,
    },
    status,
    flightPhase: transitionComplete || !launchActive
      ? CONTROLLABLE_FLIGHT_PHASE.MANUAL_FLIGHT
      : launchProgress > 0
        ? CONTROLLABLE_FLIGHT_PHASE.TRANSITION
        : CONTROLLABLE_FLIGHT_PHASE.LAUNCH,
    launchElapsedSec,
    manualControlEnabled: entity.manualControlEnabled || transitionComplete,
    controlState: {
      rawInput,
      smoothedInput,
      desiredRatesDegPerSec,
      actualRatesDegPerSec,
      turnAuthority,
    },
    lastUpdateTime: entity.lastUpdateTime + deltaTimeSec,
    lastCollision: crashed ? { kind: 'GROUND', at: entity.lastUpdateTime + deltaTimeSec } : null,
  };
};

export function createControllableAirEntity({
  id,
  profileId = CONTROLLABLE_AIR_PROFILE_IDS.TEST_PLACEHOLDER,
  subtype = 'TEST_PLACEHOLDER',
  sourceId = null,
  initialPosition,
  initialOrientation = {},
  selectedTrackId = null,
  simulationTime = 0,
}) {
  const profile = getControllableAirProfile(profileId);
  const altitudeM = Math.max(1, initialPosition.altitudeM ?? 120);
  const heading = normalizeHeading(initialOrientation.heading ?? 0);
  const hasLaunchTransition = profile.launch?.enabled === true;
  const pitch = hasLaunchTransition ? 90 : clamp(initialOrientation.pitch ?? 0,
    -profile.maximumPitchDeg, profile.maximumPitchDeg);
  const roll = clamp(initialOrientation.roll ?? 0,
    -profile.maximumRollDeg, profile.maximumRollDeg);
  const speedMps = clamp(hasLaunchTransition
    ? profile.launch.verticalSpeedMps
    : initialOrientation.speedMps ?? profile.initialSpeedMps,
    profile.minimumSpeedMps, profile.maximumSpeedMps);
  const worldPosition = createWorldPosition(initialPosition.lat, initialPosition.lng, altitudeM);
  const initialVelocity = createVelocity(speedMps, heading, pitch);
  return {
    id,
    entityType: CONTROLLABLE_AIR_ENTITY_TYPE,
    subtype: profile.subtype ?? subtype,
    displayName: profile.displayName,
    profileId: profile.id,
    position: { lat: worldPosition.lat, lng: worldPosition.lng, lon: worldPosition.lon },
    worldPosition,
    altitudeM,
    ...initialVelocity,
    velocity: {
      vx: initialVelocity.vx,
      vy: initialVelocity.vy,
      vz: initialVelocity.vz,
      eastMps: initialVelocity.eastMps,
      northMps: initialVelocity.northMps,
      upMps: initialVelocity.upMps,
      speedKmh: initialVelocity.speedKmh,
      heading,
      flightPathAngleDeg: pitch,
    },
    speedMps,
    heading,
    pitch,
    roll,
    orientationQuaternion: createOrientationQuaternion(heading, pitch, roll),
    controlMode: CONTROLLABLE_CONTROL_MODE.MANUAL,
    cameraMode: CONTROLLABLE_CAMERA_MODE.THIRD_PERSON,
    launchSourceId: sourceId,
    batteryRemaining: 1,
    stateOfCharge: 1,
    batteryCapacityWh: profile.battery?.capacityWh ?? null,
    batteryRemainingWh: profile.battery?.capacityWh ?? null,
    nominalVoltageV: profile.battery?.nominalVoltageV ?? null,
    batteryVoltageV: profile.battery?.fullVoltageV ?? null,
    currentPowerKw: 0,
    currentAmps: 0,
    linkQuality: 1,
    selectedTrackId,
    status: CONTROLLABLE_STATUS.ACTIVE,
    flightPhase: hasLaunchTransition
      ? CONTROLLABLE_FLIGHT_PHASE.LAUNCH
      : CONTROLLABLE_FLIGHT_PHASE.MANUAL_FLIGHT,
    launchElapsedSec: 0,
    manualControlEnabled: !hasLaunchTransition,
    controlState: createInitialControlState(profile, speedMps),
    angularVelocity: { pitch: 0, yaw: 0, roll: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    throttleDemand: 0,
    currentMechanicalPowerKw: 0,
    flightTimeSec: 0,
    highPowerState: false,
    forceTelemetry: profile.flightPhysics ? {
      massKg: profile.flightPhysics.massKg,
      thrustN: 0,
      dragN: 0,
      liftN: 0,
      gravityN: profile.flightPhysics.massKg * profile.flightPhysics.gravityMps2,
    } : null,
    collisionRadiusM: profile.collisionRadiusM,
    createdAt: simulationTime,
    lastUpdateTime: simulationTime,
    lastCollision: null,
  };
}

export function advanceControllableAirEntity(entity, deltaTimeSec, manualControl = null) {
  if (![CONTROLLABLE_STATUS.ACTIVE, CONTROLLABLE_STATUS.BATTERY_DEPLETED]
    .includes(entity.status) || deltaTimeSec <= 0) return entity;
  const profile = getControllableAirProfile(entity.profileId);
  if (profile.flightPhysics && profile.controller) {
    return advanceForceBasedEntity(entity, deltaTimeSec, manualControl, profile);
  }
  if (profile.launch?.enabled && !entity.manualControlEnabled) {
    const launchElapsedSec = (entity.launchElapsedSec ?? 0) + deltaTimeSec;
    const pitchOverElapsedSec = Math.max(0, launchElapsedSec - profile.launch.verticalClimbSec);
    const pitchOverProgress = clamp(
      pitchOverElapsedSec / Math.max(0.01, profile.launch.pitchOverSec),
      0,
      1,
    );
    const pitch = 90 + (profile.launch.exitPitchDeg - 90) * pitchOverProgress;
    const speedMps = approach(
      entity.speedMps,
      profile.initialSpeedMps,
      profile.forwardAccelerationMps2 * deltaTimeSec,
    );
    const velocity = createVelocity(speedMps, entity.heading, pitch);
    const currentPosition = getWorldPosition(entity);
    const horizontalDistanceKm = Math.hypot(velocity.vx, velocity.vy) * deltaTimeSec / 1000;
    const destination = getDestinationPoint(
      currentPosition.lat,
      currentPosition.lng,
      entity.heading,
      horizontalDistanceKm,
    );
    const altitudeM = entity.altitudeM + velocity.vz * deltaTimeSec;
    const worldPosition = createWorldPosition(destination.lat, destination.lng, altitudeM);
    const transitionComplete = pitchOverProgress >= 1;
    return {
      ...entity,
      position: { lat: worldPosition.lat, lng: worldPosition.lng, lon: worldPosition.lon },
      worldPosition,
      altitudeM,
      ...velocity,
      speedMps,
      heading: entity.heading,
      pitch,
      roll: 0,
      flightPhase: transitionComplete
        ? CONTROLLABLE_FLIGHT_PHASE.MANUAL_FLIGHT
        : pitchOverElapsedSec > 0
          ? CONTROLLABLE_FLIGHT_PHASE.TRANSITION
          : CONTROLLABLE_FLIGHT_PHASE.LAUNCH,
      launchElapsedSec,
      manualControlEnabled: transitionComplete,
      controlState: transitionComplete
        ? createInitialControlState(profile, speedMps)
        : entity.controlState,
      flightTimeSec: (entity.flightTimeSec ?? 0) + deltaTimeSec,
      lastUpdateTime: entity.lastUpdateTime + deltaTimeSec,
    };
  }
  const controller = profile.controller;
  const previousControlState = entity.controlState ?? createInitialControlState(
    profile,
    entity.speedMps,
  );
  const rawInput = normalizeManualInput(manualControl, previousControlState.smoothedInput);
  const smoothedInput = controller ? {
    throttle: smoothInputAxis(
      previousControlState.smoothedInput.throttle,
      rawInput.throttle,
      deltaTimeSec,
      controller.throttleRiseRatePerSec,
      controller.throttleFallRatePerSec,
    ),
    pitch: smoothInputAxis(previousControlState.smoothedInput.pitch, rawInput.pitch,
      deltaTimeSec, controller.inputRiseRatePerSec, controller.inputFallRatePerSec),
    yaw: smoothInputAxis(previousControlState.smoothedInput.yaw, rawInput.yaw,
      deltaTimeSec, controller.inputRiseRatePerSec, controller.inputFallRatePerSec),
    roll: smoothInputAxis(previousControlState.smoothedInput.roll, rawInput.roll,
      deltaTimeSec, controller.inputRiseRatePerSec, controller.inputFallRatePerSec),
  } : rawInput;
  const throttle = smoothedInput.throttle;
  const desiredSpeedMps = profile.minimumSpeedMps
    + (profile.maximumSpeedMps - profile.minimumSpeedMps) * throttle;
  const accelerationMps2 = desiredSpeedMps >= entity.speedMps
    ? profile.forwardAccelerationMps2
    : profile.brakingAccelerationMps2;
  const dragLossMps = Math.max(0, entity.speedMps - profile.minimumSpeedMps)
    * profile.dragPerSec * deltaTimeSec;
  const speedMps = clamp(
    approach(entity.speedMps, desiredSpeedMps, accelerationMps2 * deltaTimeSec) - dragLossMps,
    profile.minimumSpeedMps,
    profile.maximumSpeedMps,
  );
  const turnAuthority = getTurnAuthority(profile, speedMps);
  const rollStabilization = entity.cameraMode === CONTROLLABLE_CAMERA_MODE.THIRD_PERSON
    ? controller?.thirdPersonRollStabilizationPerSec ?? 0
    : controller?.fpvRollStabilizationPerSec ?? 0;
  const desiredRatesDegPerSec = {
    pitch: smoothedInput.pitch * profile.pitchRateDegPerSec * turnAuthority
      - (Math.abs(smoothedInput.pitch) < 0.02
        ? entity.pitch * (controller?.pitchStabilizationPerSec ?? 0)
        : 0),
    yaw: smoothedInput.yaw * profile.yawRateDegPerSec * turnAuthority,
    roll: Math.abs(smoothedInput.roll) >= 0.02
      ? smoothedInput.roll * profile.rollRateDegPerSec * turnAuthority
      : -entity.roll * rollStabilization,
  };
  const previousRates = previousControlState.actualRatesDegPerSec;
  const actualRatesDegPerSec = controller ? {
    pitch: approach(previousRates.pitch, desiredRatesDegPerSec.pitch,
      controller.pitchAngularAccelerationDegPerSec2 * deltaTimeSec),
    yaw: approach(previousRates.yaw, desiredRatesDegPerSec.yaw,
      controller.yawAngularAccelerationDegPerSec2 * deltaTimeSec),
    roll: approach(previousRates.roll, desiredRatesDegPerSec.roll,
      controller.rollAngularAccelerationDegPerSec2 * deltaTimeSec),
  } : desiredRatesDegPerSec;
  let pitch = clamp(entity.pitch + actualRatesDegPerSec.pitch * deltaTimeSec,
    -profile.maximumPitchDeg, profile.maximumPitchDeg);
  let roll = clamp(entity.roll + actualRatesDegPerSec.roll * deltaTimeSec,
    -profile.maximumRollDeg, profile.maximumRollDeg);
  if (Math.abs(pitch) >= profile.maximumPitchDeg
    && Math.sign(actualRatesDegPerSec.pitch) === Math.sign(pitch)) {
    actualRatesDegPerSec.pitch = 0;
  }
  if (Math.abs(roll) >= profile.maximumRollDeg
    && Math.sign(actualRatesDegPerSec.roll) === Math.sign(roll)) {
    actualRatesDegPerSec.roll = 0;
  }
  const bankYawRate = Math.sin(roll * Math.PI / 180)
    * profile.yawRateDegPerSec * 0.18 * turnAuthority;
  const heading = normalizeHeading(entity.heading
    + (actualRatesDegPerSec.yaw + bankYawRate) * deltaTimeSec);
  const velocity = createVelocity(speedMps, heading, pitch);
  const currentPosition = getWorldPosition(entity);
  const horizontalDistanceKm = Math.hypot(velocity.vx, velocity.vy) * deltaTimeSec / 1000;
  const destination = getDestinationPoint(
    currentPosition.lat,
    currentPosition.lng,
    heading,
    horizontalDistanceKm,
  );
  const unclampedAltitudeM = entity.altitudeM + velocity.vz * deltaTimeSec;
  const batteryRemaining = Math.max(0,
    entity.batteryRemaining - profile.batteryDrainPerSec * deltaTimeSec);
  const crashed = unclampedAltitudeM <= 0;
  const depleted = batteryRemaining <= 0;
  const altitudeM = Math.max(0, unclampedAltitudeM);
  const status = crashed
    ? CONTROLLABLE_STATUS.CRASHED
    : depleted ? CONTROLLABLE_STATUS.BATTERY_DEPLETED : CONTROLLABLE_STATUS.ACTIVE;
  const worldPosition = createWorldPosition(destination.lat, destination.lng, altitudeM);
  return {
    ...entity,
    position: { lat: worldPosition.lat, lng: worldPosition.lng, lon: worldPosition.lon },
    worldPosition,
    altitudeM,
    ...velocity,
    speedMps: status === CONTROLLABLE_STATUS.ACTIVE ? speedMps : 0,
    speedKmh: status === CONTROLLABLE_STATUS.ACTIVE ? velocity.speedKmh : 0,
    heading,
    pitch,
    roll,
    batteryRemaining,
    flightTimeSec: (entity.flightTimeSec ?? 0) + deltaTimeSec,
    status,
    controlState: {
      rawInput,
      smoothedInput,
      desiredRatesDegPerSec,
      actualRatesDegPerSec,
      turnAuthority,
    },
    lastUpdateTime: entity.lastUpdateTime + deltaTimeSec,
    lastCollision: crashed ? { kind: 'GROUND', at: entity.lastUpdateTime + deltaTimeSec } : null,
  };
}

export function hasFiniteControllableState(entity) {
  return [
    entity.position?.lat, entity.position?.lng, entity.altitudeM,
    entity.vx, entity.vy, entity.vz, entity.speedMps,
    entity.heading, entity.pitch, entity.roll,
    entity.orientationQuaternion?.x, entity.orientationQuaternion?.y,
    entity.orientationQuaternion?.z, entity.orientationQuaternion?.w,
    entity.angularVelocity?.pitch, entity.angularVelocity?.yaw,
    entity.angularVelocity?.roll,
    entity.acceleration?.x, entity.acceleration?.y, entity.acceleration?.z,
  ].every(Number.isFinite);
}
