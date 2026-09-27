import { create } from 'zustand';

// Optical presentation only; never consumed by fire control or radar solvers.
export const useOlsViewStore = create(set => ({
  mode: 'DAY', zoom: 1, selectedKey: null,
  visibleEntities: [], status: 'FREE',
  setMode: mode => set({ mode }),
  setZoom: zoom => set({ zoom: Math.max(1, Math.min(40, zoom)) }),
  release: () => set({ selectedKey: null, status: 'FREE' }),
  reset: () => set({ mode: 'DAY', zoom: 1, selectedKey: null,
    visibleEntities: [], status: 'FREE' }),
}));
