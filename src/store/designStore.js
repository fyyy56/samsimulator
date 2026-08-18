import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const DESIGN_SCHEMA_VERSION = 1;

export const DEFAULT_SURFACE_STYLE = Object.freeze({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  backgroundColor: '#0a171c',
  gradientColor: '#21464d',
  gradientStrength: 0.35,
  gradientAngle: 135,
  backgroundAlpha: 0.86,
  textColor: '#edf2ee',
  borderColor: '#668087',
  borderWidth: 1,
  borderRadius: 8,
  opacity: 1,
  blur: 12,
  textOverrides: {},
  textSizes: {},
});

const normalizeNumber = (value, fallback, minimum = -Infinity, maximum = Infinity) => (
  Math.min(maximum, Math.max(minimum, Number.isFinite(Number(value)) ? Number(value) : fallback))
);

export const normalizeSurfaceStyle = (style = {}) => ({
  x: normalizeNumber(style.x, 0, -2000, 2000),
  y: normalizeNumber(style.y, 0, -2000, 2000),
  width: normalizeNumber(style.width, 0, 0, 2000),
  height: normalizeNumber(style.height, 0, 0, 1600),
  backgroundColor: /^#[0-9a-f]{6}$/i.test(style.backgroundColor) ? style.backgroundColor : DEFAULT_SURFACE_STYLE.backgroundColor,
  gradientColor: /^#[0-9a-f]{6}$/i.test(style.gradientColor) ? style.gradientColor : DEFAULT_SURFACE_STYLE.gradientColor,
  gradientStrength: normalizeNumber(style.gradientStrength, DEFAULT_SURFACE_STYLE.gradientStrength, 0, 1),
  gradientAngle: normalizeNumber(style.gradientAngle, DEFAULT_SURFACE_STYLE.gradientAngle, 0, 360),
  backgroundAlpha: normalizeNumber(style.backgroundAlpha, DEFAULT_SURFACE_STYLE.backgroundAlpha, 0, 1),
  textColor: /^#[0-9a-f]{6}$/i.test(style.textColor) ? style.textColor : DEFAULT_SURFACE_STYLE.textColor,
  borderColor: /^#[0-9a-f]{6}$/i.test(style.borderColor) ? style.borderColor : DEFAULT_SURFACE_STYLE.borderColor,
  borderWidth: normalizeNumber(style.borderWidth, 1, 0, 8),
  borderRadius: normalizeNumber(style.borderRadius, 8, 0, 80),
  opacity: normalizeNumber(style.opacity, 1, 0.15, 1),
  blur: normalizeNumber(style.blur, 12, 0, 40),
  textOverrides: Object.fromEntries(Object.entries(style.textOverrides ?? {}).filter(([key, value]) => key && typeof value === 'string')),
  textSizes: Object.fromEntries(Object.entries(style.textSizes ?? {}).filter(([key, value]) => key && Number.isFinite(Number(value))).map(([key, value]) => [key, normalizeNumber(value, 10, 5, 96)])),
});

const createProfile = (id = 'custom', name = 'Мой дизайн') => ({ id, name, surfaces: {} });

export const useDesignStore = create(persist((set, get) => ({
  schemaVersion: DESIGN_SCHEMA_VERSION,
  enabled: false,
  selectedSurfaceId: null,
  profiles: [createProfile()],
  activeProfileId: 'custom',
  toggle: () => set(state => ({ enabled: !state.enabled, selectedSurfaceId: null })),
  setEnabled: enabled => set({ enabled, selectedSurfaceId: null }),
  selectSurface: selectedSurfaceId => set({ selectedSurfaceId }),
  updateSurface: (surfaceId, patch) => set(state => ({
    profiles: state.profiles.map(profile => profile.id === state.activeProfileId ? {
      ...profile,
      surfaces: {
        ...profile.surfaces,
        [surfaceId]: normalizeSurfaceStyle({
          ...DEFAULT_SURFACE_STYLE,
          ...profile.surfaces[surfaceId],
          ...patch,
        }),
      },
    } : profile),
  })),
  resetSurface: surfaceId => set(state => ({
    profiles: state.profiles.map(profile => {
      if (profile.id !== state.activeProfileId) return profile;
      const surfaces = { ...profile.surfaces };
      delete surfaces[surfaceId];
      return { ...profile, surfaces };
    }),
  })),
  createProfile: name => {
    const id = `DESIGN-${Date.now()}`;
    set(state => ({ profiles: [...state.profiles, createProfile(id, name?.trim() || 'Новый пресет')], activeProfileId: id, selectedSurfaceId: null }));
    return id;
  },
  renameActiveProfile: name => set(state => ({ profiles: state.profiles.map(profile => profile.id === state.activeProfileId ? { ...profile, name: name?.trim() || profile.name } : profile) })),
  setActiveProfile: activeProfileId => set({ activeProfileId, selectedSurfaceId: null }),
  importConfiguration: configuration => {
    if (!configuration || configuration.schemaVersion !== DESIGN_SCHEMA_VERSION || !Array.isArray(configuration.profiles)) return false;
    const profiles = configuration.profiles.filter(profile => profile?.id && profile?.name).map(profile => ({
      id: String(profile.id),
      name: String(profile.name),
      surfaces: Object.fromEntries(Object.entries(profile.surfaces ?? {}).map(([id, style]) => [id, normalizeSurfaceStyle(style)])),
    }));
    if (!profiles.length) return false;
    set({ profiles, activeProfileId: profiles.some(profile => profile.id === configuration.activeProfileId) ? configuration.activeProfileId : profiles[0].id, selectedSurfaceId: null });
    return true;
  },
  exportConfiguration: () => {
    const state = get();
    return { schemaVersion: DESIGN_SCHEMA_VERSION, activeProfileId: state.activeProfileId, profiles: state.profiles };
  },
}), {
  name: 'sam-simulator-design-v1',
  version: DESIGN_SCHEMA_VERSION,
  storage: createJSONStorage(() => localStorage),
  partialize: state => ({
    schemaVersion: state.schemaVersion,
    enabled: state.enabled,
    profiles: state.profiles,
    activeProfileId: state.activeProfileId,
  }),
}));

export const selectActiveDesignProfile = state => (
  state.profiles.find(profile => profile.id === state.activeProfileId) ?? state.profiles[0]
);

const hexToRgba = (hex, alpha) => {
  const numeric = Number.parseInt(hex.slice(1), 16);
  return `rgba(${numeric >> 16}, ${(numeric >> 8) & 255}, ${numeric & 255}, ${alpha})`;
};

export const toSurfaceCss = style => style ? {
  transform: `translate(${style.x}px, ${style.y}px)`,
  width: style.width > 0 ? `${style.width}px` : undefined,
  height: style.height > 0 ? `${style.height}px` : undefined,
  background: `linear-gradient(${style.gradientAngle}deg, ${hexToRgba(style.backgroundColor, style.backgroundAlpha)}, ${hexToRgba(style.gradientColor, style.backgroundAlpha * style.gradientStrength)})`,
  color: style.textColor,
  borderColor: style.borderColor,
  borderWidth: `${style.borderWidth}px`,
  borderRadius: `${style.borderRadius}px`,
  opacity: style.opacity,
  backdropFilter: `blur(${style.blur}px)`,
  overflowWrap: 'anywhere',
} : undefined;

export const useDesignSurface = surfaceId => {
  const style = useDesignStore(state => selectActiveDesignProfile(state)?.surfaces[surfaceId]);
  return toSurfaceCss(style ? { ...DEFAULT_SURFACE_STYLE, ...style } : null);
};
