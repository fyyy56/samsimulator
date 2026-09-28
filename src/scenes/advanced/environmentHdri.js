import { Cartesian3 } from 'cesium';
import coefficients from './environmentHdriCoefficients.json';

// The source Radiance HDR files are projected offline by scripts/buildEnvironmentHdri.mjs.
// Cesium receives cached third-order diffuse SH; no HDR texture is decoded at runtime.
export const HDRI_PRESETS = Object.fromEntries(Object.entries(coefficients).map(([key, rows]) =>
  [key, { diffuse: rows.map(row => Cartesian3.fromArray(row)) }]));
