import { Fragment, memo, Profiler, useEffect, useMemo, useRef, useState } from 'react';
import Map, { Layer, Marker, Source, useMap } from 'react-map-gl/maplibre';
import * as maplibregl from 'maplibre-gl';
// Bundle the module worker's dependencies too: a plain ?url leaves its relative
// maplibre-gl-shared.mjs import missing in production (all GeoJSON layers stall).
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import HUD from '../ui/HUD.jsx';
import {
  INTERCEPTOR_LIFECYCLE_STATE,
  PHYSICS_UPDATE_HZ,
  SENSOR_MODE,
  getAdaptiveVisualUpdateHz,
  useEngine,
  VISUAL_UPDATE_HZ,
} from '../store/engine.js';
import {
  markVisualFrame,
  recordReactRender,
  samplePerformance,
  setPerformanceMonitoringEnabled,
} from '../store/performanceMonitor.js';
import { getDestinationPoint, getDistanceKm } from '../store/geo.js';
import { GAME_MODE_CONFIG, GAME_MODE, UI_LANGUAGE, useGameStore } from '../store/gameStore.js';
import { RADAR_SCAN_TYPE } from '../store/radarSystem.js';
import { calculateRadarDetection, getRadarSensorProfile } from '../store/sensorDetection.js';
import { SIMPLE_TARGET_TYPE, THEATER_OBJECTS } from '../store/scenarios.js';
import { EVENT_TYPE } from '../store/simulationEvents.js';
import { TRACK_STATE } from '../store/trackSystem.js';
import { SIMPLE_MAP_THEME, useViewStore } from '../store/viewStore.js';
import {
  INTERCEPT_EFFECT_VISUAL_PROFILE,
  MISSILE_TRAIL_VISUAL_PROFILE,
} from '../data/visualEffectProfiles.js';
import TacticalAssetIcon from '../ui/TacticalAssetIcon.jsx';
import {
  COMMAND_MAP_BOUNDS,
  COMMAND_MAP_ALIGNMENT_DEBUG,
  COMMAND_MAP_MAX_ZOOM,
  COMMAND_MAP_MIN_ZOOM,
  COMMAND_MAP_PAN_BOUNDS,
  COMMAND_MAP_STYLE,
  SATELLITE_MAP_STYLE,
  getCommandMapCoverView,
} from './commandMapStyle.js';
import { getInterceptorSpec } from '../data/interceptors.js';
import {
  getSystemAssetId,
  getTargetAssetId,
  getTargetDisplayName,
  LIGHT_TARGET_MODEL,
  LIGHT_TARGET_MODEL_OPTIONS,
} from '../data/lightModeAssets.js';
import LightMapSprite from '../ui/LightMapSprite.jsx';
import { ISKANDER_GAMEPLAY_PROFILE } from '../store/simpleBallisticProfile.js';
import {
  BALLISTIC_MANEUVER_MODE,
  TERMINAL_CORRECTION_ANGLES,
  TERMINAL_CORRECTION_COUNTS,
  TERMINAL_CORRECTION_SIDES,
} from '../data/ballisticTargetProfiles.js';
import { localizeObjective, localizeTechnicalTerm } from '../data/uiLocalization.js';
import { getMapObjectSizePx, MAP_OBJECT_CLASS } from '../data/mapVisualProfiles.js';
import { useContentStore } from '../store/contentStore.js';
import { useProtectedObjectStore } from '../store/protectedObjectStore.js';
import { compileUserScenario } from '../content/scenarioCompiler.js';
import { useDesignSurface } from '../store/designStore.js';
import { DesignModeButton } from '../ui/DesignModeOverlay.jsx';
import { getLaunchProfile } from '../store/launchProfileStore.js';
import { getVisualLaunchOffset } from '../ui/launchVisuals.js';
import InterpolatedMapMarker from '../ui/InterpolatedMapMarker.jsx';
import { formatTrackLabelData } from '../ui/trackLabelFormatting.js';
import { CONTROLLABLE_CAMERA_MODE, CONTROLLABLE_CONTROL_MODE } from '../store/controllableAirEntity.js';
import { useSandboxSpawnDraftStore } from '../store/sandboxSpawnDraftStore.js';
import { CONTROLLABLE_AIR_PROFILE_IDS } from '../data/controllableAirProfiles.js';
import { getInterpolatedMarkerPosition } from '../ui/markerInterpolationRegistry.js';
import { registerMarkerInterpolator } from '../ui/markerAnimationLoop.js';
import {
  DebugRow,
  DebugSection,
  DebugStatus,
  DebugTelemetryCard,
} from '../ui/DebugTelemetryCard.jsx';

// MapLibre v6 ships its module worker as a separate file. Passing the emitted URL
// explicitly keeps production builds from guessing a non-existent sibling path.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

const SIMPLE_MAP_STYLES = Object.freeze({
  [SIMPLE_MAP_THEME.DARK]: {
    version: 8,
    sources: {
      base: {
        type: 'raster',
        tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap © CARTO',
      },
    },
    layers: [{ id: 'dark-operational-map', type: 'raster', source: 'base' }],
  },
  [SIMPLE_MAP_THEME.LIGHT]: {
    ...COMMAND_MAP_STYLE,
  },
  [SIMPLE_MAP_THEME.SATELLITE]: {
    ...SATELLITE_MAP_STYLE,
  },
});

const EMPTY_FEATURE_COLLECTION = Object.freeze({ type: 'FeatureCollection', features: [] });
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const isInterceptorMotorActive = missile => missile.phase === 'POWERED'
  || missile.kinematicPhase === 'BOOST'
  || ['BOOST', 'SUSTAIN', 'POWERED'].includes(missile.motorState);

const lineFeature = coordinates => ({
  type: 'FeatureCollection',
  features: coordinates.length > 1 ? [{
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates },
  }] : [],
});

const getMapDebugState = (map, viewState = null) => {
  const center = viewState ?? map.getCenter();
  const zoom = viewState?.zoom ?? map.getZoom();
  const scale = 2 ** zoom;
  const worldSize = 512 * scale;
  const longitude = center.longitude ?? center.lng;
  const latitude = center.latitude ?? center.lat;
  const latitudeRadians = latitude * Math.PI / 180;
  const centerWorldX = ((longitude + 180) / 360) * worldSize;
  const centerWorldY = (1 - Math.log(Math.tan(latitudeRadians) + (1 / Math.cos(latitudeRadians))) / Math.PI) / 2 * worldSize;
  const canvas = map.getCanvas();
  const bounds = map.getBounds();
  return {
    longitude, latitude, zoom, scale,
    translateX: canvas.clientWidth / 2 - centerWorldX,
    translateY: canvas.clientHeight / 2 - centerWorldY,
    bounds: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
  };
};

function MapAlignmentDebugLayer() {
  return <Source id="map-alignment-debug" type="geojson" data={COMMAND_MAP_ALIGNMENT_DEBUG.points}>
    <Layer id="map-alignment-debug-points" type="circle" paint={{
      'circle-radius': 6, 'circle-color': '#ff2f7d', 'circle-opacity': 0.9,
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5,
    }} />
    <Layer id="map-alignment-debug-labels" type="symbol" layout={{
      'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 10,
      'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-allow-overlap': true,
    }} paint={{ 'text-color': '#a40042', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 }} />
  </Source>;
}

const getRemainingTargetDistanceKm = (target, position = target?.position) => {
  if (!target?.route?.length || !position) return null;
  const remainingWaypoints = target.route.slice(target.waypointIndex);
  if (remainingWaypoints.length === 0) return 0;
  let distanceKm = getDistanceKm(
    position.lat,
    position.lng,
    remainingWaypoints[0].lat,
    remainingWaypoints[0].lng,
  );
  for (let index = 1; index < remainingWaypoints.length; index += 1) {
    distanceKm += getDistanceKm(
      remainingWaypoints[index - 1].lat,
      remainingWaypoints[index - 1].lng,
      remainingWaypoints[index].lat,
      remainingWaypoints[index].lng,
    );
  }
  return distanceKm;
};

const getLaunchVisualStyle = (launchState, mapZoom) => {
  const offset = getVisualLaunchOffset({ ...launchState, mapZoom });
  return {
    '--launch-offset-x': `${offset.x}px`,
    '--launch-offset-y': `${offset.y}px`,
    '--launch-departure-scale': `${offset.scale}`,
  };
};

function LaunchDebugLayer({ pendingLaunches, missiles, mapZoom }) {
  return <>
    {pendingLaunches.map(launch => (
      <Marker key={`launch-debug-pre-${launch.id}`} longitude={launch.lng} latitude={launch.lat} anchor="center">
        <div className="launch-debug-point launch-debug-point--visual" style={getLaunchVisualStyle(launch, mapZoom)}>
          <i /><b>VISUAL LAUNCH POINT · PRE_LAUNCH</b>
          {launch.launchProfile.launchMode !== 'VERTICAL' && <span style={{ '--launch-heading': `${launch.heading}deg` }} />}
        </div>
      </Marker>
    ))}
    {missiles.filter(missile => missile.launchWorldPosition && missile.flightTime < 4).map(missile => (
      <Fragment key={`launch-debug-${missile.id}`}>
        <Marker longitude={missile.launchWorldPosition.lng} latitude={missile.launchWorldPosition.lat} anchor="center">
          <div className="launch-debug-point launch-debug-point--visual" style={getLaunchVisualStyle({ ...missile, flightTime: 0 }, mapZoom)}>
            <i /><b>VISUAL LAUNCH POINT</b>
            {missile.launchMode !== 'VERTICAL' && <span style={{ '--launch-heading': `${missile.initialLaunchHeading}deg` }} />}
          </div>
        </Marker>
        <Marker longitude={(missile.worldPosition ?? missile).lng} latitude={(missile.worldPosition ?? missile).lat} anchor="center">
          <div className="launch-debug-point launch-debug-point--missile">
            <i /><b>WORLD · {missile.launchPhase} · ALT {Math.round(missile.altitudeM)} m · V/S {Math.round(missile.verticalSpeedMps ?? 0)} m/s</b>
          </div>
        </Marker>
      </Fragment>
    ))}
  </>;
}

function TargetHoverData({ speedKmh, distanceKm, ru }) {
  return (
    <div className="target-hover-data">
      <span>{ru ? 'СКОРОСТЬ' : 'SPEED'} <b>{speedKmh === null ? '—' : `${Math.round(speedKmh)} км/ч`}</b></span>
      <span>{ru ? 'ДО ОБЪЕКТА' : 'TO OBJECTIVE'} <b>{distanceKm === null ? '—' : `${distanceKm.toFixed(1)} км`}</b></span>
    </div>
  );
}

function CommandTrackLabel({ track, distanceKm, target, language }) {
  const data = formatTrackLabelData(track, distanceKm, language);
  const displayName = track.state === TRACK_STATE.IDENTIFIED && target
    ? getTargetDisplayName(target)
    : null;
  return <span className={`simple-track__label${data.approximate ? ' is-estimated' : ''}`}>
    <b>{data.id}{displayName ? ` · ${displayName}` : ''}</b>
    <small>{data.distanceText}</small>
    <small>{data.altitudeText}</small>
    <small>{data.speedText}{data.approximate ? ` · ${localizeTechnicalTerm('EST', language)}` : ''}</small>
  </span>;
}

const getTargetLabel = (type, modelId = null) => {
  if (modelId) return getTargetDisplayName(modelId);
  if (type === SIMPLE_TARGET_TYPE.CRUISE_MISSILE) return 'Cruise missile';
  if (type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE) return 'Искандер-М';
  return 'Герань-2';
};

function SimpleModeSceneContent({ sandboxMode = false, developerMode = false, resumeSimulation = false }) {
  const returnToMenu = useGameStore(state => state.returnToMenu);
  const openFpvFeed = useGameStore(state => state.openFpvFeed);
  const commandViewState = useGameStore(state => state.commandViewState);
  const saveCommandViewState = useGameStore(state => state.saveCommandViewState);
  const language = useGameStore(state => state.language);
  const selectedScenarioId = useGameStore(state => state.activeScenarioId);
  const userScenarios = useContentStore(state => state.userScenarios);
  const userAssets = useContentStore(state => state.userAssets);
  const ru = language === UI_LANGUAGE.RU;
  const tick = useEngine(state => state.tick);
  const publishVisualSnapshot = useEngine(state => state.publishVisualSnapshot);
  const configureSimulationProfile = useEngine(state => state.configureSimulationProfile);
  const resetScenario = useEngine(state => state.resetScenario);
  const draftBattery = useEngine(state => state.draftBattery);
  const visualSnapshot = useEngine(state => state.visualSnapshot);
  const {
    batteries,
    searchRadars,
    tracks,
    sensorContacts,
    airTargets: targets,
    controllableAirEntities: controllables,
    missiles,
    pendingLaunches,
    gunTracers,
    events,
    simulationTime,
  } = visualSnapshot;
  const activeScenarioId = visualSnapshot.activeScenario.id;
  const timeScale = useEngine(state => state.timeScale);
  const sensorMode = useEngine(state => state.sensorMode);
  const toggleSensorMode = useEngine(state => state.toggleSensorMode);
  const selectedTrackId = useEngine(state => state.selectedTrackId);
  const selectedMissileId = useEngine(state => state.selectedMissileId);
  const selectedBatteryId = useEngine(state => state.selectedBatteryId);
  const selectedSearchRadarId = useEngine(state => state.selectedSearchRadarId);
  const selectedControllableEntityId = useEngine(state => state.selectedControllableEntityId);
  const deployPhase = useEngine(state => state.deployPhase);
  const handleMapClick = useEngine(state => state.handleMapClick);
  const setSelectedTrack = useEngine(state => state.setSelectedTrack);
  const setSelectedMissile = useEngine(state => state.setSelectedMissile);
  const setSelectedBattery = useEngine(state => state.setSelectedBattery);
  const setSelectedSearchRadar = useEngine(state => state.setSelectedSearchRadar);
  const setSelectedControllableEntity = useEngine(state => state.setSelectedControllableEntity);
  const setControlledControllableEntity = useEngine(state => state.setControlledControllableEntity);
  const releaseControllableControl = useEngine(state => state.releaseControllableControl);
  const setControllableCameraMode = useEngine(state => state.setControllableCameraMode);
  const setControllableControlMode = useEngine(state => state.setControllableControlMode);
  const setControllableNavigationWaypoint = useEngine(state => state.setControllableNavigationWaypoint);
  const setControllableNavigationTrack = useEngine(state => state.setControllableNavigationTrack);
  const setTimeScale = useEngine(state => state.setTimeScale);
  const spawnSandboxTargets = useEngine(state => state.spawnSandboxTargets);
  const rotateInstalledComponent = useEngine(state => state.rotateInstalledComponent);
  const allEnemyTargetsVisible = useViewStore(state => state.layers.allEnemyTargets);
  const debugOverlayVisible = useViewStore(state => state.layers.debugOverlay);
  const protectedObjectsVisible = useViewStore(state => state.layers.protectedObjects);
  const toggleLayer = useViewStore(state => state.toggleLayer);
  const mapTheme = useViewStore(state => state.simpleMapTheme);
  const setMapTheme = useViewStore(state => state.setSimpleMapTheme);
  const [sandboxStartSelection, setSandboxStartSelection] = useState(false);
  const sandboxStartPosition = useSandboxSpawnDraftStore(state => state.startPosition);
  const setSandboxStartPosition = useSandboxSpawnDraftStore(state => state.setStartPosition);
  const [sandboxAimSelection, setSandboxAimSelection] = useState(false);
  const sandboxAimPosition = useSandboxSpawnDraftStore(state => state.aimPosition);
  const setSandboxAimPosition = useSandboxSpawnDraftStore(state => state.setAimPosition);
  const [selectedBallisticTargetId, setSelectedBallisticTargetId] = useState(null);
  const [mapZoom, setMapZoom] = useState(5.15);
  const [mapMinZoom, setMapMinZoom] = useState(COMMAND_MAP_MIN_ZOOM);
  const [mapDebug, setMapDebug] = useState(null);
  const [selectedMapAsset, setSelectedMapAsset] = useState(null);
  const [selectedProtectedObjectId, setSelectedProtectedObjectId] = useState(null);
  const [fpvWaypointEntityId, setFpvWaypointEntityId] = useState(null);
  const protectedObjects = useProtectedObjectStore(state => state.objects);
  const [performanceSnapshot, setPerformanceSnapshot] = useState(null);
  const [interceptVisuals, setInterceptVisuals] = useState([]);
  const [missileSmokeData, setMissileSmokeData] = useState(EMPTY_FEATURE_COLLECTION);
  const lastVisualPublishTimeRef = useRef(0);
  const shownInterceptIdsRef = useRef(new Set());
  const missileSmokeParticlesRef = useRef([]);
  const lastSmokeSampleRef = useRef(new globalThis.Map());
  const smokeFeatureCountRef = useRef(0);
  const mapRef = useRef(null);
  const mapMinZoomRef = useRef(COMMAND_MAP_MIN_ZOOM);
  const topbarDesign = useDesignSurface('game-topbar');
  const toolsMode = sandboxMode || developerMode;
  const selectedScenario = useMemo(
    () => userScenarios.find(scenario => scenario.id === selectedScenarioId) ?? null,
    [selectedScenarioId, userScenarios],
  );
  const compiledScenario = useMemo(() => compileUserScenario(selectedScenario, userAssets), [selectedScenario, userAssets]);

  useEffect(() => {
    setPerformanceMonitoringEnabled(developerMode);
    return () => setPerformanceMonitoringEnabled(false);
  }, [developerMode]);

  useEffect(() => {
    if (resumeSimulation) return;
    configureSimulationProfile(GAME_MODE_CONFIG[GAME_MODE.SIMPLE]);
    resetScenario(sandboxMode ? 'SANDBOX' : 'SIMPLE', sandboxMode ? null : compiledScenario);
  }, [configureSimulationProfile, resetScenario, sandboxMode, compiledScenario, resumeSimulation]);

  useEffect(() => {
    const fixedStepSec = 1 / PHYSICS_UPDATE_HZ;
    const maximumSubsteps = 8;
    let previousTimestamp = window.performance.now();
    let accumulatorSec = 0;
    let animationFrame;
    const advance = timestamp => {
      const elapsedRealSec = Math.min(0.25, Math.max(0, (timestamp - previousTimestamp) / 1000));
      previousTimestamp = timestamp;
      if (timeScale > 0) {
        accumulatorSec = Math.min(
          accumulatorSec + elapsedRealSec * timeScale,
          fixedStepSec * maximumSubsteps,
        );
        let substeps = 0;
        while (accumulatorSec >= fixedStepSec && substeps < maximumSubsteps) {
          tick(timeScale);
          accumulatorSec -= fixedStepSec;
          substeps += 1;
        }
      } else accumulatorSec = 0;
      animationFrame = window.requestAnimationFrame(advance);
    };
    animationFrame = window.requestAnimationFrame(advance);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [tick, timeScale]);

  useEffect(() => {
    let animationFrame;
    const publish = now => {
      markVisualFrame(now);
      const engineState = useEngine.getState();
      const activeObjectCount = engineState.airTargets.length + engineState.missiles.length;
      const updateHz = getAdaptiveVisualUpdateHz(activeObjectCount);
      if (now - lastVisualPublishTimeRef.current >= 1000 / Math.min(VISUAL_UPDATE_HZ, updateHz)) {
        lastVisualPublishTimeRef.current = now;
        publishVisualSnapshot();
      }
      animationFrame = window.requestAnimationFrame(publish);
    };
    animationFrame = window.requestAnimationFrame(publish);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [publishVisualSnapshot]);

  useEffect(() => {
    if (!developerMode) return undefined;
    const interval = window.setInterval(() => setPerformanceSnapshot(samplePerformance()), 1000);
    return () => window.clearInterval(interval);
  }, [developerMode]);

  useEffect(() => {
    if (!events.length) shownInterceptIdsRef.current.clear();
    const shownIds = shownInterceptIdsRef.current;
    const newEvents = events.filter(event => (
      event.type === EVENT_TYPE.TARGET_INTERCEPTED && event.details.position
      && !shownIds.has(event.id)
    ));
    if (!newEvents.length) return undefined;
    newEvents.forEach(event => shownIds.add(event.id));
    const frame = window.requestAnimationFrame(() => {
      setInterceptVisuals(current => {
        const existingIds = new Set(current.map(visual => visual.event.id));
        const additions = newEvents
          .filter(event => !existingIds.has(event.id))
          .map(event => ({
            event,
            expiresAtMs: performance.now() + INTERCEPT_EFFECT_VISUAL_PROFILE.totalDurationMs,
          }));
        return additions.length ? [...current, ...additions] : current;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [events]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = performance.now();
      setInterceptVisuals(current => current.filter(visual => visual.expiresAtMs > now));
    }, 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = performance.now();
      const engineMissiles = useEngine.getState().missiles;
      const particles = missileSmokeParticlesRef.current
        .filter(particle => now - particle.createdAtMs < MISSILE_TRAIL_VISUAL_PROFILE.lifetimeMs);
      const activeIds = new Set();
      engineMissiles.forEach(missile => {
        activeIds.add(missile.id);
        if (!isInterceptorMotorActive(missile)) return;
        const previousSampleMs = lastSmokeSampleRef.current.get(missile.id) ?? -Infinity;
        if (now - previousSampleMs < 200) return;
        lastSmokeSampleRef.current.set(missile.id, now);
        const simulationPosition = missile.worldPosition ?? missile.position ?? missile;
        const visualPosition = getInterpolatedMarkerPosition(`missile:${missile.id}`);
        let lng = visualPosition?.longitude ?? simulationPosition.lng ?? simulationPosition.lon;
        let lat = visualPosition?.latitude ?? simulationPosition.lat;
        const map = mapRef.current;
        if (map && Number.isFinite(lng) && Number.isFinite(lat)) {
          const projected = map.project([lng, lat]);
          const headingRad = (missile.heading ?? 0) * Math.PI / 180;
          const rearOffsetPx = clamp(10 + (map.getZoom() - 5) * 1.5, 10, 17);
          const tail = map.unproject([
            projected.x - Math.sin(headingRad) * rearOffsetPx,
            projected.y + Math.cos(headingRad) * rearOffsetPx,
          ]);
          lng = tail.lng;
          lat = tail.lat;
        }
        const physics = getInterceptorSpec(missile.interceptorSpecId)?.gameplayPhysics;
        const thrustToMass = (physics?.referenceThrustN ?? 8_000)
          / Math.max(physics?.massKg ?? 120, 1);
        particles.push({
          id: `${missile.id}:${Math.round(now)}`,
          lng,
          lat,
          radius: clamp(13 + thrustToMass * 0.07, 15, 27),
          createdAtMs: now,
        });
      });
      if (particles.length > 6_000) particles.splice(0, particles.length - 6_000);
      for (const missileId of lastSmokeSampleRef.current.keys()) {
        if (!activeIds.has(missileId)) lastSmokeSampleRef.current.delete(missileId);
      }
      missileSmokeParticlesRef.current = particles;
      if (!particles.length && smokeFeatureCountRef.current === 0) return;
      smokeFeatureCountRef.current = particles.length;
      setMissileSmokeData({
        type: 'FeatureCollection',
        features: particles.map(particle => {
          const age = clamp(
            (now - particle.createdAtMs) / MISSILE_TRAIL_VISUAL_PROFILE.lifetimeMs,
            0,
            1,
          );
          return {
            type: 'Feature',
            id: particle.id,
            properties: {
              radius: particle.radius * (1 + age * 1.55),
              opacity: Math.pow(1 - age, 1.18) * 0.7,
            },
            geometry: { type: 'Point', coordinates: [particle.lng, particle.lat] },
          };
        }),
      });
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  const visibleTracks = allEnemyTargetsVisible
    ? []
    : tracks.filter(track => track.state !== TRACK_STATE.LOST);
  const renderedBatteries = draftBattery && draftBattery.entityType !== 'SEARCH_RADAR'
    ? [...batteries, draftBattery]
    : batteries;
  const targetsById = useMemo(() => new globalThis.Map(targets.map(target => [target.id, target])), [targets]);
  const batteriesById = useMemo(() => new globalThis.Map(
    [...batteries, ...searchRadars].map(battery => [battery.id, battery]),
  ), [batteries, searchRadars]);
  const visibleTrackByTargetId = useMemo(() => new globalThis.Map(
    tracks
      .filter(track => track.state !== TRACK_STATE.LOST)
      .map(track => [track.targetId, track]),
  ), [tracks]);
  const recentIntercepts = interceptVisuals;
  const selectedDebugTrack = tracks.find(track => track.id === selectedTrackId) ?? null;
  const selectedDebugTarget = targetsById.get(
    selectedDebugTrack?.targetId ?? selectedBallisticTargetId,
  ) ?? null;
  const selectedDebugRadarBattery = selectedMapAsset?.type === 'RADAR'
    || selectedMapAsset?.type === 'SEARCH_RADAR'
    ? [...batteries, ...searchRadars].find(battery => (
      selectedMapAsset.id.startsWith(`${battery.id}:`) || selectedMapAsset.id === battery.id
    )) ?? null
    : batteriesById.get(selectedDebugTrack?.sourceBatteryId) ?? null;

  const onMapClick = (event) => {
    const protectedObjectId = event.features?.find(feature => feature.layer?.id === 'command-protected-object-hit')?.properties?.id;
    if (protectedObjectId) {
      setSelectedProtectedObjectId(protectedObjectId);
      return;
    }
    setSelectedProtectedObjectId(null);
    if (fpvWaypointEntityId && !deployPhase) {
      setControllableNavigationWaypoint(fpvWaypointEntityId, {
        lat: event.lngLat.lat, lng: event.lngLat.lng,
      });
      setFpvWaypointEntityId(null);
      return;
    }
    if (toolsMode && sandboxAimSelection && !deployPhase) {
      setSandboxAimPosition({ lat: event.lngLat.lat, lng: event.lngLat.lng });
      setSandboxAimSelection(false);
      return;
    }
    if (toolsMode && sandboxStartSelection && !deployPhase) {
      setSandboxStartPosition({ lat: event.lngLat.lat, lng: event.lngLat.lng });
      setSandboxStartSelection(false);
      return;
    }
    if (debugOverlayVisible && !deployPhase) {
      setSelectedMissile(null);
      setSelectedBallisticTargetId(null);
    }
    handleMapClick(event.lngLat.lat, event.lngLat.lng);
  };

  const openCommandFpv = entity => {
    if (entity?.status !== 'ACTIVE') return;
    if (entity.controlMode === CONTROLLABLE_CONTROL_MODE.MANUAL
      && !setControlledControllableEntity(entity.id)) return;
    if (timeScale !== 1) setTimeScale(1);
    setControllableCameraMode(entity.id, CONTROLLABLE_CAMERA_MODE.FPV);
    openFpvFeed(sandboxMode ? 'SANDBOX' : 'SIMPLE', entity.id);
  };

  return (
    <div className={`simple-scene simple-scene--${mapTheme.toLowerCase()} ${toolsMode ? 'is-sandbox' : ''} ${developerMode ? 'is-developer' : ''} ${timeScale === 0 ? 'is-paused' : ''}`}>
      <Map
        ref={mapRef}
        mapLib={maplibregl}
        initialViewState={{
          bounds: COMMAND_MAP_BOUNDS,
          fitBoundsOptions: { padding: 0 },
          bearing: 0,
          pitch: 0,
        }}
        mapStyle={SIMPLE_MAP_STYLES[mapTheme]}
        maxBounds={COMMAND_MAP_PAN_BOUNDS}
        minZoom={mapMinZoom}
        maxZoom={COMMAND_MAP_MAX_ZOOM}
        dragRotate={false}
        touchPitch={false}
        pitchWithRotate={false}
        attributionControl={false}
        onLoad={event => {
          const minimumView = getCommandMapCoverView(event.target);
          mapMinZoomRef.current = minimumView.zoom;
          event.target.setMinZoom(minimumView.zoom);
          event.target.jumpTo(minimumView);
          if (commandViewState) event.target.jumpTo({
            center: [commandViewState.longitude, commandViewState.latitude],
            zoom: Math.max(minimumView.zoom, commandViewState.zoom),
            bearing: 0,
            pitch: 0,
          });
          setMapMinZoom(minimumView.zoom);
          if (developerMode) setMapDebug(getMapDebugState(event.target));
        }}
        onResize={event => {
          const map = event.target;
          const wasAtMinimum = map.getZoom() <= mapMinZoomRef.current + 0.05;
          const minimumView = getCommandMapCoverView(map);
          mapMinZoomRef.current = minimumView.zoom;
          map.setMinZoom(minimumView.zoom);
          setMapMinZoom(minimumView.zoom);
          if (wasAtMinimum || map.getZoom() < minimumView.zoom) map.jumpTo(minimumView);
        }}
        onClick={onMapClick}
        interactiveLayerIds={protectedObjectsVisible ? ['command-protected-object-hit'] : []}
        onMove={event => setMapZoom(event.viewState.zoom)}
        onMoveEnd={event => {
          saveCommandViewState({ longitude: event.viewState.longitude,
            latitude: event.viewState.latitude, zoom: event.viewState.zoom });
          if (developerMode) setMapDebug(getMapDebugState(event.target, event.viewState));
        }}
        cursor={deployPhase || sandboxStartSelection || fpvWaypointEntityId ? 'crosshair' : 'default'}
      >
        {developerMode && <MapAlignmentDebugLayer />}
        {protectedObjectsVisible && <CommandProtectedObjectLayer
          objects={protectedObjects.filter(object => object.enabled)}
          selectedId={selectedProtectedObjectId}
        />}
        {mapZoom >= 5.8 && THEATER_OBJECTS.map(objective => (
          <Marker key={objective.id} longitude={objective.position.lng} latitude={objective.position.lat} anchor="center">
            <TheaterObjectMarker objective={objective} mapZoom={mapZoom} language={language} />
          </Marker>
        ))}

        <RadarNetworkLayers
          batteries={[...renderedBatteries, ...searchRadars]}
          selectedBatteryId={selectedSearchRadarId ?? selectedBatteryId}
          mapTheme={mapTheme}
        />

        <TrackVectorLayers tracks={visibleTracks} selectedTrackId={selectedTrackId} />

        <InterceptorNetworkLayers missiles={missiles} tracks={tracks}
          smokeData={missileSmokeData} />

        {gunTracers.map(tracer => (
          <GunTracerLayer
            key={tracer.id}
            tracer={tracer}
            simulationTime={simulationTime}
            target={targetsById.get(tracer.targetId)}
          />
        ))}

        {allEnemyTargetsVisible && <TargetTrailsLayer targets={targets} />}

        {renderedBatteries.map(battery => (
          <BatteryMarkers
            key={`units-${battery.id}`}
            battery={battery}
            selected={battery.id === selectedBatteryId}
            selectedMapAsset={selectedMapAsset}
            isDraft={battery === draftBattery}
            mapZoom={mapZoom}
            language={language}
            onSelect={(asset) => {
              setSelectedMapAsset(asset);
              if (battery !== draftBattery) setSelectedBattery(battery.id);
            }}
            onRotate={(componentType, componentId, degrees) => (
              rotateInstalledComponent(battery.id, componentType, componentId, degrees)
            )}
          />
        ))}

        {searchRadars.map(radar => (
          <SearchRadarMarker
            key={radar.id}
            radar={radar}
            selected={radar.id === selectedSearchRadarId}
            mapZoom={mapZoom}
            language={language}
            onSelect={() => {
              setSelectedMapAsset({ id: radar.id, type: 'SEARCH_RADAR' });
              setSelectedSearchRadar(radar.id);
            }}
          />
        ))}

        {allEnemyTargetsVisible && targets.map(target => {
          const targetTrack = visibleTrackByTargetId.get(target.id);
          const sourceRadar = batteriesById.get(targetTrack?.sourceBatteryId);
          const sourcePosition = sourceRadar?.components?.radar ?? sourceRadar;
          const trackDistanceKm = targetTrack && Number.isFinite(sourcePosition?.lat)
            ? getDistanceKm(sourcePosition.lat, sourcePosition.lng,
              targetTrack.reportedPosition.lat, targetTrack.reportedPosition.lng)
            : null;
          return <TargetMarker
            key={target.id}
            target={target}
            simulationTime={simulationTime}
            language={language}
            track={targetTrack}
            trackDistanceKm={trackDistanceKm}
            onSelectTrack={setSelectedTrack}
            onSelectTarget={(targetId) => {
              setSelectedMissile(null);
              setSelectedBallisticTargetId(targetId);
            }}
          />;
        })}

        {!allEnemyTargetsVisible && visibleTracks.map(track => {
          const scanAge = simulationTime - track.lastUpdateTime;
          const target = targetsById.get(track.targetId);
          const identified = track.state === TRACK_STATE.IDENTIFIED;
          const targetDistanceKm = target ? getRemainingTargetDistanceKm(target, track.reportedPosition) : null;
          const sourceRadar = batteriesById.get(track.sourceBatteryId);
          const sourceRadarPosition = sourceRadar?.components?.radar ?? sourceRadar;
          const trackRangeKm = Number.isFinite(sourceRadarPosition?.lat)
            && Number.isFinite(sourceRadarPosition?.lng)
            ? getDistanceKm(
              sourceRadarPosition.lat,
              sourceRadarPosition.lng,
              track.reportedPosition.lat,
              track.reportedPosition.lng,
            )
            : targetDistanceKm;
          return (
            <InterpolatedMapMarker
              key={`marker-${track.id}`}
              longitude={track.reportedPosition.lng}
              latitude={track.reportedPosition.lat}
              simulationTime={simulationTime}
              presentationTrack={track}
              timeScale={timeScale}
              visualPositionKey={`track:${track.id}`}
              anchor="center"
            >
              <button
                className={`simple-track simple-track--${track.state.toLowerCase()} ${track.id === selectedTrackId ? 'is-selected' : ''} ${scanAge < 0.42 ? 'is-scan-hit' : ''}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedTrack(track.id);
                  if (target?.type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE) {
                    setSelectedMissile(null);
                    setSelectedBallisticTargetId(target.id);
                  } else {
                    setSelectedBallisticTargetId(null);
                  }
                }}
                title={track.id}
              >
                <span data-track-heading style={{ display: 'inline-flex' }}>{identified && target ? (
                  <LightMapSprite
                    assetId={getTargetAssetId(target)}
                    sourceUrl={target.customAssetUrl}
                    sourceOffsetX={target.customAssetOffsetX}
                    sourceOffsetY={target.customAssetOffsetY}
                    heading={track.reportedHeading ?? 0}
                    selected={track.id === selectedTrackId}
                    sizePx={getMapObjectSizePx(MAP_OBJECT_CLASS.TARGET, mapZoom) * (target.customAssetScale ?? 1)}
                  />
                ) : (
                  <span className={`simple-track__symbol simple-track__symbol--${getTrackSymbolType(track)}`}>
                    <TacticalAssetIcon type={getTargetAssetType(track.identifiedType)} />
                  </span>
                )}</span>
                <TargetHoverData speedKmh={track.reportedSpeedKmh} distanceKm={targetDistanceKm} ru={ru} />
                <CommandTrackLabel track={track} distanceKm={trackRangeKm} target={target} language={language} />
              </button>
            </InterpolatedMapMarker>
          );
        })}

        {controllables.map(entity => (
          <InterpolatedMapMarker key={`controllable-${entity.id}`}
            longitude={entity.position.lng} latitude={entity.position.lat}
            simulationTime={simulationTime} anchor="center">
            <button className="controllable-command-marker"
              title={entity.id}
              onClick={event => {
                event.stopPropagation();
                setSelectedControllableEntity(entity.id);
              }}>
              <span>◇</span><small>{entity.id}</small>
            </button>
          </InterpolatedMapMarker>
        ))}

        {pendingLaunches.filter(launch => launch.phase === 'LAUNCHING').map(launch => (
          <Marker key={launch.id} longitude={launch.lng} latitude={launch.lat} anchor="center" className="launch-sequence-marker">
            <div className={`launcher-sequence launcher-sequence--${launch.phase.toLowerCase()}`} style={getLaunchVisualStyle(launch, mapZoom)}>
              <i className="launcher-sequence__smoke" />
              <i className="launcher-sequence__flash" />
              {developerMode && <span className="launch-debug-vector" style={{ '--launch-heading': `${launch.heading}deg` }}><b>LAUNCH POINT</b></span>}
            </div>
          </Marker>
        ))}

        {developerMode && <LaunchDebugLayer pendingLaunches={pendingLaunches} missiles={missiles} mapZoom={mapZoom} />}

        {missiles.map(missile => {
          const missileWorldPosition = missile.worldPosition ?? missile;
          const sourceBattery = batteriesById.get(missile.sourceBatteryId);
          const category = getBatteryCategory(sourceBattery);
          const target = targetsById.get(missile.targetId);
          const targetDistanceKm = Number.isFinite(missile.distanceToTargetKm)
            ? missile.distanceToTargetKm
            : target ? getDistanceKm(
              missile.lat,
              missile.lng,
              target.position.lat,
              target.position.lng,
            ) : null;
          if (missile.lifecycleState === INTERCEPTOR_LIFECYCLE_STATE.SELF_DESTRUCT) {
            return (
              <InterpolatedMapMarker key={`marker-${missile.id}`} longitude={missileWorldPosition.lng} latitude={missileWorldPosition.lat} simulationTime={simulationTime} anchor="center">
                <div className="interceptor-self-destruct"><span /></div>
              </InterpolatedMapMarker>
            );
          }
          return (
          <InterpolatedMapMarker key={`marker-${missile.id}`}
            longitude={missileWorldPosition.lng} latitude={missileWorldPosition.lat}
            simulationTime={simulationTime} visualPositionKey={`missile:${missile.id}`}
            anchor="center">
            <button
              className={`simple-interceptor simple-interceptor--${missile.lifecycleState?.toLowerCase() ?? 'flying'} ${selectedMissileId === missile.id ? 'is-selected' : ''}`}
              style={getLaunchVisualStyle(missile, mapZoom)}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedBallisticTargetId(null);
                setSelectedMissile(missile.id);
              }}
              title={missile.id}
            >
              <LightMapSprite
                assetId={missile.launchProfile?.missileAssetId ?? getSystemAssetId(category, 'interceptor')}
                heading={missile.heading}
                rotationOffsetDeg={missile.spriteRotationOffsetDeg}
                mirrorX={missile.mirrorX}
                mirrorY={missile.mirrorY}
                visualScale={missile.visualScale}
                sizePx={getMapObjectSizePx(MAP_OBJECT_CLASS.INTERCEPTOR, mapZoom)}
              />
              <div className="interceptor-telemetry" aria-label={ru ? 'Параметры перехватчика' : 'Interceptor telemetry'}>
                <span>{Math.round(missile.speedKmh)} <i>{ru ? 'км/ч' : 'km/h'}</i></span>
                <span>{targetDistanceKm === null ? '—' : targetDistanceKm.toFixed(1)} <i>{ru ? 'км' : 'km'}</i></span>
              </div>
              {missile.flightTime < 0.55 && <i className="launch-flash" />}
            </button>
          </InterpolatedMapMarker>
          );
        })}

        {recentIntercepts.map(({ event }) => (
          <Marker
            key={event.id}
            longitude={event.details.position.lng}
            latitude={event.details.position.lat}
            anchor="center"
          >
            <div className="intercept-effect" aria-hidden="true">
              <i className="intercept-effect__flash" />
              <i className="intercept-effect__blast" />
              <i className="intercept-effect__smoke intercept-effect__smoke--a" />
              <i className="intercept-effect__smoke intercept-effect__smoke--b" />
              <i className="intercept-effect__smoke intercept-effect__smoke--c" />
            </div>
          </Marker>
        ))}

        {sandboxStartPosition && (
          <Marker longitude={sandboxStartPosition.lng} latitude={sandboxStartPosition.lat} anchor="center">
            <div className="sandbox-start-marker"><span>+</span><small>{localizeTechnicalTerm('LAUNCH POINT', language)}</small></div>
          </Marker>
        )}
        {sandboxAimPosition && (
          <Marker longitude={sandboxAimPosition.lng} latitude={sandboxAimPosition.lat} anchor="center">
            <div className="sandbox-start-marker sandbox-aim-marker"><span>×</span><small>{localizeTechnicalTerm('AIM POINT', language)}</small></div>
          </Marker>
        )}
      </Map>
      {selectedControllableEntityId && (() => {
        const entity = controllables.find(candidate => candidate.id === selectedControllableEntityId);
        if (!entity) return null;
        return <aside className="fpv-command-card">
          <header><strong>{entity.id}</strong><span>{localizeTechnicalTerm(entity.controlMode, language)}</span></header>
          <small>{localizeTechnicalTerm('LINK', language)} {Math.round(entity.linkQuality * 100)}% · {localizeTechnicalTerm('BATTERY', language)} {Math.round(entity.batteryRemaining * 100)}%</small>
          <small>{localizeTechnicalTerm(entity.navigation?.status ?? 'READY', language)}</small>
          <div>
            <button className={entity.controlMode === CONTROLLABLE_CONTROL_MODE.MANUAL ? 'is-active' : ''}
              onClick={() => { setControllableControlMode(entity.id, CONTROLLABLE_CONTROL_MODE.MANUAL);
                setControlledControllableEntity(entity.id); }}>{localizeTechnicalTerm('MANUAL', language)}</button>
            <button className={entity.controlMode === CONTROLLABLE_CONTROL_MODE.HOLD ? 'is-active' : ''}
              onClick={() => { releaseControllableControl();
                setControllableControlMode(entity.id, CONTROLLABLE_CONTROL_MODE.HOLD); }}>{localizeTechnicalTerm('HOLD', language)}</button>
            <button disabled={!entity.selectedTrackId}
              onClick={() => setControllableNavigationTrack(entity.id, entity.selectedTrackId)}>{localizeTechnicalTerm('AUTO TRACK', language)}</button>
          </div>
          <div>
            <button className={fpvWaypointEntityId === entity.id ? 'is-active' : ''}
              onClick={() => setFpvWaypointEntityId(entity.id)}>{localizeTechnicalTerm('SET WAYPOINT', language)}</button>
            <button onClick={() => openCommandFpv(entity)}>{localizeTechnicalTerm('OPEN FPV', language)}</button>
          </div>
        </aside>;
      })()}
      {developerMode && mapDebug && (
        <output className="map-transform-debug">
          MAP ALIGN DEBUG · ZOOM {mapDebug.zoom.toFixed(2)} · PAN {mapDebug.longitude.toFixed(3)} / {mapDebug.latitude.toFixed(3)}<br />
          SCALE {mapDebug.scale.toFixed(2)} · TRANSLATE {mapDebug.translateX.toFixed(1)} / {mapDebug.translateY.toFixed(1)}<br />
          SVG VIEWBOX {COMMAND_MAP_ALIGNMENT_DEBUG.originalViewBox}<br />
          UKRAINE BBOX {COMMAND_MAP_ALIGNMENT_DEBUG.ukraineBounds} · WORLD BBOX {COMMAND_MAP_ALIGNMENT_DEBUG.worldBounds}<br />
          CURRENT BOUNDS {mapDebug.bounds.map(value => value.toFixed(2)).join(' / ')}
        </output>
      )}
      {developerMode && performanceSnapshot && (
        <output className="simulation-performance-debug">
          PERF · FPS {performanceSnapshot.fps.toFixed(0)} · SIM TPS {performanceSnapshot.simulationTps.toFixed(0)}<br />
          FRAME {performanceSnapshot.frameMs.toFixed(1)} / MAX {performanceSnapshot.frameMaxMs.toFixed(1)} MS<br />
          SIM {performanceSnapshot.simulationUpdateMs.toFixed(2)} / MAX {performanceSnapshot.simulationUpdateMaxMs.toFixed(2)} MS<br />
          RENDER {performanceSnapshot.renderMs.toFixed(2)} / MAX {performanceSnapshot.renderMaxMs.toFixed(2)} MS<br />
          REACT {performanceSnapshot.reactRendersPerSec.toFixed(0)}/S · STORE {performanceSnapshot.storeWritesPerSec.toFixed(0)}/S<br />
          SNAPSHOTS {performanceSnapshot.visualPublishesPerSec.toFixed(0)}/S<br />
          {Object.entries(performanceSnapshot.subsystems).map(([name, timing]) => (
            <Fragment key={name}>
              {name.replace('_MS', '')} {timing.averageMs.toFixed(2)} / {timing.maxMs.toFixed(2)} MS<br />
            </Fragment>
          ))}
          TARGETS {targets.length} · MISSILES {missiles.length} · TRACKS {tracks.length} · RADARS {batteries.filter(battery => battery.components.radar).length}
        </output>
      )}

      <div className="simple-scene__topbar" data-design-id="game-topbar" data-design-name="Верхняя панель" data-design-dynamic-text="true" style={topbarDesign}>
        <button onClick={returnToMenu}>← {ru ? 'Меню' : 'Menu'}</button>
        <span>{developerMode ? (ru ? 'Режим разработчика' : 'Developer Mode') : sandboxMode ? (ru ? 'Полигон' : 'Sandbox') : (ru ? 'Командный режим' : 'Simple Mode')} · {targets.length} {ru ? 'целей' : 'airborne'}</span>
        {[SIMPLE_MAP_THEME.DARK, SIMPLE_MAP_THEME.SATELLITE, SIMPLE_MAP_THEME.LIGHT].map(theme => (
          <button key={theme} className={`map-theme-toggle ${mapTheme === theme ? 'is-active' : ''}`} onClick={() => setMapTheme(theme)}>{ru ? ({ DARK: 'ТЁМНАЯ', SATELLITE: 'СПУТНИК', LIGHT: 'КОМАНДНАЯ' }[theme]) : (theme === SIMPLE_MAP_THEME.LIGHT ? 'COMMAND' : theme)}</button>
        ))}
        <button
          className={`targets-visibility-toggle ${allEnemyTargetsVisible ? 'is-all-targets is-active' : 'is-radar-only'}`}
          data-design-dynamic-text="true"
          onClick={() => toggleLayer('allEnemyTargets')}
        >
          {ru ? 'Цели' : 'Tracks'} {allEnemyTargetsVisible ? (ru ? 'ВСЕ' : 'ALL') : (ru ? 'ПО РЛС' : 'RADAR')}
        </button>
        <button
          className={debugOverlayVisible ? 'is-active' : ''}
          data-design-dynamic-text="true"
          aria-label={ru ? 'Режим отладки' : 'Debug mode'}
          onClick={() => toggleLayer('debugOverlay')}
        >
          DEBUG {debugOverlayVisible ? 'ON' : 'OFF'}
        </button>
        <button
          className={protectedObjectsVisible ? 'is-active' : ''}
          onClick={() => toggleLayer('protectedObjects')}
        >
          {ru ? 'ОБЪЕКТЫ' : 'OBJECTS'} {protectedObjectsVisible ? 'ON' : 'OFF'}
        </button>
        {toolsMode && (
          <button
            className={sensorMode === SENSOR_MODE.IDEAL ? 'is-active' : ''}
            data-design-dynamic-text="true"
            onClick={toggleSensorMode}
          >
            SENSOR {sensorMode}
          </button>
        )}
        <DesignModeButton compact />
      </div>

      {toolsMode && (
        <SandboxPanel
          startPosition={sandboxStartPosition}
          aimPosition={sandboxAimPosition}
          selectingStart={sandboxStartSelection}
          selectingAim={sandboxAimSelection}
          onSelectStart={() => {
            setSandboxAimSelection(false);
            setSandboxStartSelection(value => !value);
          }}
          onSelectAim={() => {
            setSandboxStartSelection(false);
            setSandboxAimSelection(value => !value);
          }}
          onSpawn={spawnSandboxTargets}
          language={language}
        />
      )}
      {debugOverlayVisible && selectedMissileId && (
        <MissileDebugPanel key={selectedMissileId} missileId={selectedMissileId} />
      )}
      {debugOverlayVisible && !selectedMissileId && selectedDebugRadarBattery && selectedDebugTarget && (
        <RadarSensorDebugPanel
          battery={selectedDebugRadarBattery}
          target={selectedDebugTarget}
          track={selectedDebugTrack}
          contacts={sensorContacts}
          simulationTime={simulationTime}
        />
      )}
      {debugOverlayVisible && !selectedMissileId && !selectedDebugRadarBattery && selectedBallisticTargetId && (
        <BallisticDebugPanel key={selectedBallisticTargetId} targetId={selectedBallisticTargetId} language={language} />
      )}
      {debugOverlayVisible && !selectedMissileId && selectedSearchRadarId && !selectedDebugTarget && (
        <SearchRadarDebugPanel radarId={selectedSearchRadarId} contacts={sensorContacts} simulationTime={simulationTime} />
      )}
      <ThreatAlerts key={activeScenarioId} events={events} language={language} />
      <HUD simpleMode />
    </div>
  );
}

function RadarSensorDebugPanel({ battery, target, track, contacts, simulationTime }) {
  const detection = calculateRadarDetection({ battery, target });
  const radarProfile = getRadarSensorProfile(battery);
  const relevantContacts = contacts.filter(contact => contact.targetId === target.id);
  const sourceContact = relevantContacts.find(contact => contact.sourceBatteryId === battery.id) ?? null;
  const measurementAgeSec = sourceContact?.lastScanTime == null
    ? Number.POSITIVE_INFINITY
    : simulationTime - sourceContact.lastScanTime;
  const geometryStatus = !detection.insideSector ? 'OUTSIDE SECTOR'
    : !detection.hasLineOfSight ? 'BELOW HORIZON'
      : detection.detectable ? 'VALID' : 'MARGINAL';
  return (
    <DebugTelemetryCard title="RADAR / SENSOR" entityId={battery.id} footer="SENSOR V2 · deterministic measurement">
      <DebugSection title="GEOMETRY">
        <DebugRow label="RANGE" value={`${detection.distanceKm.toFixed(1)} / ${battery.radarRangeKm} km`} />
        <DebugRow label="RADIO HORIZON" value={`${detection.radioHorizonKm.toFixed(1)} km`} />
        <DebugRow label="ANTENNA / TARGET" value={`${radarProfile.antennaHeightM} / ${Math.round(detection.targetHeightM)} m`} />
        <DebugRow label="SECTOR" value={`${battery.radarSector}° · ${detection.insideSector ? 'IN' : 'OUT'}`} />
        <DebugRow label="LOS" value={<DebugStatus value={geometryStatus} />} />
      </DebugSection>
      <DebugSection title="DETECTION">
        <DebugRow label="SIGNATURE" value={detection.radarSignature.toFixed(2)} />
        <DebugRow label="RANGE FACTOR" value={detection.rangeFactor.toFixed(3)} />
        <DebugRow label="CLUTTER FACTOR" value={detection.clutterFactor.toFixed(3)} />
        <DebugRow label="DETECTION SCORE" value={`${Math.round(detection.detectionScore * 100)}%`} />
        <DebugRow label="SCAN INTERVAL" value={`${battery.scanRateSec.toFixed(2)} s`} />
        <DebugRow label="NEXT OPPORTUNITY" value={`${Math.max(0, battery.scanRateSec - (Number.isFinite(measurementAgeSec) ? measurementAgeSec % battery.scanRateSec : 0)).toFixed(2)} s`} />
      </DebugSection>
      <DebugSection title="TRACK">
        <DebugRow label="SENSORS SEEING" value={relevantContacts.filter(contact => contact.lastScanTime != null).length} />
        <DebugRow label="CONTRIBUTORS" value={(track?.contributingSensors ?? []).join(', ') || '—'} />
        <DebugRow label="BEST SENSOR" value={track?.bestSensorId ?? '—'} />
        <DebugRow label="LAST SENSOR" value={track?.lastMeasurementSensorId ?? '—'} />
        <DebugRow label="EVIDENCE" value={(sourceContact?.evidence ?? 0).toFixed(3)} />
        <DebugRow label="MEASUREMENT AGE" value={Number.isFinite(measurementAgeSec) ? `${measurementAgeSec.toFixed(2)} s` : 'NONE'} />
        <DebugRow label="TRACK STATE" value={track?.state ?? 'NO TRACK'} />
        <DebugRow label="TRACK QUALITY" value={`${Math.round((track?.trackQuality ?? 0) * 100)}%`} />
        <DebugRow label="POSITION UNCERTAINTY" value={`${Math.round(track?.positionUncertaintyM ?? 0)} m`} />
        <DebugRow label="VELOCITY UNCERTAINTY" value={`${(track?.velocityUncertaintyMps ?? 0).toFixed(1)} m/s`} />
      </DebugSection>
    </DebugTelemetryCard>
  );
}

function SearchRadarDebugPanel({ radarId, contacts, simulationTime }) {
  const radar = useThrottledEngineEntity(radarId, 'searchRadars');
  if (!radar) return null;
  const profile = getRadarSensorProfile(radar);
  const sensorId = radar.components.radar?.id;
  const recentScanTime = contacts
    .filter(contact => contact.sourceRadarId === sensorId && contact.lastScanTime != null)
    .reduce((latest, contact) => Math.max(latest, contact.lastScanTime), Number.NEGATIVE_INFINITY);
  const scanPeriodSec = radar.scanRateSec;
  return <DebugTelemetryCard title="SEARCH RADAR" entityId={radar.debugName} footer="SENSOR V2 · PROFILE">
    <DebugSection title="PROFILE">
      <DebugRow label="ENTITY" value={radar.entityType} />
      <DebugRow label="STATUS" value={radar.operational ? 'ACTIVE' : 'OFF'} />
      <DebugRow label="MODE" value={radar.scanModeLabel} />
      <DebugRow label="NOMINAL RANGE" value={`${radar.radarRangeKm} km`} />
      <DebugRow label="SCAN PERIOD" value={`${scanPeriodSec.toFixed(1)} s`} />
      <DebugRow label="RPM" value={(60 / scanPeriodSec).toFixed(1)} />
      <DebugRow label="CURRENT BEARING" value={`${(radar.components.radar?.scanState?.currentAzimuth ?? 0).toFixed(1)}°`} />
      <DebugRow label="RECENT MEASUREMENT" value={Number.isFinite(recentScanTime) ? `${Math.max(0, simulationTime - recentScanTime).toFixed(1)} s ago` : 'NONE'} />
      <DebugRow label="NEXT MEASUREMENT" value="BEAM / SCHEDULE DEPENDENT" />
      <DebugRow label="ANTENNA HEIGHT" value={`${profile.antennaHeightM} m`} />
    </DebugSection>
    <DebugSection title="QUALITY">
      <DebugRow label="SENSITIVITY" value={profile.sensitivity.toFixed(2)} />
      <DebugRow label="SMALL TARGET" value={profile.smallTargetPerformance.toFixed(2)} />
      <DebugRow label="LOW ALTITUDE" value={(profile.lowAltitudePerformance ?? 1).toFixed(2)} />
      <DebugRow label="TRACK GAIN" value={profile.trackQualityGain.toFixed(2)} />
      <DebugRow label="CLASSIFICATION" value={profile.classificationGain.toFixed(2)} />
      <DebugRow label="ALT UNCERTAINTY ×" value={(profile.altitudeUncertaintyMultiplier ?? 1).toFixed(2)} />
    </DebugSection>
  </DebugTelemetryCard>;
}

export default function SimpleModeScene(props) {
  if (!props.developerMode) return <SimpleModeSceneContent {...props} />;
  return <Profiler id="simple-mode-scene" onRender={(_id, _phase, actualDuration) => recordReactRender(actualDuration)}>
    <SimpleModeSceneContent {...props} />
  </Profiler>;
}

const createArcCoordinates = ({ lat, lng, radiusKm, startDeg = 0, spanDeg = 360 }) => {
  const pointCount = Math.max(16, Math.ceil(Math.abs(spanDeg) / 5));
  return Array.from({ length: pointCount + 1 }, (_, index) => {
    const point = getDestinationPoint(lat, lng, startDeg + spanDeg * index / pointCount, radiusKm);
    return [point.lng, point.lat];
  });
};

const createRadarPolygon = (radar, radiusKm, startDeg = 0, spanDeg = 360) => {
  const arc = createArcCoordinates({ ...radar, radiusKm, startDeg, spanDeg });
  const coordinates = spanDeg >= 359.9
    ? [...arc, arc[0]]
    : [[radar.lng, radar.lat], ...arc, [radar.lng, radar.lat]];
  return { type: 'Polygon', coordinates: [coordinates] };
};

const RADAR_LAYER_COLORS = Object.freeze({
  [SIMPLE_MAP_THEME.LIGHT]: { coverage: '#245c4e', stroke: '#1f4942', sweep: '#376f67', beam: '#1a4c43', origin: '#224d44' },
  [SIMPLE_MAP_THEME.SATELLITE]: { coverage: '#5b918b', stroke: '#8fbfb8', sweep: '#7ba8a0', beam: '#b1dad0', origin: '#b9ded6' },
  [SIMPLE_MAP_THEME.DARK]: { coverage: '#588470', stroke: '#81ae97', sweep: '#82aa91', beam: '#a7cfb5', origin: '#b4d8c0' },
});

function RadarNetworkLayers({ batteries, selectedBatteryId, mapTheme }) {
  const data = useMemo(() => {
    const features = [];
    batteries.forEach(battery => {
      const radar = battery.components.radar;
      if (!radar?.scanState) return;
      const isElectronic = radar.scanState.scanType === RADAR_SCAN_TYPE.ELECTRONIC_SECTOR;
      const sector = battery.radarSector ?? 360;
      const sectorStart = sector >= 360 ? 0 : (battery.radarHeading ?? 0) - sector / 2;
      features.push({
        type: 'Feature', properties: { kind: 'coverage', electronic: isElectronic },
        geometry: createRadarPolygon(radar, battery.radarRangeKm, sectorStart, sector),
      });
      features.push({
        type: 'Feature', properties: { kind: 'origin' },
        geometry: { type: 'Point', coordinates: [radar.lng, radar.lat] },
      });
      const sweepWidths = isElectronic ? [10, 4, 1.5] : [20, 10, 4];
      const sweepOpacities = isElectronic ? [0.025, 0.06, 0.14] : [0.035, 0.08, 0.18];
      sweepWidths.forEach((width, index) => {
        const direction = radar.scanState.direction ?? 1;
        features.push({
          type: 'Feature', properties: { kind: 'sweep', opacity: sweepOpacities[index] },
          geometry: createRadarPolygon(
            radar,
            battery.radarRangeKm,
            radar.scanState.currentAzimuth - width * direction,
            width * direction,
          ),
        });
      });
      const beamEnd = getDestinationPoint(radar.lat, radar.lng, radar.scanState.currentAzimuth, battery.radarRangeKm);
      features.push({
        type: 'Feature', properties: { kind: 'beam', opacity: isElectronic ? 0.58 : 0.74 },
        geometry: { type: 'LineString', coordinates: [[radar.lng, radar.lat], [beamEnd.lng, beamEnd.lat]] },
      });
    });
    const selectedBattery = batteries.find(battery => battery.id === selectedBatteryId);
    const launcher = selectedBattery?.components.launchers?.[0] ?? selectedBattery?.components.fdc;
    if (launcher) {
      const rangeKm = selectedBattery.weaponType === 'GUN_AA'
        ? selectedBattery.engagementRangeKm
        : getInterceptorSpec(selectedBattery.interceptorSpecId).publicDisplay.rangeKm;
      features.push({
        type: 'Feature', properties: { kind: 'engagement' },
        geometry: createRadarPolygon(launcher, rangeKm),
      });
    }
    return { type: 'FeatureCollection', features };
  }, [batteries, selectedBatteryId]);
  const colors = RADAR_LAYER_COLORS[mapTheme] ?? RADAR_LAYER_COLORS[SIMPLE_MAP_THEME.DARK];
  return <Source id="radar-network-visuals" type="geojson" data={data}>
    <Layer id="radar-coverage-fill" type="fill" filter={['==', ['get', 'kind'], 'coverage']} paint={{ 'fill-color': colors.coverage, 'fill-opacity': 0.024 }} />
    <Layer id="radar-coverage-line" type="line" filter={['==', ['get', 'kind'], 'coverage']} paint={{ 'line-color': colors.stroke, 'line-opacity': 0.32, 'line-width': 0.7 }} />
    <Layer id="radar-sweep-fill" type="fill" filter={['==', ['get', 'kind'], 'sweep']} paint={{ 'fill-color': colors.sweep, 'fill-opacity': ['get', 'opacity'] }} />
    <Layer id="radar-beam-line" type="line" filter={['==', ['get', 'kind'], 'beam']} paint={{ 'line-color': colors.beam, 'line-opacity': ['get', 'opacity'], 'line-width': 1.4, 'line-blur': 0.35 }} />
    <Layer id="radar-engagement-fill" type="fill" filter={['==', ['get', 'kind'], 'engagement']} paint={{ 'fill-color': '#cc9a3f', 'fill-opacity': 0.035 }} />
    <Layer id="radar-engagement-line" type="line" filter={['==', ['get', 'kind'], 'engagement']} paint={{ 'line-color': '#c09b58', 'line-opacity': 0.65, 'line-width': 1, 'line-dasharray': [5, 3] }} />
    <Layer id="radar-origin-point" type="circle" filter={['==', ['get', 'kind'], 'origin']} paint={{ 'circle-radius': 2.4, 'circle-color': colors.origin, 'circle-stroke-color': '#142314', 'circle-stroke-opacity': 0.52, 'circle-stroke-width': 0.7 }} />
  </Source>;
}

function createTrackVectorData(tracks, selectedTrackId) {
  return {
    type: 'FeatureCollection',
    features: tracks.flatMap(track => {
      const visual = getInterpolatedMarkerPosition(`track:${track.id}`);
      const lat = visual?.latitude ?? track.reportedPosition.lat;
      const lng = visual?.longitude ?? track.reportedPosition.lng;
      const properties = { selected: track.id === selectedTrackId };
      const area = (track.positionUncertaintyM ?? 0) > 20 ? [{
        type: 'Feature', properties: { ...properties, kind: 'uncertainty' },
        geometry: createRadarPolygon({ lat, lng }, track.positionUncertaintyM / 1000, 0, 360),
      }] : [];
      if (track.reportedHeading == null) return area;
      const endpoint = getDestinationPoint(
        lat, lng, visual?.headingDeg ?? track.reportedHeading,
        Math.min(24, 8 + (visual?.speedKmh ?? track.reportedSpeedKmh ?? 0) / 190),
      );
      return [...area, {
        type: 'Feature',
        properties: {
          ...properties, kind: 'vector',
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [lng, lat],
            [endpoint.lng, endpoint.lat],
          ],
        },
      }];
    }),
  };
}

function TrackVectorLayers({ tracks, selectedTrackId }) {
  const { current: map } = useMap();
  const latest = useRef({ tracks, selectedTrackId });
  useEffect(() => { latest.current = { tracks, selectedTrackId }; }, [tracks, selectedTrackId]);
  useEffect(() => {
    if (!map) return undefined;
    let lastUpdate = 0;
    let lastSignature = '';
    return registerMarkerInterpolator(now => {
      if (now - lastUpdate < 1000 / 30) return;
      lastUpdate = now;
      if (!latest.current.tracks.length) return;
      const signature = `${latest.current.selectedTrackId}|${latest.current.tracks.map(track => {
        const pose = getInterpolatedMarkerPosition(`track:${track.id}`);
        return [track.id, (pose?.latitude ?? track.reportedPosition.lat).toFixed(7),
          (pose?.longitude ?? track.reportedPosition.lng).toFixed(7),
          (pose?.headingDeg ?? track.reportedHeading ?? 0).toFixed(2),
          Math.round(track.positionUncertaintyM ?? 0)].join(':');
      }).join('|')}`;
      if (signature === lastSignature) return;
      lastSignature = signature;
      map.getSource('track-vectors')?.setData(createTrackVectorData(
        latest.current.tracks, latest.current.selectedTrackId,
      ));
    });
  }, [map]);
  return <Source id="track-vectors" type="geojson" data={createTrackVectorData(tracks, selectedTrackId)}>
    <Layer id="track-uncertainty" type="fill" filter={['==', ['get', 'kind'], 'uncertainty']}
      paint={{ 'fill-color': '#df6962', 'fill-opacity': ['case', ['get', 'selected'], 0.10, 0.045] }} />
    <Layer id="track-uncertainty-outline" type="line" filter={['==', ['get', 'kind'], 'uncertainty']}
      paint={{ 'line-color': '#df6962', 'line-opacity': 0.23, 'line-width': 1, 'line-dasharray': [2, 3] }} />
    <Layer id="track-vectors-active" type="line" filter={['==', ['get', 'kind'], 'vector']}
      paint={{ 'line-color': '#df6962', 'line-opacity': ['case', ['get', 'selected'], 0.8, 0.48],
        'line-width': ['case', ['get', 'selected'], 1.5, 1] }} />
  </Source>;
}

function TargetTrailsLayer({ targets }) {
  const data = {
    type: 'FeatureCollection',
    features: targets.flatMap(target => {
      const coordinates = (target.trajectory ?? []).map(point => [point.lng, point.lat]);
      if (coordinates.length < 2) return [];
      return [{
        type: 'Feature',
        properties: {
          color: target.type === SIMPLE_TARGET_TYPE.CRUISE_MISSILE ? '#c85d57' : '#b66f68',
        },
        geometry: { type: 'LineString', coordinates },
      }];
    }),
  };
  return (
    <Source id="target-routes" type="geojson" data={data}>
      <Layer
        id="target-route-lines"
        type="line"
        paint={{
          'line-color': ['get', 'color'],
          'line-opacity': 0.18,
          'line-width': 0.8,
          'line-dasharray': [1, 2.4],
        }}
      />
    </Source>
  );
}

function GunTracerLayer({ tracer, simulationTime, target }) {
  if (simulationTime < tracer.startTime) return null;
  const progress = Math.max(0, Math.min(
    1,
    (simulationTime - tracer.startTime) / tracer.flightDurationSec,
  ));
  const endPosition = tracer.willHit && target ? target.position : tracer.endPosition;
  const interpolate = fraction => ({
    lat: tracer.startPosition.lat + (endPosition.lat - tracer.startPosition.lat) * fraction,
    lng: tracer.startPosition.lng + (endPosition.lng - tracer.startPosition.lng) * fraction,
  });
  const head = interpolate(progress);
  const tail = interpolate(Math.max(0, progress - 0.11));
  return (
    <>
      <Source
        id={`gun-tracer-${tracer.id}`}
        type="geojson"
        data={lineFeature([[tail.lng, tail.lat], [head.lng, head.lat]])}
      >
        <Layer
          id={`gun-tracer-line-${tracer.id}`}
          type="line"
          paint={{
            'line-color': '#ffd875',
            'line-opacity': 0.94,
            'line-width': 2,
            'line-blur': 0.7,
          }}
        />
      </Source>
      <InterpolatedMapMarker longitude={head.lng} latitude={head.lat} simulationTime={simulationTime} anchor="center">
        <i className="gun-tracer-head" />
      </InterpolatedMapMarker>
    </>
  );
}

function CommandProtectedObjectLayer({ objects, selectedId }) {
  const data = {
    type: 'FeatureCollection',
    features: objects.map(object => ({
      type: 'Feature',
      id: object.id,
      properties: { id: object.id, name: object.name, settlement: object.settlement },
      geometry: { type: 'Point', coordinates: [object.lon, object.lat] },
    })),
  };
  const selected = objects.find(object => object.id === selectedId);
  return <>
    <Source id="command-protected-objects" type="geojson" data={data}>
      <Layer id="command-protected-object-dots" type="circle" paint={{
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2.5, 10, 5],
        'circle-color': '#d4bd78',
        'circle-opacity': 0.8,
        'circle-stroke-color': 'rgba(19,31,31,.8)',
        'circle-stroke-width': 1,
      }} />
      <Layer id="command-protected-object-hit" type="circle" paint={{
        'circle-radius': 11,
        'circle-opacity': 0,
      }} />
    </Source>
    {selected && <Marker longitude={selected.lon} latitude={selected.lat} anchor="bottom" offset={[0, -7]}>
      <div className="command-protected-object-label"><strong>{selected.name}</strong><span>{selected.settlement}</span></div>
    </Marker>}
  </>;
}

function InterceptorNetworkLayers({ missiles, tracks, smokeData }) {
  const tracksById = new globalThis.Map(tracks.map(track => [track.id, track]));
  const visibleMissiles = missiles.filter(missile => (
    missile.lifecycleState !== INTERCEPTOR_LIFECYCLE_STATE.SELF_DESTRUCT
  ));
  const trajectories = {
    type: 'FeatureCollection',
    features: visibleMissiles.flatMap(missile => {
      const coordinates = missile.trajectory.map(point => [point.lng, point.lat]);
      const visualPosition = getInterpolatedMarkerPosition(`missile:${missile.id}`);
      if (visualPosition && coordinates.length) {
        coordinates[coordinates.length - 1] = [visualPosition.longitude, visualPosition.latitude];
      }
      return coordinates.length > 1 ? [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates },
      }] : [];
    }),
  };
  const relations = {
    type: 'FeatureCollection',
    features: visibleMissiles.flatMap(missile => {
      const track = tracksById.get(missile.trackId);
      if (!track || !['MIDCOURSE', 'TERMINAL', 'REATTACK'].includes(missile.guidanceState)) return [];
      const worldPosition = missile.worldPosition ?? missile;
      return [{
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [worldPosition.lng, worldPosition.lat],
            [track.reportedPosition.lng, track.reportedPosition.lat],
          ],
        },
      }];
    }),
  };
  return (
    <>
      <Source id="interceptor-smoke-puffs" type="geojson" data={smokeData}>
        <Layer id="interceptor-smoke-halo" type="circle" paint={{
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            MISSILE_TRAIL_VISUAL_PROFILE.farZoom,
            ['*', ['get', 'radius'], 2.15, MISSILE_TRAIL_VISUAL_PROFILE.farScale],
            MISSILE_TRAIL_VISUAL_PROFILE.closeZoom,
            ['*', ['get', 'radius'], 2.15, MISSILE_TRAIL_VISUAL_PROFILE.closeScale]],
          'circle-color': '#505755',
          'circle-opacity': ['interpolate', ['linear'], ['zoom'],
            MISSILE_TRAIL_VISUAL_PROFILE.farZoom,
            ['*', ['get', 'opacity'], 0.48, MISSILE_TRAIL_VISUAL_PROFILE.farOpacity],
            MISSILE_TRAIL_VISUAL_PROFILE.closeZoom,
            ['*', ['get', 'opacity'], 0.48, MISSILE_TRAIL_VISUAL_PROFILE.closeOpacity]],
          'circle-blur': 0.9,
        }} />
        <Layer id="interceptor-smoke-core" type="circle" paint={{
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            MISSILE_TRAIL_VISUAL_PROFILE.farZoom,
            ['*', ['get', 'radius'], MISSILE_TRAIL_VISUAL_PROFILE.farScale],
            MISSILE_TRAIL_VISUAL_PROFILE.closeZoom,
            ['*', ['get', 'radius'], MISSILE_TRAIL_VISUAL_PROFILE.closeScale]],
          'circle-color': '#c5c6bf',
          'circle-opacity': ['interpolate', ['linear'], ['zoom'],
            MISSILE_TRAIL_VISUAL_PROFILE.farZoom,
            ['*', ['get', 'opacity'], MISSILE_TRAIL_VISUAL_PROFILE.farOpacity],
            MISSILE_TRAIL_VISUAL_PROFILE.closeZoom,
            ['*', ['get', 'opacity'], MISSILE_TRAIL_VISUAL_PROFILE.closeOpacity]],
          'circle-blur': 0.72,
        }} />
      </Source>
      <Source id="interceptor-trajectories" type="geojson" data={trajectories}>
        <Layer id="interceptor-trail-glow" type="line" paint={{
          'line-color': '#b7c9bb',
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.025, 11, 0.065],
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 11, 3],
        }} />
        <Layer id="interceptor-trail-lines" type="line" paint={{
          'line-color': '#a8c0ad',
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.08, 11, 0.22],
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.35, 11, 0.9],
          'line-dasharray': [1, 2],
        }} />
      </Source>
      <Source id="interceptor-relations" type="geojson" data={relations}>
        <Layer id="interceptor-relation-lines" type="line" paint={{ 'line-color': '#75b98a', 'line-opacity': 0.2, 'line-width': 0.8 }} />
      </Source>
    </>
  );
}

function RotationControls({ heading, state = null, onRotate }) {
  return (
    <div className="map-object-controls" onClick={event => event.stopPropagation()}>
      <button aria-label="Rotate left" onClick={() => onRotate(-15)}>↺</button>
      <span>{Math.round(heading)}°{state ? ` · ${state}` : ''}</span>
      <button aria-label="Rotate right" onClick={() => onRotate(15)}>↻</button>
    </div>
  );
}

function BatteryMarkers({
  battery,
  selected,
  selectedMapAsset,
  isDraft,
  mapZoom,
  language,
  onSelect,
  onRotate,
}) {
  const ru = language === UI_LANGUAGE.RU;
  const { radar, launchers } = battery.components;
  const category = getBatteryCategory(battery);
  const isGun = battery.weaponType === 'GUN_AA';
  const launchProfile = battery.interceptorSpecId ? getLaunchProfile(battery.interceptorSpecId) : null;
  const radarAssetId = `${battery.id}:RADAR`;
  return (
    <>
      {radar && !isGun && battery.category !== 'TOR_M1' && (
        <Marker longitude={(radar.worldPosition ?? radar).lng} latitude={(radar.worldPosition ?? radar).lat} anchor="center">
          <div className={`light-defense-object light-defense-object--radar ${selectedMapAsset?.id === radarAssetId ? 'is-selected' : ''} ${isDraft ? 'is-draft' : ''}`}>
            <button onClick={(event) => { event.stopPropagation(); onSelect({ id: radarAssetId, type: 'RADAR', componentId: null }); }}>
              <LightMapSprite assetId={getSystemAssetId(category, 'radar')} heading={battery.radarHeading} selected={selectedMapAsset?.id === radarAssetId} sizePx={getMapObjectSizePx(MAP_OBJECT_CLASS.RADAR, mapZoom)} />
              {(mapZoom >= 6.1 || selected) && <small>{battery.radarScanType === RADAR_SCAN_TYPE.ELECTRONIC_SECTOR ? (ru ? 'АФАР РЛС' : 'AESA RADAR') : `${battery.type} ${ru ? 'РЛС' : 'RADAR'}`}</small>}
            </button>
            {!isDraft && selectedMapAsset?.id === radarAssetId && (
              <RotationControls heading={battery.radarHeading} state="ACTIVE" onRotate={degrees => onRotate('RADAR', null, degrees)} />
            )}
          </div>
        </Marker>
      )}
      {launchers.map((launcher, index) => {
        const launcherAssetId = `${battery.id}:${launcher.id}`;
        return (
        <Marker key={launcher.id} longitude={(launcher.worldPosition ?? launcher).lng} latitude={(launcher.worldPosition ?? launcher).lat} anchor="center">
          <div className={`light-defense-object light-defense-object--launcher ${isGun ? 'light-defense-object--gepard' : ''} ${launcher.launchState === 'FIRING' ? 'is-firing' : ''} ${selectedMapAsset?.id === launcherAssetId ? 'is-selected' : ''} ${isDraft ? 'is-draft' : ''}`}>
            <button onClick={(event) => { event.stopPropagation(); onSelect({ id: launcherAssetId, type: 'LAUNCHER', componentId: launcher.id }); }}>
              <LightMapSprite assetId={launchProfile?.launcherAssetId ?? getSystemAssetId(category, 'launcher', launcher.heading ?? 0)} heading={launcher.heading ?? 0} selected={selectedMapAsset?.id === launcherAssetId} sizePx={getMapObjectSizePx(MAP_OBJECT_CLASS.LAUNCHER, mapZoom) * (isGun ? Math.max(1, 2 - Math.max(0, mapZoom - 5) * 0.18) : 1)} />
              {isGun && launcher.launchState === 'FIRING' && (
                <span className="gepard-fire-effect" style={{ '--gun-heading': `${launcher.heading ?? 0}deg` }}>
                  <i /><i /><i />
                </span>
              )}
              {!isGun && (mapZoom >= 6.5 || selected) && <small>{battery.type} · LN {index + 1}</small>}
            </button>
          </div>
        </Marker>
        );
      })}
    </>
  );
}

function SearchRadarMarker({ radar, selected, mapZoom, language, onSelect }) {
  const position = radar.components.radar?.worldPosition ?? radar.components.radar;
  if (!position) return null;
  const label = language === UI_LANGUAGE.RU ? radar.displayName : radar.englishName;
  return <Marker longitude={position.lng} latitude={position.lat} anchor="center">
    <button
      className={`search-radar-marker ${selected ? 'is-selected' : ''} ${radar.operational ? '' : 'is-offline'}`}
      onClick={(event) => { event.stopPropagation(); onSelect(); }}
      title={`${label} · ${radar.scanModeLabel} · ${radar.radarRangeKm} km`}
    >
      <span className="search-radar-marker__symbol" aria-hidden="true"><i /><i /><i /></span>
      {(mapZoom >= 5.8 || selected) && <small>{label} · RLS</small>}
    </button>
  </Marker>;
}

function TargetMarker({ target, track, trackDistanceKm, onSelectTrack, onSelectTarget,
  language, mapZoom, simulationTime }) {
  const typeClass = getTargetAssetType(target.type);
  const ru = language === UI_LANGUAGE.RU;
  const targetDistanceKm = getRemainingTargetDistanceKm(target);
  const worldPosition = target.worldPosition ?? target.position;
  return (
    <InterpolatedMapMarker longitude={worldPosition.lng} latitude={worldPosition.lat} simulationTime={simulationTime} anchor="center">
      <button
        className={`simple-global-target simple-global-target--${typeClass} ${track ? 'has-track' : ''}`}
        title={`${getTargetLabel(target.type, target.modelId)} · ${target.speedKmh} km/h · ${Math.round(target.altitudeM)} m`}
        onClick={(event) => {
          event.stopPropagation();
          onSelectTarget?.(target.id);
          if (track) onSelectTrack(track.id);
        }}
      >
        <LightMapSprite assetId={getTargetAssetId(target)} sourceUrl={target.customAssetUrl} sourceOffsetX={target.customAssetOffsetX} sourceOffsetY={target.customAssetOffsetY} heading={target.heading} sizePx={getMapObjectSizePx(MAP_OBJECT_CLASS.TARGET, mapZoom) * (target.customAssetScale ?? 1)} />
        {target.type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE && <small>{target.flightPhase}</small>}
        <TargetHoverData speedKmh={target.speedKmh} distanceKm={targetDistanceKm} ru={ru} />
        {track && <CommandTrackLabel track={track} distanceKm={trackDistanceKm} target={target} language={language} />}
      </button>
    </InterpolatedMapMarker>
  );
}

function TheaterObjectMarker({ objective, mapZoom, language }) {
  const ru = language === UI_LANGUAGE.RU;
  const categoryIcon = {
    'AIR BASE': '✈',
    'PORT AREA': '⚓',
    'INDUSTRIAL OBJECT': '▦',
    'MAJOR CITY': '●',
  }[objective.category] ?? '◆';
  return (
    <div className={`theater-object theater-object--${objective.category.toLowerCase().replaceAll(' ', '-')}`} title={`${objective.category} · ${localizeObjective(objective.name, language)}`}>
      <i>{categoryIcon}</i>
      {mapZoom >= 6.35 && <span>{localizeObjective(objective.name, language)}<small>{ru ? ({ 'AIR BASE': 'АВИАБАЗА', 'PORT AREA': 'ПОРТ', 'INDUSTRIAL OBJECT': 'ПРОМОБЪЕКТ', 'MAJOR CITY': 'КРУПНЫЙ ГОРОД' }[objective.category] ?? objective.category) : objective.category}</small></span>}
    </div>
  );
}

function useThrottledEngineEntity(entityId, collectionName) {
  const [snapshot, setSnapshot] = useState(() => (
    useEngine.getState()[collectionName]?.find(entity => entity.id === entityId) ?? null
  ));
  useEffect(() => {
    const sample = () => setSnapshot(
      useEngine.getState()[collectionName]?.find(entity => entity.id === entityId) ?? null,
    );
    const timer = window.setInterval(sample, 125);
    return () => window.clearInterval(timer);
  }, [collectionName, entityId]);
  return snapshot;
}

const MissileDebugPanel = memo(function MissileDebugPanel({ missileId }) {
  const missile = useThrottledEngineEntity(missileId, 'missiles');
  const spec = missile ? getInterceptorSpec(missile.interceptorSpecId) : null;
  if (!missile || !spec) return null;
  const solution = missile.interceptSolutionStatus ?? 'INVALID';
  const actualClosestKnown = (missile.timeSinceClosestApproachSec ?? 0) > 0.05
    || ['REATTACK', 'INTERCEPT_LOST'].includes(missile.guidanceState);
  const flightPathAngleDeg = missile.flightPathAngleDeg ?? 0;
  const speedMps = missile.speedKmh / 3.6;
  const horizontalSpeedMps = speedMps * Math.cos(flightPathAngleDeg * Math.PI / 180);
  const verticalSpeedMps = missile.verticalSpeedMps
    ?? speedMps * Math.sin(flightPathAngleDeg * Math.PI / 180);
  const targetAltitudeM = missile.guidance?.reportedPosition?.alt
    ?? missile.guidance?.reportedPosition?.altitudeM
    ?? 0;
  const predictedInterceptAltitudeM = missile.guidance?.interceptSolution?.interceptPoint?.alt
    ?? targetAltitudeM;
  return (
    <DebugTelemetryCard title="MISSILE STATE" entityId={missile.id} footer="PANEL REFRESH · 8 HZ">
      <DebugSection title="FLIGHT">
        <DebugRow label="MISSILE" value={spec.publicDisplay.displayName} />
        <DebugRow label="PHASE" value={missile.motorPhase ?? '—'} />
        <DebugRow label="GUIDANCE" value={missile.guidanceState ?? '—'} />
        <DebugRow label="SPEED" value={`${Math.round(missile.speedKmh)} km/h · ${(missile.speedKmh / 3.6).toFixed(0)} m/s`} />
        <DebugRow label="ALTITUDE" value={`${(missile.altitudeM / 1000).toFixed(1)} km`} />
        <DebugRow label="HEADING / PITCH" value={`${(missile.heading ?? 0).toFixed(1)}° / ${(missile.flightPathAngleDeg ?? 0).toFixed(1)}°`} />
        <DebugRow label="TURN RATE" value={`${(missile.turnRateDegPerSec ?? 0).toFixed(1)}°/s`} />
        <DebugRow label="AZ / EL RATE" value={`${(missile.headingTurnRateDegPerSec ?? 0).toFixed(1)} / ${(missile.pitchRateDegPerSec ?? 0).toFixed(1)}°/s`} />
        <DebugRow label="G LOAD" value={`${(missile.currentG ?? 0).toFixed(1)} / ${(missile.maximumG ?? 0).toFixed(0)} G`} />
      </DebugSection>
      <DebugSection title="INTERCEPT">
        <DebugRow label="TARGET" value={missile.targetId ?? '—'} />
        <DebugRow label="DISTANCE" value={Number.isFinite(missile.distanceToTargetKm) ? `${missile.distanceToTargetKm.toFixed(1)} km` : '—'} />
        <DebugRow label="CLOSING SPEED" value={`${(missile.closingSpeedMps ?? 0).toFixed(0)} m/s`} />
        <DebugRow label="TIME TO GO" value={`${(missile.estimatedTimeToGoSec ?? 0).toFixed(1)} s`} />
        <DebugRow label="HEADING ERROR" value={`${(missile.headingCorrectionDeg ?? 0).toFixed(1)}°`} />
        <DebugRow label="AZ / EL ERROR" value={`${(missile.horizontalHeadingErrorDeg ?? 0).toFixed(1)}° / ${(missile.pitchErrorDeg ?? 0).toFixed(1)}°`} />
        <DebugRow label="LOS AZ / EL" value={`${(missile.losAzimuthDeg ?? 0).toFixed(1)}° / ${(missile.losElevationDeg ?? 0).toFixed(1)}°`} />
        <DebugRow label="LOS RATE" value={`${(missile.losRateDegPerSec ?? 0).toFixed(2)}°/s`} />
        <DebugRow label="LOS AZ / EL RATE" value={`${(missile.losAzimuthRateDegPerSec ?? 0).toFixed(2)} / ${(missile.losElevationRateDegPerSec ?? 0).toFixed(2)}°/s`} />
        <DebugRow label="INTERCEPT SOLUTION" value={<DebugStatus value={solution} />} />
        <DebugRow label="INTERCEPT QUALITY" value={`${Math.round((missile.interceptQuality ?? 0) * 100)}%`} />
        <DebugRow label="PREDICTED CLOSEST" value={`${(missile.predictedClosestApproachM ?? 0).toFixed(0)} m`} />
        <DebugRow label="ACTUAL CLOSEST" value={actualClosestKnown && Number.isFinite(missile.closestApproachKm) ? `${(missile.closestApproachKm * 1000).toFixed(0)} m` : '—'} />
      </DebugSection>
      <DebugSection title="GUIDANCE">
        <DebugRow label="PN N" value={(missile.navigationConstant ?? 0).toFixed(1)} />
        <DebugRow label="COMMANDED G" value={`${Math.abs((missile.commandedTotalAccelerationMps2 ?? missile.commandedLateralAccelerationMps2 ?? 0) / 9.81).toFixed(1)} G`} />
        <DebugRow label="COMMAND H / V" value={`${(missile.commandedHorizontalAccelerationMps2 ?? 0).toFixed(0)} / ${(missile.commandedVerticalAccelerationMps2 ?? 0).toFixed(0)} m/s²`} />
        <DebugRow label="ACTUAL H / V" value={`${(missile.actualHorizontalAccelerationMps2 ?? 0).toFixed(0)} / ${(missile.actualVerticalAccelerationMps2 ?? 0).toFixed(0)} m/s²`} />
        <DebugRow label="REQUIRED V" value={`${(missile.requiredVerticalSpeedMps ?? 0).toFixed(0)} m/s · ${(missile.requiredVerticalAccelerationMps2 ?? 0).toFixed(0)} m/s²`} />
        <DebugRow label="PROFILE MAX G" value={`${(missile.profileMaxG ?? missile.maximumG ?? 0).toFixed(1)} G`} />
        <DebugRow label="AERO AVAILABLE G" value={`${(missile.aeroAvailableG ?? 0).toFixed(1)} G`} />
        <DebugRow label="ENERGY LIMITED G" value={`${(missile.energyLimitedG ?? 0).toFixed(1)} G`} />
        <DebugRow label="AUTOPILOT ALLOWED G" value={`${(missile.autopilotAllowedG ?? missile.availableG ?? 0).toFixed(1)} G`} />
        <DebugRow label="MOTOR LEFT" value={`${Math.max(0, missile.motorTimeLeftSec ?? 0).toFixed(1)} s`} />
        <DebugRow label="ENERGY" value={`${Math.round((missile.energyRatio ?? 0) * 100)}%`} />
      </DebugSection>
      <DebugSection title="3D GUIDANCE">
        <DebugRow label="HORIZONTAL / VERTICAL" value={`${horizontalSpeedMps.toFixed(0)} / ${verticalSpeedMps.toFixed(0)} m/s`} />
        <DebugRow label="FLIGHT PATH / PITCH" value={`${flightPathAngleDeg.toFixed(1)}° / ${flightPathAngleDeg.toFixed(1)}°`} />
        <DebugRow label="PITCH ERROR" value={`${(missile.pitchErrorDeg ?? 0).toFixed(1)}°`} />
        <DebugRow label="LOS ELEVATION / RATE" value={`${(missile.losElevationDeg ?? 0).toFixed(1)}° / ${(missile.losElevationRateDegPerSec ?? 0).toFixed(2)}°/s`} />
        <DebugRow label="TARGET ALTITUDE" value={`${(targetAltitudeM / 1000).toFixed(1)} km`} />
        <DebugRow label="INTERCEPT ALTITUDE" value={`${(predictedInterceptAltitudeM / 1000).toFixed(1)} km`} />
        <DebugRow label="ALTITUDE ERROR" value={`${((predictedInterceptAltitudeM - missile.altitudeM) / 1000).toFixed(1)} km`} />
        <DebugRow label="REQUIRED VERTICAL" value={`${(missile.requiredVerticalSpeedMps ?? 0).toFixed(0)} m/s`} />
        <DebugRow label="COMMAND V / H / TOTAL" value={`${((missile.commandedVerticalAccelerationMps2 ?? 0) / 9.81).toFixed(1)} / ${((missile.commandedHorizontalAccelerationMps2 ?? 0) / 9.81).toFixed(1)} / ${((missile.commandedTotalAccelerationMps2 ?? 0) / 9.81).toFixed(1)} G`} />
      </DebugSection>
    </DebugTelemetryCard>
  );
});

const BallisticDebugPanel = memo(function BallisticDebugPanel({ targetId, language }) {
  const snapshot = useThrottledEngineEntity(targetId, 'airTargets');
  if (!snapshot?.ballisticPhysics) return null;
  const physics = snapshot.ballisticPhysics;
  const correction = physics.terminalCorrection;
  const ru = language === UI_LANGUAGE.RU;
  return (
    <DebugTelemetryCard title="BALLISTIC STATE" entityId={snapshot.id} footer={ru ? 'ОБНОВЛЕНИЕ ПАНЕЛИ · 8 ГЦ' : 'PANEL REFRESH · 8 HZ'}>
      <DebugSection title="FLIGHT">
        <DebugRow label="PHASE" value={physics.phase} />
        <DebugRow label="SPEED" value={`${Math.round(physics.totalSpeedMps * 3.6)} km/h · ${physics.totalSpeedMps.toFixed(0)} m/s`} />
        <DebugRow label="HORIZONTAL / VERTICAL" value={`${physics.horizontalSpeedMps.toFixed(0)} / ${physics.verticalSpeedMps.toFixed(0)} m/s`} />
        <DebugRow label="ALTITUDE" value={`${(snapshot.altitudeM / 1000).toFixed(1)} km`} />
        <DebugRow label="FLIGHT PATH ANGLE" value={`${physics.flightPathAngleDeg.toFixed(1)}°`} />
        <DebugRow label="CONTROL G" value={`${physics.currentControlG.toFixed(1)} G`} />
      </DebugSection>
      <DebugSection title="IMPACT">
        <DebugRow label="DISTANCE TO AIM" value={`${physics.distanceToAimPointKm.toFixed(1)} km`} />
        <DebugRow label="TIME TO GROUND" value={`${physics.timeToGroundSec.toFixed(1)} s`} />
        <DebugRow label="PREDICTED IMPACT DISTANCE" value={`${physics.predictedImpactDistanceKm.toFixed(1)} km`} />
        <DebugRow label="PREDICTED IMPACT ERROR" value={`${Math.round(physics.impactErrorMeters)} m`} />
        <DebugRow label="TERMINAL SOLUTION" value={<DebugStatus value={physics.terminalSolution} />} />
      </DebugSection>
      <DebugSection title="CORRECTION">
        <DebugRow label="STATE / ANGLE" value={`${correction.state} · ${correction.angleDeg}°`} />
        <DebugRow label="USED / REMAINING" value={`${correction.used} / ${Math.max(0, correction.count - correction.used)}`} />
        <DebugRow label="TIME OF FLIGHT" value={`${physics.timeOfFlightSec.toFixed(1)} s`} />
        <DebugRow label="APOGEE" value={`${(physics.apogeeReachedM / 1000).toFixed(1)} km`} />
      </DebugSection>
    </DebugTelemetryCard>
  );
});

export function SandboxPanel({
  startPosition,
  aimPosition,
  selectingStart,
  selectingAim,
  onSelectStart,
  onSelectAim,
  onSpawn,
  language,
  initiallyCollapsed = false,
  onFpvSpawn,
  advanced3d = false,
  routeMode = false,
  onRouteModeChange,
  routePreset = 'MANUAL',
  onRoutePresetChange,
  routeStyle = 'CRUISE',
  onRouteStyleChange,
  routePoints = [],
  routeDistanceKm = 0,
  routeEta = '—',
  routeStartSelected = false,
  routeEndSelected = false,
  onSelectRouteStart,
  onSelectRouteEnd,
  selectingRouteStart = false,
  selectingRouteEnd = false,
  trajectoryTrailEnabled = false,
  onTrajectoryTrailChange,
  waypoints = [],
  onUndoWaypoint,
  onClearWaypoints,
  panelOpen,
  onPanelOpenChange,
}) {
  const ru = language === UI_LANGUAGE.RU;
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const isCollapsed = panelOpen === undefined ? collapsed : !panelOpen;
  const setPanelCollapsed = value => {
    if (panelOpen === undefined) setCollapsed(value);
    onPanelOpenChange?.(!value);
  };
  const draft = useSandboxSpawnDraftStore(state => state.draft);
  const setDraft = useSandboxSpawnDraftStore(state => state.setDraft);
  const { type, modelId, count, speedKmh, altitudeM, objectiveId,
    terminalCorrectionAngleDeg, terminalCorrectionCount, terminalCorrectionSide,
    ballisticManeuverMode } = draft;
  const setType = value => setDraft({ type: value });
  const setModelId = value => setDraft({ modelId: value });
  const setCount = value => setDraft({ count: value });
  const setSpeedKmh = value => setDraft({ speedKmh: value });
  const setAltitudeM = value => setDraft({ altitudeM: value });
  const setObjectiveId = value => setDraft({ objectiveId: value });
  const setTerminalCorrectionAngleDeg = value => setDraft({ terminalCorrectionAngleDeg: value });
  const setTerminalCorrectionCount = value => setDraft({ terminalCorrectionCount: value });
  const setTerminalCorrectionSide = value => setDraft({ terminalCorrectionSide: value });
  const setBallisticManeuverMode = value => setDraft({ ballisticManeuverMode: value });
  const [feedback, setFeedback] = useState('');
  const designStyle = useDesignSurface('game-spawn-tools');

  const changeModel = (nextModelId) => {
    setModelId(nextModelId);
    const nextType = nextModelId === LIGHT_TARGET_MODEL.GERAN_2
      || nextModelId === LIGHT_TARGET_MODEL.GERBERA
      ? SIMPLE_TARGET_TYPE.UAV
      : nextModelId === LIGHT_TARGET_MODEL.ISKANDER_M
        ? SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE
        : SIMPLE_TARGET_TYPE.CRUISE_MISSILE;
    setType(nextType);
    if (advanced3d && nextType === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE) {
      onRouteModeChange?.(false);
      setCount(1);
      setSpeedKmh(ISKANDER_GAMEPLAY_PROFILE.speedKmh);
      setAltitudeM(250);
    } else if (advanced3d) {
      const limits = nextType === SIMPLE_TARGET_TYPE.CRUISE_MISSILE
        ? { min: 500, max: 1500 } : { min: 70, max: 650 };
      setSpeedKmh(Math.max(limits.min, Math.min(limits.max, speedKmh)));
      setAltitudeM(Math.max(10, Math.min(15000, altitudeM)));
    } else if (nextType === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE) {
      setCount(1);
      setSpeedKmh(ISKANDER_GAMEPLAY_PROFILE.speedKmh);
      setAltitudeM(250);
    } else if (nextType === SIMPLE_TARGET_TYPE.CRUISE_MISSILE) {
      setSpeedKmh(800);
      setAltitudeM(100);
    } else if (nextModelId === LIGHT_TARGET_MODEL.GERBERA) {
      setSpeedKmh(165);
      setAltitudeM(300);
    } else {
      setSpeedKmh(250);
      setAltitudeM(250);
    }
  };
  const speedRange = advanced3d && type !== SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE
    ? type === SIMPLE_TARGET_TYPE.CRUISE_MISSILE ? { min: 500, max: 1500, step: 10 }
      : { min: 70, max: 650, step: 10 }
    : modelId === LIGHT_TARGET_MODEL.GERBERA
    ? { min: 140, max: 190, step: 5 }
    : type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE
    ? { min: ISKANDER_GAMEPLAY_PROFILE.speedKmh, max: ISKANDER_GAMEPLAY_PROFILE.speedKmh, step: 1 }
    : type === SIMPLE_TARGET_TYPE.CRUISE_MISSILE
    ? { min: 650, max: 950, step: 10 }
    : { min: 100, max: 500, step: 10 };
  const altitudeRange = advanced3d && type !== SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE
    ? { min: 10, max: 15000, step: 10 }
    : modelId === LIGHT_TARGET_MODEL.GERBERA
    ? { min: 100, max: 800, step: 10 }
    : type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE
    ? { min: 250, max: 250, step: 1 }
    : type === SIMPLE_TARGET_TYPE.CRUISE_MISSILE
    ? { min: 40, max: 250, step: 5 }
    : { min: 50, max: 1000, step: 10 };

  const spawn = () => {
    if (!startPosition) return;
    const spawned = onSpawn({
      type,
      modelId,
      count,
      speedKmh,
      altitudeM,
      startPosition,
      ...(advanced3d && routeMode && waypoints.length >= 2 ? { route: waypoints } : {}),
      objectiveId,
      aimPoint: type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE ? aimPosition : null,
      terminalCorrectionAngleDeg,
      terminalCorrectionCount,
      terminalCorrectionSide,
      ballisticManeuverMode,
    });
    setFeedback(ru ? `Целей добавлено: ${spawned}` : `${spawned} target${spawned === 1 ? '' : 's'} inserted`);
    window.setTimeout(() => setFeedback(''), 2600);
  };

  if (isCollapsed) {
    return <button className="sandbox-panel__restore" data-design-id="game-spawn-tools" data-design-name="Инструменты спавна" data-design-dynamic-text="true" style={designStyle} onClick={() => setPanelCollapsed(false)}>{ru ? 'Добавить цель' : 'Spawn Target'}</button>;
  }

  return (
    <section className="sandbox-panel" data-design-id="game-spawn-tools" data-design-name="Инструменты спавна" data-design-dynamic-text="true" style={designStyle}>
      <header><div><span>{ru ? 'Полигон' : 'Sandbox'}</span><strong>{ru ? 'Добавить цель' : 'Spawn Target'}</strong></div><button onClick={() => setPanelCollapsed(true)}>−</button></header>
      <label>{ru ? 'Тип' : 'Type'}</label>
      <div className="sandbox-panel__segments">
        {LIGHT_TARGET_MODEL_OPTIONS.map(option => (
          <button
            key={option.id}
            className={modelId === option.id ? 'is-active' : ''}
            onClick={() => changeModel(option.id)}
          >
            {option.displayName}
          </button>
        ))}
      </div>
      {advanced3d && type !== SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE && <>
        <label>{ru ? 'Маршрут' : 'Route'}</label>
        <div className="sandbox-panel__segments">
          <button className={!routeMode ? 'is-active' : ''} onClick={() => onRouteModeChange?.(false)}>{ru ? 'Одна точка' : 'Single point'}</button>
          <button className={routeMode ? 'is-active' : ''} onClick={() => onRouteModeChange?.(true)}>{ru ? 'Маршрут' : 'Route'}</button>
        </div>
        {routeMode && <>
          <select aria-label={ru ? 'Preset маршрута' : 'Route preset'} value={routePreset} onChange={event => onRoutePresetChange?.(event.target.value)}>
            <option value="MANUAL">{ru ? 'Ручной' : 'Manual'}</option>
            <option value="STRAIGHT">{ru ? 'Прямой' : 'Straight'}</option>
            <option value="S_TURN">{ru ? 'S-манёвр' : 'S-turn'}</option>
            <option value="ZIGZAG">{ru ? 'Зигзаг' : 'Zigzag'}</option>
            <option value="TURN">{ru ? 'Поворот' : 'Turn'}</option>
            <option value="SNAKE">{ru ? 'Змейка' : 'Snake'}</option>
          </select>
          {routePreset !== 'MANUAL' && routePreset !== 'STRAIGHT' && <>
            <label>{ru ? 'Стиль' : 'Style'}</label>
            <div className="sandbox-panel__segments">
              <button className={routeStyle === 'CRUISE' ? 'is-active' : ''} onClick={() => onRouteStyleChange?.('CRUISE')}>{ru ? 'Плавный' : 'Cruise'}</button>
              <button className={routeStyle === 'FIGHTER' ? 'is-active' : ''} onClick={() => onRouteStyleChange?.('FIGHTER')}>{ru ? 'Резкий' : 'Fighter'}</button>
            </div>
          </>}
          {routePreset === 'MANUAL' ? <div className="sandbox-panel__route-controls">
            <span>{ru ? 'Точек' : 'Points'}: {routePoints.length} · {ru ? 'Длина' : 'Distance'}: {routeDistanceKm.toFixed(1)} km · ETA {routeEta}</span>
            <button disabled={!routePoints.length} onClick={onUndoWaypoint}>{ru ? 'Отменить последнюю' : 'Undo last'}</button>
            <small>{ru ? 'Щёлкайте по глобусу: первая точка — старт.' : 'Click globe; first point is spawn.'}</small>
          </div> : <div className="sandbox-panel__route-controls">
            <button className={selectingRouteStart ? 'is-active' : ''} onClick={onSelectRouteStart}>{routeStartSelected ? (ru ? 'Старт задан' : 'Start set') : (ru ? 'Выбрать старт' : 'Set start')}</button>
            <button className={selectingRouteEnd ? 'is-active' : ''} onClick={onSelectRouteEnd}>{routeEndSelected ? (ru ? 'Финиш задан' : 'End set') : (ru ? 'Выбрать финиш' : 'Set end')}</button>
            <span>{ru ? 'Точек' : 'Points'}: {routePoints.length} · {ru ? 'Длина' : 'Distance'}: {routeDistanceKm.toFixed(1)} km · ETA {routeEta}</span>
          </div>}
          <button className="sandbox-panel__route-clear" disabled={!routePoints.length && !routeStartSelected && !routeEndSelected} onClick={onClearWaypoints}>{ru ? 'Очистить маршрут' : 'Clear route'}</button>
        </>}
        {advanced3d && <button className={`sandbox-panel__route-clear ${trajectoryTrailEnabled ? 'is-active' : ''}`} aria-pressed={trajectoryTrailEnabled}
          onClick={() => onTrajectoryTrailChange?.(!trajectoryTrailEnabled)}>{ru ? 'След траектории' : 'Trajectory trail'} · {trajectoryTrailEnabled ? 'ON' : 'OFF'}</button>}
      </>}
      <RangeControl label={ru ? 'Количество' : 'Quantity'} value={count} min={1} max={type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE ? 12 : 50} step={1} onChange={setCount} />
      {type !== SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE && <RangeControl label={ru ? 'Скорость' : 'Speed'} value={speedKmh} suffix={ru ? 'км/ч' : 'km/h'} {...speedRange} onChange={setSpeedKmh} />}
      {type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE ? (
        <>
          <div className="sandbox-panel__ballistic-note">{ru ? 'Ballistic Physics V2 · скорость и апогей рассчитываются физикой' : 'Ballistic Physics V2 · physics-driven speed and apogee'}</div>
          <label>{ru ? 'Маневрирование' : 'Maneuvering'}</label>
          <div className="sandbox-panel__segments">
            <button className={ballisticManeuverMode === BALLISTIC_MANEUVER_MODE.AUTO ? 'is-active' : ''} onClick={() => setBallisticManeuverMode(BALLISTIC_MANEUVER_MODE.AUTO)}>{ru ? 'АВТО' : 'AUTO'}</button>
            <button className={ballisticManeuverMode === BALLISTIC_MANEUVER_MODE.NONE ? 'is-active' : ''} onClick={() => {
              setBallisticManeuverMode(BALLISTIC_MANEUVER_MODE.NONE);
              setTerminalCorrectionAngleDeg(0);
              setTerminalCorrectionCount(0);
            }}>{ru ? 'БЕЗ МАНЁВРОВ' : 'NO MANEUVERS'}</button>
          </div>
          {ballisticManeuverMode === BALLISTIC_MANEUVER_MODE.AUTO && <>
          <label>{ru ? 'Терминальная коррекция' : 'Terminal correction'}</label>
          <div className="sandbox-panel__segments sandbox-panel__segments--five">
            {TERMINAL_CORRECTION_ANGLES.map(angle => <button key={angle} className={terminalCorrectionAngleDeg === angle ? 'is-active' : ''} onClick={() => {
              setTerminalCorrectionAngleDeg(angle);
              if (angle === 0) setTerminalCorrectionCount(0);
              else if (terminalCorrectionCount === 0) setTerminalCorrectionCount(1);
            }}>{angle === 0 ? 'OFF' : `${angle}°`}</button>)}
          </div>
          <label>{ru ? 'Количество коррекций' : 'Correction count'}</label>
          <div className="sandbox-panel__segments sandbox-panel__segments--three">
            {TERMINAL_CORRECTION_COUNTS.map(value => <button key={value} className={terminalCorrectionCount === value ? 'is-active' : ''} onClick={() => setTerminalCorrectionCount(value)}>{value}</button>)}
          </div>
          <label>{ru ? 'Сторона коррекции' : 'Correction side'}</label>
          <select value={terminalCorrectionSide} onChange={event => setTerminalCorrectionSide(event.target.value)}>
            {TERMINAL_CORRECTION_SIDES.map(side => <option key={side}>{side}</option>)}
          </select>
          </>}
        </>
      ) : (
        <RangeControl label={ru ? 'Высота' : 'Altitude'} value={altitudeM} suffix={ru ? 'м' : 'm'} {...altitudeRange} onChange={setAltitudeM} />
      )}
      {type !== SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE && <>
        <label htmlFor="sandbox-objective">{ru ? (advanced3d && routeMode ? 'Своя цель · конец маршрута' : 'Цель удара') : (advanced3d && routeMode ? 'Custom target · route end' : 'Estimated target')}</label>
        {advanced3d && routeMode
          ? <div className="sandbox-panel__route-controls"><span>{waypoints.length
            ? `${waypoints.at(-1).lat.toFixed(3)}, ${waypoints.at(-1).lng.toFixed(3)}`
            : (ru ? 'Задайте финиш маршрута на глобусе' : 'Set route end on the globe')}</span></div>
          : <select id="sandbox-objective" value={objectiveId} onChange={event => setObjectiveId(event.target.value)}>
            {THEATER_OBJECTS.map(objective => <option key={objective.id} value={objective.id}>{localizeObjective(objective.name, language)} · {localizeTechnicalTerm(objective.category, language)}</option>)}
          </select>}
      </>}
      {!routeMode && <button className={`sandbox-panel__map-select ${selectingStart ? 'is-active' : ''}`} onClick={onSelectStart}>
        {selectingStart ? (ru ? 'Укажите точку пуска…' : 'Click launch point on map…') : startPosition ? `${startPosition.lat.toFixed(2)}, ${startPosition.lng.toFixed(2)}` : (ru ? 'Выбрать точку пуска' : 'Select start on map')}
      </button>}
      {type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE && <button className={`sandbox-panel__map-select ${selectingAim ? 'is-active' : ''}`} onClick={onSelectAim}>
        {selectingAim ? (ru ? 'Укажите точку попадания…' : 'Click aim point on map…') : aimPosition ? `${aimPosition.lat.toFixed(2)}, ${aimPosition.lng.toFixed(2)}` : (ru ? 'Выбрать точку попадания' : 'Select aim point')}
      </button>}
      <button className="sandbox-panel__spawn" disabled={!startPosition || (advanced3d && routeMode && waypoints.length < 2) || (type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE && !aimPosition)} onClick={spawn}>{ru ? 'Добавить' : 'Spawn'} {count}</button>
      <button className="sandbox-panel__map-select" disabled={!startPosition} onClick={() => {
        const id = useEngine.getState().launchControllableEntity({
          profileId: CONTROLLABLE_AIR_PROFILE_IDS.SKYFALL_FPV,
          initialPosition: { ...startPosition, altitudeM: 2 },
          initialOrientation: { heading: 0, pitch: 90, roll: 0 },
          selectedTrackId: useEngine.getState().selectedTrackId,
        });
        if (id) { useEngine.getState().setSelectedControllableEntity(id); onFpvSpawn?.(id); }
      }}>{ru ? 'СОЗДАТЬ FPV · SKYFALL' : 'SPAWN FPV · SKYFALL'}</button>
      {feedback && <div className="sandbox-panel__feedback">{feedback}</div>}
    </section>
  );
}

function RangeControl({ label, value, suffix = '', min, max, step, onChange, disabled = false }) {
  return (
    <div className="sandbox-range">
      <label>{label}<output>{value} {suffix}</output></label>
      <input aria-label={label} type="range" value={value} min={min} max={max} step={step} disabled={disabled} onChange={event => onChange(Number(event.target.value))} />
    </div>
  );
}

function ThreatAlerts({ events, language }) {
  const ru = language === UI_LANGUAGE.RU;
  const [visibleAlerts, setVisibleAlerts] = useState([]);
  const seenAlertIds = useRef(new Set());

  useEffect(() => {
    const newAlerts = events.filter(event => (
      event.type === EVENT_TYPE.THREAT_ALERT && !seenAlertIds.current.has(event.id)
    ));
    if (newAlerts.length === 0) return undefined;
    newAlerts.forEach(event => seenAlertIds.current.add(event.id));
    setVisibleAlerts(current => [
      ...current,
      ...newAlerts.map(event => ({ ...event, expiresAt: Date.now() + 6500 })),
    ].slice(-3));
    return undefined;
  }, [events]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      setVisibleAlerts(current => current.filter(event => event.expiresAt > now));
    }, 500);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="threat-alerts" aria-live="polite">
      {visibleAlerts.map(event => (
        <article key={event.id} className="threat-alert">
          <i />
          <div><span>{ru ? 'Воздушная тревога' : 'Target alert'} · {ru ? ({ FORMATION: 'ФОРМАЦИЯ', GROUP: 'ГРУППА', SINGLE: 'ОДИНОЧНЫЙ' }[event.details.launchPattern] ?? event.details.launchPattern) : event.details.launchPattern}</span><strong>{getTargetLabel(event.details.targetType, event.details.modelId)} {event.details.groupSize > 1 ? `${ru ? 'группа' : 'group'} ×${event.details.groupSize}` : (ru ? 'одиночная цель' : 'inbound')}</strong><small>{ru ? 'Расчётная цель' : 'Estimated target'}: {localizeObjective(event.details.objectiveName, language)}</small></div>
        </article>
      ))}
    </div>
  );
}

const getTrackSymbolType = track => (
  track.state === TRACK_STATE.IDENTIFIED
    ? (track.identifiedType ?? 'unknown').toLowerCase()
    : 'unknown'
);

const getTargetAssetType = type => {
  if (type === SIMPLE_TARGET_TYPE.CRUISE_MISSILE || type === 'CRUISE_TARGET') return 'cruise';
  if (type === 'BALLISTIC_PLACEHOLDER' || type === 'BALLISTIC_TARGET') return 'ballistic';
  return 'uav';
};

const getBatteryCategory = battery => {
  if (!battery) return 'SHORT';
  if (battery.category) return battery.category;
  if (battery.type.includes('PATRIOT')) return 'LONG';
  if (battery.type.includes('NASAMS')) return 'MEDIUM';
  if (battery.type.includes('Gepard')) return 'GUN';
  return 'SHORT';
};
