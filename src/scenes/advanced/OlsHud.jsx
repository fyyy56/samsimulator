import { useOlsViewStore } from '../../store/olsViewStore.js';
import { localizeTechnicalTerm } from '../../data/uiLocalization.js';
import './olsView.css';

export default function OlsHud({ stationId, onSelect, onExit, bracketRef, ru,
  torMode = false, torManual = false, onLock, onRelease,
  returnLabel = 'COMMAND' }) {
  const { mode, zoom, selectedKey, visibleEntities, status,
    setMode, setZoom } = useOlsViewStore();
  const tr = term => localizeTechnicalTerm(term, ru ? 'RU' : 'EN');
  const optical = useOlsViewStore(state => state.opticalTelemetry);
  return <div className={`ols-hud${torMode ? ' ols-hud--tor' : ''}`}>
    <header className="ols-bar">
      <strong>{torMode ? (ru ? 'Tor-M1 · ОЛС' : 'Tor-M1 · OLS') : tr('OLS / EO')} <small>{stationId}</small></strong>
      <div>{['DAY', 'LOW-LIGHT', 'THERMAL'].map(value => <button key={value}
        aria-pressed={mode === value} onClick={() => setMode(value)}>{tr(value)}</button>)}</div>
      <button onClick={onExit}>ESC · {returnLabel}</button>
    </header>
    <div className="ols-reticle" aria-hidden="true" />
    <div ref={bracketRef} className="ols-bracket" aria-hidden="true" />
    <div className="ols-tor-lock">
      <button type="button" onClick={onLock}>F · {selectedKey
        ? (ru ? 'СНЯТЬ ЗАХВАТ' : 'UNLOCK') : (ru ? 'ЗАХВАТ' : 'LOCK')}</button>
      <span>{selectedKey ? (ru ? 'ЗАХВАТ · ' : 'LOCK · ') + selectedKey.slice(selectedKey.indexOf(':') + 1)
        : torManual ? (ru ? 'РУЧНОЙ ПРИЦЕЛ' : 'MANUAL SIGHT')
          : (ru ? 'НАБЛЮДЕНИЕ' : 'OBSERVATION')}</span>
    </div>
    {!torMode && <details className="ols-contacts">
      <summary>{ru ? 'В ПОЛЕ ЗРЕНИЯ' : 'IN VIEW'} · {visibleEntities.length}</summary>
      {visibleEntities.slice(0, 8).map(entity => <button key={entity.key}
        aria-pressed={selectedKey === entity.key} onClick={() => onSelect(entity.key)}>
        {entity.name}<small>{entity.id}</small>
      </button>)}
    </details>}
    {!torMode && <div className="ols-optical-data">
      <span>AZ {optical?.azimuthDeg?.toFixed(1) ?? '—'}°</span>
      <span>EL {optical?.elevationDeg?.toFixed(1) ?? '—'}°</span>
      <span>RNG {optical?.rangeM != null ? `${(optical.rangeM / 1000).toFixed(2)} km` : '—'}</span>
      <span>FOV {optical?.fovDeg?.toFixed(2) ?? '—'}°</span>
    </div>}
    {torMode && <div className="ols-tor-hint">{torManual
      ? (ru ? 'ЛКМ / ПРОБЕЛ — ПУСК · F — ЗАХВАТ · Ctrl — КУРСОР · E — РЕЖИМ'
        : 'LMB / SPACE — FIRE · F — LOCK · Ctrl — CURSOR · E — MODE')
      : (ru ? 'НАБЛЮДЕНИЕ · F — ЗАХВАТ · E — РЕЖИМ' : 'OBSERVATION · F — LOCK · E — MODE')}</div>}
    {!torMode && <footer className="ols-bar">
      <span>{tr(status)} · {selectedKey?.slice(selectedKey.indexOf(':') + 1) ?? '—'}</span>
      <div><button aria-label="Zoom out" onClick={() => setZoom(zoom / 1.4)}>−</button>
        <output>{zoom.toFixed(1)}×</output>
        <button aria-label="Zoom in" onClick={() => setZoom(zoom * 1.4)}>+</button></div>
      <button onClick={onRelease}>{ru ? 'СНЯТЬ ЗАХВАТ' : 'UNLOCK'}</button>
      <small>{ru ? 'Мышь — прицел · F — захват · Ctrl — курсор · E — режим'
        : 'Mouse — sight · F — lock · Ctrl — cursor · E — mode'}</small>
    </footer>}
  </div>;
}
