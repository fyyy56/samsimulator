/**
 * Abstract COMMAND-mode sensor values. These are deliberately gameplay values,
 * not real radar cross-sections or classified equipment characteristics.
 */

export const SENSOR_EVIDENCE_CONFIG = Object.freeze({
  thresholds: Object.freeze({
    detected: 0.22,
    tracked: 0.52,
    identified: 0.84,
  }),
  maximumEvidence: 1,
  evidenceDecayDelaySec: 4,
  evidenceDecayPerSec: 0.012,
  confirmedEvidenceDecayMultiplier: 0.65,
  reacquisitionMemorySec: 30,
  reacquisitionEvidenceFloorFraction: 0.55,
  reacquisitionContributionMultiplier: 1.4,
  knownContactContributionMultiplier: 1.1,
  staleContactRetentionSec: 45,
  trackCoastTimeSec: 6.5,
  secondarySensorFusionWeight: 0.28,
  networkHandoffEvidenceRetention: 0.75,
  networkHandoffEvidenceFloorFraction: 0.96,
});

export const RADAR_SENSOR_PROFILE_ID = Object.freeze({
  SHORT_MECHANICAL: 'SHORT_MECHANICAL',
  MEDIUM_MECHANICAL: 'MEDIUM_MECHANICAL',
  LONG_ELECTRONIC: 'LONG_ELECTRONIC',
  GENERIC_MECHANICAL: 'GENERIC_MECHANICAL',
  GENERIC_ELECTRONIC: 'GENERIC_ELECTRONIC',
});

export const RADAR_SENSOR_PROFILES = Object.freeze({
  [RADAR_SENSOR_PROFILE_ID.SHORT_MECHANICAL]: Object.freeze({
    id: RADAR_SENSOR_PROFILE_ID.SHORT_MECHANICAL,
    contributionPerOpportunity: 0.32,
    maximumContributionPerOpportunity: 0.24,
    rangeFalloffExponent: 1.3,
    minimumRangeFactor: 0.2,
    altitudeFactors: Object.freeze({ LOW: 0.64, MEDIUM: 0.96, HIGH: 0.9 }),
  }),
  [RADAR_SENSOR_PROFILE_ID.MEDIUM_MECHANICAL]: Object.freeze({
    id: RADAR_SENSOR_PROFILE_ID.MEDIUM_MECHANICAL,
    contributionPerOpportunity: 0.34,
    maximumContributionPerOpportunity: 0.25,
    rangeFalloffExponent: 1.35,
    minimumRangeFactor: 0.22,
    altitudeFactors: Object.freeze({ LOW: 0.7, MEDIUM: 1, HIGH: 0.98 }),
  }),
  [RADAR_SENSOR_PROFILE_ID.LONG_ELECTRONIC]: Object.freeze({
    id: RADAR_SENSOR_PROFILE_ID.LONG_ELECTRONIC,
    contributionPerOpportunity: 0.09,
    maximumContributionPerOpportunity: 0.075,
    rangeFalloffExponent: 1.45,
    minimumRangeFactor: 0.24,
    altitudeFactors: Object.freeze({ LOW: 0.72, MEDIUM: 1, HIGH: 1.08 }),
  }),
  [RADAR_SENSOR_PROFILE_ID.GENERIC_MECHANICAL]: Object.freeze({
    id: RADAR_SENSOR_PROFILE_ID.GENERIC_MECHANICAL,
    contributionPerOpportunity: 0.3,
    maximumContributionPerOpportunity: 0.22,
    rangeFalloffExponent: 1.3,
    minimumRangeFactor: 0.2,
    altitudeFactors: Object.freeze({ LOW: 0.66, MEDIUM: 1, HIGH: 0.95 }),
  }),
  [RADAR_SENSOR_PROFILE_ID.GENERIC_ELECTRONIC]: Object.freeze({
    id: RADAR_SENSOR_PROFILE_ID.GENERIC_ELECTRONIC,
    contributionPerOpportunity: 0.085,
    maximumContributionPerOpportunity: 0.07,
    rangeFalloffExponent: 1.4,
    minimumRangeFactor: 0.22,
    altitudeFactors: Object.freeze({ LOW: 0.7, MEDIUM: 1, HIGH: 1.04 }),
  }),
});

export const RADAR_CATEGORY_SENSOR_PROFILE = Object.freeze({
  SHORT: RADAR_SENSOR_PROFILE_ID.SHORT_MECHANICAL,
  MEDIUM: RADAR_SENSOR_PROFILE_ID.MEDIUM_MECHANICAL,
  LONG: RADAR_SENSOR_PROFILE_ID.LONG_ELECTRONIC,
  GUN: RADAR_SENSOR_PROFILE_ID.SHORT_MECHANICAL,
});

export const TARGET_SENSOR_PROFILES = Object.freeze({
  UAV_TARGET: Object.freeze({
    classificationDifficulty: 1.12,
    identificationDifficulty: 1.18,
    broadClassification: 'UAV',
  }),
  CRUISE_TARGET: Object.freeze({
    classificationDifficulty: 1,
    identificationDifficulty: 1.04,
    broadClassification: 'CRUISE_MISSILE',
  }),
  BALLISTIC_TARGET: Object.freeze({
    classificationDifficulty: 0.9,
    identificationDifficulty: 0.94,
    broadClassification: 'BALLISTIC_MISSILE',
  }),
  DEFAULT: Object.freeze({
    sensorSignature: 0.58,
    classificationDifficulty: 1.08,
    identificationDifficulty: 1.12,
    broadClassification: 'AIR_TARGET',
  }),
});
