import { THROTTLE_ASSIST_MODE } from '../../store/manualControlStore.js';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
export const FPV_APPROACH_OFFSET_MPS = 4.2;

export const getAssistTargetSpeedMps = (assist, track) => {
  if (assist.mode === THROTTLE_ASSIST_MODE.SPEED_HOLD) return assist.targetSpeedMps;
  if (!Number.isFinite(track?.reportedSpeedKmh)) return null;
  const trackSpeedMps = track.reportedSpeedKmh / 3.6;
  return assist.mode === THROTTLE_ASSIST_MODE.APPROACH
    ? trackSpeedMps + FPV_APPROACH_OFFSET_MPS
    : assist.mode === THROTTLE_ASSIST_MODE.MATCH_SPEED ? trackSpeedMps : null;
};

export const updateAssistedThrottle = ({ throttle, speedMps, targetSpeedMps, deltaSec }) => {
  if (!Number.isFinite(targetSpeedMps) || targetSpeedMps <= 0) return throttle;
  const speedErrorMps = targetSpeedMps - speedMps;
  return clamp(throttle + clamp(speedErrorMps * 0.035, -0.38, 0.38) * deltaSec, 0, 1);
};
