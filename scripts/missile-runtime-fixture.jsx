import { useEffect, useState } from 'react';
import { useEngine } from '../src/store/engine.js';
import { useGameStore } from '../src/store/gameStore.js';
import { useOlsViewStore } from '../src/store/olsViewStore.js';

// Scripted renderer inputs only. The real GameViewport, model lifecycle,
// camera switching, plume and thermal code run unchanged; no combat is tested.
export default function MissileRuntimeFixture() {
  const [spec, setSpec] = useState(null);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (!spec) return undefined;
    const engine = useEngine.getState();
    engine.resetScenario('SANDBOX');
    engine.startDeploy('RADAR_79K6'); engine.handleMapClick(50, 30);
    const station = useEngine.getState().searchRadars[0];
    useEngine.setState({ timeScale: 0, searchRadars: [{ ...station, radarHeading: 0,
      altitudeM: 42, components: { ...station.components, radar: {
        ...station.components?.radar, lat: 50, lng: 30, altitudeM: 42,
      } } }] });
    let t = 0;
    const publish = () => {
      if (moving) t += 0.05;
      const position = { lat: 50.0009, lng: 30 + Math.sin(t / 12) * 0.0002 };
      const eastMps = Math.cos(t / 12) * 1.19;
      useEngine.setState(state => ({ simulationTime: state.simulationTime + 0.05,
        missiles: [{ id: `MODEL-${spec}`, interceptorSpecId: spec,
          position, worldPosition: { ...position, altitudeM: 60 }, altitudeM: 60,
          velocity: { eastMps, northMps: 0, upMps: 0 }, speedKmh: Math.abs(eastMps) * 3.6,
          heading: eastMps >= 0 ? 90 : 270, roll: 0, status: 'FLYING',
          motorPhase: 'BOOST', flightTime: t, launchTime: state.simulationTime - t,
        }] }));
    };
    publish();
    const timer = window.setInterval(publish, 50);
    return () => window.clearInterval(timer);
  }, [spec, moving]);
  return <>
    {['INT-LONG-V1', 'INT-MEDIUM-V1', 'INT-SHORT-V1', 'INT-ASTER30-V1'].map((value, index) =>
      <button key={value} onClick={() => setSpec(value)}>MODEL {['PAC', 'AIM', 'IRIS', 'ASTER'][index]}</button>)}
    <button onClick={() => setMoving(value => !value)}>MODEL MOTION {moving ? 'ON' : 'OFF'}</button>
    <button onClick={() => {
      const station = useEngine.getState().searchRadars[0];
      if (station) { useOlsViewStore.getState().setZoom(1);
        useGameStore.getState().openOlsFeed('SANDBOX', station.id); }
    }}>MODEL OLS</button>
    <button onClick={() => useOlsViewStore.getState().setZoom(10)}>MODEL OLS 10x</button>
    <button onClick={() => useGameStore.getState().openAdvancedPreview('SANDBOX')}>MODEL 3D</button>
    {spec && <output>MODEL FIXTURE: scripted visual motion, no guidance/collision validation.</output>}
  </>;
}
