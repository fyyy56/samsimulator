export const BALLISTIC_PHASE = Object.freeze({
  BOOST: 'BOOST',
  ASCENT: 'ASCENT',
  MIDCOURSE: 'MIDCOURSE',
  DESCENT: 'DESCENT',
  TERMINAL: 'TERMINAL',
  IMPACT: 'IMPACT',
});

export const TERMINAL_CORRECTION_STATE = Object.freeze({
  OFF: 'OFF',
  WAITING: 'WAITING',
  ACTIVE: 'ACTIVE',
  RETURNING: 'RETURNING',
  COMPLETE: 'COMPLETE',
});

export const BALLISTIC_MANEUVER_MODE = Object.freeze({
  AUTO: 'AUTO',
  NONE: 'NONE',
});

export const BALLISTIC_TERMINAL_SOLUTION = Object.freeze({
  VALID: 'VALID',
  OVERSHOOT: 'OVERSHOOT',
  UNDERSHOOT: 'UNDERSHOOT',
  LOST: 'LOST',
});

// Configurable gameplay reference for the sandbox physics framework. These
// values are deliberately not presented as real Iskander engineering data.
export const SANDBOX_BALLISTIC_TEST_PROFILE = Object.freeze({
  id: 'SANDBOX_BALLISTIC_V2',
  displayName: 'Sandbox ballistic test vehicle',
  massKg: 3_800,
  fuelMassKg: 1_450,
  motorThrustN: 365_000,
  burnTimeSec: 21,
  minimumBurnTimeSec: 7.5,
  initialLaunchSpeedMps: 55,
  dragCoefficient: 0.24,
  referenceAreaM2: 0.48,
  seaLevelAirDensityKgM3: 1.225,
  atmosphereScaleHeightM: 8_500,
  gravityMps2: 9.81,
  maxControlG: 2.8,
  terminalControlAuthority: 0.72,
  terminalStartAltitudeM: 24_000,
  terminalStartDistanceKm: 42,
  terminalCorrectionDurationSec: 3.2,
  correctionReturnErrorThresholdM: 1_200,
  maneuverDragFactor: 0.018,
  impactAltitudeM: 20,
  impactDistanceM: 180,
  predictionIntervalSec: 0.25,
});

export const TERMINAL_CORRECTION_ANGLES = Object.freeze([0, 0.5, 1, 1.5, 2]);
export const TERMINAL_CORRECTION_COUNTS = Object.freeze([0, 1, 2]);
export const TERMINAL_CORRECTION_SIDES = Object.freeze(['AUTO', 'LEFT', 'RIGHT', 'RANDOM']);
