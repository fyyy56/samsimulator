import { lazy, Suspense } from 'react';
import MainMenu from './scenes/MainMenu.jsx';
import PlaceholderScene from './scenes/PlaceholderScene.jsx';
import { GAME_SCENE, UI_LANGUAGE, useGameStore } from './store/gameStore.js';

const SimpleModeScene = lazy(() => import('./scenes/SimpleModeScene.jsx'));
const ScenarioLibraryScene = lazy(() => import('./scenes/ScenarioLibraryScene.jsx'));
const ReferenceScene = lazy(() => import('./scenes/ReferenceScene.jsx'));
const DeveloperEditorScene = lazy(() => import('./scenes/DeveloperEditorScene.jsx'));
const UIEditorScene = lazy(() => import('./scenes/UIEditorScene.jsx'));

export default function App() {
  const scene = useGameStore(state => state.scene);
  const ru = useGameStore(state => state.language) === UI_LANGUAGE.RU;
  const developerMode = useGameStore(state => state.developerMode);

  if (scene === GAME_SCENE.SIMPLE || scene === GAME_SCENE.SANDBOX) {
    return (
      <Suspense fallback={<div className="scene-loading">{ru ? 'ЗАГРУЗКА ОПЕРАТИВНОЙ КАРТЫ' : 'INITIALIZING OPERATIONAL MAP'}</div>}>
        <SimpleModeScene sandboxMode={scene === GAME_SCENE.SANDBOX} developerMode={developerMode} />
      </Suspense>
    );
  }
  if (scene === GAME_SCENE.ADVANCED_PLACEHOLDER) {
    return (
      <PlaceholderScene
        eyebrow={ru ? 'Продвинутый режим' : 'Advanced Mode'}
        title={ru ? 'Архитектура 3D-поля боя готова' : '3D battlefield architecture is ready'}
        description={ru ? 'Заглушка будущего режима с общим ядром симуляции, Cesium, расширенной физикой и детальным интерфейсом.' : 'This scene will use the shared simulation core with a Cesium renderer, advanced physics adapter and detailed tactical UI. It is intentionally not active yet.'}
      />
    );
  }
  const contentScenes = {
    [GAME_SCENE.SCENARIOS]: <ScenarioLibraryScene />,
    [GAME_SCENE.REFERENCE]: <ReferenceScene />,
    [GAME_SCENE.EDITOR]: <DeveloperEditorScene />,
    [GAME_SCENE.UI_EDITOR]: <UIEditorScene />,
  };
  if (contentScenes[scene]) {
    return <Suspense fallback={<div className="scene-loading">{ru ? 'ЗАГРУЗКА МОДУЛЯ' : 'LOADING MODULE'}</div>}>{contentScenes[scene]}</Suspense>;
  }
  if (scene === GAME_SCENE.SETTINGS) {
    return (
      <PlaceholderScene
        eyebrow={ru ? 'Настройки' : 'Settings'}
        title={ru ? 'Экран и интерфейс' : 'Display and interface'}
        description={ru ? 'Здесь будут храниться настройки темы, звука и управления без влияния на симуляцию.' : 'Theme, audio and control settings will live here without changing simulation state.'}
      />
    );
  }
  return <MainMenu />;
}
