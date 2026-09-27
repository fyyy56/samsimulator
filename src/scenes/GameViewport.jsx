import { lazy, Suspense } from 'react';
import { GAME_SCENE, isAdvancedScene, is2DScene, useGameStore } from '../store/gameStore.js';

const SimpleModeScene = lazy(() => import('./SimpleModeScene.jsx'));
const AdvancedScene = lazy(() => import('./AdvancedScene.jsx'));

export default function GameViewport({ onVisualFrame }) {
  const scene = useGameStore(state => state.scene);
  const developerMode = useGameStore(state => state.developerMode);
  const resume = useGameStore(state => state.resumeCommandSimulation);
  if (is2DScene(scene)) return (
    <Suspense fallback={<div className="scene-loading">COMMAND</div>}>
      <SimpleModeScene key={scene} sandboxMode={scene === GAME_SCENE.SANDBOX_2D}
        developerMode={developerMode} resumeSimulation={resume} />
    </Suspense>
  );
  if (isAdvancedScene(scene)) return (
    <div className="advanced-backend">
      <Suspense fallback={<div className="scene-loading">ADVANCED 3D</div>}>
        <AdvancedScene key={scene} active onVisualFrame={onVisualFrame}
          sandboxMode={scene === GAME_SCENE.SANDBOX_3D} />
      </Suspense>
    </div>
  );
  return null;
}
