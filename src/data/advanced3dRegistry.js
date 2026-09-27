import aim120ModelUrl from '../assets/icons/Air Defence/AIM-120A FOR NASAMS/aim-120c_amraam.glb?url';
import aster30ModelUrl from '../assets/icons/Air Defence/ASTER-30 FOR SAMP-T/aster30.glb?url';
import aster30BodyModelUrl from '../assets/icons/Air Defence/ASTER-30 FOR SAMP-T/aster30-body.glb?url';
import aster30BoosterModelUrl from '../assets/icons/Air Defence/ASTER-30 FOR SAMP-T/aster30-booster.glb?url';
import irisMissileModelUrl from '../assets/icons/Air Defence/IRIS-T SLM FOR IRIS-T/iris-t.glb?url';
import pac3CriVisualModelUrl from '../assets/icons/Air Defence/PAC-3 MSE FOR PATRIOT/pac-3-mse-colored.glb?url';
import iskanderModelUrl from '../assets/icons/Ballistic Missiles/Без имени.glb?url';
import skyfallModelUrl from '../assets/icons/Air Defence/FPV/skyfall_p1-sun_tailsitter_fpv_interceptor_quad.glb?url';
import patriotLauncherModelUrl from '../assets/icons/Air Defence/PATRIOT LAUNCHER/mim-104_patriot_surface-to-air_missile_sam.glb?url';
import nasamsLauncherModelUrl from '../assets/icons/Air Defence/NASAMS LAUNCHER/us_nasams_3_tel_war_thunder_line_of_contact.glb?url';
import irisLauncherModelUrl from '../assets/icons/Air Defence/IRIS-T LAUNCHER/iris-t_slmtel_war_thunder_leviathans.glb?url';
import irisRadarModelUrl from '../assets/icons/Air Defence/IRIS-T RADAR/iris-t_slmtads_war_thunder_leviathans.glb?url';
import sampTLauncherModelUrl from '../assets/icons/Air Defence/SAMP-T LAUNCHER/italian_fsaf_sampt_tel_war_thunder.glb?url';
import sampTRadarModelUrl from '../assets/icons/Air Defence/SAMP-T RADAR/italian_fsaf_sampt_tads_war_thunder.glb?url';
import gepardModelUrl from '../assets/icons/Air Defence/GEPARD/flakpanzer_1a2_gepard_war_thunder.glb?url';
import torM1ModelUrl from '../assets/icons/Air Defence/TOR-M1/tor-m1_war_thunder.glb?url';
import missile9M331ModelUrl from '../assets/icons/Air Defence/9M331 FOR TOR-M1/9M331.glb?url';
import {
  CONTROLLABLE_AIR_PROFILE_IDS,
  getControllableAirProfile,
} from './controllableAirProfiles.js';
import { getInterceptorSpec } from './interceptors.js';
import { DEFAULT_LAUNCH_PROFILES } from './launchProfiles.js';
import {
  getLightAsset,
  getSystemAssetId,
  getTargetAssetId,
  getTargetDisplayName,
} from './lightModeAssets.js';

export const ADVANCED_ENTITY_KIND = Object.freeze({
  TARGET: 'TARGET',
  INTERCEPTOR: 'INTERCEPTOR',
  SEARCH_RADAR: 'SEARCH_RADAR',
  CONTROLLABLE: 'CONTROLLABLE',
});

export function getAdvancedControllablePresentation(entity) {
  const profile = getControllableAirProfile(entity.profileId);
  if (entity.profileId === CONTROLLABLE_AIR_PROFILE_IDS.SKYFALL_FPV) {
    return {
      ...normalizePresentation({
        key: 'SKYFALL_P1_SUN',
        modelUri: skyfallModelUrl,
        physicalLengthMeters: 1.9,
        baseVisualScale: 1.55,
        minPixelSize: 18,
        maxVisualScale: 42,
        lodNearDistanceM: 8_000,
        lodFarDistanceM: 85_000,
        // The source mesh nose is local +Z, but the GLB root matrix already
        // converts local +Z to glTF/Cesium +Y and local +Y to -Z.
        forwardAxis: '+Y',
        yawOffsetDeg: 0,
        pitchOffsetDeg: 0,
        rollOffsetDeg: 0,
        modelCenterOffsetMeters: { x: 0, y: 0, z: 0 },
        firstPersonCameraOffsetM: profile.camera.firstPersonForwardOffsetM,
        cameraConfig: profile.camera,
      }),
      displayName: profile.displayName,
      placeholderDimensionsM: profile.physicalDimensionsM,
    };
  }
  return {
    ...normalizePresentation({
      key: entity.profileId ?? 'CONTROLLABLE_TEST',
      baseVisualScale: 1,
      minPixelSize: 10,
      maxVisualScale: 20,
      lodNearDistanceM: 25_000,
      lodFarDistanceM: 500_000,
      forwardAxis: '+Y',
    }),
    displayName: profile.displayName,
    placeholderDimensionsM: { length: 1.4, width: 1.7, height: 0.35 },
  };
}

const SEARCH_RADAR_FALLBACK = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="25" fill="#102722" stroke="#9ddac7" stroke-width="3"/>
    <path d="M32 48V22M32 48L18 27M32 48L46 27" stroke="#d4f3e9" stroke-width="3" stroke-linecap="round"/>
  </svg>`)}`;

const radarFallback = label => `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="192" height="128" viewBox="0 0 192 128">
    <rect x="2" y="2" width="188" height="124" rx="12" fill="#0b2027" stroke="#8dd8c5" stroke-width="4"/>
    <path d="M96 91V39M96 91L66 51M96 91L126 51M55 99H137" stroke="#d4f3e9" stroke-width="6" stroke-linecap="round"/>
    <text x="96" y="119" text-anchor="middle" fill="#d4f3e9" font-family="monospace" font-size="15">${label}</text>
  </svg>`)}`;

export const ADVANCED_GROUND_ASSET_ID = Object.freeze({
  TOR_M1: 'TOR_M1',
  PATRIOT_LAUNCHER: 'PATRIOT_LAUNCHER',
  PATRIOT_RADAR: 'PATRIOT_RADAR',
  NASAMS_LAUNCHER: 'NASAMS_LAUNCHER',
  NASAMS_RADAR: 'NASAMS_RADAR',
  IRIS_T_LAUNCHER: 'IRIS_T_LAUNCHER',
  IRIS_T_RADAR: 'IRIS_T_RADAR',
  SAMP_T_LAUNCHER: 'SAMP_T_LAUNCHER',
  SAMP_T_RADAR: 'SAMP_T_RADAR',
  GEPARD: 'GEPARD',
  P18: 'P18',
  RADAR_35D6: 'RADAR_35D6',
  PELIKAN: 'PELIKAN',
});

const groundAsset = (id, options) => Object.freeze({
  key: id,
  assetType: 'GROUND',
  modelUri: null,
  forwardAxis: '+Y',
  upAxis: '+Z',
  uniformScale: 1,
  yawOffsetDeg: 0,
  pitchOffsetDeg: 0,
  rollOffsetDeg: 0,
  groundOffsetM: 0,
  labelOffsetM: { x: 0, y: 0, z: 8 },
  sensorOriginM: null,
  fallbackType: 'BILLBOARD',
  billboardDimensionsM: { width: 8, height: 4.5 },
  billboardDistance: { nearM: 80, nearScale: 0.72, farM: 80_000, farScale: 0.2 },
  ...options,
});

export const ADVANCED_GROUND_ASSETS = Object.freeze({
  TOR_M1: groundAsset('TOR_M1', {
    displayName: 'Tor-M1', modelUri: torM1ModelUrl, uniformScale: 1,
    // Raw X/Y/Z spans ~3.42/9.00/5.73 m. The GLB hierarchy and Cesium's
    // Y-up conversion put the authored vehicle front on model +X.
    forwardAxis: '+X', yawOffsetDeg: 90, groundOffsetM: 0.02,
    launchOriginM: { x: 0, y: 0, z: 3.5 },
    sensorOriginM: { x: 0, y: 0, z: 5 },
    labelOffsetM: { x: 0, y: 0, z: 7 },
    fallbackAsset: getLightAsset('TOR_M1').src,
  }),
  PATRIOT_LAUNCHER: groundAsset('PATRIOT_LAUNCHER', {
    displayName: 'Patriot launcher', modelUri: patriotLauncherModelUrl, uniformScale: 0.8,
    launchTubeElevationDeg: DEFAULT_LAUNCH_PROFILES['INT-LONG-V1'].launchTubeElevationDeg,
    groundOffsetM: 0.04, labelOffsetM: { x: 0, y: 0, z: 11 },
    fallbackAsset: getLightAsset('PATRIOT_LAUNCHER').src,
  }),
  PATRIOT_RADAR: groundAsset('PATRIOT_RADAR', {
    displayName: 'Patriot radar', fallbackAsset: getLightAsset('PATRIOT_RADAR').src,
    sensorOriginM: { x: 0, y: 0, z: 7 }, billboardDimensionsM: { width: 8, height: 5 },
  }),
  NASAMS_LAUNCHER: groundAsset('NASAMS_LAUNCHER', {
    displayName: 'NASAMS launcher', modelUri: nasamsLauncherModelUrl, groundOffsetM: 0.01,
    launchTubeElevationDeg: DEFAULT_LAUNCH_PROFILES['INT-MEDIUM-V1'].launchTubeElevationDeg,
    forwardAxis: '+X', yawOffsetDeg: 90,
    fallbackAsset: getLightAsset('NASAMS_LAUNCHER').src,
  }),
  NASAMS_RADAR: groundAsset('NASAMS_RADAR', {
    displayName: 'NASAMS radar', fallbackAsset: getLightAsset('NASAMS_RADAR').src,
    sensorOriginM: { x: 0, y: 0, z: 6 }, billboardDimensionsM: { width: 8, height: 5 },
  }),
  IRIS_T_LAUNCHER: groundAsset('IRIS_T_LAUNCHER', {
    displayName: 'IRIS-T SLM launcher', modelUri: irisLauncherModelUrl, groundOffsetM: 0.01,
    forwardAxis: '+X', yawOffsetDeg: 90,
    labelOffsetM: { x: 0, y: 0, z: 10 }, fallbackAsset: getLightAsset('IRIS_T_LAUNCHER').src,
  }),
  IRIS_T_RADAR: groundAsset('IRIS_T_RADAR', {
    displayName: 'TRML-4D radar', modelUri: irisRadarModelUrl, groundOffsetM: 0.01,
    forwardAxis: '+X', yawOffsetDeg: 90,
    sensorOriginM: { x: 0, y: 0, z: 7 }, fallbackAsset: getLightAsset('IRIS_T_RADAR').src,
  }),
  SAMP_T_LAUNCHER: groundAsset('SAMP_T_LAUNCHER', {
    displayName: 'SAMP/T launcher', modelUri: sampTLauncherModelUrl, groundOffsetM: 0.06,
    forwardAxis: '+X', yawOffsetDeg: 90,
    labelOffsetM: { x: 0, y: 0, z: 13 }, fallbackAsset: getLightAsset('SAMP_T_LAUNCHER').src,
  }),
  SAMP_T_RADAR: groundAsset('SAMP_T_RADAR', {
    displayName: 'Arabel radar', modelUri: sampTRadarModelUrl, groundOffsetM: 0.05,
    forwardAxis: '+X', yawOffsetDeg: 90,
    sensorOriginM: { x: 0, y: 0, z: 6 }, fallbackAsset: getLightAsset('SAMP_T_RADAR').src,
  }),
  GEPARD: groundAsset('GEPARD', {
    displayName: 'Gepard 1A2', modelUri: gepardModelUrl, groundOffsetM: 0.02,
    forwardAxis: '+X', yawOffsetDeg: 90,
    fallbackAsset: getLightAsset('GEPARD_0').src, labelOffsetM: { x: 0, y: 0, z: 5 },
  }),
  P18: groundAsset('P18', {
    displayName: 'P-18', fallbackAsset: radarFallback('P-18'),
    sensorOriginM: { x: 0, y: 0, z: 12 }, billboardDimensionsM: { width: 9, height: 6 },
  }),
  RADAR_35D6: groundAsset('RADAR_35D6', {
    displayName: '35D6', fallbackAsset: radarFallback('35D6'),
    sensorOriginM: { x: 0, y: 0, z: 10 }, billboardDimensionsM: { width: 9, height: 6 },
  }),
  PELIKAN: groundAsset('PELIKAN', {
    displayName: '79K6 Pelikan', fallbackAsset: radarFallback('79K6'),
    sensorOriginM: { x: 0, y: 0, z: 11 }, billboardDimensionsM: { width: 9, height: 6 },
  }),
});


// Existing simulation catalog IDs; these entries do not define sensor/weapon physics.
export const ADVANCED_GROUND_DEPLOYMENTS = Object.freeze({
  TOR_M1: { category: 'TOR_M1', kind: 'SAM', unifiedUnit: true },
  PATRIOT_LAUNCHER: { category: 'LONG', kind: 'SAM' },
  NASAMS_LAUNCHER: { category: 'MEDIUM', kind: 'SAM' },
  IRIS_T_LAUNCHER: { category: 'SHORT', kind: 'SAM' },
  SAMP_T_LAUNCHER: { category: 'SAMP_T', kind: 'SAM' },
  GEPARD: { category: 'GUN', kind: 'SAM' },
  PATRIOT_RADAR: { category: 'LONG', kind: 'RADAR' },
  NASAMS_RADAR: { category: 'MEDIUM', kind: 'RADAR' },
  IRIS_T_RADAR: { category: 'SHORT', kind: 'RADAR' },
  SAMP_T_RADAR: { category: 'SAMP_T', kind: 'RADAR' },
  P18: { category: 'RADAR_P18', kind: 'RADAR', searchRadar: true },
  RADAR_35D6: { category: 'RADAR_35D6', kind: 'RADAR', searchRadar: true },
  PELIKAN: { category: 'RADAR_79K6', kind: 'RADAR', searchRadar: true },
});

export function getAdvancedGroundAssetPresentation(assetId) {
  return ADVANCED_GROUND_ASSETS[assetId] ?? null;
}

export function resolveAdvancedAssetPresentation(presentation, modelStatus = 'READY') {
  const useModel = Boolean(presentation?.modelUri) && modelStatus !== 'FAILED';
  return Object.freeze({
    renderType: useModel ? 'MODEL' : 'BILLBOARD',
    modelUri: useModel ? presentation.modelUri : null,
    fallbackAsset: useModel ? null : presentation?.fallbackAsset ?? presentation?.fallbackBillboard ?? null,
    uniformScale: presentation?.uniformScale ?? presentation?.baseVisualScale ?? 1,
  });
}

export function getAdvancedSearchRadarPresentation(radar) {
  return {
    ...normalizePresentation({
      key: radar.profileId ?? 'SEARCH_RADAR',
      fallbackBillboard: SEARCH_RADAR_FALLBACK,
      minPixelSize: 18,
      maxVisualScale: 40,
      lodFarDistanceM: 2_000_000,
    }),
    displayName: radar.englishName ?? radar.displayName ?? 'Search radar',
    billboardWidth: 34,
    billboardHeight: 34,
    billboardYawOffsetDeg: 0,
  };
}

const INTERCEPTOR_PRESENTATIONS = Object.freeze({
  'INT-9M331-V1': {
    key: '9M331',
    modelUri: missile9M331ModelUrl,
    physicalLengthMeters: 2.898,
    baseVisualScale: 1.45,
    minPixelSize: 0,
    maxVisualScale: 1.45,
    lodNearDistanceM: 20_000,
    lodFarDistanceM: 140_000,
    // Raw mesh nose +Z becomes (0,-0.102,-0.995) after the GLB node and
    // Cesium axis conversion. The model correction maps it to Cesium +Y,
    // which the shared renderer maps to visual body +X.
    forwardAxis: '-Z',
    yawOffsetDeg: 0,
    modelQuaternionOffset: { axis: 'X', angleDeg: 95.8491445 },
    modelCenterOffsetMeters: { x: 0.073, y: -0.016, z: 2.632 },
    exhaustAnchorModelM: { x: 0.073, y: 0.133, z: 4.077 },
    thermalAnchorModelM: { x: 0.073, y: 0.12, z: 3.9 },
    attitudeJetAnchorsModelM: [
      { x: -0.06, y: 0.13, z: 2.65 },
      { x: 0.20, y: 0.13, z: 2.65 },
    ],
    fallbackBillboard: getLightAsset('9M331').src,
    billboardYawOffsetDeg: getLightAsset('9M331').assetRotationOffsetDeg,
  },
  'INT-MEDIUM-V1': {
    key: 'AIM_120_C7',
    modelUri: aim120ModelUrl,
    physicalLengthMeters: 3.7,
    baseVisualScale: 1.45,
    minPixelSize: 0,
    maxVisualScale: 1.45,
    lodNearDistanceM: 35_000,
    lodFarDistanceM: 210_000,
    // Raw nose -Y -> root +Z -> Cesium +X. No extra body rotation.
    forwardAxis: '-Y',
    yawOffsetDeg: -90,
    pitchOffsetDeg: 0,
    rollOffsetDeg: 0,
    exhaustAnchorModelM: { x: -1.82135, y: 0, z: 0 },
    thermalAnchorModelM: { x: -1.75, y: 0, z: 0 },
    fallbackBillboard: getLightAsset('AIM_120').src,
    billboardYawOffsetDeg: getLightAsset('AIM_120').assetRotationOffsetDeg,
  },
  'INT-SHORT-V1': {
    key: 'IRIS_T_SLM',
    modelUri: irisMissileModelUrl,
    physicalLengthMeters: 4,
    baseVisualScale: 1.08,
    minPixelSize: 0,
    maxVisualScale: 1.08,
    forwardAxis: '+Z',
    yawOffsetDeg: -90,
    modelQuaternionOffset: { axis: 'Y', angleDeg: 90 },
    modelCenterOffsetMeters: { x: -0.1, y: -0.04, z: 1.98 },
    billboardDimensionsM: { width: 4.2, height: 4.2 * 920 / 5892 },
    billboardImageSize: { width: 5892, height: 920 },
    exhaustAnchorModelM: { x: -0.1, y: -0.04, z: 0.14 },
    thermalAnchorModelM: { x: -0.1, y: -0.04, z: 0.22 },
    fallbackBillboard: getLightAsset('IRIS_T_MISSILE').src,
    billboardYawOffsetDeg: getLightAsset('IRIS_T_MISSILE').assetRotationOffsetDeg,
  },
  'INT-LONG-V1': {
    // Visual-only PAC-3 CRI mesh representing the existing PAC-3 MSE gameplay entity.
    key: 'PAC3_CRI_VISUAL',
    modelUri: pac3CriVisualModelUrl,
    physicalLengthMeters: 5.2,
    baseVisualScale: 1.45,
    minPixelSize: 0,
    maxVisualScale: 1.45,
    lodNearDistanceM: 40_000,
    lodFarDistanceM: 235_000,
    forwardAxis: '+X',
    // Authored +X nose becomes +Y after Cesium's glTF axis conversion.
    yawOffsetDeg: 0,
    pitchOffsetDeg: 0,
    rollOffsetDeg: 0,
    modelCenterOffsetMeters: { x: 0, y: 0, z: 0 },
    exhaustOffsetMeters: 3.77,
    exhaustAnchorModelM: { x: 0, y: -2.6, z: 0 },
    thermalAnchorModelM: { x: 0, y: -2.5, z: 0 },
    fallbackBillboard: getLightAsset('PAC_3').src,
    billboardYawOffsetDeg: getLightAsset('PAC_3').assetRotationOffsetDeg,
  },
  'INT-ASTER30-V1': {
    key: 'ASTER_30',
    modelUri: aster30ModelUrl,
    separatedBodyModelUri: aster30BodyModelUrl,
    boosterModelUri: aster30BoosterModelUrl,
    physicalLengthMeters: 4.9,
    baseVisualScale: 1.08,
    minPixelSize: 0,
    maxVisualScale: 1.08,
    lodNearDistanceM: 40_000,
    lodFarDistanceM: 235_000,
    forwardAxis: '+Z',
    yawOffsetDeg: -90,
    modelQuaternionOffset: { axis: 'Y', angleDeg: 90.539 },
    modelCenterOffsetMeters: { x: 0.2, y: -2.114, z: 3.38 },
    pitchOffsetDeg: 0,
    rollOffsetDeg: 0,
    exhaustAnchorModelM: { x: 0.2, y: -2.114, z: 1.12 },
    thermalAnchorModelM: { x: 0.2, y: -2.114, z: 1.25 },
    fallbackBillboard: getLightAsset('ASTER_30').src,
    billboardYawOffsetDeg: getLightAsset('ASTER_30').assetRotationOffsetDeg,
  },
});

const DEFAULT_INTERCEPTOR_PRESENTATION = Object.freeze({
  key: 'GENERIC_INTERCEPTOR',
  fallbackBillboard: getLightAsset(getSystemAssetId('SHORT', 'interceptor')).src,
  billboardYawOffsetDeg: getLightAsset(getSystemAssetId('SHORT', 'interceptor')).assetRotationOffsetDeg,
});

const TARGET_MODEL_PROFILES = Object.freeze({
  ISKANDER_M: {
    modelUri: iskanderModelUrl,
    physicalLengthMeters: 7.3,
    baseVisualScale: 1.65,
    minPixelSize: 30,
    maxVisualScale: 95,
    lodNearDistanceM: 55_000,
    lodFarDistanceM: 285_000,
    // Mesh nose is +Z; root -90° X and glTF Y-up conversion leave it +Z
    // in Cesium model space. Map that axis to body +X before flight attitude.
    forwardAxis: '+Z',
    yawOffsetDeg: -90,
    pitchOffsetDeg: 0,
    modelQuaternionOffset: { axis: 'Y', angleDeg: 90 },
  },
  KALIBR: {
    physicalLengthMeters: 6.2,
    baseVisualScale: 1.25,
    minPixelSize: 10,
    maxVisualScale: 55,
    lodNearDistanceM: 35_000,
    lodFarDistanceM: 180_000,
    forwardAxis: '+Y',
    yawOffsetDeg: -90,
  },
  KH_555: {
    physicalLengthMeters: 6.0,
    baseVisualScale: 1.25,
    minPixelSize: 10,
    maxVisualScale: 55,
    lodNearDistanceM: 35_000,
    lodFarDistanceM: 180_000,
    forwardAxis: '+Y',
    yawOffsetDeg: -90,
  },
  GERAN_2: {
    physicalLengthMeters: 3.5,
    baseVisualScale: 1.15,
    minPixelSize: 10,
    maxVisualScale: 50,
    lodNearDistanceM: 25_000,
    lodFarDistanceM: 140_000,
    forwardAxis: '+Y',
    // This GLB's nose is reversed relative to the shared UAV image convention.
    yawOffsetDeg: 90,
  },
  GERBERA: {
    physicalLengthMeters: 2.5,
    baseVisualScale: 1.1,
    minPixelSize: 9,
    maxVisualScale: 45,
    lodNearDistanceM: 22_000,
    lodFarDistanceM: 125_000,
    // Tail motor is +Z in the authored mesh, nose -Z. With its root
    // transforms and Cesium conversion the nose is -X, requiring 180°.
    forwardAxis: '-Z',
    yawOffsetDeg: 90,
    // Authored motor bounding-box centre, including GLB roots and Cesium axes.
    thermalAnchorModelM: { x: 1.196, y: 0.0815, z: 0.70 },
  },
});

const normalizePresentation = presentation => {
  const normalized = {
    assetType: 'AIRBORNE',
    physicalLengthMeters: 4,
    baseVisualScale: 1,
    minPixelSize: 8,
    maxVisualScale: 50,
    lodNearDistanceM: 30_000,
    lodFarDistanceM: 180_000,
    upAxis: '+Z',
    fallbackType: 'BILLBOARD',
    ...presentation,
  };
  return { ...normalized, uniformScale: normalized.uniformScale ?? normalized.baseVisualScale };
};

export function getAdvancedInterceptorPresentation(interceptor) {
  const presentation = INTERCEPTOR_PRESENTATIONS[interceptor.interceptorSpecId]
    ?? DEFAULT_INTERCEPTOR_PRESENTATION;
  const separatedAster = presentation.key === 'ASTER_30'
    && interceptor.motorPhase && interceptor.motorPhase !== 'BOOST';
  const activePresentation = separatedAster ? {
    ...presentation,
    modelUri: presentation.separatedBodyModelUri,
    exhaustAnchorModelM: { x: 0.2, y: -2.1, z: 2.98 },
    thermalAnchorModelM: { x: 0.2, y: -2.1, z: 3.06 },
  } : presentation;
  const spec = getInterceptorSpec(interceptor.interceptorSpecId);
  const billboardSize = presentation.key === 'ASTER_30'
    ? 34
    : presentation.key === 'AIM_120_C7' ? 28 : 31;
  return {
    ...normalizePresentation(activePresentation),
    displayName: spec?.publicDisplay?.displayName ?? interceptor.interceptorSpecId,
    billboardWidth: billboardSize,
    billboardHeight: billboardSize / ({ AIM_120_C7: 1920 / 1080,
      PAC3_CRI_VISUAL: 2560 / 400, ASTER_30: 1757 / 550,
      IRIS_T_SLM: 5892 / 920 }[presentation.key] ?? 1),
  };
}

export function getAdvancedTargetPresentation(target) {
  const assetId = getTargetAssetId(target);
  const asset = getLightAsset(assetId);
  const modelProfile = TARGET_MODEL_PROFILES[assetId] ?? null;
  return {
    ...normalizePresentation(modelProfile ?? {}),
    key: assetId,
    displayName: getTargetDisplayName(target),
    modelUri: modelProfile?.modelUri ?? asset.previewModel,
    fallbackBillboard: asset.src,
    billboardWidth: target.ballisticPhysics?.enabled ? 40 : 34,
    billboardHeight: target.ballisticPhysics?.enabled ? 40 : 34,
    yawOffsetDeg: modelProfile?.yawOffsetDeg ?? asset.assetRotationOffsetDeg ?? 0,
    billboardYawOffsetDeg: asset.assetRotationOffsetDeg ?? 0,
    forwardAxis: modelProfile?.forwardAxis ?? 'IMAGE_UP',
    pitchOffsetDeg: modelProfile?.pitchOffsetDeg ?? 0,
    rollOffsetDeg: modelProfile?.rollOffsetDeg ?? 0,
  };
}
