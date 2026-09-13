import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  cloneLaunchProfile,
  DEFAULT_LAUNCH_PROFILES,
  normalizeLaunchProfile,
} from '../data/launchProfiles.js';

export const useLaunchProfileStore = create(persist(set => ({
  savedProfiles: {},
  saveProfile: profile => set(state => ({
    savedProfiles: {
      ...state.savedProfiles,
      [profile.id]: normalizeLaunchProfile(
        profile,
        DEFAULT_LAUNCH_PROFILES[profile.interceptorSpecId],
      ),
    },
  })),
  resetProfile: interceptorSpecId => set(state => {
    const fallback = DEFAULT_LAUNCH_PROFILES[interceptorSpecId];
    const savedProfiles = { ...state.savedProfiles };
    delete savedProfiles[fallback?.id];
    delete savedProfiles[interceptorSpecId];
    return { savedProfiles };
  }),
}), {
  name: 'sam-simulator-launch-profiles-v1',
  version: 4,
  storage: createJSONStorage(() => localStorage),
  migrate: persistedState => {
    const migratedProfiles = {};
    Object.entries(persistedState?.savedProfiles ?? {}).forEach(([key, value]) => {
      const fallback = DEFAULT_LAUNCH_PROFILES[value?.interceptorSpecId ?? key];
      if (!fallback) return;
      migratedProfiles[fallback.id] = normalizeLaunchProfile(value, fallback);
    });
    return { savedProfiles: migratedProfiles };
  },
  partialize: state => ({ savedProfiles: state.savedProfiles }),
}));

export function getLaunchProfile(interceptorSpecId) {
  const fallback = DEFAULT_LAUNCH_PROFILES[interceptorSpecId];
  if (!fallback) throw new Error(`Unknown launch profile: ${interceptorSpecId}`);
  const savedProfiles = useLaunchProfileStore.getState().savedProfiles;
  const saved = savedProfiles[fallback.id] ?? savedProfiles[interceptorSpecId];
  return cloneLaunchProfile(saved ? normalizeLaunchProfile(saved, fallback) : fallback);
}
