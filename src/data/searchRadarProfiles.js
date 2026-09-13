import { RADAR_SCAN_TYPE } from '../store/radarSystem.js';
import { RADAR_SENSOR_PROFILE_ID } from './sensorDetectionProfiles.js';

export const SEARCH_RADAR_ENTITY_TYPE = 'SEARCH_RADAR';

/**
 * Public-inspired gameplay calibration. These values are not claimed real-world
 * performance figures; all sensor behaviour still passes through Radar V2.
 */
export const SEARCH_RADAR_PROFILES = Object.freeze({
  RADAR_P18: Object.freeze({
    id: 'RADAR_P18',
    entityType: SEARCH_RADAR_ENTITY_TYPE,
    displayName: 'П-18',
    englishName: 'P-18',
    debugName: 'P-18 EARLY WARNING 2D',
    role: 'EARLY_WARNING_2D',
    dimension: '2D',
    sensorProfileId: RADAR_SENSOR_PROFILE_ID.SEARCH_P18,
    nominalRangeKm: 220,
    scanPeriodSec: 10,
    alternateScanPeriodSec: Object.freeze({ slow: 20, verySlow: 30 }),
    beamWidthDeg: 11,
    scanType: RADAR_SCAN_TYPE.MECHANICAL_ROTATION,
    scanModeLabel: 'MECHANICAL 360',
    sectorDeg: 360,
    antennaHeightM: 12,
  }),
  RADAR_35D6: Object.freeze({
    id: 'RADAR_35D6',
    entityType: SEARCH_RADAR_ENTITY_TYPE,
    displayName: '35Д6',
    englishName: '35D6',
    debugName: '35D6 GENERAL PURPOSE 3D',
    role: 'GENERAL_PURPOSE_3D',
    dimension: '3D',
    sensorProfileId: RADAR_SENSOR_PROFILE_ID.SEARCH_35D6,
    nominalRangeKm: 180,
    scanPeriodSec: 5,
    alternateScanPeriodSec: Object.freeze({ slow: 10 }),
    beamWidthDeg: 7,
    scanType: RADAR_SCAN_TYPE.MECHANICAL_ROTATION,
    scanModeLabel: 'MECHANICAL 360',
    sectorDeg: 360,
    antennaHeightM: 10,
  }),
  RADAR_79K6: Object.freeze({
    id: 'RADAR_79K6',
    entityType: SEARCH_RADAR_ENTITY_TYPE,
    displayName: '79К6 «Пеликан»',
    englishName: '79K6 Pelikan',
    debugName: '79K6 PELIKAN MODERN 3D',
    role: 'MODERN_3D',
    dimension: '3D',
    sensorProfileId: RADAR_SENSOR_PROFILE_ID.SEARCH_79K6,
    nominalRangeKm: 240,
    // Public-family gameplay approximation based on published 80K6 revisit data.
    scanPeriodSec: 5,
    alternateScanPeriodSec: Object.freeze({ slow: 10 }),
    beamWidthDeg: 5,
    scanType: RADAR_SCAN_TYPE.ELECTRONIC_SECTOR,
    scanModeLabel: 'ELECTRONIC 360',
    sectorDeg: 360,
    antennaHeightM: 11,
  }),
});

export const SEARCH_RADAR_PROFILE_IDS = Object.freeze(Object.keys(SEARCH_RADAR_PROFILES));

export const getSearchRadarProfile = profileId => SEARCH_RADAR_PROFILES[profileId] ?? null;
