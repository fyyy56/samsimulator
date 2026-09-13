// Development-only browser fixture. Not referenced by the production entry.
// Uses the real renderer and engine. HIT REPLAY is explicitly a visual event,
// not evidence that missile guidance/collision succeeded.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import GameViewport from '../src/scenes/GameViewport.jsx';
import { useGameStore } from '../src/store/gameStore.js';
import { useEngine } from '../src/store/engine.js';
import { createSimulationEvent } from '../src/store/simulationEvents.js';
import { setupVisualScenario } from './visual-test-scenarios.js';
import { useViewStore } from '../src/store/viewStore.js';
import { isAvailableNetworkTrack } from '../src/store/trackDataProvider.js';
import MissileRuntimeFixture from './missile-runtime-fixture.jsx';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../src/index.css';

useEngine.getState().resetScenario('SANDBOX');
useGameStore.setState({ scene: 'ADVANCED_PLACEHOLDER', presentationMode: 'ADVANCED', commandScene: 'SANDBOX', resumeCommandSimulation: true,
  commandViewState: { latitude: 50, longitude: 30, zoom: 8, pitch: 0, bearing: 0 } });
export default function Fixture() {
  const [model, setModel] = useState('GERAN_2');
  const [status, setStatus] = useState('VISUAL FIXTURE — no combat validation');
  const [telemetry, setTelemetry] = useState('');
  const [frames, setFrames] = useState([]);
  const recording = useRef(null);
  const observeFrame = useCallback((canvas, time, diagnostics) => {
    const capture = recording.current;
    if (!capture || time - capture.last < 0.035) return;
    capture.last = time;
    const state = useEngine.getState();
    const impact = state.missiles.find(m => m.visualImpact)?.visualImpact;
    if (impact) capture.impactTime ??= impact.time;
    capture.frames.push({ time, diagnostics, image: canvas.toDataURL('image/jpeg', .75) });
    if (capture.frames.length > 16) capture.frames.shift();
    if ((capture.impactTime && time > capture.impactTime + .16) || time > capture.start + 3) {
      recording.current = null;
      state.setTimeScale(0);
      setFrames(capture.frames);
      setStatus(`REAL RENDER CAPTURE: contact ${capture.impactTime?.toFixed(3) ?? 'not reached'}; capture overhead excludes FPS benchmarking`);
    }
  }, []);
  const command = useGameStore(state => state.scene) === 'SANDBOX';
  useEffect(() => {
    const phases = new Set();
    let last = 0;
    let lastSimTime = 0;
    return useEngine.subscribe(state => {
      if (state.simulationTime < lastSimTime) phases.clear();
      lastSimTime = state.simulationTime;
      state.airTargets.forEach(target => phases.add(target.flightPhase));
      if (performance.now() - last < 500) return;
      last = performance.now();
      setTelemetry(`SIM ${state.simulationTime.toFixed(1)}s | targets ${state.airTargets.length} | missiles ${state.missiles.length} | search radars ${state.searchRadars.length} | SAM ${state.batteries.length} | tracks ${state.tracks.length} | sources ${state.tracks.map(t => t.bestSensorId ?? t.sourceRadarId).join(',')} | phases ${[...phases].join('/')} | ${state.events.slice(-4).map(e => e.type).join(', ')}`);
    });
  }, []);
  const scenario = mode => {
    setupVisualScenario(mode, model, mode === 'MIXED' ? 40 : 1);
    setStatus(`${mode}: existing engine, no synthetic hits`);
  };
  const spawn = count => {
    setupVisualScenario('STRAIGHT', model, count);
    setStatus(`${count} ${model}: real engine movement`);
  };
  const replay = () => {
    const state = useEngine.getState();
    const target = state.airTargets[0];
    if (!target) return;
    useEngine.setState({ airTargets: state.airTargets.filter(t => t.id !== target.id),
      events: [...state.events, createSimulationEvent(state.events.length + 1,
        'TARGET_INTERCEPTED', state.simulationTime, { targetId: target.id })] });
    setStatus(`REPLAY: ${target.id} visual destruction, NOT a physics hit`);
  };
  const prepareFinal = mode => {
    scenario(mode);
    for (let step = 0; step < 1200; step++) {
      const state = useEngine.getState();
      if (state.missiles.some(m => m.distanceToTargetKm < .6)) break;
      state.tick();
    }
    // Let the existing visual clock consume the seek before freezing.
    requestAnimationFrame(() => requestAnimationFrame(() => useEngine.getState().setTimeScale(0)));
  };
  return <><GameViewport onVisualFrame={observeFrame} />
    {frames.length > 0 && <div style={{position:'fixed',inset:'0 0 115px',zIndex:20000,overflow:'auto',background:'#111'}}>
      <button onClick={() => setFrames([])}>CLOSE CAPTURE</button>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)'}}>{frames.map(frame =>
        <figure key={frame.time} style={{margin:2,color:'white',font:'11px monospace'}}>
          <img src={frame.image} style={{width:'100%'}} /><figcaption>{frame.time.toFixed(3)} s {JSON.stringify(frame.diagnostics)}</figcaption>
        </figure>)}</div>
    </div>}
    <style>{`.advanced-performance {display:block!important;z-index:10000}
      .advanced-time-controls {bottom:160px!important}
      footer.ols-bar {bottom:116px}
      .fixture-bar{position:fixed;bottom:0;left:0;right:0;z-index:10001;background:#101820;padding:4px;display:flex;flex-wrap:wrap;gap:4px;font:11px monospace}
      .fixture-bar button,.fixture-bar select{padding:5px;color:white;background:#263941;border:1px solid #aab9ba}
      .fixture-bar output{width:100%;color:white}`}</style>
    <nav className="fixture-bar">
      <MissileRuntimeFixture />
      <select aria-label="Fixture model" value={model} onChange={e => setModel(e.target.value)}>
        {['GERAN_2', 'GERBERA', 'KH_555', 'KALIBR'].map(id => <option key={id}>{id}</option>)}
      </select>
      <button onClick={() => spawn(1)}>1 TARGET</button>
      <button onClick={() => spawn(20)}>20 TARGETS</button>
      <button onClick={() => spawn(40)}>40 TARGETS</button>
      <button onClick={replay}>HIT REPLAY (VISUAL)</button>
      <button onClick={() => useEngine.getState().setTimeScale(0.25)}>0.25x</button>
      <button onClick={() => prepareFinal('ENGAGEMENT_NASAMS')}>NASAMS FINAL</button>
      <button onClick={() => prepareFinal('ENGAGEMENT')}>PAC FINAL</button>
      <button onClick={() => { const time = useEngine.getState().simulationTime;
        recording.current = { start: time, last: -Infinity, frames: [] };
        useEngine.getState().setTimeScale(0.25);
      }}>CAPTURE FINAL</button>
      <button onClick={() => command ? useGameStore.getState().openAdvancedPreview('SANDBOX') : useGameStore.getState().returnToCommand()}>{command ? 'VIEW ADVANCED' : 'VIEW COMMAND'}</button>
      <button onClick={() => { const state = useEngine.getState();
        const station = state.searchRadars[0] ?? state.batteries[0];
        if (station) { useEngine.getState().setSelectedTrack(state.tracks[0]?.id ?? null);
          useGameStore.getState().openOlsFeed('SANDBOX', station.id); }
      }}>OLS STATION</button>
      <button onClick={() => {
        setupVisualScenario('RADAR', model, 1);
        for (let step = 0; step < 800; step++) useEngine.getState().tick();
        const state = useEngine.getState();
        state.setSelectedTrack(state.tracks.find(isAvailableNetworkTrack)?.id ?? null);
        const id = useEngine.getState().spawnControllableTestEntity();
        useEngine.getState().setControllableCameraMode(id, 'FPV');
        useEngine.getState().setControlledControllableEntity(id);
        useGameStore.getState().openFpvFeed('SANDBOX', id);
        setStatus('NETWORK FPV: real radar observations, no synthetic hits');
      }}>NETWORK FPV</button>
      {['RADAR_P18', 'RADAR_35D6', 'RADAR_79K6'].map(mode =>
        <button key={mode} onClick={() => scenario(mode)}>{mode}</button>)}
      {['RADAR', 'OLS', 'FPV_CONTACT', 'BALLISTIC', 'APEX', 'DESCENT', 'INTERCEPTOR', 'ENGAGEMENT', 'ENGAGEMENT_NASAMS', 'MIXED'].map(mode =>
        <button key={mode} onClick={() => scenario(mode)}>{mode}</button>)}
      <button onClick={() => {
        const store = useEngine.getState(); store.startDeploy('LONG');
        store.handleMapClick(50, 30); store.rotateRadar(90); store.confirmRadarHeading();
        store.handleMapClick(50, 30); store.handleMapClick(50.003, 30);
      }}>ADD PATRIOT</button>
      <button onClick={() => useViewStore.getState().toggleLayer('debugOverlay')}>MODEL DEBUG</button>
      <output>{status}</output>
      <output>{telemetry}</output>
    </nav></>;
}
const root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root'));
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(<Fixture />);
