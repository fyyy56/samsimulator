import { UI_LANGUAGE, useGameStore } from '../store/gameStore.js';
import DesignableSurface from './DesignableSurface.jsx';
import { DesignModeButton } from './DesignModeOverlay.jsx';

export default function ContentShell({ eyebrow, title, actions, children }) {
  const returnToMenu = useGameStore(state => state.returnToMenu);
  const language = useGameStore(state => state.language);
  const ru = language === UI_LANGUAGE.RU;
  return (
    <main className="content-scene">
      <div className="content-scene__grid" aria-hidden="true" />
      <DesignableSurface as="header" designId="content-header" designName="Заголовок раздела" className="content-scene__header">
        <button className="content-back" onClick={returnToMenu}>← {ru ? 'Главное меню' : 'Main menu'}</button>
        <div><span>{eyebrow}</span><h1>{title}</h1></div>
        <div className="content-scene__actions">
          {actions}
          <DesignModeButton compact />
        </div>
      </DesignableSurface>
      <section className="content-scene__body">{children}</section>
    </main>
  );
}
