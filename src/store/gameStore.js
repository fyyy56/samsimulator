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
  GAME_2D: 'GAME_2D',
  SANDBOX_2D: 'SANDBOX_2D',
  ADVANCED_3D: 'ADVANCED_3D',
  SANDBOX_3D: 'SANDBOX_3D',
  // Compatibility aliases for fixtures and content screens. Production
  // navigation uses the four explicit identities above.
  SIMPLE: 'GAME_2D',
  SANDBOX: 'SANDBOX_2D',
  ADVANCED_PLACEHOLDER: 'ADVANCED_3D',
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

const normalizeCommandScene = (scene, fallback = GAME_SCENE.GAME_2D) => (
  scene === 'SANDBOX' ? GAME_SCENE.SANDBOX_2D
    : scene === 'SIMPLE' ? GAME_SCENE.GAME_2D
      : scene ?? fallback
);

export const useGameStore = create(set => ({
  gameMode: null,
  scene: GAME_SCENE.MENU,
  language: UI_LANGUAGE.RU,
  activeScenarioId: null,
  developerMode: false,
  commandScene: GAME_SCENE.GAME_2D,
  resumeCommandSimulation: false,
  presentationMode: PRESENTATION_MODE.COMMAND,
  fpvFeedEntityId: null,
  olsStationId: null,
  olsRequestedTargetKey: null,
  torOlsManual: false,
  torOlsReturnScene: null,
  commandViewState: null,
  setLanguage: language => set({ language }),
  selectMode: (gameMode) => set({
    gameMode,
    commandScene: GAME_SCENE.GAME_2D,
    resumeCommandSimulation: false,
    presentationMode: gameMode === GAME_MODE.SIMPLE
      ? PRESENTATION_MODE.COMMAND : PRESENTATION_MODE.ADVANCED,
    fpvFeedEntityId: null,
    scene: gameMode === GAME_MODE.SIMPLE
      ? GAME_SCENE.GAME_2D
      : GAME_SCENE.ADVANCED_3D,
  }),
  openSandbox: () => set({ gameMode: GAME_MODE.SIMPLE, developerMode: false,
    activeScenarioId: null, commandScene: GAME_SCENE.SANDBOX_2D, resumeCommandSimulation: false,
    presentationMode: PRESENTATION_MODE.COMMAND, fpvFeedEntityId: null,
    olsStationId: null, commandViewState: null, scene: GAME_SCENE.SANDBOX_2D }),
  openAdvanced3D: () => set({ gameMode: GAME_MODE.ADVANCED, developerMode: false,
    activeScenarioId: null, resumeCommandSimulation: false,
    presentationMode: PRESENTATION_MODE.ADVANCED, fpvFeedEntityId: null,
    olsStationId: null, commandViewState: null, scene: GAME_SCENE.ADVANCED_3D }),
  openAdvancedSandbox: () => set({ gameMode: GAME_MODE.ADVANCED, developerMode: false,
    activeScenarioId: null, resumeCommandSimulation: false,
    presentationMode: PRESENTATION_MODE.ADVANCED, fpvFeedEntityId: null,
    olsStationId: null, commandViewState: null, scene: GAME_SCENE.SANDBOX_3D }),
  openDeveloperMode: () => set({ gameMode: GAME_MODE.SIMPLE, developerMode: true,
    activeScenarioId: null, commandScene: GAME_SCENE.GAME_2D,
    resumeCommandSimulation: false, presentationMode: PRESENTATION_MODE.COMMAND,
    fpvFeedEntityId: null, olsStationId: null, scene: GAME_SCENE.GAME_2D }),
  openScenarioLibrary: () => set({ scene: GAME_SCENE.SCENARIOS }),
  openEditor: () => set({ scene: GAME_SCENE.EDITOR }),
  openEditorMap: () => set({ scene: GAME_SCENE.EDITOR_MAP }),
  openObjectEditor: () => set({ scene: GAME_SCENE.OBJECT_EDITOR }),
  openReference: () => set({ scene: GAME_SCENE.REFERENCE }),
  openUiEditor: () => set({ scene: GAME_SCENE.UI_EDITOR }),
  startScenario: activeScenarioId => set({ gameMode: GAME_MODE.SIMPLE, developerMode: false,
    activeScenarioId, commandScene: GAME_SCENE.GAME_2D,
    resumeCommandSimulation: false, presentationMode: PRESENTATION_MODE.COMMAND,
    fpvFeedEntityId: null, olsStationId: null, commandViewState: null,
    scene: GAME_SCENE.GAME_2D }),
  openAdvancedPreview: commandScene => set(state => ({
    gameMode: GAME_MODE.ADVANCED,
    commandScene: commandScene === 'SANDBOX' ? GAME_SCENE.SANDBOX_2D
      : commandScene === 'SIMPLE' ? GAME_SCENE.GAME_2D
        : commandScene ?? state.commandScene ?? GAME_SCENE.GAME_2D,
    resumeCommandSimulation: false,
    scene: commandScene === 'SANDBOX' || commandScene === GAME_SCENE.SANDBOX_2D
      ? GAME_SCENE.SANDBOX_3D : GAME_SCENE.ADVANCED_3D,
    presentationMode: PRESENTATION_MODE.ADVANCED,
    fpvFeedEntityId: null,
  })),
  openFpvFeed: (commandScene, fpvFeedEntityId) => set(state => ({
    // COMMAND remains the gameplay mode; Cesium is only the temporary camera backend.
    gameMode: GAME_MODE.SIMPLE,
    commandScene: normalizeCommandScene(commandScene, state.commandScene),
    resumeCommandSimulation: true,
    presentationMode: PRESENTATION_MODE.FPV_FEED,
    fpvFeedEntityId,
    scene: GAME_SCENE.ADVANCED_3D,
  })),
  saveCommandViewState: commandViewState => set({ commandViewState }),
  openOlsFeed: (commandScene, olsStationId, olsRequestedTargetKey = null) => set(state => ({
    gameMode: GAME_MODE.SIMPLE,
    commandScene: normalizeCommandScene(commandScene, state.commandScene),
    resumeCommandSimulation: true,
    presentationMode: PRESENTATION_MODE.OLS_FEED,
    fpvFeedEntityId: null,
    olsStationId,
    olsRequestedTargetKey,
    scene: state.scene === GAME_SCENE.SANDBOX_3D
      ? GAME_SCENE.SANDBOX_3D : GAME_SCENE.ADVANCED_3D,
  })),
  openTorOlsFeed: (stationId, manual, requestedKey = null) => set(state => ({
    gameMode: GAME_MODE.ADVANCED,
    resumeCommandSimulation: true,
    presentationMode: PRESENTATION_MODE.OLS_FEED,
    olsStationId: stationId,
    torOlsManual: manual,
    olsRequestedTargetKey: requestedKey,
    torOlsReturnScene: state.scene,
  })),
  returnFromTorOls: () => set(state => ({
    gameMode: GAME_MODE.ADVANCED,
    resumeCommandSimulation: true,
    presentationMode: PRESENTATION_MODE.ADVANCED,
    scene: state.torOlsReturnScene ?? GAME_SCENE.ADVANCED_3D,
    olsStationId: null,
    torOlsManual: false,
    torOlsReturnScene: null,
  })),
  returnToCommand: () => set(state => ({
    gameMode: GAME_MODE.SIMPLE,
    resumeCommandSimulation: state.resumeCommandSimulation,
    scene: state.commandScene ?? GAME_SCENE.GAME_2D,
    presentationMode: PRESENTATION_MODE.COMMAND,
    fpvFeedEntityId: null,
    olsRequestedTargetKey: null,
  })),
  openSettings: () => set({ scene: GAME_SCENE.SETTINGS }),
  returnToMenu: () => set({ gameMode: null, developerMode: false,
    resumeCommandSimulation: false, presentationMode: PRESENTATION_MODE.COMMAND,
    fpvFeedEntityId: null, olsStationId: null, commandViewState: null,
    olsRequestedTargetKey: null,
    scene: GAME_SCENE.MENU }),
}));

export const is2DScene = scene => scene === GAME_SCENE.GAME_2D || scene === GAME_SCENE.SANDBOX_2D;
export const isAdvancedScene = scene => scene === GAME_SCENE.ADVANCED_3D || scene === GAME_SCENE.SANDBOX_3D;
export const isSandboxScene = scene => scene === GAME_SCENE.SANDBOX_2D || scene === GAME_SCENE.SANDBOX_3D;
