import { useOlsViewStore } from '../../store/olsViewStore.js';
import './olsView.css';

export default function OlsHud({ stationId, onSelect, onExit, bracketRef, ru }) {
  const { mode, zoom, selectedKey, visibleEntities, status, setMode, setZoom, release } = useOlsViewStore();
  return <div className="ols-hud">
    <header className="ols-bar">
      <strong>OLS / EO <small>{stationId}</small></strong>
      <div>{['DAY', 'LOW-LIGHT', 'THERMAL'].map(value => <button key={value}
        aria-pressed={mode === value} onClick={() => setMode(value)}>{value}</button>)}</div>
      <button onClick={onExit}>ESC · COMMAND</button>
    </header>
    <div className="ols-reticle" aria-hidden="true" />
    <div ref={bracketRef} className="ols-bracket" aria-hidden="true" />
    <aside className="ols-contacts">
      <small>{ru ? 'В ПОЛЕ ЗРЕНИЯ' : 'IN VIEW'} · {visibleEntities.length}</small>
      {visibleEntities.slice(0, 8).map(entity => <button key={entity.key}
        aria-pressed={selectedKey === entity.key} onClick={() => onSelect(entity.key)}>
        {entity.name}<small>{entity.id}</small>
      </button>)}
    </aside>
    <footer className="ols-bar">
      <span>{status} · {selectedKey?.slice(selectedKey.indexOf(':') + 1) ?? '—'}</span>
      <div><button aria-label="Zoom out" onClick={() => setZoom(zoom / 1.4)}>−</button>
        <output>{zoom.toFixed(1)}×</output>
        <button aria-label="Zoom in" onClick={() => setZoom(zoom * 1.4)}>+</button></div>
      <button onClick={release}>{ru ? 'ОТПУСТИТЬ' : 'RELEASE'}</button>
      <small>{ru ? 'Тянуть — обзор · колесо — зум' : 'Drag to pan · wheel to zoom'}</small>
    </footer>
  </div>;
}
