export const LIGHT_TARGET_MODEL = Object.freeze({
  GERAN_2: 'GERAN_2',
  KH_101: 'KH_101',
  KALIBR: 'KALIBR',
  ISKANDER_M: 'ISKANDER_M',
});

export const LIGHT_TARGET_NAMES = Object.freeze({
  [LIGHT_TARGET_MODEL.GERAN_2]: 'Герань-2 / Shahed-136',
  [LIGHT_TARGET_MODEL.KH_101]: 'Х-101',
  [LIGHT_TARGET_MODEL.KALIBR]: 'Калибр',
  [LIGHT_TARGET_MODEL.ISKANDER_M]: 'Искандер-М',
});

export const getTargetModelDisplayName = modelId => (
  LIGHT_TARGET_NAMES[modelId] ?? 'Unknown threat'
);

