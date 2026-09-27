import { useEffect, useRef, useState } from 'react';
import { CallbackProperty, Cartesian2, Cartesian3, Cartographic, Color, HeadingPitchRoll, HeadingPitchRange, HeightReference, Math as CesiumMath,
  Matrix4, NearFarScalar, PolygonHierarchy, ScreenSpaceEventHandler, ScreenSpaceEventType, Transforms,
  VerticalOrigin } from 'cesium';
import { SYSTEM_CATALOG, useEngine } from '../../store/engine.js';
import { localizeTechnicalTerm } from '../../data/uiLocalization.js';
import { getDestinationPoint } from '../../store/geo.js';
import { ADVANCED_GROUND_ASSETS, ADVANCED_GROUND_DEPLOYMENTS,
  resolveAdvancedAssetPresentation } from '../../data/advanced3dRegistry.js';
import { deleteGroundPart, groundObjects, groundParts, placeGroundObject } from './groundPlacement.js';
import './groundPlacement.css';

const PREFIX = 'placed-ground:';
const sectorShape = (lat, lng, heading, widthDeg, rangeKm) => new PolygonHierarchy([
  Cartesian3.fromDegrees(lng, lat, 0),
  ...Array.from({ length: 9 }, (_, index) => {
    const point = getDestinationPoint(lat, lng,
      heading - widthDeg / 2 + widthDeg * index / 8, rangeKm);
    return Cartesian3.fromDegrees(point.lng, point.lat, 0);
  }),
]);
const assetName = item => {
  if (item.kind === 'RADAR') return ADVANCED_GROUND_ASSETS[item.assetId]?.displayName ?? item.object.displayName;
  const launcher = ADVANCED_GROUND_ASSETS[item.object.placementLauncherAssetId]?.displayName;
  const radar = ADVANCED_GROUND_ASSETS[item.object.placementRadarAssetId]?.displayName;
  return launcher ?? radar ?? item.object.displayName;
};

export function GroundObjectList({ selected, onSelect, ru }) {
  const tr = term => localizeTechnicalTerm(term, ru ? 'RU' : 'EN');
  const batteries = useEngine(state => state.batteries);
  const searchRadars = useEngine(state => state.searchRadars);
  const objects = groundObjects({ batteries, searchRadars });
  return objects.length > 0 && <section><h3>{ru ? 'НАЗЕМНЫЕ ОБЪЕКТЫ' : 'GROUND OBJECTS'} <b>{objects.length}</b></h3>
    {objects.map(item => <button key={item.key} className={selected === item.key ? 'is-active' : ''}
      onClick={() => onSelect(item.key)}><span>{assetName(item)}</span>
      <small>{tr(item.kind === 'RADAR' ? 'RADAR' : 'SAM BATTERY')} · {item.object.id}</small></button>)}
  </section>;
}

export default function GroundPlacement({ viewer, enabled, selected, onSelect, onOpenTorOls, ru }) {
  const tr = term => localizeTechnicalTerm(term, ru ? 'RU' : 'EN');
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('SAM');
  const [pending, setPending] = useState(null);
  const [pendingHeading, setPendingHeading] = useState(0);
  const pendingRef = useRef(null);
  const headingRef = useRef(0);
  const selectedRef = useRef(selected);
  const selectionCallback = useRef(onSelect);
  const batteries = useEngine(state => state.batteries);
  const searchRadars = useEngine(state => state.searchRadars);
  const tracks = useEngine(state => state.tracks);
  const item = groundObjects({ batteries, searchRadars }).find(object => object.key === selected);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  useEffect(() => { selectedRef.current = selected; selectionCallback.current = onSelect; }, [selected, onSelect]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const renderedEntities = new globalThis.Map();
    const sync = () => {
      if (viewer.isDestroyed()) return;
      const live = new Set();
      for (const object of groundObjects(useEngine.getState())) for (const part of groundParts(object)) {
        const id = `${PREFIX}${object.key}/${part.id}`;
        live.add(id);
        const signature = `${part.assetId}:${part.position.lat}:${part.position.lng}:${part.heading}`;
        const assetSignature = `${part.assetId}:${part.position.lat}:${part.position.lng}`;
        const old = renderedEntities.get(id);
        if (old?.signature === signature) continue;
        const metadata = ADVANCED_GROUND_ASSETS[part.assetId];
        const resolved = resolveAdvancedAssetPresentation(metadata);
        const cartographic = Cartographic.fromDegrees(part.position.lng, part.position.lat);
        const ground = viewer.scene.globe.getHeight(cartographic) ?? 0;
        const position = Cartesian3.fromDegrees(part.position.lng, part.position.lat, ground + metadata.groundOffsetM);
        const orientation = Transforms.headingPitchRollQuaternion(position, new HeadingPitchRoll(
          CesiumMath.toRadians(part.heading + metadata.yawOffsetDeg),
          CesiumMath.toRadians(metadata.pitchOffsetDeg), CesiumMath.toRadians(metadata.rollOffsetDeg)));
        // Registry corrections already encode authored forward/up axes. There is
        // no additional renderer axis adjustment or non-uniform model scale.
        const matrix = Matrix4.fromTranslationQuaternionRotationScale(position, orientation,
          new Cartesian3(resolved.uniformScale, resolved.uniformScale, resolved.uniformScale));
        const anchor = offset => Matrix4.multiplyByPoint(matrix,
          new Cartesian3(offset.x, offset.y, offset.z), new Cartesian3());
        if (old?.assetSignature === assetSignature) {
          // Launcher/radar headings can change every simulation tick. Updating
          // the existing entity keeps its loaded GLB alive through rotation.
          old.entity.orientation = orientation;
          old.entity.properties.sensorOrigin = metadata.sensorOriginM
            ? anchor(metadata.sensorOriginM) : position;
          const label = viewer.entities.getById(`${id}/label`);
          if (label) label.position = anchor(metadata.labelOffsetM);
          old.signature = signature;
          continue;
        }
        if (old) old.ids.forEach(value => viewer.entities.removeById(value));
        const fallback = resolveAdvancedAssetPresentation(metadata, 'FAILED');
        const entity = viewer.entities.add({ id, position, orientation,
          properties: { groundKey: object.key, forwardAxis: metadata.forwardAxis, upAxis: metadata.upAxis,
            sensorOrigin: metadata.sensorOriginM ? anchor(metadata.sensorOriginM) : position },
          model: resolved.renderType === 'MODEL' ? { uri: resolved.modelUri, scale: resolved.uniformScale,
            shadows: new CallbackProperty(() => viewer.shadows ? 1 : 0, false),
            minimumPixelSize: 0, maximumScale: resolved.uniformScale, runAnimations: false } : undefined,
          billboard: resolved.renderType === 'BILLBOARD' ? {
            image: fallback.fallbackAsset, width: 80,
            height: 80 * metadata.billboardDimensionsM.height / metadata.billboardDimensionsM.width,
            verticalOrigin: VerticalOrigin.BOTTOM,
            scaleByDistance: new NearFarScalar(metadata.billboardDistance.nearM, metadata.billboardDistance.nearScale,
              metadata.billboardDistance.farM, metadata.billboardDistance.farScale),
          } : undefined,
        });
        viewer.entities.add({ id: `${id}/label`, position: anchor(metadata.labelOffsetM),
          properties: { groundKey: object.key },
          label: { text: metadata.displayName, font: '11px sans-serif', fillColor: Color.WHITE,
            showBackground: false,
            pixelOffset: new Cartesian2(0, -12), scaleByDistance: new NearFarScalar(100, 1, 80000, 0.5) } });
        const ids = [id, `${id}/label`];
        renderedEntities.set(id, { signature, assetSignature, entity, ids });
      }
      for (const [id, record] of renderedEntities) if (!live.has(id)) {
        record.ids.forEach(value => viewer.entities.removeById(value)); renderedEntities.delete(id);
      }
    };
    sync();
    const unsubscribe = useEngine.subscribe(sync);
    return () => { unsubscribe(); if (!viewer.isDestroyed()) renderedEntities.forEach(record => {
      record.ids.forEach(value => viewer.entities.removeById(value));
    }); };
  }, [viewer]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !enabled) return;
    const preview = viewer.entities.add({ id: 'ground-placement-preview', show: false,
      point: { pixelSize: 12, color: Color.fromCssColorString('#84e8c2'), outlineColor: Color.BLACK, outlineWidth: 2 } });
    let previewLocation = null;
    const previewSector = viewer.entities.add({ id: 'ground-placement-sector-preview',
      polygon: { show: false,
        hierarchy: new CallbackProperty(() => previewLocation
          ? sectorShape(previewLocation.lat, previewLocation.lng, headingRef.current,
            SYSTEM_CATALOG.LONG.radarSector, 8)
          : sectorShape(50, 30, 0, 3, .001), false),
        height: 0,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        material: Color.fromCssColorString('#8ce2bd').withAlpha(.09), outline: false } });
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    const pickGround = point => {
      const ray = viewer.camera.getPickRay(point);
      return ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
    };
    handler.setInputAction(event => {
      if (!pendingRef.current) { preview.show = false; previewSector.polygon.show = false; return; }
      const position = pickGround(event.endPosition);
      preview.show = Boolean(position);
      if (position) {
        preview.position = position;
        const location = Cartographic.fromCartesian(position);
        previewLocation = { lat: CesiumMath.toDegrees(location.latitude), lng: CesiumMath.toDegrees(location.longitude) };
      }
      previewSector.polygon.show = Boolean(position && pendingRef.current === 'PATRIOT_RADAR');
    }, ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction(event => {
      if (pendingRef.current) {
        const point = pickGround(event.position);
        if (!point) return;
        const location = Cartographic.fromCartesian(point);
        const key = placeGroundObject(pendingRef.current, CesiumMath.toDegrees(location.latitude), CesiumMath.toDegrees(location.longitude), headingRef.current);
        if (key) { pendingRef.current = null; setPending(null); preview.show = false;
          previewSector.polygon.show = false; selectionCallback.current(key); }
      } else {
        const entity = viewer.scene.pick(event.position)?.id;
        const key = entity?.properties?.groundKey?.getValue();
        if (key) selectionCallback.current(key);
      }
    }, ScreenSpaceEventType.LEFT_CLICK);
    const escape = event => { if (event.key === 'Escape') {
      pendingRef.current = null; setPending(null); setOpen(false); preview.show = false;
      previewSector.polygon.show = false;
    } };
    window.addEventListener('keydown', escape);
    return () => { handler.destroy(); window.removeEventListener('keydown', escape);
      if (!viewer.isDestroyed()) { viewer.entities.remove(preview); viewer.entities.remove(previewSector);
        viewer.scene.canvas.style.cursor = ''; } };
  }, [viewer, enabled]);

  useEffect(() => {
    if (viewer && !viewer.isDestroyed()) viewer.scene.canvas.style.setProperty('cursor', enabled && pending ? 'crosshair' : '');
  }, [viewer, pending, enabled]);
  useEffect(() => {
    if (!selected || !viewer || viewer.isDestroyed()) return;
    const object = groundObjects(useEngine.getState()).find(candidate => candidate.key === selected);
    const part = object && groundParts(object)[0];
    if (!part) return;
    const cartographic = Cartographic.fromDegrees(part.position.lng, part.position.lat);
    const groundHeight = viewer.scene.globe.getHeight(cartographic) ?? 0;
    const target = Cartesian3.fromDegrees(part.position.lng, part.position.lat, groundHeight + 2);
    viewer.camera.lookAt(target, new HeadingPitchRange(CesiumMath.toRadians(125), CesiumMath.toRadians(-12), 170));
    viewer.camera.lookAtTransform(Matrix4.IDENTITY);
  }, [selected, viewer]);

  if (!enabled) return null;
  return <>
    <div className="ground-placement">
      <button onClick={() => { setOpen(!open); setPending(null); }}>{ru ? 'ДОБАВИТЬ ОБЪЕКТ' : 'ADD OBJECT'}</button>
      {open && <div className="ground-placement__panel">
        <nav>{['SAM', 'RADAR'].map(value => <button key={value} className={category === value ? 'is-active' : ''}
          onClick={() => setCategory(value)}>{value === 'SAM' ? tr('AIR DEFENSE') : tr('RADARS')}</button>)}</nav>
        {Object.entries(ADVANCED_GROUND_DEPLOYMENTS).filter(([, entry]) => entry.kind === category).map(([id]) =>
          <button key={id} onClick={() => { setPending(id); setOpen(false);
            setPendingHeading(0); headingRef.current = 0; }}>{ADVANCED_GROUND_ASSETS[id].displayName}</button>)}
      </div>}
      {pending && <div className="ground-placement__hint">{ADVANCED_GROUND_ASSETS[pending].displayName}<br />
        {pending === 'PATRIOT_RADAR' && <label>{tr('RADAR HEADING')} · {pendingHeading}°
          <input type="range" min="0" max="359" value={pendingHeading}
            onChange={event => { const heading = Number(event.target.value);
              headingRef.current = heading; setPendingHeading(heading); }} /></label>}
        {ru ? 'Кликните по земле · ESC — отмена' : 'Click the ground · ESC to cancel'}</div>}
    </div>
    {item && <aside className="ground-placement__card battery-control"><strong>{assetName(item)}</strong>
      <small>{tr(item.kind === 'RADAR' ? 'RADAR' : 'SAM BATTERY')} · {item.object.id}</small>
      <dl>
        <div><dt>{tr('SYSTEM')}</dt><dd>{assetName(item)}</dd></div>
        <div><dt>{tr('SAM BATTERY')}</dt><dd>{item.object.batteryGroupId ?? item.object.id}</dd></div>
        <div><dt>{tr('STATUS')}</dt><dd>{tr(item.object.operational === false ? 'OFFLINE' : item.object.status ?? 'ACTIVE')}</dd></div>
        <div><dt>{tr(item.object.category === 'TOR_M1' ? 'TRACK' : 'TRACKS')}</dt><dd>{item.object.category === 'TOR_M1'
          ? item.object.assignedTrackId ?? tracks.find(track => track.sourceBatteryId === item.object.id)?.id ?? '—'
          : tracks.length}</dd></div>
        <div><dt>{tr('AMMO')}</dt><dd>{item.object.missilesLeft ?? '—'}</dd></div>
        <div><dt>{tr('READY')}</dt><dd>{tr(item.kind === 'RADAR' || (item.object.components?.launchers?.length > 0
          && (item.object.missilesLeft ?? 1) > 0) ? 'YES' : 'NO')}</dd></div>
      </dl>
      {item.kind === 'BATTERY' && <>
        {item.object.components.radar && item.object.radarSector < 360 && <div className="ground-placement__modes">
          <small>{tr('RADAR HEADING')} · {Math.round(item.object.radarHeading ?? 0)}°</small>
          <button onClick={() => useEngine.getState().rotateInstalledComponent(item.object.id,
            'RADAR', item.object.components.radar.id, -15)}>−15°</button>
          <button onClick={() => useEngine.getState().rotateInstalledComponent(item.object.id,
            'RADAR', item.object.components.radar.id, 15)}>+15°</button>
        </div>}
        <small>{!item.object.components.radar ? (ru ? 'Добавьте РЛС этого комплекса для сопровождения.' : 'Add this system’s radar for tracking.')
          : !item.object.components.launchers.length ? (ru ? 'Добавьте пусковую этого комплекса.' : 'Add this system’s launcher.')
            : (ru ? 'Выберите воздушную цель для пуска.' : 'Select an airborne target to launch.')}</small>
      </>}
      {item.object.category === 'TOR_M1' && <button onClick={() => onOpenTorOls?.(item.object.id)}>
        OLS / {ru ? 'ПРИЦЕЛ' : 'SIGHT'}
      </button>}
      {item.object.category === 'TOR_M1' && <button onClick={() => {
        deleteGroundPart(item.key, 'ALL'); onSelect(null);
      }}>{ru ? 'УДАЛИТЬ TOR-M1' : 'DELETE TOR-M1'}</button>}
      {item.object.category !== 'TOR_M1' && item.object.components?.radar && <button onClick={() => {
        deleteGroundPart(item.key, 'RADAR'); onSelect(null);
      }}>{ru ? 'УДАЛИТЬ РЛС' : 'DELETE RADAR'}</button>}
      {item.object.category !== 'TOR_M1' && item.object.components?.launchers?.length > 0 && <button onClick={() => {
        deleteGroundPart(item.key, 'LAUNCHER'); onSelect(null);
      }}>{ru ? 'УДАЛИТЬ ПУСКОВУЮ' : 'DELETE LAUNCHER'}</button>}
      <button onClick={() => onSelect(null)}>{ru ? 'ЗАКРЫТЬ' : 'CLOSE'}</button></aside>}
  </>;
}
