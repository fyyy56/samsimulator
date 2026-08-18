import { memo, useEffect, useMemo, useRef, useState } from 'react';
import Map, { Layer, Marker, Source } from 'react-map-gl/maplibre';
import HUD from '../ui/HUD.jsx';
import {
  INTERCEPTOR_LIFECYCLE_STATE,
  PHYSICS_UPDATE_HZ,
  getAdaptiveVisualUpdateHz,
  getPhysicsSubstepCount,
  useEngine,
  VISUAL_UPDATE_HZ,
} from '../store/engine.js';
import { getDestinationPoint, getDistanceKm } from '../store/geo.js';
import { GAME_MODE_CONFIG, GAME_MODE, UI_LANGUAGE, useGameStore } from '../store/gameStore.js';
import { RADAR_SCAN_TYPE } from '../store/radarSystem.js';
import { SIMPLE_TARGET_TYPE, THEATER_OBJECTS } from '../store/scenarios.js';
import { EVENT_TYPE } from '../store/simulationEvents.js';
import { TRACK_STATE } from '../store/trackSystem.js';
import { SIMPLE_MAP_THEME, useViewStore } from '../store/viewStore.js';
import TacticalAssetIcon from '../ui/TacticalAssetIcon.jsx';
import { COMMAND_MAP_STYLE } from './commandMapStyle.js';
import { getInterceptorSpec } from '../data/interceptors.js';
import {
  getSystemAssetId,
  getTargetAssetId,
  getTargetDisplayName,
  LIGHT_TARGET_MODEL,
} from '../data/lightModeAssets.js';
import LightMapSprite from '../ui/LightMapSprite.jsx';
import { ISKANDER_GAMEPLAY_PROFILE } from '../store/simpleBallisticProfile.js';
import { localizeObjective } from '../data/uiLocalization.js';
import { getMapObjectSizePx, MAP_OBJECT_CLASS } from '../data/mapVisualProfiles.js';
import { useContentStore } from '../store/contentStore.js';
import { compileUserScenario } from '../content/scenarioCompiler.js';
import { useDesignSurface } from '../store/designStore.js';
import { DesignModeButton } from '../ui/DesignModeOverlay.jsx';

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
    version: 8,
    sources: {
      base: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Esri',
      },
      satelliteReference: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 13,
        attribution: 'Boundaries and places © Esri',
      },
    },
    layers: [
      { id: 'satellite-operational-map', type: 'raster', source: 'base' },
      {
        id: 'satellite-place-reference',
        type: 'raster',
        source: 'satelliteReference',
        paint: {
          'raster-opacity': ['interpolate', ['linear'], ['zoom'], 4.5, 0.3, 7, 0.46, 10, 0.66, 13, 0.76],
          'raster-contrast': 0.16,
          'raster-fade-duration': 120,
        },
      },
    ],
  },
});

const lineFeature = coordinates => ({
  type: 'FeatureCollection',
  features: coordinates.length > 1 ? [{
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates },
  }] : [],
});

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

function TargetHoverData({ speedKmh, distanceKm, ru }) {
  return (
    <div className="target-hover-data">
      <span>{ru ? 'СКОРОСТЬ' : 'SPEED'} <b>{speedKmh === null ? '—' : `${Math.round(speedKmh)} км/ч`}</b></span>
      <span>{ru ? 'ДО ОБЪЕКТА' : 'TO OBJECTIVE'} <b>{distanceKm === null ? '—' : `${distanceKm.toFixed(1)} км`}</b></span>
    </div>
  );
}

const getTargetLabel = (type, modelId = null) => {
  if (modelId) return getTargetDisplayName(modelId);
  if (type === SIMPLE_TARGET_TYPE.CRUISE_MISSILE) return 'Cruise missile';
  if (type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE) return 'Искандер-М';
  return 'Герань-2 / Shahed-136';
};

export default function SimpleModeScene({ sandboxMode = false, developerMode = false }) {
  const returnToMenu = useGameStore(state => state.returnToMenu);
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
    tracks,
    sensorContacts,
    airTargets: targets,
    missiles,
    pendingLaunches,
    gunTracers,
    events,
    simulationTime,
  } = visualSnapshot;
  const activeScenarioId = visualSnapshot.activeScenario.id;
  const timeScale = useEngine(state => state.timeScale);
  const selectedTrackId = useEngine(state => state.selectedTrackId);
  const selectedMissileId = useEngine(state => state.selectedMissileId);
  const selectedBatteryId = useEngine(state => state.selectedBatteryId);
  const deployPhase = useEngine(state => state.deployPhase);
  const handleMapClick = useEngine(state => state.handleMapClick);
  const setSelectedTrack = useEngine(state => state.setSelectedTrack);
  const setSelectedMissile = useEngine(state => state.setSelectedMissile);
  const setSelectedBattery = useEngine(state => state.setSelectedBattery);
  const spawnSandboxTargets = useEngine(state => state.spawnSandboxTargets);
  const rotateInstalledComponent = useEngine(state => state.rotateInstalledComponent);
  const allEnemyTargetsVisible = useViewStore(state => state.layers.allEnemyTargets);
  const debugOverlayVisible = useViewStore(state => state.layers.debugOverlay);
  const toggleLayer = useViewStore(state => state.toggleLayer);
  const mapTheme = useViewStore(state => state.simpleMapTheme);
  const setMapTheme = useViewStore(state => state.setSimpleMapTheme);
  const [sandboxStartSelection, setSandboxStartSelection] = useState(false);
  const [sandboxStartPosition, setSandboxStartPosition] = useState(null);
  const [mapZoom, setMapZoom] = useState(5.15);
  const [selectedMapAsset, setSelectedMapAsset] = useState(null);
  const lastVisualPublishTimeRef = useRef(0);
  const topbarDesign = useDesignSurface('game-topbar');
  const toolsMode = sandboxMode || developerMode;
  const selectedScenario = useMemo(
    () => userScenarios.find(scenario => scenario.id === selectedScenarioId) ?? null,
    [selectedScenarioId, userScenarios],
  );
  const compiledScenario = useMemo(() => compileUserScenario(selectedScenario, userAssets), [selectedScenario, userAssets]);

  useEffect(() => {
    configureSimulationProfile(GAME_MODE_CONFIG[GAME_MODE.SIMPLE]);
    resetScenario(sandboxMode ? 'SANDBOX' : 'SIMPLE', sandboxMode ? null : compiledScenario);
  }, [configureSimulationProfile, resetScenario, sandboxMode, compiledScenario]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const substepCount = getPhysicsSubstepCount(timeScale);
      for (let step = 0; step < substepCount; step += 1) tick(substepCount);
    }, 1000 / PHYSICS_UPDATE_HZ);
    return () => window.clearInterval(interval);
  }, [tick, timeScale]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = window.performance.now();
      const engineState = useEngine.getState();
      const activeObjectCount = engineState.airTargets.length + engineState.missiles.length;
      const updateHz = getAdaptiveVisualUpdateHz(activeObjectCount);
      if (now - lastVisualPublishTimeRef.current < 1000 / updateHz) return;
      lastVisualPublishTimeRef.current = now;
      publishVisualSnapshot();
    }, 1000 / VISUAL_UPDATE_HZ);
    return () => window.clearInterval(interval);
  }, [publishVisualSnapshot]);

  const visibleTracks = allEnemyTargetsVisible
    ? []
    : tracks.filter(track => track.state !== TRACK_STATE.LOST);
  const renderedBatteries = draftBattery ? [...batteries, draftBattery] : batteries;
  const targetsById = useMemo(() => new globalThis.Map(targets.map(target => [target.id, target])), [targets]);
  const batteriesById = useMemo(() => new globalThis.Map(
    batteries.map(battery => [battery.id, battery]),
  ), [batteries]);
  const visibleTrackByTargetId = useMemo(() => new globalThis.Map(
    tracks
      .filter(track => track.state !== TRACK_STATE.LOST)
      .map(track => [track.targetId, track]),
  ), [tracks]);
  const strongestSensorContactByTarget = useMemo(() => {
    const contactsByTarget = new globalThis.Map();
    sensorContacts.forEach(contact => {
      const current = contactsByTarget.get(contact.targetId);
      if (!current || contact.evidence > current.evidence) contactsByTarget.set(contact.targetId, contact);
    });
    return contactsByTarget;
  }, [sensorContacts]);
  const recentIntercepts = events.filter(event => (
    event.type === EVENT_TYPE.TARGET_INTERCEPTED
    && event.details.position
    && simulationTime - event.simulationTime < 2.2
  ));

  const onMapClick = (event) => {
    if (toolsMode && sandboxStartSelection && !deployPhase) {
      setSandboxStartPosition({ lat: event.lngLat.lat, lng: event.lngLat.lng });
      setSandboxStartSelection(false);
      return;
    }
    handleMapClick(event.lngLat.lat, event.lngLat.lng);
  };

  return (
    <div className={`simple-scene simple-scene--${mapTheme.toLowerCase()} ${toolsMode ? 'is-sandbox' : ''} ${developerMode ? 'is-developer' : ''} ${timeScale === 0 ? 'is-paused' : ''}`}>
      <Map
        initialViewState={{ longitude: 31.3, latitude: 48.2, zoom: 5.15, bearing: 0, pitch: 0 }}
        mapStyle={SIMPLE_MAP_STYLES[mapTheme]}
        maxBounds={[[20.5, 41.5], [42.5, 54.5]]}
        minZoom={4.65}
        maxZoom={13.5}
        dragRotate={false}
        touchPitch={false}
        pitchWithRotate={false}
        attributionControl={false}
        onClick={onMapClick}
        onMove={event => setMapZoom(event.viewState.zoom)}
        cursor={deployPhase || sandboxStartSelection ? 'crosshair' : 'default'}
      >
        {mapZoom >= 5.8 && THEATER_OBJECTS.map(objective => (
          <Marker key={objective.id} longitude={objective.position.lng} latitude={objective.position.lat} anchor="center">
            <TheaterObjectMarker objective={objective} mapZoom={mapZoom} language={language} />
          </Marker>
        ))}

        {renderedBatteries.map(battery => (
          <RadarOverlay key={`radar-${battery.id}`} battery={battery} mapZoom={mapZoom} />
        ))}

        {batteries.filter(battery => battery.id === selectedBatteryId).map(battery => (
          <EngagementZone key={`engagement-${battery.id}`} battery={battery} mapZoom={mapZoom} />
        ))}

        <TrackVectorLayers tracks={visibleTracks} selectedTrackId={selectedTrackId} />

        <InterceptorNetworkLayers missiles={missiles} tracks={tracks} />

        {gunTracers.map(tracer => (
          <GunTracerLayer
            key={tracer.id}
            tracer={tracer}
            simulationTime={simulationTime}
            target={targetsById.get(tracer.targetId)}
          />
        ))}

        {allEnemyTargetsVisible && <TargetTrailsLayer targets={targets} />}

        {debugOverlayVisible && targets.map(target => (
          <DebugTargetRoute
            key={`debug-route-${target.id}`}
            target={target}
            sensorContact={strongestSensorContactByTarget.get(target.id)}
          />
        ))}

        {renderedBatteries.map(battery => (
          <BatteryMarkers
            key={`units-${battery.id}`}
            battery={battery}
            selected={battery.id === selectedBatteryId}
            selectedMapAsset={selectedMapAsset}
            isDraft={battery === draftBattery}
            mapZoom={mapZoom}
            language={language}
            mapZoom={mapZoom}
            onSelect={(asset) => {
              setSelectedMapAsset(asset);
              if (battery !== draftBattery) setSelectedBattery(battery.id);
            }}
            onRotate={(componentType, componentId, degrees) => (
              rotateInstalledComponent(battery.id, componentType, componentId, degrees)
            )}
          />
        ))}

        {allEnemyTargetsVisible && targets.map(target => (
          <TargetMarker
            key={target.id}
            target={target}
            language={language}
            track={visibleTrackByTargetId.get(target.id)}
            onSelectTrack={setSelectedTrack}
          />
        ))}

        {visibleTracks.map(track => {
          const scanAge = simulationTime - track.lastUpdateTime;
          const target = targetsById.get(track.targetId);
          const identified = track.state === TRACK_STATE.IDENTIFIED;
          const targetDistanceKm = target ? getRemainingTargetDistanceKm(target, track.reportedPosition) : null;
          return (
            <Marker
              key={`marker-${track.id}`}
              longitude={track.reportedPosition.lng}
              latitude={track.reportedPosition.lat}
              anchor="center"
            >
              <button
                className={`simple-track simple-track--${track.state.toLowerCase()} ${track.id === selectedTrackId ? 'is-selected' : ''} ${scanAge < 0.42 ? 'is-scan-hit' : ''}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedTrack(track.id);
                }}
                title={track.id}
              >
                {identified && target ? (
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
                )}
                <TargetHoverData speedKmh={track.reportedSpeedKmh} distanceKm={targetDistanceKm} ru={ru} />
                <span>{getTrackGameLabel(track, target)}</span>
              </button>
            </Marker>
          );
        })}

        {pendingLaunches.filter(launch => launch.phase === 'LAUNCHING').map(launch => (
          <Marker key={launch.id} longitude={launch.lng} latitude={launch.lat} anchor="center">
            <div className={`launcher-sequence launcher-sequence--${launch.phase.toLowerCase()}`}>
              <i className="launcher-sequence__smoke" />
              <i className="launcher-sequence__flash" />
            </div>
          </Marker>
        ))}

        {missiles.map(missile => {
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
              <Marker key={`marker-${missile.id}`} longitude={missile.lng} latitude={missile.lat} anchor="center">
                <div className="interceptor-self-destruct"><span /></div>
              </Marker>
            );
          }
          return (
          <Marker key={`marker-${missile.id}`} longitude={missile.lng} latitude={missile.lat} anchor="center">
            <button
              className={`simple-interceptor simple-interceptor--${missile.lifecycleState?.toLowerCase() ?? 'flying'} ${selectedMissileId === missile.id ? 'is-selected' : ''}`}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedMissile(missile.id);
              }}
              title={missile.id}
            >
              <LightMapSprite
                assetId={getSystemAssetId(category, 'interceptor')}
                heading={missile.heading}
                sizePx={getMapObjectSizePx(MAP_OBJECT_CLASS.INTERCEPTOR, mapZoom)}
              />
              <div className="interceptor-telemetry" aria-label={ru ? 'Параметры перехватчика' : 'Interceptor telemetry'}>
                <span>{Math.round(missile.speedKmh)} <i>{ru ? 'км/ч' : 'km/h'}</i></span>
                <span>{targetDistanceKm === null ? '—' : targetDistanceKm.toFixed(1)} <i>{ru ? 'км' : 'km'}</i></span>
              </div>
              {missile.flightTime < 0.55 && <i className="launch-flash" />}
            </button>
          </Marker>
          );
        })}

        {recentIntercepts.map(event => (
          <Marker
            key={event.id}
            longitude={event.details.position.lng}
            latitude={event.details.position.lat}
            anchor="center"
          >
            <div className="intercept-effect"><span /></div>
          </Marker>
        ))}

        {sandboxStartPosition && (
          <Marker longitude={sandboxStartPosition.lng} latitude={sandboxStartPosition.lat} anchor="center">
            <div className="sandbox-start-marker"><span>+</span><small>LAUNCH POINT</small></div>
          </Marker>
        )}
      </Map>

      <div className="simple-scene__topbar" data-design-id="game-topbar" data-design-name="Верхняя панель" style={topbarDesign}>
        <button onClick={returnToMenu}>← {ru ? 'Меню' : 'Menu'}</button>
        <span>{developerMode ? (ru ? 'Режим разработчика' : 'Developer Mode') : sandboxMode ? (ru ? 'Полигон' : 'Sandbox') : (ru ? 'Командный режим' : 'Simple Mode')} · {targets.length} {ru ? 'целей' : 'airborne'}</span>
        {[SIMPLE_MAP_THEME.DARK, SIMPLE_MAP_THEME.SATELLITE, SIMPLE_MAP_THEME.LIGHT].map(theme => (
          <button key={theme} className={mapTheme === theme ? 'is-active' : ''} onClick={() => setMapTheme(theme)}>{ru ? ({ DARK: 'ТЁМНАЯ', SATELLITE: 'СПУТНИК', LIGHT: 'КОМАНДНАЯ' }[theme]) : (theme === SIMPLE_MAP_THEME.LIGHT ? 'COMMAND' : theme)}</button>
        ))}
        <button
          className={allEnemyTargetsVisible ? 'is-active' : ''}
          onClick={() => toggleLayer('allEnemyTargets')}
        >
          {ru ? 'Цели' : 'Tracks'} {allEnemyTargetsVisible ? (ru ? 'ВСЕ' : 'ALL') : (ru ? 'ПО РЛС' : 'RADAR')}
        </button>
        <button
          className={debugOverlayVisible ? 'is-active' : ''}
          onClick={() => toggleLayer('debugOverlay')}
        >
          DEBUG {debugOverlayVisible ? 'ON' : 'OFF'}
        </button>
        <DesignModeButton compact />
      </div>

      {toolsMode && (
        <SandboxPanel
          startPosition={sandboxStartPosition}
          selectingStart={sandboxStartSelection}
          onSelectStart={() => setSandboxStartSelection(value => !value)}
          onSpawn={spawnSandboxTargets}
          language={language}
        />
      )}
      <ThreatAlerts key={activeScenarioId} events={events} language={language} />
      <HUD simpleMode />
    </div>
  );
}

const getRadarPoint = (center, radius, angle, distanceScale = 1) => {
  const radians = angle * Math.PI / 180;
  return {
    x: center + Math.sin(radians) * radius * distanceScale,
    y: center - Math.cos(radians) * radius * distanceScale,
  };
};

const getSectorPoints = (center, radius, sector, heading) => {
  if (sector >= 360) return null;
  const pointCount = Math.max(12, Math.ceil(sector / 5));
  const points = [`${center},${center}`];
  for (let index = 0; index <= pointCount; index += 1) {
    const angle = heading - sector / 2 + sector * index / pointCount;
    const point = getRadarPoint(center, radius, angle);
    points.push(`${point.x},${point.y}`);
  }
  return points.join(' ');
};

const getSweepPoints = (center, radius, azimuth, width, direction) => {
  const pointCount = Math.max(4, Math.ceil(width / 2));
  const points = [`${center},${center}`];
  for (let index = 0; index <= pointCount; index += 1) {
    const angle = azimuth - width * direction + width * direction * index / pointCount;
    const point = getRadarPoint(center, radius, angle);
    points.push(`${point.x},${point.y}`);
  }
  return points.join(' ');
};

const radarOverlayPropsEqual = (previous, next) => {
  const previousRadar = previous.battery.components.radar;
  const nextRadar = next.battery.components.radar;
  if (previous.mapZoom !== next.mapZoom) return false;
  if (!previousRadar || !nextRadar) return previousRadar === nextRadar;
  if (
    previousRadar.lat !== nextRadar.lat
    || previousRadar.lng !== nextRadar.lng
    || previous.battery.radarRangeKm !== next.battery.radarRangeKm
    || previous.battery.radarSector !== next.battery.radarSector
    || previous.battery.radarHeading !== next.battery.radarHeading
    || previous.battery.radarScanType !== next.battery.radarScanType
  ) return false;
  if (next.battery.radarScanType === RADAR_SCAN_TYPE.ELECTRONIC_SECTOR) return true;
  return previousRadar.scanState?.currentAzimuth === nextRadar.scanState?.currentAzimuth;
};

const RadarOverlay = memo(function RadarOverlay({ battery, mapZoom }) {
  const radar = battery.components.radar;
  if (!radar) return null;
  const scanState = radar.scanState;
  const isElectronic = scanState.scanType === RADAR_SCAN_TYPE.ELECTRONIC_SECTOR;
  const metersPerPixel = 156543.03392 * Math.cos(radar.lat * Math.PI / 180) / (2 ** mapZoom);
  const radius = Math.max(7, battery.radarRangeKm * 1000 / metersPerPixel);
  const padding = 8;
  const center = radius + padding;
  const size = (radius + padding) * 2;
  const currentBeamEnd = getRadarPoint(center, radius, scanState.currentAzimuth);

  const sectorPoints = getSectorPoints(center, radius, battery.radarSector, battery.radarHeading);

  return (
    <Marker longitude={radar.lng} latitude={radar.lat} anchor="center">
      <svg className={`radar-overlay ${isElectronic ? 'is-electronic' : 'is-mechanical'}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {sectorPoints ? (
          <polygon className="radar-overlay__coverage" points={sectorPoints} />
        ) : (
          <circle className="radar-overlay__coverage" cx={center} cy={center} r={radius} />
        )}

        {!isElectronic && (
          <>
            <polygon className="radar-overlay__tail radar-overlay__tail--wide" points={getSweepPoints(center, radius, scanState.currentAzimuth, 20, scanState.direction)} />
            <polygon className="radar-overlay__tail radar-overlay__tail--medium" points={getSweepPoints(center, radius, scanState.currentAzimuth, 10, scanState.direction)} />
            <polygon className="radar-overlay__tail radar-overlay__tail--narrow" points={getSweepPoints(center, radius, scanState.currentAzimuth, 4, scanState.direction)} />
            <line className="radar-overlay__beam" x1={center} y1={center} x2={currentBeamEnd.x} y2={currentBeamEnd.y} />
          </>
        )}

        <circle className="radar-overlay__origin" cx={center} cy={center} r="2.4" />
      </svg>
    </Marker>
  );
}, radarOverlayPropsEqual);

function EngagementZone({ battery, mapZoom }) {
  const launcher = battery.components.launchers[0] ?? battery.components.fdc;
  if (!launcher) return null;
  const rangeKm = battery.weaponType === 'GUN_AA'
    ? battery.engagementRangeKm
    : getInterceptorSpec(battery.interceptorSpecId).publicDisplay.rangeKm;
  const metersPerPixel = 156543.03392 * Math.cos(launcher.lat * Math.PI / 180) / (2 ** mapZoom);
  const radius = Math.max(6, rangeKm * 1000 / metersPerPixel);
  const padding = 5;
  const size = (radius + padding) * 2;
  const center = size / 2;
  return (
    <Marker longitude={launcher.lng} latitude={launcher.lat} anchor="center">
      <svg className="engagement-zone" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={center} cy={center} r={radius} />
      </svg>
    </Marker>
  );
}

function TrackVectorLayers({ tracks, selectedTrackId }) {
  const data = {
    type: 'FeatureCollection',
    features: tracks.flatMap(track => {
      if (track.reportedHeading === null) return [];
      const endpoint = getDestinationPoint(
        track.reportedPosition.lat,
        track.reportedPosition.lng,
        track.reportedHeading,
        Math.min(24, 8 + (track.reportedSpeedKmh ?? 0) / 190),
      );
      return [{
        type: 'Feature',
        properties: {
          state: track.state,
          selected: track.id === selectedTrackId,
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [track.reportedPosition.lng, track.reportedPosition.lat],
            [endpoint.lng, endpoint.lat],
          ],
        },
      }];
    }),
  };
  return (
    <Source id="track-vectors" type="geojson" data={data}>
      <Layer
        id="track-vectors-active"
        type="line"
        filter={['!=', ['get', 'state'], TRACK_STATE.LOST]}
        paint={{
          'line-color': '#df6962',
          'line-opacity': ['case', ['get', 'selected'], 0.95, 0.68],
          'line-width': ['case', ['get', 'selected'], 1.5, 1],
        }}
      />
      <Layer
        id="track-vectors-lost"
        type="line"
        filter={['==', ['get', 'state'], TRACK_STATE.LOST]}
        paint={{
          'line-color': '#df6962',
          'line-opacity': 0.32,
          'line-width': 1,
          'line-dasharray': [2, 2],
        }}
      />
    </Source>
  );
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
      <Marker longitude={head.lng} latitude={head.lat} anchor="center">
        <i className="gun-tracer-head" />
      </Marker>
    </>
  );
}

function DebugTargetRoute({ target, sensorContact }) {
  const remainingRoute = target.route.slice(target.waypointIndex);
  const coordinates = [
    [target.position.lng, target.position.lat],
    ...remainingRoute.map(point => [point.lng, point.lat]),
  ];
  return (
    <>
      <Source id={`debug-route-${target.id}`} type="geojson" data={lineFeature(coordinates)}>
        <Layer
          id={`debug-route-line-${target.id}`}
          type="line"
          paint={{
            'line-color': '#e8c66f',
            'line-opacity': 0.52,
            'line-width': 1,
            'line-dasharray': [2, 2],
          }}
        />
      </Source>
      {remainingRoute.map((waypoint, index) => (
        <Marker
          key={`${target.id}-waypoint-${target.waypointIndex + index}`}
          longitude={waypoint.lng}
          latitude={waypoint.lat}
          anchor="center"
        >
          <div className={`debug-waypoint ${index === remainingRoute.length - 1 ? 'is-destination' : ''}`}>
            <i />
            <span>{index === remainingRoute.length - 1 ? 'DEST' : `W${target.waypointIndex + index + 1}`}</span>
          </div>
        </Marker>
      ))}
      <Marker longitude={target.position.lng} latitude={target.position.lat} anchor="bottom-left">
        <div className="debug-target-data">
          <strong>
            {target.id} · {target.routeType ?? 'DIRECT'}
            {target.routeType === 'GROUP' && target.baseRouteType ? `/${target.baseRouteType}` : ''}
          </strong>
          <span>{target.altitudeBand ?? '—'} · {Math.round(target.altitudeM)} m</span>
          <span>HDG {target.heading.toFixed(1)}° → {(target.desiredHeading ?? target.heading).toFixed(1)}° · TURN {target.turnRateDegPerSec ?? 0}°/s</span>
          <span>V/S {Math.round(target.verticalSpeedMps ?? 0)} m/s · WP {target.waypointIndex + 1}/{target.route.length}</span>
          <span>EVID {sensorContact?.evidence?.toFixed(3) ?? '0.000'} · {sensorContact?.stage ?? 'NO TRACK'}</span>
          <span>SCAN {sensorContact?.lastOpportunityCount ?? 0} · Δ {sensorContact?.lastContribution?.toFixed(3) ?? '0.000'}</span>
        </div>
      </Marker>
    </>
  );
}

function InterceptorNetworkLayers({ missiles, tracks }) {
  const tracksById = new globalThis.Map(tracks.map(track => [track.id, track]));
  const visibleMissiles = missiles.filter(missile => (
    missile.lifecycleState !== INTERCEPTOR_LIFECYCLE_STATE.SELF_DESTRUCT
  ));
  const trajectories = {
    type: 'FeatureCollection',
    features: visibleMissiles.flatMap(missile => {
      const coordinates = missile.trajectory.map(point => [point.lng, point.lat]);
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
      if (!track || !['GUIDING', 'TERMINAL'].includes(missile.guidanceState)) return [];
      return [{
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [missile.lng, missile.lat],
            [track.reportedPosition.lng, track.reportedPosition.lat],
          ],
        },
      }];
    }),
  };
  return (
    <>
      <Source id="interceptor-trajectories" type="geojson" data={trajectories}>
        <Layer id="interceptor-trail-glow" type="line" paint={{ 'line-color': '#b7c9bb', 'line-opacity': 0.1, 'line-width': 4 }} />
        <Layer id="interceptor-trail-lines" type="line" paint={{ 'line-color': '#a8c0ad', 'line-opacity': 0.58, 'line-width': 1.35, 'line-dasharray': [1, 1.5] }} />
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
  const radarAssetId = `${battery.id}:RADAR`;
  return (
    <>
      {radar && category !== 'GUN' && (
        <Marker longitude={radar.lng} latitude={radar.lat} anchor="center">
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
        <Marker key={launcher.id} longitude={launcher.lng} latitude={launcher.lat} anchor="center">
          <div className={`light-defense-object light-defense-object--launcher ${category === 'GUN' ? 'light-defense-object--gepard' : ''} ${launcher.launchState === 'FIRING' ? 'is-firing' : ''} ${selectedMapAsset?.id === launcherAssetId ? 'is-selected' : ''} ${isDraft ? 'is-draft' : ''}`}>
            <button onClick={(event) => { event.stopPropagation(); onSelect({ id: launcherAssetId, type: 'LAUNCHER', componentId: launcher.id }); }}>
              <LightMapSprite assetId={getSystemAssetId(category, 'launcher', launcher.heading ?? 0)} heading={launcher.heading ?? 0} selected={selectedMapAsset?.id === launcherAssetId} sizePx={getMapObjectSizePx(MAP_OBJECT_CLASS.LAUNCHER, mapZoom) * (category === 'GUN' ? Math.max(1, 2 - Math.max(0, mapZoom - 5) * 0.18) : 1)} />
              {category === 'GUN' && launcher.launchState === 'FIRING' && (
                <span className="gepard-fire-effect" style={{ '--gun-heading': `${launcher.heading ?? 0}deg` }}>
                  <i /><i /><i />
                </span>
              )}
              {category !== 'GUN' && (mapZoom >= 6.5 || selected) && <small>{battery.type} · LN {index + 1}</small>}
            </button>
          </div>
        </Marker>
        );
      })}
    </>
  );
}

function TargetMarker({ target, track, onSelectTrack, language, mapZoom }) {
  const typeClass = getTargetAssetType(target.type);
  const ru = language === UI_LANGUAGE.RU;
  const targetDistanceKm = getRemainingTargetDistanceKm(target);
  return (
    <Marker longitude={target.position.lng} latitude={target.position.lat} anchor="center">
      <button
        className={`simple-global-target simple-global-target--${typeClass} ${track ? 'has-track' : ''}`}
        title={`${getTargetLabel(target.type, target.modelId)} · ${target.speedKmh} km/h · ${Math.round(target.altitudeM)} m`}
        onClick={(event) => {
          event.stopPropagation();
          if (track) onSelectTrack(track.id);
        }}
      >
        <LightMapSprite assetId={getTargetAssetId(target)} sourceUrl={target.customAssetUrl} sourceOffsetX={target.customAssetOffsetX} sourceOffsetY={target.customAssetOffsetY} heading={target.heading} sizePx={getMapObjectSizePx(MAP_OBJECT_CLASS.TARGET, mapZoom) * (target.customAssetScale ?? 1)} />
        {target.type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE && <small>{target.flightPhase}</small>}
        <TargetHoverData speedKmh={target.speedKmh} distanceKm={targetDistanceKm} ru={ru} />
      </button>
    </Marker>
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

function SandboxPanel({ startPosition, selectingStart, onSelectStart, onSpawn, language }) {
  const ru = language === UI_LANGUAGE.RU;
  const [collapsed, setCollapsed] = useState(false);
  const [type, setType] = useState(SIMPLE_TARGET_TYPE.UAV);
  const [modelId, setModelId] = useState(LIGHT_TARGET_MODEL.GERAN_2);
  const [count, setCount] = useState(5);
  const [speedKmh, setSpeedKmh] = useState(250);
  const [altitudeM, setAltitudeM] = useState(250);
  const [objectiveId, setObjectiveId] = useState(THEATER_OBJECTS[0].id);
  const [feedback, setFeedback] = useState('');
  const designStyle = useDesignSurface('game-spawn-tools');

  const changeModel = (nextModelId) => {
    setModelId(nextModelId);
    const nextType = nextModelId === LIGHT_TARGET_MODEL.GERAN_2
      ? SIMPLE_TARGET_TYPE.UAV
      : nextModelId === LIGHT_TARGET_MODEL.ISKANDER_M
        ? SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE
        : SIMPLE_TARGET_TYPE.CRUISE_MISSILE;
    setType(nextType);
    if (nextType === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE) {
      setCount(1);
      setSpeedKmh(ISKANDER_GAMEPLAY_PROFILE.speedKmh);
      setAltitudeM(250);
    } else if (nextType === SIMPLE_TARGET_TYPE.CRUISE_MISSILE) {
      setSpeedKmh(800);
      setAltitudeM(100);
    } else {
      setSpeedKmh(250);
      setAltitudeM(250);
    }
  };
  const speedRange = type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE
    ? { min: ISKANDER_GAMEPLAY_PROFILE.speedKmh, max: ISKANDER_GAMEPLAY_PROFILE.speedKmh, step: 1 }
    : type === SIMPLE_TARGET_TYPE.CRUISE_MISSILE
    ? { min: 650, max: 950, step: 10 }
    : { min: 100, max: 500, step: 10 };
  const altitudeRange = type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE
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
      objectiveId,
    });
    setFeedback(ru ? `Целей добавлено: ${spawned}` : `${spawned} target${spawned === 1 ? '' : 's'} inserted`);
    window.setTimeout(() => setFeedback(''), 2600);
  };

  if (collapsed) {
    return <button className="sandbox-panel__restore" data-design-id="game-spawn-tools" data-design-name="Инструменты спавна" style={designStyle} onClick={() => setCollapsed(false)}>{ru ? 'Добавить цель' : 'Spawn Target'}</button>;
  }

  return (
    <section className="sandbox-panel" data-design-id="game-spawn-tools" data-design-name="Инструменты спавна" style={designStyle}>
      <header><div><span>{ru ? 'Полигон' : 'Sandbox'}</span><strong>{ru ? 'Добавить цель' : 'Spawn Target'}</strong></div><button onClick={() => setCollapsed(true)}>−</button></header>
      <label>{ru ? 'Тип' : 'Type'}</label>
      <div className="sandbox-panel__segments">
        <button className={modelId === LIGHT_TARGET_MODEL.GERAN_2 ? 'is-active' : ''} onClick={() => changeModel(LIGHT_TARGET_MODEL.GERAN_2)}>Герань-2</button>
        <button className={modelId === LIGHT_TARGET_MODEL.KH_101 ? 'is-active' : ''} onClick={() => changeModel(LIGHT_TARGET_MODEL.KH_101)}>Х-101</button>
        <button className={modelId === LIGHT_TARGET_MODEL.KALIBR ? 'is-active' : ''} onClick={() => changeModel(LIGHT_TARGET_MODEL.KALIBR)}>Калибр</button>
        <button className={modelId === LIGHT_TARGET_MODEL.ISKANDER_M ? 'is-active' : ''} onClick={() => changeModel(LIGHT_TARGET_MODEL.ISKANDER_M)}>Искандер-М</button>
      </div>
      <RangeControl label={ru ? 'Количество' : 'Quantity'} value={count} min={1} max={type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE ? 12 : 50} step={1} onChange={setCount} />
      <RangeControl label={ru ? 'Скорость' : 'Speed'} value={speedKmh} suffix={ru ? 'км/ч' : 'km/h'} {...speedRange} onChange={setSpeedKmh} disabled={type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE} />
      {type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE ? (
        <div className="sandbox-panel__ballistic-note">{ru ? 'Упрощённая дуга · апогей' : 'Simplified arc · apex'} {Math.round(ISKANDER_GAMEPLAY_PROFILE.apexAltitudeM / 1000)} км</div>
      ) : (
        <RangeControl label={ru ? 'Высота' : 'Altitude'} value={altitudeM} suffix={ru ? 'м' : 'm'} {...altitudeRange} onChange={setAltitudeM} />
      )}
      <label htmlFor="sandbox-objective">{ru ? 'Цель удара' : 'Estimated target'}</label>
      <select id="sandbox-objective" value={objectiveId} onChange={event => setObjectiveId(event.target.value)}>
        {THEATER_OBJECTS.map(objective => <option key={objective.id} value={objective.id}>{localizeObjective(objective.name, language)} · {objective.category}</option>)}
      </select>
      <button className={`sandbox-panel__map-select ${selectingStart ? 'is-active' : ''}`} onClick={onSelectStart}>
        {selectingStart ? (ru ? 'Укажите точку пуска…' : 'Click launch point on map…') : startPosition ? `${startPosition.lat.toFixed(2)}, ${startPosition.lng.toFixed(2)}` : (ru ? 'Выбрать точку пуска' : 'Select start on map')}
      </button>
      <button className="sandbox-panel__spawn" disabled={!startPosition} onClick={spawn}>{ru ? 'Добавить' : 'Spawn'} {count}</button>
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

const getTrackGameLabel = (track, target) => {
  if (track.state !== TRACK_STATE.IDENTIFIED) return track.id;
  return target ? getTargetDisplayName(target) : 'IDENTIFIED THREAT';
};

const getBatteryCategory = battery => {
  if (!battery) return 'SHORT';
  if (battery.category) return battery.category;
  if (battery.type.includes('PATRIOT')) return 'LONG';
  if (battery.type.includes('NASAMS')) return 'MEDIUM';
  if (battery.type.includes('Gepard')) return 'GUN';
  return 'SHORT';
};
