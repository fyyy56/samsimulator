import { getInterceptorSpec } from '../data/interceptors.js';
import { useEngine, SYSTEM_CATALOG } from '../store/engine';
import {
  ENGAGEMENT_STATUS,
  getBatteryEngagementStatus,
  selectBestLauncher,
} from '../store/engagement.js';
import { getDistanceKm } from '../store/geo.js';
import { TRACK_STATE } from '../store/trackSystem.js';

const formatTime = (totalSeconds) => {
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return [hours, minutes, seconds].map(value => value.toString().padStart(2, '0')).join(':');
};

const formatEventType = type => type.replaceAll('_', ' ');

const formatDistance = (distanceKm) => {
  if (distanceKm === null) return '—';
  return distanceKm < 100 ? `${distanceKm.toFixed(1)} km` : `${Math.round(distanceKm)} km`;
};

const getLauncherDistance = (battery, track) => {
  const launcher = selectBestLauncher(battery, track);
  if (!launcher) return null;
  return getDistanceKm(
    track.reportedPosition.lat,
    track.reportedPosition.lng,
    launcher.lat,
    launcher.lng,
  );
};

const getEventClass = (type) => {
  if (type.includes('INTERCEPTED')) return 'is-success';
  if (type.includes('FAILED') || type.includes('ESCAPED')) return 'is-hostile';
  if (type.includes('LAUNCHED')) return 'is-friendly';
  return '';
};

const getTrackStateClass = state => ({
  [TRACK_STATE.DETECTED]: 'is-warning',
  [TRACK_STATE.TRACKED]: 'is-hostile',
  [TRACK_STATE.IDENTIFIED]: 'is-accent',
  [TRACK_STATE.LOST]: 'is-muted',
}[state] ?? '');

const getEngagementStatusClass = status => ({
  [ENGAGEMENT_STATUS.READY]: 'is-success',
  [ENGAGEMENT_STATUS.OUT_OF_RANGE]: 'is-warning',
  [ENGAGEMENT_STATUS.NO_TRACK]: 'is-muted',
  [ENGAGEMENT_STATUS.NO_AMMO]: 'is-hostile',
}[status] ?? '');

function DataRow({ label, value, tone = '', mono = true }) {
  return (
    <div className="data-row">
      <span className="data-row__label">{label}</span>
      <span className={`data-row__value ${mono ? 'u-mono' : ''} ${tone}`}>{value}</span>
    </div>
  );
}

export default function HUD() {
  const {
    tracks, selectedTrackId, fireMissile, simulationTime, timeScale, setTimeScale,
    batteries, startDeploy, deployPhase, draftBattery,
    buildMenuOpen, selectedCategory, toggleBuildMenu, setCategory, rotateRadar,
    confirmRadarHeading, selectedBatteryId, setSelectedBattery, activeScenario, events,
  } = useEngine();

  const activeTrack = tracks.find(track => track.id === selectedTrackId);
  const selectedBattery = batteries.find(battery => battery.id === selectedBatteryId);
  const selectedBatteryStatus = selectedBattery && activeTrack
    ? getBatteryEngagementStatus(selectedBattery, activeTrack)
    : null;
  const trackAgeSeconds = activeTrack
    ? Math.max(0, simulationTime - activeTrack.lastUpdateTime)
    : 0;
  const trackCounts = {
    detected: tracks.filter(track => track.state === TRACK_STATE.DETECTED).length,
    tracked: tracks.filter(track => (
      track.state === TRACK_STATE.TRACKED || track.state === TRACK_STATE.IDENTIFIED
    )).length,
    lost: tracks.filter(track => track.state === TRACK_STATE.LOST).length,
  };
  const recentEvents = events.slice(-4).reverse();

  return (
    <div className="hud" id="dronefall-hud">
      <header className="hud-brand" id="hud-brand">
        <div className="hud-brand__mark" aria-hidden="true" />
        <div>
          <div className="hud-brand__name">DroneFall</div>
          <div className="hud-brand__context">{activeScenario.name} · Tactical airspace</div>
        </div>
      </header>

      <aside className="hud-rail hud-rail--left" id="airspace-panel">
        <section className="hud-section">
          <div className="hud-section__heading">Airspace</div>
          <div className="airspace-summary">
            <div><span className="u-mono is-hostile">{trackCounts.tracked}</span><small>Tracked</small></div>
            <div><span className="u-mono is-warning">{trackCounts.detected}</span><small>Detected</small></div>
            <div><span className="u-mono is-muted">{trackCounts.lost}</span><small>Lost</small></div>
          </div>
        </section>

        <section className="hud-section" id="defense-network">
          <div className="hud-section__heading">Air defence network</div>
          {batteries.length === 0 && <div className="hud-empty">No active systems</div>}
          <div className="network-list">
            {batteries.map(battery => (
              <div
                key={battery.id}
                className={`network-row ${selectedBatteryId === battery.id ? 'is-selected' : ''}`}
              >
                <div>
                  <span className="network-row__id u-mono">{battery.id}</span>
                  <small>{battery.type}</small>
                </div>
                <span className={`network-row__status ${battery.missilesLeft > 0 ? 'is-success' : 'is-hostile'}`}>
                  {battery.missilesLeft > 0 ? `READY ${battery.missilesLeft}` : 'EMPTY'}
                </span>
              </div>
            ))}
          </div>
        </section>

        {recentEvents.length > 0 && (
          <section className="hud-section hud-section--events" id="event-feed">
            <div className="hud-section__heading">Recent events</div>
            {recentEvents.map(event => (
              <div key={event.id} className="event-row">
                <time className="u-mono">{formatTime(event.simulationTime)}</time>
                <span className={getEventClass(event.type)}>
                  {formatEventType(event.type)}
                  {event.details.reason ? ` · ${event.details.reason.replaceAll('_', ' ')}` : ''}
                </span>
              </div>
            ))}
          </section>
        )}
      </aside>

      <aside className="hud-context" id="hud-context-panel">
        {deployPhase && <DeploymentPanel
          deployPhase={deployPhase}
          draftBattery={draftBattery}
          rotateRadar={rotateRadar}
          confirmRadarHeading={confirmRadarHeading}
        />}

        {activeTrack && !deployPhase && (
          <section className="target-lock" id="target-lock">
            <div className="target-lock__header">
              <div>
                <div className="hud-eyebrow">Target lock</div>
                <div className="target-lock__id u-mono">{activeTrack.id}</div>
              </div>
              <div className={`status-pill ${getTrackStateClass(activeTrack.state)}`}>
                {activeTrack.state}
              </div>
            </div>
            <div className="target-lock__class">
              {activeTrack.identifiedType ?? 'UNKNOWN'}
              <span className="u-mono">Q {Math.round(activeTrack.trackQuality * 100)}%</span>
            </div>

            <div className="target-lock__data">
              <DataRow label="Altitude" value={`${Math.round(activeTrack.reportedPosition.alt)} m`} />
              {activeTrack.reportedSpeedKmh !== null && (
                <DataRow label="Speed" value={`${Math.round(activeTrack.reportedSpeedKmh)} km/h`} />
              )}
              {activeTrack.reportedHeading !== null && (
                <DataRow label="Heading" value={`${Math.round(activeTrack.reportedHeading)}°`} />
              )}
              <DataRow label="Last update" value={`${trackAgeSeconds.toFixed(1)} s`} tone="is-muted" />
              <DataRow label="Sensor" value={activeTrack.sourceBatteryId} tone="is-muted" />
            </div>

            <div className="hud-section__heading target-lock__engagement">Engagement</div>
            <div className="engagement-list">
              {batteries.length === 0 && <div className="hud-empty">No deployed batteries</div>}
              {batteries.map(battery => {
                const status = getBatteryEngagementStatus(battery, activeTrack);
                const isReady = status === ENGAGEMENT_STATUS.READY;
                const isSelected = selectedBatteryId === battery.id;
                const launcherDistance = getLauncherDistance(battery, activeTrack);
                return (
                  <button
                    key={battery.id}
                    disabled={!isReady}
                    onClick={() => setSelectedBattery(battery.id)}
                    className={`engagement-row ${isSelected ? 'is-selected' : ''}`}
                  >
                    <span className="u-mono">{battery.id}</span>
                    <span className={getEngagementStatusClass(status)}>{status}</span>
                    <span className="engagement-row__distance u-mono">
                      {formatDistance(launcherDistance)}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              disabled={selectedBatteryStatus !== ENGAGEMENT_STATUS.READY}
              onClick={fireMissile}
              className="engage-button"
            >
              {selectedBattery ? `Engage · ${selectedBattery.id}` : 'Select battery'}
            </button>
          </section>
        )}
      </aside>

      <div className="c2-control" id="c2-menu">
        {buildMenuOpen && !deployPhase && (
          <div className="c2-menu">
            <div className="hud-eyebrow">Deploy system</div>
            <div className="c2-menu__tabs">
              {['SHORT', 'MEDIUM', 'LONG'].map(category => (
                <button
                  key={category}
                  onClick={() => setCategory(category)}
                  className={selectedCategory === category ? 'is-active' : ''}
                >
                  {category}
                </button>
              ))}
            </div>
            {selectedCategory && (
              <div className="c2-system-detail">
                <strong>{SYSTEM_CATALOG[selectedCategory].type}</strong>
                <DataRow label="Radar" value={`${SYSTEM_CATALOG[selectedCategory].radarRangeKm} km`} />
                <DataRow label="Sector" value={`${SYSTEM_CATALOG[selectedCategory].radarSector}°`} />
                <DataRow
                  label="Speed"
                  value={`${getInterceptorSpec(SYSTEM_CATALOG[selectedCategory].interceptorSpecId).publicDisplay.maxSpeedKmh} km/h`}
                />
                <button className="c2-deploy-button" onClick={() => startDeploy(selectedCategory)}>
                  Deploy system
                </button>
              </div>
            )}
          </div>
        )}
        <button
          className="c2-toggle"
          onClick={toggleBuildMenu}
          disabled={deployPhase !== null}
          title="Command and deployment"
        >
          {buildMenuOpen ? 'Close' : 'Command'}
        </button>
      </div>

      <footer className="sim-controls" id="simulation-controls">
        <div className="sim-controls__clock">
          <small>Simulation</small>
          <span className="u-mono">{formatTime(simulationTime)} <i>Z</i></span>
        </div>
        <div className="sim-controls__speeds">
          {[0, 1, 2, 5, 10, 20].map(speed => (
            <button
              key={speed}
              onClick={() => setTimeScale(speed)}
              className={timeScale === speed ? 'is-active' : ''}
            >
              {speed === 0 ? 'Pause' : `${speed}x`}
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}

function DeploymentPanel({ deployPhase, draftBattery, rotateRadar, confirmRadarHeading }) {
  if (deployPhase === 'RADAR_HEADING') {
    return (
      <section className="deployment-panel" id="deployment-panel">
        <div className="hud-eyebrow">Radar alignment</div>
        <h3>Sector heading <span className="u-mono">{draftBattery.radarHeading}°</span></h3>
        <p>Set the centreline for the radar search sector.</p>
        <div className="deployment-panel__actions">
          <button onClick={() => rotateRadar(-15)}>−15°</button>
          <button onClick={() => rotateRadar(15)}>+15°</button>
        </div>
        <button className="deployment-panel__confirm" onClick={confirmRadarHeading}>Confirm direction</button>
      </section>
    );
  }

  const instruction = {
    FDC: 'Place command post',
    RADAR: 'Place radar sensor',
    LAUNCHER: `Place launcher ${draftBattery.components.launchers.length + 1} of 2`,
  }[deployPhase];
  return (
    <section className="deployment-panel" id="deployment-panel">
      <div className="hud-eyebrow">Deployment mode</div>
      <h3 className="u-mono">{draftBattery.id}</h3>
      <p>{instruction}</p>
      <div className="deployment-panel__hint">Click a position on the map</div>
    </section>
  );
}
