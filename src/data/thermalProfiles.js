// Render-oriented gameplay values. They are not calibrated real temperatures.
const profile = (body, engine, exhaust, aeroHeating = 0.08, coolingRate = 0.72) => Object.freeze({
  bodyHeat: body, engineHeat: engine, exhaustHeat: exhaust, aeroHeating, coolingRate,
  pseudoTemperatureK: {
    body: Math.round(285 + body * 75),
    engine: Math.round(310 + engine * 300),
    exhaust: Math.round(330 + exhaust * 650),
  },
});

export const THERMAL_PROFILES = Object.freeze({
  GERAN_2: profile(0.3, 0.68, 0.56, 0.05),
  GERBERA: profile(0.22, 0.52, 0.38, 0.04),
  KALIBR: profile(0.42, 0.82, 0.88, 0.12),
  KH_555: profile(0.42, 0.82, 0.88, 0.12),
  ISKANDER_M: profile(0.52, 0.92, 1, 0.2),
  AIM_120_C7: profile(0.44, 0.9, 0.96, 0.14),
  IRIS_T_SLM: profile(0.44, 0.9, 0.96, 0.14),
  PAC3_CRI_VISUAL: profile(0.5, 0.94, 1, 0.16),
  ASTER_30: profile(0.5, 0.94, 1, 0.16),
  SKYFALL_P1_SUN: profile(0.28, 0.64, 0.48, 0.05),
  DEFAULT_TARGET: profile(0.34, 0.64, 0.56),
  DEFAULT_INTERCEPTOR: profile(0.48, 0.9, 0.96),
});

export const getThermalProfile = (presentationKey, kind) => (
  THERMAL_PROFILES[presentationKey]
  ?? (kind === 'INTERCEPTOR' ? THERMAL_PROFILES.DEFAULT_INTERCEPTOR
    : THERMAL_PROFILES.DEFAULT_TARGET)
);

export const thermalLuminance = (thermalProfile, speedKmh = 0) => {
  const speedHeat = Math.min(1, Math.max(0, speedKmh / 2_000))
    * thermalProfile.aeroHeating;
  const heat = Math.min(1, thermalProfile.bodyHeat + speedHeat);
  return 0.12 + 0.72 * (heat / (heat + 0.32));
};
