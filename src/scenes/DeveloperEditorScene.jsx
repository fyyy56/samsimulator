import { useMemo, useState } from 'react';
import Map, { Layer, Marker, Source } from 'react-map-gl/maplibre';
import ContentShell from '../ui/ContentShell.jsx';
import { COMMAND_MAP_STYLE } from './commandMapStyle.js';
import { EDITOR_OBJECT_TYPE, normalizeEditorObject } from '../content/contentSchemas.js';
import { getContentAsset, PACKAGED_CONTENT } from '../content/contentRegistry.js';
import { getLightAsset } from '../data/lightModeAssets.js';
import { useContentStore } from '../store/contentStore.js';
import { useGameStore } from '../store/gameStore.js';

const TYPE_LABELS = Object.freeze({
  UAV: 'БПЛА', CRUISE_MISSILE: 'Крылатая ракета', BALLISTIC_MISSILE: 'Баллистическая ракета',
  AIRCRAFT: 'Самолёт', INTERCEPTOR: 'Перехватчик', GROUND_VEHICLE: 'Наземная техника',
  RADAR: 'Радар', LAUNCHER: 'Пусковая', AA_GUN: 'Зенитное орудие',
});

const GENERIC_TEMPLATES = Object.freeze([
  { id: 'generic-aircraft', name: 'Самолёт', kind: 'EDITOR', editorType: 'AIRCRAFT', assetId: null, defaults: { speedKmh: 780, altitudeM: 6000 } },
  { id: 'generic-radar', name: 'Радар', kind: 'EDITOR', editorType: 'RADAR', assetId: 'NASAMS_RADAR' },
  { id: 'generic-vehicle', name: 'Наземная техника', kind: 'EDITOR', editorType: 'GROUND_VEHICLE', assetId: null },
]);

const makeObject = (template, position) => normalizeEditorObject({
  id: `OBJ-${Date.now()}-${Math.floor(position.lat * 1000)}`,
  objectType: template.editorType,
  contentId: template.id,
  assetId: template.assetId,
  name: template.name,
  position,
  speedKmh: template.defaults?.speedKmh ?? (template.editorType === 'INTERCEPTOR' ? 2500 : 0),
  altitudeM: template.defaults?.altitudeM ?? 0,
});

function ObjectSprite({ object, userAssets }) {
  const userAsset = userAssets.find(asset => asset.id === object.assetId);
  const packaged = PACKAGED_CONTENT.find(item => item.id === object.contentId);
  const asset = userAsset ? { src: userAsset.dataUrl } : (object.assetId ? getLightAsset(object.assetId) : getContentAsset(packaged));
  return <div className={`editor-marker editor-marker--${object.objectType.toLowerCase()}`} style={{ '--object-scale': object.size }}>
    {asset?.src ? <img src={asset.src} alt="" style={{ transform: `translate(${userAsset?.offsetX ?? 0}px, ${userAsset?.offsetY ?? 0}px) rotate(${object.heading}deg)` }} /> : <span>{TYPE_LABELS[object.objectType]?.slice(0, 3)}</span>}
  </div>;
}

export default function DeveloperEditorScene() {
  const storedDraft = useContentStore(state => state.editorDraft);
  const userAssets = useContentStore(state => state.userAssets);
  const addUserAsset = useContentStore(state => state.addUserAsset);
  const updateUserAsset = useContentStore(state => state.updateUserAsset);
  const saveScenario = useContentStore(state => state.saveScenario);
  const clearEditorDraft = useContentStore(state => state.clearEditorDraft);
  const openUiEditor = useGameStore(state => state.openUiEditor);
  const [draft, setDraft] = useState(() => ({ ...storedDraft, objects: storedDraft.objects.map(normalizeEditorObject) }));
  const [placement, setPlacement] = useState(null);
  const [selectedId, setSelectedId] = useState(draft.objects[0]?.id ?? null);
  const [routeMode, setRouteMode] = useState(false);
  const [activePanel, setActivePanel] = useState('OBJECTS');
  const [selectedAssetId, setSelectedAssetId] = useState(null);
  const [notice, setNotice] = useState('');
  const selected = draft.objects.find(object => object.id === selectedId) ?? null;
  const selectedUserAsset = userAssets.find(asset => asset.id === selectedAssetId) ?? null;
  const templates = [...PACKAGED_CONTENT.filter(item => item.editorType && item.kind !== 'FAQ'), ...GENERIC_TEMPLATES];
  const routesGeoJson = useMemo(() => ({
    type: 'FeatureCollection',
    features: draft.objects.filter(object => object.route.length).map(object => ({
      type: 'Feature', properties: { selected: object.id === selectedId ? 1 : 0 },
      geometry: { type: 'LineString', coordinates: [[object.position.lng, object.position.lat], ...object.route.map(point => [point.lng, point.lat])] },
    })),
  }), [draft.objects, selectedId]);

  const updateObject = (id, patch) => setDraft(current => ({
    ...current,
    objects: current.objects.map(object => object.id === id ? normalizeEditorObject({ ...object, ...patch }) : object),
  }));
  const handleMapClick = event => {
    const position = { lat: event.lngLat.lat, lng: event.lngLat.lng };
    if (routeMode && selected) {
      updateObject(selected.id, { route: [...selected.route, position] });
      return;
    }
    if (!placement) return;
    const object = makeObject(placement, position);
    setDraft(current => ({ ...current, objects: [...current.objects, object] }));
    setSelectedId(object.id);
    setPlacement(null);
  };
  const save = () => {
    const id = saveScenario(draft);
    setDraft(current => ({ ...current, id }));
    setNotice('Сценарий сохранён в локальной библиотеке');
    window.setTimeout(() => setNotice(''), 2400);
  };
  const importAsset = event => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => addUserAsset({ name: file.name.replace(/\.[^.]+$/, ''), dataUrl: reader.result, objectType: EDITOR_OBJECT_TYPE.UAV });
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  return <ContentShell eyebrow="Инструменты разработчика" title="Редактор сценария" actions={<>
    <button onClick={openUiEditor}>UI Editor</button><button className="content-primary" onClick={save}>Сохранить</button>
  </>}>
    <div className="editor-workspace">
      <aside className="editor-palette">
        <div className="content-tabs"><button className={activePanel === 'OBJECTS' ? 'is-active' : ''} onClick={() => setActivePanel('OBJECTS')}>Объекты</button><button className={activePanel === 'ASSETS' ? 'is-active' : ''} onClick={() => setActivePanel('ASSETS')}>Ассеты</button></div>
        {activePanel === 'OBJECTS' ? <div className="editor-template-list">{templates.map(template => <button key={template.id} className={placement?.id === template.id ? 'is-active' : ''} onClick={() => { setPlacement(template); setRouteMode(false); }}><span>{TYPE_LABELS[template.editorType]}</span><strong>{template.name}</strong></button>)}</div> : <div className="asset-manager">
          <label className="asset-upload">+ Добавить PNG/JPG<input type="file" accept="image/png,image/jpeg,image/webp" onChange={importAsset} /></label>
          {userAssets.map(asset => <button className={selectedAssetId === asset.id ? 'is-active' : ''} key={asset.id} onClick={() => { setSelectedAssetId(asset.id); if (selected) updateObject(selected.id, { assetId: asset.id }); }}><img src={asset.dataUrl} alt="" /><span>{asset.name}</span></button>)}
          {selectedUserAsset && <div className="asset-settings"><label>Масштаб<input type="number" min="0.2" max="4" step="0.1" value={selectedUserAsset.scale} onChange={event => updateUserAsset(selectedUserAsset.id, { scale: event.target.value })} /></label><div className="field-pair"><label>Смещение X<input type="number" value={selectedUserAsset.offsetX} onChange={event => updateUserAsset(selectedUserAsset.id, { offsetX: event.target.value })} /></label><label>Смещение Y<input type="number" value={selectedUserAsset.offsetY} onChange={event => updateUserAsset(selectedUserAsset.id, { offsetY: event.target.value })} /></label></div><small>Настройки применяются ко всем объектам с этой моделью.</small></div>}
          {!userAssets.length && <p>Импортированные изображения сохраняются только в этом браузере.</p>}
        </div>}
        <div className="editor-help">{placement ? `Кликните по карте: ${placement.name}` : routeMode ? 'Добавляйте точки маршрута кликами по карте' : 'Выберите модель или объект на карте'}</div>
      </aside>

      <div className="editor-map">
        <Map initialViewState={{ longitude: 31.2, latitude: 48.7, zoom: 5.2 }} minZoom={4.2} maxZoom={10} maxBounds={[[20.5, 42], [43.5, 55.8]]} mapStyle={COMMAND_MAP_STYLE} onClick={handleMapClick}>
          <Source id="editor-routes" type="geojson" data={routesGeoJson}><Layer id="editor-routes-line" type="line" paint={{ 'line-color': ['case', ['==', ['get', 'selected'], 1], '#efc86f', '#86b7a1'], 'line-width': 2, 'line-opacity': 0.78, 'line-dasharray': [2, 2] }} /></Source>
          {draft.objects.map(object => <Marker key={object.id} longitude={object.position.lng} latitude={object.position.lat} draggable onDragEnd={event => updateObject(object.id, { position: { lat: event.lngLat.lat, lng: event.lngLat.lng } })} onClick={event => { event.originalEvent.stopPropagation(); setSelectedId(object.id); setPlacement(null); }}><ObjectSprite object={object} userAssets={userAssets} /></Marker>)}
          {selected?.route.map((point, index) => <Marker key={`${selected.id}-wp-${index}`} longitude={point.lng} latitude={point.lat} draggable onDragEnd={event => updateObject(selected.id, { route: selected.route.map((value, valueIndex) => valueIndex === index ? { lat: event.lngLat.lat, lng: event.lngLat.lng } : value) })}><div className="editor-waypoint">{index + 1}</div></Marker>)}
        </Map>
        <div className="editor-map-tools"><button className={routeMode ? 'is-active' : ''} disabled={!selected} onClick={() => { setRouteMode(value => !value); setPlacement(null); }}>Маршрут</button><button disabled={!selected?.route.length} onClick={() => updateObject(selected.id, { route: [] })}>Очистить путь</button></div>
      </div>

      <aside className="editor-inspector">
        <input className="editor-title-input" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} aria-label="Название сценария" />
        <textarea value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} placeholder="Описание операции" />
        <div className="editor-object-count"><span>Объекты</span><b>{draft.objects.length}</b><button onClick={() => { clearEditorDraft(); setDraft({ id: null, name: 'Новый сценарий', description: '', objects: [] }); setSelectedId(null); }}>Новый</button></div>
        {selected ? <div className="inspector-fields">
          <label>Название<input value={selected.name} onChange={event => updateObject(selected.id, { name: event.target.value })} /></label>
          <label>Тип<select value={selected.objectType} onChange={event => updateObject(selected.id, { objectType: event.target.value })}>{Object.entries(TYPE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <div className="field-pair"><label>Скорость, км/ч<input type="number" value={selected.speedKmh} onChange={event => updateObject(selected.id, { speedKmh: event.target.value })} /></label><label>Высота, м<input type="number" value={selected.altitudeM} onChange={event => updateObject(selected.id, { altitudeM: event.target.value })} /></label></div>
          <div className="field-pair"><label>Курс<input type="number" min="0" max="359" value={selected.heading} onChange={event => updateObject(selected.id, { heading: event.target.value })} /></label><label>Масштаб<input type="number" step="0.1" min="0.25" max="4" value={selected.size} onChange={event => updateObject(selected.id, { size: event.target.value })} /></label></div>
          <div className="field-pair"><label>Количество<input type="number" min="1" max="100" value={selected.count} onChange={event => updateObject(selected.id, { count: event.target.value })} /></label><label>Интервал, с<input type="number" min="0" value={selected.intervalSec} onChange={event => updateObject(selected.id, { intervalSec: event.target.value })} /></label></div>
          <label>Модель<select value={selected.assetId ?? ''} onChange={event => updateObject(selected.id, { assetId: event.target.value || null })}><option value="">Автоматически</option>{PACKAGED_CONTENT.filter(item => item.assetId).map(item => <option key={`${item.id}-${item.assetId}`} value={item.assetId}>{item.name}</option>)}{userAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
          <div className="inspector-coords"><span>{selected.position.lat.toFixed(5)}</span><span>{selected.position.lng.toFixed(5)}</span><span>{selected.route.length} WP</span></div>
          <button className="is-danger" onClick={() => { setDraft(current => ({ ...current, objects: current.objects.filter(object => object.id !== selected.id) })); setSelectedId(null); }}>Удалить объект</button>
        </div> : <div className="content-empty"><strong>Нет выбранного объекта</strong><span>Выберите модель слева и поставьте её на карту.</span></div>}
      </aside>
    </div>
    {notice && <div className="editor-toast">{notice}</div>}
  </ContentShell>;
}
