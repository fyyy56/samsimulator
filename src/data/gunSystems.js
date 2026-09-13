import { SIMPLE_TARGET_TYPE } from './airTargetProfiles.js';

export const WEAPON_SYSTEM_TYPE = Object.freeze({
  MISSILE: 'MISSILE',
  GUN_AA: 'GUN_AA',
});

export const GUN_SYSTEM_SPECS = Object.freeze({
  GEPARD_1A2: Object.freeze({
    id: 'GEPARD_1A2',
    displayName: 'Gepard 1A2',
    role: 'Ближняя защита от БПЛА',
    weaponLabel: '2×35 мм автоматические пушки',
    engagementRangeKm: 5,
    sensorRangeKm: 12,
    ammunitionRounds: 640,
    roundsPerBurst: 10,
    reactionTimeSec: 1.15,
    burstDurationSec: 0.8,
    burstCooldownSec: 5,
    reloadDurationSec: 20,
    muzzleVelocityMps: 1_175,
    projectileTimeTable: Object.freeze([
      Object.freeze({ distanceKm: 0, timeSec: 0 }),
      Object.freeze({ distanceKm: 1, timeSec: 1 }),
      Object.freeze({ distanceKm: 2, timeSec: 2.17 }),
      Object.freeze({ distanceKm: 4, timeSec: 6.05 }),
    ]),
    maximumTargetSpeedKmh: 1_100,
    requiredTrackQuality: 0.5,
    permittedTargetTypes: Object.freeze([
      SIMPLE_TARGET_TYPE.UAV,
      SIMPLE_TARGET_TYPE.CRUISE_MISSILE,
    ]),
  }),
  GAZ_DSHK: Object.freeze({
    id: 'GAZ_DSHK',
    displayName: 'Humvee MBG',
    role: 'Мобильная ближняя защита от БПЛА',
    weaponLabel: '12,7-мм пулемёт ДШК',
    engagementRangeKm: 1.5,
    sensorRangeKm: 4,
    ammunitionRounds: 150,
    roundsPerBurst: 8,
    reactionTimeSec: 1.8,
    burstDurationSec: 0.9,
    burstCooldownSec: 4,
    reloadDurationSec: 25,
    muzzleVelocityMps: 850,
    projectileTimeTable: Object.freeze([
      Object.freeze({ distanceKm: 0, timeSec: 0 }),
      Object.freeze({ distanceKm: 0.5, timeSec: 0.65 }),
      Object.freeze({ distanceKm: 1, timeSec: 1.45 }),
      Object.freeze({ distanceKm: 1.5, timeSec: 2.35 }),
    ]),
    maximumTargetSpeedKmh: 300,
    requiredTrackQuality: 0.62,
    permittedTargetTypes: Object.freeze([SIMPLE_TARGET_TYPE.UAV]),
  }),
});

export const getGunSystemSpec = specId => GUN_SYSTEM_SPECS[specId] ?? null;
