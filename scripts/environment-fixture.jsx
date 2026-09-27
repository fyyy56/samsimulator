// Development-only, exercises the production environment in a real Cesium Viewer.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Viewer, Cartesian3, Color, EllipsoidTerrainProvider, Math as CesiumMath } from 'cesium';
import { createAdvancedEnvironment } from '../src/scenes/advanced/advancedEnvironment.js';
import EnvironmentControls from '../src/scenes/advanced/EnvironmentControls.jsx';
import { useEnvironmentSettings } from '../src/scenes/advanced/environmentSettings.js';
import '../src/scenes/advanced/advancedPresentation.css';

// eslint-disable-next-line react-refresh/only-export-components
function Fixture() {
  const host = useRef(null), scene = useRef(null);
  const [sensor, setSensor] = useState(false);
  const [timing, setTiming] = useState('');
  const [probe, setProbe] = useState(false);
  const [smoke, setSmoke] = useState('NONE');
  const probeRef = useRef(false);
  const smokeRef = useRef('NONE');
  const sensorRef = useRef(false);
  useEffect(() => {
    const viewer = new Viewer(host.current, { baseLayer: false, terrainProvider: new EllipsoidTerrainProvider(),
      animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
      sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false });
    // The production scene always has imagery. A tiny local test layer avoids remote tiles.
    import('cesium').then(({ SingleTileImageryProvider }) => {
      if (viewer.isDestroyed()) return;
      viewer.imageryLayers.addImageryProvider(new SingleTileImageryProvider({
        url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#617451"/></svg>'),
        tileWidth: 64, tileHeight: 32,
      }));
      const environment = createAdvancedEnvironment(viewer);
      scene.current = viewer;
      const lightProbe = viewer.entities.add({ position: Cartesian3.fromDegrees(30.5,50.415,2500),
        point: { pixelSize: 7, color: Color.WHITE }, show: false });
      const smokeImage = document.createElement('canvas');
      smokeImage.width = smokeImage.height = 128;
      const ctx = smokeImage.getContext('2d');
      const gradient = ctx.createRadialGradient(64,64,4,64,64,62);
      gradient.addColorStop(0,'rgba(220,222,225,.8)');
      gradient.addColorStop(1,'rgba(220,222,225,0)');
      ctx.fillStyle = gradient; ctx.fillRect(0,0,128,128);
      const testSmoke = viewer.entities.add({ position: Cartesian3.fromDegrees(30.5,50.4,200),
        billboard: { image: smokeImage, width: 140, height: 140, sizeInMeters: true,
          disableDepthTestDistance: 0 }, show: false });
      viewer.scene.highDynamicRange = true;
      viewer.scene.globe.baseColor = Color.fromCssColorString('#617451');
      viewer.camera.setView({ destination: Cartesian3.fromDegrees(30.5,50.4,100),
        orientation: { heading: 0, pitch: CesiumMath.toRadians(12), roll: 0 } });
      const remove = viewer.scene.preRender.addEventListener(() => {
        environment.update(!sensorRef.current, performance.now());
        const altitude = useEnvironmentSettings.getState().altitude;
        const position = Cartesian3.fromDegrees(30.5,50.415,altitude + 650 + Math.sin(performance.now()/3500)*1000);
        lightProbe.position = position; lightProbe.show = probeRef.current;
        const smokeDistance = smokeRef.current === 'FRONT' ? 900 : 15000;
        testSmoke.position = Cartesian3.add(viewer.camera.positionWC,
          Cartesian3.multiplyByScalar(viewer.camera.directionWC, smokeDistance, new Cartesian3()), new Cartesian3());
        testSmoke.billboard.width = smokeRef.current === 'FRONT' ? 140 : 2100;
        testSmoke.billboard.height = smokeRef.current === 'FRONT' ? 140 : 2100;
        testSmoke.show = smokeRef.current !== 'NONE';
        environment.sync(probeRef.current ? new Map([['INTERCEPTOR:probe', {
          visualState: { worldPosition: position }, presentation: {},
        }]]) : new Map(), probeRef.current ? [{id:'probe',motorPhase:'BOOST'}] : [],
        smokeRef.current === 'NONE' ? [] : [{entity:testSmoke}]);
      });
      let last = performance.now(), published = last;
      const samples = [];
      const removeTiming = viewer.scene.postRender.addEventListener(() => {
        const now = performance.now();
        samples.push(now-last); last=now;
        if (now-published > 1200) {
          const sorted = samples.sort((a,b)=>a-b);
          setTiming('Frame median ' + sorted[Math.floor(sorted.length/2)].toFixed(1) + ' ms');
          samples.length=0; published=now;
        }
      });
      viewer.environmentCleanup = () => { removeTiming(); remove(); environment.destroy(); };
    });
    return () => { viewer.environmentCleanup?.(); viewer.destroy(); scene.current = null; };
  }, []);
  return <>
    <div ref={host} style={{position:'fixed',inset:0}} />
    <div style={{position:'fixed',right:12,top:12,color:'white',background:'#15222be8',padding:12,width:270}}>
      <EnvironmentControls sandboxMode ru={false} />
      {[['HORIZON',100,12],['IN CLOUD',2500,8],['ABOVE',6000,-18]].map(([name,height,pitch]) =>
        <button key={name} onClick={() => scene.current?.camera.setView({
          destination: Cartesian3.fromDegrees(30.5,50.4,height),
          orientation:{heading:0,pitch:CesiumMath.toRadians(pitch),roll:0},
        })}>{name}</button>)}
      <button onClick={() => { sensorRef.current = !sensor; setSensor(!sensor); }}>
        {sensor ? 'RESTORE ENVIRONMENT' : 'SUSPEND FOR SENSOR'}</button>
      <button onClick={() => useEnvironmentSettings.getState().set('cover',.95)}>DENSE COVER</button>
      <button onClick={() => {probeRef.current=!probe;setProbe(!probe);}}>LIGHT PROBE {probe?'ON':'OFF'}</button>
      <button onClick={() => {smokeRef.current='FRONT';setSmoke('FRONT');}}>SMOKE FRONT</button>
      <button onClick={() => {smokeRef.current='BEHIND';setSmoke('BEHIND');}}>SMOKE BEHIND</button>
      <button onClick={() => {smokeRef.current='NONE';setSmoke('NONE');}}>NO SMOKE</button>
      <p>Smoke: {smoke}</p>
      <p>{timing} · visual-only fixture</p>
    </div>
  </>;
}
const root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root'));
root.render(<Fixture />);
if (import.meta.hot) import.meta.hot.dispose(data => { data.root = root; root.render(null); });
