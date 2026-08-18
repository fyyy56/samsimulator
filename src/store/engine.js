import { create } from 'zustand';
import { getInterceptorSpec } from '../data/interceptors.js';
import { getGunSystemSpec, WEAPON_SYSTEM_TYPE } from '../data/gunSystems.js';
import { advanceAirTarget, createAirTarget } from './airTargetSystem.js';
import {
  ENGAGEMENT_STATUS,
  getBatteryEngagementStatus,
  getOperationalLaunchers,
} from './engagement.js';
import { getBearing, getDestinationPoint, getDistanceKm, getSlantDistanceKm } from './geo.js';
import {
  createManualTargetDefinitions,
  createMassRaidScenario,
  createSandboxScenario,
  TEST_RAID_SCENARIO,
} from './scenarios.js';
import { createSimulationEvent, EVENT_TYPE } from './simulationEvents.js';
import {
  applySensorEvidenceObservation,
  formatTrackId,
  TRACK_STATE,
  updateLostTrack,
} from './trackSystem.js';
import {
  advanceInterceptorFlight,
  applyAltitudeEnergyExchange,
  INTERCEPTOR_KINEMATIC_PHASE,
  INTERCEPTOR_PHASE,
} from './interceptorPhysics.js';
import { INTERCEPTOR_PHYSICS_PROFILES, SIMPLE_FLIGHT_PHASE } from './interceptorAltitudePhysics.js';
import {
  advanceInterceptorGuidance,
  createInterceptorGuidance,
  INTERCEPTOR_FAILURE_REASON,
  INTERCEPTOR_GUIDANCE_STATE,
} from './interceptorGuidance.js';
import {
  advanceRadarScan,
  createRadarScanState,
  isTargetInRadarCoverage,
  RADAR_SCAN_TYPE,
  selectNetworkRadarScanOpportunity,
} from './radarSystem.js';
import {
  AUTO_DEFENSE_STATUS,
  BATTERY_CONTROL_MODE,
  buildEngagementRegistry,
  DEFENSE_DOCTRINE,
  DOCTRINE_CONFIG,
  getInterceptorEngagementPolicy,
  isBallisticTarget,
  isPatriotBattery,
  rankThreatsForBattery,
} from './autoDefense.js';
import {
  evaluateInterceptFeasibility,
  INTERCEPT_FEASIBILITY,
} from './interceptFeasibility.js';
import {
  AUTO_ENGAGEMENT_DECISION,
  buildTargetDefenseAssessments,
  planAutomaticEngagement,
} from './autoEngagementPlanner.js';
import { didSweptPathsEnterRadius } from './continuousCollision.js';
import {
  evaluateGunEngagement,
  getGunProjectileFlightTimeSec,
  GUN_ENGAGEMENT_PHASE,
  quantizeGepardHeading,
  resolveGunBurst,
  solveGunAim,
} from './gunAirDefense.js';
import {
  ageSensorEvidenceContacts,
  applySensorScanBatch,
  isRadarSensorOperational,
  isTrackSensorStale,
} from './sensorDetection.js';

export { getBearing, getDistanceKm } from './geo.js';

export function generateRadarPolygon(lat, lng, radiusKm, sector = 360, heading = 0) {
  const points = 64;
  const coords = [];
  const R = 6371;
  const startAngle = heading - sector / 2;
  coords.push([lng, lat]);
  const steps = sector === 360 ? points : Math.max(10, Math.floor(points * (sector/360)));
  for (let i = 0; i <= steps; i++) {
    const brng = (startAngle + (sector * i / steps)) * Math.PI / 180;
    const d = radiusKm / R;
    const lat1 = lat * Math.PI / 180;
    const lon1 = lng * Math.PI / 180;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    coords.push([lon2 * 180 / Math.PI, lat2 * 180 / Math.PI]);
  }
  coords.push([lng, lat]);
  return coords;
}

export function generateRadarBeam(lat, lng, radiusKm, currentAngle) {
  const R = 6371;
  const brng = currentAngle * Math.PI / 180;
  const d = radiusKm / R;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lng * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [[lng, lat], [lon2 * 180 / Math.PI, lat2 * 180 / Math.PI]];
}

export const SYSTEM_CATALOG = {
  SHORT:  { type: 'IRIS-T SLM', radarRangeKm: 40,  missilesLeft: 4,  interceptorSpecId: 'INT-SHORT-V1',  scanRateSec: 2.25, radarBeamWidthDeg: 7, radarSector: 360, scanType: RADAR_SCAN_TYPE.MECHANICAL_ROTATION },
  MEDIUM: { type: 'NASAMS',     radarRangeKm: 80,  missilesLeft: 6,  interceptorSpecId: 'INT-MEDIUM-V1', scanRateSec: 2.0, radarBeamWidthDeg: 6, radarSector: 360, scanType: RADAR_SCAN_TYPE.MECHANICAL_ROTATION },
  LONG:   { type: 'PATRIOT',    radarRangeKm: 150, missilesLeft: 16, interceptorSpecId: 'INT-LONG-V1',   scanRateSec: 0.1, radarBeamWidthDeg: 5, radarSector: 120, scanType: RADAR_SCAN_TYPE.ELECTRONIC_SECTOR },
  GUN:    { type: 'Gepard 1A2', weaponType: WEAPON_SYSTEM_TYPE.GUN_AA, gunSpecId: 'GEPARD_1A2', radarRangeKm: 12, engagementRangeKm: 5, missilesLeft: 640, interceptorSpecId: null, scanRateSec: 1, radarBeamWidthDeg: 12, radarSector: 360, scanType: RADAR_SCAN_TYPE.MECHANICAL_ROTATION, deploymentStyle: 'SINGLE_UNIT' },
};

export const LAUNCHER_VISUAL_STATE = Object.freeze({
  READY: 'READY',
  ROTATING: 'ROTATING',
  LAUNCHING: 'LAUNCHING',
  COOLDOWN: 'COOLDOWN',
  EMPTY: 'EMPTY',
  RELOADING: 'RELOADING',
  TRACKING: 'TRACKING',
  FIRING: 'FIRING',
});

const DEFAULT_LAUNCH_ROTATION_TIME_SEC = 0.9;
const DEFAULT_LAUNCH_IGNITION_TIME_SEC = 0.55;
const DIRECT_IMPACT_VISUAL_DURATION_SEC = 0.12;
export const BATTERY_RELOAD_TIME_SEC = 30;
const AUTO_DECISION_INTERVAL_SEC = 0.5;
export const PHYSICS_UPDATE_HZ = 20;
export const VISUAL_UPDATE_HZ = 30;
export const getAdaptiveVisualUpdateHz = activeObjectCount => (
  activeObjectCount >= 80 ? 15 : activeObjectCount >= 35 ? 20 : activeObjectCount >= 20 ? 24 : 30
);
export const getPhysicsSubstepCount = timeScale => (
  timeScale >= 20 ? 3 : 1
);
const getHeadingChangeDeg = (fromHeading, toHeading) => Math.abs(
  ((toHeading - fromHeading + 540) % 360) - 180,
);

const createVinnytsiaPatriotBattery = (controlMode) => {
  const template = SYSTEM_CATALOG.LONG;
  const radar = { lat: 49.2331, lng: 28.4682 };
  const radarHeading = 87;
  const createLauncher = (id, lat, lng) => ({
    id,
    lat,
    lng,
    altitudeM: 0,
    position: { lat, lng, lon: lng },
    velocity: { speedKmh: 0, heading: radarHeading },
    operational: true,
    ready: true,
    heading: radarHeading,
    launchState: LAUNCHER_VISUAL_STATE.READY,
    cooldownRemainingSec: 0,
  });
  return {
    id: 'PATRIOT-01',
    category: 'LONG',
    type: template.type,
    status: 'ACTIVE',
    missilesLeft: template.missilesLeft,
    ammoCapacity: template.missilesLeft,
    weaponType: WEAPON_SYSTEM_TYPE.MISSILE,
    gunSpecId: null,
    engagementRangeKm: null,
    reloadRemainingSec: null,
    radarRangeKm: template.radarRangeKm,
    controlMode,
    doctrine: DEFENSE_DOCTRINE.BALANCED,
    autoStatus: controlMode === BATTERY_CONTROL_MODE.MANUAL
      ? AUTO_DEFENSE_STATUS.MANUAL
      : AUTO_DEFENSE_STATUS.TRACKING,
    recommendedTrackId: null,
    assignedTrackId: null,
    autoDecision: null,
    interceptorSpecId: template.interceptorSpecId,
    scanRateSec: template.scanRateSec,
    radarBeamWidthDeg: template.radarBeamWidthDeg,
    radarScanType: template.scanType,
    radarSector: template.radarSector,
    radarHeading,
    components: {
      fdc: null,
      radar: {
        ...radar,
        id: 'PATRIOT-01-RADAR',
        altitudeM: 0,
        position: { ...radar, lon: radar.lng },
        velocity: { speedKmh: 0, heading: radarHeading },
        heading: radarHeading,
        operational: true,
        scanState: createRadarScanState({
          sector: template.radarSector,
          heading: radarHeading,
          scanPeriodSec: template.scanRateSec,
          beamWidthDeg: template.radarBeamWidthDeg,
          scanType: template.scanType,
        }),
      },
      launchers: [
        createLauncher('PATRIOT-01-LNCH-1', 49.2195, 28.446),
        createLauncher('PATRIOT-01-LNCH-2', 49.2462, 28.4905),
      ],
    },
  };
};

export const INTERCEPTOR_LIFECYCLE_STATE = Object.freeze({
  FLYING: 'FLYING',
  TERMINAL: 'TERMINAL',
  IMPACT: 'IMPACT',
  MISSED: 'MISSED',
  SELF_DESTRUCT: 'SELF_DESTRUCT',
  DESTROYED: 'DESTROYED',
});

const createVisualSnapshot = state => ({
  simulationTime: state.simulationTime,
  batteries: state.batteries,
  airTargets: state.airTargets,
  tracks: state.tracks,
  sensorContacts: state.sensorContacts,
  missiles: state.missiles,
  pendingLaunches: state.pendingLaunches,
  gunTracers: state.gunTracers,
  events: state.events,
  activeScenario: state.activeScenario,
});

const hasVisualSnapshotChanges = state => {
  const snapshot = state.visualSnapshot;
  return !snapshot
    || snapshot.simulationTime !== state.simulationTime
    || snapshot.batteries !== state.batteries
    || snapshot.airTargets !== state.airTargets
    || snapshot.tracks !== state.tracks
    || snapshot.sensorContacts !== state.sensorContacts
    || snapshot.missiles !== state.missiles
    || snapshot.pendingLaunches !== state.pendingLaunches
    || snapshot.gunTracers !== state.gunTracers
    || snapshot.events !== state.events
    || snapshot.activeScenario !== state.activeScenario;
};

const getQueuedCountForBattery = (launchQueue, batteryId) => (
  launchQueue.filter(item => item.sourceBatteryId === batteryId).length
);

const selectLauncherForQueue = (battery, track, launchQueue, pendingLaunches) => {
  const operationalLaunchers = getOperationalLaunchers(battery);
  return operationalLaunchers
    .map(launcher => {
      const queuedLoad = launchQueue.filter(item => (
        item.sourceBatteryId === battery.id && item.launcherId === launcher.id
      )).length;
      const pendingLoad = pendingLaunches.filter(item => item.launcherId === launcher.id).length;
      return {
        launcher,
        load: queuedLoad + pendingLoad,
        distanceKm: getDistanceKm(
          launcher.lat,
          launcher.lng,
          track.reportedPosition.lat,
          track.reportedPosition.lng,
        ),
      };
    })
    .sort((first, second) => (
      first.load - second.load
      || first.distanceKm - second.distanceKm
      || first.launcher.id.localeCompare(second.launcher.id)
    ))[0]?.launcher ?? null;
};

const createLaunchQueueItem = ({
  state,
  battery,
  track,
  target,
  requestedBy,
  simulationTime,
}) => {
  const launcher = selectLauncherForQueue(battery, track, state.launchQueue, state.pendingLaunches);
  if (!launcher) return null;
  const interceptorSpec = getInterceptorSpec(battery.interceptorSpecId);
  const interceptSolution = evaluateInterceptFeasibility({
    launcher,
    target,
    track,
    interceptorSpec,
  });
  if (interceptSolution.status === INTERCEPT_FEASIBILITY.NO_SOLUTION) return null;
  const missileId = `MSL-${state.nextMissileSequence.toString().padStart(3, '0')}`;
  return {
    id: `QUEUE-${missileId}`,
    missileId,
    targetId: target.id,
    trackId: track.id,
    sourceBatteryId: battery.id,
    launcherId: launcher.id,
    interceptorSpecId: battery.interceptorSpecId,
    interceptSolution,
    requestedBy,
    queuedAt: simulationTime,
  };
};

const createLaunchedInterceptor = (pendingLaunch, track, simulationTime) => {
  const interceptorSpec = getInterceptorSpec(pendingLaunch.interceptorSpecId);
  const launchSpeedKmh = interceptorSpec.gameplayPhysics.launchSpeedKmh;
  return {
    id: pendingLaunch.missileId,
    targetId: pendingLaunch.targetId,
    trackId: pendingLaunch.trackId,
    sourceBatteryId: pendingLaunch.sourceBatteryId,
    launcherId: pendingLaunch.launcherId,
    interceptorSpecId: pendingLaunch.interceptorSpecId,
    lat: pendingLaunch.lat,
    lng: pendingLaunch.lng,
    position: { lat: pendingLaunch.lat, lng: pendingLaunch.lng, lon: pendingLaunch.lng },
    altitudeM: pendingLaunch.altitudeM,
    verticalSpeedMps: 0,
    heading: pendingLaunch.heading,
    speedKmh: launchSpeedKmh,
    phase: INTERCEPTOR_PHASE.POWERED,
    kinematicPhase: INTERCEPTOR_KINEMATIC_PHASE.BOOST,
    motorPhase: 'BOOST',
    motorTimeLeftSec: interceptorSpec.gameplayPhysics.motorBurnTimeSec,
    energyState: 'ENERGY_CRITICAL',
    criticalEnergyTimeSec: 0,
    guidanceState: INTERCEPTOR_GUIDANCE_STATE.BOOST,
    flightPhase: SIMPLE_FLIGHT_PHASE.LAUNCH,
    guidance: createInterceptorGuidance(
      track,
      simulationTime,
      pendingLaunch.interceptSolution,
      { lat: pendingLaunch.lat, lng: pendingLaunch.lng },
      pendingLaunch.missileId,
    ),
    launchTime: simulationTime,
    flightTime: 0,
    distanceTraveledKm: 0,
    closestApproachKm: Number.POSITIVE_INFINITY,
    timeSinceClosestApproachSec: 0,
    lifecycleState: INTERCEPTOR_LIFECYCLE_STATE.FLYING,
    desiredHeading: pendingLaunch.heading,
    turnRateDegPerSec: 0,
    distanceToTargetKm: Number.POSITIVE_INFINITY,
    fuseRadiusM: interceptorSpec.gameplayPhysics.proximityFuseRadiusM,
    trajectory: [{ lat: pendingLaunch.lat, lng: pendingLaunch.lng, altitudeM: pendingLaunch.altitudeM }],
    velocity: { speedKmh: launchSpeedKmh, heading: pendingLaunch.heading },
    collisionGroup: 'FRIENDLY_INTERCEPTOR',
    collidesWith: ['HOSTILE_AIR_TARGET'],
  };
};

export const useEngine = create((set, get) => ({
  simulationTime: TEST_RAID_SCENARIO.startTimeSeconds,
  simulationProfile: { physicsLevel: 'BASIC', uiDetail: 'OPERATIONAL' },
  timeScale: 1,              
  hoveredTrackId: null,   
  selectedTrackId: null,  
  selectedMissileId: null,
  selectedBatteryId: null,
  nextBatterySequence: 1,
  nextTrackSequence: 1,
  nextMissileSequence: 1,
  nextEventSequence: 1,
  nextManualTargetSequence: 1,
  nextAutoDecisionTime: TEST_RAID_SCENARIO.startTimeSeconds,
  globalControlMode: BATTERY_CONTROL_MODE.MANUAL,
  autoEngagementAttempts: {},
  
  batteries: [],
  airTargets: [],
  tracks: [],
  sensorContacts: [],
  missiles: [],
  launchQueue: [],
  pendingLaunches: [],
  gunEngagements: [],
  gunTracers: [],
  activeScenario: TEST_RAID_SCENARIO,
  spawnedTargetIds: [],
  announcedGroupIds: [],
  events: [],
  visualSnapshot: {
    simulationTime: TEST_RAID_SCENARIO.startTimeSeconds,
    batteries: [],
    airTargets: [],
    tracks: [],
    sensorContacts: [],
    missiles: [],
    pendingLaunches: [],
    gunTracers: [],
    events: [],
    activeScenario: TEST_RAID_SCENARIO,
  },

  publishVisualSnapshot: () => set(state => (
    hasVisualSnapshotChanges(state)
      ? { visualSnapshot: createVisualSnapshot(state) }
      : {}
  )),

  deployPhase: null, draftBattery: null, buildMenuOpen: false, selectedCategory: null,
  
  toggleBuildMenu: () => set(state => ({ buildMenuOpen: !state.buildMenuOpen, selectedCategory: null })),
  setCategory: (cat) => set(state => ({ selectedCategory: state.selectedCategory === cat ? null : cat })),
  closeBuildMenu: () => set({ buildMenuOpen: false, selectedCategory: null }),

  startDeploy: (categoryKey) => {
    const template = SYSTEM_CATALOG[categoryKey];
    const state = get();
    const includeCommandPost = state.simulationProfile.physicsLevel === 'ADVANCED';
    set({
      buildMenuOpen: false,
      selectedCategory: null,
      deployPhase: template.deploymentStyle === 'SINGLE_UNIT'
        ? 'UNIT'
        : (includeCommandPost ? 'FDC' : 'RADAR'),
      nextBatterySequence: state.nextBatterySequence + 1,
      draftBattery: {
        id: `${template.type.split(' ')[0]}-${state.nextBatterySequence.toString().padStart(2, '0')}`,
        category: categoryKey,
        type: template.type, status: 'DEPLOYING',
        missilesLeft: template.missilesLeft, ammoCapacity: template.missilesLeft,
        weaponType: template.weaponType ?? WEAPON_SYSTEM_TYPE.MISSILE,
        gunSpecId: template.gunSpecId ?? null,
        engagementRangeKm: template.engagementRangeKm ?? null,
        gunNextBurstTime: 0,
        reloadRemainingSec: null, radarRangeKm: template.radarRangeKm,
        controlMode: state.globalControlMode,
        doctrine: DEFENSE_DOCTRINE.BALANCED,
        autoStatus: state.globalControlMode === BATTERY_CONTROL_MODE.HOLD
          ? AUTO_DEFENSE_STATUS.HOLDING
          : state.globalControlMode === BATTERY_CONTROL_MODE.MANUAL
            ? AUTO_DEFENSE_STATUS.MANUAL
            : AUTO_DEFENSE_STATUS.TRACKING,
        recommendedTrackId: null,
        assignedTrackId: null,
        autoDecision: null,
        interceptorSpecId: template.interceptorSpecId, scanRateSec: template.scanRateSec,
        radarBeamWidthDeg: template.radarBeamWidthDeg,
        radarScanType: template.scanType,
        radarSector: template.radarSector, radarHeading: 0, 
        components: { fdc: null, radar: null, launchers: [] }
      }
    });
  },

  handleMapClick: (lat, lng) => {
    const state = get();
    if (!state.deployPhase || state.deployPhase === 'RADAR_HEADING') {
      if (!state.deployPhase) state.clearSelection();
      return;
    }
    const draft = { ...state.draftBattery };
    let nextPhase = state.deployPhase;
    if (state.deployPhase === 'UNIT') {
      const unit = {
        id: `${draft.id}-UNIT-1`,
        lat,
        lng,
        altitudeM: 0,
        position: { lat, lng, lon: lng },
        velocity: { speedKmh: 0, heading: 0 },
        operational: true,
        ready: true,
        heading: 0,
        launchState: LAUNCHER_VISUAL_STATE.READY,
        cooldownRemainingSec: 0,
      };
      draft.components.radar = {
        ...unit,
        id: `${draft.id}-RADAR`,
        scanState: createRadarScanState({
          sector: draft.radarSector,
          heading: 0,
          scanPeriodSec: draft.scanRateSec,
          beamWidthDeg: draft.radarBeamWidthDeg,
          scanType: draft.radarScanType,
        }),
      };
      draft.components.launchers = [unit];
      draft.status = 'ACTIVE';
      set({ batteries: [...state.batteries, draft], deployPhase: null, draftBattery: null });
      return;
    }
    if (state.deployPhase === 'FDC') {
      draft.components.fdc = {
        lat, lng, altitudeM: 0, position: { lat, lng, lon: lng },
        velocity: { speedKmh: 0, heading: 0 },
      };
      nextPhase = 'RADAR';
    } else if (state.deployPhase === 'RADAR') {
      draft.components.radar = {
        lat,
        lng,
        altitudeM: 0,
        position: { lat, lng, lon: lng },
        velocity: { speedKmh: 0, heading: 0 },
        heading: draft.radarHeading,
        scanState: createRadarScanState({
          sector: draft.radarSector,
          heading: draft.radarHeading,
          scanPeriodSec: draft.scanRateSec,
          beamWidthDeg: draft.radarBeamWidthDeg,
          scanType: draft.radarScanType,
        }),
      };
      nextPhase = draft.radarSector < 360 ? 'RADAR_HEADING' : 'LAUNCHER';
    } else if (state.deployPhase === 'LAUNCHER') {
      draft.components.launchers.push({
        id: `${draft.id}-LNCH-${draft.components.launchers.length + 1}`,
        lat,
        lng,
        altitudeM: 0,
        position: { lat, lng, lon: lng },
        velocity: { speedKmh: 0, heading: 0 },
        operational: true,
        ready: true,
        heading: 0,
        launchState: LAUNCHER_VISUAL_STATE.READY,
        cooldownRemainingSec: 0,
      });
      if (draft.components.launchers.length >= 2) {
        draft.status = 'ACTIVE';
        set({ batteries: [...state.batteries, draft], deployPhase: null, draftBattery: null });
        return;
      }
    }
    set({ draftBattery: draft, deployPhase: nextPhase });
  },

  rotateRadar: (deg) => set(state => ({ draftBattery: { ...state.draftBattery, radarHeading: (state.draftBattery.radarHeading + deg + 360) % 360 } })),
  confirmRadarHeading: () => set({ deployPhase: 'LAUNCHER' }),

  rotateInstalledComponent: (batteryId, componentType, componentId, degrees) => set(state => ({
    batteries: state.batteries.map(battery => {
      if (battery.id !== batteryId) return battery;
      if (componentType === 'RADAR') {
        const heading = (battery.radarHeading + degrees + 360) % 360;
        return {
          ...battery,
          radarHeading: heading,
          components: {
            ...battery.components,
            radar: {
              ...battery.components.radar,
              heading,
              velocity: { ...battery.components.radar.velocity, heading },
            },
          },
        };
      }
      return {
        ...battery,
        components: {
          ...battery.components,
          launchers: battery.components.launchers.map(launcher => (
            launcher.id === componentId
              ? {
                ...launcher,
                heading: (launcher.heading + degrees + 360) % 360,
                velocity: {
                  ...launcher.velocity,
                  heading: (launcher.heading + degrees + 360) % 360,
                },
              }
              : launcher
          )),
        },
      };
    }),
  })),

  setHoveredTrack: (id) => set({ hoveredTrackId: id }),
  setSelectedTrack: (id) => set(state => {
    const selectedTrackId = state.selectedTrackId === id ? null : id;
    const selectedTrack = state.tracks.find(track => track.id === selectedTrackId);
    return {
      selectedTrackId,
      selectedMissileId: null,
      selectedBatteryId: null,
      batteries: selectedTrack ? state.batteries.map(battery => {
        if (battery.weaponType !== WEAPON_SYSTEM_TYPE.GUN_AA) return battery;
        const unit = battery.components.launchers[0];
        const heading = quantizeGepardHeading(getBearing(
          unit.lat,
          unit.lng,
          selectedTrack.reportedPosition.lat,
          selectedTrack.reportedPosition.lng,
        ));
        return {
          ...battery,
          components: {
            ...battery.components,
            launchers: battery.components.launchers.map(launcher => ({
              ...launcher,
              heading,
              velocity: { ...launcher.velocity, heading },
            })),
          },
        };
      }) : state.batteries,
    };
  }),
  setSelectedMissile: (id) => set(state => {
    const missile = state.missiles.find(candidate => candidate.id === id);
    return {
      selectedMissileId: state.selectedMissileId === id ? null : id,
      selectedTrackId: missile?.trackId ?? state.selectedTrackId,
      selectedBatteryId: null,
    };
  }),
  setSelectedBattery: (id) => set({ selectedBatteryId: id }),
  clearSelection: () => set({ selectedTrackId: null, selectedMissileId: null, selectedBatteryId: null }),
  setTimeScale: (scale) => set({ timeScale: scale }),
  configureSimulationProfile: (profile) => set({ simulationProfile: { ...profile } }),
  resetScenario: (scenarioMode = 'SIMPLE', scenarioOverride = null) => {
    const scenarioSeed = Date.now() >>> 0;
    const scenario = scenarioOverride ?? (scenarioMode === 'SANDBOX'
      ? createSandboxScenario(scenarioSeed)
      : createMassRaidScenario(scenarioSeed));
    const initialControlMode = BATTERY_CONTROL_MODE.MANUAL;
    const initialBatteries = scenarioMode === 'SIMPLE'
      ? [createVinnytsiaPatriotBattery(initialControlMode)]
      : [];
    const resetState = {
    simulationTime: scenario.startTimeSeconds,
    timeScale: 1,
    selectedTrackId: null,
    selectedMissileId: null,
    selectedBatteryId: null,
    nextBatterySequence: initialBatteries.length + 1,
    nextTrackSequence: 1,
    nextMissileSequence: 1,
    nextEventSequence: 1,
    nextManualTargetSequence: 1,
    nextAutoDecisionTime: scenario.startTimeSeconds,
    globalControlMode: initialControlMode,
    autoEngagementAttempts: {},
    batteries: initialBatteries,
    airTargets: [],
    tracks: [],
    sensorContacts: [],
    missiles: [],
    launchQueue: [],
    pendingLaunches: [],
    gunEngagements: [],
    gunTracers: [],
    activeScenario: scenario,
    spawnedTargetIds: [],
    announcedGroupIds: [],
    events: [],
    deployPhase: null,
    draftBattery: null,
    buildMenuOpen: false,
    selectedCategory: null,
    };
    set({
      ...resetState,
      visualSnapshot: createVisualSnapshot(resetState),
    });
  },

  spawnSandboxTargets: (configuration) => {
    const state = get();
    const definitions = createManualTargetDefinitions({
      ...configuration,
      seed: (Date.now() + state.nextManualTargetSequence * 7919) >>> 0,
      idStart: state.nextManualTargetSequence,
    });
    const spawnedTargets = definitions.map(definition => createAirTarget(
      definition,
      state.simulationTime,
    ));
    let nextEventSequence = state.nextEventSequence;
    const events = [...state.events];
    events.push(createSimulationEvent(
      nextEventSequence++,
      EVENT_TYPE.THREAT_ALERT,
      state.simulationTime,
      {
        groupId: definitions[0].groupId,
        groupSize: definitions.length,
        targetType: definitions[0].type,
        modelId: definitions[0].modelId,
        objectiveName: definitions[0].objectiveName,
        launchPattern: definitions[0].launchPattern,
        source: 'SANDBOX',
      },
    ));
    definitions.forEach(definition => {
      events.push(createSimulationEvent(
        nextEventSequence++,
        EVENT_TYPE.TARGET_SPAWNED,
        state.simulationTime,
        { targetId: definition.id, groupId: definition.groupId },
      ));
    });
    set({
      airTargets: [...state.airTargets, ...spawnedTargets],
      nextManualTargetSequence: state.nextManualTargetSequence + definitions.length,
      nextEventSequence,
      events: events.slice(-160),
    });
    return definitions.length;
  },

  setBatteryControlMode: (batteryId, controlMode) => set(state => {
    const cancelledQueue = state.launchQueue.filter(item => (
      item.sourceBatteryId === batteryId && item.requestedBy === BATTERY_CONTROL_MODE.AUTO
    ));
    let nextEventSequence = state.nextEventSequence;
    const events = [...state.events];
    cancelledQueue.forEach(item => {
      events.push(createSimulationEvent(
        nextEventSequence++,
        EVENT_TYPE.ENGAGEMENT_CANCELLED,
        state.simulationTime,
        { batteryId, trackId: item.trackId, reason: 'CONTROL_MODE_CHANGED' },
      ));
    });
    const autoStatus = {
      [BATTERY_CONTROL_MODE.HOLD]: AUTO_DEFENSE_STATUS.HOLDING,
      [BATTERY_CONTROL_MODE.MANUAL]: AUTO_DEFENSE_STATUS.MANUAL,
      [BATTERY_CONTROL_MODE.ASSIST]: AUTO_DEFENSE_STATUS.TRACKING,
      [BATTERY_CONTROL_MODE.AUTO]: AUTO_DEFENSE_STATUS.TRACKING,
    }[controlMode];
    return {
      batteries: state.batteries.map(battery => battery.id === batteryId
        ? { ...battery, controlMode, autoStatus, recommendedTrackId: null, assignedTrackId: null, autoDecision: null }
        : battery),
      launchQueue: state.launchQueue.filter(item => !cancelledQueue.includes(item)),
      nextEventSequence,
      events: events.slice(-120),
    };
  }),

  setAllBatteriesControlMode: (controlMode) => set(state => {
    const cancelledQueue = state.launchQueue.filter(item => (
      item.requestedBy === BATTERY_CONTROL_MODE.AUTO
    ));
    let nextEventSequence = state.nextEventSequence;
    const events = [...state.events];
    cancelledQueue.forEach(item => {
      events.push(createSimulationEvent(
        nextEventSequence++,
        EVENT_TYPE.ENGAGEMENT_CANCELLED,
        state.simulationTime,
        { batteryId: item.sourceBatteryId, trackId: item.trackId, reason: 'GLOBAL_CONTROL_MODE_CHANGED' },
      ));
    });
    const autoStatus = {
      [BATTERY_CONTROL_MODE.HOLD]: AUTO_DEFENSE_STATUS.HOLDING,
      [BATTERY_CONTROL_MODE.MANUAL]: AUTO_DEFENSE_STATUS.MANUAL,
      [BATTERY_CONTROL_MODE.ASSIST]: AUTO_DEFENSE_STATUS.TRACKING,
      [BATTERY_CONTROL_MODE.AUTO]: AUTO_DEFENSE_STATUS.TRACKING,
    }[controlMode];
    return {
      globalControlMode: controlMode,
      batteries: state.batteries.map(battery => ({
        ...battery,
        controlMode,
        autoStatus,
        recommendedTrackId: null,
        assignedTrackId: null,
        autoDecision: null,
      })),
      launchQueue: state.launchQueue.filter(item => !cancelledQueue.includes(item)),
      nextEventSequence,
      events: events.slice(-120),
    };
  }),

  queueEngagement: (batteryId, trackId, requestedBy = BATTERY_CONTROL_MODE.MANUAL) => {
    const state = get();
    const track = state.tracks.find(candidate => candidate.id === trackId);
    const target = state.airTargets.find(candidate => candidate.id === track?.targetId);
    const selectedBattery = state.batteries.find(candidate => candidate.id === batteryId);
    if (!track || !target || !selectedBattery) return;
    if (selectedBattery.controlMode === BATTERY_CONTROL_MODE.HOLD) return;
    if (selectedBattery.weaponType === WEAPON_SYSTEM_TYPE.GUN_AA) {
      if (state.gunEngagements.some(engagement => engagement.batteryId === batteryId)) return;
      const solution = evaluateGunEngagement({
        battery: selectedBattery,
        track,
        target,
        simulationTime: state.simulationTime,
      });
      if (!solution.ready) return;
      const engagementId = `GUN-${state.nextMissileSequence.toString().padStart(3, '0')}`;
      const engagement = {
        id: engagementId,
        trackId,
        targetId: target.id,
        batteryId,
        sourceBatteryId: batteryId,
        requestedBy,
        phase: GUN_ENGAGEMENT_PHASE.TRACKING,
        phaseStartedAt: state.simulationTime,
      };
      set({
        gunEngagements: [...state.gunEngagements, engagement],
        batteries: state.batteries.map(battery => battery.id === batteryId
          ? { ...battery, assignedTrackId: trackId, autoStatus: AUTO_DEFENSE_STATUS.ENGAGING }
          : battery),
        nextMissileSequence: state.nextMissileSequence + 1,
        nextEventSequence: state.nextEventSequence + 1,
        events: [...state.events, createSimulationEvent(
          state.nextEventSequence,
          EVENT_TYPE.INTERCEPTOR_QUEUED,
          state.simulationTime,
          { missileId: engagementId, batteryId, trackId, requestedBy, weaponType: 'GUN_AA' },
        )].slice(-120),
      });
      return engagementId;
    }
    if (
      requestedBy === BATTERY_CONTROL_MODE.MANUAL
      && getBatteryEngagementStatus(selectedBattery, track, target) !== ENGAGEMENT_STATUS.READY
    ) return;
    if (getOperationalLaunchers(selectedBattery).length === 0) return;
    if (selectedBattery.missilesLeft - getQueuedCountForBattery(state.launchQueue, batteryId) <= 0) return;
    const registry = buildEngagementRegistry(state);
    const engagementPolicy = getInterceptorEngagementPolicy(selectedBattery);
    if ((registry.get(trackId)?.missileTotal ?? 0) >= engagementPolicy.maximumActiveInterceptors) {
      return;
    }
    const rankedThreat = rankThreatsForBattery({
      battery: selectedBattery,
      tracks: [track],
      targets: [target],
      registry,
    })[0];
    if (!rankedThreat) return;
    const queueItem = createLaunchQueueItem({
      state,
      battery: selectedBattery,
      track,
      target,
      requestedBy,
      simulationTime: state.simulationTime,
    });
    if (!queueItem) return;
    const queuedEvent = createSimulationEvent(
      state.nextEventSequence,
      EVENT_TYPE.INTERCEPTOR_QUEUED,
      state.simulationTime,
      { missileId: queueItem.missileId, batteryId, trackId, requestedBy },
    );
    set({
      launchQueue: [...state.launchQueue, queueItem],
      batteries: state.batteries.map(battery => battery.id === selectedBattery.id
        ? { ...battery, assignedTrackId: trackId, autoStatus: AUTO_DEFENSE_STATUS.ENGAGING }
        : battery),
      nextMissileSequence: state.nextMissileSequence + 1,
      nextEventSequence: state.nextEventSequence + 1,
      events: [...state.events, queuedEvent].slice(-120),
    });
    return queueItem.missileId;
  },

  fireMissile: () => {
    const state = get();
    return state.queueEngagement(
      state.selectedBatteryId,
      state.selectedTrackId,
      BATTERY_CONTROL_MODE.MANUAL,
    );
  },

  confirmAssistEngagement: (batteryId) => {
    const state = get();
    const battery = state.batteries.find(candidate => candidate.id === batteryId);
    if (!battery || battery.controlMode !== BATTERY_CONTROL_MODE.ASSIST) return;
    return state.queueEngagement(
      batteryId,
      battery.recommendedTrackId,
      BATTERY_CONTROL_MODE.ASSIST,
    );
  },

  tick: (substepDivisor = 1) => set((state) => {
    if (state.timeScale === 0) return {};
    const deltaTimeSec = (1 / PHYSICS_UPDATE_HZ) * state.timeScale
      / Math.max(1, substepDivisor);
    
    let updatedBatteries = state.batteries.map(battery => {
      const radar = battery.components.radar;
      const scanState = radar?.scanState ?? createRadarScanState({
        sector: battery.radarSector,
        heading: battery.radarHeading,
        scanPeriodSec: battery.scanRateSec,
        beamWidthDeg: battery.radarBeamWidthDeg,
        scanType: battery.radarScanType,
      });
      return {
        ...battery,
        components: {
          ...battery.components,
          radar: radar ? {
            ...radar,
            scanState: advanceRadarScan(
              scanState,
              deltaTimeSec,
              battery.radarSector,
              battery.radarHeading,
            ),
          } : null,
          launchers: battery.components.launchers.map(launcher => {
            if (launcher.launchState !== LAUNCHER_VISUAL_STATE.COOLDOWN) return launcher;
            const cooldownRemainingSec = Math.max(0, (launcher.cooldownRemainingSec ?? 0) - deltaTimeSec);
            return {
              ...launcher,
              cooldownRemainingSec,
              ready: cooldownRemainingSec <= 0,
              launchState: cooldownRemainingSec <= 0
                ? LAUNCHER_VISUAL_STATE.READY
                : LAUNCHER_VISUAL_STATE.COOLDOWN,
            };
          }),
        },
      };
    });

    const nextSimulationTime = state.simulationTime + deltaTimeSec;
    let nextEventSequence = state.nextEventSequence;
    let events = [...state.events];
    const emitEvent = (type, details) => {
      events.push(createSimulationEvent(nextEventSequence++, type, nextSimulationTime, details));
    };

    const newlyLaunchedMissiles = [];
    const nextPendingLaunches = [];
    const launcherStates = new Map();
    state.pendingLaunches.forEach(pendingLaunch => {
      const elapsedSec = pendingLaunch.elapsedSec + deltaTimeSec;
      const rotationDurationSec = pendingLaunch.rotationDurationSec
        ?? DEFAULT_LAUNCH_ROTATION_TIME_SEC;
      const ignitionDurationSec = pendingLaunch.ignitionDurationSec
        ?? DEFAULT_LAUNCH_IGNITION_TIME_SEC;
      const launchReadyAt = rotationDurationSec + ignitionDurationSec;
      if (elapsedSec < launchReadyAt) {
        const phase = elapsedSec < rotationDurationSec
          ? LAUNCHER_VISUAL_STATE.ROTATING
          : LAUNCHER_VISUAL_STATE.LAUNCHING;
        nextPendingLaunches.push({ ...pendingLaunch, elapsedSec, phase });
        launcherStates.set(pendingLaunch.launcherId, { state: phase, ready: false });
        return;
      }

      const track = state.tracks.find(candidate => candidate.id === pendingLaunch.trackId);
      const targetAvailable = state.airTargets.some(candidate => candidate.id === pendingLaunch.targetId);
      if (track && targetAvailable) {
        newlyLaunchedMissiles.push(createLaunchedInterceptor(pendingLaunch, track, nextSimulationTime));
        emitEvent(EVENT_TYPE.INTERCEPTOR_LAUNCHED, {
          missileId: pendingLaunch.missileId,
          trackId: pendingLaunch.trackId,
          batteryId: pendingLaunch.sourceBatteryId,
          launcherId: pendingLaunch.launcherId,
        });
      } else {
        emitEvent(EVENT_TYPE.INTERCEPTOR_FAILED, {
          missileId: pendingLaunch.missileId,
          trackId: pendingLaunch.trackId,
          reason: INTERCEPTOR_FAILURE_REASON.TARGET_UNAVAILABLE,
        });
      }
      const launchIntervalSec = getInterceptorSpec(pendingLaunch.interceptorSpecId)
        .gameplayPhysics.launchIntervalSec;
      launcherStates.set(pendingLaunch.launcherId, {
        state: LAUNCHER_VISUAL_STATE.COOLDOWN,
        ready: false,
        cooldownRemainingSec: launchIntervalSec,
      });
    });

    if (launcherStates.size > 0) {
      updatedBatteries = updatedBatteries.map(battery => ({
        ...battery,
        components: {
          ...battery.components,
          launchers: battery.components.launchers.map(launcher => {
            const visualState = launcherStates.get(launcher.id);
            return visualState
              ? {
                ...launcher,
                launchState: visualState.state,
                ready: visualState.ready,
                cooldownRemainingSec: visualState.cooldownRemainingSec ?? launcher.cooldownRemainingSec,
              }
              : launcher;
          }),
        },
      }));
    }

    const launchQueue = [];
    state.launchQueue.forEach(queueItem => {
      const battery = updatedBatteries.find(candidate => candidate.id === queueItem.sourceBatteryId);
      const launcher = battery?.components.launchers.find(candidate => candidate.id === queueItem.launcherId);
      const track = state.tracks.find(candidate => candidate.id === queueItem.trackId);
      const targetAvailable = state.airTargets.some(candidate => candidate.id === queueItem.targetId);
      if (!battery || !launcher || !track || !targetAvailable) {
        emitEvent(EVENT_TYPE.ENGAGEMENT_CANCELLED, {
          batteryId: queueItem.sourceBatteryId,
          trackId: queueItem.trackId,
          reason: 'TARGET_UNAVAILABLE',
        });
        return;
      }
      if (!launcher.ready || battery.missilesLeft <= 0 || battery.reloadRemainingSec) {
        launchQueue.push(queueItem);
        return;
      }

      const target = state.airTargets.find(candidate => candidate.id === queueItem.targetId);
      const interceptorSpec = getInterceptorSpec(queueItem.interceptorSpecId);
      const interceptSolution = evaluateInterceptFeasibility({
        launcher,
        target,
        track,
        interceptorSpec,
      });
      if (interceptSolution.status === INTERCEPT_FEASIBILITY.NO_SOLUTION) {
        emitEvent(EVENT_TYPE.ENGAGEMENT_CANCELLED, {
          batteryId: queueItem.sourceBatteryId,
          trackId: queueItem.trackId,
          reason: interceptSolution.reason,
        });
        return;
      }

      const verticalLaunch = interceptorSpec.gameplayPhysics.launchMode === 'VERTICAL';
      const launchHeading = verticalLaunch
        ? interceptSolution.interceptBearingDeg ?? getBearing(
          launcher.lat,
          launcher.lng,
          track.reportedPosition.lat,
          track.reportedPosition.lng,
        )
        : interceptSolution.interceptBearingDeg ?? getBearing(
          launcher.lat,
          launcher.lng,
          track.reportedPosition.lat,
          track.reportedPosition.lng,
        );
      const launchPosition = verticalLaunch
        ? { lat: launcher.lat, lng: launcher.lng }
        : getDestinationPoint(
          launcher.lat,
          launcher.lng,
          launchHeading,
          interceptorSpec.gameplayPhysics.launchOriginOffsetM / 1000,
        );
      nextPendingLaunches.push({
        ...queueItem,
        id: `PREP-${queueItem.missileId}`,
        lat: launchPosition.lat,
        lng: launchPosition.lng,
        altitudeM: launcher.altitudeM ?? 0,
        heading: launchHeading,
        interceptSolution,
        rotationDurationSec: verticalLaunch ? 0 : interceptSolution.rotationDelaySec,
        ignitionDurationSec: interceptorSpec.gameplayPhysics.launchPreparationSec,
        phase: verticalLaunch ? LAUNCHER_VISUAL_STATE.LAUNCHING : LAUNCHER_VISUAL_STATE.ROTATING,
        elapsedSec: 0,
      });
      updatedBatteries = updatedBatteries.map(candidate => {
        if (candidate.id !== battery.id) return candidate;
        const missilesLeft = candidate.missilesLeft - 1;
        return {
          ...candidate,
          missilesLeft,
          reloadRemainingSec: missilesLeft === 0 ? BATTERY_RELOAD_TIME_SEC : candidate.reloadRemainingSec,
          components: {
            ...candidate.components,
            launchers: candidate.components.launchers.map(candidateLauncher => {
              if (candidateLauncher.id === launcher.id) return {
                ...candidateLauncher,
                ready: false,
                heading: verticalLaunch ? candidateLauncher.heading : launchHeading,
                launchState: verticalLaunch
                  ? LAUNCHER_VISUAL_STATE.LAUNCHING
                  : LAUNCHER_VISUAL_STATE.ROTATING,
                velocity: {
                  ...candidateLauncher.velocity,
                  heading: verticalLaunch ? candidateLauncher.heading : launchHeading,
                },
              };
              return missilesLeft === 0
                ? { ...candidateLauncher, ready: false, launchState: LAUNCHER_VISUAL_STATE.RELOADING }
                : candidateLauncher;
            }),
          },
        };
      });
    });

    const pendingLauncherIds = new Set(nextPendingLaunches.map(launch => launch.launcherId));
    updatedBatteries = updatedBatteries.map(battery => {
      if (battery.reloadRemainingSec === null || battery.reloadRemainingSec === undefined) return battery;
      const reloadRemainingSec = Math.max(0, battery.reloadRemainingSec - deltaTimeSec);
      const reloadComplete = reloadRemainingSec <= 0;
      return {
        ...battery,
        missilesLeft: reloadComplete
          ? (battery.ammoCapacity ?? SYSTEM_CATALOG[battery.category]?.missilesLeft ?? battery.missilesLeft)
          : battery.missilesLeft,
        reloadRemainingSec: reloadComplete ? null : reloadRemainingSec,
        components: {
          ...battery.components,
          launchers: battery.components.launchers.map(launcher => {
            if (!reloadComplete && pendingLauncherIds.has(launcher.id)) return launcher;
            return {
              ...launcher,
              ready: reloadComplete,
              launchState: reloadComplete
                ? LAUNCHER_VISUAL_STATE.READY
                : LAUNCHER_VISUAL_STATE.RELOADING,
            };
          }),
        },
      };
    });

    const spawnedTargetIds = new Set(state.spawnedTargetIds);
    const announcedGroupIds = new Set(state.announcedGroupIds);
    const targetsWithSpawns = [...state.airTargets];
    state.activeScenario.targets.forEach(definition => {
      const spawnTime = state.activeScenario.startTimeSeconds + definition.spawnOffsetSeconds;
      if (spawnedTargetIds.has(definition.id) || spawnTime > nextSimulationTime) return;
      targetsWithSpawns.push(createAirTarget(definition, spawnTime));
      spawnedTargetIds.add(definition.id);
      emitEvent(EVENT_TYPE.TARGET_SPAWNED, {
        targetId: definition.id,
        groupId: definition.groupId,
      });
      if (definition.groupId && !announcedGroupIds.has(definition.groupId)) {
        announcedGroupIds.add(definition.groupId);
        emitEvent(EVENT_TYPE.THREAT_ALERT, {
          groupId: definition.groupId,
          groupSize: definition.groupSize,
          targetType: definition.type,
          modelId: definition.modelId,
          objectiveName: definition.objectiveName,
          objectiveCategory: definition.objectiveCategory,
          launchPattern: definition.launchPattern,
          source: 'SCENARIO_INTELLIGENCE',
        });
      }
    });

    const previousTargetsById = new Map(targetsWithSpawns.map(target => [target.id, target]));
    const advancedTargets = targetsWithSpawns.map(target => advanceAirTarget(target, deltaTimeSec));
    advancedTargets
      .filter(target => target.state === 'COMPLETED')
      .forEach(target => emitEvent(EVENT_TYPE.TARGET_ESCAPED, { targetId: target.id }));
    const updatedTargets = advancedTargets.filter(target => target.state === 'ALIVE');
    const updatedTargetsById = new Map(updatedTargets.map(target => [target.id, target]));

    let nextTrackSequence = state.nextTrackSequence;
    const tracksByTargetId = new Map(state.tracks.map(track => [track.targetId, track]));
    const updatedTracks = [];
    let sensorContacts = ageSensorEvidenceContacts(
      state.sensorContacts ?? [],
      nextSimulationTime,
      deltaTimeSec,
    );
    const operationalNetworkRadars = updatedBatteries.filter(isRadarSensorOperational);
    updatedTargets.forEach(target => {
      const existingTrack = tracksByTargetId.get(target.id);
      const networkScanOpportunity = selectNetworkRadarScanOpportunity(
        operationalNetworkRadars,
        target,
        existingTrack?.sourceBatteryId,
      );
      const scanOpportunities = networkScanOpportunity ? [networkScanOpportunity] : [];

      let observation = null;
      if (scanOpportunities.length > 0) {
        const scanResult = applySensorScanBatch({
          contacts: sensorContacts,
          target,
          scanOpportunities,
          simulationTime: nextSimulationTime,
          existingTrack,
        });
        sensorContacts = scanResult.contacts;
        observation = scanResult.observation;
      }

      if (observation) {
        const trackId = existingTrack ? existingTrack.id : formatTrackId(nextTrackSequence++);
        const observedTrack = applySensorEvidenceObservation({
          existingTrack,
          target,
          observation,
          simulationTime: nextSimulationTime,
          trackId,
        });
        updatedTracks.push(observedTrack);
        if (!existingTrack || existingTrack.state === TRACK_STATE.LOST) {
          emitEvent(EVENT_TYPE.TRACK_DETECTED, {
            trackId: observedTrack.id,
            targetId: target.id,
            reacquired: existingTrack?.state === TRACK_STATE.LOST,
          });
        } else if (
          existingTrack.state !== TRACK_STATE.TRACKED
          && existingTrack.state !== TRACK_STATE.IDENTIFIED
          && (observedTrack.state === TRACK_STATE.TRACKED || observedTrack.state === TRACK_STATE.IDENTIFIED)
        ) {
          emitEvent(EVENT_TYPE.TRACK_ESTABLISHED, { trackId: observedTrack.id, targetId: target.id });
        }
        return;
      }

      if (!existingTrack) return;
      const sourceRadarBattery = operationalNetworkRadars.find(battery => (
        battery.id === existingTrack.sourceBatteryId
      ));
      const hasNetworkCoverage = sourceRadarBattery
        ? isTargetInRadarCoverage(sourceRadarBattery, target)
        : operationalNetworkRadars.some(battery => isTargetInRadarCoverage(battery, target));
      if (!hasNetworkCoverage) {
        const lostTrack = updateLostTrack(existingTrack, nextSimulationTime, deltaTimeSec);
        if (lostTrack) updatedTracks.push(lostTrack);
        return;
      }
      if (!isTrackSensorStale(existingTrack, nextSimulationTime)) {
        updatedTracks.push(existingTrack);
        return;
      }

      const lostTrack = updateLostTrack(existingTrack, nextSimulationTime, deltaTimeSec);
      if (lostTrack) updatedTracks.push(lostTrack);
    });
    const updatedTracksById = new Map(updatedTracks.map(track => [track.id, track]));

    let batteriesWithScanFeedback = updatedBatteries;
    let nextGunEngagements = [];
    let nextGunTracers = (state.gunTracers ?? []).filter(tracer => (
      nextSimulationTime <= tracer.startTime + tracer.flightDurationSec + 0.18
    ));
    const gunInterceptedTargetIds = new Set();
    (state.gunEngagements ?? []).forEach(engagement => {
      const battery = batteriesWithScanFeedback.find(candidate => candidate.id === engagement.batteryId);
      const track = updatedTracksById.get(engagement.trackId);
      const target = updatedTargetsById.get(engagement.targetId);
      const gunSpec = getGunSystemSpec(battery?.gunSpecId);
      if (!battery || !track || !target || !gunSpec) return;

      const unit = battery.components.launchers[0];
      const aimSolution = solveGunAim({ unit, track, target, gunSpec });
      const aimHeading = quantizeGepardHeading(getBearing(
        unit.lat,
        unit.lng,
        aimSolution.aimPosition.lat,
        aimSolution.aimPosition.lng,
      ));
      const phaseElapsedSec = nextSimulationTime - engagement.phaseStartedAt;
      let nextEngagement = engagement;
      let launcherState = engagement.phase === GUN_ENGAGEMENT_PHASE.FIRING
        ? LAUNCHER_VISUAL_STATE.FIRING
        : LAUNCHER_VISUAL_STATE.TRACKING;
      let missilesLeft = battery.missilesLeft;
      let reloadRemainingSec = battery.reloadRemainingSec;
      let gunNextBurstTime = battery.gunNextBurstTime ?? 0;

      if (engagement.phase === GUN_ENGAGEMENT_PHASE.TRACKING
        && phaseElapsedSec >= gunSpec.reactionTimeSec) {
        const predictedOutcome = resolveGunBurst({ battery, track, target });
        const aimBearing = getBearing(
          unit.lat,
          unit.lng,
          aimSolution.aimPosition.lat,
          aimSolution.aimPosition.lng,
        );
        const tracerEndPosition = predictedOutcome.destroyed
          ? aimSolution.aimPosition
          : getDestinationPoint(
            unit.lat,
            unit.lng,
            aimBearing,
            aimSolution.distanceKm + 1,
          );
        const tracerDistanceKm = aimSolution.distanceKm + (predictedOutcome.destroyed ? 0 : 1);
        const tracerFlightTimeSec = getGunProjectileFlightTimeSec(tracerDistanceKm, gunSpec);
        const tracerDelaysSec = [0, 0.09, 0.18];
        nextGunTracers = [...nextGunTracers, ...tracerDelaysSec.map((delaySec, index) => ({
          id: `${engagement.id}-TRC-${index + 1}`,
          engagementId: engagement.id,
          targetId: target.id,
          startPosition: { lat: unit.lat, lng: unit.lng },
          endPosition: { lat: tracerEndPosition.lat, lng: tracerEndPosition.lng },
          startTime: nextSimulationTime + delaySec,
          flightDurationSec: tracerFlightTimeSec,
          willHit: predictedOutcome.destroyed,
        }))];
        missilesLeft = Math.max(0, missilesLeft - gunSpec.roundsPerBurst);
        gunNextBurstTime = nextSimulationTime
          + gunSpec.burstDurationSec
          + gunSpec.burstCooldownSec;
        reloadRemainingSec = missilesLeft === 0 ? gunSpec.reloadDurationSec : reloadRemainingSec;
        launcherState = LAUNCHER_VISUAL_STATE.FIRING;
        nextEngagement = {
          ...engagement,
          phase: GUN_ENGAGEMENT_PHASE.FIRING,
          phaseStartedAt: nextSimulationTime,
          projectileResolutionTime: nextSimulationTime
            + tracerDelaysSec.at(-1)
            + tracerFlightTimeSec,
          predictedOutcome,
        };
        emitEvent(EVENT_TYPE.GUN_BURST_STARTED, {
          engagementId: engagement.id,
          batteryId: battery.id,
          trackId: track.id,
          targetId: target.id,
        });
      } else if (engagement.phase === GUN_ENGAGEMENT_PHASE.FIRING
        && phaseElapsedSec >= gunSpec.burstDurationSec) {
        launcherState = LAUNCHER_VISUAL_STATE.TRACKING;
        nextEngagement = {
          ...engagement,
          phase: GUN_ENGAGEMENT_PHASE.PROJECTILE_FLIGHT,
          phaseStartedAt: nextSimulationTime,
        };
      } else if (
        engagement.phase === GUN_ENGAGEMENT_PHASE.PROJECTILE_FLIGHT
        && nextSimulationTime >= engagement.projectileResolutionTime
      ) {
        const outcome = engagement.predictedOutcome;
        if (outcome.destroyed) {
          gunInterceptedTargetIds.add(target.id);
          emitEvent(EVENT_TYPE.TARGET_INTERCEPTED, {
            targetId: target.id,
            trackId: track.id,
            missileId: engagement.id,
            batteryId: battery.id,
            weaponType: WEAPON_SYSTEM_TYPE.GUN_AA,
            position: { ...target.position },
            altitudeM: target.altitudeM,
            effectiveness: outcome.effectiveness,
          });
        }
        emitEvent(EVENT_TYPE.GUN_BURST_RESOLVED, {
          engagementId: engagement.id,
          batteryId: battery.id,
          trackId: track.id,
          targetId: target.id,
          destroyed: outcome.destroyed,
          effectiveness: outcome.effectiveness,
          distanceKm: outcome.distanceKm,
          projectileFlightTimeSec: outcome.projectileFlightTimeSec,
          timeRemainingInZoneSec: outcome.timeRemainingInZoneSec,
        });
        nextEngagement = null;
        launcherState = reloadRemainingSec
          ? LAUNCHER_VISUAL_STATE.RELOADING
          : LAUNCHER_VISUAL_STATE.COOLDOWN;
      }

      if (nextEngagement) nextGunEngagements.push(nextEngagement);
      batteriesWithScanFeedback = batteriesWithScanFeedback.map(candidate => candidate.id === battery.id
        ? {
          ...candidate,
          missilesLeft,
          reloadRemainingSec,
          gunNextBurstTime,
          assignedTrackId: nextEngagement ? track.id : null,
          components: {
            ...candidate.components,
            launchers: candidate.components.launchers.map(launcher => ({
              ...launcher,
              heading: aimHeading,
              velocity: { ...launcher.velocity, heading: aimHeading },
              launchState: launcherState,
              ready: !nextEngagement && !reloadRemainingSec,
              cooldownRemainingSec: launcherState === LAUNCHER_VISUAL_STATE.COOLDOWN
                ? Math.max(0, gunNextBurstTime - nextSimulationTime)
                : launcher.cooldownRemainingSec,
            })),
          },
        }
        : candidate);
    });
    batteriesWithScanFeedback = batteriesWithScanFeedback.map(battery => ({
      ...battery,
      currentSimulationTime: nextSimulationTime,
    }));

    const activeMissiles = [];
    const interceptedTargetIds = new Set(gunInterceptedTargetIds);
    [...state.missiles, ...newlyLaunchedMissiles].forEach(missile => {
      const interceptorSpec = getInterceptorSpec(missile.interceptorSpecId);
      const physics = interceptorSpec.gameplayPhysics;

      if (missile.lifecycleState === INTERCEPTOR_LIFECYCLE_STATE.IMPACT) {
        const impactTarget = updatedTargetsById.get(missile.targetId);
        const impactPosition = impactTarget?.position ?? missile.impactTargetPosition;
        const impactAltitudeM = impactTarget?.altitudeM ?? missile.impactTargetAltitudeM;
        const impactElapsedSec = nextSimulationTime - missile.impactStartedAt;
        if (impactElapsedSec < DIRECT_IMPACT_VISUAL_DURATION_SEC) {
          activeMissiles.push({
            ...missile,
            lat: impactPosition.lat,
            lng: impactPosition.lng,
            position: { lat: impactPosition.lat, lng: impactPosition.lng, lon: impactPosition.lng },
            altitudeM: impactAltitudeM,
            distanceToTargetKm: 0,
          });
          return;
        }
        if (impactTarget) interceptedTargetIds.add(impactTarget.id);
        emitEvent(EVENT_TYPE.TARGET_INTERCEPTED, {
          targetId: missile.targetId,
          trackId: missile.trackId,
          missileId: missile.id,
          batteryId: missile.sourceBatteryId,
          position: { lat: impactPosition.lat, lng: impactPosition.lng },
          altitudeM: impactAltitudeM,
          closestApproachM: missile.impactClosestApproachM,
        });
        return;
      }

      if (missile.lifecycleState === INTERCEPTOR_LIFECYCLE_STATE.SELF_DESTRUCT) {
        const selfDestructElapsedSec = nextSimulationTime - missile.selfDestructTime;
        if (selfDestructElapsedSec < physics.selfDestructEffectSec) {
          activeMissiles.push({ ...missile, selfDestructElapsedSec });
        }
        return;
      }

      if (missile.lifecycleState === INTERCEPTOR_LIFECYCLE_STATE.MISSED) {
        const flight = advanceInterceptorFlight(missile, deltaTimeSec, physics);
        const nextPosition = getDestinationPoint(
          missile.lat,
          missile.lng,
          missile.heading,
          flight.travelDistanceKm,
        );
        if (nextSimulationTime - missile.missedAtTime >= physics.missVisualContinueSec) {
          emitEvent(EVENT_TYPE.INTERCEPTOR_SELF_DESTRUCT, {
            missileId: missile.id,
            trackId: missile.trackId,
            position: { lat: nextPosition.lat, lng: nextPosition.lng },
          });
          activeMissiles.push({
            ...missile,
            ...flight,
            lat: nextPosition.lat,
            lng: nextPosition.lng,
            position: { lat: nextPosition.lat, lng: nextPosition.lng, lon: nextPosition.lng },
            lifecycleState: INTERCEPTOR_LIFECYCLE_STATE.SELF_DESTRUCT,
            selfDestructTime: nextSimulationTime,
            selfDestructElapsedSec: 0,
          });
        } else {
          activeMissiles.push({
            ...missile,
            ...flight,
            lat: nextPosition.lat,
            lng: nextPosition.lng,
            position: { lat: nextPosition.lat, lng: nextPosition.lng, lon: nextPosition.lng },
            velocity: { speedKmh: flight.speedKmh, heading: missile.heading },
          });
        }
        return;
      }

      const target = updatedTargetsById.get(missile.targetId);
      if (!target) {
        emitEvent(EVENT_TYPE.INTERCEPTOR_FAILED, {
          missileId: missile.id,
          trackId: missile.trackId,
          reason: INTERCEPTOR_FAILURE_REASON.TARGET_UNAVAILABLE,
        });
        activeMissiles.push({
          ...missile,
          lifecycleState: INTERCEPTOR_LIFECYCLE_STATE.MISSED,
          missedAtTime: nextSimulationTime,
          failureReason: INTERCEPTOR_FAILURE_REASON.TARGET_UNAVAILABLE,
        });
        return;
      }
      if (interceptedTargetIds.has(target.id)) return;

      const engagementTrack = updatedTracksById.get(missile.trackId);
      const guidance = advanceInterceptorGuidance({
        interceptor: missile,
        track: engagementTrack,
        simulationTime: nextSimulationTime,
        deltaTimeSec,
        physics,
      });
      const headingChangeDeg = getHeadingChangeDeg(missile.heading, guidance.heading);
      let flight = advanceInterceptorFlight(missile, deltaTimeSec, physics, {
        headingChangeDeg,
        headingCorrectionDeg: guidance.headingCorrectionDeg,
        altitudeM: missile.altitudeM,
      });
      if (guidance.failedReason) {
        emitEvent(EVENT_TYPE.INTERCEPTOR_FAILED, {
          missileId: missile.id,
          trackId: missile.trackId,
          reason: guidance.failedReason,
        });
        activeMissiles.push({
          ...missile,
          ...flight,
          lifecycleState: INTERCEPTOR_LIFECYCLE_STATE.MISSED,
          missedAtTime: nextSimulationTime,
          failureReason: guidance.failedReason,
        });
        return;
      }
      const physicsProfile = INTERCEPTOR_PHYSICS_PROFILES[state.simulationProfile.physicsLevel]
        ?? INTERCEPTOR_PHYSICS_PROFILES.BASIC;
      const altitudeFlight = physicsProfile.advanceAltitude
        ? physicsProfile.advanceAltitude({
          interceptor: { ...missile, ...flight, ...guidance },
          targetAltitudeM: guidance.guidance.commandPosition.alt ?? target.altitudeM,
          deltaTimeSec,
          travelDistanceKm: flight.travelDistanceKm,
          physics,
        })
        : {
          altitudeM: missile.altitudeM,
          verticalSpeedMps: missile.verticalSpeedMps,
          horizontalDistanceKm: flight.travelDistanceKm,
          flightPhase: missile.flightPhase,
        };
      flight = applyAltitudeEnergyExchange(
        flight,
        altitudeFlight.altitudeM - missile.altitudeM,
        deltaTimeSec,
        physics,
      );
      const nextPosition = getDestinationPoint(
        missile.lat,
        missile.lng,
        guidance.heading,
        altitudeFlight.horizontalDistanceKm,
      );
      const nextLat = nextPosition.lat;
      const nextLng = nextPosition.lng;
      const previousTarget = previousTargetsById.get(target.id) ?? target;
      const sweptApproach = didSweptPathsEnterRadius({
        interceptorStart: {
          lat: missile.lat,
          lng: missile.lng,
          altitudeM: missile.altitudeM,
        },
        interceptorEnd: {
          lat: nextLat,
          lng: nextLng,
          altitudeM: altitudeFlight.altitudeM,
        },
        targetStart: {
          lat: previousTarget.position.lat,
          lng: previousTarget.position.lng,
          altitudeM: previousTarget.altitudeM,
        },
        targetEnd: {
          lat: target.position.lat,
          lng: target.position.lng,
          altitudeM: target.altitudeM,
        },
      }, Math.min(
        physics.proximityFuseRadiusM,
        physics.minimumVisualContactDistanceM ?? physics.proximityFuseRadiusM,
      ) / 1000);
      const targetDistanceKm = sweptApproach.closestDistanceKm;
      const currentDistanceToTargetKm = getSlantDistanceKm(
        { lat: nextLat, lng: nextLng },
        altitudeFlight.altitudeM,
        target.position,
        target.altitudeM,
      );
      const improvedApproach = targetDistanceKm < missile.closestApproachKm;
      const closestApproachKm = improvedApproach
        ? targetDistanceKm
        : missile.closestApproachKm;
      const timeSinceClosestApproachSec = improvedApproach
        ? 0
        : missile.timeSinceClosestApproachSec + deltaTimeSec;

      if (
        sweptApproach.intersects
        && flight.flightTime >= Math.max(
          physics.minimumControlledFlightTimeSec ?? 0,
          physics.guidanceReactionTimeSec ?? 0,
        )
      ) {
        // The gameplay result is unchanged. Keep both sprites coincident for a
        // brief simulation-time beat so the accepted intercept reads as a
        // direct visual impact instead of the missile disappearing nearby.
        activeMissiles.push({
          ...missile,
          ...flight,
          ...guidance,
          ...altitudeFlight,
          lat: target.position.lat,
          lng: target.position.lng,
          position: {
            lat: target.position.lat,
            lng: target.position.lng,
            lon: target.position.lng,
          },
          altitudeM: target.altitudeM,
          lifecycleState: INTERCEPTOR_LIFECYCLE_STATE.IMPACT,
          impactStartedAt: nextSimulationTime,
          impactTargetPosition: { ...target.position },
          impactTargetAltitudeM: target.altitudeM,
          impactClosestApproachM: sweptApproach.closestDistanceKm * 1000,
          distanceToTargetKm: 0,
          velocity: { speedKmh: flight.speedKmh, heading: guidance.heading },
        });
      } else if (flight.terminated) {
        emitEvent(EVENT_TYPE.INTERCEPTOR_FAILED, {
          missileId: missile.id,
          trackId: missile.trackId,
          reason: INTERCEPTOR_FAILURE_REASON.ENERGY_DEPLETED,
        });
        activeMissiles.push({
          ...missile,
          ...flight,
          ...altitudeFlight,
          lat: nextLat,
          lng: nextLng,
          position: { lat: nextLat, lng: nextLng, lon: nextLng },
          lifecycleState: INTERCEPTOR_LIFECYCLE_STATE.SELF_DESTRUCT,
          selfDestructTime: nextSimulationTime,
          selfDestructElapsedSec: 0,
          failureReason: INTERCEPTOR_FAILURE_REASON.ENERGY_DEPLETED,
        });
        emitEvent(EVENT_TYPE.INTERCEPTOR_SELF_DESTRUCT, {
          missileId: missile.id,
          trackId: missile.trackId,
          position: { lat: nextLat, lng: nextLng },
        });
      } else if (
        closestApproachKm <= physics.terminalRangeKm * 1.5
        && timeSinceClosestApproachSec >= physics.postPassContinueSec
      ) {
        emitEvent(EVENT_TYPE.INTERCEPTOR_FAILED, {
          missileId: missile.id,
          trackId: missile.trackId,
          reason: INTERCEPTOR_FAILURE_REASON.MISS,
        });
        activeMissiles.push({
          ...missile,
          ...flight,
          ...guidance,
          kinematicPhase: guidance.guidanceState === INTERCEPTOR_GUIDANCE_STATE.TERMINAL
            ? INTERCEPTOR_KINEMATIC_PHASE.TERMINAL
            : flight.motorPhase === 'BOOST'
              ? INTERCEPTOR_KINEMATIC_PHASE.BOOST
              : INTERCEPTOR_KINEMATIC_PHASE.MIDCOURSE,
          ...altitudeFlight,
          lat: nextLat,
          lng: nextLng,
          position: { lat: nextLat, lng: nextLng, lon: nextLng },
          lifecycleState: INTERCEPTOR_LIFECYCLE_STATE.MISSED,
          missedAtTime: nextSimulationTime,
          failureReason: INTERCEPTOR_FAILURE_REASON.MISS,
          distanceToTargetKm: currentDistanceToTargetKm,
          sweptClosestApproachM: sweptApproach.closestDistanceKm * 1000,
        });
      } else {
        const previousTrajectoryPoint = missile.trajectory.at(-1);
        const shouldAddTrajectoryPoint = !previousTrajectoryPoint || getDistanceKm(
          previousTrajectoryPoint.lat,
          previousTrajectoryPoint.lng,
          nextLat,
          nextLng,
        ) >= 0.5;
        activeMissiles.push({ 
          ...missile,
          ...flight,
          ...guidance,
          kinematicPhase: guidance.guidanceState === INTERCEPTOR_GUIDANCE_STATE.TERMINAL
            ? INTERCEPTOR_KINEMATIC_PHASE.TERMINAL
            : flight.motorPhase === 'BOOST'
              ? INTERCEPTOR_KINEMATIC_PHASE.BOOST
              : INTERCEPTOR_KINEMATIC_PHASE.MIDCOURSE,
          lifecycleState: guidance.guidanceState === INTERCEPTOR_GUIDANCE_STATE.TERMINAL
            ? INTERCEPTOR_LIFECYCLE_STATE.TERMINAL
            : INTERCEPTOR_LIFECYCLE_STATE.FLYING,
          desiredHeading: guidance.guidance.commandHeading,
          turnRateDegPerSec: guidance.turnRateDegPerSec,
          headingCorrectionDeg: guidance.headingCorrectionDeg,
          maximumTurnRateDegPerSec: guidance.maximumTurnRateDegPerSec,
          turnEnergyFactor: guidance.energyFactor,
          turnSpeedFactor: guidance.speedFactor,
          turnRadiusKm: guidance.turnRadiusKm,
          distanceToTargetKm: currentDistanceToTargetKm,
          sweptClosestApproachM: sweptApproach.closestDistanceKm * 1000,
          fuseRadiusM: physics.proximityFuseRadiusM,
          closestApproachKm,
          timeSinceClosestApproachSec,
          trajectory: shouldAddTrajectoryPoint
            ? [...missile.trajectory, {
              lat: nextLat,
              lng: nextLng,
              altitudeM: altitudeFlight.altitudeM,
            }].slice(-36)
            : missile.trajectory,
          ...altitudeFlight,
          lat: nextLat,
          lng: nextLng,
          position: { lat: nextLat, lng: nextLng, lon: nextLng },
          velocity: { speedKmh: flight.speedKmh, heading: guidance.heading },
        });
      }
    });

    let survivingTargets = updatedTargets.filter(target => !interceptedTargetIds.has(target.id));
    const survivingTargetIds = new Set(survivingTargets.map(target => target.id));
    const survivingTracks = updatedTracks.filter(track => survivingTargetIds.has(track.targetId));
    const survivingSensorContacts = sensorContacts.filter(contact => (
      survivingTargetIds.has(contact.targetId)
    ));
    const selectedTrackStillExists = survivingTracks.some(track => track.id === state.selectedTrackId);

    const survivingTrackIds = new Set(survivingTracks.map(track => track.id));
    let finalLaunchQueue = launchQueue.filter(queueItem => {
      if (survivingTrackIds.has(queueItem.trackId)) return true;
      emitEvent(EVENT_TYPE.ENGAGEMENT_CANCELLED, {
        batteryId: queueItem.sourceBatteryId,
        trackId: queueItem.trackId,
        reason: 'TARGET_DESTROYED',
      });
      return false;
    });
    let nextMissileSequence = state.nextMissileSequence;
    let nextAutoDecisionTime = state.nextAutoDecisionTime;
    let nextAutoEngagementAttempts = { ...state.autoEngagementAttempts };

    if (nextSimulationTime >= state.nextAutoDecisionTime) {
      nextAutoDecisionTime = nextSimulationTime + AUTO_DECISION_INTERVAL_SEC;
      let registry = buildEngagementRegistry({
        missiles: activeMissiles,
        pendingLaunches: nextPendingLaunches,
        launchQueue: finalLaunchQueue,
        gunEngagements: nextGunEngagements,
      });
      const targetDefenseAssessments = buildTargetDefenseAssessments({
        targets: survivingTargets,
        tracks: survivingTracks,
        batteries: batteriesWithScanFeedback,
        simulationTime: nextSimulationTime,
      });
      survivingTargets = survivingTargets.map(target => ({
        ...target,
        defenseAssessment: targetDefenseAssessments.get(target.id) ?? null,
      }));
      const targetsById = new Map(survivingTargets.map(target => [target.id, target]));
      const priorityPatriots = batteriesWithScanFeedback.filter(battery => {
        if (!isPatriotBattery(battery)) return false;
        if (![BATTERY_CONTROL_MODE.AUTO, BATTERY_CONTROL_MODE.ASSIST].includes(battery.controlMode)) {
          return false;
        }
        const doctrine = DOCTRINE_CONFIG[battery.doctrine]
          ?? DOCTRINE_CONFIG[DEFENSE_DOCTRINE.BALANCED];
        return battery.missilesLeft - getQueuedCountForBattery(finalLaunchQueue, battery.id)
          > doctrine.reserveMissiles;
      });
      const priorityPatriotIds = new Set(priorityPatriots.map(battery => battery.id));
      const patriotReservedTrackIds = new Set(survivingTracks.flatMap(track => {
        const target = targetsById.get(track.targetId);
        if (!isBallisticTarget(target)) return [];
        const existingAssignment = registry.get(track.id);
        const alreadyHandledByPatriot = existingAssignment
          && [...existingAssignment.batteryIds].some(batteryId => priorityPatriotIds.has(batteryId));
        const visibleToCapablePatriot = priorityPatriots.some(battery => (
          isRadarSensorOperational(battery)
          && isTargetInRadarCoverage(battery, target)
          && rankThreatsForBattery({
            battery,
            tracks: [track],
            targets: [target],
            registry,
          }).length > 0
        ));
        return alreadyHandledByPatriot || visibleToCapablePatriot ? [track.id] : [];
      }));
      const batteryUpdates = new Map();
      [...batteriesWithScanFeedback]
        .sort((first, second) => (
          Number(isPatriotBattery(second)) - Number(isPatriotBattery(first))
          || first.id.localeCompare(second.id)
        ))
        .forEach(originalBattery => {
          const battery = batteryUpdates.get(originalBattery.id) ?? originalBattery;
          const controlMode = battery.controlMode ?? BATTERY_CONTROL_MODE.MANUAL;
          if (controlMode === BATTERY_CONTROL_MODE.HOLD) {
            batteryUpdates.set(battery.id, {
              ...battery,
              autoStatus: AUTO_DEFENSE_STATUS.HOLDING,
              recommendedTrackId: null,
              assignedTrackId: null,
              autoDecision: null,
            });
            return;
          }
          if (controlMode === BATTERY_CONTROL_MODE.MANUAL) {
            batteryUpdates.set(battery.id, {
              ...battery,
              autoStatus: AUTO_DEFENSE_STATUS.MANUAL,
              recommendedTrackId: null,
              autoDecision: null,
            });
            return;
          }

          const doctrine = DOCTRINE_CONFIG[battery.doctrine]
            ?? DOCTRINE_CONFIG[DEFENSE_DOCTRINE.BALANCED];
          const queuedCount = getQueuedCountForBattery(finalLaunchQueue, battery.id);
          const availableMissiles = battery.missilesLeft - queuedCount;
          if (availableMissiles <= doctrine.reserveMissiles) {
            if (battery.autoStatus !== AUTO_DEFENSE_STATUS.NO_AMMO) {
              emitEvent(EVENT_TYPE.NO_AMMO, { batteryId: battery.id });
            }
            batteryUpdates.set(battery.id, {
              ...battery,
              autoStatus: AUTO_DEFENSE_STATUS.NO_AMMO,
              recommendedTrackId: null,
              autoDecision: null,
            });
            return;
          }

          const rankedThreats = rankThreatsForBattery({
            battery,
            tracks: isPatriotBattery(battery)
              ? survivingTracks
              : survivingTracks.filter(track => !patriotReservedTrackIds.has(track.id)),
            targets: survivingTargets,
            registry,
          });
          const plannedThreats = rankedThreats.map(threat => {
            const track = survivingTracks.find(candidate => candidate.id === threat.trackId);
            const target = targetsById.get(threat.targetId);
            return {
              threat,
              track,
              target,
              plan: planAutomaticEngagement({
                battery,
                track,
                target,
                threat,
                allBatteries: batteriesWithScanFeedback,
              }),
            };
          });
          const actionable = plannedThreats.find(candidate => (
            candidate.plan.decision === AUTO_ENGAGEMENT_DECISION.ENGAGE
            && candidate.threat.score >= doctrine.minimumThreatScore
            && candidate.threat.interceptSolution?.status !== INTERCEPT_FEASIBILITY.NO_SOLUTION
            && (nextAutoEngagementAttempts[`${battery.id}:${candidate.threat.trackId}`] ?? 0)
              < getInterceptorEngagementPolicy(battery).maximumAutomaticAttempts
          )) ?? null;
          const plannedRecommendation = actionable ?? plannedThreats[0] ?? null;
          const recommendation = plannedRecommendation?.threat ?? null;
          const autoDecision = plannedRecommendation?.plan ?? null;
          if (controlMode === BATTERY_CONTROL_MODE.ASSIST) {
            batteryUpdates.set(battery.id, {
              ...battery,
              autoStatus: recommendation ? AUTO_DEFENSE_STATUS.TRACKING : AUTO_DEFENSE_STATUS.NO_TARGETS,
              recommendedTrackId: recommendation?.trackId ?? null,
              autoDecision,
            });
            return;
          }

          const activePreparationCount = nextPendingLaunches.filter(item => (
            item.sourceBatteryId === battery.id
          )).length + nextGunEngagements.filter(item => item.batteryId === battery.id).length;
          const launcherCapacity = getOperationalLaunchers(battery).length;
          if (
            !actionable
            || queuedCount + activePreparationCount >= launcherCapacity
          ) {
            const currentlyEngaging = registry.size > 0 && [...registry.values()].some(entry => (
              entry.batteryIds.has(battery.id)
            ));
            batteryUpdates.set(battery.id, {
              ...battery,
              autoStatus: currentlyEngaging
                ? AUTO_DEFENSE_STATUS.ENGAGING
                : recommendation
                  ? AUTO_DEFENSE_STATUS.TRACKING
                  : AUTO_DEFENSE_STATUS.NO_TARGETS,
              recommendedTrackId: recommendation?.trackId ?? null,
              autoDecision,
            });
            return;
          }

          const { threat: engagementThreat, track, target, plan: engagementPlan } = actionable;
          if (battery.weaponType === WEAPON_SYSTEM_TYPE.GUN_AA) {
            const gunSolution = evaluateGunEngagement({
              battery,
              track,
              target,
              simulationTime: nextSimulationTime,
            });
            if (!gunSolution.ready) return;
            const engagementId = `GUN-${nextMissileSequence.toString().padStart(3, '0')}`;
            nextGunEngagements = [...nextGunEngagements, {
              id: engagementId,
              trackId: track.id,
              targetId: target.id,
              batteryId: battery.id,
              sourceBatteryId: battery.id,
              requestedBy: BATTERY_CONTROL_MODE.AUTO,
              phase: GUN_ENGAGEMENT_PHASE.TRACKING,
              phaseStartedAt: nextSimulationTime,
            }];
            nextMissileSequence += 1;
            emitEvent(EVENT_TYPE.AUTO_TARGET_ASSIGNED, {
              batteryId: battery.id,
              trackId: track.id,
              threatScore: engagementThreat.score,
              successConfidence: engagementPlan.successConfidence,
              decisionReason: engagementPlan.reason,
            });
            emitEvent(EVENT_TYPE.AUTO_ENGAGEMENT, {
              batteryId: battery.id,
              trackId: track.id,
              threatScore: engagementThreat.score,
              successConfidence: engagementPlan.successConfidence,
              decisionReason: engagementPlan.reason,
              weaponType: WEAPON_SYSTEM_TYPE.GUN_AA,
            });
            registry = buildEngagementRegistry({
              missiles: activeMissiles,
              pendingLaunches: nextPendingLaunches,
              launchQueue: finalLaunchQueue,
              gunEngagements: nextGunEngagements,
            });
            batteryUpdates.set(battery.id, {
              ...battery,
              autoStatus: AUTO_DEFENSE_STATUS.ENGAGING,
              recommendedTrackId: track.id,
              assignedTrackId: track.id,
              autoDecision: engagementPlan,
            });
            return;
          }
          const queueState = {
            launchQueue: finalLaunchQueue,
            pendingLaunches: nextPendingLaunches,
            nextMissileSequence,
          };
          const queueItem = createLaunchQueueItem({
            state: queueState,
            battery,
            track,
            target,
            requestedBy: BATTERY_CONTROL_MODE.AUTO,
            simulationTime: nextSimulationTime,
          });
          if (!queueItem) return;
          finalLaunchQueue = [...finalLaunchQueue, queueItem];
          const attemptKey = `${battery.id}:${engagementThreat.trackId}`;
          nextAutoEngagementAttempts[attemptKey] = (nextAutoEngagementAttempts[attemptKey] ?? 0) + 1;
          nextMissileSequence += 1;
          if (battery.assignedTrackId !== engagementThreat.trackId) {
            emitEvent(EVENT_TYPE.AUTO_TARGET_ASSIGNED, {
              batteryId: battery.id,
              trackId: engagementThreat.trackId,
              threatScore: engagementThreat.score,
              successConfidence: engagementPlan.successConfidence,
              decisionReason: engagementPlan.reason,
            });
          }
          emitEvent(EVENT_TYPE.AUTO_ENGAGEMENT, {
            batteryId: battery.id,
            trackId: engagementThreat.trackId,
            threatScore: engagementThreat.score,
            successConfidence: engagementPlan.successConfidence,
            decisionReason: engagementPlan.reason,
          });
          emitEvent(EVENT_TYPE.INTERCEPTOR_QUEUED, {
            missileId: queueItem.missileId,
            batteryId: battery.id,
            trackId: engagementThreat.trackId,
            requestedBy: BATTERY_CONTROL_MODE.AUTO,
          });
          registry = buildEngagementRegistry({
            missiles: activeMissiles,
            pendingLaunches: nextPendingLaunches,
            launchQueue: finalLaunchQueue,
            gunEngagements: nextGunEngagements,
          });
          batteryUpdates.set(battery.id, {
            ...battery,
            autoStatus: AUTO_DEFENSE_STATUS.ENGAGING,
            recommendedTrackId: engagementThreat.trackId,
            assignedTrackId: engagementThreat.trackId,
            autoDecision: engagementPlan,
          });
        });
      batteriesWithScanFeedback = batteriesWithScanFeedback.map(battery => (
        batteryUpdates.get(battery.id) ?? battery
      ));
    }

    return {
      simulationTime: nextSimulationTime,
      batteries: batteriesWithScanFeedback,
      airTargets: survivingTargets,
      tracks: survivingTracks,
      sensorContacts: survivingSensorContacts,
      missiles: activeMissiles,
      launchQueue: finalLaunchQueue,
      pendingLaunches: nextPendingLaunches,
      gunEngagements: nextGunEngagements.filter(engagement => survivingTrackIds.has(engagement.trackId)),
      gunTracers: nextGunTracers,
      nextMissileSequence,
      nextAutoDecisionTime,
      autoEngagementAttempts: Object.fromEntries(
        Object.entries(nextAutoEngagementAttempts).filter(([key]) => (
          survivingTrackIds.has(key.slice(key.indexOf(':') + 1))
        )),
      ),
      nextTrackSequence,
      spawnedTargetIds: [...spawnedTargetIds],
      announcedGroupIds: [...announcedGroupIds],
      events: events.slice(-100),
      nextEventSequence,
      selectedTrackId: selectedTrackStillExists ? state.selectedTrackId : null,
      selectedMissileId: activeMissiles.some(missile => missile.id === state.selectedMissileId)
        ? state.selectedMissileId
        : null,
      selectedBatteryId: selectedTrackStillExists ? state.selectedBatteryId : null,
    };
  })
}));
