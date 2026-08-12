import { TRACK_STATE } from '../store/trackSystem.js';

export const TRACK_VISUALS = Object.freeze({
  [TRACK_STATE.DETECTED]: { color: '#b96962', opacity: 0.68, dashed: true },
  [TRACK_STATE.TRACKED]: { color: '#dc5f5a', opacity: 0.92, dashed: false },
  [TRACK_STATE.IDENTIFIED]: { color: '#ef6b63', opacity: 1, dashed: false },
  [TRACK_STATE.LOST]: { color: '#865d59', opacity: 0.48, dashed: true },
});

const symbolCache = new Map();

export const GLOBAL_TARGET_COLOR = '#c95750';

const getSymbolMarkup = (symbolType) => {
  if (symbolType === 'CRUISE_TARGET') {
    return `
      <path d="M16 2 C18 5 18.5 9 18.5 13 L27 18 L27 20 L18.5 18 L18 27 L20.5 29 L20.5 30 L16 29 L11.5 30 L11.5 29 L14 27 L13.5 18 L5 20 L5 18 L13.5 13 C13.5 9 14 5 16 2 Z" />
      <path d="M16 5 V27" fill="none" stroke-width="0.9" opacity="0.55" />`;
  }
  if (symbolType === 'UAV_TARGET') {
    return `
      <path d="M16 3 L29 21 L27 24 L18.5 18.5 L19 27 L16 30 L13 27 L13.5 18.5 L5 24 L3 21 Z" />
      <path d="M16 7 V26 M8 21 L16 16 L24 21" fill="none" stroke-width="0.9" opacity="0.6" />`;
  }
  if (symbolType === 'AIRCRAFT' || symbolType === 'AIR_TARGET') {
    return `
      <path d="M16 2 C18 5 18.5 9 19 13 L29 18 L29 20 L19 18.5 L18 27 L22 29 L22 31 L16 29.5 L10 31 L10 29 L14 27 L13 18.5 L3 20 L3 18 L13 13 C13.5 9 14 5 16 2 Z" />`;
  }
  return `
    <polygon points="16,3 29,16 16,29 3,16" fill="rgba(20,10,10,0.18)" />
    <circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none" />`;
};

const getSelectionMarkup = isSelected => (isSelected ? `
  <path d="M2 9 V2 H9 M23 2 H30 V9 M30 23 V30 H23 M9 30 H2 V23"
    fill="none" stroke="#ffffff" stroke-width="1.4" opacity="0.9" />` : '');

export function getTrackSymbolImage(state, isSelected, identifiedType) {
  const symbolType = state === TRACK_STATE.IDENTIFIED && identifiedType
    ? identifiedType
    : 'UNKNOWN';
  const cacheKey = `${state}:${isSelected}:${symbolType}`;
  if (symbolCache.has(cacheKey)) return symbolCache.get(cacheKey);

  const visual = TRACK_VISUALS[state] ?? TRACK_VISUALS[TRACK_STATE.DETECTED];
  const stroke = isSelected ? '#ffffff' : visual.color;
  const strokeWidth = isSelected ? 2.2 : 1.8;
  const dash = visual.dashed ? 'stroke-dasharray="4 3"' : '';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <g color="${stroke}" fill="rgba(20,10,10,0.16)" stroke="${stroke}" stroke-width="${strokeWidth}"
        stroke-linejoin="round" stroke-linecap="round" ${dash} opacity="${visual.opacity}">
        ${getSymbolMarkup(symbolType)}
      </g>
      ${getSelectionMarkup(isSelected)}
    </svg>`;
  const image = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  symbolCache.set(cacheKey, image);
  return image;
}

export function getTrackScanPulseImage() {
  const cacheKey = 'TRACK_SCAN_PULSE';
  if (symbolCache.has(cacheKey)) return symbolCache.get(cacheKey);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
      <circle cx="20" cy="20" r="15" fill="none" stroke="#ef6b63" stroke-width="1.25" opacity="0.72" />
    </svg>`;
  const image = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  symbolCache.set(cacheKey, image);
  return image;
}

export function getGlobalTargetImage() {
  const cacheKey = 'GLOBAL_TARGET';
  if (symbolCache.has(cacheKey)) return symbolCache.get(cacheKey);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <polygon points="16,3 29,16 16,29 3,16" fill="rgba(45,10,10,0.24)"
        stroke="${GLOBAL_TARGET_COLOR}" stroke-width="2" opacity="0.9" />
      <path d="M10 16 H22 M16 10 V22" stroke="${GLOBAL_TARGET_COLOR}" stroke-width="1" opacity="0.72" />
    </svg>`;
  const image = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  symbolCache.set(cacheKey, image);
  return image;
}
