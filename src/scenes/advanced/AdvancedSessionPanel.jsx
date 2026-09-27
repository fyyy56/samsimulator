import { useEffect, useRef, useState } from 'react';
import { Cartographic, Math as CesiumMath, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium';
import { UI_LANGUAGE, useGameStore } from '../../store/gameStore.js';
import { useEngine } from '../../store/engine.js';
import { useSandboxSpawnDraftStore } from '../../store/sandboxSpawnDraftStore.js';
import { SandboxPanel } from '../SimpleModeScene.jsx';

// Advanced reuses the COMMAND spawn form and engine API. Only point picking is
// adapted from MapLibre coordinates to the Cesium globe.
export default function AdvancedSessionPanel({ viewer, onFocus, onOls, ru }) {
  const language = useGameStore(state => state.language);
  const startPosition = useSandboxSpawnDraftStore(state => state.startPosition);
  const aimPosition = useSandboxSpawnDraftStore(state => state.aimPosition);
  const setStartPosition = useSandboxSpawnDraftStore(state => state.setStartPosition);
  const setAimPosition = useSandboxSpawnDraftStore(state => state.setAimPosition);
  const [selecting, setSelecting] = useState(null);
  const selectingRef = useRef(null);
  const batteries = useEngine(state => state.batteries);
  const radars = useEngine(state => state.searchRadars);

  useEffect(() => { selectingRef.current = selecting; }, [selecting]);
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return undefined;
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(event => {
      if (!selectingRef.current) return;
      const ray = viewer.camera.getPickRay(event.position);
      const point = ray && viewer.scene.globe.pick(ray, viewer.scene);
      if (!point) return;
      const location = Cartographic.fromCartesian(point);
      const value = { lat: CesiumMath.toDegrees(location.latitude),
        lng: CesiumMath.toDegrees(location.longitude) };
      if (selectingRef.current === 'START') setStartPosition(value);
      else setAimPosition(value);
      selectingRef.current = null;
      setSelecting(null);
    }, ScreenSpaceEventType.LEFT_CLICK);
    const cancel = event => { if (event.key === 'Escape' && selectingRef.current) {
      selectingRef.current = null; setSelecting(null);
    } };
    window.addEventListener('keydown', cancel);
    return () => { handler.destroy(); window.removeEventListener('keydown', cancel); };
  }, [viewer, setAimPosition, setStartPosition]);

  const spawn = configuration => {
    const count = useEngine.getState().spawnSandboxTargets(configuration);
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
      initiallyCollapsed />
    <details className="advanced-session advanced-session--ols">
      <summary>{ru ? 'СТАНЦИИ ОЛС' : 'OLS STATIONS'}</summary>
      <div>{[...radars, ...batteries].map(station => <button key={station.id}
        onClick={() => onOls(station.id)}>OLS · {station.displayName ?? station.id}</button>)}</div>
    </details>
  </>;
}
