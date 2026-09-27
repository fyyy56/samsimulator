import { useViewStore } from '../../store/viewStore.js';
import { useEngine } from '../../store/engine.js';
import { useGameStore } from '../../store/gameStore.js';
import { localizeTechnicalTerm } from '../../data/uiLocalization.js';

const GAMEPLAY_OVERLAY_OPTIONS = [
  ['trackLabels', 'TRACK LABELS'],
  ['targetVectors', 'TARGET VECTORS'],
  ['thermalTraces', 'THERMAL TRACES'],
];
const SENSOR_DEBUG_OVERLAY_OPTIONS = [
  ['radarBeams', 'RADAR BEAMS'],
  ['missileVectors', 'MISSILE DEBUG VECTORS'],
  ['debug', 'VISUAL DEBUG CARD'],
  ['seekerFov', 'SEEKER FOV'],
  ['seekerBoresight', 'SEEKER BORESIGHT'],
  ['seekerTargetLos', 'SEEKER TARGET LOS'],
  ['seekerLabels', 'SEEKER LABELS'],
  ['seekerState', 'SEEKER STATE'],
  ['trackUncertainty', 'TRACK UNCERTAINTY'],
  ['sensorSource', 'SENSOR SOURCE'],
  ['rawRadarMeasurements', 'RAW RADAR MEASUREMENTS'],
  ['interceptPoint', 'INTERCEPT POINT'],
  ['missileAimPoint', 'MISSILE AIM POINT'],
  ['networkTrackEstimate', 'NETWORK TRACK ESTIMATE'],
  ['seekerEstimate', 'SEEKER ESTIMATE'],
  ['networkOwner', 'NETWORK OWNER / BEST SOURCE'],
  ['performance', 'PERFORMANCE'],
];

// Kept in persisted state for users of the pre-v1 split FOV toggles. The
// visible control is now the single profile-aware SEEKER FOV switch.
// Legacy keys: 'irSeekerFov', 'arhSeekerFov'.

const Toggle = ({ option: [key, label], overlays, toggle, tr }) => <label>
  <input type="checkbox" checked={overlays[key]} onChange={() => toggle(key)} />{tr(label)}
</label>;

export default function AdvancedOverlayMenu({ engineeringEnabled, onEngineeringChange }) {
  const language = useGameStore(state => state.language);
  const tr = term => localizeTechnicalTerm(term, language);
  const overlays = useViewStore(state => state.advancedOverlays);
  const toggle = useViewStore(state => state.toggleAdvancedOverlay);
  const seekerEnabled = useEngine(state => state.seekerEnabled);
  const setSeekerEnabled = useEngine(state => state.setSeekerEnabled);
  return <details className="advanced-overlay-menu">
    <summary>{tr('OVERLAYS')}</summary>
    <div className="advanced-overlay-menu__panel">
      <section>
        <b>{tr('GAMEPLAY OVERLAYS')}</b>
        {GAMEPLAY_OVERLAY_OPTIONS.map(option => <Toggle key={option[0]}
          option={option} overlays={overlays} toggle={toggle} tr={tr} />)}
      </section>
      <details className="advanced-overlay-menu__debug">
        <summary>{tr('DEBUG / SENSORS')}</summary>
        <label><input type="checkbox" checked={engineeringEnabled}
          onChange={event => onEngineeringChange(event.target.checked)} />{tr('ENGINEERING LAYER')}</label>
        <fieldset disabled={!engineeringEnabled}>
        <label className="advanced-overlay-menu__override">
          <input type="checkbox" checked={seekerEnabled}
            onChange={event => setSeekerEnabled(event.target.checked)} />{tr('SEEKER ENABLED')}
        </label>
        {SENSOR_DEBUG_OVERLAY_OPTIONS.map(option => <Toggle key={option[0]}
          option={option} overlays={overlays} toggle={toggle} tr={tr} />)}
        </fieldset>
      </details>
      <small>{tr('VISUAL DEBUG ONLY')}</small>
    </div>
  </details>;
}
