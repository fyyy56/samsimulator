import { useViewStore } from '../../store/viewStore.js';
import { useEngine } from '../../store/engine.js';

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

const Toggle = ({ option: [key, label], overlays, toggle }) => <label>
  <input type="checkbox" checked={overlays[key]} onChange={() => toggle(key)} />{label}
</label>;

export default function AdvancedOverlayMenu() {
  const overlays = useViewStore(state => state.advancedOverlays);
  const toggle = useViewStore(state => state.toggleAdvancedOverlay);
  const seekerEnabled = useEngine(state => state.seekerEnabled);
  const setSeekerEnabled = useEngine(state => state.setSeekerEnabled);
  return <details className="advanced-overlay-menu">
    <summary>OVERLAYS</summary>
    <div className="advanced-overlay-menu__panel">
      <section>
        <b>GAMEPLAY OVERLAYS</b>
        {GAMEPLAY_OVERLAY_OPTIONS.map(option => <Toggle key={option[0]}
          option={option} overlays={overlays} toggle={toggle} />)}
      </section>
      <details className="advanced-overlay-menu__debug">
        <summary>DEBUG / SENSORS</summary>
        <label className="advanced-overlay-menu__override">
          <input type="checkbox" checked={seekerEnabled}
            onChange={event => setSeekerEnabled(event.target.checked)} />SEEKER ENABLED
        </label>
        {SENSOR_DEBUG_OVERLAY_OPTIONS.map(option => <Toggle key={option[0]}
          option={option} overlays={overlays} toggle={toggle} />)}
      </details>
      <small>VISUAL DEBUG ONLY · range bounded to gameplay activation values</small>
    </div>
  </details>;
}
