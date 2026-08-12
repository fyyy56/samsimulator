export const EVENT_TYPE = Object.freeze({
  TARGET_SPAWNED: 'TARGET_SPAWNED',
  TRACK_DETECTED: 'TRACK_DETECTED',
  TRACK_ESTABLISHED: 'TRACK_ESTABLISHED',
  INTERCEPTOR_LAUNCHED: 'INTERCEPTOR_LAUNCHED',
  INTERCEPTOR_FAILED: 'INTERCEPTOR_FAILED',
  TARGET_INTERCEPTED: 'TARGET_INTERCEPTED',
  TARGET_ESCAPED: 'TARGET_ESCAPED',
});

export function createSimulationEvent(sequence, type, simulationTime, details = {}) {
  return {
    id: `EVT-${sequence.toString().padStart(4, '0')}`,
    type,
    simulationTime,
    details,
  };
}
