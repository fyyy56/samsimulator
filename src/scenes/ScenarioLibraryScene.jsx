import ContentShell from '../ui/ContentShell.jsx';
import { useContentStore } from '../store/contentStore.js';
import { useGameStore } from '../store/gameStore.js';
import { PACKAGED_SCENARIOS } from '../content/scenarioRegistry.js';
import DesignableSurface from '../ui/DesignableSurface.jsx';

export default function ScenarioLibraryScene() {
  const scenarios = useContentStore(state => state.userScenarios);
  const deleteScenario = useContentStore(state => state.deleteScenario);
  const loadScenarioIntoEditor = useContentStore(state => state.loadScenarioIntoEditor);
  const startScenario = useGameStore(state => state.startScenario);
  const openEditor = useGameStore(state => state.openEditor);
  const openEditorMap = useGameStore(state => state.openEditorMap);
  return (
    <ContentShell eyebrow="Операции" title="Сценарии" actions={<button className="content-primary" onClick={openEditor}>+ Создать сценарий</button>}>
      <div className="scenario-grid">
        {PACKAGED_SCENARIOS.map(scenario => <DesignableSurface as="article" designId={`scenario-card-${scenario.id}`} designName={scenario.name} className="scenario-card scenario-card--featured" key={scenario.id}>
          <span>ВСТРОЕННАЯ ОПЕРАЦИЯ</span><h2>{scenario.name}</h2>
          <p>{scenario.description}</p>
          <div><b>{scenario.theater}</b>{scenario.tags.map(tag => <b key={tag}>{tag}</b>)}</div>
          <button onClick={() => startScenario(null)}>Начать операцию</button>
        </DesignableSurface>)}
        {scenarios.map(scenario => <DesignableSurface as="article" designId={`scenario-card-${scenario.id}`} designName={scenario.name} className="scenario-card" key={scenario.id}>
          <span>ПОЛЬЗОВАТЕЛЬСКИЙ · {scenario.objects.length} ОБЪЕКТОВ</span><h2>{scenario.name}</h2>
          <p>{scenario.description || 'Пользовательская конфигурация оперативной обстановки.'}</p>
          <small>{scenario.updatedAt ? new Date(scenario.updatedAt).toLocaleString('ru-RU') : ''}</small>
          <div className="scenario-card__actions">
            <button onClick={() => startScenario(scenario.id)}>Запустить</button>
            <button onClick={() => { loadScenarioIntoEditor(scenario.id); openEditorMap(); }}>Изменить</button>
            <button className="is-danger" onClick={() => deleteScenario(scenario.id)}>Удалить</button>
          </div>
        </DesignableSurface>)}
        {!scenarios.length && <div className="content-empty"><strong>Локальная библиотека пуста</strong><span>Создайте первый сценарий в редакторе. Он появится здесь автоматически.</span></div>}
      </div>
    </ContentShell>
  );
}
