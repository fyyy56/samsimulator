import { useEngine } from '../../store/engine.js';
import { getDestinationPoint, getDistanceKm } from '../../store/geo.js';
import { ADVANCED_GROUND_DEPLOYMENTS, ADVANCED_GROUND_ASSETS } from '../../data/advanced3dRegistry.js';

const runExistingDeployment = (category, lat, lng, radarHeading = 0) => {
  const before = new Set(useEngine.getState().batteries.map(item => item.id));
  useEngine.getState().startDeploy(category);
  for (let step = 0; step < 8 && useEngine.getState().deployPhase; step += 1) {
    const state = useEngine.getState();
    if (state.deployPhase === 'RADAR_HEADING') {
      state.rotateRadar(radarHeading);
      state.confirmRadarHeading();
    }
    else {
      const offsetKm = state.deployPhase === 'FDC' ? 0.065
        : state.deployPhase === 'RADAR' ? 0.045
          : state.deployPhase === 'LAUNCHER' ? state.draftBattery.components.launchers.length * 0.025 : 0;
      const point = offsetKm ? getDestinationPoint(lat, lng,
        state.deployPhase === 'LAUNCHER' ? 90 : 0, offsetKm) : { lat, lng };
      state.handleMapClick(point.lat, point.lng);
    }
  }
  const template = useEngine.getState().batteries.find(item => !before.has(item.id));
  if (template) useEngine.setState(state => ({
    batteries: state.batteries.filter(item => item.id !== template.id),
  }));
  return template ?? null;
};

const addIndependentSearchRadar = (entry, assetId, lat, lng) => {
  useEngine.getState().startDeploy(entry.category);
  const id = useEngine.getState().draftBattery?.id;
  useEngine.getState().handleMapClick(lat, lng);
  useEngine.setState(state => ({
    searchRadars: state.searchRadars.map(item => item.id === id
      ? { ...item, placementAssetId: assetId, placementManaged: true } : item),
  }));
  return id ? `RADAR:${id}` : null;
};

export function placeGroundObject(assetId, lat, lng, radarHeading = 0) {
  const entry = ADVANCED_GROUND_DEPLOYMENTS[assetId];
  if (!entry || !Number.isFinite(lat) || !Number.isFinite(lng) || useEngine.getState().deployPhase) return null;
  if (entry.searchRadar) return addIndependentSearchRadar(entry, assetId, lat, lng);
  const template = runExistingDeployment(entry.category, lat, lng, radarHeading);
  if (!template) return null;
  if (entry.unifiedUnit) {
    useEngine.setState(current => ({ batteries: [...current.batteries, {
      ...template,
      batteryGroupId: template.id,
      placementManaged: true,
      placementLauncherAssetId: assetId,
      placementRadarAssetId: assetId,
    }] }));
    return `BATTERY:${template.id}`;
  }
  const state = useEngine.getState();
  const compatible = state.batteries.find(item => item.placementManaged
    && item.category === entry.category
    && (entry.kind === 'SAM'
      ? (!item.placementLauncherAssetId || item.placementLauncherAssetId === assetId)
      : !item.components.radar)
    && (() => {
      const anchor = item.components.radar ?? item.components.launchers[0];
      return anchor && getDistanceKm(anchor.lat, anchor.lng, lat, lng) <= 1;
    })());
  const groupId = compatible?.id ?? template.id;
  if (compatible) {
    useEngine.setState(current => ({ batteries: current.batteries.map(item => {
      if (item.id !== compatible.id) return item;
      if (entry.kind === 'SAM') return { ...item,
        missilesLeft: item.missilesLeft + template.missilesLeft,
        ammoCapacity: item.ammoCapacity + template.ammoCapacity,
        placementLauncherAssetId: assetId,
        components: { ...item.components,
          launchers: [...item.components.launchers, template.components.launchers[0]] } };
      return { ...item, placementRadarAssetId: assetId, radarRangeKm: template.radarRangeKm,
        radarHeading: template.radarHeading,
        components: { ...item.components, radar: template.components.radar } };
    }) }));
  } else {
    const launcher = entry.kind === 'SAM' ? template.components.launchers[0] : null;
    const radar = entry.kind === 'RADAR' ? template.components.radar : null;
    useEngine.setState(current => ({ batteries: [...current.batteries, { ...template,
      batteryGroupId: groupId, placementManaged: true,
      placementLauncherAssetId: entry.kind === 'SAM' ? assetId : null,
      placementRadarAssetId: entry.kind === 'RADAR' ? assetId : null,
      components: { ...template.components, radar, launchers: launcher ? [launcher] : [] },
    }] }));
  }
  return `BATTERY:${groupId}`;
}

export function groundObjects(state) {
  return [
    ...state.batteries.filter(object => object.placementManaged).map(object => ({
      key: `BATTERY:${object.id}`, object, kind: 'BATTERY',
    })),
    ...state.searchRadars.filter(object => object.placementManaged).map(object => ({
      key: `RADAR:${object.id}`, object, kind: 'RADAR', assetId: object.placementAssetId,
    })),
  ];
}

export function groundParts(item) {
  const { object } = item;
  if (item.kind === 'RADAR') return [{ id: 'radar', assetId: item.assetId,
    position: object.components.radar, heading: object.radarHeading ?? 0 }];
  if (object.category === 'TOR_M1') return [{ id: 'unit', assetId: 'TOR_M1',
    position: object.components.launchers[0], heading: object.components.launchers[0]?.heading ?? 0 }];
  const parts = object.components.launchers.map((position, index) => ({
    id: `launcher-${index}`, assetId: object.placementLauncherAssetId,
    position, heading: position.heading ?? 0,
  }));
  if (object.components.radar && object.placementRadarAssetId) parts.push({
    id: 'radar', assetId: object.placementRadarAssetId,
    position: object.components.radar, heading: object.radarHeading ?? 0,
  });
  return parts.filter(part => part.position && ADVANCED_GROUND_ASSETS[part.assetId]);
}

export function deleteGroundPart(key, partKind) {
  const item = groundObjects(useEngine.getState()).find(object => object.key === key);
  if (!item) return false;
  const id = item.object.id;
  if (item.kind === 'RADAR' || partKind === 'ALL') {
    const collection = item.kind === 'RADAR' ? 'searchRadars' : 'batteries';
    useEngine.setState(state => ({ [collection]: state[collection].filter(object => object.id !== id) }));
    return true;
  }
  useEngine.setState(state => ({ batteries: state.batteries.flatMap(object => {
    if (object.id !== id) return [object];
    const components = partKind === 'RADAR'
      ? { ...object.components, radar: null }
      : { ...object.components, launchers: [] };
    if (!components.radar && components.launchers.length === 0) return [];
    return [{ ...object,
      placementRadarAssetId: partKind === 'RADAR' ? null : object.placementRadarAssetId,
      placementLauncherAssetId: partKind === 'LAUNCHER' ? null : object.placementLauncherAssetId,
      components }];
  }) }));
  return true;
}
