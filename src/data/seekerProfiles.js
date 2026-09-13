export const SEEKER_TYPE = Object.freeze({
  NONE: 'NONE',
  IR: 'IR',
  ACTIVE_RADAR: 'ACTIVE_RADAR',
});

export const SEEKER_STATE = Object.freeze({
  OFF: 'OFF',
  WARMUP: 'WARMUP',
  SEARCH: 'SEARCH',
  ACQUIRED: 'ACQUIRED',
  TERMINAL: 'TERMINAL',
  LOST: 'LOST',
});

export const SEEKER_REFERENCE_SOURCE = Object.freeze({
  WAR_THUNDER_GAMEPLAY_DATAMINE: 'WAR_THUNDER_GAMEPLAY_DATAMINE',
  GAMEPLAY_ESTIMATE: 'GAMEPLAY_ESTIMATE',
});

export const SEEKER_PROFILE_ID = Object.freeze({
  NONE: 'NONE',
  IRIS_T_SLM: 'IRIS_T_SLM_GAMEPLAY_IR_V1',
  AIM_120C7: 'AIM_120C7_GAMEPLAY_ARH_V1',
  ASTER_30: 'ASTER_30_GAMEPLAY_ARH_V1',
  PAC3_MSE: 'PAC3_MSE_GAMEPLAY_ARH_V1',
});

const profile = config => Object.freeze({
  acquisitionThreshold: 0.68,
  lostThreshold: 0.24,
  terminalConfirmationSec: 0.15,
  seekerMeasurementIntervalSec: 0.05,
  acquisitionEvidenceRate: 1.35,
  reacquisitionEvidenceRate: 1.05,
  lossEvidenceRate: 0.72,
  signatureSensitivity: 1,
  aspectSensitivity: 1,
  datalinkReconnect: false,
  ...config,
  reference: Object.freeze({ ...config.reference }),
});

export const SEEKER_PROFILES = Object.freeze({
  [SEEKER_PROFILE_ID.NONE]: profile({
    id: SEEKER_PROFILE_ID.NONE,
    seekerType: SEEKER_TYPE.NONE,
    warmupSec: 0,
    seekerActivationRangeKm: 0,
    baselineLockRangeKm: 0,
    hardMaxLockRangeKm: 0,
    fovDeg: 0,
    gimbalLimitDeg: 0,
    trackRateDegSec: 0,
    searchDurationSec: 0,
    breakLockMemorySec: 0,
    lockAfterLaunch: false,
    datalink: false,
    reference: {
      source: SEEKER_REFERENCE_SOURCE.GAMEPLAY_ESTIMATE,
      note: 'No terminal seeker.',
    },
  }),
  [SEEKER_PROFILE_ID.IRIS_T_SLM]: profile({
    id: SEEKER_PROFILE_ID.IRIS_T_SLM,
    seekerType: SEEKER_TYPE.IR,
    warmupSec: 0.1,
    seekerActivationRangeKm: 10,
    baselineLockRangeKm: 9,
    baselineRearLockRangeKm: 12,
    hardMaxLockRangeKm: 20,
    fovDeg: 5,
    gimbalLimitDeg: 90,
    trackRateDegSec: 60,
    searchDurationSec: 20,
    breakLockMemorySec: 1.25,
    lockAfterLaunch: true,
    datalink: true,
    acquisitionEvidenceRate: 1.6,
    reacquisitionEvidenceRate: 1.25,
    lossEvidenceRate: 0.82,
    signatureSensitivity: 1.12,
    aspectSensitivity: 1.2,
    reference: {
      source: SEEKER_REFERENCE_SOURCE.WAR_THUNDER_GAMEPLAY_DATAMINE,
      note: 'User-supplied War Thunder table; gameplay reference, not real performance data.',
    },
  }),
  [SEEKER_PROFILE_ID.AIM_120C7]: profile({
    id: SEEKER_PROFILE_ID.AIM_120C7,
    seekerType: SEEKER_TYPE.ACTIVE_RADAR,
    warmupSec: 0.3,
    seekerActivationRangeKm: 20,
    baselineLockRangeKm: 16,
    hardMaxLockRangeKm: 25,
    fovDeg: 7,
    gimbalLimitDeg: 55,
    trackRateDegSec: 60,
    searchDurationSec: 100,
    breakLockMemorySec: 1.8,
    lockAfterLaunch: true,
    datalink: true,
    acquisitionEvidenceRate: 1.35,
    reacquisitionEvidenceRate: 1.05,
    lossEvidenceRate: 0.68,
    signatureSensitivity: 1,
    aspectSensitivity: 0.35,
    reference: {
      source: SEEKER_REFERENCE_SOURCE.WAR_THUNDER_GAMEPLAY_DATAMINE,
      note: 'User-supplied War Thunder table; gameplay reference, not real performance data.',
    },
  }),
  [SEEKER_PROFILE_ID.ASTER_30]: profile({
    id: SEEKER_PROFILE_ID.ASTER_30,
    seekerType: SEEKER_TYPE.ACTIVE_RADAR,
    warmupSec: 0.5,
    seekerActivationRangeKm: 20,
    baselineLockRangeKm: 16,
    hardMaxLockRangeKm: 25,
    fovDeg: 7,
    gimbalLimitDeg: 55,
    trackRateDegSec: 60,
    searchDurationSec: 120,
    breakLockMemorySec: 2,
    lockAfterLaunch: true,
    datalink: true,
    acquisitionEvidenceRate: 1.4,
    reacquisitionEvidenceRate: 1.1,
    lossEvidenceRate: 0.66,
    signatureSensitivity: 1.02,
    aspectSensitivity: 0.35,
    reference: {
      source: SEEKER_REFERENCE_SOURCE.WAR_THUNDER_GAMEPLAY_DATAMINE,
      note: 'User-supplied War Thunder table; gameplay reference, not real performance data.',
    },
  }),
  [SEEKER_PROFILE_ID.PAC3_MSE]: profile({
    id: SEEKER_PROFILE_ID.PAC3_MSE,
    seekerType: SEEKER_TYPE.ACTIVE_RADAR,
    warmupSec: 0.4,
    seekerActivationRangeKm: 15,
    baselineLockRangeKm: 12,
    hardMaxLockRangeKm: 20,
    fovDeg: 7,
    gimbalLimitDeg: 55,
    trackRateDegSec: 60,
    searchDurationSec: 60,
    breakLockMemorySec: 1.6,
    lockAfterLaunch: true,
    datalink: true,
    acquisitionEvidenceRate: 1.45,
    reacquisitionEvidenceRate: 1.1,
    lossEvidenceRate: 0.7,
    signatureSensitivity: 1.05,
    aspectSensitivity: 0.35,
    reference: {
      source: SEEKER_REFERENCE_SOURCE.GAMEPLAY_ESTIMATE,
      note: 'Configurable gameplay estimate; not asserted as real PAC-3 MSE seeker performance.',
    },
  }),
});

export const INTERCEPTOR_SEEKER_PROFILE = Object.freeze({
  'INT-SHORT-V1': SEEKER_PROFILE_ID.IRIS_T_SLM,
  'INT-MEDIUM-V1': SEEKER_PROFILE_ID.AIM_120C7,
  'INT-ASTER30-V1': SEEKER_PROFILE_ID.ASTER_30,
  'INT-LONG-V1': SEEKER_PROFILE_ID.PAC3_MSE,
});

export const getSeekerProfile = profileId => SEEKER_PROFILES[profileId]
  ?? SEEKER_PROFILES[SEEKER_PROFILE_ID.NONE];

export const getInterceptorSeekerProfile = interceptorSpecId => getSeekerProfile(
  INTERCEPTOR_SEEKER_PROFILE[interceptorSpecId] ?? SEEKER_PROFILE_ID.NONE,
);
