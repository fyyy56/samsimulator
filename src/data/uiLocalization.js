import { UI_LANGUAGE } from '../store/gameStore.js';

const OBJECTIVE_NAMES_RU = Object.freeze({
  Kyiv: 'Киев',
  Kharkiv: 'Харьков',
  Dnipro: 'Днепр',
  Vinnytsia: 'Винница',
  'Odesa Port': 'Порт Одесса',
  'Mykolaiv Port': 'Порт Николаев',
  'Chornomorsk Port': 'Порт Черноморск',
  'Kremenchuk Industrial Area': 'Промзона Кременчуга',
  'Starokostiantyniv Airfield': 'Аэродром Староконстантинов',
  'Myrhorod Airfield': 'Аэродром Миргород',
});

const TRACK_STATES_RU = Object.freeze({
  DETECTED: 'ОБНАРУЖЕН',
  TRACKED: 'СОПРОВОЖДАЕТСЯ',
  IDENTIFIED: 'ОПОЗНАН',
  LOST: 'ПОТЕРЯН',
});

const LAUNCHER_STATES_RU = Object.freeze({
  READY: 'ГОТОВ',
  TRACKING: 'СОПРОВОЖДЕНИЕ',
  ROTATING: 'РАЗВОРОТ',
  LAUNCHING: 'ПУСК',
  COOLDOWN: 'ПОДГОТОВКА',
  EMPTY: 'ПУСТО',
  RELOADING: 'ПЕРЕЗАРЯДКА',
});

export const isRussian = language => language === UI_LANGUAGE.RU;

export const localizeObjective = (name, language) => (
  isRussian(language) ? (OBJECTIVE_NAMES_RU[name] ?? name) : name
);

export const localizeTrackState = (state, language) => (
  isRussian(language) ? (TRACK_STATES_RU[state] ?? state) : state
);

export const localizeLauncherState = (state, language) => (
  isRussian(language) ? (LAUNCHER_STATES_RU[state] ?? state) : state
);
