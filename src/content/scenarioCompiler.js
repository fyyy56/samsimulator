import { getContentById } from './contentRegistry.js';
import { EDITOR_OBJECT_TYPE } from './contentSchemas.js';
import { getTheaterObject, THEATER_OBJECTS } from '../data/theaterObjects.js';
import { getDistanceKm } from '../store/geo.js';
import { SIMPLE_TARGET_TYPE } from '../data/airTargetProfiles.js';

const TYPE_MAP = Object.freeze({
  [EDITOR_OBJECT_TYPE.UAV]: SIMPLE_TARGET_TYPE.UAV,
  [EDITOR_OBJECT_TYPE.CRUISE_MISSILE]: SIMPLE_TARGET_TYPE.CRUISE_MISSILE,
  [EDITOR_OBJECT_TYPE.BALLISTIC_MISSILE]: SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE,
  [EDITOR_OBJECT_TYPE.AIRCRAFT]: SIMPLE_TARGET_TYPE.UAV,
});

const nearestObjective = position => THEATER_OBJECTS.reduce((best, candidate) => (
  getDistanceKm(position, candidate.position) < getDistanceKm(position, best.position) ? candidate : best
), THEATER_OBJECTS[0]);

export const compileUserScenario = (scenario, userAssets = []) => {
  if (!scenario) return null;
  const targets = [];
  let sequence = 1;
  scenario.objects.forEach(object => {
    const targetType = TYPE_MAP[object.objectType];
    if (!targetType) return;
    const content = getContentById(object.contentId);
    const customAsset = userAssets.find(asset => asset.id === object.assetId);
    const finalPoint = object.route.at(-1) ?? getTheaterObject('KYIV').position;
    const objective = nearestObjective(finalPoint);
    const count = Math.min(100, Math.max(1, object.count ?? 1));
    for (let member = 0; member < count; member += 1) {
      const memberOffset = (member - (count - 1) / 2) * 0.012;
      targets.push({
        id: `EDITOR-${sequence++}`,
        groupId: `EDITOR-GROUP-${object.id}`,
        groupSize: count,
        launchPattern: count > 1 ? 'GROUP' : 'SINGLE',
        type: targetType,
        modelId: object.assetId ?? content?.assetId ?? null,
        customAssetUrl: customAsset?.dataUrl ?? null,
        customAssetScale: customAsset?.scale ?? 1,
        customAssetOffsetX: customAsset?.offsetX ?? 0,
        customAssetOffsetY: customAsset?.offsetY ?? 0,
        name: object.name,
        spawnOffsetSeconds: member * Math.max(0, object.intervalSec ?? 0),
        spawnPosition: { lat: object.position.lat + memberOffset, lng: object.position.lng - memberOffset },
        destination: { ...finalPoint },
        objectiveId: objective.id,
        objectiveName: objective.name,
        route: object.route.length ? object.route.map(point => ({ ...point })) : [{ ...finalPoint }],
        speedKmh: object.speedKmh,
        altitudeM: object.altitudeM,
        heading: object.heading,
      });
    }
  });
  return {
    id: scenario.id,
    name: scenario.name,
    startTimeSeconds: 20 * 3600,
    targets,
    source: 'USER_CONTENT',
  };
};
