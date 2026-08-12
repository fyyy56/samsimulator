import { useEffect, useMemo, useState } from 'react';
import { Viewer, useCesium, ScreenSpaceEventHandler, ScreenSpaceEvent, ImageryLayer } from 'resium';
import {
  buildModuleUrl,
  Cartesian3,
  Cartographic,
  EllipsoidTerrainProvider,
  Math as CesiumMath,
  ScreenSpaceEventType,
  TileMapServiceImageryProvider,
  UrlTemplateImageryProvider,
} from 'cesium';

import HUD from './ui/HUD';
import AirTargetMarker from './ui/AirTargetMarker';
import BatteryMarker from './ui/BatteryMarker';
import TrackMarker from './ui/TrackMarker';
import MissileMarker from './ui/MissileMarker';
import { RadarCoverage, RadarSweep } from './ui/RadarVisualization';
import { useEngine } from './store/engine';
import { useViewStore } from './store/viewStore.js';

// Локальный terrain provider не зависит от Cesium Ion и стабильно работает в Safari.
const terrainProvider = new EllipsoidTerrainProvider();

// Провайдеры базовых карт
const IMAGERY_PROVIDERS = {
  dark: new UrlTemplateImageryProvider({ url: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png' }),
  light: new UrlTemplateImageryProvider({ url: 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png' }),
  satellite: new UrlTemplateImageryProvider({ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' })
};

// Отдельный слой с названиями городов и дорог (для спутникового режима)
const LABELS_PROVIDER = new UrlTemplateImageryProvider({ 
  url: 'https://a.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png' 
});

const START_DESTINATION = Cartesian3.fromDegrees(33.3, 46.5, 800000.0);
const START_ORIENTATION = {
  heading: CesiumMath.toRadians(0.0),
  pitch: CesiumMath.toRadians(-60.0),
  roll: 0.0
};

function CameraFlyTo() {
  const { camera } = useCesium();
  useEffect(() => {
    if (camera) camera.flyTo({ destination: START_DESTINATION, orientation: START_ORIENTATION, duration: 0 });
  }, [camera]);
  return null;
}

function MapEvents({ onClick, onTrackSelect }) {
  const { viewer } = useCesium();
  
  const handleClick = (movement) => {
    if (!viewer) return;
    const pickedObject = viewer.scene.pick(movement.position);
    const pickedEntityId = typeof pickedObject?.id === 'string'
      ? pickedObject.id
      : pickedObject?.id?.id;
    const pickedTrackId = typeof pickedEntityId === 'string'
      ? pickedEntityId.match(/^TRK-\d+/)?.[0]
      : null;
    if (pickedTrackId) {
      onTrackSelect(pickedTrackId);
      return;
    }
    const cartesian = viewer.scene.camera.pickEllipsoid(movement.position, viewer.scene.globe.ellipsoid);
    if (cartesian) {
      const cartographic = Cartographic.fromCartesian(cartesian);
      onClick(CesiumMath.toDegrees(cartographic.latitude), CesiumMath.toDegrees(cartographic.longitude));
    }
  };
  
  return (
    <ScreenSpaceEventHandler>
      <ScreenSpaceEvent action={handleClick} type={ScreenSpaceEventType.LEFT_CLICK} />
    </ScreenSpaceEventHandler>
  );
}

export default function App() {
  const tick = useEngine(state => state.tick);
  const trackRenderVersion = useEngine(state => state.tracks.map(track => (
    `${track.id}:${track.state}:${track.lastUpdateTime}:${track.trackQuality}`
  )).join('|'));
  const batteryIdList = useEngine(state => state.batteries.map(battery => battery.id).join('|'));
  const missileIdList = useEngine(state => state.missiles.map(missile => missile.id).join('|'));
  const airTargetIdList = useEngine(state => state.airTargets.map(target => target.id).join('|'));
  const draftBattery = useEngine(state => state.draftBattery);
  const selectedTrackId = useEngine(state => state.selectedTrackId);
  const selectedBatteryId = useEngine(state => state.selectedBatteryId);
  const setSelectedTrack = useEngine(state => state.setSelectedTrack);
  const handleMapClick = useEngine(state => state.handleMapClick);
  const closeBuildMenu = useEngine(state => state.closeBuildMenu);
  const allEnemyTargetsVisible = useViewStore(state => state.layers.allEnemyTargets);
  const toggleLayer = useViewStore(state => state.toggleLayer);
  const tracks = trackRenderVersion ? useEngine.getState().tracks : [];
  const batteryIds = useMemo(() => batteryIdList ? batteryIdList.split('|') : [], [batteryIdList]);
  const missileIds = useMemo(() => missileIdList ? missileIdList.split('|') : [], [missileIdList]);
  const airTargetIds = useMemo(() => airTargetIdList ? airTargetIdList.split('|') : [], [airTargetIdList]);
  const activeTrackedTargetIds = new Set(
    tracks.filter(track => track.state !== 'LOST').map(track => track.targetId),
  );
  const visibleTracks = allEnemyTargetsVisible
    ? tracks.filter(track => track.state !== 'LOST')
    : tracks;

  const [mapTheme, setMapTheme] = useState('satellite');
  const [fallbackImagery, setFallbackImagery] = useState(null);

  useEffect(() => {
    const interval = setInterval(() => tick(), 33);
    return () => clearInterval(interval);
  }, [tick]);

  useEffect(() => {
    let isMounted = true;
    TileMapServiceImageryProvider
      .fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII'))
      .then(provider => {
        if (isMounted) setFallbackImagery(provider);
      })
      .catch(() => {
        // Внешние выбранные слои продолжат работать даже без локального fallback.
      });
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100vh', margin: 0, position: 'relative', overflow: 'hidden' }}>
      <style>{`
        .cesium-viewer-bottom { display: none !important; }
      `}</style>

      <div className="map-toolbar" id="map-layer-controls">
        <button
          aria-pressed={allEnemyTargetsVisible}
          title="Global enemy target visibility"
          onClick={() => toggleLayer('allEnemyTargets')}
          className={`map-toolbar__button map-toolbar__button--compact ${allEnemyTargetsVisible ? 'is-active' : ''}`}
        >
          TRACKS {allEnemyTargetsVisible ? 'ON' : 'OFF'}
        </button>
        <button onClick={() => setMapTheme('dark')} className={`map-toolbar__button ${mapTheme === 'dark' ? 'is-active' : ''}`}>DARK</button>
        <button onClick={() => setMapTheme('light')} className={`map-toolbar__button ${mapTheme === 'light' ? 'is-active' : ''}`}>LIGHT</button>
        <button onClick={() => setMapTheme('satellite')} className={`map-toolbar__button ${mapTheme === 'satellite' ? 'is-active' : ''}`}>SAT</button>
      </div>

      <Viewer 
        full 
        terrainProvider={terrainProvider}
        baseLayerPicker={false} 
        animation={false} 
        timeline={false} 
        infoBox={false} 
        selectionIndicator={false}
      >
        {/* Локальная базовая поверхность на случай блокировки внешних тайлов Safari. */}
        {fallbackImagery && <ImageryLayer imageryProvider={fallbackImagery} />}

        {/* Основной слой карты */}
        <ImageryLayer key={`base-map-${mapTheme}`} imageryProvider={IMAGERY_PROVIDERS[mapTheme]} />

        {/* Дополнительный слой с подписями городов (активен только в режиме Satellite) */}
        {mapTheme === 'satellite' && (
          <ImageryLayer imageryProvider={LABELS_PROVIDER} />
        )}

        <CameraFlyTo />
        <MapEvents 
          onTrackSelect={(id) => setSelectedTrack(id)}
          onClick={(lat, lng) => {
            handleMapClick(lat, lng);
            closeBuildMenu();
          }} 
        />

        {batteryIds.map(batteryId => (
          <RadarCoverage key={`radar-zone-${batteryId}`} batteryId={batteryId} />
        ))}
        {draftBattery && <RadarCoverage key={`radar-zone-${draftBattery.id}`} battery={draftBattery} />}

        {batteryIds.map(batteryId => (
          <RadarSweep key={`radar-sweep-${batteryId}`} batteryId={batteryId} />
        ))}

        {batteryIds.map(batteryId => (
          <BatteryMarker
            key={batteryId}
            batteryId={batteryId}
            isSelected={selectedBatteryId === batteryId}
          />
        ))}
        {draftBattery && <BatteryMarker key={draftBattery.id} battery={draftBattery} />}

        {allEnemyTargetsVisible && airTargetIds
          .filter(targetId => !activeTrackedTargetIds.has(targetId))
          .map(targetId => <AirTargetMarker key={targetId} targetId={targetId} />)}

        {visibleTracks.map(track => (
          <TrackMarker 
            key={track.id} 
            track={track} 
            isSelected={selectedTrackId === track.id}
          />
        ))}

        {missileIds.map(missileId => (
          <MissileMarker key={missileId} missileId={missileId} />
        ))}
      </Viewer>
      <HUD />
    </div>
  );
}
