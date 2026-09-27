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

// Compact operator vocabulary shared by 3D cards, OLS and the missile log.
// Designations such as Patriot, 9M331 and PAC-3 MSE intentionally fall through.
const TECHNICAL_TERMS_RU = Object.freeze({
  MISSILE: 'ЗУР', 'SEARCH RADAR': 'ОБЗОРНАЯ РЛС',
  'CONTROLLABLE AIR ENTITY': 'УПРАВЛЯЕМЫЙ ОБЪЕКТ', 'AIR TARGET': 'ВОЗДУШНАЯ ЦЕЛЬ',
  RENDER: 'ОТОБРАЖЕНИЕ', LOD: 'ДЕТАЛИЗАЦИЯ', 'CAM DIST': 'ДАЛЬН. КАМ.',
  SCALE: 'МАСШТАБ', MODEL: 'МОДЕЛЬ', PATH: 'ПУТЬ',
  PHASE: 'ФАЗА', GUIDANCE: 'НАВЕДЕНИЕ', 'GUIDANCE SOURCE': 'ИСТ. НАВ.',
  TARGET: 'ЦЕЛЬ', SEEKER: 'ГСН', 'SEEKER STATE': 'СОСТ. ГСН', SOURCE: 'ИСТОЧНИК',
  SPD: 'СКОР.', ALT: 'ВЫС.', G: 'ПЕРЕГР.', RANGE: 'ДАЛЬН.',
  'CLOSING SPEED': 'СКОР. СБЛ.', 'TIME TO GO': 'ВР. ДО ВСТР.',
  INTERCEPT: 'ПЕРЕХВАТ', 'SEEKER EVIDENCE': 'СИГНАЛ ГСН',
  'POSITION UNCERTAINTY': 'ПОГР. ПОЗ.', ADVANCED: 'ПОДРОБНО',
  'LOS AZ / EL': 'ВИЗИР АЗ / УГ', 'LOS RATE': 'СКОР. ВИЗИРА',
  'AZ / EL RATE': 'СКОР. АЗ / УГ', 'HEADING ERROR': 'ОШИБКА КУРСА',
  'PITCH ERROR': 'ОШИБКА ТАНГ.', 'COMMAND H / V': 'КОМ. Г / В',
  'ACTUAL H / V': 'ФАКТ. Г / В', 'REQUIRED H / V': 'ТРЕБ. Г / В',
  'AERO / ENERGY G': 'АЭРО / ЭНЕРГ. ПЕРЕГР.',
  'AUTOPILOT ALLOWED G': 'ДОП. ПЕРЕГР. АП', 'SEEKER RANGE': 'ДАЛЬН. ГСН',
  'ACQUISITION SCORE': 'КАЧ. ЗАХВАТА', 'SOURCE RADAR': 'ИСТ. РЛС',
  VZ: 'ВЕРТ. СКОР.', FPA: 'УГОЛ ТРАЕКТ.', PITCH: 'ТАНГАЖ',
  DIST: 'ДАЛЬН.', BATTERY: 'АККУМ.', VOLTAGE: 'НАПРЯЖ.',
  CURRENT: 'ТОК', POWER: 'МОЩН.', LINK: 'СВЯЗЬ', FLIGHT: 'ПОЛЁТ',
  CONTROL: 'УПРАВЛЕНИЕ', TRACK: 'СПР', COLLISION: 'СТОЛКНОВЕНИЕ',
  CAMERA: 'КАМЕРА', 'RAW INPUT': 'СЫРОЙ ВВОД', 'SMOOTH INPUT': 'СГЛ. ВВОД',
  'DESIRED RATE': 'ЗАД. СКОР.', 'ACTUAL RATE': 'ФАКТ. СКОР.',
  MASS: 'МАССА', THROTTLE: 'ТЯГА', THRUST: 'УСИЛИЕ', DRAG: 'СОПРОТ.',
  'VELOCITY ENU': 'СКОР. ВЛВ', 'ACCEL ENU': 'УСК. ВЛВ',
  'PHYSICS POS': 'ФИЗ. ПОЗ.', 'RENDER POS': 'ВИЗ. ПОЗ.',
  'PHYSICS HPR': 'ФИЗ. ОР.', 'RENDER HPR': 'ВИЗ. ОР.',
  'PHYSICS CADENCE': 'ШАГ ФИЗ.', 'RENDER CADENCE': 'ШАГ ВИЗ.',
  INTERPOLATION: 'ИНТЕРПОЛ.', EXTRAPOLATION: 'ЭКСТРАПОЛ.',
  NETWORK_TRACK: 'СЕТЬ СПР', OWN_SEEKER: 'СВОЯ ГСН',
  REATTACK: '2-Й ЗАХОД', TERMINAL: 'ТЕРМ. НАВ.', MIDCOURSE: 'МАРШ. НАВ.',
  BOOST: 'РАЗГОН', SUSTAIN: 'МАРШ. ТЯГА', COAST: 'ИНЕРЦИЯ',
  COLD: 'ХОЛОДНЫЙ ПУСК', MANUAL_CONTROL: 'РУЧНОЕ УПРАВЛЕНИЕ',
  SECOND_PASS: 'ПОВТОРНЫЙ ПРОМАХ', KINEMATICS_OR_TRACK: 'ЭНЕРГИЯ / СПР',
  ENERGY_DEPLETED: 'НЕТ ЭНЕРГИИ', TRACK_LOST: 'ПОТЕРЯ СПР',
  INTERCEPT_LOST: 'ПЕРЕХВАТ ПОТЕРЯН', TARGET_UNAVAILABLE: 'ЦЕЛЬ НЕДОСТУПНА',
  SEARCH: 'ПОИСК ГСН', ACQUIRED: 'ЗАХВАТ', LOST: 'ПОТЕРЯ',
  REACQUIRED: 'ПЕРЕЗАХВАТ', OFF: 'ВЫКЛ.', NONE: 'НЕТ',
  MANUAL: 'РУЧНОЙ', AUTO: 'АВТО', HOLD: 'УДЕРЖ.', RELEASED: 'ОТПУЩЕНО',
  READY: 'ГОТОВ', RELOADING: 'ПЕРЕЗАР.',
  VALID: 'ГОДНО', MARGINAL: 'ПРЕДЕЛ', INVALID: 'НЕГОДНО',
  RADAR: 'РЛС', RADARS: 'РАДАРЫ', 'AIR DEFENSE': 'ПВО',
  'SAM BATTERY': 'БАТАРЕЯ ПВО', SYSTEM: 'СИСТЕМА', STATUS: 'СТАТУС',
  TRACKS: 'СПР', AMMO: 'БК', OFFLINE: 'НЕ РАБОТАЕТ', ACTIVE: 'АКТИВЕН',
  YES: 'ДА', NO: 'НЕТ', 'RADAR HEADING': 'КУРС РЛС',
  'NO TRACK': 'НЕТ СПР', 'NO SAM': 'НЕТ ЗРК', 'SAM SYSTEM': 'ЗРК',
  DAY: 'ДЕНЬ', 'LOW-LIGHT': 'СЛАБЫЙ СВЕТ', THERMAL: 'ТЕПЛОВИЗОР',
  'OLS / EO': 'ОЛС / ОЭ', 'TARGET LOCK': 'ЗАХВАТ',
  OVERLAYS: 'НАЛОЖЕНИЯ', 'GAMEPLAY OVERLAYS': 'ИГРОВЫЕ НАЛОЖЕНИЯ',
  'DEBUG / SENSORS': 'ОТЛАДКА / ДАТЧИКИ', 'ENGINEERING LAYER': 'ТЕХНИЧЕСКИЙ СЛОЙ',
  'SEEKER ENABLED': 'ГСН ВКЛЮЧЕНА', 'VISUAL DEBUG ONLY': 'ТОЛЬКО ВИЗУАЛЬНАЯ ОТЛАДКА',
  'TRACK LABELS': 'ПОДПИСИ СПР', 'TARGET VECTORS': 'ВЕКТОРЫ ЦЕЛЕЙ',
  'THERMAL TRACES': 'ТЕПЛОВЫЕ СЛЕДЫ', 'RADAR BEAMS': 'ЛУЧИ РЛС',
  'MISSILE DEBUG VECTORS': 'ВЕКТОРЫ ЗУР', 'VISUAL DEBUG CARD': 'КАРТОЧКА ОТЛАДКИ',
  'SEEKER FOV': 'ПОЛЕ ЗРЕНИЯ ГСН', 'SEEKER BORESIGHT': 'ОСЬ ГСН',
  'SEEKER TARGET LOS': 'ЛИНИЯ ГСН — ЦЕЛЬ', 'SEEKER LABELS': 'ПОДПИСИ ГСН',
  'TRACK UNCERTAINTY': 'ПОГР. СПР', 'SENSOR SOURCE': 'ИСТ. ДАТЧИКА',
  'RAW RADAR MEASUREMENTS': 'ИЗМЕРЕНИЯ РЛС', 'INTERCEPT POINT': 'ТОЧКА ПЕРЕХВАТА',
  'MISSILE AIM POINT': 'ТОЧКА НАВЕДЕНИЯ ЗУР',
  'NETWORK TRACK ESTIMATE': 'ОЦЕНКА СЕТЬ СПР', 'SEEKER ESTIMATE': 'ОЦЕНКА ГСН',
  'NETWORK OWNER / BEST SOURCE': 'СЕТЕВОЙ ИСТОЧНИК', PERFORMANCE: 'ПРОИЗВОДИТЕЛЬНОСТЬ',
  FREE: 'СВОБ.', FOLLOW: 'СЛЕДОМ', SIDE: 'СБОКУ', TACTICAL: 'ТАКТИЧ.',
  THIRD_PERSON: '3-Е ЛИЦО', FIRST_PERSON: '1-Е ЛИЦО',
  FIRE: 'ОГОНЬ', '3D SANDBOX': '3D ПОЛИГОН', 'ADVANCED 3D': '3D РЕЖИМ',
  'TRACK MAP': 'КАРТА СПР', 'HDG UP': 'КУРС СВЕРХУ',
  'NO SELECTED TRACK': 'СПР НЕ ВЫБРАНО', 'LAST TRACK': 'ПОСЛ. СПР',
  EST: 'ОЦЕНКА', 'WHITE HOT': 'БЕЛЫЙ ГОРЯЧИЙ',
  LQ: 'КАЧ. СВЯЗИ', TGT: 'ЦЕЛЬ', 'V/S': 'ВЕРТ. СКОР.',
  BAT: 'АКК.', FLY: 'ВРЕМЯ', RNG: 'ДАЛЬН.', CLOS: 'СБЛ.',
  HDG: 'КУРС', 'CAM FPV': 'КАМЕРА FPV',
  'SIGNAL LOST': 'СИГНАЛ ПОТЕРЯН', 'RETURNING TO COMMAND': 'ВОЗВРАТ К УПРАВЛЕНИЮ',
  'AUTO TRACK': 'АВТО СПР', 'SET WAYPOINT': 'ЗАДАТЬ МАРШРУТ',
  'OPEN FPV': 'ОТКРЫТЬ FPV', 'LAUNCH POINT': 'ТОЧКА ПУСКА',
  'AIM POINT': 'ТОЧКА ПОПАДАНИЯ',
  'FIRE CONTROL STATE': 'СОСТ. УПРАВЛЕНИЯ ОГНЁМ',
  THREAT: 'УГРОЗА', STATE: 'СОСТОЯНИЕ', LAUNCHER: 'ПУ', WEAPON: 'ВООРУЖ.',
  QUALITY: 'КАЧЕСТВО', EXPECTED: 'ОЖИДАЕМОЕ', WINDOW: 'ОКНО',
  RESERVATION: 'РЕЗЕРВ', INTERCEPTOR: 'ЗУР', ASSESSMENT: 'ОЦЕНКА',
  FALLBACK: 'РЕЗЕРВНЫЙ ВАРИАНТ', REASON: 'ПРИЧИНА', CANDIDATES: 'ВАРИАНТЫ',
  'AIR BASE': 'АВИАБАЗА', 'PORT AREA': 'ПОРТ',
  'INDUSTRIAL OBJECT': 'ПРОМОБЪЕКТ', 'MAJOR CITY': 'КРУПНЫЙ ГОРОД',
});

export const localizeTechnicalTerm = (term, language) => (
  isRussian(language) ? (TECHNICAL_TERMS_RU[term] ?? term) : term
);

const MISSILE_EVENT_TEXT = Object.freeze({
  INTERCEPTOR_LAUNCHED: ['ПУСК', 'LAUNCH'],
  MISSILE_PHASE: ['ФАЗА', 'PHASE'],
  MISSILE_TRACK_SOURCE: ['ИСТ. СПР', 'TRACK SOURCE'],
  MISSILE_PREDICTED_INTERCEPT: ['ПРОГНОЗ ПЕРЕХВАТА', 'PREDICTED INTERCEPT'],
  MISSILE_SOURCE: ['ИСТ. НАВ.', 'GUIDANCE SOURCE'],
  MISSILE_FALLBACK_NETWORK: ['ВОЗВРАТ К СЕТЬ СПР', 'FALLBACK NETWORK TRACK'],
  MISSILE_MISS: ['ПРОМАХ', 'MISS'],
  SECOND_ATTACK_ALLOWED: ['2-Й ЗАХОД РАЗРЕШЁН', 'SECOND ATTACK ALLOWED'],
  SECOND_ATTACK_DENIED: ['2-Й ЗАХОД НЕДОСТУПЕН', 'SECOND ATTACK DENIED'],
  STAGE_SEPARATION: ['ОТДЕЛЕНИЕ УСКОРИТЕЛЯ', 'BOOSTER SEPARATION'],
  GROUND_RISK: ['ОПАСНОСТЬ ЗЕМЛИ', 'GROUND RISK'],
  SEEKER_SEARCH: ['ПОИСК ГСН', 'SEEKER SEARCH'],
  SEEKER_ACQUIRED: ['ЗАХВАТ ГСН', 'SEEKER ACQUIRED'],
  SEEKER_LOST: ['ПОТЕРЯ ГСН', 'SEEKER LOST'],
  SEEKER_REACQUIRED: ['ПЕРЕЗАХВАТ ГСН', 'SEEKER REACQUIRED'],
  INTERCEPTOR_FAILED: ['ОТКАЗ / ПРОМАХ', 'FAILED / MISS'],
  INTERCEPTOR_SELF_DESTRUCT: ['САМОЛИКВИДАЦИЯ', 'SELF-DESTRUCT'],
  TARGET_INTERCEPTED: ['ПОРАЖЕНИЕ', 'HIT'],
});

export function localizeMissileEvent(event, language) {
  const label = MISSILE_EVENT_TEXT[event.type]?.[isRussian(language) ? 0 : 1]
    ?? event.type;
  const detail = event.type === 'MISSILE_PHASE'
    ? localizeTechnicalTerm(event.details.phase, language)
    : event.type === 'MISSILE_TRACK_SOURCE'
      ? [event.details.radarId,
        Number.isFinite(event.details.trackAgeSec)
          ? `${event.details.trackAgeSec.toFixed(1)} ${isRussian(language) ? 'с' : 's'}` : null]
        .filter(Boolean).join(' · ')
      : event.type === 'MISSILE_PREDICTED_INTERCEPT'
        ? [localizeTechnicalTerm(event.details.status, language),
          Number.isFinite(event.details.timeToGoSec)
            ? `T−${event.details.timeToGoSec.toFixed(1)} ${isRussian(language) ? 'с' : 's'}` : null]
          .filter(Boolean).join(' · ')
        : event.type === 'MISSILE_SOURCE' || event.type === 'SECOND_ATTACK_ALLOWED'
      ? [localizeTechnicalTerm(event.details.source, language), event.details.radarId]
        .filter(Boolean).join(' · ')
      : event.type === 'SECOND_ATTACK_DENIED' || event.type === 'INTERCEPTOR_FAILED'
        ? localizeTechnicalTerm(event.details.reason, language) : null;
  return detail ? `${label} · ${detail}` : label;
}
