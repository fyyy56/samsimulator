import React, { useEffect, useState } from 'react';
import { Viewer, useCesium, Entity, PolygonGraphics, PolylineGraphics, ScreenSpaceEventHandler, ScreenSpaceEvent, ImageryLayer } from 'resium';
import { Cartesian3, Terrain, Math as CesiumMath, Color, ScreenSpaceEventType, Cartographic, UrlTemplateImageryProvider } from 'cesium';

import HUD from './ui/HUD';
import BatteryMarker from './ui/BatteryMarker';
import TrackMarker from './ui/TrackMarker';
import MissileMarker from './ui/MissileMarker';
import { useEngine, generateRadarPolygon, generateRadarBeam } from './store/engine';

const terrainProvider = Terrain.fromWorldTerrain();

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
    if (pickedObject && pickedObject.id && pickedObject.id.id && pickedObject.id.id.startsWith('TRK')) {
      onTrackSelect(pickedObject.id.id);
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

const getBtnStyle = (isActive) => ({
  background: isActive ? 'rgba(56, 189, 248, 0.2)' : 'rgba(20, 22, 19, 0.9)',
  border: `1px solid ${isActive ? '#38bdf8' : 'rgba(163, 171, 142, 0.5)'}`,
  color: isActive ? '#38bdf8' : '#e5e7eb',
  padding: '8px 12px',
  fontFamily: "'Space Mono', monospace",
  fontSize: '12px',
  cursor: 'pointer',
  borderRadius: '2px',
  boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
  transition: 'all 0.2s'
});

export default function App() {
  const { 
    tick, tracks, batteries, missiles, draftBattery,
    selectedTrackId, setSelectedTrack, 
    handleMapClick, closeBuildMenu
  } = useEngine();

  const [mapTheme, setMapTheme] = useState('satellite');

  useEffect(() => {
    const interval = setInterval(() => tick(), 33);
    return () => clearInterval(interval);
  }, [tick]);

  const allBatteries = [...batteries];
  if (draftBattery) allBatteries.push(draftBattery);

  return (
    <div style={{ width: '100%', height: '100vh', margin: 0, position: 'relative', overflow: 'hidden' }}>
      <style>{`
        .cesium-viewer-bottom { display: none !important; }
      `}</style>

      <div style={{ position: 'absolute', top: '24px', right: '24px', zIndex: 50, display: 'flex', gap: '8px', pointerEvents: 'auto' }}>
        <button onClick={() => setMapTheme('dark')} style={getBtnStyle(mapTheme === 'dark')}>🌙 DARK</button>
        <button onClick={() => setMapTheme('light')} style={getBtnStyle(mapTheme === 'light')}>☀️ LIGHT</button>
        <button onClick={() => setMapTheme('satellite')} style={getBtnStyle(mapTheme === 'satellite')}>🌍 SATELLITE</button>
      </div>

      <Viewer 
        full 
        terrain={terrainProvider}
        baseLayerPicker={false} 
        animation={false} 
        timeline={false} 
        infoBox={false} 
        selectionIndicator={false}
      >
        {/* Основной слой карты */}
        <ImageryLayer imageryProvider={IMAGERY_PROVIDERS[mapTheme]} />

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

        {allBatteries.map(b => {
          if (!b.components.radar) return null;
          const coords = generateRadarPolygon(b.components.radar.lat, b.components.radar.lng, b.radarRangeKm, b.radarSector, b.radarHeading);
          const flatCoords = coords.flatMap(c => [c[0], c[1]]);
          return (
            <Entity key={`radar-zone-${b.id}`}>
              <PolygonGraphics 
                hierarchy={Cartesian3.fromDegreesArray(flatCoords)}
                material={Color.fromCssColorString('#4ade80').withAlpha(0.15)}
                outline={true}
                outlineColor={Color.fromCssColorString('#4ade80')}
              />
            </Entity>
          );
        })}

        {batteries.map(b => {
          if (!b.components.radar || b.radarSector < 360) return null;
          const beam = generateRadarBeam(b.components.radar.lat, b.components.radar.lng, b.radarRangeKm, b.currentAngle);
          const flatBeam = beam.flatMap(c => [c[0], c[1]]);
          return (
            <Entity key={`beam-${b.id}`}>
              <PolylineGraphics 
                positions={Cartesian3.fromDegreesArray(flatBeam)}
                width={2}
                material={Color.fromCssColorString('#4ade80')}
              />
            </Entity>
          );
        })}

        {allBatteries.map(battery => (
          <BatteryMarker key={battery.id} battery={battery} />
        ))}

        {tracks.map(track => track.visible && (
          <TrackMarker 
            key={track.id} 
            track={track} 
            isSelected={selectedTrackId === track.id}
          />
        ))}

        {missiles.map(missile => (
          <MissileMarker key={missile.id} missile={missile} />
        ))}
      </Viewer>
      <HUD />
    </div>
  );
}
