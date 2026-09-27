// Development fixtures only: existing factories, deployment and launch APIs.
// No weapon tuning, collision changes, or synthetic hits.
import { useEngine } from '../src/store/engine.js';
import { CONTROLLABLE_AIR_PROFILE_IDS } from '../src/data/controllableAirProfiles.js';
import { createControllableAirEntity } from '../src/store/controllableAirEntity.js';
import { createAirTarget } from '../src/store/airTargetSystem.js';
import { getDestinationPoint } from '../src/store/geo.js';
let scenarioSequence = 0;

export function setupVisualScenario(mode = 'STRAIGHT', model = 'GERAN_2', count = 1) {
  const store = useEngine;
  const sequence = ++scenarioSequence;
  store.getState().resetScenario('SANDBOX');
  store.getState().configureSimulationProfile({ physicsLevel: 'BASIC', uiDetail: 'OPERATIONAL' });
  if (['ENGAGEMENT', 'ENGAGEMENT_NASAMS', 'ENGAGEMENT_ASTER', 'INTERCEPTOR', 'MIXED'].includes(mode)) {
    store.getState().startDeploy(mode === 'ENGAGEMENT_NASAMS' ? 'MEDIUM' : mode === 'ENGAGEMENT_ASTER' ? 'SAMP_T' : 'LONG');
    store.getState().handleMapClick(50, 30);
    store.getState().rotateRadar(90);
    store.getState().confirmRadarHeading();
    store.getState().handleMapClick(50, 30);
    store.getState().handleMapClick(50.003, 30);
  }
  if (['RADAR', 'OLS', 'FPV_CONTACT'].includes(mode) || mode === 'MIXED' || mode.startsWith('RADAR_')) {
    for (const profile of ['RADAR_P18', 'RADAR_35D6', 'RADAR_79K6']) {
      if (['OLS', 'FPV_CONTACT'].includes(mode) && profile !== 'RADAR_79K6') continue;
      if (mode.startsWith('RADAR_') && mode !== profile) continue;
      store.getState().startDeploy(profile);
      store.getState().handleMapClick(50, 30);
    }
  }
  const ballistic = ['BALLISTIC', 'APEX', 'DESCENT'].includes(mode);
  const destination = ballistic ? getDestinationPoint(50, 30, 90, 330) : { lat: 50, lng: 29 };
  const targets = Array.from({ length: count }, (_, index) => createAirTarget({
    id: `VIS-${sequence}-${index + 1}`, modelId: ballistic ? 'ISKANDER_M' : model,
    type: ballistic ? 'BALLISTIC_TARGET' : ['GERAN_2', 'GERBERA'].includes(model) ? 'UAV_TARGET' : 'CRUISE_TARGET',
    spawnPosition: ballistic ? { lat: 50, lng: 30 }
      : getDestinationPoint(50, 30, 90 + index * .4, (mode === 'INTERCEPTOR' ? 38 : ['OLS', 'FPV_CONTACT'].includes(mode) ? 1.5 : 12) + index * .2),
    destination, route: [destination], speedKmh: mode === 'FPV_CONTACT' ? 1 : ballistic ? 0 : ['GERAN_2', 'GERBERA'].includes(model) ? 220 : 800,
    altitudeM: ballistic ? 20 : ['OLS', 'FPV_CONTACT'].includes(mode) ? 350 : 2500, targetAltitudeM: ['OLS', 'FPV_CONTACT'].includes(mode) ? 350 : 2500,
    ...(ballistic ? { ballisticPhysics: { enabled: true, aimPoint: destination,
      terminalCorrection: { angleDeg: 0, count: 0, side: 'RIGHT', seed: 42 } } } : {}),
  }, store.getState().simulationTime));
  const tracks = ['ENGAGEMENT', 'ENGAGEMENT_NASAMS', 'ENGAGEMENT_ASTER', 'INTERCEPTOR', 'MIXED'].includes(mode) ? targets.map(target => ({
    id: `TRK-${target.id}`, targetId: target.id, state: 'IDENTIFIED',
    reportedPosition: { ...target.position, alt: target.altitudeM },
    reportedHeading: target.heading, reportedSpeedKmh: target.speedKmh,
    reportedAltitudeM: target.altitudeM, trackQuality: 1, lastUpdateTime: store.getState().simulationTime,
    identifiedType: target.type,
  })) : [];
  store.setState({ airTargets: targets, tracks, timeScale: 1 });
  if (tracks.length) for (const track of tracks.slice(0, mode === 'MIXED' ? 10 : 1)) {
    store.getState().queueEngagement(store.getState().batteries[0].id, track.id);
  }
  if (mode === 'FPV_CONTACT') {
    const start = getDestinationPoint(targets[0].position.lat, targets[0].position.lng, 270, 0.08);
    const entity = createControllableAirEntity({ id: 'VIS-FPV', profileId: CONTROLLABLE_AIR_PROFILE_IDS.SKYFALL_FPV,
      initialPosition: { ...start, altitudeM: 350 }, initialOrientation: { heading: 90 }, simulationTime: store.getState().simulationTime });
    store.setState({ timeScale: 0, controllableAirEntities: [{ ...entity, pitch: 0, roll: 0,
      vx: 60, vy: 0, vz: 0, speedKmh: 216, speedMps: 60, flightPhase: 'MANUAL_FLIGHT',
      manualControlEnabled: true, throttleDemand: 0.6, velocity: { vx: 60, vy: 0, vz: 0, speedKmh: 216, heading: 90 } }] });
  }
  if (mode === 'APEX' || mode === 'DESCENT') {
    // Seek with the real fixed-step engine; no invented ballistic poses.
    for (let step = 0; step < 6000; step++) {
      store.getState().tick();
      const target = store.getState().airTargets[0];
      if (!target || (mode === 'APEX' ? target.verticalSpeedMps < 25 && target.altitudeM > 20000
        : target.flightPhase === 'TERMINAL')) break;
    }
  }
  if (mode === 'INTERCEPTOR') {
    for (let step = 0; step < 200 && !store.getState().missiles.length; step++) store.getState().tick();
    store.setState({ timeScale: 0 });
  }
}
