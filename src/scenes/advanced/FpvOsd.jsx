import { formatTrackLabelData } from '../../ui/trackLabelFormatting.js';
import './fpvOsd.css';

const elapsed = seconds => {
  const time = Math.max(0, Math.floor(seconds ?? 0));
  return `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}`;
};
const number = (value, digits = 0) => Number.isFinite(value) ? value.toFixed(digits) : '—';

// Heading-up bearing/range inset, deliberately NOT a second map/scene or a sensor.
function TrackInset({ track, label, contactRef, trackOptions, onSelectTrack, disabled }) {
  const rangeKm = Math.max(1, Math.ceil((track?.distanceKm ?? 1) / 5) * 5);
  const bearing = (track?.bearingDeltaDeg ?? 0) * Math.PI / 180;
  const radius = Math.min(68, (track?.distanceKm ?? 0) / rangeKm * 68);
  return <section className="fpv-osd__map" aria-label="FPV Track mini-map">
    <header>TRACK MAP <small>HDG UP · {rangeKm} KM</small></header>
    <select aria-label="FPV network Track" value={track?.id ?? ''}
      disabled={disabled} onChange={event => onSelectTrack?.(event.target.value || null)}>
      <option value="">NO SELECTED TRACK</option>
      {trackOptions.map(option => <option key={option.id} value={option.id}>
        {option.id} · {option.displayName}</option>)}
    </select>
    <svg viewBox="0 0 180 160" role="img" aria-label={label ? `Track ${label.id}` : 'No selected Track'}>
      <defs><pattern id="fpv-grid" width="30" height="20" patternUnits="userSpaceOnUse">
        <path d="M30 0H0V20" fill="none" stroke="currentColor" strokeWidth=".5" />
      </pattern></defs>
      <path fill="url(#fpv-grid)" d="M0 0H180V160H0Z" />
      <circle cx="90" cy="80" r="68" /><circle cx="90" cy="80" r="34" />
      <path className="fpv-osd__map-cone" d="M90 80L28 50M90 80L152 50" />
      <path className="fpv-osd__own" d="M90 74L85 86L90 83L95 86Z" />
      {label && <g ref={contactRef} data-range-km={rangeKm}
        className={label.approximate ? 'fpv-osd__contact is-estimated' : 'fpv-osd__contact'}
        transform={`translate(${90 + Math.sin(bearing) * radius} ${80 - Math.cos(bearing) * radius})`}>
        <circle r="5" /><path d="M-9 0H9M0 -9V9" />
        {label.approximate && <circle className="fpv-osd__uncertainty" r={Math.min(18,
          6 + (track?.uncertaintyM ?? 20) / 45)} />}
      </g>}
    </svg>
    <footer>{label ? <><b>{label.id} {track.state === 'LOST' ? 'LAST TRACK' : label.approximate && 'EST'}</b>
      <span>{label.distanceText} · {label.altitudeText}</span><span>{label.speedText}</span></>
      : <span>NO SELECTED TRACK</span>}</footer>
  </section>;
}

export default function FpvOsd({ telemetry, visualMode, signalLost = false, attitudeRef, contactRef,
  trackOptions = [], onSelectTrack, targetCueRef, edgeCueRef }) {
  const track = telemetry.selectedTrack ?? null;
  const targetSpeedKmh = Number.isFinite(track?.speedKmh) ? track.speedKmh : null;
  const label = track ? formatTrackLabelData({
    ...track, reportedAltitudeM: track.altitudeM, reportedSpeedKmh: track.speedKmh,
  }, track.distanceKm) : null;
  return <div className="advanced-fpv-feed" style={{ '--link-loss': 1 - (telemetry.linkQuality ?? 1) }}>
    <div className="advanced-fpv-grain" aria-hidden="true" />
    <div className="fpv-osd" aria-label="Skyfall FPV HUD">
      <div className="fpv-osd__identity">SKYFALL<small>FPV · {visualMode === 'THERMAL' ? 'WHITE HOT' : 'VISUAL'}</small></div>
      <div className="fpv-osd__link"><small>LQ</small> {number((telemetry.linkQuality ?? 1) * 100)}<span aria-hidden="true"> ▂▄▆█</span></div>
      <div className="fpv-osd__speed"><small>SPD</small> {number(telemetry.speedKmh)} <small>KM/H</small></div>
      <div className="fpv-osd__target-speed">
        <div><small>TGT</small> {number(targetSpeedKmh)} <small>KM/H</small></div>
        <div><small>ΔV</small> {targetSpeedKmh == null ? '—'
          : `${telemetry.speedKmh - targetSpeedKmh >= 0 ? '+' : ''}${number(telemetry.speedKmh - targetSpeedKmh)}`} <small>KM/H</small></div>
      </div>
      <div className="fpv-osd__altitude"><div><small>V/S</small> {number(telemetry.verticalSpeedMps, 1)} <small>M/S</small></div>
        <div><small>ALT</small> {number(telemetry.altitudeM)} <small>M</small></div></div>
      <svg ref={attitudeRef} className="fpv-osd__attitude" viewBox="0 0 180 80" aria-hidden="true">
        <path d="M5 36H55L65 46H115L125 36H175M76 57H104" />
      </svg>
      <svg className="fpv-osd__reticle" viewBox="0 0 90 36" aria-hidden="true">
        <path d="M3 7H26V14H35V20H55V14H64V7H87M36 28H54" />
      </svg>
      <div className="fpv-osd__power"><div>{number(telemetry.currentAmps, 1)} <small>A</small></div>
        <div>{number(telemetry.batteryVoltageV, 1)} <small>V</small></div>
        <div className={telemetry.batteryRemaining < .2 ? 'is-low' : ''}><small>BAT</small> {number(telemetry.batteryRemaining * 100)}<small>%</small></div></div>
      <div className="fpv-osd__time"><small>FLY</small> {elapsed(telemetry.flightTimeSec)}</div>
      <div className="fpv-osd__range"><div><small>RNG</small> {track ? number(track.distanceKm * 1000) : '—'} <small>M</small></div>
        <div><small>CLOS</small> {Number.isFinite(track?.closingSpeedMps)
          ? `${track.closingSpeedMps >= 0 ? '+' : ''}${number(track.closingSpeedMps)}` : '—'} <small>M/S</small></div>
        <div><small>{telemetry.throttleAssist?.mode?.replace('_SPEED', '') ?? 'MANUAL'} {Number.isFinite(telemetry.throttleAssist?.targetSpeedMps)
          ? Math.round(telemetry.throttleAssist.targetSpeedMps * 3.6) : ''}</small></div></div>
      <div className="fpv-osd__course"><small>HDG</small> {String(Math.round(telemetry.headingDeg ?? 0)).padStart(3, '0')}°
        <small> · CAM FPV</small></div>
      <div className="fpv-osd__help">H HOLD · M MATCH · P APPROACH · X OFF · SHIFT+W/S FINE</div>
      <TrackInset track={track} label={label} contactRef={contactRef}
        trackOptions={trackOptions} onSelectTrack={onSelectTrack} disabled={signalLost} />
      {track && <div ref={targetCueRef} className={`fpv-osd__target-cue${label?.approximate ? ' is-estimated' : ''}`}
        style={{ display: 'none' }}>
        <i>◇</i><span><b>{label?.id}</b><em>{label?.distanceText}</em>
          <em>{label?.altitudeText}</em><em>{label?.speedText}</em></span>
      </div>}
      {track && <div ref={edgeCueRef} style={{ display: 'none' }} className={`fpv-osd__edge-cue is-${(track.bearingDeltaDeg ?? 0) < 0 ? 'left' : 'right'}`}>
        <i>{(track.bearingDeltaDeg ?? 0) < 0 ? '‹' : '›'}</i><span>{label?.id}<br />{label?.distanceText}</span>
      </div>}
      {signalLost && <div className="fpv-osd__signal-lost"><strong>SIGNAL LOST</strong><small>RETURNING TO COMMAND</small></div>}
    </div>
  </div>;
}
