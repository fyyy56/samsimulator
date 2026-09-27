import { CLOUD_TYPES, ENVIRONMENT_PRESETS, useEnvironmentSettings } from './environmentSettings.js';
import './environment.css';

const LABELS = {
  DAY: 'ДЕНЬ', SUNRISE: 'РАССВЕТ', SUNSET: 'ЗАКАТ', NIGHT: 'НОЧЬ',
  CLEAR: 'ЯСНО', THIN_SCATTERED: 'ТОНКИЕ РЕДКИЕ', CUMULUS: 'КУЧЕВЫЕ', OVERCAST: 'СПЛОШНАЯ',
};
export default function EnvironmentControls({ sandboxMode, ru }) {
  const settings = useEnvironmentSettings();
  return <details className="advanced-overlay-menu environment-controls">
    <summary>{ru ? 'АТМОСФЕРА' : 'ENVIRONMENT'}</summary>
    <div className="advanced-overlay-menu__panel">
      <label>{ru ? 'ВРЕМЯ СУТОК' : 'TIME OF DAY'}
        <select aria-label="Environment preset" value={settings.preset}
          onChange={event => settings.set('preset', event.target.value)}>
          {Object.keys(ENVIRONMENT_PRESETS).map(value => <option key={value} value={value}>
            {ru ? LABELS[value] : value}</option>)}
        </select>
      </label>
      {sandboxMode && <>
        <label>{ru ? 'ТИП ОБЛАКОВ' : 'CLOUD TYPE'}
          <select aria-label="Cloud type" value={settings.cloudType}
            onChange={event => settings.set('cloudType', event.target.value)}>
            {CLOUD_TYPES.map(value => <option key={value} value={value}>{ru ? LABELS[value] : value}</option>)}
          </select>
        </label>
        {[
          ['cover', ru ? 'ПОКРЫТИЕ' : 'CLOUD COVER', 0, 1, 0.05],
          ['altitude', ru ? 'ВЫСОТА СЛОЯ' : 'CLOUD ALTITUDE', 300, 8000, 100],
          ['density', ru ? 'ПЛОТНОСТЬ' : 'CLOUD DENSITY', 0.05, 1, 0.05],
        ].map(([key, label, min, max, step]) => <label key={key}>
          <span>{label} <output>{key === 'altitude' ? settings[key] + (ru ? ' м' : ' m')
            : Math.round(settings[key] * 100) + '%'}</output></span>
          <input aria-label={label} type="range" min={min} max={max} step={step}
            value={settings[key]} onChange={event => settings.set(key, event.target.value)} />
        </label>)}
      </>}
    </div>
  </details>;
}
