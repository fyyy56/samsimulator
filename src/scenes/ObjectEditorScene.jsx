import { useEffect, useMemo, useRef, useState } from 'react';
import Map, { Layer, Marker, Source } from 'react-map-gl/maplibre';
import { useGameStore } from '../store/gameStore.js';
import {
  PROTECTED_OBJECT_SCHEMA_VERSION,
  PROTECTED_OBJECT_TYPES,
  validateProtectedObjectImport,
  useProtectedObjectStore,
} from '../store/protectedObjectStore.js';
import {
  COMMAND_MAP_BOUNDS,
  COMMAND_MAP_MAX_ZOOM,
  SATELLITE_MAP_STYLE,
  SATELLITE_MAP_STYLE_NO_LABELS,
} from './commandMapStyle.js';

const INTERACTION_MODE = Object.freeze({ SELECT: 'SELECT', ADD: 'ADD', MOVE: 'MOVE' });
const EMPTY_FORM = Object.freeze({ name: '', settlement: '', region: '', type: 'OTHER', notes: '', enabled: true });
const TYPE_META = Object.freeze({
  ENERGY: { label: 'Энергетика', glyph: '⚡', color: '#e0bd62' },
  LOGISTICS: { label: 'Логистика', glyph: '▦', color: '#9fc6b3' },
  AIRFIELD: { label: 'Аэродром', glyph: '✈', color: '#9ebed7' },
  PORT: { label: 'Порт', glyph: '⚓', color: '#73b9ca' },
  INDUSTRIAL: { label: 'Промышленность', glyph: '▥', color: '#c6a58d' },
  COMMAND: { label: 'Командование', glyph: '⌁', color: '#d48f7e' },
  RADAR: { label: 'Радар', glyph: '◉', color: '#79c6ae' },
  CIVIL: { label: 'Гражданский', glyph: '▤', color: '#c5c8bd' },
  OTHER: { label: 'Другое', glyph: '◆', color: '#b5b0ca' },
});

const toFeatureCollection = objects => ({
  type: 'FeatureCollection',
  features: objects.map(object => ({
    type: 'Feature',
    id: object.id,
    properties: {
      id: object.id,
      name: object.name,
      settlement: object.settlement,
      type: object.type,
      glyph: TYPE_META[object.type]?.glyph ?? TYPE_META.OTHER.glyph,
      color: TYPE_META[object.type]?.color ?? TYPE_META.OTHER.color,
    },
    geometry: { type: 'Point', coordinates: [object.lon, object.lat] },
  })),
});

function ObjectForm({ title, coordinates, initialValue, onSave, onCancel }) {
  const [form, setForm] = useState(initialValue ?? EMPTY_FORM);
  const dirty = JSON.stringify(form) !== JSON.stringify(initialValue ?? EMPTY_FORM);
  const close = () => {
    if (!dirty || window.confirm('Закрыть форму и отменить несохранённые изменения?')) onCancel();
  };
  useEffect(() => {
    const onKeyDown = event => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
  const valid = form.name.trim() && form.settlement.trim() && PROTECTED_OBJECT_TYPES.includes(form.type);
  return <section className="object-editor-form">
    <header><span>{title}</span><button onClick={close} aria-label="Закрыть">×</button></header>
    <label>Название *<input autoFocus value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
    <label>Населённый пункт / район *<input value={form.settlement} onChange={event => setForm({ ...form, settlement: event.target.value })} /></label>
    <label>Область / регион<input value={form.region} onChange={event => setForm({ ...form, region: event.target.value })} /></label>
    <label>Тип *<select value={form.type} onChange={event => setForm({ ...form, type: event.target.value })}>
      {PROTECTED_OBJECT_TYPES.map(type => <option key={type} value={type}>{TYPE_META[type].label}</option>)}
    </select></label>
    <label>Заметки<textarea value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></label>
    <label className="object-editor-check"><input type="checkbox" checked={form.enabled} onChange={event => setForm({ ...form, enabled: event.target.checked })} /> Включён</label>
    <div className="object-editor-coordinates">LAT {coordinates.lat.toFixed(6)} · LON {coordinates.lon.toFixed(6)}</div>
    <footer><button onClick={close}>Отмена</button><button className="is-primary" disabled={!valid} onClick={() => onSave(form)}>Сохранить</button></footer>
  </section>;
}

export default function ObjectEditorScene() {
  const mapRef = useRef(null);
  const importRef = useRef(null);
  const returnToMenu = useGameStore(state => state.returnToMenu);
  const objects = useProtectedObjectStore(state => state.objects);
  const camera = useProtectedObjectStore(state => state.editorCamera);
  const addObject = useProtectedObjectStore(state => state.addObject);
  const updateObject = useProtectedObjectStore(state => state.updateObject);
  const deleteObject = useProtectedObjectStore(state => state.deleteObject);
  const importObjects = useProtectedObjectStore(state => state.importObjects);
  const setEditorCamera = useProtectedObjectStore(state => state.setEditorCamera);
  const [mode, setMode] = useState(INTERACTION_MODE.SELECT);
  const [selectedId, setSelectedId] = useState(null);
  const [temporaryPosition, setTemporaryPosition] = useState(null);
  const [moveCandidate, setMoveCandidate] = useState(null);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [notice, setNotice] = useState('');
  const selected = objects.find(object => object.id === selectedId) ?? null;
  const filteredObjects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru');
    return objects.filter(object => (typeFilter === 'ALL' || object.type === typeFilter)
      && (!needle || `${object.name} ${object.settlement} ${object.region}`.toLocaleLowerCase('ru').includes(needle)));
  }, [objects, query, typeFilter]);
  const objectData = useMemo(() => toFeatureCollection(filteredObjects), [filteredObjects]);

  const cancelInteraction = () => {
    setTemporaryPosition(null);
    setMoveCandidate(null);
    setEditing(false);
    setMode(INTERACTION_MODE.SELECT);
  };
  useEffect(() => {
    const onKeyDown = event => {
      if (event.key !== 'Escape' || editing || temporaryPosition) return;
      if (mode !== INTERACTION_MODE.SELECT || moveCandidate) cancelInteraction();
      else setSelectedId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, mode, moveCandidate, temporaryPosition]);

  const selectObject = id => {
    const object = objects.find(item => item.id === id);
    if (!object) return;
    cancelInteraction();
    setSelectedId(id);
    mapRef.current?.flyTo({ center: [object.lon, object.lat], zoom: Math.max(mapRef.current.getZoom(), 8), duration: 650 });
  };
  const onMapClick = event => {
    const featureId = event.features?.[0]?.properties?.id;
    if (featureId) {
      if (mode === INTERACTION_MODE.SELECT) selectObject(featureId);
      return;
    }
    const position = { lat: event.lngLat.lat, lon: event.lngLat.lng };
    if (mode === INTERACTION_MODE.ADD && !temporaryPosition) {
      setTemporaryPosition(position);
      return;
    }
    if (mode === INTERACTION_MODE.MOVE && selected) {
      setMoveCandidate(position);
      return;
    }
    if (mode === INTERACTION_MODE.SELECT) setSelectedId(null);
  };
  const resetView = () => mapRef.current?.fitBounds(COMMAND_MAP_BOUNDS, { padding: 30, duration: 650 });
  const fitObjects = () => {
    if (!objects.length) return;
    const bounds = objects.reduce((result, object) => {
      if (!result) return [[object.lon, object.lat], [object.lon, object.lat]];
      result[0][0] = Math.min(result[0][0], object.lon);
      result[0][1] = Math.min(result[0][1], object.lat);
      result[1][0] = Math.max(result[1][0], object.lon);
      result[1][1] = Math.max(result[1][1], object.lat);
      return result;
    }, null);
    mapRef.current?.fitBounds(bounds, { padding: 90, maxZoom: 10, duration: 650 });
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ version: PROTECTED_OBJECT_SCHEMA_VERSION, objects }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sam-simulator-protected-objects-v1.json';
    link.click();
    URL.revokeObjectURL(url);
  };
  const onImport = event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = validateProtectedObjectImport(JSON.parse(reader.result));
        importObjects(imported);
        setNotice(`Импортировано объектов: ${imported.length}`);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Не удалось импортировать файл.');
      }
      window.setTimeout(() => setNotice(''), 3200);
    };
    reader.onerror = () => setNotice('Не удалось прочитать файл.');
    reader.readAsText(file);
    event.target.value = '';
  };

  const activePosition = moveCandidate ?? temporaryPosition;
  return <main className="object-editor-scene">
    <Map
      ref={mapRef}
      initialViewState={camera}
      minZoom={4}
      maxZoom={COMMAND_MAP_MAX_ZOOM}
      maxBounds={[[19, 42], [45, 56]]}
      mapStyle={camera.mapStyle === 'SATELLITE' ? SATELLITE_MAP_STYLE_NO_LABELS : SATELLITE_MAP_STYLE}
      dragRotate={false}
      touchPitch={false}
      pitchWithRotate={false}
      attributionControl
      interactiveLayerIds={['protected-object-hit']}
      cursor={mode === INTERACTION_MODE.ADD || mode === INTERACTION_MODE.MOVE ? 'crosshair' : 'default'}
      onClick={onMapClick}
      onMoveEnd={event => setEditorCamera({
        longitude: event.viewState.longitude,
        latitude: event.viewState.latitude,
        zoom: event.viewState.zoom,
      })}
    >
      <Source id="protected-editor-objects" type="geojson" data={objectData}>
        <Layer id="protected-object-halo" type="circle" paint={{
          'circle-radius': ['case', ['==', ['get', 'id'], selectedId ?? ''], 10, 7],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.82,
          'circle-stroke-color': '#f2f6ef',
          'circle-stroke-width': ['case', ['==', ['get', 'id'], selectedId ?? ''], 2.5, 1],
        }} />
        <Layer id="protected-object-hit" type="circle" paint={{ 'circle-radius': 13, 'circle-opacity': 0 }} />
        <Layer id="protected-object-symbol" type="symbol" layout={{
          'text-field': ['get', 'glyph'], 'text-size': 11, 'text-allow-overlap': true,
        }} paint={{ 'text-color': '#071012' }} />
      </Source>
      {activePosition && <Marker longitude={activePosition.lon} latitude={activePosition.lat} anchor="center">
        <div className="protected-object-marker is-temporary">+</div>
      </Marker>}
      {selected && mode === INTERACTION_MODE.SELECT && <Marker longitude={selected.lon} latitude={selected.lat} anchor="bottom" offset={[0, -12]}>
        <div className="protected-object-map-label"><strong>{selected.name}</strong><span>{selected.settlement}</span></div>
      </Marker>}
    </Map>

    <header className="object-editor-toolbar">
      <button onClick={returnToMenu}>← МЕНЮ</button>
      <strong>OBJECT EDITOR</strong>
      {[INTERACTION_MODE.SELECT, INTERACTION_MODE.ADD].map(value => <button key={value} className={mode === value ? 'is-active' : ''} onClick={() => { cancelInteraction(); setMode(value); }}>{value === 'ADD' ? '+ ДОБАВИТЬ ОБЪЕКТ' : 'ВЫБОР'}</button>)}
      <button className={mode === INTERACTION_MODE.MOVE ? 'is-active' : ''} disabled={!selected} onClick={() => { cancelInteraction(); setMode(INTERACTION_MODE.MOVE); }}>ПЕРЕМЕСТИТЬ</button>
      <button disabled={!selected} onClick={() => {
        if (window.confirm(`Удалить объект «${selected.name}»?`)) { deleteObject(selected.id); setSelectedId(null); cancelInteraction(); }
      }}>УДАЛИТЬ</button>
    </header>

    <aside className="object-editor-list">
      <header><strong>OBJECTS: {objects.length}</strong><button onClick={() => setMode(INTERACTION_MODE.ADD)}>＋</button></header>
      <input type="search" placeholder="Поиск…" value={query} onChange={event => setQuery(event.target.value)} />
      <select value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option value="ALL">Все типы</option>{PROTECTED_OBJECT_TYPES.map(type => <option key={type} value={type}>{TYPE_META[type].label}</option>)}</select>
      <div className="object-editor-list__items">
        {!filteredObjects.length && <div className="object-editor-empty"><span>Объектов пока нет</span><button onClick={() => setMode(INTERACTION_MODE.ADD)}>+ Добавить объект</button></div>}
        {filteredObjects.map(object => <button key={object.id} className={selectedId === object.id ? 'is-selected' : ''} onClick={() => selectObject(object.id)}>
          <i style={{ '--object-color': TYPE_META[object.type].color }}>{TYPE_META[object.type].glyph}</i><span><strong>{object.name}</strong><small>{object.settlement || 'Без населённого пункта'} · {TYPE_META[object.type].label}</small></span>
        </button>)}
      </div>
      <footer><button onClick={() => importRef.current?.click()}>IMPORT</button><button onClick={exportJson}>EXPORT</button><input ref={importRef} type="file" accept="application/json,.json" onChange={onImport} /></footer>
    </aside>

    <nav className="object-editor-map-tools">
      <button onClick={resetView}>RESET VIEW</button><button disabled={!objects.length} onClick={fitObjects}>FIT OBJECTS</button>
      <button onClick={() => setEditorCamera({ mapStyle: camera.mapStyle === 'SATELLITE' ? 'SATELLITE_LABELS' : 'SATELLITE' })}>{camera.mapStyle === 'SATELLITE' ? 'SAT + LABELS' : 'SATELLITE'}</button>
    </nav>

    {selected && !editing && !temporaryPosition && <aside className="object-editor-details">
      <span>{TYPE_META[selected.type].label}</span><h2>{selected.name}</h2><p>{selected.settlement || '—'}{selected.region ? ` · ${selected.region}` : ''}</p>
      <code>{selected.lat.toFixed(6)} / {selected.lon.toFixed(6)}</code>
      {selected.notes && <small>{selected.notes}</small>}
      <footer><button onClick={() => setEditing(true)}>РЕДАКТИРОВАТЬ</button><button onClick={() => setMode(INTERACTION_MODE.MOVE)}>ПЕРЕМЕСТИТЬ</button></footer>
    </aside>}

    {temporaryPosition && <ObjectForm title="НОВЫЙ ОБЪЕКТ" coordinates={temporaryPosition} onCancel={cancelInteraction} onSave={form => {
      const id = addObject({ ...form, ...temporaryPosition });
      setSelectedId(id); cancelInteraction();
    }} />}
    {editing && selected && <ObjectForm title={`РЕДАКТИРОВАТЬ · ${selected.id}`} coordinates={selected} initialValue={{ name: selected.name, settlement: selected.settlement, region: selected.region, type: selected.type, notes: selected.notes, enabled: selected.enabled }} onCancel={() => setEditing(false)} onSave={form => { updateObject(selected.id, form); setEditing(false); }} />}
    {mode === INTERACTION_MODE.MOVE && selected && <section className="object-editor-move-confirm">
      <span>{moveCandidate ? 'Новая позиция выбрана' : 'Кликните новую позицию на карте'}</span><button disabled={!moveCandidate} onClick={() => { updateObject(selected.id, moveCandidate); cancelInteraction(); }}>СОХРАНИТЬ ПОЗИЦИЮ</button><button onClick={cancelInteraction}>ОТМЕНА</button>
    </section>}
    {notice && <output className="object-editor-notice">{notice}</output>}
  </main>;
}
