import { UI_LANGUAGE, useGameStore } from '../store/gameStore.js';

export default function PlaceholderScene({ title, eyebrow, description }) {
  const returnToMenu = useGameStore(state => state.returnToMenu);
  const ru = useGameStore(state => state.language) === UI_LANGUAGE.RU;
  return (
    <main className="placeholder-scene">
      <div className="placeholder-scene__panel">
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
        <button onClick={returnToMenu}>{ru ? 'Вернуться в главное меню' : 'Return to main menu'}</button>
      </div>
    </main>
  );
}
