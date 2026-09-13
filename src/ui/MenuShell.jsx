import { useCallback, useState } from 'react';
import { DEFAULT_MENU_BACKGROUND } from '../data/menuBackgrounds.js';
import { GAME_SCENE, UI_LANGUAGE, useGameStore } from '../store/gameStore.js';
import { useDesignStore } from '../store/designStore.js';
import CinematicBackground from './CinematicBackground.jsx';

const TONE_BY_SCENE = {
  [GAME_SCENE.MENU]: 'MAIN',
  [GAME_SCENE.REFERENCE]: 'REFERENCE',
  [GAME_SCENE.SCENARIOS]: 'SCENARIOS',
  [GAME_SCENE.EDITOR]: 'EDITOR',
  [GAME_SCENE.UI_EDITOR]: 'EDITOR',
  [GAME_SCENE.SETTINGS]: 'SETTINGS',
};

export default function MenuShell({ scene, children }) {
  const game = useGameStore();
  const designEnabled = useDesignStore(state => state.enabled);
  const ru = game.language === UI_LANGUAGE.RU;
  const [introController, setIntroController] = useState(null);
  const acceptController = useCallback(controller => setIntroController(controller), []);
  return <main className={`menu-shell menu-shell--${(TONE_BY_SCENE[scene] ?? 'MAIN').toLowerCase()}`}>
    <CinematicBackground background={DEFAULT_MENU_BACKGROUND} sceneTone={TONE_BY_SCENE[scene] ?? 'MAIN'} onController={acceptController} />
    <div className="menu-overlay-stage" key={scene}>{children}</div>
    {scene === GAME_SCENE.MENU && designEnabled && <div className="menu-shell__debug">
      <button onClick={() => introController?.replay()}>{ru ? 'Повторить интро' : 'Replay intro'}</button>
    </div>}
  </main>;
}
