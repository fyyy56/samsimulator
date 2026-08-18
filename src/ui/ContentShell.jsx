import { UI_LANGUAGE, useGameStore } from '../store/gameStore.js';

export default function ContentShell({ eyebrow, title, actions, children }) {
  const returnToMenu = useGameStore(state => state.returnToMenu);
  const language = useGameStore(state => state.language);
  const ru = language === UI_LANGUAGE.RU;
  return (
    <main className="content-scene">
      <div className="content-scene__grid" aria-hidden="true" />
      <header className="content-scene__header">
        <button className="content-back" onClick={returnToMenu}>← {ru ? 'Главное меню' : 'Main menu'}</button>
        <div><span>{eyebrow}</span><h1>{title}</h1></div>
        <div className="content-scene__actions">{actions}</div>
      </header>
      <section className="content-scene__body">{children}</section>
    </main>
  );
}
