import { lazy, Suspense, useEffect, useState } from 'react';
import { GAME_SCENE, useGameStore } from '../store/gameStore.js';

const SimpleModeScene = lazy(() => import('./SimpleModeScene.jsx'));
const AdvancedScene = lazy(() => import('./AdvancedScene.jsx'));

// Exactly one Cesium backend survives COMMAND ↔ camera transitions. COMMAND
// owns ticking while visible; the inactive backend only preloads scene assets.
export default function GameViewport({ onVisualFrame }) {
  const scene = useGameStore(state => state.scene);
  const developerMode = useGameStore(state => state.developerMode);
  const resume = useGameStore(state => state.resumeCommandSimulation);
  const advanced = scene === GAME_SCENE.ADVANCED_PLACEHOLDER;
  const [prewarm, setPrewarm] = useState(advanced);
  useEffect(() => {
    const timer = window.setTimeout(() => setPrewarm(true), 700);
    return () => window.clearTimeout(timer);
  }, []);
  return <>
    {!advanced && <Suspense fallback={<div className="scene-loading">COMMAND</div>}>
      <SimpleModeScene sandboxMode={scene === GAME_SCENE.SANDBOX}
        developerMode={developerMode} resumeSimulation={resume} />
    </Suspense>}
    {(advanced || prewarm) && <div className={`advanced-backend${advanced ? '' : ' is-prewarming'}`}
      aria-hidden={!advanced} inert={!advanced}>
      <Suspense fallback={advanced ? <div className="scene-loading">CAMERA</div> : null}>
        <AdvancedScene active={advanced} onVisualFrame={onVisualFrame} />
      </Suspense>
    </div>}
  </>;
}
