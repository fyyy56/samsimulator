import aim120ModelUrl from '../assets/icons/Air Defence/AIM-120A FOR NASAMS/aim-120c_amraam.glb?url';
import aster30ModelUrl from '../assets/icons/Air Defence/ASTER-30 FOR SAMP-T/aster-30-colored.glb?url';
import pac3CriVisualModelUrl from '../assets/icons/Air Defence/PAC-3 MSE FOR PATRIOT/pac-3-mse-colored.glb?url';
import iskanderModelUrl from '../assets/icons/Ballistic Missiles/Без имени.glb?url';
import skyfallModelUrl from '../assets/icons/Air Defence/FPV/skyfall_p1-sun_tailsitter_fpv_interceptor_quad.glb?url';
import {
  CONTROLLABLE_AIR_PROFILE_IDS,
  getControllableAirProfile,
} from './controllableAirProfiles.js';
import { getInterceptorSpec } from './interceptors.js';
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
    // No missile GLB is supplied. Preserve the existing image's 5892:920
    // proportions at a fixed world size; do not pretend it is a 3D mesh.
    physicalLengthMeters: 4,
    baseVisualScale: 1.45,
    minPixelSize: 0,
    maxVisualScale: 1.45,
    yawOffsetDeg: -90,
    billboardDimensionsM: { width: 4.2, height: 4.2 * 920 / 5892 },
    billboardImageSize: { width: 5892, height: 920 },
    exhaustAnchorModelM: { x: -2, y: 0, z: 0 },
    thermalAnchorModelM: { x: -1.9, y: 0, z: 0 },
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
    physicalLengthMeters: 4.9,
    baseVisualScale: 1.45,
    minPixelSize: 0,
    maxVisualScale: 1.45,
    lodNearDistanceM: 40_000,
    lodFarDistanceM: 235_000,
    forwardAxis: '+X',
    yawOffsetDeg: 0,
    pitchOffsetDeg: 0,
    rollOffsetDeg: 0,
    exhaustAnchorModelM: { x: 0, y: -2.45, z: 0 },
    thermalAnchorModelM: { x: 0, y: -2.35, z: 0 },
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

const normalizePresentation = presentation => ({
  physicalLengthMeters: 4,
  baseVisualScale: 1,
  minPixelSize: 8,
  maxVisualScale: 50,
  lodNearDistanceM: 30_000,
  lodFarDistanceM: 180_000,
  ...presentation,
});

export function getAdvancedInterceptorPresentation(interceptor) {
  const presentation = INTERCEPTOR_PRESENTATIONS[interceptor.interceptorSpecId]
    ?? DEFAULT_INTERCEPTOR_PRESENTATION;
  const spec = getInterceptorSpec(interceptor.interceptorSpecId);
  const billboardSize = presentation.key === 'ASTER_30'
    ? 34
    : presentation.key === 'AIM_120_C7' ? 28 : 31;
  return {
    ...normalizePresentation(presentation),
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
