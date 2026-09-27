// Development-only fixture: real engine, real Advanced/OLS renderer; no synthetic trajectory.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import GameViewport from '../src/scenes/GameViewport.jsx';
import { useEngine } from '../src/store/engine.js';
import { useGameStore } from '../src/store/gameStore.js';
import { createAirTarget } from '../src/store/airTargetSystem.js';
import { getDestinationPoint } from '../src/store/geo.js';
import '../src/index.css';
useEngine.getState().resetScenario('SANDBOX');
useGameStore.setState({ scene: 'SANDBOX_3D', presentationMode: 'ADVANCED',
  gameMode: 'ADVANCED', resumeCommandSimulation: true, commandScene: 'SANDBOX_2D' });
export function Fixture() {
  const [angle, setAngle] = useState(8);
  const state = useEngine();
  const prepare = () => {
    state.resetScenario('SANDBOX');
    useEngine.getState().startDeploy('TOR_M1');
    useEngine.getState().handleMapClick(48.2, 31.5);
    const now = useEngine.getState().simulationTime;
    const spawnPosition = getDestinationPoint(48.2, 31.5, 90, 5);
    const destination = getDestinationPoint(48.2, 31.5, 90, 50);
    const target = createAirTarget({ id: 'TOR-FIXTURE', type: 'UAV_TARGET', modelId: 'SHAHED_136',
      speedKmh: 180, altitudeM: 610, targetAltitudeM: 610, spawnPosition, destination,
      route: [{ ...destination, altitudeM: 610 }], routeType: 'DIRECT', sensorSignature: .8,
      detectability: .8, objectivePriority: 1 }, now);
    useEngine.setState({ timeScale: 0, airTargets: [target], tracks: [{ id: 'TRK-FIXTURE',
      targetId: target.id, state: 'IDENTIFIED', reportedPosition: { ...target.position, alt: 610 },
      reportedAltitudeM: 610, reportedHeading: target.heading, reportedSpeedKmh: 180,
      trackQuality: 1, consecutiveUpdates: 8, totalUpdates: 8, lastUpdateTime: now,
      velocity: { heading: target.heading, speedKmh: 180 } }] });
  };
  const step = count => {
    useEngine.getState().setTimeScale(1);
    for (let i = 0; i < count; i++) useEngine.getState().tick();
    useEngine.getState().setTimeScale(.01);
    window.setTimeout(() => useEngine.getState().setTimeScale(0), 200);
  };
  const launch = () => {
    state.setTorManualSight(state.batteries[0].id, 90, angle);
    useEngine.getState().queueEngagement(state.batteries[0].id, 'TRK-FIXTURE', 'MANUAL');
    step(2);
  };
  const missile = state.missiles[0];
  return <><GameViewport /><nav style={{ position: 'fixed', bottom: 0, zIndex: 20000,
    background: '#18212b', color: 'white', padding: 8, width: '100%', font: '12px monospace' }}>
    <button onClick={prepare}>PREPARE TOR</button>
    <button onClick={() => useEngine.setState({ tracks: [] })}>CLEAR TRACK</button>
    <button onClick={() => setAngle(8)}>HORIZON</button>
    <button onClick={() => setAngle(84)}>VERTICAL</button>
    <button onClick={launch} disabled={!state.batteries.length}>LAUNCH FIXTURE {angle}°</button>
    <button onClick={() => step(1)}>STEP 0.05</button>
    <button onClick={() => step(5)}>STEP 0.25</button>
    <button onClick={() => state.setTimeScale(.5)}>RUN 0.5</button>
    <button onClick={() => state.setTimeScale(0)}>FREEZE</button>
    <button disabled={!state.batteries.length} onClick={() => { useGameStore.getState().openTorOlsFeed(state.batteries[0].id, true); useGameStore.setState({ olsRequestedTargetKey: 'TARGET:TOR-FIXTURE' }); }}>TOR OLS</button>
    <output style={{display:'block'}}>MISSILES {state.missiles.length} · QUEUED {state.launchQueue?.length ?? 0} · AMMO {state.batteries[0]?.missilesLeft} · {missile?.coldLaunchPhase} · MOTOR {missile?.motorPhase} · PITCH {missile?.flightPathAngleDeg?.toFixed(1)} · JETS {missile?.attitudeJetsIntensity?.toFixed(2)} · FLIGHT {missile?.flightTime?.toFixed(2)}</output>
  </nav></>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
