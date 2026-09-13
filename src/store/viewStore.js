import { create } from 'zustand';

const ADVANCED_OVERLAYS_KEY = 'dronefall.advanced.overlays.v2';
const LEGACY_ADVANCED_OVERLAYS_KEY = 'dronefall.advanced.overlays.v1';
export const ADVANCED_OVERLAY_DEFAULTS = Object.freeze({
  missileVectors: false,
  trackLabels: true,
  radarBeams: false,
  targetVectors: false,
  thermalTraces: false,
  debug: false,
  seekerFov: false,
  seekerBoresight: false,
  seekerTargetLos: false,
  seekerLabels: false,
  irSeekerFov: false,
  arhSeekerFov: false,
  seekerState: false,
  trackUncertainty: false,
  sensorSource: false,
  rawRadarMeasurements: false,
  interceptPoint: false,
  missileAimPoint: false,
  networkTrackEstimate: false,
  seekerEstimate: false,
  networkOwner: false,
  performance: false,
});
const defaultOverlays = ADVANCED_OVERLAY_DEFAULTS;
const readOverlays = () => {
  try {
    const current = globalThis.localStorage?.getItem(ADVANCED_OVERLAYS_KEY);
    const legacy = globalThis.localStorage?.getItem(LEGACY_ADVANCED_OVERLAYS_KEY);
    const saved = JSON.parse(current ?? legacy ?? '{}');
    return Object.fromEntries(Object.entries(defaultOverlays).map(([key, fallback]) =>
      // v1 could persist missile vectors from the old gameplay menu. Keep
      // other preferences, but require an explicit debug opt-in in v2.
      [key, key === 'missileVectors' && !current
        ? fallback : typeof saved?.[key] === 'boolean' ? saved[key] : fallback]));
  } catch { return { ...defaultOverlays }; }
};

export const SIMPLE_MAP_THEME = Object.freeze({
  DARK: 'DARK',
  SATELLITE: 'SATELLITE',
  LIGHT: 'LIGHT',
});

export const useViewStore = create(set => ({
  advancedOverlays: readOverlays(),
  toggleAdvancedOverlay: key => set(state => {
    if (!(key in defaultOverlays)) return state;
    const advancedOverlays = { ...state.advancedOverlays, [key]: !state.advancedOverlays[key] };
    try { globalThis.localStorage?.setItem(ADVANCED_OVERLAYS_KEY, JSON.stringify(advancedOverlays)); } catch { /* Optional persistence. */ }
    return { advancedOverlays, ...(key === 'debug'
      ? { layers: { ...state.layers, debugOverlay: advancedOverlays.debug } } : {}) };
  }),
  simpleMapTheme: SIMPLE_MAP_THEME.LIGHT,
  layers: {
    allEnemyTargets: true,
    debugOverlay: readOverlays().debug,
    protectedObjects: true,
  },
  setSimpleMapTheme: simpleMapTheme => set({ simpleMapTheme }),
  toggleLayer: layerId => set(state => ({
    ...(layerId === 'debugOverlay' ? { advancedOverlays: {
      ...state.advancedOverlays, debug: !state.layers.debugOverlay,
    } } : {}),
    layers: {
      ...state.layers,
      [layerId]: !state.layers[layerId],
    },
  })),
}));
