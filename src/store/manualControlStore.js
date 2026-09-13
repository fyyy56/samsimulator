import { create } from 'zustand';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const NEUTRAL_COMMAND = Object.freeze({ throttle: 0, pitch: 0, yaw: 0, roll: 0 });
export const THROTTLE_ASSIST_MODE = Object.freeze({
  OFF: 'OFF',
  SPEED_HOLD: 'SPEED_HOLD',
  MATCH_SPEED: 'MATCH_SPEED',
  APPROACH: 'APPROACH',
});
const NEUTRAL_ASSIST = Object.freeze({ mode: THROTTLE_ASSIST_MODE.OFF, targetSpeedMps: null });

const normalizeCommand = command => ({
  throttle: clamp(Number(command?.throttle) || 0, 0, 1),
  pitch: clamp(Number(command?.pitch) || 0, -1, 1),
  yaw: clamp(Number(command?.yaw) || 0, -1, 1),
  roll: clamp(Number(command?.roll) || 0, -1, 1),
});

export const useManualControlStore = create(set => ({
  ownerEntityId: null,
  command: NEUTRAL_COMMAND,
  throttleAssist: NEUTRAL_ASSIST,
  claim: ownerEntityId => set({ ownerEntityId, command: NEUTRAL_COMMAND,
    throttleAssist: NEUTRAL_ASSIST }),
  release: ownerEntityId => set(state => (
    ownerEntityId == null || state.ownerEntityId === ownerEntityId
      ? { ownerEntityId: null, command: NEUTRAL_COMMAND, throttleAssist: NEUTRAL_ASSIST }
      : {}
  )),
  setCommand: (ownerEntityId, command) => set(state => (
    state.ownerEntityId === ownerEntityId
      ? { command: normalizeCommand(command) }
      : {}
  )),
  clearCommand: ownerEntityId => set(state => (
    state.ownerEntityId === ownerEntityId ? { command: NEUTRAL_COMMAND } : {}
  )),
  setThrottleAssist: (ownerEntityId, mode, targetSpeedMps = null) => set(state => (
    state.ownerEntityId === ownerEntityId
      ? { throttleAssist: {
        mode: Object.values(THROTTLE_ASSIST_MODE).includes(mode)
          ? mode : THROTTLE_ASSIST_MODE.OFF,
        targetSpeedMps: Number.isFinite(targetSpeedMps) ? targetSpeedMps : null,
      } }
      : {}
  )),
}));

export const getManualControlSnapshot = ownerEntityId => {
  const state = useManualControlStore.getState();
  return state.ownerEntityId === ownerEntityId ? state.command : NEUTRAL_COMMAND;
};
