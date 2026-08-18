import assert from 'node:assert/strict';
import { getInterceptorSpec } from '../src/data/interceptors.js';
import { SIMPLE_TARGET_TYPE } from '../src/data/airTargetProfiles.js';
import { LIGHT_TARGET_MODEL } from '../src/data/lightTargetModels.js';
import { createAirTarget } from '../src/store/airTargetSystem.js';
import { BATTERY_CONTROL_MODE } from '../src/store/autoDefense.js';
import { getPhysicsSubstepCount, useEngine } from '../src/store/engine.js';
import { getBearing, getDistanceKm } from '../src/store/geo.js';

const VINNYTSIA = { lat: 49.2331, lng: 28.4682 };
const EASTERN_LAUNCH = { lat: 49.3, lng: 35.4 };

const store = useEngine;

const runScenario = (timeScale) => {
  store.getState().resetScenario('SIMPLE');
  store.getState().configureSimulationProfile({ physicsLevel: 'BASIC', uiDetail: 'OPERATIONAL' });
  store.getState().setTimeScale(timeScale);
  store.getState().setAllBatteriesControlMode(BATTERY_CONTROL_MODE.AUTO);

  const battery = store.getState().batteries.find(candidate => candidate.id === 'PATRIOT-01');
  assert.ok(battery, 'Vinnytsia must start with PATRIOT-01');
  assert.ok(
    getDistanceKm(battery.components.radar.lat, battery.components.radar.lng, VINNYTSIA.lat, VINNYTSIA.lng) < 0.1,
    'PATRIOT-01 radar must be positioned at Vinnytsia',
  );

  const ballistic = createAirTarget({
    id: `VINNYTSIA-500KM-BALLISTIC-${timeScale}X`,
    type: SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE,
    modelId: LIGHT_TARGET_MODEL.ISKANDER_M,
    speedKmh: 6_000,
    altitudeM: 250,
    targetAltitudeM: 250,
    spawnPosition: EASTERN_LAUNCH,
    destination: VINNYTSIA,
    route: [VINNYTSIA],
    routeType: 'BALLISTIC',
    turnRateDegPerSec: 0,
    sensorSignature: 0.9,
    detectability: 0.9,
    objectiveId: 'VINNYTSIA',
    objectiveName: 'Vinnytsia',
    objectivePriority: 1,
  }, store.getState().simulationTime);

  store.setState(state => ({
    activeScenario: { ...state.activeScenario, targets: [] },
    airTargets: [ballistic],
  }));

  let launchRangeKm = null;
  let firstMissileId = null;
  let previousMissileHeading = null;
  let maximumHeadingStepDeg = 0;
  let minimumDistanceToTargetKm = Number.POSITIVE_INFINITY;
  const initialCourseErrors = [];
  const maximumSteps = Math.ceil(450 * 20 / timeScale);
  for (let step = 0; step < maximumSteps; step += 1) {
    const substepCount = getPhysicsSubstepCount(timeScale);
    for (let substep = 0; substep < substepCount; substep += 1) {
      store.getState().tick(substepCount);
    }
    const state = store.getState();
    const currentTarget = state.airTargets.find(candidate => candidate.id === ballistic.id);
    const missile = firstMissileId
      ? state.missiles.find(candidate => candidate.id === firstMissileId)
      : state.missiles[0];
    if (missile && launchRangeKm === null && currentTarget) {
      firstMissileId = missile.id;
      launchRangeKm = getDistanceKm(
        battery.components.launchers[0].lat,
        battery.components.launchers[0].lng,
        currentTarget.position.lat,
        currentTarget.position.lng,
      );
    }
    if (missile && currentTarget && initialCourseErrors.length < 8) {
      const bearingToTarget = getBearing(
        missile.lat,
        missile.lng,
        currentTarget.position.lat,
        currentTarget.position.lng,
      );
      initialCourseErrors.push(Math.abs(
        ((missile.heading - bearingToTarget + 540) % 360) - 180,
      ));
    }
    if (missile && previousMissileHeading !== null) {
      maximumHeadingStepDeg = Math.max(maximumHeadingStepDeg, Math.abs(
        ((missile.heading - previousMissileHeading + 540) % 360) - 180,
      ));
    }
    if (missile) previousMissileHeading = missile.heading;
    if (Number.isFinite(missile?.distanceToTargetKm)) {
      minimumDistanceToTargetKm = Math.min(minimumDistanceToTargetKm, missile.distanceToTargetKm);
    }
    if (!currentTarget || state.events.some(event => (
      event.type === 'TARGET_INTERCEPTED' && event.details.targetId === ballistic.id
    ))) break;
  }

  const intercepted = store.getState().events.some(event => (
    event.type === 'TARGET_INTERCEPTED' && event.details.targetId === ballistic.id
  ));
  assert.ok(Number.isFinite(launchRangeKm), 'Patriot must eventually launch at the ballistic threat');
  assert.ok(launchRangeKm <= 98, `Automatic launch was too early at ${launchRangeKm.toFixed(1)} km`);
  assert.ok(initialCourseErrors.length >= 4, 'Initial PAC-3 course samples were not captured');
  assert.ok(
    Math.max(...initialCourseErrors) < 70,
    `PAC-3 initially flew away from the ballistic target (${Math.max(...initialCourseErrors).toFixed(1)}°)`,
  );
  const maximumAllowedHeadingStepDeg = getInterceptorSpec('INT-LONG-V1')
    .gameplayPhysics.terminalTurnRateDegPerSec * timeScale / 20;
  assert.ok(
    maximumHeadingStepDeg <= maximumAllowedHeadingStepDeg + 0.1,
    `PAC-3 exceeded its turn-rate limit at ${timeScale}x`,
  );
  const outcome = store.getState().events.findLast(event => (
    event.details?.targetId === ballistic.id || event.details?.missileId === firstMissileId
  ));
  const failure = store.getState().events.findLast(event => (
    event.type === 'INTERCEPTOR_FAILED' && event.details?.missileId === firstMissileId
  ));
  return {
    timeScale,
    launchRangeKm,
    maximumInitialCourseErrorDeg: Math.max(...initialCourseErrors),
    maximumHeadingStepDeg,
    minimumDistanceToTargetKm,
    intercepted,
    outcome: outcome?.type ?? null,
    outcomeReason: outcome?.details?.reason ?? null,
    failureReason: failure?.details?.reason ?? null,
  };
};

assert.ok(
  getInterceptorSpec('INT-LONG-V1').gameplayPhysics.postPassContinueSec > 0,
  'PAC-3 must retain its configured post-pass tracking window',
);
console.log(JSON.stringify({
  routeDistanceKm: getDistanceKm(EASTERN_LAUNCH.lat, EASTERN_LAUNCH.lng, VINNYTSIA.lat, VINNYTSIA.lng),
  runs: [runScenario(1), runScenario(10), runScenario(20)],
}, null, 2));
