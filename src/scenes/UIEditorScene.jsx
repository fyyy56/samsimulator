import { useRef, useState } from 'react';
import ContentShell from '../ui/ContentShell.jsx';
import { DEFAULT_UI_LAYOUT, selectActiveUiPreset, useContentStore } from '../store/contentStore.js';

const PANEL_LABELS = { radar: 'Состояние радаров', targets: 'Воздушные цели', info: 'Информация', hud: 'Главный HUD' };
const cloneLayout = layout => Object.fromEntries(Object.entries(layout).map(([id, panel]) => [id, { ...panel }]));

export default function UIEditorScene() {
  const presets = useContentStore(state => state.uiPresets);
  const activePreset = useContentStore(selectActiveUiPreset);
  const saveUiPreset = useContentStore(state => state.saveUiPreset);
  const setActiveUiPreset = useContentStore(state => state.setActiveUiPreset);
  const [layout, setLayout] = useState(() => cloneLayout(activePreset?.layout ?? DEFAULT_UI_LAYOUT));
  const [selectedId, setSelectedId] = useState('targets');
  const [name, setName] = useState('Мой интерфейс');
  const dragState = useRef(null);
  const selected = layout[selectedId];
  const update = patch => setLayout(current => ({ ...current, [selectedId]: { ...current[selectedId], ...patch } }));
  const beginPointerAction = (event, id, mode) => {
    event.stopPropagation();
    setSelectedId(id);
    dragState.current = { id, mode, startX: event.clientX, startY: event.clientY, panel: layout[id] };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const continuePointerAction = event => {
    const drag = dragState.current;
    if (!drag) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    setLayout(current => ({
      ...current,
      [drag.id]: drag.mode === 'move'
        ? { ...current[drag.id], x: Math.max(0, drag.panel.x + deltaX), y: Math.max(0, drag.panel.y + deltaY) }
        : { ...current[drag.id], width: Math.max(150, drag.panel.width + deltaX), height: Math.max(50, drag.panel.height + deltaY) },
    }));
  };
  return <ContentShell eyebrow="Инструменты разработчика" title="UI Editor" actions={<button className="content-primary" onClick={() => saveUiPreset({ name, layout })}>Сохранить пресет</button>}>
    <div className="ui-editor">
      <aside className="ui-editor__controls">
        <label>Пресет<select value={activePreset?.id} onChange={event => { const preset = presets.find(item => item.id === event.target.value); setActiveUiPreset(event.target.value); if (preset) setLayout(cloneLayout(preset.layout)); }}>{presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
        <label>Название<input value={name} onChange={event => setName(event.target.value)} /></label>
        <div className="editor-template-list">{Object.keys(layout).map(id => <button className={selectedId === id ? 'is-active' : ''} onClick={() => setSelectedId(id)} key={id}><strong>{PANEL_LABELS[id]}</strong></button>)}</div>
        <div className="inspector-fields">
          <div className="field-pair"><label>X<input type="number" value={selected.x} onChange={event => update({ x: Number(event.target.value) })} /></label><label>Y<input type="number" value={selected.y} onChange={event => update({ y: Number(event.target.value) })} /></label></div>
          <div className="field-pair"><label>Ширина<input type="number" value={selected.width} onChange={event => update({ width: Number(event.target.value) })} /></label><label>Высота<input type="number" value={selected.height} onChange={event => update({ height: Number(event.target.value) })} /></label></div>
          <label>Прозрачность <b>{Math.round(selected.opacity * 100)}%</b><input type="range" min="0.25" max="1" step="0.01" value={selected.opacity} onChange={event => update({ opacity: Number(event.target.value) })} /></label>
          <button onClick={() => setLayout(cloneLayout(DEFAULT_UI_LAYOUT))}>Сбросить раскладку</button>
        </div>
      </aside>
      <div className="ui-editor__canvas">{Object.entries(layout).map(([id, panel]) => <button key={id} className={`ui-preview-panel ${selectedId === id ? 'is-selected' : ''}`} style={{ left: panel.x, top: panel.y, width: panel.width, height: panel.height, opacity: panel.opacity }} onPointerDown={event => beginPointerAction(event, id, 'move')} onPointerMove={continuePointerAction} onPointerUp={() => { dragState.current = null; }}><span>{PANEL_LABELS[id]}</span><strong>{id === 'targets' ? 'TRACKED 03' : id === 'radar' ? 'SENSOR NET: ONLINE' : id === 'hud' ? 'SAM SIMULATOR' : 'TRK-004 · IDENTIFIED'}</strong><i className="ui-preview-panel__resize" onPointerDown={event => beginPointerAction(event, id, 'resize')} /></button>)}</div>
    </div>
  </ContentShell>;
}
