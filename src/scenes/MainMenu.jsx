import { UI_LANGUAGE, useGameStore } from '../store/gameStore.js';
import { useEngine } from '../store/engine.js';
import { DesignModeButton } from '../ui/DesignModeOverlay.jsx';
import { useDesignStore, useDesignSurface } from '../store/designStore.js';

function MenuModeCard({ item, gameStore }) {
  const designStyle = useDesignSurface(`menu-tab-${item.id}`);
  const designEnabled = useDesignStore(state => state.enabled);
  return <button
    data-design-id={`menu-tab-${item.id}`}
    data-design-name={item.title}
    style={designStyle}
    className={`mode-card ${item.available ? 'is-available' : 'is-locked'}`}
    onClick={() => { if (!designEnabled) item.action(gameStore); }}
  >
    <span className="mode-card__content"><strong>{item.title}</strong></span>
  </button>;
}

export default function MainMenu() {
  const gameStore = useGameStore();
  const ru = gameStore.language === UI_LANGUAGE.RU;
  const headerDesign = useDesignSurface('menu-brand');
  const selectorDesign = useDesignSurface('menu-navigation');
  const settingsDesign = useDesignSurface('menu-tab-settings');
  const quickDesign = useDesignSurface('menu-quick-tools');
  const designEnabled = useDesignStore(state => state.enabled);
  const twoDItems = [
    {
      id: 'game-2d',
      title: ru ? 'ИГРА / COMMAND' : 'GAME / COMMAND',
      meta: ru ? ['Command Mode', 'Украинский театр', 'Действующая симуляция'] : ['Command Mode', 'Ukraine theater', 'Live simulation'],
      action: store => store.startScenario(null),
      available: true,
    },
    {
      id: 'sandbox-2d', title: ru ? 'ПОЛИГОН / SANDBOX' : 'SANDBOX / POLYGON',
      action: store => store.openSandbox(), available: true,
    },
  ];
  const advancedItems = [
    {
      id: 'advanced-3d', title: ru ? 'СИМУЛЯЦИЯ' : 'SIMULATION',
      action: store => {
        useEngine.getState().resetScenario('SIMPLE');
        store.openAdvanced3D();
      }, available: true,
    },
    {
      id: 'sandbox-3d', title: ru ? '3D ПОЛИГОН' : '3D SANDBOX',
      action: store => {
        useEngine.getState().resetScenario('SANDBOX');
        store.openAdvancedSandbox();
      }, available: true,
    },
  ];
  const contentItems = [
    {
      id: 'scenarios', title: ru ? 'Сценарии' : 'Scenarios',
      meta: [ru ? 'Операции и локальная библиотека' : 'Operations and local library'], action: store => store.openScenarioLibrary(), available: true,
    },
    {
      id: 'reference', title: ru ? 'Справочник' : 'Reference',
      meta: [ru ? 'ПВО, угрозы, цели и FAQ' : 'Air defense, threats, objectives and FAQ'], action: store => store.openReference(), available: true,
    },
    {
      id: 'editor', title: ru ? 'Редактор' : 'Editor',
      meta: [ru ? 'Сценарии, объекты и интерфейс' : 'Scenarios, objects and interface'], action: store => store.openEditor(), available: true,
    },
  ];

  return (
    <main className="main-menu">
      <div className="main-menu__grid" aria-hidden="true" />
      <header className="main-menu__header" data-design-id="menu-brand" data-design-name="Логотип и описание" style={headerDesign}>
        <h1><span>SAM</span><span>SIMULATOR</span></h1>
      </header>

      <section className="mode-selector" aria-label="Game modes" data-design-id="menu-navigation" data-design-name="Навигация меню" style={selectorDesign}>
        <div className="mode-selector__group"><span>2D</span>
          {twoDItems.map(item => <MenuModeCard key={item.id} item={item} gameStore={gameStore} />)}
        </div>
        <div className="mode-selector__group"><span>ADVANCED 3D</span>
          {advancedItems.map(item => <MenuModeCard key={item.id} item={item} gameStore={gameStore} />)}
        </div>
        {contentItems.map(item => <MenuModeCard key={item.id} item={item} gameStore={gameStore} />)}
        <button className="mode-card mode-card--settings" data-design-id="menu-tab-settings" data-design-name="Настройки" style={settingsDesign} onClick={() => { if (!designEnabled) gameStore.openSettings(); }}>
          <span className="mode-card__content"><strong>{ru ? 'Настройки' : 'Settings'}</strong></span>
        </button>
      </section>

      <div className="main-menu__quick-actions" data-design-id="menu-quick-tools" data-design-name="Инструменты" style={quickDesign}>
        <button onClick={gameStore.openDeveloperMode}>{ru ? 'Режим разработчика' : 'Developer Mode'}</button>
        <DesignModeButton compact />
      </div>
    </main>
  );
}
