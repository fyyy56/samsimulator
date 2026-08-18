import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { CONTENT_SCHEMA_VERSION, normalizeEditorObject } from '../content/contentSchemas.js';

export const DEFAULT_UI_LAYOUT = Object.freeze({
  radar: { x: 18, y: 86, width: 240, height: 90, opacity: 0.78 },
  targets: { x: 18, y: 190, width: 240, height: 120, opacity: 0.84 },
  info: { x: 18, y: 324, width: 240, height: 150, opacity: 0.88 },
  hud: { x: 18, y: 18, width: 310, height: 52, opacity: 0.9 },
});

const copyLayout = layout => Object.fromEntries(
  Object.entries(layout).map(([key, value]) => [key, { ...value }]),
);

const emptyDraft = () => ({
  schemaVersion: CONTENT_SCHEMA_VERSION,
  id: null,
  name: 'Новый сценарий',
  description: '',
  updatedAt: null,
  objects: [],
});

export const useContentStore = create(persist((set, get) => ({
  schemaVersion: CONTENT_SCHEMA_VERSION,
  userAssets: [],
  userScenarios: [],
  editorDraft: emptyDraft(),
  uiPresets: [{ id: 'default', name: 'Стандартный', layout: copyLayout(DEFAULT_UI_LAYOUT) }],
  activeUiPresetId: 'default',

  addUserAsset: asset => {
    const normalized = {
      id: asset.id ?? `USR-ASSET-${Date.now()}`,
      name: asset.name?.trim() || 'Пользовательская модель',
      dataUrl: asset.dataUrl,
      objectType: asset.objectType ?? 'UAV',
      scale: Math.max(0.2, Number(asset.scale) || 1),
      offsetX: Number(asset.offsetX) || 0,
      offsetY: Number(asset.offsetY) || 0,
      createdAt: new Date().toISOString(),
    };
    set(state => ({ userAssets: [...state.userAssets, normalized] }));
    return normalized.id;
  },
  removeUserAsset: id => set(state => ({ userAssets: state.userAssets.filter(asset => asset.id !== id) })),
  updateUserAsset: (id, patch) => set(state => ({
    userAssets: state.userAssets.map(asset => asset.id === id ? {
      ...asset,
      ...patch,
      scale: patch.scale == null ? asset.scale : Math.max(0.2, Number(patch.scale) || 1),
      offsetX: patch.offsetX == null ? asset.offsetX : Number(patch.offsetX) || 0,
      offsetY: patch.offsetY == null ? asset.offsetY : Number(patch.offsetY) || 0,
    } : asset),
  })),

  setEditorDraft: draft => set({
    editorDraft: {
      ...emptyDraft(),
      ...draft,
      objects: (draft.objects ?? []).map(normalizeEditorObject),
      updatedAt: new Date().toISOString(),
    },
  }),
  clearEditorDraft: () => set({ editorDraft: emptyDraft() }),
  loadScenarioIntoEditor: id => {
    const scenario = get().userScenarios.find(item => item.id === id);
    if (scenario) set({ editorDraft: { ...scenario, objects: scenario.objects.map(normalizeEditorObject) } });
  },
  saveScenario: draft => {
    const id = draft.id ?? `USR-SCENARIO-${Date.now()}`;
    const scenario = {
      ...emptyDraft(),
      ...draft,
      id,
      schemaVersion: CONTENT_SCHEMA_VERSION,
      name: draft.name?.trim() || 'Безымянный сценарий',
      objects: (draft.objects ?? []).map(normalizeEditorObject),
      updatedAt: new Date().toISOString(),
    };
    set(state => ({
      userScenarios: [...state.userScenarios.filter(item => item.id !== id), scenario],
      editorDraft: scenario,
    }));
    return id;
  },
  deleteScenario: id => set(state => ({
    userScenarios: state.userScenarios.filter(scenario => scenario.id !== id),
    editorDraft: state.editorDraft.id === id ? emptyDraft() : state.editorDraft,
  })),

  saveUiPreset: ({ id, name, layout }) => {
    const presetId = id ?? `UI-${Date.now()}`;
    const preset = { id: presetId, name: name?.trim() || 'Мой интерфейс', layout: copyLayout(layout) };
    set(state => ({
      uiPresets: [...state.uiPresets.filter(item => item.id !== presetId), preset],
      activeUiPresetId: presetId,
    }));
    return presetId;
  },
  setActiveUiPreset: activeUiPresetId => set({ activeUiPresetId }),
}), {
  name: 'sam-simulator-content-v1',
  version: CONTENT_SCHEMA_VERSION,
  storage: createJSONStorage(() => localStorage),
  partialize: state => ({
    schemaVersion: state.schemaVersion,
    userAssets: state.userAssets,
    userScenarios: state.userScenarios,
    editorDraft: state.editorDraft,
    uiPresets: state.uiPresets,
    activeUiPresetId: state.activeUiPresetId,
  }),
}));

export const selectActiveUiPreset = state => (
  state.uiPresets.find(preset => preset.id === state.activeUiPresetId) ?? state.uiPresets[0]
);
