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
import iskanderUrl from '../assets/icons/Ballistic Missiles/ISKANDER-M.png';
import kalibrUrl from '../assets/icons/Cruise MIssiles/KALIBR.png';
import kh101Url from '../assets/icons/Cruise MIssiles/X-101.png';
import geranUrl from '../assets/icons/UAVS/ГЕРАНЬ-2.jpg';
import { getTargetModelDisplayName, LIGHT_TARGET_MODEL } from './lightTargetModels.js';

export { LIGHT_TARGET_MODEL } from './lightTargetModels.js';

const ASSET_CATALOG = Object.freeze({
  GERAN_2: { src: geranUrl, label: 'Герань-2 / Shahed-136', className: 'uav', assetRotationOffsetDeg: -45, opaqueBackground: true },
  KH_101: { src: kh101Url, label: 'Х-101', className: 'cruise', assetRotationOffsetDeg: 90, opaqueBackground: true },
  KALIBR: { src: kalibrUrl, label: 'Калибр', className: 'cruise', assetRotationOffsetDeg: 90 },
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
});

const SYSTEM_ASSETS = Object.freeze({
  SHORT: { radar: 'IRIS_T_RADAR', launcher: 'IRIS_T_LAUNCHER', interceptor: 'IRIS_T_MISSILE' },
  MEDIUM: { radar: 'NASAMS_RADAR', launcher: 'NASAMS_LAUNCHER', interceptor: 'AIM_120' },
  LONG: { radar: 'PATRIOT_RADAR', launcher: 'PATRIOT_LAUNCHER', interceptor: 'PAC_3' },
  GUN: { radar: 'GEPARD_0', launcher: 'GEPARD_0', interceptor: null },
});

export const getLightAsset = assetId => ASSET_CATALOG[assetId] ?? ASSET_CATALOG.GERAN_2;

export const getSystemAssetId = (category, component, heading = 0) => {
  if (category === 'GUN') {
    const nearestHeading = (Math.round((((heading % 360) + 360) % 360) / 45) * 45) % 360;
    return `GEPARD_${nearestHeading}`;
  }
  return SYSTEM_ASSETS[category]?.[component] ?? SYSTEM_ASSETS.SHORT[component];
};

export const getTargetAssetId = target => {
  if (target?.modelId && ASSET_CATALOG[target.modelId]) return target.modelId;
  if (target?.type === 'BALLISTIC_TARGET') return LIGHT_TARGET_MODEL.ISKANDER_M;
  if (target?.type === 'CRUISE_TARGET') return LIGHT_TARGET_MODEL.KH_101;
  return LIGHT_TARGET_MODEL.GERAN_2;
};

export const getTargetDisplayName = (targetOrModelId) => {
  const assetId = typeof targetOrModelId === 'string'
    ? targetOrModelId
    : getTargetAssetId(targetOrModelId);
  return getTargetModelDisplayName(assetId);
};
