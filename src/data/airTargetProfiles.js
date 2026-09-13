import { LIGHT_TARGET_MODEL } from './lightTargetModels.js';

export const SIMPLE_TARGET_TYPE = Object.freeze({
  UAV: 'UAV_TARGET',
  CRUISE_MISSILE: 'CRUISE_TARGET',
  BALLISTIC_MISSILE: 'BALLISTIC_TARGET',
});

export const ROUTE_PATTERN = Object.freeze({
  DIRECT: 'DIRECT',
  OFFSET: 'OFFSET',
  WEAVING: 'WEAVING',
  GROUP: 'GROUP',
  CRUISE: 'CRUISE',
  BALLISTIC: 'BALLISTIC',
});

export const ALTITUDE_BAND = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
});

export const ALTITUDE_BAND_CONFIG = Object.freeze({
  lowMaxM: 1_000,
  mediumMaxM: 10_000,
});

export function getAltitudeBand(altitudeM) {
  const normalizedAltitudeM = Math.max(0, Number.isFinite(altitudeM) ? altitudeM : 0);
  if (normalizedAltitudeM <= ALTITUDE_BAND_CONFIG.lowMaxM) return ALTITUDE_BAND.LOW;
  if (normalizedAltitudeM <= ALTITUDE_BAND_CONFIG.mediumMaxM) return ALTITUDE_BAND.MEDIUM;
  return ALTITUDE_BAND.HIGH;
}

export const ROUTE_GENERATION_CONFIG = Object.freeze({
  maximumWaypointCount: 5,
  minimumDestinationCaptureKm: 0.15,
  groupFormationSpacingKm: 1.8,
  groupMaximumOffsetKm: 5.5,
  patterns: Object.freeze({
    [ROUTE_PATTERN.DIRECT]: Object.freeze({
      intermediateWaypointCount: Object.freeze([0, 1]),
      maximumLateralDeviationKm: 9,
      maximumTurnAngleDeg: 16,
      minimumWaypointSpacingKm: 45,
    }),
    [ROUTE_PATTERN.OFFSET]: Object.freeze({
      intermediateWaypointCount: Object.freeze([2, 2]),
      maximumLateralDeviationKm: 58,
      maximumTurnAngleDeg: 36,
      minimumWaypointSpacingKm: 42,
    }),
    [ROUTE_PATTERN.WEAVING]: Object.freeze({
      intermediateWaypointCount: Object.freeze([3, 4]),
      maximumLateralDeviationKm: 30,
      maximumTurnAngleDeg: 28,
      minimumWaypointSpacingKm: 34,
    }),
    [ROUTE_PATTERN.CRUISE]: Object.freeze({
      intermediateWaypointCount: Object.freeze([1, 2]),
      maximumLateralDeviationKm: 18,
      maximumTurnAngleDeg: 18,
      minimumWaypointSpacingKm: 70,
    }),
  }),
});

export const AIR_TARGET_GAMEPLAY_PROFILES = Object.freeze({
  [SIMPLE_TARGET_TYPE.UAV]: Object.freeze({
    models: Object.freeze([LIGHT_TARGET_MODEL.GERAN_2, LIGHT_TARGET_MODEL.GERBERA]),
    speedRangeKmh: Object.freeze([190, 310]),
    turnRateDegPerSec: 5.5,
    sensorSignature: 0.38,
    routePatterns: Object.freeze([
      ROUTE_PATTERN.DIRECT,
      ROUTE_PATTERN.OFFSET,
      ROUTE_PATTERN.WEAVING,
    ]),
    altitudeProfile: Object.freeze({
      startRangeM: Object.freeze([100, 260]),
      cruiseRangeM: Object.freeze([120, 500]),
      terminalRangeM: Object.freeze([90, 260]),
      maximumVerticalSpeedMps: 4.5,
      cruiseTransitionEndProgress: 0.16,
      terminalTransitionStartProgress: 0.82,
    }),
  }),
  [SIMPLE_TARGET_TYPE.CRUISE_MISSILE]: Object.freeze({
    models: Object.freeze([LIGHT_TARGET_MODEL.KH_555, LIGHT_TARGET_MODEL.KALIBR]),
    speedRangeKmh: Object.freeze([780, 820]),
    turnRateDegPerSec: 2.2,
    sensorSignature: 0.62,
    routePatterns: Object.freeze([
      ROUTE_PATTERN.DIRECT,
      ROUTE_PATTERN.OFFSET,
      ROUTE_PATTERN.CRUISE,
    ]),
    altitudeProfile: Object.freeze({
      startRangeM: Object.freeze([110, 190]),
      cruiseRangeM: Object.freeze([85, 125]),
      terminalRangeM: Object.freeze([60, 105]),
      maximumVerticalSpeedMps: 7,
      cruiseTransitionEndProgress: 0.12,
      terminalTransitionStartProgress: 0.86,
    }),
  }),
  [SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE]: Object.freeze({
    models: Object.freeze([LIGHT_TARGET_MODEL.ISKANDER_M]),
    speedRangeKmh: null,
    turnRateDegPerSec: 0,
    sensorSignature: 0.9,
    routePatterns: Object.freeze([ROUTE_PATTERN.BALLISTIC]),
    altitudeProfile: null,
  }),
});

const GERBERA_GAMEPLAY_PROFILE = Object.freeze({
  ...AIR_TARGET_GAMEPLAY_PROFILES[SIMPLE_TARGET_TYPE.UAV],
  models: Object.freeze([LIGHT_TARGET_MODEL.GERBERA]),
  speedRangeKmh: Object.freeze([140, 190]),
  turnRateDegPerSec: 2.2,
  altitudeProfile: Object.freeze({
    startRangeM: Object.freeze([100, 350]),
    cruiseRangeM: Object.freeze([100, 800]),
    terminalRangeM: Object.freeze([80, 400]),
    maximumVerticalSpeedMps: 2.5,
    cruiseTransitionEndProgress: 0.16,
    terminalTransitionStartProgress: 0.82,
  }),
});

export function getAirTargetGameplayProfile(type, modelId = null) {
  if (type === SIMPLE_TARGET_TYPE.UAV && modelId === LIGHT_TARGET_MODEL.GERBERA) {
    return GERBERA_GAMEPLAY_PROFILE;
  }
  return AIR_TARGET_GAMEPLAY_PROFILES[type] ?? AIR_TARGET_GAMEPLAY_PROFILES[SIMPLE_TARGET_TYPE.UAV];
}
