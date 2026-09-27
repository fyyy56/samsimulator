import { create } from 'zustand';
import { SIMPLE_TARGET_TYPE, THEATER_OBJECTS } from './scenarios.js';
import { LIGHT_TARGET_MODEL } from '../data/lightModeAssets.js';
import { BALLISTIC_MANEUVER_MODE } from '../data/ballisticTargetProfiles.js';

const INITIAL_DRAFT = Object.freeze({
  type: SIMPLE_TARGET_TYPE.UAV,
  modelId: LIGHT_TARGET_MODEL.GERAN_2,
  count: 5,
  speedKmh: 250,
  altitudeM: 250,
  objectiveId: THEATER_OBJECTS[0].id,
  terminalCorrectionAngleDeg: 0,
  terminalCorrectionCount: 0,
  terminalCorrectionSide: 'AUTO',
  ballisticManeuverMode: BALLISTIC_MANEUVER_MODE.AUTO,
});

export const useSandboxSpawnDraftStore = create(set => ({
  draft: { ...INITIAL_DRAFT },
  startPosition: null,
  aimPosition: null,
  setDraft: patch => set(state => ({ draft: { ...state.draft, ...patch } })),
  setStartPosition: startPosition => set({ startPosition }),
  setAimPosition: aimPosition => set({ aimPosition }),
  reset: () => set({ draft: { ...INITIAL_DRAFT }, startPosition: null, aimPosition: null }),
}));
