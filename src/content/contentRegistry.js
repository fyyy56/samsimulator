import { THEATER_OBJECTS } from '../data/theaterObjects.js';
import { getLightAsset } from '../data/lightModeAssets.js';
import { isCatalogRecord } from './contentSchemas.js';

const modules = import.meta.glob('./catalog/**/*.json', { eager: true, import: 'default' });

export const PACKAGED_CONTENT = Object.freeze(
  Object.values(modules).flat().filter(isCatalogRecord),
);

export const CONTENT_CATEGORIES = Object.freeze([
  'Все',
  ...new Set(PACKAGED_CONTENT.map(item => item.category)),
]);

export const getContentById = id => PACKAGED_CONTENT.find(item => item.id === id) ?? null;

export const getContentAsset = item => {
  if (!item?.assetId) return null;
  return getLightAsset(item.assetId);
};

export const POPULAR_TARGETS = THEATER_OBJECTS.map(objective => ({
  ...objective,
  type: objective.category === 'AIR BASE' ? 'АЭРОДРОМ' : objective.id === 'KREMENCHUK' ? 'ЭНЕРГЕТИКА' : objective.category,
  priorityLabel: objective.protectionPriority >= 0.9 ? 'КРИТИЧЕСКИЙ' : objective.protectionPriority >= 0.8 ? 'ВЫСОКИЙ' : 'СРЕДНИЙ',
}));
