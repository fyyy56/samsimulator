import { GAME_MODE, UI_LANGUAGE, useGameStore } from '../store/gameStore.js';
import { DesignModeButton } from '../ui/DesignModeOverlay.jsx';
import { useDesignStore, useDesignSurface } from '../store/designStore.js';

function MenuModeCard({ item, index, gameStore }) {
  const designStyle = useDesignSurface(`menu-tab-${item.id}`);
  const designEnabled = useDesignStore(state => state.enabled);
  return <button
    data-design-id={`menu-tab-${item.id}`}
    data-design-name={item.title}
    style={designStyle}
    className={`mode-card ${item.available ? 'is-available' : 'is-locked'}`}
    onClick={() => { if (!designEnabled) item.action(gameStore); }}
  >
    <span className="mode-card__index">0{index + 1}</span>
    <span className="mode-card__content"><strong>{item.title}</strong>{item.meta.map(line => <span key={line}>{line}</span>)}</span>
    <span className="mode-card__status">{item.available ? (gameStore.language === UI_LANGUAGE.RU ? 'Открыть' : 'Open') : 'Locked'}</span>
  </button>;
}

export default function MainMenu() {
  const gameStore = useGameStore();
  const ru = gameStore.language === UI_LANGUAGE.RU;
  const headerDesign = useDesignSurface('menu-brand');
  const selectorDesign = useDesignSurface('menu-navigation');
  const settingsDesign = useDesignSurface('menu-tab-settings');
  const quickDesign = useDesignSurface('menu-quick-tools');
  const footerDesign = useDesignSurface('menu-footer');
  const designEnabled = useDesignStore(state => state.enabled);
  const menuItems = [
    {
      id: 'start',
      title: ru ? 'Начать игру' : 'Start game',
      meta: ru ? ['Command Mode', 'Украинский театр', 'Действующая симуляция'] : ['Command Mode', 'Ukraine theater', 'Live simulation'],
      action: store => store.startScenario(null),
      available: true,
    },
    {
      id: 'scenarios', title: ru ? 'Сценарии' : 'Scenarios',
      meta: [ru ? 'Операции и локальная библиотека' : 'Operations and local library'], action: store => store.openScenarioLibrary(), available: true,
    },
    {
      id: 'editor', title: ru ? 'Редактор' : 'Editor',
      meta: [ru ? 'Объекты, маршруты, ассеты и UI' : 'Objects, routes, assets and UI'], action: store => store.openEditor(), available: true,
    },
    {
      id: 'reference', title: ru ? 'Справочник' : 'Reference',
      meta: [ru ? 'ПВО, угрозы, цели и FAQ' : 'Air defense, threats, objectives and FAQ'], action: store => store.openReference(), available: true,
    },
  ];

  return (
    <main className="main-menu">
      <div className="main-menu__grid" aria-hidden="true" />
      <header className="main-menu__header" data-design-id="menu-brand" data-design-name="Логотип и описание" style={headerDesign}>
        <div className="main-menu__eyebrow">{ru ? 'Командная симуляция ПВО' : 'Air Defense Command Simulation'}</div>
        <h1>SAM<br />Simulator</h1>
        <p>{ru ? 'Управляйте сетью радаров. Сопровождайте цели. Защищайте воздушное пространство.' : 'Command the sensor network. Build the track. Defend the airspace.'}</p>
        <div className="main-menu__language" aria-label={ru ? 'Язык' : 'Language'}>
          {[UI_LANGUAGE.RU, UI_LANGUAGE.EN].map(language => (
            <button key={language} className={gameStore.language === language ? 'is-active' : ''} onClick={() => gameStore.setLanguage(language)}>{language}</button>
          ))}
        </div>
      </header>

      <section className="mode-selector" aria-label="Game modes" data-design-id="menu-navigation" data-design-name="Навигация меню" style={selectorDesign}>
        {menuItems.map((item, index) => <MenuModeCard key={item.id} item={item} index={index} gameStore={gameStore} />)}
        <button className="mode-card mode-card--settings" data-design-id="menu-tab-settings" data-design-name="Настройки" style={settingsDesign} onClick={() => { if (!designEnabled) gameStore.openSettings(); }}>
          <span className="mode-card__index">05</span>
          <span className="mode-card__content"><strong>{ru ? 'Настройки' : 'Settings'}</strong><span>{ru ? 'Экран и интерфейс' : 'Display and interface'}</span></span>
          <span className="mode-card__status">{ru ? 'Открыть' : 'Open'}</span>
        </button>
      </section>

      <div className="main-menu__quick-actions" data-design-id="menu-quick-tools" data-design-name="Инструменты" style={quickDesign}>
        <button onClick={gameStore.openSandbox}>{ru ? 'Полигон' : 'Sandbox'}</button>
        <button onClick={gameStore.openDeveloperMode}>{ru ? 'Режим разработчика' : 'Developer Mode'}</button>
        <button onClick={() => gameStore.selectMode(GAME_MODE.ADVANCED)}>{ru ? 'Advanced · позже' : 'Advanced · later'}</button>
        <DesignModeButton compact />
      </div>

      <footer className="main-menu__footer" data-design-id="menu-footer" data-design-name="Нижняя строка" style={footerDesign}>
        <span>{ru ? 'ЯДРО СИМУЛЯЦИИ: В СЕТИ' : 'SIM CORE ONLINE'}</span>
        <span>CONTENT PLATFORM V1 / LOCAL SCHEMA 01</span>
      </footer>
    </main>
  );
}
