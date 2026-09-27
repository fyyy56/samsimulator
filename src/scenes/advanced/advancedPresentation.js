// Renderer policy only. Persisted engineering preferences require a new,
// explicit session opt-in; opening Advanced never activates debug geometry.
import { localizeTechnicalTerm } from '../../data/uiLocalization.js';
const ordinaryKeys = new Set(['trackLabels', 'targetVectors', 'thermalTraces']);
export function effectiveAdvancedOverlays(saved, engineeringEnabled) {
  return Object.fromEntries(Object.entries(saved).map(([key, value]) =>
    [key, Boolean(value && (engineeringEnabled || ordinaryKeys.has(key)))]));
}

export function compactWorldLabel({ name, id, selected, distanceM, speedMps, rangeKm, altitudeM, seeker, phase, language = 'EN' }) {
  const ru = language === 'RU';
  const shortName = name?.replace(/\s*\([^)]*\)$/, '');
  if (distanceM > (selected ? 80000 : 18000)) return '';
  if (!selected) return distanceM < 6000 ? id : '';
  if (distanceM > 12000) return shortName;
  return [id ? `${id} · ${shortName}` : shortName, [Number.isFinite(rangeKm) ? `${ru ? 'ДАЛЬН.' : 'RNG'} ${rangeKm.toFixed(1)} ${ru ? 'км' : 'km'}` : null,
    Number.isFinite(speedMps) ? `${Math.round(speedMps)} ${ru ? 'м/с' : 'm/s'}` : null].filter(Boolean).join(' · '),
  Number.isFinite(altitudeM) ? `${ru ? 'ВЫС.' : 'ALT'} ${Math.round(altitudeM)} ${ru ? 'м' : 'm'}` : null,
  seeker ? `${seeker.seekerType} · ${localizeTechnicalTerm(seeker.state, language)}`
    : localizeTechnicalTerm(phase, language)].filter(Boolean).join('\n');
}

// Priority is established by the caller: selected objects reserve space first.
export function createLabelLayout(width, height) {
  const occupied = [];
  return (point, text) => {
    if (!point || !text || point.x < 24 || point.x > width - 24
      || point.y < 64 || point.y > height - 68) return false;
    const lines = text.split('\n');
    const w = Math.min(240, Math.max(...lines.map(line => line.length)) * 6 + 16);
    const h = lines.length * 14 + 12;
    const box = { x: point.x - w / 2, y: point.y - h - 28, w, h };
    if (occupied.some(b => box.x < b.x + b.w && box.x + box.w > b.x
      && box.y < b.y + b.h && box.y + box.h > b.y)) return false;
    occupied.push(box);
    return true;
  };
}
