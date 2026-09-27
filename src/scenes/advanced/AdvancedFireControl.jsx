import { useState } from 'react';
import { useEngine } from '../../store/engine.js';
import { ENGAGEMENT_STATUS, canManualLaunch, getBatteryEngagementStatus, selectBestLauncher } from '../../store/engagement.js';
import { getDistanceKm } from '../../store/geo.js';
import { localizeTechnicalTerm, localizeTrackState } from '../../data/uiLocalization.js';

// UI adapter for the same Fire Control used by COMMAND.
export default function AdvancedFireControl({ targetId, ru }) {
  const language = ru ? 'RU' : 'EN';
  const tr = term => localizeTechnicalTerm(term, language);
  const snapshot = useEngine(state => state.visualSnapshot);
  const [batteryId, setBatteryId] = useState('');
  const [feedback, setFeedback] = useState('');
  const target = snapshot.airTargets.find(item => item.id === targetId);
  const track = snapshot.tracks.find(item => item.targetId === targetId);
  const options = snapshot.batteries.filter(item => item.components.launchers.length > 0).map(battery => {
    const launcher = track ? selectBestLauncher(battery, track) : battery.components.launchers[0];
    const position = track?.reportedPosition ?? target?.position;
    return { battery, status: getBatteryEngagementStatus(battery, track, target),
      range: launcher && position ? getDistanceKm(launcher.lat, launcher.lng, position.lat, position.lng) : null };
  });
  const chosen = options.find(item => item.battery.id === batteryId)
    ?? options.find(item => item.status === ENGAGEMENT_STATUS.READY) ?? options[0];
  const launch = () => {
    if (!chosen || !canManualLaunch(chosen.battery, track)) return;
    const state = useEngine.getState();
    // The map may have selected this track already. setSelectedTrack toggles an
    // existing selection off, which used to leave fireMissile with no track.
    if (track && state.selectedTrackId !== track.id) state.setSelectedTrack(track.id);
    state.setSelectedBattery(chosen.battery.id);
    const result = state.queueEngagement(chosen.battery.id, track?.id, 'MANUAL');
    setFeedback(result ? (ru ? 'ПУСК ПРИНЯТ' : 'LAUNCH ACCEPTED') : (ru ? 'ПУСК НЕДОСТУПЕН' : 'LAUNCH UNAVAILABLE'));
  };
  return <section className="advanced-fire-control">
    <dl><div><dt>{tr('RANGE')}</dt><dd>{chosen?.range == null ? '—' : `${chosen.range.toFixed(1)} ${ru ? 'км' : 'km'}`}</dd></div>
      <div><dt>{tr('TRACK')}</dt><dd>{track ? `${track.id} · ${localizeTrackState(track.state, language)}` : tr('NO TRACK')}</dd></div>
      <div><dt>{tr('STATUS')}</dt><dd>{tr(chosen?.status ?? 'NO SAM')}</dd></div></dl>
    <label>{tr('SAM SYSTEM')} <select aria-label={tr('SAM SYSTEM')} value={chosen?.battery.id ?? ''} onChange={event => setBatteryId(event.target.value)}>
      {!options.length && <option value="">{tr('NO SAM')}</option>}
      {options.map(({ battery }) => <option key={battery.id} value={battery.id}>{battery.displayName ?? battery.name ?? battery.category} · {battery.id}</option>)}
    </select></label>
    <div className="advanced-telemetry__actions">
      <button disabled={!canManualLaunch(chosen?.battery, track)} onClick={launch}>{ru ? 'ПУСК' : 'LAUNCH'}</button></div>
    {feedback && <small role="status">{feedback}</small>}
  </section>;
}
