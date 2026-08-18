export const SIMPLE_BALLISTIC_PHASE = Object.freeze({
  LAUNCH: 'LAUNCH',
  CLIMB: 'CLIMB',
  BALLISTIC_ARC: 'BALLISTIC ARC',
  TERMINAL: 'TERMINAL',
});

export const ISKANDER_PUBLIC_DISPLAY = Object.freeze({
  displayName: 'Искандер-М',
  publicRangeKm: 500,
  indicativeApogeeM: 50_000,
  source: 'https://missilethreat.csis.org/missile/ss-26-2/',
});

// Light Mode uses intentionally simplified, non-aerodynamic gameplay values.
export const ISKANDER_GAMEPLAY_PROFILE = Object.freeze({
  speedKmh: 6_000,
  apexAltitudeM: 50_000,
  launchEndProgress: 0.07,
  climbEndProgress: 0.42,
  arcEndProgress: 0.78,
  terminalAltitudeStartM: 18_000,
});

const smoothStep = value => value * value * (3 - 2 * value);
const phaseProgress = (progress, start, end) => Math.max(0, Math.min(1, (progress - start) / (end - start)));

export function getSimpleBallisticState(routeProgress) {
  const profile = ISKANDER_GAMEPLAY_PROFILE;
  const progress = Math.max(0, Math.min(1, routeProgress));

  if (progress < profile.launchEndProgress) {
    const local = smoothStep(phaseProgress(progress, 0, profile.launchEndProgress));
    return {
      phase: SIMPLE_BALLISTIC_PHASE.LAUNCH,
      altitudeM: 250 + local * 11_750,
      horizontalSpeedFactor: 0.16 + local * 0.34,
    };
  }
  if (progress < profile.climbEndProgress) {
    const local = smoothStep(phaseProgress(progress, profile.launchEndProgress, profile.climbEndProgress));
    return {
      phase: SIMPLE_BALLISTIC_PHASE.CLIMB,
      altitudeM: 12_000 + local * (profile.apexAltitudeM - 12_000),
      horizontalSpeedFactor: 0.5 + local * 0.5,
    };
  }
  if (progress < profile.arcEndProgress) {
    const local = smoothStep(phaseProgress(progress, profile.climbEndProgress, profile.arcEndProgress));
    return {
      phase: SIMPLE_BALLISTIC_PHASE.BALLISTIC_ARC,
      altitudeM: profile.apexAltitudeM - local * (profile.apexAltitudeM - profile.terminalAltitudeStartM),
      horizontalSpeedFactor: 1,
    };
  }

  const local = smoothStep(phaseProgress(progress, profile.arcEndProgress, 1));
  return {
    phase: SIMPLE_BALLISTIC_PHASE.TERMINAL,
    altitudeM: profile.terminalAltitudeStartM * (1 - local) + 120 * local,
    horizontalSpeedFactor: 1,
  };
}

