import { create } from 'zustand';

export const useViewStore = create(set => ({
  layers: {
    allEnemyTargets: true,
  },
  toggleLayer: layerId => set(state => ({
    layers: {
      ...state.layers,
      [layerId]: !state.layers[layerId],
    },
  })),
}));
