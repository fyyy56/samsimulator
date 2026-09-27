export const AIR_DEFENSE_PLATFORM = Object.freeze({
  PATRIOT: 'PATRIOT',
  NASAMS: 'NASAMS',
  IRIS_T_SLM: 'IRIS_T_SLM',
  GEPARD: 'GEPARD',
  SAMP_T: 'SAMP_T',
  GAZ_DSHK: 'GAZ_DSHK',
  TOR_M1: 'TOR_M1',
});

export const WEAPON_COMPATIBILITY = Object.freeze({
  [AIR_DEFENSE_PLATFORM.PATRIOT]: Object.freeze({
    category: 'LONG',
    launcherIds: Object.freeze(['M903']),
    interceptorSpecIds: Object.freeze(['INT-LONG-V1']),
  }),
  [AIR_DEFENSE_PLATFORM.NASAMS]: Object.freeze({
    category: 'MEDIUM',
    launcherIds: Object.freeze(['NASAMS_LAUNCHER']),
    interceptorSpecIds: Object.freeze(['INT-MEDIUM-V1']),
  }),
  [AIR_DEFENSE_PLATFORM.IRIS_T_SLM]: Object.freeze({
    category: 'SHORT',
    launcherIds: Object.freeze(['IRIS_T_SLM_LAUNCHER']),
    interceptorSpecIds: Object.freeze(['INT-SHORT-V1']),
  }),
  [AIR_DEFENSE_PLATFORM.GEPARD]: Object.freeze({
    category: 'GUN',
    launcherIds: Object.freeze(['GEPARD_1A2']),
    interceptorSpecIds: Object.freeze([]),
  }),
  [AIR_DEFENSE_PLATFORM.SAMP_T]: Object.freeze({
    category: 'SAMP_T',
    launcherIds: Object.freeze(['SAMP_T_LAUNCHER']),
    interceptorSpecIds: Object.freeze(['INT-ASTER30-V1']),
  }),
  [AIR_DEFENSE_PLATFORM.GAZ_DSHK]: Object.freeze({
    category: 'GAZ',
    launcherIds: Object.freeze(['GAZ_DSHK']),
    interceptorSpecIds: Object.freeze([]),
  }),
  [AIR_DEFENSE_PLATFORM.TOR_M1]: Object.freeze({
    category: 'TOR_M1',
    launcherIds: Object.freeze(['TOR_M1_UNIT']),
    interceptorSpecIds: Object.freeze(['INT-9M331-V1']),
  }),
});

const PLATFORM_BY_CATEGORY = Object.freeze(Object.fromEntries(
  Object.entries(WEAPON_COMPATIBILITY).map(([platformId, value]) => [value.category, platformId]),
));

export const getPlatformIdForCategory = category => PLATFORM_BY_CATEGORY[category] ?? null;

export const getPlatformIdForBattery = battery => (
  battery?.platformId
  ?? getPlatformIdForCategory(battery?.category)
  ?? null
);

export const getWeaponCompatibility = platformId => WEAPON_COMPATIBILITY[platformId] ?? null;

export const isInterceptorCompatible = (batteryOrPlatformId, interceptorSpecId) => {
  const platformId = typeof batteryOrPlatformId === 'string'
    ? batteryOrPlatformId
    : getPlatformIdForBattery(batteryOrPlatformId);
  return Boolean(
    interceptorSpecId
    && WEAPON_COMPATIBILITY[platformId]?.interceptorSpecIds.includes(interceptorSpecId),
  );
};
