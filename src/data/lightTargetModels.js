export const LIGHT_TARGET_MODEL = Object.freeze({
  GERAN_2: 'GERAN_2',
  GERBERA: 'GERBERA',
  KH_555: 'KH_555',
  KALIBR: 'KALIBR',
  ISKANDER_M: 'ISKANDER_M',
});

export const LIGHT_TARGET_NAMES = Object.freeze({
  [LIGHT_TARGET_MODEL.GERAN_2]: 'Герань-2',
  [LIGHT_TARGET_MODEL.GERBERA]: 'Gerbera',
  [LIGHT_TARGET_MODEL.KH_555]: 'Х-555',
  [LIGHT_TARGET_MODEL.KALIBR]: 'Калибр',
  [LIGHT_TARGET_MODEL.ISKANDER_M]: 'Искандер-М',
});

// Единственный список целей для sandbox UI. Не дублируйте подписи прямо в JSX:
// так старые X-101/дубли Искандера не смогут вернуться при следующем UI pass.
export const LIGHT_TARGET_MODEL_OPTIONS = Object.freeze([
  LIGHT_TARGET_MODEL.GERAN_2,
  LIGHT_TARGET_MODEL.GERBERA,
  LIGHT_TARGET_MODEL.KH_555,
  LIGHT_TARGET_MODEL.KALIBR,
  LIGHT_TARGET_MODEL.ISKANDER_M,
].map(id => Object.freeze({ id, displayName: LIGHT_TARGET_NAMES[id] })));

export const normalizeLightTargetModelId = modelId => ({
  KH_101: LIGHT_TARGET_MODEL.KH_555,
  KH101: LIGHT_TARGET_MODEL.KH_555,
  KH555: LIGHT_TARGET_MODEL.KH_555,
  'KH-555': LIGHT_TARGET_MODEL.KH_555,
  X_555: LIGHT_TARGET_MODEL.KH_555,
  SHAHED_136: LIGHT_TARGET_MODEL.GERAN_2,
  SHAHED136: LIGHT_TARGET_MODEL.GERAN_2,
  'SHAHED-136': LIGHT_TARGET_MODEL.GERAN_2,
  'GERAN-2': LIGHT_TARGET_MODEL.GERAN_2,
  ISKANDER: LIGHT_TARGET_MODEL.ISKANDER_M,
  'ISKANDER-M': LIGHT_TARGET_MODEL.ISKANDER_M,
}[modelId] ?? modelId);

export const getTargetModelDisplayName = modelId => (
  LIGHT_TARGET_NAMES[normalizeLightTargetModelId(modelId)] ?? 'Unknown threat'
);
