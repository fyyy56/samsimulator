import { create } from 'zustand';

export const GAME_MODE = Object.freeze({
  SIMPLE: 'SIMPLE',
  ADVANCED: 'ADVANCED',
});

export const UI_LANGUAGE = Object.freeze({
  RU: 'RU',
  EN: 'EN',
});

export const GAME_SCENE = Object.freeze({
  MENU: 'MENU',
  SIMPLE: 'SIMPLE',
  ADVANCED_PLACEHOLDER: 'ADVANCED_PLACEHOLDER',
  SANDBOX: 'SANDBOX',
  SCENARIOS: 'SCENARIOS',
  EDITOR: 'EDITOR',
  REFERENCE: 'REFERENCE',
  UI_EDITOR: 'UI_EDITOR',
  SETTINGS: 'SETTINGS',
});

export const GAME_MODE_CONFIG = Object.freeze({
  [GAME_MODE.SIMPLE]: {
    renderer: 'MAPLIBRE_2D',
    physicsLevel: 'BASIC',
    uiDetail: 'OPERATIONAL',
  },
  [GAME_MODE.ADVANCED]: {
    renderer: 'CESIUM_3D',
    physicsLevel: 'ADVANCED',
    uiDetail: 'DETAILED',
  },
});

export const useGameStore = create(set => ({
  gameMode: null,
  scene: GAME_SCENE.MENU,
  language: UI_LANGUAGE.RU,
  activeScenarioId: null,
  developerMode: false,
  setLanguage: language => set({ language }),
  selectMode: (gameMode) => set({
    gameMode,
    scene: gameMode === GAME_MODE.SIMPLE
      ? GAME_SCENE.SIMPLE
      : GAME_SCENE.ADVANCED_PLACEHOLDER,
  }),
  openSandbox: () => set({ gameMode: GAME_MODE.SIMPLE, developerMode: false, scene: GAME_SCENE.SANDBOX }),
  openDeveloperMode: () => set({ gameMode: GAME_MODE.SIMPLE, developerMode: true, activeScenarioId: null, scene: GAME_SCENE.SIMPLE }),
  openScenarioLibrary: () => set({ scene: GAME_SCENE.SCENARIOS }),
  openEditor: () => set({ scene: GAME_SCENE.EDITOR }),
  openReference: () => set({ scene: GAME_SCENE.REFERENCE }),
  openUiEditor: () => set({ scene: GAME_SCENE.UI_EDITOR }),
  startScenario: activeScenarioId => set({ gameMode: GAME_MODE.SIMPLE, developerMode: false, activeScenarioId, scene: GAME_SCENE.SIMPLE }),
  openSettings: () => set({ scene: GAME_SCENE.SETTINGS }),
  returnToMenu: () => set({ gameMode: null, developerMode: false, scene: GAME_SCENE.MENU }),
}));
