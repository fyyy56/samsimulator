import { create } from 'zustand';

export const ENVIRONMENT_PRESETS = {
  DAY_CLEAR: { hour: 10, intensity: 1.45, exposure: 1.0, brightness: 1.0, fog: 0.000055,
    tint: [1, 1, 1], haze: [0.60, 0.67, 0.70], ibl: 0.48 },
  DAY_OVERCAST: { hour: 10, intensity: 0.84, exposure: 0.98, brightness: 0.95, fog: 0.00008,
    tint: [0.83, 0.86, 0.91], haze: [0.60, 0.65, 0.68], ibl: 0.65 },
  SUNRISE: { hour: 4.2, intensity: 1.0, exposure: 1.02, brightness: 0.96, fog: 0.00007,
    tint: [1, 0.81, 0.67], haze: [0.66, 0.57, 0.53], ibl: 0.44 },
  SUNSET: { hour: 15.5, intensity: 1.02, exposure: 1.0, brightness: 0.96, fog: 0.00007,
    tint: [1, 0.78, 0.62], haze: [0.66, 0.55, 0.52], ibl: 0.44 },
  NIGHT: { hour: 22, intensity: 0.26, exposure: 0.96, brightness: 0.32, fog: 0.000045,
    tint: [0.32, 0.40, 0.56], haze: [0.055, 0.070, 0.090], ibl: 0.18 },
};
export const CLOUD_TYPES = ['CLEAR', 'THIN_SCATTERED', 'CUMULUS', 'OVERCAST'];
export const useEnvironmentSettings = create(set => ({
  preset: 'DAY_CLEAR', cloudType: 'CLEAR', cover: 0.45, altitude: 2200, density: 0.65,
  set: (key, value) => set(state => {
    if (key === 'preset' && ENVIRONMENT_PRESETS[value]) return {
      preset: value,
      ...(value === 'DAY_OVERCAST' ? { cloudType: 'OVERCAST', cover: .95 }
        : value === 'DAY_CLEAR' ? { cloudType: 'CLEAR' } : {}),
    };
    if (key === 'cloudType' && CLOUD_TYPES.includes(value)) return {
      cloudType: value, cover: value === 'OVERCAST' ? .95 : value === 'THIN_SCATTERED' ? .25 : .45,
    };
    const limits = { cover: [0, 1], altitude: [300, 8000], density: [0.05, 1] };
    if (!limits[key] || !Number.isFinite(Number(value))) return state;
    return { [key]: Math.max(limits[key][0], Math.min(limits[key][1], Number(value))) };
  }),
}));
