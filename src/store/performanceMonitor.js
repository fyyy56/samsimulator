const now = () => globalThis.performance?.now?.() ?? Date.now();

export const SIMULATION_SUBSYSTEM = Object.freeze({
  TARGET_KINEMATICS: 'TARGET_KINEMATICS_MS',
  MISSILE_KINEMATICS: 'MISSILE_KINEMATICS_MS',
  RADAR: 'RADAR_MS',
  TRACK: 'TRACK_MS',
  AUTO: 'AUTO_MS',
  ENGAGEMENT: 'ENGAGEMENT_MS',
  INTERCEPT_SOLVER: 'INTERCEPT_SOLVER_MS',
  SCENARIO: 'SCENARIO_MS',
  EVENTS: 'EVENTS_MS',
  STORE_COMMIT: 'STORE_COMMIT_MS',
  OTHER: 'OTHER_MS',
});

const subsystemKeys = Object.values(SIMULATION_SUBSYSTEM);
const createSubsystemCounters = () => Object.fromEntries(subsystemKeys.map(key => [key, {
  totalMs: 0,
  maxMs: 0,
}]));

const counters = {
  windowStartedAt: now(),
  frames: 0,
  simulationTicks: 0,
  simulationUpdateMs: 0,
  simulationUpdateMaxMs: 0,
  renderCommits: 0,
  renderMs: 0,
  renderMaxMs: 0,
  storeWrites: 0,
  visualPublishes: 0,
  lastFrameAt: null,
  frameMs: 0,
  frameMaxMs: 0,
  subsystems: createSubsystemCounters(),
};

let latestSnapshot = Object.freeze({
  fps: 0, simulationTps: 0, frameMs: 0, simulationUpdateMs: 0,
  simulationUpdateMaxMs: 0, renderMs: 0, renderMaxMs: 0,
  reactRendersPerSec: 0, storeWritesPerSec: 0, visualPublishesPerSec: 0,
  subsystems: Object.freeze({}),
});
let enabled = false;
let activeSimulationSubsystems = null;

export const setPerformanceMonitoringEnabled = value => {
  enabled = Boolean(value);
  counters.windowStartedAt = now();
  counters.lastFrameAt = null;
  counters.frames = 0;
  counters.simulationTicks = 0;
  counters.simulationUpdateMs = 0;
  counters.simulationUpdateMaxMs = 0;
  counters.renderCommits = 0;
  counters.renderMs = 0;
  counters.renderMaxMs = 0;
  counters.storeWrites = 0;
  counters.visualPublishes = 0;
  counters.frameMs = 0;
  counters.frameMaxMs = 0;
  counters.subsystems = createSubsystemCounters();
  activeSimulationSubsystems = null;
};

export const isPerformanceMonitoringEnabled = () => enabled;

export const beginSimulationUpdateProfile = () => {
  activeSimulationSubsystems = enabled ? Object.create(null) : null;
};

export const recordSimulationSubsystem = (subsystem, durationMs) => {
  if (!enabled || !activeSimulationSubsystems || !(durationMs >= 0)) return;
  activeSimulationSubsystems[subsystem] = (activeSimulationSubsystems[subsystem] ?? 0) + durationMs;
};

export const measureSimulationSubsystem = (subsystem, operation) => {
  if (!enabled) return operation();
  const startedAt = now();
  try {
    return operation();
  } finally {
    recordSimulationSubsystem(subsystem, now() - startedAt);
  }
};

export const createSimulationStageTimer = () => {
  if (!enabled) return () => {};
  let stageStartedAt = now();
  return subsystem => {
    const timestamp = now();
    recordSimulationSubsystem(subsystem, timestamp - stageStartedAt);
    stageStartedAt = timestamp;
  };
};

export const markVisualFrame = timestamp => {
  if (!enabled) return;
  if (counters.lastFrameAt !== null) {
    const duration = Math.max(0, timestamp - counters.lastFrameAt);
    counters.frameMs += duration;
    counters.frameMaxMs = Math.max(counters.frameMaxMs, duration);
  }
  counters.lastFrameAt = timestamp;
  counters.frames += 1;
};

export const recordSimulationUpdate = durationMs => {
  if (!enabled) return;
  const subsystemDurations = activeSimulationSubsystems ?? {};
  const coveredDurationMs = subsystemKeys
    .filter(key => key !== SIMULATION_SUBSYSTEM.INTERCEPT_SOLVER && key !== SIMULATION_SUBSYSTEM.OTHER)
    .reduce((sum, key) => sum + (subsystemDurations[key] ?? 0), 0);
  subsystemDurations[SIMULATION_SUBSYSTEM.OTHER] = Math.max(
    0,
    (subsystemDurations[SIMULATION_SUBSYSTEM.OTHER] ?? 0) + durationMs - coveredDurationMs,
  );
  subsystemKeys.forEach(key => {
    const duration = subsystemDurations[key] ?? 0;
    counters.subsystems[key].totalMs += duration;
    counters.subsystems[key].maxMs = Math.max(counters.subsystems[key].maxMs, duration);
  });
  activeSimulationSubsystems = null;
  counters.simulationTicks += 1;
  counters.storeWrites += 1;
  counters.simulationUpdateMs += durationMs;
  counters.simulationUpdateMaxMs = Math.max(counters.simulationUpdateMaxMs, durationMs);
};

export const recordVisualPublish = () => {
  if (!enabled) return;
  counters.visualPublishes += 1;
  counters.storeWrites += 1;
};

export const recordReactRender = durationMs => {
  if (!enabled) return;
  counters.renderCommits += 1;
  counters.renderMs += durationMs;
  counters.renderMaxMs = Math.max(counters.renderMaxMs, durationMs);
};

export const samplePerformance = () => {
  const timestamp = now();
  const elapsedSec = Math.max(0.001, (timestamp - counters.windowStartedAt) / 1000);
  latestSnapshot = Object.freeze({
    fps: counters.frames / elapsedSec,
    simulationTps: counters.simulationTicks / elapsedSec,
    frameMs: counters.frames > 1 ? counters.frameMs / (counters.frames - 1) : 0,
    frameMaxMs: counters.frameMaxMs,
    simulationUpdateMs: counters.simulationTicks ? counters.simulationUpdateMs / counters.simulationTicks : 0,
    simulationUpdateMaxMs: counters.simulationUpdateMaxMs,
    renderMs: counters.renderCommits ? counters.renderMs / counters.renderCommits : 0,
    renderMaxMs: counters.renderMaxMs,
    reactRendersPerSec: counters.renderCommits / elapsedSec,
    storeWritesPerSec: counters.storeWrites / elapsedSec,
    visualPublishesPerSec: counters.visualPublishes / elapsedSec,
    subsystems: Object.freeze(Object.fromEntries(subsystemKeys.map(key => [key, Object.freeze({
      averageMs: counters.simulationTicks ? counters.subsystems[key].totalMs / counters.simulationTicks : 0,
      maxMs: counters.subsystems[key].maxMs,
    })]))),
  });
  counters.windowStartedAt = timestamp;
  counters.frames = 0;
  counters.simulationTicks = 0;
  counters.simulationUpdateMs = 0;
  counters.simulationUpdateMaxMs = 0;
  counters.renderCommits = 0;
  counters.renderMs = 0;
  counters.renderMaxMs = 0;
  counters.storeWrites = 0;
  counters.visualPublishes = 0;
  counters.frameMs = 0;
  counters.frameMaxMs = 0;
  counters.subsystems = createSubsystemCounters();
  return latestSnapshot;
};

export const getLatestPerformanceSnapshot = () => latestSnapshot;
