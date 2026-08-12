import { create } from 'zustand';
import { getInterceptorSpec } from '../data/interceptors.js';
import { advanceAirTarget, createAirTarget } from './airTargetSystem.js';
import { ENGAGEMENT_STATUS, getBatteryEngagementStatus, selectBestLauncher } from './engagement.js';
import { getBearing, getDestinationPoint, getDistanceKm } from './geo.js';
import { TEST_RAID_SCENARIO } from './scenarios.js';
import { createSimulationEvent, EVENT_TYPE } from './simulationEvents.js';
import { applyRadarObservation, formatTrackId, TRACK_STATE, updateLostTrack } from './trackSystem.js';
import { advanceInterceptorFlight, INTERCEPTOR_PHASE } from './interceptorPhysics.js';
import {
  advanceInterceptorGuidance,
  createInterceptorGuidance,
  INTERCEPTOR_FAILURE_REASON,
  INTERCEPTOR_GUIDANCE_STATE,
} from './interceptorGuidance.js';
import {
  advanceRadarScan,
  countRadarMeasurements,
  createRadarScanState,
  isTargetInRadarCoverage,
  ELECTRONIC_PULSE_DURATION_SEC,
  RADAR_SCAN_TYPE,
} from './radarSystem.js';

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
  SHORT:  { type: 'IRIS-T SLS', radarRangeKm: 40,  missilesLeft: 4,  interceptorSpecId: 'INT-SHORT-V1',  scanRateSec: 2.0, radarBeamWidthDeg: 7, radarSector: 360, scanType: RADAR_SCAN_TYPE.MECHANICAL_ROTATION },
  MEDIUM: { type: 'NASAMS',     radarRangeKm: 80,  missilesLeft: 6,  interceptorSpecId: 'INT-MEDIUM-V1', scanRateSec: 3.0, radarBeamWidthDeg: 6, radarSector: 360, scanType: RADAR_SCAN_TYPE.MECHANICAL_ROTATION },
  LONG:   { type: 'PATRIOT',    radarRangeKm: 150, missilesLeft: 16, interceptorSpecId: 'INT-LONG-V1',   scanRateSec: 2.4, radarBeamWidthDeg: 5, radarSector: 120, scanType: RADAR_SCAN_TYPE.ELECTRONIC_SECTOR }
};

export const useEngine = create((set, get) => ({
  simulationTime: TEST_RAID_SCENARIO.startTimeSeconds,
  timeScale: 1,              
  hoveredTrackId: null,   
  selectedTrackId: null,  
  selectedBatteryId: null,
  nextBatterySequence: 1,
  nextTrackSequence: 1,
  nextMissileSequence: 1,
  nextEventSequence: 1,
  
  batteries: [],
  airTargets: [],
  tracks: [],
  missiles: [],
  activeScenario: TEST_RAID_SCENARIO,
  spawnedTargetIds: [],
  events: [],

  deployPhase: null, draftBattery: null, buildMenuOpen: false, selectedCategory: null,
  
  toggleBuildMenu: () => set(state => ({ buildMenuOpen: !state.buildMenuOpen, selectedCategory: null })),
  setCategory: (cat) => set(state => ({ selectedCategory: state.selectedCategory === cat ? null : cat })),
  closeBuildMenu: () => set({ buildMenuOpen: false, selectedCategory: null }),

  startDeploy: (categoryKey) => {
    const template = SYSTEM_CATALOG[categoryKey];
    const state = get();
    set({
      buildMenuOpen: false, selectedCategory: null, deployPhase: 'FDC',
      nextBatterySequence: state.nextBatterySequence + 1,
      draftBattery: {
        id: `${template.type.split(' ')[0]}-${state.nextBatterySequence.toString().padStart(2, '0')}`,
        type: template.type, status: 'DEPLOYING',
        missilesLeft: template.missilesLeft, radarRangeKm: template.radarRangeKm,
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
    if (state.deployPhase === 'FDC') {
      draft.components.fdc = { lat, lng }; nextPhase = 'RADAR';
    } else if (state.deployPhase === 'RADAR') {
      draft.components.radar = {
        lat,
        lng,
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
        operational: true,
        ready: true,
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

  setHoveredTrack: (id) => set({ hoveredTrackId: id }),
  setSelectedTrack: (id) => set(state => ({
    selectedTrackId: state.selectedTrackId === id ? null : id,
    selectedBatteryId: null,
  })),
  setSelectedBattery: (id) => set({ selectedBatteryId: id }),
  clearSelection: () => set({ selectedTrackId: null, selectedBatteryId: null }),
  setTimeScale: (scale) => set({ timeScale: scale }),

  fireMissile: () => {
    const state = get();
    const track = state.tracks.find(candidate => candidate.id === state.selectedTrackId);
    const target = state.airTargets.find(candidate => candidate.id === track?.targetId);
    const selectedBattery = state.batteries.find(candidate => candidate.id === state.selectedBatteryId);
    if (!track || !target || !selectedBattery) return;
    if (getBatteryEngagementStatus(selectedBattery, track) !== ENGAGEMENT_STATUS.READY) return;
    const launcher = selectBestLauncher(selectedBattery, track);
    if (!launcher) return;
    const interceptorSpec = getInterceptorSpec(selectedBattery.interceptorSpecId);

    const newMissile = {
      id: `MSL-${state.nextMissileSequence.toString().padStart(3, '0')}`,
      targetId: target.id,
      trackId: track.id,
      sourceBatteryId: selectedBattery.id,
      launcherId: launcher.id,
      interceptorSpecId: interceptorSpec.id,
      lat: launcher.lat,
      lng: launcher.lng,
      heading: getBearing(launcher.lat, launcher.lng, track.reportedPosition.lat, track.reportedPosition.lng),
      speedKmh: interceptorSpec.gameplayPhysics.launchSpeedKmh,
      phase: INTERCEPTOR_PHASE.POWERED,
      guidanceState: INTERCEPTOR_GUIDANCE_STATE.BOOST,
      guidance: createInterceptorGuidance(track, state.simulationTime),
      flightTime: 0,
      distanceTraveledKm: 0,
      closestApproachKm: Number.POSITIVE_INFINITY,
      timeSinceClosestApproachSec: 0,
      trajectory: [{ lat: launcher.lat, lng: launcher.lng }],
    };
    const launchEvent = createSimulationEvent(
      state.nextEventSequence,
      EVENT_TYPE.INTERCEPTOR_LAUNCHED,
      state.simulationTime,
      {
        missileId: newMissile.id,
        trackId: track.id,
        batteryId: selectedBattery.id,
        launcherId: launcher.id,
      },
    );
    set({
      missiles: [...state.missiles, newMissile],
      batteries: state.batteries.map(battery => battery.id === selectedBattery.id
        ? { ...battery, missilesLeft: battery.missilesLeft - 1 }
        : battery),
      events: [...state.events, launchEvent].slice(-100),
      nextMissileSequence: state.nextMissileSequence + 1,
      nextEventSequence: state.nextEventSequence + 1,
    });
  },

  tick: () => set((state) => {
    if (state.timeScale === 0) return {};
    const deltaTimeSec = (1 / 30) * state.timeScale;
    
    const updatedBatteries = state.batteries.map(battery => {
      const radar = battery.components.radar;
      if (!radar) return battery;
      const scanState = radar.scanState ?? createRadarScanState({
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
          radar: {
            ...radar,
            scanState: advanceRadarScan(
              scanState,
              deltaTimeSec,
              battery.radarSector,
              battery.radarHeading,
            ),
          },
        },
      };
    });

    const nextSimulationTime = state.simulationTime + deltaTimeSec;
    let nextEventSequence = state.nextEventSequence;
    let events = [...state.events];
    const emitEvent = (type, details) => {
      events.push(createSimulationEvent(nextEventSequence++, type, nextSimulationTime, details));
    };

    const spawnedTargetIds = new Set(state.spawnedTargetIds);
    const targetsWithSpawns = [...state.airTargets];
    state.activeScenario.targets.forEach(definition => {
      const spawnTime = state.activeScenario.startTimeSeconds + definition.spawnOffsetSeconds;
      if (spawnedTargetIds.has(definition.id) || spawnTime > nextSimulationTime) return;
      targetsWithSpawns.push(createAirTarget(definition, spawnTime));
      spawnedTargetIds.add(definition.id);
      emitEvent(EVENT_TYPE.TARGET_SPAWNED, { targetId: definition.id });
    });

    const advancedTargets = targetsWithSpawns.map(target => advanceAirTarget(target, deltaTimeSec));
    advancedTargets
      .filter(target => target.state === 'COMPLETED')
      .forEach(target => emitEvent(EVENT_TYPE.TARGET_ESCAPED, { targetId: target.id }));
    const updatedTargets = advancedTargets.filter(target => target.state === 'ALIVE');

    let nextTrackSequence = state.nextTrackSequence;
    const tracksByTargetId = new Map(state.tracks.map(track => [track.targetId, track]));
    const updatedTracks = [];
    const electronicPulsesByBatteryId = new Map();

    updatedTargets.forEach(target => {
      const existingTrack = tracksByTargetId.get(target.id);
      const coveringRadars = updatedBatteries.filter(battery => (
        isTargetInRadarCoverage(battery, target)
      ));
      const measurements = coveringRadars.flatMap(battery => {
        const measurementCount = countRadarMeasurements(battery, target);
        if (
          measurementCount > 0
          && battery.components.radar.scanState.scanType === RADAR_SCAN_TYPE.ELECTRONIC_SECTOR
        ) {
          const radar = battery.components.radar;
          const pulse = {
            targetId: target.id,
            bearing: getBearing(radar.lat, radar.lng, target.position.lat, target.position.lng),
            distanceKm: getDistanceKm(
              radar.lat,
              radar.lng,
              target.position.lat,
              target.position.lng,
            ),
            simulationTime: nextSimulationTime,
          };
          electronicPulsesByBatteryId.set(battery.id, [
            ...(electronicPulsesByBatteryId.get(battery.id) ?? []),
            pulse,
          ]);
        }
        return Array.from({ length: measurementCount }, () => battery);
      });

      if (measurements.length > 0) {
        const trackId = existingTrack ? existingTrack.id : formatTrackId(nextTrackSequence++);
        let observedTrack = existingTrack;
        measurements.forEach(scanningRadar => {
          observedTrack = applyRadarObservation({
            existingTrack: observedTrack,
            target,
            sourceBatteryId: scanningRadar.id,
            simulationTime: nextSimulationTime,
            trackId,
          });
        });
        updatedTracks.push(observedTrack);
        if (!existingTrack) {
          emitEvent(EVENT_TYPE.TRACK_DETECTED, { trackId: observedTrack.id, targetId: target.id });
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
      if (coveringRadars.length > 0) {
        updatedTracks.push(existingTrack);
        return;
      }

      const lostTrack = updateLostTrack(existingTrack, nextSimulationTime, deltaTimeSec);
      if (lostTrack) updatedTracks.push(lostTrack);
    });

    const batteriesWithScanFeedback = updatedBatteries.map(battery => {
      const radar = battery.components.radar;
      if (radar?.scanState.scanType !== RADAR_SCAN_TYPE.ELECTRONIC_SECTOR) return battery;
      const retainedPulses = radar.scanState.electronicPulses.filter(pulse => (
        nextSimulationTime - pulse.simulationTime < ELECTRONIC_PULSE_DURATION_SEC
      ));
      const newPulses = electronicPulsesByBatteryId.get(battery.id) ?? [];
      return {
        ...battery,
        components: {
          ...battery.components,
          radar: {
            ...radar,
            scanState: {
              ...radar.scanState,
              electronicPulses: [...retainedPulses, ...newPulses].slice(-4),
            },
          },
        },
      };
    });

    const activeMissiles = [];
    const interceptedTargetIds = new Set();
    state.missiles.forEach(missile => {
      const target = updatedTargets.find(candidate => candidate.id === missile.targetId);
      if (!target) {
        emitEvent(EVENT_TYPE.INTERCEPTOR_FAILED, {
          missileId: missile.id,
          trackId: missile.trackId,
          reason: INTERCEPTOR_FAILURE_REASON.TARGET_UNAVAILABLE,
        });
        return;
      }
      if (interceptedTargetIds.has(target.id)) return;

      const interceptorSpec = getInterceptorSpec(missile.interceptorSpecId);
      const physics = interceptorSpec.gameplayPhysics;
      const flight = advanceInterceptorFlight(missile, deltaTimeSec, physics);
      const engagementTrack = updatedTracks.find(track => track.id === missile.trackId);
      const guidance = advanceInterceptorGuidance({
        interceptor: { ...missile, ...flight },
        track: engagementTrack,
        simulationTime: nextSimulationTime,
        deltaTimeSec,
        physics,
      });
      if (guidance.failedReason) {
        emitEvent(EVENT_TYPE.INTERCEPTOR_FAILED, {
          missileId: missile.id,
          trackId: missile.trackId,
          reason: guidance.failedReason,
        });
        return;
      }
      const nextPosition = getDestinationPoint(
        missile.lat,
        missile.lng,
        guidance.heading,
        flight.travelDistanceKm,
      );
      const nextLat = nextPosition.lat;
      const nextLng = nextPosition.lng;
      const targetDistanceKm = getDistanceKm(
        nextLat,
        nextLng,
        target.position.lat,
        target.position.lng,
      );
      const improvedApproach = targetDistanceKm < missile.closestApproachKm;
      const closestApproachKm = improvedApproach
        ? targetDistanceKm
        : missile.closestApproachKm;
      const timeSinceClosestApproachSec = improvedApproach
        ? 0
        : missile.timeSinceClosestApproachSec + deltaTimeSec;

      if (targetDistanceKm < physics.interceptRadiusKm) {
        interceptedTargetIds.add(target.id);
        emitEvent(EVENT_TYPE.TARGET_INTERCEPTED, {
          targetId: target.id,
          trackId: missile.trackId,
          missileId: missile.id,
          batteryId: missile.sourceBatteryId,
        });
      } else if (flight.terminated) {
        emitEvent(EVENT_TYPE.INTERCEPTOR_FAILED, {
          missileId: missile.id,
          trackId: missile.trackId,
          reason: INTERCEPTOR_FAILURE_REASON.ENERGY_DEPLETED,
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
          closestApproachKm,
          timeSinceClosestApproachSec,
          trajectory: shouldAddTrajectoryPoint
            ? [...missile.trajectory, { lat: nextLat, lng: nextLng }].slice(-36)
            : missile.trajectory,
          lat: nextLat, lng: nextLng,
        });
      }
    });

    const survivingTargets = updatedTargets.filter(target => !interceptedTargetIds.has(target.id));
    const survivingTargetIds = new Set(survivingTargets.map(target => target.id));
    const survivingTracks = updatedTracks.filter(track => survivingTargetIds.has(track.targetId));
    const selectedTrackStillExists = survivingTracks.some(track => track.id === state.selectedTrackId);

    return {
      simulationTime: nextSimulationTime,
      batteries: batteriesWithScanFeedback,
      airTargets: survivingTargets,
      tracks: survivingTracks,
      missiles: activeMissiles,
      nextTrackSequence,
      spawnedTargetIds: [...spawnedTargetIds],
      events: events.slice(-100),
      nextEventSequence,
      selectedTrackId: selectedTrackStillExists ? state.selectedTrackId : null,
      selectedBatteryId: selectedTrackStillExists ? state.selectedBatteryId : null,
    };
  })
}));
