import { create } from 'zustand';

export const ENVIRONMENT_PRESETS = {
  DAY: { hour: 10, intensity: 1.6, exposure: 1.05, brightness: 1, fog: 0.00012, tint: [1, 1, 1] },
  SUNRISE: { hour: 4.2, intensity: 1.1, exposure: 1.15, brightness: 0.94, fog: 0.00018, tint: [1, 0.80, 0.65] },
  SUNSET: { hour: 15.5, intensity: 1.15, exposure: 1.1, brightness: 0.94, fog: 0.00018, tint: [1, 0.76, 0.58] },
  NIGHT: { hour: 22, intensity: 0.16, exposure: 1.1, brightness: 0.34, fog: 0.0001, tint: [0.48, 0.61, 0.85] },
};
export const CLOUD_TYPES = ['CLEAR', 'THIN_SCATTERED', 'CUMULUS', 'OVERCAST'];
export const useEnvironmentSettings = create(set => ({
  preset: 'DAY', cloudType: 'CUMULUS', cover: 0.45, altitude: 2200, density: 0.65,
  set: (key, value) => set(state => {
    if (key === 'preset' && ENVIRONMENT_PRESETS[value]) return { preset: value };
    if (key === 'cloudType' && CLOUD_TYPES.includes(value)) return {
      cloudType: value, cover: value === 'OVERCAST' ? .95 : value === 'THIN_SCATTERED' ? .25 : .45,
    };
    const limits = { cover: [0, 1], altitude: [300, 8000], density: [0.05, 1] };
    if (!limits[key] || !Number.isFinite(Number(value))) return state;
    return { [key]: Math.max(limits[key][0], Math.min(limits[key][1], Number(value))) };
  }),
}));
