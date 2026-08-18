import { create } from 'zustand';

export const SIMPLE_MAP_THEME = Object.freeze({
  DARK: 'DARK',
  SATELLITE: 'SATELLITE',
  LIGHT: 'LIGHT',
});

export const useViewStore = create(set => ({
  simpleMapTheme: SIMPLE_MAP_THEME.LIGHT,
  layers: {
    allEnemyTargets: true,
    debugOverlay: false,
  },
  setSimpleMapTheme: simpleMapTheme => set({ simpleMapTheme }),
  toggleLayer: layerId => set(state => ({
    layers: {
      ...state.layers,
      [layerId]: !state.layers[layerId],
    },
  })),
}));
