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
  EDITOR_MAP: 'EDITOR_MAP',
  OBJECT_EDITOR: 'OBJECT_EDITOR',
  REFERENCE: 'REFERENCE',
  UI_EDITOR: 'UI_EDITOR',
  SETTINGS: 'SETTINGS',
});

export const PRESENTATION_MODE = Object.freeze({
  COMMAND: 'COMMAND',
  ADVANCED: 'ADVANCED',
  FPV_FEED: 'FPV_FEED',
  OLS_FEED: 'OLS_FEED',
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
  commandScene: GAME_SCENE.SIMPLE,
  resumeCommandSimulation: false,
  presentationMode: PRESENTATION_MODE.COMMAND,
  fpvFeedEntityId: null,
  olsStationId: null,
  commandViewState: null,
  setLanguage: language => set({ language }),
  selectMode: (gameMode) => set({
    gameMode,
    commandScene: GAME_SCENE.SIMPLE,
    resumeCommandSimulation: false,
    presentationMode: gameMode === GAME_MODE.SIMPLE
      ? PRESENTATION_MODE.COMMAND : PRESENTATION_MODE.ADVANCED,
    fpvFeedEntityId: null,
    scene: gameMode === GAME_MODE.SIMPLE
      ? GAME_SCENE.SIMPLE
      : GAME_SCENE.ADVANCED_PLACEHOLDER,
  }),
  openSandbox: () => set({ gameMode: GAME_MODE.SIMPLE, developerMode: false,
    commandScene: GAME_SCENE.SANDBOX, resumeCommandSimulation: false,
    presentationMode: PRESENTATION_MODE.COMMAND, fpvFeedEntityId: null,
    scene: GAME_SCENE.SANDBOX }),
  openDeveloperMode: () => set({ gameMode: GAME_MODE.SIMPLE, developerMode: true,
    activeScenarioId: null, commandScene: GAME_SCENE.SIMPLE,
    resumeCommandSimulation: false, presentationMode: PRESENTATION_MODE.COMMAND,
    fpvFeedEntityId: null, scene: GAME_SCENE.SIMPLE }),
  openScenarioLibrary: () => set({ scene: GAME_SCENE.SCENARIOS }),
  openEditor: () => set({ scene: GAME_SCENE.EDITOR }),
  openEditorMap: () => set({ scene: GAME_SCENE.EDITOR_MAP }),
  openObjectEditor: () => set({ scene: GAME_SCENE.OBJECT_EDITOR }),
  openReference: () => set({ scene: GAME_SCENE.REFERENCE }),
  openUiEditor: () => set({ scene: GAME_SCENE.UI_EDITOR }),
  startScenario: activeScenarioId => set({ gameMode: GAME_MODE.SIMPLE, developerMode: false,
    activeScenarioId, commandScene: GAME_SCENE.SIMPLE,
    resumeCommandSimulation: false, presentationMode: PRESENTATION_MODE.COMMAND,
    fpvFeedEntityId: null, scene: GAME_SCENE.SIMPLE }),
  openAdvancedPreview: commandScene => set(state => ({
    gameMode: GAME_MODE.ADVANCED,
    commandScene: commandScene ?? state.commandScene ?? GAME_SCENE.SIMPLE,
    resumeCommandSimulation: true,
    scene: GAME_SCENE.ADVANCED_PLACEHOLDER,
    presentationMode: PRESENTATION_MODE.ADVANCED,
    fpvFeedEntityId: null,
  })),
  openFpvFeed: (commandScene, fpvFeedEntityId) => set(state => ({
    // COMMAND remains the gameplay mode; Cesium is only the temporary camera backend.
    gameMode: GAME_MODE.SIMPLE,
    commandScene: commandScene ?? state.commandScene ?? GAME_SCENE.SIMPLE,
    resumeCommandSimulation: true,
    presentationMode: PRESENTATION_MODE.FPV_FEED,
    fpvFeedEntityId,
    scene: GAME_SCENE.ADVANCED_PLACEHOLDER,
  })),
  saveCommandViewState: commandViewState => set({ commandViewState }),
  openOlsFeed: (commandScene, olsStationId) => set(state => ({
    gameMode: GAME_MODE.SIMPLE,
    commandScene: commandScene ?? state.commandScene ?? GAME_SCENE.SIMPLE,
    resumeCommandSimulation: true,
    presentationMode: PRESENTATION_MODE.OLS_FEED,
    fpvFeedEntityId: null,
    olsStationId,
    scene: GAME_SCENE.ADVANCED_PLACEHOLDER,
  })),
  returnToCommand: () => set(state => ({
    gameMode: GAME_MODE.SIMPLE,
    resumeCommandSimulation: state.resumeCommandSimulation,
    scene: state.commandScene ?? GAME_SCENE.SIMPLE,
    presentationMode: PRESENTATION_MODE.COMMAND,
    fpvFeedEntityId: null,
  })),
  openSettings: () => set({ scene: GAME_SCENE.SETTINGS }),
  returnToMenu: () => set({ gameMode: null, developerMode: false,
    resumeCommandSimulation: false, presentationMode: PRESENTATION_MODE.COMMAND,
    fpvFeedEntityId: null, scene: GAME_SCENE.MENU }),
}));
