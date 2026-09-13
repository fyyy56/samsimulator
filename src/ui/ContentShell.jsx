import { UI_LANGUAGE, useGameStore } from '../store/gameStore.js';
import DesignableSurface from './DesignableSurface.jsx';
import { DesignModeButton } from './DesignModeOverlay.jsx';

export default function ContentShell({ eyebrow, title, actions, children }) {
  const returnToMenu = useGameStore(state => state.returnToMenu);
  const language = useGameStore(state => state.language);
  const ru = language === UI_LANGUAGE.RU;
  return (
    <DesignableSurface as="main" designId="content-background" designName="Фон разделов" className="content-scene" data-design-dynamic-text="true">
      <div className="content-scene__grid" aria-hidden="true" />
      <header className="content-scene__header">
        <button className="content-back" onClick={returnToMenu}>← {ru ? 'Главное меню' : 'Main menu'}</button>
        <div><span>{eyebrow}</span><h1>{title}</h1></div>
        <div className="content-scene__actions">
          {actions}
          <DesignModeButton compact />
        </div>
      </header>
      <DesignableSurface as="section" designId="content-page" designName="Рабочая область разделов" className="content-scene__body">{children}</DesignableSurface>
    </DesignableSurface>
  );
}
