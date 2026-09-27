import { lazy, Suspense } from 'react';
import MainMenu from './scenes/MainMenu.jsx';
import MenuShell from './ui/MenuShell.jsx';
import { GAME_SCENE, UI_LANGUAGE, isAdvancedScene, is2DScene, useGameStore } from './store/gameStore.js';

const GameViewport = lazy(() => import('./scenes/GameViewport.jsx'));
const ScenarioLibraryScene = lazy(() => import('./scenes/ScenarioLibraryScene.jsx'));
const ReferenceScene = lazy(() => import('./scenes/ReferenceScene.jsx'));
const DeveloperEditorScene = lazy(() => import('./scenes/DeveloperEditorScene.jsx'));
const UIEditorScene = lazy(() => import('./scenes/UIEditorScene.jsx'));
const SettingsScene = lazy(() => import('./scenes/SettingsScene.jsx'));
const EditorLandingScene = lazy(() => import('./scenes/EditorLandingScene.jsx'));
const ObjectEditorScene = lazy(() => import('./scenes/ObjectEditorScene.jsx'));

export default function App() {
  const scene = useGameStore(state => state.scene);
  const ru = useGameStore(state => state.language) === UI_LANGUAGE.RU;

  if (is2DScene(scene) || isAdvancedScene(scene)) {
    return (
      <Suspense fallback={<div className="scene-loading">{ru ? 'ЗАГРУЗКА ОПЕРАТИВНОЙ КАРТЫ' : 'INITIALIZING OPERATIONAL MAP'}</div>}>
        <GameViewport />
      </Suspense>
    );
  }
  if (scene === GAME_SCENE.EDITOR_MAP) {
    return <Suspense fallback={<div className="scene-loading">{ru ? 'ЗАГРУЗКА РЕДАКТОРА' : 'LOADING EDITOR'}</div>}><DeveloperEditorScene /></Suspense>;
  }
  if (scene === GAME_SCENE.OBJECT_EDITOR) {
    return <Suspense fallback={<div className="scene-loading">ЗАГРУЗКА OBJECT EDITOR</div>}><ObjectEditorScene /></Suspense>;
  }
  const contentScenes = {
    [GAME_SCENE.SCENARIOS]: <ScenarioLibraryScene />,
    [GAME_SCENE.REFERENCE]: <ReferenceScene />,
    [GAME_SCENE.EDITOR]: <EditorLandingScene />,
    [GAME_SCENE.UI_EDITOR]: <UIEditorScene />,
    [GAME_SCENE.SETTINGS]: <SettingsScene />,
  };
  if (contentScenes[scene]) {
    return <MenuShell scene={scene}><Suspense fallback={<div className="scene-loading">{ru ? 'ЗАГРУЗКА МОДУЛЯ' : 'LOADING MODULE'}</div>}>{contentScenes[scene]}</Suspense></MenuShell>;
  }
  return <MenuShell scene={GAME_SCENE.MENU}><MainMenu /></MenuShell>;
}
