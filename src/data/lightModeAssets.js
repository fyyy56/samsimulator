import aim120Url from '../assets/icons/Air Defence/AIM-120A FOR NASAMS/IMG_8059.png';
import irisLauncherUrl from '../assets/icons/Air Defence/IRIS-T LAUNCHER/IMG_8063.png';
import irisRadarUrl from '../assets/icons/Air Defence/IRIS-T RADAR/TRML-4D.png';
import irisMissileUrl from '../assets/icons/Air Defence/IRIS-T SLM FOR IRIS-T/IMG_8052 2.png';
import nasamsLauncherUrl from '../assets/icons/Air Defence/NASAMS LAUNCHER/IMG_8060.png';
import nasamsRadarUrl from '../assets/icons/Air Defence/NASAMS RADAR/IMG_8056 2.png';
import pac3Url from '../assets/icons/Air Defence/PAC-3 MSE FOR PATRIOT/IMG_8067.png';
import patriotLauncherUrl from '../assets/icons/Air Defence/PATRIOT LAUNCHER/IMG_8048.png';
import patriotRadarUrl from '../assets/icons/Air Defence/PATRIOT RADAR/IMG_8055.png';
import gepard0Url from '../assets/icons/Air Defence/GEPARD/0 or 360 degree.png';
import gepard45Url from '../assets/icons/Air Defence/GEPARD/45 degree.png';
import gepard90Url from '../assets/icons/Air Defence/GEPARD/90 degree.png';
import gepard135Url from '../assets/icons/Air Defence/GEPARD/135 degree.png';
import gepard180Url from '../assets/icons/Air Defence/GEPARD/180 degree.png';
import gepard225Url from '../assets/icons/Air Defence/GEPARD/225 degree.png';
import gepard270Url from '../assets/icons/Air Defence/GEPARD/270 degree.png';
import gepard315Url from '../assets/icons/Air Defence/GEPARD/315 degree.png';
import aster30Url from '../assets/icons/Air Defence/ASTER-30 FOR SAMP-T/aster_30_reference.webp';
import iskanderUrl from '../assets/icons/Ballistic Missiles/ISKANDER-M.png';
import kalibrUrl from '../assets/icons/Cruise MIssiles/kalibr/kalibr-top.png';
import kh555Url from '../assets/icons/Cruise MIssiles/X-555/kh-555-top.png';
import geranUrl from '../assets/icons/UAVS/GERAN-2-SHAHED-136/geran-2-top.png';
import gerberaUrl from '../assets/icons/UAVS/GERBERA/gerbera-top.png';
import humveeUrl from '../assets/icons/Air Defence/HAMVEE WIHT GUN/humvee-mwg-isometric.png';
import sampTRadarUrl from '../assets/icons/Air Defence/SAMP-T RADAR/samp-t-radar-isometric.png';
import sampTLauncherUrl from '../assets/icons/Air Defence/SAMP-T LAUNCHER/samp-t-launcher-isometric.png';
import torM1TopUrl from '../assets/icons/Air Defence/TOR-M1/tor-m1-top.svg';
import missile9M331TopUrl from '../assets/icons/Air Defence/9M331 FOR TOR-M1/9m331-top.svg';
import kh555ModelUrl from '../assets/icons/Cruise MIssiles/X-555/kh-555_missile_high-poly_fbx.glb?url';
import geranModelUrl from '../assets/icons/UAVS/GERAN-2-SHAHED-136/iranian_shahed-136_military_drone.glb?url';
import gerberaModelUrl from '../assets/icons/UAVS/GERBERA/uav_gerbera_low-poly.glb?url';
import kalibrModelUrl from '../assets/icons/Cruise MIssiles/kalibr/kalibr3d.glb?url';
import humveeModelUrl from '../assets/icons/Air Defence/HAMVEE WIHT GUN/ukrainian_modified_humvee.glb?url';
import { getTargetModelDisplayName, LIGHT_TARGET_MODEL, normalizeLightTargetModelId } from './lightTargetModels.js';


export { LIGHT_TARGET_MODEL, LIGHT_TARGET_MODEL_OPTIONS } from './lightTargetModels.js';

const ASSET_CATALOG = Object.freeze({
  TOR_M1: { src: torM1TopUrl, label: 'Tor-M1', className: 'launcher', assetRotationOffsetDeg: 0 },
  '9M331': { src: missile9M331TopUrl, label: '9М331', className: 'interceptor', assetRotationOffsetDeg: 0 },
  GERAN_2: { id: 'GERAN_2', displayName: 'Герань-2', category: 'UAV', src: geranUrl, icon: geranUrl, previewModel: geranModelUrl, previewCameraPreset: 'TOP_VIEW_UAV', label: 'Герань-2', className: 'uav', assetRotationOffsetDeg: 0 },
  GERBERA: { id: 'GERBERA', displayName: 'Gerbera', category: 'DECOY_UAV', src: gerberaUrl, icon: gerberaUrl, previewModel: gerberaModelUrl, previewCameraPreset: 'TOP_VIEW_UAV', label: 'Gerbera', className: 'uav', assetRotationOffsetDeg: 0 },
  KH_555: { id: 'KH_555', displayName: 'Х-555', category: 'CRUISE_MISSILE', src: kh555Url, icon: kh555Url, previewModel: kh555ModelUrl, previewCameraPreset: 'TOP_VIEW_MISSILE', label: 'Х-555', className: 'cruise', assetRotationOffsetDeg: 0 },
  KALIBR: { id: 'KALIBR', displayName: 'Калибр', category: 'CRUISE_MISSILE', src: kalibrUrl, icon: kalibrUrl, previewModel: kalibrModelUrl, previewCameraPreset: 'TOP_VIEW_MISSILE', label: 'Калибр', className: 'cruise', assetRotationOffsetDeg: 0 },
  ISKANDER_M: { src: iskanderUrl, label: 'Искандер-М', className: 'ballistic', assetRotationOffsetDeg: -90 },
  PATRIOT_RADAR: { src: patriotRadarUrl, label: 'Patriot radar', className: 'radar', assetRotationOffsetDeg: 0 },
  PATRIOT_LAUNCHER: { src: patriotLauncherUrl, label: 'Patriot launcher', className: 'launcher', assetRotationOffsetDeg: 45 },
  PAC_3: { src: pac3Url, label: 'PAC-3 MSE', className: 'interceptor', assetRotationOffsetDeg: -90 },
  NASAMS_RADAR: { src: nasamsRadarUrl, label: 'NASAMS radar', className: 'radar', assetRotationOffsetDeg: 0 },
  NASAMS_LAUNCHER: { src: nasamsLauncherUrl, label: 'NASAMS launcher', className: 'launcher', assetRotationOffsetDeg: 45 },
  AIM_120: { src: aim120Url, label: 'AIM-120', className: 'interceptor', assetRotationOffsetDeg: -90 },
  IRIS_T_RADAR: { src: irisRadarUrl, label: 'TRML-4D radar', className: 'radar', assetRotationOffsetDeg: 0 },
  IRIS_T_LAUNCHER: { src: irisLauncherUrl, label: 'IRIS-T SLM launcher', className: 'launcher', assetRotationOffsetDeg: 0 },
  IRIS_T_MISSILE: { src: irisMissileUrl, label: 'IRIS-T missile', className: 'interceptor', assetRotationOffsetDeg: -90 },
  GEPARD_0: { src: gepard0Url, label: 'Gepard 1A2', className: 'gepard', lockSpriteRotation: true },
  GEPARD_45: { src: gepard45Url, label: 'Gepard 1A2', className: 'gepard', lockSpriteRotation: true },
  GEPARD_90: { src: gepard90Url, label: 'Gepard 1A2', className: 'gepard', lockSpriteRotation: true },
  GEPARD_135: { src: gepard135Url, label: 'Gepard 1A2', className: 'gepard', lockSpriteRotation: true },
  GEPARD_180: { src: gepard180Url, label: 'Gepard 1A2', className: 'gepard', lockSpriteRotation: true },
  GEPARD_225: { src: gepard225Url, label: 'Gepard 1A2', className: 'gepard', lockSpriteRotation: true },
  GEPARD_270: { src: gepard270Url, label: 'Gepard 1A2', className: 'gepard', lockSpriteRotation: true },
  GEPARD_315: { src: gepard315Url, label: 'Gepard 1A2', className: 'gepard', lockSpriteRotation: true },
  SAMP_T_RADAR: { src: sampTRadarUrl, label: 'Arabel radar', className: 'radar', assetRotationOffsetDeg: 0 },
  SAMP_T_LAUNCHER: { src: sampTLauncherUrl, label: 'SAMP/T launcher', className: 'launcher', assetRotationOffsetDeg: 0 },
  ASTER_30: { src: aster30Url, label: 'Aster 30', className: 'interceptor', assetRotationOffsetDeg: -90, opaqueBackground: true },
  HUMVEE_MWG: { id: 'HUMVEE_MWG', displayName: 'Humvee MBG', category: 'MOBILE_FIRE_GROUP', src: humveeUrl, icon: humveeUrl, previewModel: humveeModelUrl, previewCameraPreset: 'ISOMETRIC_GROUND', label: 'Humvee MBG', className: 'gepard', lockSpriteRotation: true },
});

const SYSTEM_ASSETS = Object.freeze({
  TOR_M1: { radar: 'TOR_M1', launcher: 'TOR_M1', interceptor: '9M331' },
  SHORT: { radar: 'IRIS_T_RADAR', launcher: 'IRIS_T_LAUNCHER', interceptor: 'IRIS_T_MISSILE' },
  MEDIUM: { radar: 'NASAMS_RADAR', launcher: 'NASAMS_LAUNCHER', interceptor: 'AIM_120' },
  LONG: { radar: 'PATRIOT_RADAR', launcher: 'PATRIOT_LAUNCHER', interceptor: 'PAC_3' },
  GUN: { radar: 'GEPARD_0', launcher: 'GEPARD_0', interceptor: null },
  SAMP_T: { radar: 'SAMP_T_RADAR', launcher: 'SAMP_T_LAUNCHER', interceptor: 'ASTER_30' },
  GAZ: { radar: 'HUMVEE_MWG', launcher: 'HUMVEE_MWG', interceptor: null },
});

const normalizeAssetId = assetId => ({
  GAZ_DSHK: 'HUMVEE_MWG',
  KH_101: LIGHT_TARGET_MODEL.KH_555,
  SHAHED_136: LIGHT_TARGET_MODEL.GERAN_2,
}[assetId] ?? assetId);

export const getLightAsset = assetId => ASSET_CATALOG[normalizeAssetId(assetId)] ?? ASSET_CATALOG.GERAN_2;

export const getSystemAssetId = (category, component, heading = 0) => {
  if (category === 'GUN') {
    const nearestHeading = (Math.round((((heading % 360) + 360) % 360) / 45) * 45) % 360;
    return `GEPARD_${nearestHeading}`;
  }
  return SYSTEM_ASSETS[category]?.[component] ?? SYSTEM_ASSETS.SHORT[component];
};

export const getTargetAssetId = target => {
  const normalizedModelId = normalizeLightTargetModelId(target?.modelId);
  if (normalizedModelId && ASSET_CATALOG[normalizedModelId]) return normalizedModelId;
  if (target?.type === 'BALLISTIC_TARGET') return LIGHT_TARGET_MODEL.ISKANDER_M;
  if (target?.type === 'CRUISE_TARGET') return LIGHT_TARGET_MODEL.KH_555;
  return LIGHT_TARGET_MODEL.GERAN_2;
};

export const getTargetDisplayName = (targetOrModelId) => {
  const assetId = typeof targetOrModelId === 'string'
    ? targetOrModelId
    : getTargetAssetId(targetOrModelId);
  return getTargetModelDisplayName(assetId);
};
