import { useEffect, useMemo, useRef, useState } from 'react';
import { Cartesian2, Cartesian3, Cartographic, Color, Math as CesiumMath, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium';
import { UI_LANGUAGE, useGameStore } from '../../store/gameStore.js';
import { useEngine } from '../../store/engine.js';
import { useSandboxSpawnDraftStore } from '../../store/sandboxSpawnDraftStore.js';
import { SandboxPanel } from '../SimpleModeScene.jsx';
import { formatRouteEta, generateTargetRoute, getTargetRouteDistanceKm, TARGET_ROUTE_PRESET } from './routePresets.js';

// Advanced reuses the COMMAND spawn form and engine API. Only point picking is
// adapted from MapLibre coordinates to the Cesium globe.
export default function AdvancedSessionPanel({ viewer, onFocus, onOls, ru, sandboxMode = false,
  trajectoryTrailEnabled = false, onTrajectoryTrailChange }) {
  const language = useGameStore(state => state.language);
  const startPosition = useSandboxSpawnDraftStore(state => state.startPosition);
  const aimPosition = useSandboxSpawnDraftStore(state => state.aimPosition);
  const setStartPosition = useSandboxSpawnDraftStore(state => state.setStartPosition);
  const setAimPosition = useSandboxSpawnDraftStore(state => state.setAimPosition);
  const [selecting, setSelecting] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [routeMode, setRouteMode] = useState(false);
  const [waypoints, setWaypoints] = useState([]);
  const [routePreset, setRoutePreset] = useState(TARGET_ROUTE_PRESET.MANUAL);
  const [routeStyle, setRouteStyle] = useState('CRUISE');
  const [routeEnd, setRouteEnd] = useState(null);
  const selectingRef = useRef(null);
  const batteries = useEngine(state => state.batteries);
  const radars = useEngine(state => state.searchRadars);
  const { speedKmh } = useSandboxSpawnDraftStore(state => state.draft);
  const routePoints = useMemo(() => {
    if (!routeMode) return [];
    return routePreset === TARGET_ROUTE_PRESET.MANUAL ? waypoints
      : generateTargetRoute(startPosition, routeEnd, routePreset, routeStyle);
  }, [routeMode, routePreset, routeStyle, waypoints, startPosition, routeEnd]);
  const routeDistanceKm = useMemo(() => getTargetRouteDistanceKm(routePoints), [routePoints]);

  useEffect(() => { selectingRef.current = selecting; }, [selecting]);
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()
      || (!selecting && !(sandboxMode && panelOpen && routeMode))) return undefined;
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(event => {
      if (!selectingRef.current && !(panelOpen && routeMode)) return;
      const ray = viewer.camera.getPickRay(event.position);
      const point = ray && viewer.scene.globe.pick(ray, viewer.scene);
      if (!point) return;
      const location = Cartographic.fromCartesian(point);
      const value = { lat: CesiumMath.toDegrees(location.latitude),
        lng: CesiumMath.toDegrees(location.longitude) };
      if (!Number.isFinite(value.lat) || !Number.isFinite(value.lng)) return;
      if (selectingRef.current === 'START') {
        setStartPosition(value); selectingRef.current = null; setSelecting(null);
      } else if (selectingRef.current === 'AIM') {
        setAimPosition(value); selectingRef.current = null; setSelecting(null);
      } else if (selectingRef.current === 'ROUTE_START') {
        setStartPosition(value); selectingRef.current = null; setSelecting(null);
      } else if (selectingRef.current === 'ROUTE_END') {
        setRouteEnd(value); selectingRef.current = null; setSelecting(null);
      } else if (panelOpen && routeMode && sandboxMode) {
        if (routePreset === TARGET_ROUTE_PRESET.MANUAL) {
          if (waypoints.length === 0) setStartPosition(value);
          setWaypoints(points => [...points, value]);
        }
      }
    }, ScreenSpaceEventType.LEFT_CLICK);
    const cancel = event => { if (event.key === 'Escape' && selectingRef.current) {
      selectingRef.current = null; setSelecting(null);
    } };
    window.addEventListener('keydown', cancel);
    return () => { handler.destroy(); window.removeEventListener('keydown', cancel); };
  }, [viewer, panelOpen, routeMode, routePreset, sandboxMode, selecting, waypoints.length, setAimPosition, setStartPosition]);

  useEffect(() => {
    if (!sandboxMode || !panelOpen || !routeMode || routePreset !== TARGET_ROUTE_PRESET.MANUAL) return undefined;
    const undo = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        const next = waypoints.slice(0, -1);
        setStartPosition(next[0] ?? null);
        setWaypoints(next);
      }
    };
    window.addEventListener('keydown', undo);
    return () => window.removeEventListener('keydown', undo);
  }, [sandboxMode, panelOpen, routeMode, routePreset, waypoints, setStartPosition]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !panelOpen || !routeMode || routePoints.length === 0) return undefined;
    const entities = routePoints.map((point, index) => viewer.entities.add({
      position: Cartesian3.fromDegrees(point.lng, point.lat, 30),
      point: { pixelSize: index === routePoints.length - 1 ? 10 : 7,
        color: index === routePoints.length - 1 ? Color.ORANGE : Color.CYAN },
      label: { text: String(index + 1), font: '12px sans-serif',
        pixelOffset: new Cartesian2(0, -13), fillColor: Color.WHITE },
    }));
    const positions = routePoints.map(point => Cartesian3.fromDegrees(point.lng, point.lat, 30));
    const line = routePoints.length > 1 ? viewer.entities.add({
      polyline: { positions, width: 2, material: Color.CYAN.withAlpha(.85) },
    }) : null;
    return () => { entities.forEach(entity => viewer.entities.remove(entity)); if (line) viewer.entities.remove(line); };
  }, [viewer, panelOpen, routeMode, routePoints]);

  const spawn = configuration => {
    const count = useEngine.getState().spawnSandboxTargets({
      ...configuration,
      ...(routeMode && routePoints.length >= 2 ? { route: routePoints } : {}),
    });
    useEngine.getState().setTimeScale(1);
    return count;
  };

  return <>
    <SandboxPanel startPosition={startPosition} aimPosition={aimPosition}
      selectingStart={selecting === 'START'} selectingAim={selecting === 'AIM'}
      onSelectStart={() => setSelecting(value => value === 'START' ? null : 'START')}
      onSelectAim={() => setSelecting(value => value === 'AIM' ? null : 'AIM')}
      onSpawn={spawn} language={language ?? (ru ? UI_LANGUAGE.RU : UI_LANGUAGE.EN)}
      onFpvSpawn={id => onFocus(`CONTROLLABLE:${id}`)}
      advanced3d={sandboxMode} routeMode={routeMode} onRouteModeChange={value => {
        setRouteMode(value); setWaypoints([]); setSelecting(null);
      }} routePreset={routePreset} onRoutePresetChange={preset => {
        setRoutePreset(preset); setWaypoints([]);
      }} routeStyle={routeStyle} onRouteStyleChange={setRouteStyle}
      routePoints={routePoints} routeDistanceKm={routeDistanceKm}
      routeEta={formatRouteEta(routeDistanceKm, speedKmh)}
      routeStartSelected={Boolean(startPosition)} routeEndSelected={Boolean(routeEnd)}
      onSelectRouteStart={() => setSelecting('ROUTE_START')}
      onSelectRouteEnd={() => setSelecting('ROUTE_END')}
      selectingRouteStart={selecting === 'ROUTE_START'} selectingRouteEnd={selecting === 'ROUTE_END'}
      waypoints={routePoints}
      onClearWaypoints={() => { setWaypoints([]); setStartPosition(null); setRouteEnd(null); setSelecting(null); }} panelOpen={panelOpen}
      onPanelOpenChange={value => { setPanelOpen(value); if (!value) setSelecting(null); }}
      onUndoWaypoint={() => {
        if (routePreset !== TARGET_ROUTE_PRESET.MANUAL) return;
        const next = waypoints.slice(0, -1);
        setStartPosition(next[0] ?? null);
        setWaypoints(next);
      }}
      trajectoryTrailEnabled={trajectoryTrailEnabled} onTrajectoryTrailChange={onTrajectoryTrailChange}
      initiallyCollapsed />
    <details className="advanced-session advanced-session--ols">
      <summary>{ru ? 'СТАНЦИИ ОЛС' : 'OLS STATIONS'}</summary>
      <div>{[...radars, ...batteries].map(station => <button key={station.id}
        onClick={() => onOls(station.id)}>OLS · {station.displayName ?? station.id}</button>)}</div>
    </details>
  </>;
}
