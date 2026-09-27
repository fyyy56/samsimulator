import { create } from 'zustand';
import { getInterceptorSpec } from '../data/interceptors.js';
import { getInterceptorSeekerProfile } from '../data/seekerProfiles.js';
import { LAUNCH_MODE } from '../data/launchProfiles.js';
import { getLaunchProfile } from './launchProfileStore.js';
import {
  beginSimulationUpdateProfile,
  createSimulationStageTimer,
  recordSimulationSubsystem,
  recordSimulationUpdate,
  recordVisualPublish,
  SIMULATION_SUBSYSTEM,
} from './performanceMonitor.js';
import { createWorldPosition, getWorldPosition } from './worldPosition.js';
import { isInterceptorCompatible } from '../data/weaponCompatibility.js';
import { getGunSystemSpec, WEAPON_SYSTEM_TYPE } from '../data/gunSystems.js';
import {
  getSearchRadarProfile,
  SEARCH_RADAR_ENTITY_TYPE,
  SEARCH_RADAR_PROFILE_IDS,
} from '../data/searchRadarProfiles.js';
import { advanceAirTarget, createAirTarget } from './airTargetSystem.js';
import {
  ENGAGEMENT_STATUS,
  getBatteryEngagementStatus,
  getOperationalLaunchers,
  hasRadarTrackPoint,
} from './engagement.js';
import { getBearing, getDestinationPoint, getDistanceKm, getSlantDistanceKm } from './geo.js';
import {
  createManualTargetDefinitions,
  createMassRaidScenario,
  createSandboxScenario,
  TEST_RAID_SCENARIO,
} from './scenarios.js';
import { createSimulationEvent, EVENT_TYPE } from './simulationEvents.js';
import { appendMissileLog } from './missileLog.js';
import {
  applyRadarObservation,
  applySensorEvidenceObservation,
  coastTrack,
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
import { SIMPLE_FLIGHT_PHASE } from './interceptorAltitudePhysics.js';
import {
  advanceVerticalLaunchDeparture,
  getInterceptorLaunchPhase,
  INTERCEPTOR_LAUNCH_PHASE,
} from './interceptorLaunch.js';
import { advanceColdLaunch, COLD_LAUNCH_PHASE } from './coldLaunch.js';
import { advanceTorManualGuidance } from './torManualSight.js';
import {
  advanceInterceptorGuidance,
  createInterceptorGuidance,
  INTERCEPTOR_FAILURE_REASON,
  INTERCEPTOR_GUIDANCE_STATE,
} from './interceptorGuidance.js';
import { advanceMissileSeeker, createMissileSeeker } from './seekerSystem.js';
import {
  advanceRadarScan,
  createRadarScanState,
  getNetworkRadarScanOpportunities,
  getRadarGeometry,
  RADAR_SCAN_TYPE,
} from './radarSystem.js';
import {
  AUTO_DEFENSE_STATUS,
  BATTERY_CONTROL_MODE,
  buildEngagementRegistry,
  DEFENSE_DOCTRINE,
  DOCTRINE_CONFIG,
  getInterceptorEngagementPolicy,
  rankThreatsForBattery,
} from './autoDefense.js';
import {
  evaluateInterceptFeasibility,
  INTERCEPT_FEASIBILITY,
} from './interceptFeasibility.js';
import { buildTargetDefenseAssessments } from './autoEngagementPlanner.js';
import {
  coordinateEngagements,
  DEFAULT_COORDINATOR_CAPABILITIES,
} from './engagementCoordinator.js';
import { didSweptPathsEnterRadiusMeters, getSweptClosestApproach } from './continuousCollision.js';
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
  getRadarSensorProfile,
  isRadarSensorOperational,
  isTrackSensorStale,
} from './sensorDetection.js';
import { createFireControlTargetEstimate, isAvailableNetworkTrack } from './trackDataProvider.js';
import {
  advanceControllableAirEntity,
  CONTROLLABLE_CAMERA_MODE,
  CONTROLLABLE_CONTROL_MODE,
  CONTROLLABLE_STATUS,
  createControllableAirEntity,
} from './controllableAirEntity.js';
import {
  CONTROLLABLE_AIR_PROFILE_IDS,
  getControllableAirProfile,
} from '../data/controllableAirProfiles.js';
import { getManualControlSnapshot, useManualControlStore } from './manualControlStore.js';
import { FPV_WARHEAD_RESULT, resolveFpvWarhead } from './fpvWarhead.js';

export { getBearing, getDistanceKm } from './geo.js';

const normalizeSignedHeading = value => ((value + 540) % 360) - 180;
const clampControl = value => Math.max(-1, Math.min(1, value));
const FPV_TRACK_COAST_SEC = 3;
const FPV_HANDOFF_DISTANCE_KM = 0.35;

const buildControllableNavigationInput = (entity, state, simulationTime) => {
  if (entity.controlMode === CONTROLLABLE_CONTROL_MODE.MANUAL) {
    return { entity, input: entity.id === state.controlledControllableEntityId
      ? getManualControlSnapshot(entity.id) : undefined };
  }
  let navigation = entity.navigation ?? {
    targetType: 'HOLD', heading: entity.heading, altitudeM: entity.altitudeM,
    speedMps: entity.speedMps, status: 'HOLDING',
  };
  let target;
  if (entity.controlMode === CONTROLLABLE_CONTROL_MODE.AUTO_NAV) {
    if (navigation.targetType === 'TRACK') {
      const track = state.tracks.find(candidate => candidate.id === navigation.trackId
        && isAvailableNetworkTrack(candidate));
      if (track?.reportedPosition) {
        target = { lat: track.reportedPosition.lat, lng: track.reportedPosition.lng };
        navigation = { ...navigation, lastKnownPosition: target,
          lastKnownAt: simulationTime, status: 'NAVIGATING' };
      } else if (navigation.lastKnownPosition
        && simulationTime - (navigation.lastKnownAt ?? -Infinity) <= FPV_TRACK_COAST_SEC) {
        target = navigation.lastKnownPosition;
        navigation = { ...navigation, status: 'TRACK COAST' };
      } else {
        const hold = { targetType: 'HOLD', heading: entity.heading,
          altitudeM: entity.altitudeM, speedMps: entity.speedMps, status: 'TRACK LOST' };
        return { entity: { ...entity, controlMode: CONTROLLABLE_CONTROL_MODE.HOLD,
          navigation: hold }, input: undefined };
      }
    } else target = navigation.waypoint;
    if (!target) {
      const hold = { targetType: 'HOLD', heading: entity.heading,
        altitudeM: entity.altitudeM, speedMps: entity.speedMps, status: 'NO WAYPOINT' };
      return { entity: { ...entity, controlMode: CONTROLLABLE_CONTROL_MODE.HOLD,
        navigation: hold }, input: undefined };
    }
    const distanceKm = getDistanceKm(entity.position.lat, entity.position.lng, target.lat, target.lng);
    if (distanceKm <= FPV_HANDOFF_DISTANCE_KM) {
      const hold = { targetType: 'HOLD', heading: entity.heading,
        altitudeM: entity.altitudeM, speedMps: entity.speedMps, status: 'READY MANUAL' };
      return { entity: { ...entity, controlMode: CONTROLLABLE_CONTROL_MODE.HOLD,
        navigation: hold }, input: undefined };
    }
    navigation = { ...navigation, heading: getBearing(entity.position.lat,
      entity.position.lng, target.lat, target.lng), altitudeM: navigation.altitudeM ?? entity.altitudeM,
      speedMps: navigation.speedMps ?? entity.speedMps, distanceKm };
  }
  const desiredHeading = navigation.heading ?? entity.heading;
  if (entity.controlMode === CONTROLLABLE_CONTROL_MODE.HOLD && navigation.waypoint) {
    const distanceKm = getDistanceKm(entity.position.lat, entity.position.lng,
      navigation.waypoint.lat, navigation.waypoint.lng);
    const bearingToHold = getBearing(entity.position.lat, entity.position.lng,
      navigation.waypoint.lat, navigation.waypoint.lng);
    navigation = { ...navigation,
      heading: distanceKm > 0.08 ? bearingToHold : (bearingToHold + 90) % 360,
      speedMps: Math.min(navigation.speedMps ?? entity.speedMps, 12),
      distanceKm };
  }
  const altitudeError = (navigation.altitudeM ?? entity.altitudeM) - entity.altitudeM;
  const speedError = (navigation.speedMps ?? entity.speedMps) - entity.speedMps;
  const previousThrottle = entity.controlState?.smoothedInput?.throttle ?? 0.55;
  const headingError = normalizeSignedHeading((navigation.heading ?? desiredHeading) - entity.heading);
  return { entity: { ...entity, navigation }, input: {
    throttle: Math.max(0, Math.min(1, previousThrottle + speedError / 80)),
    pitch: clampControl(altitudeError / 80),
    yaw: clampControl(headingError / 35),
    roll: clampControl(headingError / 55),
  } };
};

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

export const SYSTEM_CATALOG = Object.freeze({
  TOR_M1: Object.freeze({ type: 'Tor-M1', displayName: 'Tor-M1', weaponType: WEAPON_SYSTEM_TYPE.MISSILE,
    gunSpecId: null, radarRangeKm: 22, missilesLeft: 8, interceptorSpecId: 'INT-9M331-V1',
    scanRateSec: 1.2, radarBeamWidthDeg: 8, radarSector: 360,
    scanType: RADAR_SCAN_TYPE.MECHANICAL_ROTATION, deploymentStyle: 'SINGLE_UNIT' }),
  SHORT: Object.freeze({ type: 'IRIS-T SLM', displayName: 'IRIS-T SLM', weaponType: WEAPON_SYSTEM_TYPE.MISSILE, gunSpecId: null, radarRangeKm: 40, missilesLeft: 4, interceptorSpecId: 'INT-SHORT-V1', scanRateSec: 2.25, radarBeamWidthDeg: 7, radarSector: 360, scanType: RADAR_SCAN_TYPE.MECHANICAL_ROTATION }),
  MEDIUM: Object.freeze({ type: 'NASAMS', displayName: 'NASAMS', weaponType: WEAPON_SYSTEM_TYPE.MISSILE, gunSpecId: null, radarRangeKm: 80, missilesLeft: 6, interceptorSpecId: 'INT-MEDIUM-V1', scanRateSec: 2.0, radarBeamWidthDeg: 6, radarSector: 360, scanType: RADAR_SCAN_TYPE.MECHANICAL_ROTATION }),
  LONG: Object.freeze({ type: 'PATRIOT', displayName: 'Patriot', weaponType: WEAPON_SYSTEM_TYPE.MISSILE, gunSpecId: null, radarRangeKm: 150, missilesLeft: 16, interceptorSpecId: 'INT-LONG-V1', scanRateSec: 0.1, radarBeamWidthDeg: 5, radarSector: 120, scanType: RADAR_SCAN_TYPE.ELECTRONIC_SECTOR }),
  GUN: Object.freeze({ type: 'Gepard 1A2', displayName: 'Gepard 1A2', weaponType: WEAPON_SYSTEM_TYPE.GUN_AA, gunSpecId: 'GEPARD_1A2', radarRangeKm: 12, engagementRangeKm: 5, missilesLeft: 640, interceptorSpecId: null, scanRateSec: 1, radarBeamWidthDeg: 12, radarSector: 360, scanType: RADAR_SCAN_TYPE.MECHANICAL_ROTATION, deploymentStyle: 'SINGLE_UNIT' }),
  SAMP_T: Object.freeze({ type: 'SAMP/T', displayName: 'SAMP/T', weaponType: WEAPON_SYSTEM_TYPE.MISSILE, gunSpecId: null, radarType: 'SEARCH_ENGAGEMENT', radarBand: 'X_BAND_3CM', radarRangeKm: 80, radarElevationCoverageDeg: 95, radarTrackCapacity: 136, iffEnabled: true, missilesLeft: 8, interceptorSpecId: 'INT-ASTER30-V1', scanRateSec: 1, radarBeamWidthDeg: 6, radarSector: 360, scanType: RADAR_SCAN_TYPE.MECHANICAL_ROTATION }),
  GAZ: Object.freeze({ type: 'Humvee MBG', displayName: 'Humvee MBG', weaponType: WEAPON_SYSTEM_TYPE.GUN_AA, gunSpecId: 'GAZ_DSHK', radarRangeKm: 4, engagementRangeKm: 1.5, missilesLeft: 150, fpvInventory: getControllableAirProfile(CONTROLLABLE_AIR_PROFILE_IDS.SKYFALL_FPV).defaultInventory, interceptorSpecId: null, scanRateSec: 1.5, radarBeamWidthDeg: 18, radarSector: 360, scanType: RADAR_SCAN_TYPE.MECHANICAL_ROTATION, deploymentStyle: 'SINGLE_UNIT' }),
});

export const DEPLOYABLE_SYSTEM_IDS = Object.freeze([
  'LONG', 'MEDIUM', 'SHORT', 'SAMP_T', 'TOR_M1', 'GUN', 'GAZ',
]);
export { SEARCH_RADAR_PROFILE_IDS };

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
const getAutoDecisionIntervalSec = timeScale => (
  AUTO_DECISION_INTERVAL_SEC * Math.max(1, timeScale)
);
const normalizeHeadingDelta = degrees => ((degrees + 540) % 360) - 180;
const interpolateHeading = (from, to, progress) => (
  from + normalizeHeadingDelta(to - from) * Math.max(0, Math.min(1, progress)) + 360
) % 360;
export const PHYSICS_UPDATE_HZ = 20;
export const VISUAL_UPDATE_HZ = 30;
export const SENSOR_MODE = Object.freeze({
  IDEAL: 'IDEAL',
  REALISTIC: 'REALISTIC',
});
export const getAdaptiveVisualUpdateHz = activeObjectCount => (
  activeObjectCount >= 80 ? 15 : activeObjectCount >= 35 ? 20 : activeObjectCount >= 20 ? 24 : 30
);
export const getPhysicsSubstepCount = timeScale => (
  Math.max(1, Math.ceil(timeScale))
);
const getHeadingChangeDeg = (fromHeading, toHeading) => Math.abs(
  ((toHeading - fromHeading + 540) % 360) - 180,
);
const getDirectionChangeDeg = (fromHeading, toHeading, fromPitch = 0, toPitch = 0) => (
  Math.hypot(
    getHeadingChangeDeg(fromHeading, toHeading) * Math.cos(fromPitch * Math.PI / 180),
    toPitch - fromPitch,
  )
);
const createInterceptorVelocity = (speedKmh, heading, flightPathAngleDeg = 0) => {
  const speedMps = speedKmh / 3.6;
  const headingRad = heading * Math.PI / 180;
  const pitchRad = flightPathAngleDeg * Math.PI / 180;
  const horizontalSpeedMps = speedMps * Math.cos(pitchRad);
  return {
    speedKmh,
    heading,
    flightPathAngleDeg,
    horizontalSpeedMps,
    verticalSpeedMps: speedMps * Math.sin(pitchRad),
    eastMps: Math.sin(headingRad) * horizontalSpeedMps,
    northMps: Math.cos(headingRad) * horizontalSpeedMps,
    upMps: speedMps * Math.sin(pitchRad),
  };
};

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
    worldPosition: createWorldPosition(lat, lng, 0),
    velocity: { speedKmh: 0, heading: radarHeading },
    operational: true,
    ready: true,
    heading: radarHeading,
    launchState: LAUNCHER_VISUAL_STATE.READY,
    cooldownRemainingSec: 0,
    nextLaunchPointIndex: 0,
  });
  return {
    id: 'PATRIOT-01',
    category: 'LONG',
    type: template.type,
    displayName: template.displayName,
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
        worldPosition: createWorldPosition(radar.lat, radar.lng, 0),
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
  searchRadars: state.searchRadars,
  airTargets: state.airTargets,
  controllableAirEntities: state.controllableAirEntities,
  tracks: state.tracks,
  sensorContacts: state.sensorContacts,
  missiles: state.missiles,
  pendingLaunches: state.pendingLaunches,
  gunTracers: state.gunTracers,
  events: state.events,
  engagementAssignments: state.engagementAssignments,
  coordinatorMetrics: state.coordinatorMetrics,
  activeScenario: state.activeScenario,
});

const hasVisualSnapshotChanges = state => {
  const snapshot = state.visualSnapshot;
  return !snapshot
    || snapshot.simulationTime !== state.simulationTime
    || snapshot.batteries !== state.batteries
    || snapshot.searchRadars !== state.searchRadars
    || snapshot.airTargets !== state.airTargets
    || snapshot.controllableAirEntities !== state.controllableAirEntities
    || snapshot.tracks !== state.tracks
    || snapshot.sensorContacts !== state.sensorContacts
    || snapshot.missiles !== state.missiles
    || snapshot.pendingLaunches !== state.pendingLaunches
    || snapshot.gunTracers !== state.gunTracers
    || snapshot.events !== state.events
    || snapshot.engagementAssignments !== state.engagementAssignments
    || snapshot.coordinatorMetrics !== state.coordinatorMetrics
    || snapshot.activeScenario !== state.activeScenario;
};

const getQueuedCountForBattery = (launchQueue, batteryId) => (
  launchQueue.filter(item => item.sourceBatteryId === batteryId).length
);

const selectLauncherForQueue = (battery, track, launchQueue, pendingLaunches, preferredLauncherId = null) => {
  const operationalLaunchers = getOperationalLaunchers(battery);
  const preferredLauncher = preferredLauncherId
    ? operationalLaunchers.find(launcher => launcher.id === preferredLauncherId)
    : null;
  if (preferredLauncher) return preferredLauncher;
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
  preferredLauncherId = null,
}) => {
  if (!isInterceptorCompatible(battery, battery.interceptorSpecId)) return null;
  const launcher = selectLauncherForQueue(
    battery,
    track,
    state.launchQueue,
    state.pendingLaunches,
    preferredLauncherId,
  );
  if (!launcher) return null;
  const interceptorSpec = getInterceptorSpec(battery.interceptorSpecId);
  const interceptSolution = evaluateInterceptFeasibility({
    launcher,
    target,
    track,
    interceptorSpec,
  });
  if (interceptSolution.status === INTERCEPT_FEASIBILITY.NO_SOLUTION
    && requestedBy !== BATTERY_CONTROL_MODE.MANUAL) return null;
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
    manualOlsControl: false,
    queuedAt: simulationTime,
  };
};

// A manual optical shot has no target truth. This cue exists only to initialize
// the shared launch record; flight steering reads Tor's current sight instead.
const createTorSightCue = (sight, origin, simulationTime) => {
  const rangeKm = 0.5;
  const position = getDestinationPoint(origin.lat, origin.lng, sight?.azimuthDeg ?? 0, rangeKm);
  const altitudeM = Math.max(0, (origin.altitudeM ?? 0)
    + Math.tan((sight?.elevationDeg ?? 8) * Math.PI / 180) * rangeKm * 1000);
  const reportedPosition = { ...position, alt: altitudeM, altitudeM };
  return { track: { id: null, targetId: null, state: 'TRACKED', reportedPosition,
    reportedAltitudeM: altitudeM, reportedHeading: sight?.azimuthDeg ?? 0,
    reportedSpeedKmh: 0, lastUpdateTime: simulationTime },
  target: { id: null, position, worldPosition: createWorldPosition(position.lat,
    position.lng, altitudeM), altitudeM, speedKmh: 0 } };
};

const createLaunchedInterceptor = (pendingLaunch, track, simulationTime) => {
  const interceptorSpec = getInterceptorSpec(pendingLaunch.interceptorSpecId);
  const seekerProfile = getInterceptorSeekerProfile(pendingLaunch.interceptorSpecId);
  const launchProfile = pendingLaunch.launchProfile ?? getLaunchProfile(pendingLaunch.interceptorSpecId);
  const launchSpeedKmh = launchProfile.initialLaunchSpeedMps * 3.6;
  const worldPosition = createWorldPosition(
    pendingLaunch.lat,
    pendingLaunch.lng,
    pendingLaunch.altitudeM,
  );
  return {
    id: pendingLaunch.missileId,
    targetId: pendingLaunch.targetId,
    trackId: pendingLaunch.trackId,
    sourceBatteryId: pendingLaunch.sourceBatteryId,
    launcherId: pendingLaunch.launcherId,
    interceptorSpecId: pendingLaunch.interceptorSpecId,
    requestedBy: pendingLaunch.requestedBy,
    manualOlsControl: pendingLaunch.manualOlsControl,
    manualSightOnly: pendingLaunch.manualSightOnly ?? false,
    seekerProfileId: seekerProfile.id,
    seeker: createMissileSeeker(seekerProfile.id, simulationTime),
    lat: pendingLaunch.lat,
    lng: pendingLaunch.lng,
    position: { lat: pendingLaunch.lat, lng: pendingLaunch.lng, lon: pendingLaunch.lng },
    worldPosition,
    altitudeM: pendingLaunch.altitudeM,
    verticalSpeedMps: launchProfile.initialLaunchSpeedMps * Math.sin(
      (launchProfile.launchMode === LAUNCH_MODE.VERTICAL ? 90
        : launchProfile.launchTubeElevationDeg ?? 0) * Math.PI / 180),
    flightPathAngleDeg: launchProfile.launchMode === LAUNCH_MODE.VERTICAL
      ? 90 : launchProfile.launchTubeElevationDeg ?? 0,
    heading: pendingLaunch.heading,
    speedKmh: launchSpeedKmh,
    phase: launchProfile.coldLaunch ? INTERCEPTOR_PHASE.COAST : INTERCEPTOR_PHASE.POWERED,
    kinematicPhase: INTERCEPTOR_KINEMATIC_PHASE.BOOST,
    motorPhase: launchProfile.coldLaunch ? 'COLD' : 'BOOST',
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
    hitRadiusM: Math.min(
      interceptorSpec.gameplayPhysics.proximityFuseRadiusM,
      interceptorSpec.gameplayPhysics.minimumVisualContactDistanceM
        ?? interceptorSpec.gameplayPhysics.proximityFuseRadiusM,
    ),
    trajectory: [{ lat: pendingLaunch.lat, lng: pendingLaunch.lng, altitudeM: pendingLaunch.altitudeM }],
    velocity: createInterceptorVelocity(
      launchSpeedKmh,
      pendingLaunch.heading,
      launchProfile.launchMode === LAUNCH_MODE.VERTICAL
        ? 90 : launchProfile.launchTubeElevationDeg ?? 0,
    ),
    collisionGroup: 'FRIENDLY_INTERCEPTOR',
    collidesWith: ['HOSTILE_AIR_TARGET'],
    launchMode: launchProfile.launchMode,
    launchProfileId: launchProfile.id,
    launchPointId: pendingLaunch.launchPoint.id,
    launchPoint: { ...pendingLaunch.launchPoint },
    launchProfile,
    launchPhase: INTERCEPTOR_LAUNCH_PHASE.LAUNCH_EXIT,
    coldLaunchPhase: launchProfile.coldLaunch ? COLD_LAUNCH_PHASE.EJECT : null,
    motorIgnitedAtFlightTime: null,
    attitudeJetsActive: false,
    attitudeJetsIntensity: 0,
    attitudeJetsDurationSec: 0,
    launchWorldPosition: { ...worldPosition },
    pitchOverHeading: pendingLaunch.pitchOverHeading,
    pitchOverFlightPathAngleDeg: pendingLaunch.pitchOverFlightPathAngleDeg,
    initialLaunchHeading: pendingLaunch.heading,
    initialLaunchAccelerationMps2: launchProfile.initialLaunchAccelerationMps2,
    initialAccelerationDurationSec: launchProfile.initialAccelerationDurationSec,
    guidanceEnableDelaySec: Math.max(
      launchProfile.guidanceEnableDelaySec,
      launchProfile.initialTurnDelaySec ?? 0,
    ),
    guidanceEnabled: false,
    visualDepartureDurationSec: launchProfile.visualDepartureDurationSec,
    verticalDepartureDurationSec: launchProfile.verticalDepartureDurationSec,
    verticalDepartureVisualDistance: launchProfile.verticalDepartureVisualDistance,
    spriteRotationOffsetDeg: launchProfile.spriteRotationOffsetDeg,
    mirrorX: launchProfile.mirrorX,
    mirrorY: launchProfile.mirrorY,
    visualScale: launchProfile.visualScale,
    launchVisualRotationDeg: pendingLaunch.launchVisualRotationDeg,
  };
};

export const useEngine = create((set, get) => ({
  simulationTime: TEST_RAID_SCENARIO.startTimeSeconds,
  simulationProfile: { physicsLevel: 'BASIC', uiDetail: 'OPERATIONAL' },
  timeScale: 1,              
  sensorMode: SENSOR_MODE.REALISTIC,
  seekerEnabled: true,
  hoveredTrackId: null,   
  selectedTrackId: null,  
  selectedMissileId: null,
  selectedBatteryId: null,
  selectedSearchRadarId: null,
  selectedControllableEntityId: null,
  controlledControllableEntityId: null,
  nextBatterySequence: 1,
  nextSearchRadarSequence: 1,
  nextTrackSequence: 1,
  nextMissileSequence: 1,
  nextEventSequence: 1,
  nextManualTargetSequence: 1,
  nextControllableSequence: 1,
  nextAutoDecisionTime: TEST_RAID_SCENARIO.startTimeSeconds,
  globalControlMode: BATTERY_CONTROL_MODE.MANUAL,
  autoEngagementAttempts: {},
  torManualSight: {},
  engagementAssignments: {},
  coordinatorCapabilities: DEFAULT_COORDINATOR_CAPABILITIES,
  coordinatorMetrics: null,
  coordinatorEvaluationCursor: 0,
  coordinatorCandidateCache: {},
  
  batteries: [],
  searchRadars: [],
  airTargets: [],
  controllableAirEntities: [],
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
  missileLog: [],
  visualSnapshot: {
    simulationTime: TEST_RAID_SCENARIO.startTimeSeconds,
    batteries: [],
    searchRadars: [],
    airTargets: [],
    controllableAirEntities: [],
    tracks: [],
    sensorContacts: [],
    missiles: [],
    pendingLaunches: [],
    gunTracers: [],
    events: [],
    engagementAssignments: {},
    coordinatorMetrics: null,
    activeScenario: TEST_RAID_SCENARIO,
  },

  publishVisualSnapshot: () => {
    let published = false;
    set(state => {
      if (!hasVisualSnapshotChanges(state)) return {};
      published = true;
      return { visualSnapshot: createVisualSnapshot(state) };
    });
    if (published) recordVisualPublish();
  },

  deployPhase: null, draftBattery: null, buildMenuOpen: false, selectedCategory: null,
  
  toggleBuildMenu: () => set(state => ({ buildMenuOpen: !state.buildMenuOpen, selectedCategory: null })),
  setCategory: (cat) => set(state => ({ selectedCategory: state.selectedCategory === cat ? null : cat })),
  closeBuildMenu: () => set({ buildMenuOpen: false, selectedCategory: null }),

  startDeploy: (categoryKey) => {
    const searchRadarProfile = getSearchRadarProfile(categoryKey);
    const template = SYSTEM_CATALOG[categoryKey] ?? searchRadarProfile;
    if (!template) return;
    const state = get();
    if (searchRadarProfile) {
      const sequence = state.nextSearchRadarSequence;
      set({
        buildMenuOpen: false,
        selectedCategory: null,
        deployPhase: 'SEARCH_RADAR',
        nextSearchRadarSequence: sequence + 1,
        draftBattery: {
          id: `${searchRadarProfile.id}-${String(sequence).padStart(2, '0')}`,
          profileId: searchRadarProfile.id,
          entityType: SEARCH_RADAR_ENTITY_TYPE,
          capabilities: { radar: true, weapon: false },
          displayName: searchRadarProfile.displayName,
          englishName: searchRadarProfile.englishName,
          debugName: searchRadarProfile.debugName,
          status: 'ACTIVE', operational: true,
          sensorProfileId: searchRadarProfile.sensorProfileId,
          radarRangeKm: searchRadarProfile.nominalRangeKm,
          scanRateSec: searchRadarProfile.scanPeriodSec,
          radarBeamWidthDeg: searchRadarProfile.beamWidthDeg,
          radarScanType: searchRadarProfile.scanType,
          radarSector: searchRadarProfile.sectorDeg,
          radarHeading: 0,
          scanModeLabel: searchRadarProfile.scanModeLabel,
          radarDimension: searchRadarProfile.dimension,
          antennaHeightM: searchRadarProfile.antennaHeightM,
          components: { radar: null },
        },
      });
      return;
    }
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
        type: template.type, displayName: template.displayName, status: 'DEPLOYING',
        missilesLeft: template.missilesLeft, ammoCapacity: template.missilesLeft,
        fpvInventory: template.fpvInventory ?? 0,
        fpvCapacity: template.fpvInventory ?? 0,
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
        radarType: template.radarType ?? null,
        radarBand: template.radarBand ?? null,
        radarElevationCoverageDeg: template.radarElevationCoverageDeg ?? null,
        radarTrackCapacity: template.radarTrackCapacity ?? null,
        iffEnabled: template.iffEnabled ?? false,
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
    if (state.deployPhase === 'SEARCH_RADAR') {
      const radar = {
        id: `${draft.id}-SENSOR`, lat, lng, altitudeM: 0,
        position: { lat, lng, lon: lng },
        worldPosition: createWorldPosition(lat, lng, 0),
        velocity: { speedKmh: 0, heading: 0 },
        heading: 0, operational: true,
        antennaHeightM: draft.antennaHeightM,
        sensorProfileId: draft.sensorProfileId,
        scanState: createRadarScanState({
          sector: draft.radarSector,
          heading: 0,
          scanPeriodSec: draft.scanRateSec,
          beamWidthDeg: draft.radarBeamWidthDeg,
          scanType: draft.radarScanType,
        }),
      };
      const searchRadar = { ...draft, components: { radar } };
      set({
        searchRadars: [...state.searchRadars, searchRadar],
        deployPhase: null,
        draftBattery: null,
        selectedSearchRadarId: searchRadar.id,
        selectedBatteryId: null,
      });
      return;
    }
    if (state.deployPhase === 'UNIT') {
      const unit = {
        id: `${draft.id}-UNIT-1`,
        lat,
        lng,
        altitudeM: 0,
        position: { lat, lng, lon: lng },
        worldPosition: createWorldPosition(lat, lng, 0),
        velocity: { speedKmh: 0, heading: 0 },
        operational: true,
        ready: true,
        heading: 0,
        launchState: LAUNCHER_VISUAL_STATE.READY,
        cooldownRemainingSec: 0,
        nextLaunchPointIndex: 0,
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
        worldPosition: createWorldPosition(lat, lng, 0),
        velocity: { speedKmh: 0, heading: 0 },
      };
      nextPhase = 'RADAR';
    } else if (state.deployPhase === 'RADAR') {
      draft.components.radar = {
        lat,
        lng,
        altitudeM: 0,
        position: { lat, lng, lon: lng },
        worldPosition: createWorldPosition(lat, lng, 0),
        velocity: { speedKmh: 0, heading: 0 },
        heading: draft.radarHeading,
        radarType: draft.radarType,
        radarBand: draft.radarBand,
        elevationCoverageDeg: draft.radarElevationCoverageDeg,
        trackCapacity: draft.radarTrackCapacity,
        iffEnabled: draft.iffEnabled,
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
        worldPosition: createWorldPosition(lat, lng, 0),
        velocity: { speedKmh: 0, heading: 0 },
        operational: true,
        ready: true,
        heading: 0,
        launchState: LAUNCHER_VISUAL_STATE.READY,
        cooldownRemainingSec: 0,
        nextLaunchPointIndex: 0,
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
      selectedSearchRadarId: null,
      selectedControllableEntityId: null,
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
    if (id === null) return { selectedMissileId: null };
    const selectedMissileId = state.selectedMissileId === id ? null : id;
    return {
      selectedMissileId,
      selectedTrackId: null,
      selectedBatteryId: null,
      selectedSearchRadarId: null,
      selectedControllableEntityId: null,
    };
  }),
  setSelectedBattery: (id) => set({
    selectedBatteryId: id,
    selectedSearchRadarId: null,
    selectedControllableEntityId: null,
  }),
  setSelectedSearchRadar: (id) => set(state => ({
    selectedSearchRadarId: state.selectedSearchRadarId === id ? null : id,
    selectedBatteryId: null,
    selectedTrackId: null,
    selectedMissileId: null,
    selectedControllableEntityId: null,
  })),
  toggleSearchRadarOperational: (id) => set(state => {
    const searchRadars = state.searchRadars.map(radar => radar.id === id ? {
      ...radar,
      operational: !radar.operational,
      status: radar.operational ? 'OFFLINE' : 'ACTIVE',
      components: {
        ...radar.components,
        radar: { ...radar.components.radar, operational: !radar.operational },
      },
    } : radar);
    return {
      searchRadars,
      visualSnapshot: {
        ...state.visualSnapshot,
        searchRadars,
      },
    };
  }),
  clearSelection: () => set({ selectedTrackId: null, selectedMissileId: null,
    selectedBatteryId: null, selectedSearchRadarId: null, selectedControllableEntityId: null }),
  setTimeScale: (scale) => set({ timeScale: scale }),
  setTorManualSight: (batteryId, azimuthDeg, elevationDeg) => set(state => {
    const battery = state.batteries.find(item => item.id === batteryId);
    if (battery?.category !== 'TOR_M1') return {};
    const sensor = battery.components?.radar ?? battery.components?.fdc ?? battery;
    return { torManualSight: { ...state.torManualSight, [batteryId]: {
      azimuthDeg, elevationDeg, updatedAt: state.simulationTime,
      origin: { lat: sensor.lat ?? sensor.position?.lat,
        lng: sensor.lng ?? sensor.position?.lng,
        altitudeM: (sensor.altitudeM ?? 0) + 8 },
    } } };
  }),
  setSensorMode: (sensorMode) => set({
    sensorMode: sensorMode === SENSOR_MODE.IDEAL ? SENSOR_MODE.IDEAL : SENSOR_MODE.REALISTIC,
  }),
  toggleSensorMode: () => set(state => ({
    sensorMode: state.sensorMode === SENSOR_MODE.IDEAL
      ? SENSOR_MODE.REALISTIC
      : SENSOR_MODE.IDEAL,
  })),
  setSeekerEnabled: (seekerEnabled) => set({ seekerEnabled: Boolean(seekerEnabled) }),
  toggleSeekerEnabled: () => set(state => ({ seekerEnabled: !state.seekerEnabled })),
  configureSimulationProfile: (profile) => set({ simulationProfile: { ...profile } }),
  launchControllableEntity: ({
    sourceId = null,
    profileId = CONTROLLABLE_AIR_PROFILE_IDS.TEST_PLACEHOLDER,
    initialPosition,
    initialOrientation,
    selectedTrackId = null,
  }) => {
    const state = get();
    if (!initialPosition || !Number.isFinite(initialPosition.lat)
      || !Number.isFinite(initialPosition.lng)) return null;
    const id = `CTRL-${String(state.nextControllableSequence).padStart(3, '0')}`;
    const entity = createControllableAirEntity({
      id,
      profileId,
      sourceId,
      initialPosition,
      initialOrientation,
      selectedTrackId,
      simulationTime: state.simulationTime,
    });
    set({
      controllableAirEntities: [...state.controllableAirEntities, entity],
      nextControllableSequence: state.nextControllableSequence + 1,
      selectedControllableEntityId: id,
    });
    return id;
  },
  launchSkyfallFromMwg: (batteryId) => {
    const state = get();
    const battery = state.batteries.find(candidate => candidate.id === batteryId);
    const source = battery?.components?.launchers?.[0];
    if (!battery || battery.category !== 'GAZ' || !source || (battery.fpvInventory ?? 0) <= 0) {
      return null;
    }
    const profile = getControllableAirProfile(CONTROLLABLE_AIR_PROFILE_IDS.SKYFALL_FPV);
    const heading = source.heading ?? 0;
    const spawn = getDestinationPoint(
      source.lat,
      source.lng,
      heading,
      (profile.launch?.spawnOffsetM ?? 3) / 1000,
    );
    const id = state.launchControllableEntity({
      sourceId: battery.id,
      profileId: CONTROLLABLE_AIR_PROFILE_IDS.SKYFALL_FPV,
      initialPosition: {
        lat: spawn.lat,
        lng: spawn.lng,
        altitudeM: profile.launch?.spawnAltitudeM ?? 2,
      },
      initialOrientation: { heading, pitch: 90, roll: 0 },
      selectedTrackId: state.selectedTrackId,
    });
    if (!id) return null;
    set(current => ({
      batteries: current.batteries.map(candidate => candidate.id === batteryId
        ? { ...candidate, fpvInventory: Math.max(0, (candidate.fpvInventory ?? 0) - 1) }
        : candidate),
      nextEventSequence: current.nextEventSequence + 1,
      events: [...current.events, createSimulationEvent(
        current.nextEventSequence,
        EVENT_TYPE.CONTROLLABLE_LAUNCHED,
        current.simulationTime,
        { entityId: id, batteryId, profileId: CONTROLLABLE_AIR_PROFILE_IDS.SKYFALL_FPV },
      )].slice(-120),
    }));
    return id;
  },
  spawnControllableTestEntity: () => {
    const state = get();
    const anchor = state.batteries[0]?.components?.launchers?.[0]
      ?? { lat: 50.4501, lng: 30.5234 };
    return state.launchControllableEntity({
      profileId: CONTROLLABLE_AIR_PROFILE_IDS.TEST_PLACEHOLDER,
      initialPosition: { lat: anchor.lat, lng: anchor.lng, altitudeM: 180 },
      initialOrientation: { heading: 45, pitch: 3, roll: 0, speedMps: 18 },
      selectedTrackId: state.selectedTrackId,
    });
  },
  setSelectedControllableEntity: id => set(state => ({
    // Transfer the user's COMMAND track selection before clearing the map selection.
    controllableAirEntities: state.controllableAirEntities.map(entity => entity.id === id
      && state.tracks.some(track => track.id === state.selectedTrackId && isAvailableNetworkTrack(track))
      ? { ...entity, selectedTrackId: state.selectedTrackId } : entity),
    selectedControllableEntityId: state.controllableAirEntities.some(entity => entity.id === id)
      ? id
      : null,
    selectedTrackId: null,
    selectedMissileId: null,
    selectedBatteryId: null,
    selectedSearchRadarId: null,
  })),
  setControlledControllableEntity: id => {
    const state = get();
    const entity = state.controllableAirEntities.find(candidate => candidate.id === id
      && candidate.status === CONTROLLABLE_STATUS.ACTIVE);
    useManualControlStore.getState().release();
    if (!entity) {
      set({ controlledControllableEntityId: null });
      return false;
    }
    useManualControlStore.getState().claim(id);
    set({ controlledControllableEntityId: id, selectedControllableEntityId: id });
    return true;
  },
  releaseControllableControl: () => {
    useManualControlStore.getState().release();
    set({ controlledControllableEntityId: null });
  },
  setControllableCameraMode: (id, cameraMode) => set(state => ({
    controllableAirEntities: state.controllableAirEntities.map(entity => entity.id === id
      ? { ...entity, cameraMode: Object.values(CONTROLLABLE_CAMERA_MODE).includes(cameraMode)
        ? cameraMode
        : entity.cameraMode }
      : entity),
  })),
  setControllableControlMode: (id, controlMode) => set(state => ({
    controllableAirEntities: state.controllableAirEntities.map(entity => {
      if (entity.id !== id || !Object.values(CONTROLLABLE_CONTROL_MODE).includes(controlMode)) return entity;
      const navigation = controlMode === CONTROLLABLE_CONTROL_MODE.HOLD
        ? { targetType: 'HOLD', heading: entity.heading, altitudeM: entity.altitudeM,
          speedMps: entity.speedMps, waypoint: { ...entity.position }, status: 'HOLDING' }
        : entity.navigation;
      return { ...entity, controlMode, navigation };
    }),
  })),
  setControllableNavigationWaypoint: (id, waypoint) => set(state => ({
    controllableAirEntities: state.controllableAirEntities.map(entity => entity.id === id
      && Number.isFinite(waypoint?.lat) && Number.isFinite(waypoint?.lng)
      ? { ...entity, controlMode: CONTROLLABLE_CONTROL_MODE.AUTO_NAV,
        navigation: { targetType: 'WAYPOINT', waypoint: { lat: waypoint.lat, lng: waypoint.lng },
          altitudeM: entity.altitudeM, speedMps: entity.speedMps, status: 'NAVIGATING' } }
      : entity),
  })),
  setControllableNavigationTrack: (id, trackId) => set(state => ({
    controllableAirEntities: state.controllableAirEntities.map(entity => {
      const track = state.tracks.find(candidate => candidate.id === trackId
        && isAvailableNetworkTrack(candidate));
      if (entity.id !== id || !track?.reportedPosition) return entity;
      return { ...entity, selectedTrackId: track.id,
        controlMode: CONTROLLABLE_CONTROL_MODE.AUTO_NAV,
        navigation: { targetType: 'TRACK', trackId: track.id,
          lastKnownPosition: { lat: track.reportedPosition.lat, lng: track.reportedPosition.lng },
          lastKnownAt: state.simulationTime, altitudeM: entity.altitudeM,
          speedMps: entity.speedMps, status: 'NAVIGATING' } };
    }),
  })),
  setControllableSelectedTrack: (id, trackId) => set(state => ({
    controllableAirEntities: state.controllableAirEntities.map(entity => entity.id === id
      ? {
        ...entity,
        selectedTrackId: trackId && state.tracks.some(track => track.id === trackId && isAvailableNetworkTrack(track))
          ? trackId
          : null,
      }
      : entity),
  })),
  destroyControllableEntity: id => {
    const state = get();
    if (!state.controllableAirEntities.some(entity => entity.id === id)) return false;
    if (state.controlledControllableEntityId === id) {
      useManualControlStore.getState().release(id);
    }
    set({
      controllableAirEntities: state.controllableAirEntities.filter(entity => entity.id !== id),
      controlledControllableEntityId: state.controlledControllableEntityId === id
        ? null : state.controlledControllableEntityId,
      selectedControllableEntityId: state.selectedControllableEntityId === id
        ? null : state.selectedControllableEntityId,
    });
    return true;
  },
  resetScenario: (scenarioMode = 'SIMPLE', scenarioOverride = null) => {
    useManualControlStore.getState().release();
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
    sensorMode: SENSOR_MODE.REALISTIC,
    seekerEnabled: true,
    selectedTrackId: null,
    selectedMissileId: null,
    selectedBatteryId: null,
    selectedSearchRadarId: null,
    selectedControllableEntityId: null,
    controlledControllableEntityId: null,
    nextBatterySequence: initialBatteries.length + 1,
    nextSearchRadarSequence: 1,
    nextTrackSequence: 1,
    nextMissileSequence: 1,
    nextEventSequence: 1,
    nextManualTargetSequence: 1,
    nextControllableSequence: 1,
    nextAutoDecisionTime: scenario.startTimeSeconds,
    globalControlMode: initialControlMode,
    autoEngagementAttempts: {},
    torManualSight: {},
    engagementAssignments: {},
    coordinatorCapabilities: DEFAULT_COORDINATOR_CAPABILITIES,
    coordinatorMetrics: null,
    coordinatorEvaluationCursor: 0,
    coordinatorCandidateCache: {},
    batteries: initialBatteries,
    searchRadars: [],
    airTargets: [],
    controllableAirEntities: [],
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
    missileLog: [],
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
    const targetMetadata = state.airTargets.find(candidate => candidate.id === track?.targetId);
    const target = createFireControlTargetEstimate(track, targetMetadata, state.simulationTime);
    const selectedBattery = state.batteries.find(candidate => candidate.id === batteryId);
    if (!selectedBattery) return;
    if (selectedBattery.controlMode === BATTERY_CONTROL_MODE.HOLD) return;
    if (requestedBy === BATTERY_CONTROL_MODE.MANUAL
      && selectedBattery.controlMode !== BATTERY_CONTROL_MODE.MANUAL) return;
    if (!track || !target) return;
    if (requestedBy === BATTERY_CONTROL_MODE.MANUAL
      && selectedBattery.weaponType !== WEAPON_SYSTEM_TYPE.GUN_AA
      && !hasRadarTrackPoint(track)) return;
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
      requestedBy !== BATTERY_CONTROL_MODE.MANUAL
      && getBatteryEngagementStatus(selectedBattery, track, target) !== ENGAGEMENT_STATUS.READY
    ) return;
    if (getOperationalLaunchers(selectedBattery).length === 0) return;
    if (selectedBattery.missilesLeft - getQueuedCountForBattery(state.launchQueue, batteryId) <= 0) return;
    const registry = buildEngagementRegistry(state);
    if (
      requestedBy === BATTERY_CONTROL_MODE.ASSIST
      && state.coordinatorCapabilities.coordinatedEngagements
      && (registry.get(trackId)?.total ?? 0) > 0
    ) return;
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
    if (!rankedThreat && requestedBy !== BATTERY_CONTROL_MODE.MANUAL) return;
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

  queueTorManualSight: (batteryId, lockedTrackId = null) => {
    const state = get();
    const battery = state.batteries.find(item => item.id === batteryId);
    const launcher = battery?.components?.launchers?.find(item => item.operational !== false
      && item.ready !== false && !state.pendingLaunches.some(p => p.launcherId === item.id)
      && !state.launchQueue.some(q => q.launcherId === item.id));
    if (battery?.category !== 'TOR_M1' || battery.controlMode !== BATTERY_CONTROL_MODE.MANUAL
      || battery.missilesLeft <= 0 || battery.reloadRemainingSec > 0 || !launcher) return null;
    const sight = state.torManualSight[batteryId];
    if (!sight) return null;
    const missileId = `MSL-${state.nextMissileSequence.toString().padStart(3, '0')}`;
    const queueItem = { id: `QUEUE-${missileId}`, missileId, targetId: null, trackId: null,
      lockedTrackId, sourceBatteryId: batteryId, launcherId: launcher.id,
      interceptorSpecId: battery.interceptorSpecId,
      requestedBy: BATTERY_CONTROL_MODE.MANUAL, manualOlsControl: true,
      manualSightOnly: true, queuedAt: state.simulationTime };
    set({ launchQueue: [...state.launchQueue, queueItem],
      nextMissileSequence: state.nextMissileSequence + 1,
      nextEventSequence: state.nextEventSequence + 1,
      events: [...state.events, createSimulationEvent(state.nextEventSequence,
        EVENT_TYPE.INTERCEPTOR_QUEUED, state.simulationTime,
        { missileId, batteryId, trackId: null, requestedBy: BATTERY_CONTROL_MODE.MANUAL })].slice(-120),
    });
    return missileId;
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

  tick: (substepDivisor = 1) => {
    const updateStartedAt = globalThis.performance?.now?.() ?? Date.now();
    let updated = false;
    let updateCalculationMs = 0;
    set((state) => {
    if (state.timeScale === 0) return {};
    updated = true;
    beginSimulationUpdateProfile();
    const calculationStartedAt = globalThis.performance?.now?.() ?? Date.now();
    const checkpoint = createSimulationStageTimer();
    const deltaTimeSec = (1 / PHYSICS_UPDATE_HZ) * state.timeScale
      / Math.max(0.1, substepDivisor);
    
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
    const updatedSearchRadars = state.searchRadars.map(searchRadar => {
      const radar = searchRadar.components.radar;
      return {
        ...searchRadar,
        components: {
          ...searchRadar.components,
          radar: radar ? {
            ...radar,
            scanState: advanceRadarScan(
              radar.scanState,
              deltaTimeSec,
              searchRadar.radarSector,
              searchRadar.radarHeading,
            ),
          } : null,
        },
      };
    });
    checkpoint(SIMULATION_SUBSYSTEM.RADAR);

    const nextSimulationTime = state.simulationTime + deltaTimeSec;
    let updatedControllableAirEntities = state.controllableAirEntities.map(entity => {
      const navigation = buildControllableNavigationInput(entity, state, nextSimulationTime);
      return advanceControllableAirEntity(navigation.entity, deltaTimeSec, navigation.input);
    });
    const controlledControllableStillActive = updatedControllableAirEntities.some(
      entity => entity.id === state.controlledControllableEntityId
        && entity.status === CONTROLLABLE_STATUS.ACTIVE,
    );
    let nextEventSequence = state.nextEventSequence;
    let events = [...state.events];
    let missileLog = state.missileLog ?? [];
    const emitEvent = (type, details) => {
      const event = createSimulationEvent(nextEventSequence++, type, nextSimulationTime, details);
      events.push(event);
      missileLog = appendMissileLog(missileLog, event);
    };

    updatedControllableAirEntities = updatedControllableAirEntities.map(entity => {
      const previous = state.controllableAirEntities.find(candidate => candidate.id === entity.id);
      if (previous && previous.status !== CONTROLLABLE_STATUS.CRASHED
        && entity.status === CONTROLLABLE_STATUS.CRASHED) {
        emitEvent(EVENT_TYPE.CONTROLLABLE_CRASHED, {
          entityId: entity.id,
          batteryId: entity.launchSourceId,
          position: { ...entity.position },
          altitudeM: 0,
        });
        return { ...entity, terminalAt: nextSimulationTime };
      }
      return entity;
    });

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
        const ignitionVisualLeadSec = Math.min(0.2, ignitionDurationSec);
        const rotationComplete = elapsedSec >= rotationDurationSec;
        const phase = !rotationComplete
          ? LAUNCHER_VISUAL_STATE.ROTATING
          : (elapsedSec >= launchReadyAt - ignitionVisualLeadSec
            ? LAUNCHER_VISUAL_STATE.LAUNCHING
            : LAUNCHER_VISUAL_STATE.TRACKING);
        const visualHeading = interpolateHeading(
          pendingLaunch.launcherStartHeading ?? pendingLaunch.launcherHeading,
          pendingLaunch.launcherHeading,
          rotationDurationSec > 0 ? elapsedSec / rotationDurationSec : 1,
        );
        nextPendingLaunches.push({ ...pendingLaunch, elapsedSec, phase });
        launcherStates.set(pendingLaunch.launcherId, {
          state: phase,
          ready: false,
          heading: visualHeading,
        });
        return;
      }

      const track = state.tracks.find(candidate => candidate.id === pendingLaunch.trackId);
      const targetAvailable = state.airTargets.some(candidate => candidate.id === pendingLaunch.targetId);
      if (pendingLaunch.manualSightOnly || (track && targetAvailable)) {
        const launchTrack = pendingLaunch.manualSightOnly
          ? createTorSightCue(state.torManualSight[pendingLaunch.sourceBatteryId],
            pendingLaunch.worldPosition, nextSimulationTime).track
          : track;
        newlyLaunchedMissiles.push(createLaunchedInterceptor(pendingLaunch, launchTrack, nextSimulationTime));
        emitEvent(EVENT_TYPE.INTERCEPTOR_LAUNCHED, {
          missileId: pendingLaunch.missileId,
          trackId: pendingLaunch.trackId,
          batteryId: pendingLaunch.sourceBatteryId,
          launcherId: pendingLaunch.launcherId,
        });
        emitEvent(EVENT_TYPE.MISSILE_PHASE, { missileId: pendingLaunch.missileId,
          phase: pendingLaunch.interceptorSpecId === 'INT-9M331-V1' ? 'COLD' : 'BOOST' });
        if (pendingLaunch.manualOlsControl) {
          emitEvent(EVENT_TYPE.MISSILE_PHASE, { missileId: pendingLaunch.missileId,
            phase: 'MANUAL_CONTROL' });
        }
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
        heading: pendingLaunch.launcherHeading,
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
                heading: visualState.heading ?? launcher.heading,
                velocity: {
                  ...launcher.velocity,
                  heading: visualState.heading ?? launcher.velocity?.heading ?? launcher.heading,
                },
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
      if (!battery || !launcher || (!queueItem.manualSightOnly
        && (!track || !targetAvailable))) {
        emitEvent(EVENT_TYPE.ENGAGEMENT_CANCELLED, {
          batteryId: queueItem.sourceBatteryId,
          trackId: queueItem.trackId,
          reason: 'TARGET_UNAVAILABLE',
        });
        return;
      }
      if (!isInterceptorCompatible(battery, queueItem.interceptorSpecId)) {
        emitEvent(EVENT_TYPE.ENGAGEMENT_CANCELLED, {
          batteryId: queueItem.sourceBatteryId,
          trackId: queueItem.trackId,
          reason: 'INCOMPATIBLE_INTERCEPTOR',
        });
        return;
      }
      if (!launcher.ready || battery.missilesLeft <= 0 || battery.reloadRemainingSec) {
        launchQueue.push(queueItem);
        return;
      }

      const targetMetadata = state.airTargets.find(candidate => candidate.id === queueItem.targetId);
      const sightCue = queueItem.manualSightOnly ? createTorSightCue(
        state.torManualSight[queueItem.sourceBatteryId], getWorldPosition(launcher),
        state.simulationTime) : null;
      const launchTrack = sightCue?.track ?? track;
      const target = sightCue?.target
        ?? createFireControlTargetEstimate(track, targetMetadata, state.simulationTime);
      if (!target) return;
      const interceptorSpec = getInterceptorSpec(queueItem.interceptorSpecId);
      const interceptSolution = queueItem.manualSightOnly
        ? { status: INTERCEPT_FEASIBILITY.VALID, predictedInterceptPoint: launchTrack.reportedPosition,
          interceptBearingDeg: state.torManualSight[queueItem.sourceBatteryId]?.azimuthDeg ?? 0 }
        : evaluateInterceptFeasibility({ launcher, target, track, interceptorSpec });
      if (!queueItem.manualSightOnly
        && queueItem.requestedBy !== BATTERY_CONTROL_MODE.MANUAL
        && interceptSolution.status === INTERCEPT_FEASIBILITY.NO_SOLUTION) {
        emitEvent(EVENT_TYPE.ENGAGEMENT_CANCELLED, {
          batteryId: queueItem.sourceBatteryId,
          trackId: queueItem.trackId,
          reason: interceptSolution.reason,
        });
        return;
      }

      const launchProfile = getLaunchProfile(queueItem.interceptorSpecId);
      const interceptorPhysics = interceptorSpec.gameplayPhysics;
      const launchPointIndex = 0;
      const launchPoint = launchProfile.launchPoints[0];
      const manualSight = queueItem.manualOlsControl
        ? state.torManualSight[queueItem.sourceBatteryId] : null;
      const interceptBearing = manualSight?.azimuthDeg ?? (queueItem.manualOlsControl
        ? launcher.heading ?? 0 : interceptSolution.interceptBearingDeg ?? getBearing(
        launcher.lat,
        launcher.lng,
        track.reportedPosition.lat,
        track.reportedPosition.lng,
      ));
      const predictedInterceptPoint = interceptSolution.predictedInterceptPoint
        ?? launchTrack.reportedPosition;
      const predictedInterceptAltitudeM = predictedInterceptPoint.altitudeM
        ?? predictedInterceptPoint.alt
        ?? launchTrack.reportedPosition.altitudeM
        ?? launchTrack.reportedPosition.alt
        ?? 0;
      const predictedHorizontalDistanceM = getDistanceKm(
        launcher.lat,
        launcher.lng,
        predictedInterceptPoint.lat,
        predictedInterceptPoint.lng,
      ) * 1000;
      const pitchOverFlightPathAngleDeg = queueItem.manualOlsControl
        ? manualSight?.elevationDeg ?? 8 : Math.atan2(
        predictedInterceptAltitudeM - (launcher.altitudeM ?? 0),
        Math.max(predictedHorizontalDistanceM, 1),
      ) * 180 / Math.PI;
      const launchDirectionWorldOffsetDeg = (
        launchProfile.launcherSpriteRotationOffsetDeg
        + launchPoint.launchDirectionOffsetDeg
      );
      const launcherStartHeading = launcher.heading ?? 0;
      const launcherHeading = launchProfile.launchMode === LAUNCH_MODE.VERTICAL
        ? launcher.heading ?? 0
        : (interceptBearing - launchDirectionWorldOffsetDeg + 360) % 360;
      const rotationAngleDeg = launchProfile.launchMode === LAUNCH_MODE.VERTICAL
        ? 0
        : Math.abs(normalizeHeadingDelta(launcherHeading - launcherStartHeading));
      const rotationDurationSec = launchProfile.launchMode === LAUNCH_MODE.VERTICAL
        ? 0
        : rotationAngleDeg / Math.max(
          1,
          interceptorPhysics.launcherRotationRateDegPerSec ?? 45,
        );
      const launcherWorldPosition = getWorldPosition(launcher);
      const launchHeading = ((
        launchProfile.launchMode === LAUNCH_MODE.VERTICAL
          ? interceptBearing
          : launcherHeading + launchDirectionWorldOffsetDeg
      ) + 360) % 360;
      nextPendingLaunches.push({
        ...queueItem,
        id: `PREP-${queueItem.missileId}`,
        lat: launcherWorldPosition.lat,
        lng: launcherWorldPosition.lng,
        altitudeM: launcherWorldPosition.altitudeM + (launchProfile.launchPointAltitudeM ?? 0),
        worldPosition: { ...launcherWorldPosition,
          altitudeM: launcherWorldPosition.altitudeM + (launchProfile.launchPointAltitudeM ?? 0) },
        heading: launchHeading,
        pitchOverHeading: interceptBearing,
        pitchOverFlightPathAngleDeg,
        launcherHeading,
        launcherStartHeading,
        launchPoint,
        launchPointIndex,
        launchProfile,
        launchVisualRotationDeg: launcherHeading + launchProfile.launcherSpriteRotationOffsetDeg,
        interceptSolution,
        rotationDurationSec,
        ignitionDurationSec: queueItem.manualOlsControl ? 0 : launchProfile.preLaunchDelaySec,
        phase: rotationDurationSec > 0.01
          ? LAUNCHER_VISUAL_STATE.ROTATING
          : LAUNCHER_VISUAL_STATE.TRACKING,
        launchPhase: INTERCEPTOR_LAUNCH_PHASE.PRE_LAUNCH,
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
                heading: launcherStartHeading,
                nextLaunchPointIndex: 0,
                launchState: rotationDurationSec > 0.01
                  ? LAUNCHER_VISUAL_STATE.ROTATING
                  : LAUNCHER_VISUAL_STATE.TRACKING,
                velocity: {
                  ...candidateLauncher.velocity,
                  heading: launcherStartHeading,
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
    checkpoint(SIMULATION_SUBSYSTEM.ENGAGEMENT);

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
    checkpoint(SIMULATION_SUBSYSTEM.SCENARIO);

    const previousTargetsById = new Map(targetsWithSpawns.map(target => [target.id, target]));
    const advancedTargets = targetsWithSpawns.map(target => advanceAirTarget(target, deltaTimeSec));
    advancedTargets
      .filter(target => target.state === 'COMPLETED')
      .forEach(target => emitEvent(EVENT_TYPE.TARGET_ESCAPED, {
        targetId: target.id,
        impactPoint: target.ballisticPhysics?.impactPoint ?? null,
        impactErrorMeters: target.ballisticPhysics?.impactErrorMeters ?? null,
        ballisticMiss: target.ballisticPhysics?.ballisticMiss ?? false,
      }));
    let updatedTargets = advancedTargets.filter(target => target.state === 'ALIVE');
    const updatedTargetsById = new Map(updatedTargets.map(target => [target.id, target]));
    checkpoint(SIMULATION_SUBSYSTEM.TARGET_KINEMATICS);

    let nextTrackSequence = state.nextTrackSequence;
    const tracksByTargetId = new Map(state.tracks.map(track => [track.targetId, track]));
    const updatedTracks = [];
    let sensorContacts = ageSensorEvidenceContacts(
      state.sensorContacts ?? [],
      nextSimulationTime,
      deltaTimeSec,
    );
    const operationalNetworkRadars = [...updatedBatteries, ...updatedSearchRadars]
      .filter(isRadarSensorOperational);
    const operationalSourceIds = new Set(operationalNetworkRadars.map(radar => radar.id));
    updatedTargets.forEach(target => {
      const existingTrack = tracksByTargetId.get(target.id);
      const scanOpportunities = state.sensorMode === SENSOR_MODE.REALISTIC
        ? getNetworkRadarScanOpportunities(
          operationalNetworkRadars,
          target,
          getRadarSensorProfile,
        )
        : [];

      let observation = null;
      if (state.sensorMode === SENSOR_MODE.IDEAL) {
        const trackId = existingTrack ? existingTrack.id : formatTrackId(nextTrackSequence++);
        observation = applyRadarObservation({
          existingTrack,
          target,
          sourceBatteryId: 'IDEAL-SENSOR',
          simulationTime: nextSimulationTime,
          trackId,
        });
      } else if (scanOpportunities.length > 0) {
        const scanResult = applySensorScanBatch({
          contacts: sensorContacts,
          activeSourceIds: operationalSourceIds,
          target,
          scanOpportunities,
          simulationTime: nextSimulationTime,
          existingTrack,
        });
        sensorContacts = scanResult.contacts;
        observation = scanResult.observation;
      }

      if (observation) {
        const trackId = existingTrack
          ? existingTrack.id
          : (state.sensorMode === SENSOR_MODE.IDEAL
            ? observation.id
            : formatTrackId(nextTrackSequence++));
        const observedTrack = state.sensorMode === SENSOR_MODE.IDEAL
          ? observation
          : applySensorEvidenceObservation({
            existingTrack,
            target,
            observation,
            simulationTime: nextSimulationTime,
            trackId,
          });
        updatedTracks.push(observedTrack);
        if (existingTrack?.sourceRadarId && observedTrack.sourceRadarId
          && existingTrack.sourceRadarId !== observedTrack.sourceRadarId) {
          emitEvent(EVENT_TYPE.TRACK_SOURCE_HANDOFF, {
            trackId: observedTrack.id,
            targetId: target.id,
            fromSensorId: existingTrack.sourceRadarId,
            toSensorId: observedTrack.sourceRadarId,
            sourceScore: observedTrack.bestSensorScore,
          });
        }
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
      // The last measurement owner is not the entire network. Leaving its
      // coverage must not erase a still-coasting estimate in another radar's
      // coverage. This neither refreshes its age nor creates a measurement.
      const hasNetworkCoverage = operationalNetworkRadars.some(battery => {
        const geometry = getRadarGeometry(battery, target, getRadarSensorProfile(battery));
        return geometry.insideNominalCoverage && geometry.hasLineOfSight;
      });
      if (!hasNetworkCoverage) {
        const lostTrack = updateLostTrack(existingTrack, nextSimulationTime, deltaTimeSec);
        if (lostTrack) updatedTracks.push(lostTrack);
        return;
      }
      if (!isTrackSensorStale(existingTrack, nextSimulationTime)) {
        updatedTracks.push(coastTrack(existingTrack, nextSimulationTime, deltaTimeSec));
        return;
      }

      const lostTrack = updateLostTrack(existingTrack, nextSimulationTime, deltaTimeSec);
      if (lostTrack) updatedTracks.push(lostTrack);
    });
    const updatedTracksById = new Map(updatedTracks.map(track => [track.id, track]));
    checkpoint(SIMULATION_SUBSYSTEM.TRACK);

    let batteriesWithScanFeedback = updatedBatteries;
    let nextGunEngagements = [];
    let nextGunTracers = (state.gunTracers ?? []).filter(tracer => (
      nextSimulationTime <= tracer.startTime + tracer.flightDurationSec + 0.18
    ));
    const gunInterceptedTargetIds = new Set();
    (state.gunEngagements ?? []).forEach(engagement => {
      const battery = batteriesWithScanFeedback.find(candidate => candidate.id === engagement.batteryId);
      const track = updatedTracksById.get(engagement.trackId);
      const physicalTarget = updatedTargetsById.get(engagement.targetId);
      const target = createFireControlTargetEstimate(track, physicalTarget, nextSimulationTime);
      const gunSpec = getGunSystemSpec(battery?.gunSpecId);
      if (!battery || !track || !target || !physicalTarget || !gunSpec) return;

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
    checkpoint(SIMULATION_SUBSYSTEM.ENGAGEMENT);

    const activeMissiles = [];
    const interceptedTargetIds = new Set(gunInterceptedTargetIds);
    const damagedTargets = new Map();
    const previousControllablesById = new Map(
      state.controllableAirEntities.map(entity => [entity.id, entity]),
    );
    updatedControllableAirEntities = updatedControllableAirEntities.map(entity => {
      if (entity.status !== CONTROLLABLE_STATUS.ACTIVE
        || entity.profileId !== CONTROLLABLE_AIR_PROFILE_IDS.SKYFALL_FPV) return entity;
      const previous = previousControllablesById.get(entity.id) ?? entity;
      const profile = getControllableAirProfile(entity.profileId);
      const proximityRadiusM = profile.warhead?.proximityRadiusM ?? entity.collisionRadiusM;
      const candidates = updatedTargets.filter(target => !interceptedTargetIds.has(target.id))
        .map(target => {
        const previousTarget = previousTargetsById.get(target.id) ?? target;
        const approach = getSweptClosestApproach({
          interceptorStart: getWorldPosition(previous),
          interceptorEnd: getWorldPosition(entity),
          targetStart: getWorldPosition(previousTarget),
          targetEnd: getWorldPosition(target),
        });
        return { target, approach, closestApproachM: approach.closestDistanceKm * 1000 };
        })
        .filter(candidate => candidate.closestApproachM <= proximityRadiusM)
        .sort((first, second) => first.closestApproachM - second.closestApproachM
          || first.target.id.localeCompare(second.target.id));
      const candidate = candidates[0];
      if (!candidate) return entity;
      const collisionTarget = candidate.target;
      const visualCollision = candidate.approach;
      const warheadResult = resolveFpvWarhead({
        closestApproachM: candidate.closestApproachM,
        directContact: candidate.closestApproachM <= entity.collisionRadiusM,
        profile: profile.warhead,
      });
      if (!warheadResult.detonated) return entity;
      if (warheadResult.outcome === FPV_WARHEAD_RESULT.DESTROYED) {
        interceptedTargetIds.add(collisionTarget.id);
      } else if (warheadResult.outcome === FPV_WARHEAD_RESULT.DAMAGED) {
        damagedTargets.set(collisionTarget.id, warheadResult);
        emitEvent(EVENT_TYPE.TARGET_DAMAGED, {
          targetId: collisionTarget.id,
          entityId: entity.id,
          warheadId: warheadResult.warheadId,
          effectiveness: warheadResult.effectiveness,
          closestApproachM: warheadResult.closestApproachM,
        });
      }
      emitEvent(EVENT_TYPE.CONTROLLABLE_HIT, {
        entityId: entity.id,
        targetId: collisionTarget.id,
        batteryId: entity.launchSourceId,
        position: { ...entity.position },
        altitudeM: entity.altitudeM,
        warheadId: warheadResult.warheadId,
        outcome: warheadResult.outcome,
        effectiveness: warheadResult.effectiveness,
        closestApproachM: warheadResult.closestApproachM,
        directContact: warheadResult.directContact,
      });
      if (warheadResult.outcome === FPV_WARHEAD_RESULT.DESTROYED) emitEvent(EVENT_TYPE.TARGET_INTERCEPTED, {
        targetId: collisionTarget.id,
        missileId: entity.id,
        batteryId: entity.launchSourceId,
        weaponType: 'FPV_INTERCEPTOR',
        position: { ...entity.position },
        altitudeM: entity.altitudeM,
        closestApproachM: warheadResult.closestApproachM,
        warheadId: warheadResult.warheadId,
        effectiveness: warheadResult.effectiveness,
      });
      return {
        ...entity,
        status: CONTROLLABLE_STATUS.DESTROYED,
        flightPhase: 'POST_EVENT_HOLD',
        terminalAt: nextSimulationTime,
        visualImpact: {
          time: nextSimulationTime - deltaTimeSec * (1 - visualCollision.timeFraction),
          missilePosition: { ...visualCollision.interceptorPosition },
          targetPosition: { ...visualCollision.targetPosition },
          targetId: collisionTarget.id,
        },
        lastCollision: { kind: 'AIR_TARGET', targetId: collisionTarget.id,
          outcome: warheadResult.outcome, at: nextSimulationTime },
      };
    });
    if (damagedTargets.size > 0) updatedTargets = updatedTargets.map(target => {
      const damage = damagedTargets.get(target.id);
      return damage ? { ...target, damageState: FPV_WARHEAD_RESULT.DAMAGED,
        fragmentationEffectiveness: damage.effectiveness } : target;
    });
    [...state.missiles, ...newlyLaunchedMissiles].forEach(missile => {
      const interceptorSpec = getInterceptorSpec(missile.interceptorSpecId);
      const physics = interceptorSpec.gameplayPhysics;
      const missileWorldPosition = getWorldPosition(missile);

      if (missile.lifecycleState === INTERCEPTOR_LIFECYCLE_STATE.IMPACT) {
        const impactTarget = updatedTargetsById.get(missile.targetId);
        const impactPosition = impactTarget
          ? getWorldPosition(impactTarget)
          : missile.impactTargetPosition;
        const impactAltitudeM = impactTarget?.altitudeM ?? missile.impactTargetAltitudeM;
        const impactElapsedSec = nextSimulationTime - missile.impactStartedAt;
        if (impactElapsedSec < DIRECT_IMPACT_VISUAL_DURATION_SEC) {
          activeMissiles.push({
            ...missile,
            lat: impactPosition.lat,
            lng: impactPosition.lng,
            position: { lat: impactPosition.lat, lng: impactPosition.lng, lon: impactPosition.lng },
            worldPosition: createWorldPosition(impactPosition.lat, impactPosition.lng, impactAltitudeM),
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
        const previousVerticalSpeedMps = missile.verticalSpeedMps
          ?? flight.speedMps * Math.sin((missile.flightPathAngleDeg ?? 0) * Math.PI / 180);
        const verticalSpeedMps = previousVerticalSpeedMps
          - (physics.postMissCoastGravityMps2 ?? 4.5) * deltaTimeSec;
        const verticalTravelM = (previousVerticalSpeedMps + verticalSpeedMps) * 0.5 * deltaTimeSec;
        const nextAltitudeM = Math.max(0, missileWorldPosition.altitudeM + verticalTravelM);
        const pathDistanceM = flight.travelDistanceKm * 1000;
        const horizontalDistanceKm = Math.sqrt(Math.max(0,
          pathDistanceM ** 2 - Math.min(Math.abs(verticalTravelM), pathDistanceM) ** 2)) / 1000;
        const nextPosition = getDestinationPoint(
          missileWorldPosition.lat,
          missileWorldPosition.lng,
          missile.heading,
          horizontalDistanceKm,
        );
        const reachedGround = nextAltitudeM <= (physics.missGroundClearanceM ?? 5)
          && verticalSpeedMps <= 0;
        const groundRisk = verticalSpeedMps < 0 && nextAltitudeM <= Math.max(5,
          -verticalSpeedMps * deltaTimeSec * 1.2);
        const selfDestructDue = reachedGround || groundRisk
          || nextSimulationTime - missile.missedAtTime >= physics.missVisualContinueSec;
        const flightPathAngleDeg = Math.atan2(verticalSpeedMps,
          Math.max(flight.speedMps * Math.cos((missile.flightPathAngleDeg ?? 0) * Math.PI / 180), 0.1))
          * 180 / Math.PI;
        if (selfDestructDue) {
          const eventPosition = groundRisk ? missileWorldPosition : {
            lat: nextPosition.lat, lng: nextPosition.lng, altitudeM: nextAltitudeM };
          if (groundRisk) emitEvent(EVENT_TYPE.GROUND_RISK, { missileId: missile.id,
            altitudeM: missileWorldPosition.altitudeM });
          emitEvent(EVENT_TYPE.INTERCEPTOR_SELF_DESTRUCT, {
            missileId: missile.id,
            trackId: missile.trackId,
            position: eventPosition,
          });
          activeMissiles.push({
            ...missile,
            ...flight,
            altitudeM: groundRisk ? missileWorldPosition.altitudeM : nextAltitudeM,
            verticalSpeedMps,
            flightPathAngleDeg,
            lat: eventPosition.lat,
            lng: eventPosition.lng,
            position: { lat: eventPosition.lat, lng: eventPosition.lng, lon: eventPosition.lng },
            worldPosition: createWorldPosition(eventPosition.lat, eventPosition.lng,
              groundRisk ? missileWorldPosition.altitudeM : nextAltitudeM),
            lifecycleState: INTERCEPTOR_LIFECYCLE_STATE.SELF_DESTRUCT,
            selfDestructTime: nextSimulationTime,
            selfDestructElapsedSec: 0,
          });
        } else {
          activeMissiles.push({
            ...missile,
            ...flight,
            altitudeM: nextAltitudeM,
            verticalSpeedMps,
            flightPathAngleDeg,
            lat: nextPosition.lat,
            lng: nextPosition.lng,
            position: { lat: nextPosition.lat, lng: nextPosition.lng, lon: nextPosition.lng },
            worldPosition: createWorldPosition(nextPosition.lat, nextPosition.lng, nextAltitudeM),
            velocity: createInterceptorVelocity(flight.speedKmh, missile.heading, flightPathAngleDeg),
          });
        }
        return;
      }

      const sightCue = missile.manualSightOnly ? createTorSightCue(
        state.torManualSight[missile.sourceBatteryId], missileWorldPosition,
        nextSimulationTime) : null;
      let target = sightCue?.target ?? updatedTargetsById.get(missile.targetId);
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
      const launchPhase = getInterceptorLaunchPhase(missile);
      const enteringGuidance = missile.launchPhase !== INTERCEPTOR_LAUNCH_PHASE.GUIDANCE
        && launchPhase === INTERCEPTOR_LAUNCH_PHASE.GUIDANCE;
      const missileAtLaunchPhase = missile.launchPhase === launchPhase
        ? missile
        : {
          ...missile,
          launchPhase,
          guidanceBlendStartedAtFlightTime: enteringGuidance
            ? missile.flightTime
            : missile.guidanceBlendStartedAtFlightTime,
        };
      const seeker = advanceMissileSeeker({
        seeker: missile.seeker ?? createMissileSeeker(
          getInterceptorSeekerProfile(missile.interceptorSpecId).id,
          missile.launchTime,
        ),
        missile: missileAtLaunchPhase,
        target,
        networkTrack: engagementTrack,
        simulationTime: nextSimulationTime,
        deltaTimeSec,
        enabled: state.seekerEnabled,
      });
      if (seeker.transition) {
        emitEvent(seeker.transition.type, {
          missileId: missile.id,
          trackId: missile.trackId,
          targetId: missile.targetId,
          seekerProfileId: seeker.profileId,
          seekerType: seeker.seekerType,
          fromState: seeker.transition.fromState,
          toState: seeker.transition.toState,
        });
      }
      const missileWithSeeker = { ...missileAtLaunchPhase, seeker };
      const manualOlsFlight = missile.interceptorSpecId === 'INT-9M331-V1'
        && missile.manualOlsControl === true;
      const guidance = manualOlsFlight
        ? advanceTorManualGuidance({ interceptor: missileWithSeeker,
          sight: state.torManualSight[missile.sourceBatteryId],
          simulationTime: nextSimulationTime, deltaTimeSec, physics,
          steeringEnabled: launchPhase === INTERCEPTOR_LAUNCH_PHASE.GUIDANCE })
        : advanceInterceptorGuidance({
          interceptor: missileWithSeeker,
          track: engagementTrack,
          simulationTime: nextSimulationTime,
          deltaTimeSec,
          physics,
        });
      if (!manualOlsFlight && engagementTrack && guidance.guidance) {
        const radarId = engagementTrack.sourceRadarId;
        if (radarId && missile.guidance?.loggedTrackSourceRadarId !== radarId) {
          emitEvent(EVENT_TYPE.MISSILE_TRACK_SOURCE, { missileId: missile.id,
            radarId, trackId: engagementTrack.id,
            trackAgeSec: Math.max(0, nextSimulationTime - engagementTrack.lastUpdateTime),
            trackPosition: engagementTrack.reportedPosition,
            lastMeasuredPosition: engagementTrack.lastMeasuredPosition,
            trackVelocity: { speedKmh: engagementTrack.reportedSpeedKmh,
              headingDeg: engagementTrack.reportedHeading } });
          guidance.guidance.loggedTrackSourceRadarId = radarId;
        }
        const solution = guidance.guidance.interceptSolution;
        if (solution && missile.guidance?.loggedInterceptStatus !== solution.status
          && (missile.guidance?.loggedInterceptAt == null
            || nextSimulationTime - missile.guidance.loggedInterceptAt >= 3)) {
          emitEvent(EVENT_TYPE.MISSILE_PREDICTED_INTERCEPT, { missileId: missile.id,
            status: solution.status, timeToGoSec: solution.timeToGoSec,
            predictedPosition: solution.interceptPoint,
            trackAgeSec: Math.max(0, nextSimulationTime - engagementTrack.lastUpdateTime) });
          guidance.guidance.loggedInterceptStatus = solution.status;
          guidance.guidance.loggedInterceptAt = nextSimulationTime;
        }
      }
      const headingChangeDeg = getDirectionChangeDeg(
        missile.heading,
        guidance.heading,
        missile.flightPathAngleDeg ?? 0,
        guidance.flightPathAngleDeg ?? missile.flightPathAngleDeg ?? 0,
      );
      let flight = advanceInterceptorFlight(missile, deltaTimeSec, physics, {
        headingChangeDeg,
        headingCorrectionDeg: guidance.directionCorrectionDeg ?? guidance.headingCorrectionDeg,
        altitudeM: missile.altitudeM,
      });
      if (missile.launchPhase !== launchPhase && launchPhase !== INTERCEPTOR_LAUNCH_PHASE.GUIDANCE) {
        emitEvent(EVENT_TYPE.MISSILE_PHASE, { missileId: missile.id, phase: launchPhase });
      }
      if (missile.motorPhase !== flight.motorPhase) {
        emitEvent(EVENT_TYPE.MISSILE_PHASE, { missileId: missile.id, phase: flight.motorPhase });
        if (missile.interceptorSpecId === 'INT-ASTER30-V1'
          && missile.motorPhase === 'BOOST' && flight.motorPhase === 'SUSTAIN') {
          emitEvent(EVENT_TYPE.STAGE_SEPARATION, { missileId: missile.id, stage: 'BOOSTER' });
        }
      }
      if (guidance.guidanceSource && missile.guidanceSource !== guidance.guidanceSource) {
        emitEvent(EVENT_TYPE.MISSILE_SOURCE, { missileId: missile.id,
          source: guidance.guidanceSource, radarId: engagementTrack?.sourceRadarId ?? null });
        if (missile.guidanceSource === 'OWN_SEEKER' && guidance.guidanceSource === 'NETWORK_TRACK') {
          emitEvent(EVENT_TYPE.MISSILE_FALLBACK_NETWORK, { missileId: missile.id,
            radarId: engagementTrack?.sourceRadarId ?? null });
        }
      }
      if ((guidance.guidance?.reattackCount ?? 0) > (missile.guidance?.reattackCount ?? 0)) {
        emitEvent(EVENT_TYPE.MISSILE_MISS, { missileId: missile.id });
        emitEvent(EVENT_TYPE.SECOND_ATTACK_ALLOWED, { missileId: missile.id,
          source: guidance.guidanceSource, radarId: engagementTrack?.sourceRadarId ?? null });
      }
      if (guidance.failedReason) {
        if (guidance.failedReason === INTERCEPTOR_FAILURE_REASON.INTERCEPT_LOST) {
          emitEvent(EVENT_TYPE.MISSILE_MISS, { missileId: missile.id });
          emitEvent(EVENT_TYPE.SECOND_ATTACK_DENIED, { missileId: missile.id,
            reason: (missile.guidance?.reattackCount ?? 0) > 0
              ? 'SECOND_PASS' : 'KINEMATICS_OR_TRACK' });
        }
        emitEvent(EVENT_TYPE.INTERCEPTOR_FAILED, {
          missileId: missile.id,
          trackId: missile.trackId,
          reason: guidance.failedReason,
        });
        activeMissiles.push({
          ...missileWithSeeker,
          ...flight,
          lifecycleState: INTERCEPTOR_LIFECYCLE_STATE.MISSED,
          missedAtTime: nextSimulationTime,
          failureReason: guidance.failedReason,
        });
        return;
      }
      const altitudeFlight = launchPhase !== INTERCEPTOR_LAUNCH_PHASE.GUIDANCE
        ? advanceVerticalLaunchDeparture({
          interceptor: missileAtLaunchPhase,
          flight,
          deltaTimeSec,
          launchPhase,
        })
        : (() => {
          const flightPathAngleDeg = guidance.flightPathAngleDeg
            ?? missile.flightPathAngleDeg
            ?? 0;
          const flightPathAngleRad = flightPathAngleDeg * Math.PI / 180;
          const pathDistanceM = flight.travelDistanceKm * 1000;
          const verticalTravelM = pathDistanceM * Math.sin(flightPathAngleRad);
          return {
            altitudeM: Math.max(0, missile.altitudeM + verticalTravelM),
            verticalSpeedMps: flight.speedMps * Math.sin(flightPathAngleRad),
            horizontalDistanceKm: pathDistanceM * Math.max(0, Math.cos(flightPathAngleRad)) / 1000,
            flightPhase: guidance.guidanceState === INTERCEPTOR_GUIDANCE_STATE.TERMINAL
              ? SIMPLE_FLIGHT_PHASE.TERMINAL
              : SIMPLE_FLIGHT_PHASE.CRUISE,
            flightPathAngleDeg,
          };
        })();
      if (altitudeFlight.verticalSpeedMps < 0
        && altitudeFlight.altitudeM <= Math.max(5,
          -altitudeFlight.verticalSpeedMps * deltaTimeSec * 1.2)) {
        emitEvent(EVENT_TYPE.GROUND_RISK, { missileId: missile.id,
          altitudeM: missileWorldPosition.altitudeM });
        emitEvent(EVENT_TYPE.INTERCEPTOR_SELF_DESTRUCT, { missileId: missile.id,
          trackId: missile.trackId, position: { ...missileWorldPosition } });
        activeMissiles.push({ ...missileWithSeeker,
          lifecycleState: INTERCEPTOR_LIFECYCLE_STATE.SELF_DESTRUCT,
          selfDestructTime: nextSimulationTime, selfDestructElapsedSec: 0,
          failureReason: 'GROUND_RISK' });
        return;
      }
      if (missile.altitudeM >= 90 && altitudeFlight.altitudeM < 90
        && altitudeFlight.verticalSpeedMps < 0) {
        emitEvent(EVENT_TYPE.GROUND_RISK, { missileId: missile.id,
          altitudeM: altitudeFlight.altitudeM });
      }
      flight = applyAltitudeEnergyExchange(
        flight,
        altitudeFlight.altitudeM - missile.altitudeM,
        deltaTimeSec,
        physics,
      );
      const nextPosition = getDestinationPoint(
        missileWorldPosition.lat,
        missileWorldPosition.lng,
        guidance.heading,
        altitudeFlight.horizontalDistanceKm,
      );
      const nextLat = nextPosition.lat;
      const nextLng = nextPosition.lng;
      const nextWorldPosition = createWorldPosition(nextLat, nextLng, altitudeFlight.altitudeM);
      const coldLaunch = advanceColdLaunch({ interceptor: missile, flight, altitudeFlight });
      if (coldLaunch && coldLaunch.coldLaunchPhase !== COLD_LAUNCH_PHASE.ORIENT
        && launchPhase === INTERCEPTOR_LAUNCH_PHASE.GUIDANCE) {
        const errorDeg = guidance.pitchErrorDeg ?? 0;
        const actualRate = Math.abs(guidance.pitchRateDegPerSec ?? 0);
        const maximumRate = Math.max(1, missile.launchProfile.pitchOverMaxTurnRateDegPerSec);
        const intensity = Math.min(1, actualRate / maximumRate)
          * Math.min(1, Math.abs(errorDeg) / 35);
        coldLaunch.attitudeCorrectionDeg = errorDeg;
        coldLaunch.attitudeJetsActive = intensity > .01;
        coldLaunch.attitudeJetsIntensity = intensity;
      }
      const nextLaunchPhase = getInterceptorLaunchPhase({ ...missile, ...coldLaunch }, flight.flightTime);
      const previousTarget = previousTargetsById.get(target.id) ?? target;
      const previousTargetWorldPosition = getWorldPosition(previousTarget);
      let targetWorldPosition = getWorldPosition(target);
      if (missile.manualSightOnly && updatedTargets.length) {
        // Check every living target's real swept path, with no launch-time lock
        // and no target truth in the steering command.
        let best = Infinity;
        for (const candidate of updatedTargets) {
          const candidateStart = getWorldPosition(previousTargetsById.get(candidate.id) ?? candidate);
          const candidateEnd = getWorldPosition(candidate);
          const approach = didSweptPathsEnterRadiusMeters({
            interceptorStart: missileWorldPosition, interceptorEnd: nextWorldPosition,
            targetStart: candidateStart, targetEnd: candidateEnd,
          }, missile.hitRadiusM ?? physics.proximityFuseRadiusM);
          if (approach.closestDistanceKm < best) {
            best = approach.closestDistanceKm; target = candidate;
            targetWorldPosition = candidateEnd;
          }
        }
      }
      const sweptApproach = didSweptPathsEnterRadiusMeters({
        interceptorStart: missileWorldPosition,
        interceptorEnd: nextWorldPosition,
        targetStart: previousTargetWorldPosition,
        targetEnd: targetWorldPosition,
      }, missile.hitRadiusM ?? Math.min(
        physics.proximityFuseRadiusM,
        physics.minimumVisualContactDistanceM ?? physics.proximityFuseRadiusM,
      ));
      const targetDistanceKm = sweptApproach.closestDistanceKm;
      const currentDistanceToTargetKm = getSlantDistanceKm(
        nextWorldPosition,
        nextWorldPosition.altitudeM,
        targetWorldPosition,
        targetWorldPosition.altitudeM,
      );
      const improvedApproach = targetDistanceKm < missile.closestApproachKm;
      const closestApproachKm = improvedApproach
        ? targetDistanceKm
        : missile.closestApproachKm;
      const timeSinceClosestApproachSec = improvedApproach
        ? 0
        : missile.timeSinceClosestApproachSec + deltaTimeSec;
      if (
        sweptApproach.intersects && target.id != null
        && flight.distanceTraveledKm * 1000 >= (physics.proximityFuseArmingDistanceM ?? 0)
        && flight.flightTime >= Math.max(
          physics.minimumControlledFlightTimeSec ?? 0,
          physics.guidanceReactionTimeSec ?? 0,
        )
      ) {
        // The gameplay result is unchanged. Keep both sprites coincident for a
        // brief simulation-time beat so the accepted intercept reads as a
        // direct visual impact instead of the missile disappearing nearby.
        activeMissiles.push({
          ...missileWithSeeker,
          ...flight,
          ...guidance,
          ...coldLaunch,
          launchPhase: nextLaunchPhase,
          ...altitudeFlight,
          lat: targetWorldPosition.lat,
          lng: targetWorldPosition.lng,
          position: {
            lat: targetWorldPosition.lat,
            lng: targetWorldPosition.lng,
            lon: targetWorldPosition.lng,
          },
          worldPosition: { ...targetWorldPosition },
          altitudeM: targetWorldPosition.altitudeM,
          lifecycleState: INTERCEPTOR_LIFECYCLE_STATE.IMPACT,
          impactStartedAt: nextSimulationTime,
          impactTargetPosition: { ...targetWorldPosition },
          impactTargetAltitudeM: targetWorldPosition.altitudeM,
          impactClosestApproachM: sweptApproach.closestDistanceKm * 1000,
          // Presentation metadata only: retain the actual swept flight/contact
          // pose before the legacy 2D impact beat places the sprite on target.
          visualImpact: {
            time: nextSimulationTime - deltaTimeSec * (1 - sweptApproach.timeFraction),
            missilePosition: { ...sweptApproach.interceptorPosition },
            targetPosition: { ...sweptApproach.targetPosition },
          },
          closestApproachKm,
          distanceToTargetKm: 0,
          velocity: createInterceptorVelocity(
            flight.speedKmh,
            guidance.heading,
            altitudeFlight.flightPathAngleDeg ?? guidance.flightPathAngleDeg ?? 0,
          ),
        });
      } else if (flight.terminated) {
        emitEvent(EVENT_TYPE.INTERCEPTOR_FAILED, {
          missileId: missile.id,
          trackId: missile.trackId,
          reason: INTERCEPTOR_FAILURE_REASON.ENERGY_DEPLETED,
        });
        activeMissiles.push({
          ...missileWithSeeker,
          ...flight,
          ...altitudeFlight,
          ...coldLaunch,
          launchPhase: nextLaunchPhase,
          lat: nextLat,
          lng: nextLng,
          position: { lat: nextLat, lng: nextLng, lon: nextLng },
          worldPosition: nextWorldPosition,
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
      } else {
        const previousTrajectoryPoint = missile.trajectory.at(-1);
        const shouldAddTrajectoryPoint = !previousTrajectoryPoint || getDistanceKm(
          previousTrajectoryPoint.lat,
          previousTrajectoryPoint.lng,
          nextLat,
          nextLng,
        ) >= 0.5;
        activeMissiles.push({ 
          ...missileWithSeeker,
          ...flight,
          ...guidance,
          ...coldLaunch,
          launchPhase: nextLaunchPhase,
          kinematicPhase: guidance.guidanceState === INTERCEPTOR_GUIDANCE_STATE.TERMINAL
            ? INTERCEPTOR_KINEMATIC_PHASE.TERMINAL
            : flight.motorPhase === 'BOOST'
              ? INTERCEPTOR_KINEMATIC_PHASE.BOOST
              : INTERCEPTOR_KINEMATIC_PHASE.MIDCOURSE,
          lifecycleState: guidance.guidanceState === INTERCEPTOR_GUIDANCE_STATE.TERMINAL
            ? INTERCEPTOR_LIFECYCLE_STATE.TERMINAL
            : INTERCEPTOR_LIFECYCLE_STATE.FLYING,
          desiredHeading: guidance.desiredHeading ?? guidance.guidance.commandHeading,
          guidanceState: guidance.guidanceState,
          turnRateDegPerSec: guidance.turnRateDegPerSec,
          headingCorrectionDeg: guidance.headingCorrectionDeg,
          maximumTurnRateDegPerSec: guidance.maximumTurnRateDegPerSec,
          turnEnergyFactor: guidance.energyFactor,
          turnSpeedFactor: guidance.speedFactor,
          turnRadiusKm: guidance.turnRadiusKm,
          navigationConstant: guidance.navigationConstant,
          closingSpeedMps: guidance.closingSpeedMps,
          losAngleDeg: guidance.losAngleDeg,
          losRateDegPerSec: guidance.losRateDegPerSec,
          commandedLateralAccelerationMps2: guidance.commandedLateralAccelerationMps2,
          actualLateralAccelerationMps2: guidance.actualLateralAccelerationMps2,
          currentG: guidance.currentG,
          availableG: guidance.availableG,
          maximumG: guidance.maximumG,
          profileMaxG: guidance.profileMaxG,
          aeroAvailableG: guidance.aeroAvailableG,
          energyLimitedG: guidance.energyLimitedG,
          autopilotAllowedG: guidance.autopilotAllowedG,
          predictedInterceptDistanceKm: guidance.predictedInterceptDistanceKm,
          estimatedTimeToGoSec: guidance.estimatedTimeToGoSec,
          predictedClosestApproachM: guidance.predictedClosestApproachM,
          interceptSolutionStatus: guidance.interceptSolutionStatus,
          interceptQuality: guidance.interceptQuality,
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
          worldPosition: nextWorldPosition,
          velocity: createInterceptorVelocity(
            flight.speedKmh,
            guidance.heading,
            altitudeFlight.flightPathAngleDeg ?? guidance.flightPathAngleDeg ?? 0,
          ),
        });
      }
    });
    checkpoint(SIMULATION_SUBSYSTEM.MISSILE_KINEMATICS);

    let survivingTargets = updatedTargets.filter(target => !interceptedTargetIds.has(target.id));
    const survivingTargetIds = new Set(survivingTargets.map(target => target.id));
    const survivingTracks = updatedTracks.filter(track => survivingTargetIds.has(track.targetId));
    const survivingSensorContacts = sensorContacts.filter(contact => (
      survivingTargetIds.has(contact.targetId)
    ));
    const selectedTrackStillExists = survivingTracks.some(track => track.id === state.selectedTrackId);
    const hoveredTrackStillExists = survivingTracks.some(track => track.id === state.hoveredTrackId);

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
    let nextEngagementAssignments = state.engagementAssignments;
    let nextCoordinatorMetrics = state.coordinatorMetrics;
    let nextCoordinatorEvaluationCursor = state.coordinatorEvaluationCursor;
    let nextCoordinatorCandidateCache = state.coordinatorCandidateCache;
    const previousTrackIds = new Set(state.tracks.map(track => track.id));
    const previousMissilesById = new Map(state.missiles.map(missile => [missile.id, missile]));
    const coordinatorCriticalEvent = survivingTracks.some(track => (
      !previousTrackIds.has(track.id)
    )) || activeMissiles.some(missile => {
      const previous = previousMissilesById.get(missile.id);
      return previous && (
        previous.lifecycleState !== missile.lifecycleState
        || previous.guidanceState !== missile.guidanceState
          && missile.guidanceState === INTERCEPTOR_GUIDANCE_STATE.INTERCEPT_LOST
      );
    });
    checkpoint(SIMULATION_SUBSYSTEM.EVENTS);

    if (coordinatorCriticalEvent || nextSimulationTime >= state.nextAutoDecisionTime) {
      nextAutoDecisionTime = nextSimulationTime + getAutoDecisionIntervalSec(state.timeScale);
      let registry = buildEngagementRegistry({
        missiles: activeMissiles,
        pendingLaunches: nextPendingLaunches,
        launchQueue: finalLaunchQueue,
        gunEngagements: nextGunEngagements,
      });
      const fireControlTargets = survivingTracks.map(track => createFireControlTargetEstimate(
        track,
        survivingTargets.find(target => target.id === track.targetId),
        nextSimulationTime,
      )).filter(Boolean);
      const targetDefenseAssessments = buildTargetDefenseAssessments({
        targets: fireControlTargets,
        tracks: survivingTracks,
        batteries: batteriesWithScanFeedback,
        simulationTime: nextSimulationTime,
      });
      survivingTargets = survivingTargets.map(target => ({
        ...target,
        defenseAssessment: targetDefenseAssessments.get(target.id) ?? null,
      }));
      const coordination = coordinateEngagements({
        targets: survivingTargets,
        tracks: survivingTracks,
        batteries: batteriesWithScanFeedback,
        missiles: activeMissiles,
        pendingLaunches: nextPendingLaunches,
        launchQueue: finalLaunchQueue,
        gunEngagements: nextGunEngagements,
        previousAssignments: state.engagementAssignments,
        simulationTime: nextSimulationTime,
        capabilities: state.coordinatorCapabilities,
        evaluationCursor: state.coordinatorEvaluationCursor,
        candidateCache: state.coordinatorCandidateCache,
      });
      nextEngagementAssignments = coordination.assignments;
      nextCoordinatorMetrics = coordination.metrics;
      nextCoordinatorEvaluationCursor = coordination.metrics.nextEvaluationCursor;
      nextCoordinatorCandidateCache = coordination.candidateCache;
      survivingTargets = survivingTargets.map(target => {
        const track = survivingTracks.find(candidate => candidate.targetId === target.id);
        return {
          ...target,
          engagementCoordination: track ? coordination.assignments[track.id] ?? null : null,
        };
      });
      const targetsById = new Map(survivingTargets.map(target => [target.id, target]));
      const automaticActionKeys = new Set(coordination.autoActions.map(candidate => (
        `${candidate.battery.id}:${candidate.track.id}`
      )));
      const batteryUpdates = new Map();
      [...batteriesWithScanFeedback]
        .sort((first, second) => first.id.localeCompare(second.id))
        .forEach(originalBattery => {
          const battery = batteryUpdates.get(originalBattery.id) ?? originalBattery;
          const controlMode = battery.controlMode ?? BATTERY_CONTROL_MODE.MANUAL;
          const coordinatedCandidate = coordination.recommendations.get(battery.id) ?? null;
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
              recommendedTrackId: coordinatedCandidate?.track.id ?? null,
              autoDecision: coordinatedCandidate?.plan ?? null,
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

          const plannedThreats = coordinatedCandidate ? [{
            threat: coordinatedCandidate.threat,
            track: coordinatedCandidate.track,
            target: targetsById.get(coordinatedCandidate.target.id) ?? coordinatedCandidate.target,
            plan: coordinatedCandidate.plan,
          }] : [];
          const actionable = plannedThreats.find(candidate => (
            automaticActionKeys.has(`${battery.id}:${candidate.track.id}`)
            && candidate.threat.interceptSolution?.status !== INTERCEPT_FEASIBILITY.NO_SOLUTION
            && (battery.category === 'TOR_M1'
              || (nextAutoEngagementAttempts[`${battery.id}:${candidate.threat.trackId}`] ?? 0)
                < getInterceptorEngagementPolicy(battery).maximumAutomaticAttempts)
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
            preferredLauncherId: coordinatedCandidate?.launcherId ?? null,
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
    checkpoint(SIMULATION_SUBSYSTEM.AUTO);
    updateCalculationMs = (globalThis.performance?.now?.() ?? Date.now()) - calculationStartedAt;

    return {
      simulationTime: nextSimulationTime,
      batteries: batteriesWithScanFeedback,
      searchRadars: updatedSearchRadars,
      airTargets: survivingTargets,
      controllableAirEntities: updatedControllableAirEntities.filter(entity => (
        !entity.terminalAt || nextSimulationTime - entity.terminalAt < 1.1
      )),
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
      engagementAssignments: nextEngagementAssignments,
      coordinatorMetrics: nextCoordinatorMetrics,
      coordinatorEvaluationCursor: nextCoordinatorEvaluationCursor,
      coordinatorCandidateCache: nextCoordinatorCandidateCache,
      nextTrackSequence,
      spawnedTargetIds: [...spawnedTargetIds],
      announcedGroupIds: [...announcedGroupIds],
      events: events.slice(-100),
      missileLog,
      nextEventSequence,
      selectedTrackId: selectedTrackStillExists ? state.selectedTrackId : null,
      hoveredTrackId: hoveredTrackStillExists ? state.hoveredTrackId : null,
      selectedMissileId: activeMissiles.some(missile => missile.id === state.selectedMissileId)
        ? state.selectedMissileId
        : null,
      selectedBatteryId: batteriesWithScanFeedback.some(
        battery => battery.id === state.selectedBatteryId,
      ) ? state.selectedBatteryId : null,
      selectedControllableEntityId: updatedControllableAirEntities.some(
        entity => entity.id === state.selectedControllableEntityId,
      ) ? state.selectedControllableEntityId : null,
      controlledControllableEntityId: controlledControllableStillActive
        && updatedControllableAirEntities.some(entity => (
          entity.id === state.controlledControllableEntityId
          && entity.status === CONTROLLABLE_STATUS.ACTIVE
        ))
        ? state.controlledControllableEntityId
        : null,
    };
    });
    const controlledEntityId = useManualControlStore.getState().ownerEntityId;
    if (controlledEntityId && get().controlledControllableEntityId !== controlledEntityId) {
      useManualControlStore.getState().release(controlledEntityId);
    }
    if (updated) {
      const updateFinishedAt = globalThis.performance?.now?.() ?? Date.now();
      recordSimulationSubsystem(
        SIMULATION_SUBSYSTEM.STORE_COMMIT,
        Math.max(0, updateFinishedAt - updateStartedAt - updateCalculationMs),
      );
      recordSimulationUpdate(updateFinishedAt - updateStartedAt);
    }
  },
}));
