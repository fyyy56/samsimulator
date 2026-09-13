import { useState } from 'react';
import { getInterceptorSpec } from '../data/interceptors.js';
import { getGunSystemSpec } from '../data/gunSystems.js';
import { DEPLOYABLE_SYSTEM_IDS, SEARCH_RADAR_PROFILE_IDS, useEngine, SYSTEM_CATALOG } from '../store/engine';
import { getSearchRadarProfile } from '../data/searchRadarProfiles.js';
import {
  ENGAGEMENT_STATUS,
  getBatteryEngagementStatus,
  selectBestLauncher,
} from '../store/engagement.js';
import { getDistanceKm } from '../store/geo.js';
import { TRACK_STATE } from '../store/trackSystem.js';
import { SIMPLE_MAP_THEME, useViewStore } from '../store/viewStore.js';
import { getTargetDisplayName } from '../data/lightModeAssets.js';
import { UI_LANGUAGE, useGameStore } from '../store/gameStore.js';
import { selectActiveUiPreset, useContentStore } from '../store/contentStore.js';
import { useDesignSurface } from '../store/designStore.js';
import { getAltitudeBand } from '../data/airTargetProfiles.js';
import {
  BATTERY_CONTROL_MODE,
} from '../store/autoDefense.js';
import {
  AUTO_ENGAGEMENT_DECISION,
} from '../store/autoEngagementPlanner.js';
import {
  isRussian,
  localizeLauncherState,
  localizeObjective,
  localizeTrackState,
} from '../data/uiLocalization.js';

const formatTime = (totalSeconds) => {
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return [hours, minutes, seconds].map(value => value.toString().padStart(2, '0')).join(':');
};

const formatEventType = type => type.replaceAll('_', ' ');

const formatAutoDecision = (decision, ru) => ({
  [AUTO_ENGAGEMENT_DECISION.ENGAGE]: ru ? 'Решение на пуск' : 'Ready to engage',
  [AUTO_ENGAGEMENT_DECISION.HOLD_OPTIMAL_WINDOW]: ru ? 'Ожидание оптимального момента' : 'Waiting for optimal moment',
  [AUTO_ENGAGEMENT_DECISION.DEFER_TO_BETTER_LAYER]: ru ? 'Ожидание нижнего эшелона' : 'Waiting for lower layer',
  [AUTO_ENGAGEMENT_DECISION.HOLD_LOW_CONFIDENCE]: ru ? 'Низкая вероятность перехвата' : 'Low intercept probability',
  [AUTO_ENGAGEMENT_DECISION.NO_SOLUTION]: ru ? 'Решение отсутствует' : 'No intercept solution',
}[decision] ?? decision);

const formatDistance = (distanceKm) => {
  if (distanceKm === null) return '—';
  return distanceKm < 100 ? `${distanceKm.toFixed(1)} km` : `${Math.round(distanceKm)} km`;
};

const getTargetGameName = (type, target, ru = false) => {
  if (target) return getTargetDisplayName(target);
  if (type === 'CRUISE_TARGET') return ru ? 'Крылатая ракета' : 'Cruise missile';
  if (type === 'BALLISTIC_PLACEHOLDER' || type === 'BALLISTIC_TARGET') return ru ? 'Баллистическая цель' : 'Ballistic threat';
  if (type === 'UAV_TARGET') return ru ? 'Ударный БПЛА' : 'Attack UAV';
  return ru ? 'Неизвестная воздушная цель' : 'Unknown air contact';
};

const getTrackKnowledgeName = (track, target, ru = false) => {
  if (track.state === TRACK_STATE.IDENTIFIED) {
    return getTargetGameName(track.identifiedType, target, ru);
  }
  if (track.state === TRACK_STATE.TRACKED) {
    return ({
      UAV: ru ? 'БПЛА' : 'UAV',
      CRUISE_MISSILE: ru ? 'Крылатая ракета' : 'Cruise missile',
      BALLISTIC_MISSILE: ru ? 'Баллистическая цель' : 'Ballistic target',
      AIR_TARGET: ru ? 'Воздушная цель' : 'Air target',
    }[track.classifiedType] ?? (ru ? 'Воздушная цель' : 'Air target'));
  }
  return ru ? 'НЕИЗВЕСТНАЯ ВОЗДУШНАЯ ЦЕЛЬ' : 'UNKNOWN AIR TARGET';
};

const localizeScenarioName = (name, ru) => (
  ru ? ({ 'BLACK SEA ATTACK': 'ЧЁРНОМОРСКАЯ АТАКА', 'SANDBOX RANGE': 'ИСПЫТАТЕЛЬНЫЙ ПОЛИГОН' }[name] ?? name) : name
);

const getTargetEtaSeconds = (target) => {
  if (target?.ballisticPhysics?.enabled
    && Number.isFinite(target.ballisticPhysics.timeToGroundSec)
    && target.ballisticPhysics.timeToGroundSec > 0) {
    return target.ballisticPhysics.timeToGroundSec;
  }
  if (!target?.route?.length || !target.speedKmh) return Number.POSITIVE_INFINITY;
  const remainingWaypoints = target.route.slice(target.waypointIndex);
  if (remainingWaypoints.length === 0) return 0;
  let distanceKm = getDistanceKm(
    target.position.lat,
    target.position.lng,
    remainingWaypoints[0].lat,
    remainingWaypoints[0].lng,
  );
  for (let index = 1; index < remainingWaypoints.length; index += 1) {
    distanceKm += getDistanceKm(
      remainingWaypoints[index - 1].lat,
      remainingWaypoints[index - 1].lng,
      remainingWaypoints[index].lat,
      remainingWaypoints[index].lng,
    );
  }
  return distanceKm / target.speedKmh * 3600;
};

const formatEtaSeconds = (seconds) => {
  if (!Number.isFinite(seconds)) return '—';
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
};

const formatEta = target => formatEtaSeconds(getTargetEtaSeconds(target));

const getLauncherDistance = (battery, track) => {
  const launcher = selectBestLauncher(battery, track) ?? battery.components.launchers[0];
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
  [ENGAGEMENT_STATUS.NO_INTERCEPT_SOLUTION]: 'is-hostile',
  [ENGAGEMENT_STATUS.TOO_LATE]: 'is-hostile',
}[status] ?? '');

const localizeEngagementStatus = (status, language) => {
  if (!isRussian(language)) return status;
  return ({
    [ENGAGEMENT_STATUS.READY]: 'ГОТОВ',
    [ENGAGEMENT_STATUS.OUT_OF_RANGE]: 'ВНЕ ЗОНЫ',
    [ENGAGEMENT_STATUS.NO_TRACK]: 'НЕТ СОПРОВОЖДЕНИЯ',
    [ENGAGEMENT_STATUS.NO_AMMO]: 'БЕЗ БОЕЗАПАСА',
    [ENGAGEMENT_STATUS.NO_INTERCEPT_SOLUTION]: 'НЕТ РЕШЕНИЯ',
    [ENGAGEMENT_STATUS.TOO_LATE]: 'СЛИШКОМ ПОЗДНО',
  }[status] ?? status);
};

function DataRow({ label, value, tone = '', mono = true }) {
  return (
    <div className="data-row">
      <span className="data-row__label">{label}</span>
      <span className={`data-row__value ${mono ? 'u-mono' : ''} ${tone}`}>{value}</span>
    </div>
  );
}

function AttackPriorities({ targets, language, style }) {
  const objectives = [...targets.reduce((groups, target) => {
    if (!target.objectiveName) return groups;
    const etaSeconds = getTargetEtaSeconds(target);
    const current = groups.get(target.objectiveName);
    groups.set(target.objectiveName, {
      name: target.objectiveName,
      count: (current?.count ?? 0) + 1,
      etaSeconds: Math.min(current?.etaSeconds ?? Number.POSITIVE_INFINITY, etaSeconds),
    });
    return groups;
  }, new Map()).values()]
    .sort((first, second) => first.etaSeconds - second.etaSeconds)
    .slice(0, 3);

  if (objectives.length === 0) return null;
  const ru = isRussian(language);
  return (
    <aside className="attack-priorities" data-design-id="game-targets" data-design-name="Основные цели" data-design-dynamic-text="true" style={style} aria-label={ru ? 'Основные цели атаки' : 'Primary attack objectives'}>
      <div className="attack-priorities__title">{ru ? 'Цели удара' : 'Attack objectives'}</div>
      {objectives.map((objective, index) => (
        <div className="attack-priorities__row" key={objective.name}>
          <span>{index + 1}</span>
          <strong>{localizeObjective(objective.name, language)}</strong>
          <small>ETA {formatEtaSeconds(objective.etaSeconds)} · {objective.count}</small>
        </div>
      ))}
    </aside>
  );
}

export default function HUD({ simpleMode = false }) {
  const [technicalDetailsOpen, setTechnicalDetailsOpen] = useState(false);
  const commandTheme = useViewStore(state => state.simpleMapTheme === SIMPLE_MAP_THEME.LIGHT);
  const debugOverlayVisible = useViewStore(state => state.layers.debugOverlay);
  const commandMode = simpleMode || commandTheme;
  const language = useGameStore(state => state.language);
  const ru = language === UI_LANGUAGE.RU;
  const brandDesign = useDesignSurface('game-brand');
  const targetsDesign = useDesignSurface('game-targets');
  const fireModeDesign = useDesignSurface('game-fire-mode');
  const infoDesign = useDesignSurface('game-information');
  const commandDesign = useDesignSurface('game-command');
  const timeDesign = useDesignSurface('game-time-controls');
  const activeUiPreset = useContentStore(selectActiveUiPreset);
  const customUiLayout = activeUiPreset?.id !== 'default' ? activeUiPreset.layout : null;
  const panelStyle = panelId => {
    const panel = customUiLayout?.[panelId];
    if (!panel) return undefined;
    return { left: panel.x, top: panel.y, right: 'auto', bottom: 'auto', width: panel.width, minHeight: panel.height, opacity: panel.opacity };
  };
  const {
    tracks,
    simulationTime,
    batteries,
    activeScenario,
    events,
    airTargets,
    searchRadars,
    sensorContacts,
  } = useEngine(state => state.visualSnapshot);
  const selectedTrackId = useEngine(state => state.selectedTrackId);
  const selectedBatteryId = useEngine(state => state.selectedBatteryId);
  const selectedSearchRadarId = useEngine(state => state.selectedSearchRadarId);
  const selectedSearchRadarOperational = useEngine(state => state.searchRadars
    .find(radar => radar.id === state.selectedSearchRadarId)?.operational ?? null);
  const timeScale = useEngine(state => state.timeScale);
  const deployPhase = useEngine(state => state.deployPhase);
  const draftBattery = useEngine(state => state.draftBattery);
  const buildMenuOpen = useEngine(state => state.buildMenuOpen);
  const selectedCategory = useEngine(state => state.selectedCategory);
  const globalControlMode = useEngine(state => state.globalControlMode);
  const fireMissile = useEngine(state => state.fireMissile);
  const setTimeScale = useEngine(state => state.setTimeScale);
  const startDeploy = useEngine(state => state.startDeploy);
  const toggleBuildMenu = useEngine(state => state.toggleBuildMenu);
  const setCategory = useEngine(state => state.setCategory);
  const rotateRadar = useEngine(state => state.rotateRadar);
  const confirmRadarHeading = useEngine(state => state.confirmRadarHeading);
  const setSelectedBattery = useEngine(state => state.setSelectedBattery);
  const toggleSearchRadarOperational = useEngine(state => state.toggleSearchRadarOperational);
  const setAllBatteriesControlMode = useEngine(state => state.setAllBatteriesControlMode);
  const launchSkyfallFromMwg = useEngine(state => state.launchSkyfallFromMwg);

  const activeTrack = tracks.find(track => track.id === selectedTrackId);
  const selectedBattery = batteries.find(battery => battery.id === selectedBatteryId) ?? null;
  const selectedMwg = selectedBattery?.category === 'GAZ' ? selectedBattery : null;
  const selectedSearchRadarSnapshot = searchRadars
    .find(radar => radar.id === selectedSearchRadarId) ?? null;
  const selectedSearchRadar = selectedSearchRadarSnapshot ? {
    ...selectedSearchRadarSnapshot,
    operational: selectedSearchRadarOperational ?? selectedSearchRadarSnapshot.operational,
  } : null;
  const activeTarget = airTargets.find(target => target.id === activeTrack?.targetId);
  const engagementCoordination = activeTarget?.engagementCoordination ?? null;
  const batteryOptions = activeTrack ? batteries
    .filter(battery => battery.controlMode !== BATTERY_CONTROL_MODE.HOLD)
    .map(battery => ({
    battery,
    status: getBatteryEngagementStatus(battery, activeTrack, activeTarget),
    distanceKm: getLauncherDistance(battery, activeTrack),
  })) : [];
  const readyBatteries = batteryOptions.filter(option => option.status === ENGAGEMENT_STATUS.READY);
  const coordinatedBattery = engagementCoordination?.assignedBatteryId
    ? batteryOptions.find(option => option.battery.id === engagementCoordination.assignedBatteryId)
    : null;
  const recommendedBattery = coordinatedBattery ?? (readyBatteries.length > 0 ? readyBatteries : batteryOptions)
    .sort((first, second) => (first.distanceKm ?? Infinity) - (second.distanceKm ?? Infinity))[0] ?? null;
  const autoPlanningBattery = activeTrack
    ? batteries.find(battery => (
      battery.recommendedTrackId === activeTrack.id && battery.autoDecision
    ))
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

  const launchRecommended = () => {
    if (!recommendedBattery || recommendedBattery.status !== ENGAGEMENT_STATUS.READY) return;
    setSelectedBattery(recommendedBattery.battery.id);
    fireMissile();
  };

  return (
    <div className="hud" id="sam-simulator-hud">
      {!simpleMode && (
        <header className="hud-brand" id="hud-brand" data-design-id="game-brand" data-design-name="Название игры" style={{ ...(panelStyle('hud') ?? {}), ...(brandDesign ?? {}) }}>
          <div className="hud-brand__mark" aria-hidden="true" />
          <div>
            <div className="hud-brand__name">SAM Simulator</div>
            <div className="hud-brand__context">{localizeScenarioName(activeScenario.name, ru)} · {ru ? 'Тактическая воздушная обстановка' : 'Tactical airspace'}</div>
          </div>
        </header>
      )}

      {commandMode && <AttackPriorities targets={airTargets} language={language} style={{ ...(panelStyle('targets') ?? {}), ...(targetsDesign ?? {}) }} />}

      {commandMode && (
        <section className="global-fire-control" data-design-id="game-fire-mode" data-design-name="Режим огня" style={fireModeDesign} aria-label={ru ? 'Общий режим огня ПВО' : 'Global air-defence fire mode'}>
          <span>{ru ? 'РЕЖИМ ОГНЯ' : 'FIRE MODE'}</span>
          <div role="group">
            {[
              [BATTERY_CONTROL_MODE.AUTO, ru ? 'АВТО' : 'AUTO'],
              [BATTERY_CONTROL_MODE.ASSIST, ru ? 'СОВЕТ' : 'ASSIST'],
              [BATTERY_CONTROL_MODE.MANUAL, ru ? 'РУЧН' : 'MANUAL'],
              [BATTERY_CONTROL_MODE.HOLD, ru ? 'СТОП' : 'HOLD'],
            ].map(([mode, label]) => (
              <button
                key={mode}
                className={`fire-mode-button fire-mode-button--${mode.toLowerCase()} ${globalControlMode === mode ? 'is-active' : ''}`}
                onClick={() => setAllBatteriesControlMode(mode)}
                title={ru ? ({ AUTO: 'Автоматическое ведение огня', ASSIST: 'Рекомендация оператора', MANUAL: 'Ручное ведение огня', HOLD: 'Огонь запрещён' }[mode]) : mode}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}

      {!commandMode && <aside className="hud-rail hud-rail--left" id="airspace-panel">
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
                  <small>{battery.displayName ?? SYSTEM_CATALOG[battery.category]?.displayName ?? battery.type}</small>
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
      </aside>}

      {(deployPhase || activeTrack || selectedSearchRadar || selectedBattery) && <aside className="hud-context" id="hud-context-panel" data-design-id="game-information" data-design-name="Информационная панель" data-design-dynamic-text="true" style={{ ...(panelStyle('info') ?? {}), ...(infoDesign ?? {}) }}>
        {deployPhase && <DeploymentPanel
          deployPhase={deployPhase}
          draftBattery={draftBattery}
          rotateRadar={rotateRadar}
          confirmRadarHeading={confirmRadarHeading}
          language={language}
        />}

        {activeTrack && !deployPhase && (
          <section className="target-lock" id="target-lock">
            <div className="target-lock__header">
              <div>
                <div className="hud-eyebrow">{commandMode ? (ru ? 'Воздушная угроза' : 'Inbound threat') : 'Target lock'}</div>
                <div className={`target-lock__id ${commandMode ? '' : 'u-mono'}`}>
                  {commandMode ? getTrackKnowledgeName(activeTrack, activeTarget, ru) : activeTrack.id}
                </div>
              </div>
              <div className={`status-pill ${getTrackStateClass(activeTrack.state)}`}>
                {commandMode ? localizeTrackState(activeTrack.state, language) : activeTrack.state}
              </div>
            </div>
            {commandMode ? (
              <div className="target-lock__mission">
                <DataRow label={ru ? 'Направление' : 'Direction'} value={activeTarget?.objectiveName ? localizeObjective(activeTarget.objectiveName, language) : (ru ? 'Уточняется' : 'Being assessed')} mono={false} />
                <DataRow label="ETA" value={formatEta(activeTarget)} tone="is-warning" />
                <DataRow
                  label={ru ? 'До зоны ПВО' : 'To effective zone'}
                  value={activeTarget?.defenseAssessment?.distanceToNearestEffectiveZoneKm != null
                    ? `${activeTarget.defenseAssessment.distanceToNearestEffectiveZoneKm.toFixed(1)} км`
                    : (ru ? 'Маршрут вне зон' : 'Route outside zones')}
                />
                <DataRow
                  label={ru ? 'Высота' : 'Altitude'}
                  value={`${getAltitudeBand(activeTrack.reportedPosition.alt)} · ${Math.round(activeTrack.reportedPosition.alt)} м`}
                />
              </div>
            ) : (
              <div className="target-lock__class">
                {activeTrack.identifiedType ?? 'UNKNOWN'}
                <span className="u-mono">Q {Math.round(activeTrack.trackQuality * 100)}%</span>
              </div>
            )}

            <div className={`target-lock__data ${commandMode && !technicalDetailsOpen ? 'is-collapsed' : ''}`}>
              {commandMode && <DataRow label={ru ? 'Трасса' : 'Track'} value={activeTrack.id} tone="is-muted" />}
              {commandMode && <DataRow label={ru ? 'Достоверность' : 'Track confidence'} value={`${Math.round(activeTrack.trackQuality * 100)}%`} tone="is-muted" />}
              <DataRow label={ru ? 'Высота' : 'Altitude'} value={`${Math.round(activeTrack.reportedPosition.alt)} м`} />
              {activeTrack.reportedSpeedKmh !== null && (
                <DataRow label={ru ? 'Скорость' : 'Speed'} value={`${Math.round(activeTrack.reportedSpeedKmh)} км/ч`} />
              )}
              {activeTrack.reportedHeading !== null && (
                <DataRow label={ru ? 'Курс' : 'Heading'} value={`${Math.round(activeTrack.reportedHeading)}°`} />
              )}
              <DataRow label={ru ? 'Обновление' : 'Last update'} value={`${trackAgeSeconds.toFixed(1)} с`} tone="is-muted" />
              <DataRow label={ru ? 'Источник' : 'Sensor'} value={activeTrack.sourceBatteryId} tone="is-muted" />
              {commandMode && autoPlanningBattery && (
                <DataRow
                  label={ru ? 'Решение автоматики' : 'Automatic decision'}
                  value={`${autoPlanningBattery.id} · ${formatAutoDecision(autoPlanningBattery.autoDecision.decision, ru)}`}
                  tone={autoPlanningBattery.autoDecision.decision === 'ENGAGE' ? 'is-success' : 'is-warning'}
                />
              )}
              {commandMode && autoPlanningBattery && (
                <DataRow
                  label={ru ? 'Оценка перехвата' : 'Intercept confidence'}
                  value={`${Math.round(autoPlanningBattery.autoDecision.interceptProbability * 100)}%`}
                  tone="is-muted"
                />
              )}
            </div>
            {commandMode && debugOverlayVisible && engagementCoordination && (
              <div className="engagement-coordinator-debug">
                <div className="hud-section__heading">FIRE CONTROL STATE</div>
                <DataRow label="TARGET" value={activeTarget ? getTargetDisplayName(activeTarget) : activeTrack.id} />
                <DataRow label="THREAT" value={engagementCoordination.threatScore == null ? '—' : `${Math.round(engagementCoordination.threatScore)} / ${engagementCoordination.threatLevel ?? '—'}`} />
                <DataRow label="STATE" value={engagementCoordination.state} />
                <DataRow label="SYSTEM" value={engagementCoordination.assignedSystem ?? '—'} />
                <DataRow label="LAUNCHER" value={engagementCoordination.assignedLauncherId ?? '—'} />
                <DataRow label="WEAPON" value={engagementCoordination.assignedWeapon ?? '—'} />
                <DataRow label="QUALITY" value={engagementCoordination.quality == null ? '—' : `${Math.round(engagementCoordination.quality * 100)}%`} />
                <DataRow label="EXPECTED" value={engagementCoordination.expectedQuality == null ? '—' : `${Math.round(engagementCoordination.expectedQuality * 100)}%`} />
                <DataRow label="WINDOW" value={engagementCoordination.window} />
                <DataRow label="RESERVATION" value={engagementCoordination.reservation ?? '—'} />
                <DataRow label="INTERCEPTOR" value={engagementCoordination.currentInterceptorId ?? '—'} />
                <DataRow label="ASSESSMENT" value={engagementCoordination.assessment ?? '—'} />
                <DataRow label="FALLBACK" value={engagementCoordination.bestFallbackBatteryId
                  ? `${engagementCoordination.bestFallbackBatteryId} · ${engagementCoordination.bestFallbackQuality == null ? '—' : `${Math.round(engagementCoordination.bestFallbackQuality * 100)}%`}`
                  : '—'} />
                <DataRow label="REASON" value={engagementCoordination.reason} />
                {engagementCoordination.candidates?.length > 0 && (
                  <details className="engagement-coordinator-debug__candidates">
                    <summary>CANDIDATES · {engagementCoordination.candidates.length}</summary>
                    {engagementCoordination.candidates.map(candidate => (
                      <div className={`fire-control-candidate is-${String(candidate.decision).toLowerCase()}`} key={`${candidate.batteryId}:${candidate.launcherId ?? 'none'}`}>
                        <span>{candidate.batteryId}</span>
                        <b>{candidate.quality == null ? '--' : Math.round(candidate.quality * 100)}</b>
                        <small>{candidate.decision}: {candidate.reason}</small>
                      </div>
                    ))}
                  </details>
                )}
              </div>
            )}
            {commandMode && (
              <button className="target-lock__details-toggle" onClick={() => setTechnicalDetailsOpen(value => !value)}>
                {technicalDetailsOpen ? (ru ? 'Скрыть техданные' : 'Hide technical details') : (ru ? 'Техданные' : 'Technical details')}
              </button>
            )}

            <div className="hud-section__heading target-lock__engagement">{ru ? 'Перехват' : 'Engagement'}</div>
            <div className="engagement-list engagement-list--recommended">
              {!recommendedBattery && <div className="hud-empty">{ru ? 'Нет развернутых ЗРК' : 'No deployed batteries'}</div>}
              {recommendedBattery && (
                <div className="engagement-row is-selected">
                  <span className="u-mono">{recommendedBattery.battery.id}</span>
                  <span className={getEngagementStatusClass(recommendedBattery.status)}>
                    {recommendedBattery.battery.reloadRemainingSec
                      ? `${localizeLauncherState('RELOADING', language)} ${Math.ceil(recommendedBattery.battery.reloadRemainingSec)}с`
                      : localizeEngagementStatus(recommendedBattery.status, language)}
                  </span>
                  <span className="engagement-row__distance u-mono">{formatDistance(recommendedBattery.distanceKm)}</span>
                </div>
              )}
            </div>
            <button
              disabled={recommendedBattery?.status !== ENGAGEMENT_STATUS.READY}
              onClick={launchRecommended}
              className="engage-button"
            >
              {recommendedBattery?.status === ENGAGEMENT_STATUS.READY
                ? `${recommendedBattery.battery.weaponType === 'GUN_AA' ? (ru ? 'Огонь' : 'Fire') : (ru ? 'Пуск' : 'Engage')} · ${recommendedBattery.battery.id}`
                : (ru ? 'Ожидание готовности' : 'Awaiting readiness')}
            </button>
            {selectedMwg && (
              <button
                className="engage-button mwg-fpv-panel__target-launch"
                disabled={(selectedMwg.fpvInventory ?? 0) <= 0}
                onClick={() => launchSkyfallFromMwg(selectedMwg.id)}
              >
                {ru ? `FPV ПО ТРАССЕ · ${selectedMwg.fpvInventory ?? 0}` : `LAUNCH FPV · ${selectedMwg.fpvInventory ?? 0}`}
              </button>
            )}
          </section>
        )}
        {selectedMwg && !deployPhase && !activeTrack && (
          <section className="mwg-fpv-panel">
            <div className="hud-eyebrow">{ru ? 'Мобильная огневая группа' : 'Mobile fire group'}</div>
            <div className="target-lock__id">{selectedMwg.displayName}</div>
            <div className="target-lock__data">
              <DataRow label="FPV" value="Skyfall P1-SUN" mono={false} />
              <DataRow label={ru ? 'Осталось' : 'Inventory'} value={`${selectedMwg.fpvInventory ?? 0} / ${selectedMwg.fpvCapacity ?? 4}`} />
              <DataRow label={ru ? 'Управление' : 'Control'} value="MANUAL · ADVANCED 3D" />
            </div>
            <button
              className="engage-button"
              disabled={(selectedMwg.fpvInventory ?? 0) <= 0}
              onClick={() => launchSkyfallFromMwg(selectedMwg.id)}
            >
              {(selectedMwg.fpvInventory ?? 0) > 0
                ? (ru ? 'ЗАПУСТИТЬ FPV' : 'LAUNCH FPV')
                : (ru ? 'FPV ИСЧЕРПАНЫ' : 'FPV DEPLETED')}
            </button>
          </section>
        )}
        {selectedSearchRadar && !deployPhase && !activeTrack && (
          <SearchRadarPanel
            radar={selectedSearchRadar}
            tracks={tracks}
            contacts={sensorContacts}
            language={language}
            onToggle={() => toggleSearchRadarOperational(selectedSearchRadar.id)}
          />
        )}
        {!deployPhase && (selectedSearchRadar || selectedBattery) && <section className="hud-section">
          <div className="hud-eyebrow">{(selectedSearchRadar ?? selectedBattery).id}</div>
          <button className="engage-button" onClick={() => {
            const state = useGameStore.getState();
            useEngine.getState().releaseControllableControl();
            state.openOlsFeed(state.scene, (selectedSearchRadar ?? selectedBattery).id);
          }}>OLS / EO</button>
        </section>}
      </aside>}

      <div className="c2-control" id="c2-menu" data-design-id="game-command" data-design-name="Командование ПВО" data-design-dynamic-text="true" style={commandDesign}>
        {buildMenuOpen && !deployPhase && (
          <div className="c2-menu">
            <div className="hud-eyebrow">{ru ? 'Развернуть ЗРК' : 'Deploy system'}</div>
            <div className="c2-menu__tabs">
              {DEPLOYABLE_SYSTEM_IDS.map(category => (
                <button
                  key={category}
                  onClick={() => setCategory(category)}
                  className={selectedCategory === category ? 'is-active' : ''}
                >
                  {SYSTEM_CATALOG[category].displayName}
                </button>
              ))}
            </div>
            <div className="hud-eyebrow c2-menu__group-label">{ru ? 'Обзорные РЛС' : 'Search radars'}</div>
            <div className="c2-menu__tabs c2-menu__tabs--radars">
              {SEARCH_RADAR_PROFILE_IDS.map(profileId => {
                const profile = getSearchRadarProfile(profileId);
                return <button
                  key={profileId}
                  onClick={() => setCategory(profileId)}
                  className={selectedCategory === profileId ? 'is-active' : ''}
                >{ru ? profile.displayName : profile.englishName}</button>;
              })}
            </div>
            {selectedCategory && (
              <div className="c2-system-detail" data-design-dynamic-text="true">
                {getSearchRadarProfile(selectedCategory) ? <SearchRadarDeployDetail
                  profile={getSearchRadarProfile(selectedCategory)}
                  language={language}
                /> : <>
                <strong>{SYSTEM_CATALOG[selectedCategory].displayName}</strong>
                {SYSTEM_CATALOG[selectedCategory].weaponType === 'GUN_AA' ? (
                  <>
                    <DataRow label={ru ? 'Тип' : 'Type'} value={selectedCategory === 'GAZ' ? (ru ? 'Мобильная огневая группа' : 'Mobile fire group') : (ru ? 'Зенитная самоходная установка' : 'Self-propelled anti-aircraft gun')} />
                    <DataRow label={ru ? 'Роль' : 'Role'} value={ru ? 'Ближняя защита от БПЛА' : 'Close-range UAV defence'} />
                    <DataRow label={ru ? 'Дальность' : 'Range'} value={`~${getGunSystemSpec(SYSTEM_CATALOG[selectedCategory].gunSpecId).engagementRangeKm} км`} />
                    <DataRow label={ru ? 'Вооружение' : 'Armament'} value={getGunSystemSpec(SYSTEM_CATALOG[selectedCategory].gunSpecId).weaponLabel} />
                    <DataRow label={ru ? 'Боезапас' : 'Ammunition'} value={`${getGunSystemSpec(SYSTEM_CATALOG[selectedCategory].gunSpecId).ammunitionRounds} ${ru ? 'снарядов' : 'rounds'}`} />
                    <DataRow label={ru ? 'Очередь' : 'Burst'} value={`${getGunSystemSpec(SYSTEM_CATALOG[selectedCategory].gunSpecId).roundsPerBurst} ${ru ? 'выстрелов' : 'rounds'}`} />
                    <DataRow label={ru ? 'Начальная скорость' : 'Muzzle velocity'} value={`${getGunSystemSpec(SYSTEM_CATALOG[selectedCategory].gunSpecId).muzzleVelocityMps} м/с`} />
                  </>
                ) : (
                  <>
                    <DataRow label={ru ? 'РЛС' : 'Radar'} value={`${SYSTEM_CATALOG[selectedCategory].radarRangeKm} км`} />
                    <DataRow label={ru ? 'Сектор' : 'Sector'} value={`${SYSTEM_CATALOG[selectedCategory].radarSector}°`} />
                    <DataRow label={ru ? 'Скорость' : 'Speed'} value={`${getInterceptorSpec(SYSTEM_CATALOG[selectedCategory].interceptorSpecId).publicDisplay.maxSpeedKmh} км/ч`} />
                  </>
                )}
                </>}
                <button className="c2-deploy-button" onClick={() => startDeploy(selectedCategory)}>
                  {ru ? 'Развернуть' : 'Deploy system'}
                </button>
              </div>
            )}
          </div>
        )}
        <button
          className="c2-toggle"
          data-design-dynamic-text="true"
          onClick={toggleBuildMenu}
          disabled={deployPhase !== null}
          title={ru ? 'Командование и развертывание' : 'Command and deployment'}
        >
          {buildMenuOpen ? (ru ? 'Закрыть' : 'Close') : (ru ? 'ПВО' : 'Command')}
        </button>
      </div>

      <footer className="sim-controls" id="simulation-controls" data-design-id="game-time-controls" data-design-name="Управление временем" data-design-dynamic-text="true" style={timeDesign}>
        <div className="sim-controls__clock">
          <small>{ru ? 'Симуляция' : 'Simulation'}</small>
          <span className="u-mono">{formatTime(simulationTime)} <i>Z</i></span>
        </div>
        <div className="sim-controls__speeds">
          {[0, 1, 2, 5, 10, 20].map(speed => (
            <button
              key={speed}
              onClick={() => setTimeScale(speed)}
              className={timeScale === speed ? 'is-active' : ''}
            >
              {speed === 0 ? (ru ? 'Пауза' : 'Pause') : `${speed}x`}
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}

function DeploymentPanel({ deployPhase, draftBattery, rotateRadar, confirmRadarHeading, language }) {
  const ru = isRussian(language);
  if (deployPhase === 'RADAR_HEADING') {
    return (
      <section className="deployment-panel" id="deployment-panel">
        <div className="hud-eyebrow">{ru ? 'Ориентация РЛС' : 'Radar alignment'}</div>
        <h3>{ru ? 'Ось сектора' : 'Sector heading'} <span className="u-mono">{draftBattery.radarHeading}°</span></h3>
        <p>{ru ? 'Задайте центральное направление сектора поиска.' : 'Set the centreline for the radar search sector.'}</p>
        <div className="deployment-panel__actions">
          <button onClick={() => rotateRadar(-15)}>−15°</button>
          <button onClick={() => rotateRadar(15)}>+15°</button>
        </div>
        <button className="deployment-panel__confirm" onClick={confirmRadarHeading}>{ru ? 'Подтвердить' : 'Confirm direction'}</button>
      </section>
    );
  }

  const instruction = {
    UNIT: `${ru ? 'Установите' : 'Place'} ${draftBattery.displayName ?? draftBattery.type}`,
    SEARCH_RADAR: `${ru ? 'Установите обзорную РЛС' : 'Place search radar'} ${draftBattery.displayName}`,
    FDC: ru ? 'Установите командный пункт' : 'Place command post',
    RADAR: ru ? 'Установите РЛС' : 'Place radar sensor',
    LAUNCHER: ru ? `Установите пусковую ${(draftBattery.components.launchers?.length ?? 0) + 1} из 2` : `Place launcher ${(draftBattery.components.launchers?.length ?? 0) + 1} of 2`,
  }[deployPhase];
  return (
    <section className="deployment-panel" id="deployment-panel">
      <div className="hud-eyebrow">{ru ? 'Режим развертывания' : 'Deployment mode'}</div>
      <h3 className="u-mono">{draftBattery.id}</h3>
      <p>{instruction}</p>
      <div className="deployment-panel__hint">{ru ? 'Укажите точку на карте' : 'Click a position on the map'}</div>
    </section>
  );
}

function SearchRadarDeployDetail({ profile, language }) {
  const ru = isRussian(language);
  return <>
    <strong>{ru ? profile.displayName : profile.englishName}</strong>
    <DataRow label={ru ? 'Тип' : 'Type'} value={ru ? 'Обзорная РЛС без вооружения' : 'Sensor-only search radar'} />
    <DataRow label={ru ? 'Роль' : 'Role'} value={profile.role.replaceAll('_', ' ')} />
    <DataRow label={ru ? 'Обзор' : 'Coverage'} value={`~${profile.nominalRangeKm} км`} />
    <DataRow label={ru ? 'Режим' : 'Mode'} value={profile.scanModeLabel} />
  </>;
}

function SearchRadarPanel({ radar, tracks, contacts, language, onToggle }) {
  const ru = isRussian(language);
  const sensorId = radar.components.radar?.id;
  const radarContacts = contacts.filter(contact => contact.sourceRadarId === sensorId);
  const contributingTracks = tracks.filter(track => track.contributingSensors?.includes(sensorId));
  const bestQuality = contributingTracks.reduce((best, track) => Math.max(best, track.trackQuality ?? 0), 0);
  return <section className="target-lock search-radar-panel">
    <div className="target-lock__header">
      <div>
        <div className="hud-eyebrow">{ru ? 'Обзорная РЛС' : 'Search radar'}</div>
        <div className="target-lock__id">{ru ? radar.displayName : radar.englishName}</div>
      </div>
      <div className={`status-pill ${radar.operational ? 'is-tracked' : 'is-lost'}`}>
        {radar.operational ? 'ACTIVE' : 'OFF'}
      </div>
    </div>
    <DataRow label={ru ? 'Режим' : 'Mode'} value={radar.scanModeLabel} />
    <DataRow label={ru ? 'Номинальная дальность' : 'Nominal range'} value={`${radar.radarRangeKm} км`} />
    <DataRow label={ru ? 'Треки' : 'Tracks'} value={contributingTracks.length} />
    <DataRow label={ru ? 'Измерения' : 'Measurements'} value={radarContacts.reduce((sum, contact) => sum + (contact.totalOpportunityCount ?? 0), 0)} />
    <DataRow label={ru ? 'Лучшее качество трека' : 'Best track quality'} value={`${Math.round(bestQuality * 100)}%`} />
    <button className="engage-button search-radar-panel__toggle" onClick={onToggle}>
      {radar.operational ? (ru ? 'ВЫКЛЮЧИТЬ РЛС' : 'RADAR OFF') : (ru ? 'ВКЛЮЧИТЬ РЛС' : 'RADAR ACTIVE')}
    </button>
  </section>;
}
