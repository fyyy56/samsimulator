import { useGameStore } from '../store/gameStore.js';
import ContentShell from '../ui/ContentShell.jsx';
import DesignableSurface from '../ui/DesignableSurface.jsx';

export default function EditorLandingScene() {
  const openEditorMap = useGameStore(state => state.openEditorMap);
  const openUiEditor = useGameStore(state => state.openUiEditor);
  const openObjectEditor = useGameStore(state => state.openObjectEditor);
  return <ContentShell eyebrow="DEVELOPER TOOLS" title="Редактор">
    <div className="editor-landing-grid">
      <DesignableSurface as="article" designId="editor-entry-scenario" designName="Редактор сценариев" className="editor-entry">
        <span>01 / SCENARIO</span><h2>Сценарии и объекты</h2><p>Открыть оперативную карту, расставить технику, цели и маршруты.</p><button onClick={openEditorMap}>Открыть редактор</button>
      </DesignableSurface>
      <DesignableSurface as="article" designId="editor-entry-ui" designName="UI Editor" className="editor-entry">
        <span>02 / INTERFACE</span><h2>UI Editor</h2><p>Настроить панели, цвета, текст и пресеты интерфейса.</p><button onClick={openUiEditor}>Открыть UI Editor</button>
      </DesignableSurface>
      <DesignableSurface as="article" designId="editor-entry-protected-objects" designName="Object Editor" className="editor-entry">
        <span>03 / OBJECTS</span><h2>Protected Object Editor</h2><p>Создать пользовательские игровые объекты на спутниковой карте.</p><button onClick={openObjectEditor}>Открыть Object Editor</button>
      </DesignableSurface>
    </div>
  </ContentShell>;
}
