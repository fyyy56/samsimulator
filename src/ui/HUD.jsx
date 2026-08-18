import { useState } from 'react';
import { getInterceptorSpec } from '../data/interceptors.js';
import { getGunSystemSpec } from '../data/gunSystems.js';
import { useEngine, SYSTEM_CATALOG } from '../store/engine';
import {
  ENGAGEMENT_STATUS,
  getBatteryEngagementStatus,
  selectBestLauncher,
} from '../store/engagement.js';
import { getDistanceKm } from '../store/geo.js';
import { TRACK_STATE } from '../store/trackSystem.js';
import { SIMPLE_MAP_THEME, useViewStore } from '../store/viewStore.js';
import { getTargetModelDisplayName } from '../data/lightTargetModels.js';
import { UI_LANGUAGE, useGameStore } from '../store/gameStore.js';
import { selectActiveUiPreset, useContentStore } from '../store/contentStore.js';
import { useDesignSurface } from '../store/designStore.js';
import { getAltitudeBand } from '../data/airTargetProfiles.js';
import {
  evaluateBatteryInterceptFeasibility,
  evaluateInterceptFeasibility,
  INTERCEPT_FEASIBILITY,
} from '../store/interceptFeasibility.js';
import {
  BATTERY_CONTROL_MODE,
} from '../store/autoDefense.js';
import {
  AUTO_ENGAGEMENT_DECISION,
  calculateInterceptProbability,
  getInterceptSolutionState,
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
  if (target?.modelId) return getTargetModelDisplayName(target.modelId);
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
    <aside className="attack-priorities" data-design-id="game-targets" data-design-name="Основные цели" style={style} aria-label={ru ? 'Основные цели атаки' : 'Primary attack objectives'}>
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
    sensorContacts,
    missiles,
  } = useEngine(state => state.visualSnapshot);
  const selectedTrackId = useEngine(state => state.selectedTrackId);
  const selectedMissileId = useEngine(state => state.selectedMissileId);
  const selectedBatteryId = useEngine(state => state.selectedBatteryId);
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
  const setAllBatteriesControlMode = useEngine(state => state.setAllBatteriesControlMode);

  const activeTrack = tracks.find(track => track.id === selectedTrackId);
  const activeTarget = airTargets.find(target => target.id === activeTrack?.targetId);
  const selectedBattery = batteries.find(battery => battery.id === selectedBatteryId);
  const batteryOptions = activeTrack ? batteries
    .filter(battery => battery.controlMode !== BATTERY_CONTROL_MODE.HOLD)
    .map(battery => ({
    battery,
    status: getBatteryEngagementStatus(battery, activeTrack, activeTarget),
    distanceKm: getLauncherDistance(battery, activeTrack),
  })) : [];
  const readyBatteries = batteryOptions.filter(option => option.status === ENGAGEMENT_STATUS.READY);
  const recommendedBattery = (readyBatteries.length > 0 ? readyBatteries : batteryOptions)
    .sort((first, second) => (first.distanceKm ?? Infinity) - (second.distanceKm ?? Infinity))[0] ?? null;
  const debugBattery = selectedBattery ?? recommendedBattery?.battery ?? null;
  const interceptDebug = activeTrack && activeTarget && debugBattery
    ? evaluateBatteryInterceptFeasibility({
      battery: debugBattery,
      track: activeTrack,
      target: activeTarget,
    })
    : null;
  const debugInterceptProbability = activeTrack && activeTarget && debugBattery && interceptDebug
    ? calculateInterceptProbability({
      battery: debugBattery,
      track: activeTrack,
      target: activeTarget,
      interceptSolution: interceptDebug,
    })
    : 0;
  const debugInterceptSolutionState = getInterceptSolutionState(
    interceptDebug,
    debugInterceptProbability,
  );
  const activeSensorContacts = activeTrack
    ? sensorContacts.filter(contact => contact.targetId === activeTrack.targetId)
    : [];
  const activeInterceptor = missiles.find(missile => missile.id === selectedMissileId)
    ?? (activeTrack ? missiles.find(missile => missile.trackId === activeTrack.id) : null);
  const activeInterceptorSpec = activeInterceptor
    ? getInterceptorSpec(activeInterceptor.interceptorSpecId)
    : null;
  const autoPlanningBattery = activeTrack
    ? batteries.find(battery => (
      battery.recommendedTrackId === activeTrack.id && battery.autoDecision
    ))
    : null;
  const missileInterceptDebug = activeInterceptor && activeTarget && activeInterceptorSpec
    ? evaluateInterceptFeasibility({
      launcher: null,
      target: activeTarget,
      track: activeTrack,
      interceptorSpec: activeInterceptorSpec,
      currentInterceptor: activeInterceptor,
    })
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
      <header className="hud-brand" id="hud-brand" data-design-id="game-brand" data-design-name="Название игры" style={{ ...(panelStyle('hud') ?? {}), ...(brandDesign ?? {}) }}>
        <div className="hud-brand__mark" aria-hidden="true" />
        <div>
          <div className="hud-brand__name">SAM Simulator</div>
          <div className="hud-brand__context">{localizeScenarioName(activeScenario.name, ru)} · {ru ? 'Тактическая воздушная обстановка' : 'Tactical airspace'}</div>
        </div>
      </header>

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
                className={globalControlMode === mode ? 'is-active' : ''}
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
      </aside>}

      <aside className="hud-context" id="hud-context-panel" data-design-id="game-information" data-design-name="Информационная панель" style={{ ...(panelStyle('info') ?? {}), ...(infoDesign ?? {}) }}>
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
            {commandMode && (
              <button className="target-lock__details-toggle" onClick={() => setTechnicalDetailsOpen(value => !value)}>
                {technicalDetailsOpen ? (ru ? 'Скрыть техданные' : 'Hide technical details') : (ru ? 'Техданные' : 'Technical details')}
              </button>
            )}

            {debugOverlayVisible && (
              <div className="target-debug-data">
                <div className="hud-eyebrow">SENSOR / KINEMATICS DEBUG</div>
                <DataRow label="EVIDENCE" value={(activeTrack.detectionEvidence ?? 0).toFixed(3)} />
                <DataRow
                  label="THRESHOLDS"
                  value={activeTrack.sensorThresholds
                    ? `${activeTrack.sensorThresholds.detected.toFixed(2)} / ${activeTrack.sensorThresholds.tracked.toFixed(2)} / ${activeTrack.sensorThresholds.identified.toFixed(2)}`
                    : '—'}
                />
                <DataRow label="SCAN OPPORTUNITY" value={`${activeTrack.lastScanOpportunityCount ?? 0}`} />
                <DataRow label="LAST CONTRIBUTION" value={(activeTrack.lastSensorContribution ?? 0).toFixed(3)} />
                <DataRow label="SENSOR CONTACTS" value={`${activeSensorContacts.length}`} />
                <DataRow label="CLASS CONF" value={`${Math.round((activeTrack.classificationConfidence ?? 0) * 100)}%`} />
                <DataRow label="ID CONF" value={`${Math.round((activeTrack.identificationConfidence ?? 0) * 100)}%`} />
                <DataRow label="TARGET ETA" value={interceptDebug ? `${interceptDebug.targetEtaSec.toFixed(1)} s` : '—'} />
                <DataRow label="TIME TO TARGET" value={interceptDebug && Number.isFinite(interceptDebug.targetEtaSec) ? `${interceptDebug.targetEtaSec.toFixed(1)} s` : '—'} />
                <DataRow label="MIN TOF" value={interceptDebug?.minimumTimeToInterceptSec != null ? `${interceptDebug.minimumTimeToInterceptSec.toFixed(1)} s` : '—'} />
                <DataRow label="PREDICTED TOF" value={interceptDebug?.predictedInterceptTimeSec != null ? `${interceptDebug.predictedInterceptTimeSec.toFixed(1)} s` : '—'} />
                <DataRow label="TIME TO INTERCEPT" value={interceptDebug?.predictedInterceptTimeSec != null ? `${interceptDebug.predictedInterceptTimeSec.toFixed(1)} s` : '—'} />
                <DataRow label="INTERCEPT DIST" value={interceptDebug?.interceptDistanceKm != null ? `${interceptDebug.interceptDistanceKm.toFixed(1)} km` : '—'} />
                <DataRow
                  label="FEASIBILITY"
                  value={interceptDebug?.status ?? '—'}
                  tone={interceptDebug?.status === INTERCEPT_FEASIBILITY.NO_SOLUTION ? 'is-hostile' : 'is-success'}
                />
                <DataRow
                  label="INTERCEPT PROBABILITY"
                  value={`${Math.round(debugInterceptProbability * 100)}%`}
                  tone={debugInterceptProbability >= 0.52 ? 'is-success' : 'is-warning'}
                />
                <DataRow
                  label="INTERCEPT SOLUTION"
                  value={debugInterceptSolutionState.replaceAll('_', ' ')}
                  tone={debugInterceptSolutionState === 'NO_SOLUTION'
                    ? 'is-hostile'
                    : debugInterceptSolutionState === 'READY'
                      ? 'is-success'
                      : 'is-warning'}
                />
                <DataRow label="MISSILE STATE" value={activeInterceptor?.lifecycleState ?? '—'} />
                <DataRow label="MISSILE" value={activeInterceptorSpec?.publicDisplay.displayName ?? '—'} />
                <DataRow label="SPEED" value={activeInterceptor ? `${Math.round(activeInterceptor.speedKmh)} km/h` : '—'} />
                <DataRow label="ALTITUDE" value={activeInterceptor ? `${(activeInterceptor.altitudeM / 1000).toFixed(2)} km` : '—'} />
                <DataRow label="DISTANCE FLOWN" value={activeInterceptor ? `${activeInterceptor.distanceTraveledKm.toFixed(1)} km` : '—'} />
                <DataRow label="HEADING / DESIRED" value={activeInterceptor ? `${activeInterceptor.heading.toFixed(1)}° / ${(activeInterceptor.desiredHeading ?? activeInterceptor.heading).toFixed(1)}°` : '—'} />
                <DataRow label="COURSE CORRECTION" value={activeInterceptor ? `${(activeInterceptor.headingCorrectionDeg ?? 0).toFixed(1)}°` : '—'} />
                <DataRow label="CURRENT TURN RATE" value={activeInterceptor ? `${(activeInterceptor.turnRateDegPerSec ?? 0).toFixed(1)}°/s` : '—'} />
                <DataRow label="MAX TURN RATE" value={activeInterceptor ? `${(activeInterceptor.maximumTurnRateDegPerSec ?? 0).toFixed(1)}°/s` : '—'} />
                <DataRow label="TURN RADIUS" value={Number.isFinite(activeInterceptor?.turnRadiusKm) ? `${activeInterceptor.turnRadiusKm.toFixed(2)} km` : '—'} />
                <DataRow label="FLIGHT PHASE" value={activeInterceptor?.kinematicPhase ?? '—'} />
                <DataRow label="MOTOR PHASE" value={activeInterceptor?.motorPhase ?? '—'} />
                <DataRow label="MOTOR LEFT" value={activeInterceptor ? `${(activeInterceptor.motorTimeLeftSec ?? 0).toFixed(1)} s` : '—'} />
                <DataRow label="NET ACCEL" value={activeInterceptor ? `${(activeInterceptor.currentAccelerationMps2 ?? 0).toFixed(1)} m/s²` : '—'} />
                <DataRow label="DRAG DECEL" value={activeInterceptor ? `-${(activeInterceptor.dragDecelerationMps2 ?? 0).toFixed(1)} m/s²` : '—'} />
                <DataRow label="TURN LOSS" value={activeInterceptor ? `-${(activeInterceptor.turnLossMps2 ?? 0).toFixed(1)} m/s²` : '—'} />
                <DataRow label="CLIMB LOSS" value={activeInterceptor ? `-${(activeInterceptor.altitudeEnergyLossMps2 ?? 0).toFixed(1)} m/s²` : '—'} />
                <DataRow label="DESCENT GAIN" value={activeInterceptor ? `+${(activeInterceptor.descentEnergyRecoveryMps2 ?? 0).toFixed(1)} m/s²` : '—'} />
                <DataRow label="AIR DENSITY" value={activeInterceptor ? `${((activeInterceptor.densityMultiplier ?? 1) * 100).toFixed(0)}%` : '—'} />
                <DataRow label="RESIDUAL ENERGY" value={activeInterceptor ? `${Math.round((activeInterceptor.energyRatio ?? 0) * 100)}%` : '—'} />
                <DataRow label="ENERGY" value={activeInterceptor?.energyState ?? '—'} tone={activeInterceptor?.energyState === 'ENERGY_CRITICAL' ? 'is-hostile' : activeInterceptor?.energyState === 'ENERGY_LOW' ? 'is-warning' : 'is-success'} />
                <DataRow label="TARGET DISTANCE" value={Number.isFinite(activeInterceptor?.distanceToTargetKm) ? `${(activeInterceptor.distanceToTargetKm * 1000).toFixed(0)} m` : '—'} />
                <DataRow label="PREDICTED INTERCEPT" value={missileInterceptDebug?.predictedInterceptTimeSec != null ? `${missileInterceptDebug.predictedInterceptTimeSec.toFixed(1)} s · ${missileInterceptDebug.status}` : '—'} />
                <DataRow label="SWEPT APPROACH" value={Number.isFinite(activeInterceptor?.sweptClosestApproachM) ? `${activeInterceptor.sweptClosestApproachM.toFixed(0)} m` : '—'} />
                <DataRow label="FUSE RADIUS" value={activeInterceptorSpec ? `${activeInterceptorSpec.gameplayPhysics.proximityFuseRadiusM} m` : '—'} />
                <DataRow label="FLIGHT / MAX" value={activeInterceptorSpec && activeInterceptor ? `${activeInterceptor.flightTime.toFixed(1)} / ${activeInterceptorSpec.gameplayPhysics.maxFlightTimeSec} s` : '—'} />
              </div>
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
          </section>
        )}
      </aside>

      <div className="c2-control" id="c2-menu" data-design-id="game-command" data-design-name="Командование ПВО" style={commandDesign}>
        {buildMenuOpen && !deployPhase && (
          <div className="c2-menu">
            <div className="hud-eyebrow">{ru ? 'Развернуть ЗРК' : 'Deploy system'}</div>
            <div className="c2-menu__tabs">
              {['GUN', 'SHORT', 'MEDIUM', 'LONG'].map(category => (
                <button
                  key={category}
                  onClick={() => setCategory(category)}
                  className={selectedCategory === category ? 'is-active' : ''}
                >
                  {ru ? ({ GUN: 'ПУШЕЧНАЯ', SHORT: 'БЛИЖНЯЯ', MEDIUM: 'СРЕДНЯЯ', LONG: 'ДАЛЬНЯЯ' }[category]) : category}
                </button>
              ))}
            </div>
            {selectedCategory && (
              <div className="c2-system-detail">
                <strong>{SYSTEM_CATALOG[selectedCategory].type}</strong>
                {selectedCategory === 'GUN' ? (
                  <>
                    <DataRow label={ru ? 'Тип' : 'Type'} value={ru ? 'Зенитная самоходная установка' : 'Self-propelled anti-aircraft gun'} />
                    <DataRow label={ru ? 'Роль' : 'Role'} value={ru ? 'Ближняя защита от БПЛА' : 'Close-range UAV defence'} />
                    <DataRow label={ru ? 'Дальность' : 'Range'} value={`~${getGunSystemSpec(SYSTEM_CATALOG.GUN.gunSpecId).engagementRangeKm} км`} />
                    <DataRow label={ru ? 'Вооружение' : 'Armament'} value={getGunSystemSpec(SYSTEM_CATALOG.GUN.gunSpecId).weaponLabel} />
                    <DataRow label={ru ? 'Боезапас' : 'Ammunition'} value={`${getGunSystemSpec(SYSTEM_CATALOG.GUN.gunSpecId).ammunitionRounds} ${ru ? 'снарядов' : 'rounds'}`} />
                    <DataRow label={ru ? 'Очередь' : 'Burst'} value={`${getGunSystemSpec(SYSTEM_CATALOG.GUN.gunSpecId).roundsPerBurst} ${ru ? 'выстрелов' : 'rounds'}`} />
                    <DataRow label={ru ? 'Начальная скорость' : 'Muzzle velocity'} value={`${getGunSystemSpec(SYSTEM_CATALOG.GUN.gunSpecId).muzzleVelocityMps} м/с`} />
                  </>
                ) : (
                  <>
                    <DataRow label={ru ? 'РЛС' : 'Radar'} value={`${SYSTEM_CATALOG[selectedCategory].radarRangeKm} км`} />
                    <DataRow label={ru ? 'Сектор' : 'Sector'} value={`${SYSTEM_CATALOG[selectedCategory].radarSector}°`} />
                    <DataRow label={ru ? 'Скорость' : 'Speed'} value={`${getInterceptorSpec(SYSTEM_CATALOG[selectedCategory].interceptorSpecId).publicDisplay.maxSpeedKmh} км/ч`} />
                  </>
                )}
                <button className="c2-deploy-button" onClick={() => startDeploy(selectedCategory)}>
                  {ru ? 'Развернуть' : 'Deploy system'}
                </button>
              </div>
            )}
          </div>
        )}
        <button
          className="c2-toggle"
          onClick={toggleBuildMenu}
          disabled={deployPhase !== null}
          title={ru ? 'Командование и развертывание' : 'Command and deployment'}
        >
          {buildMenuOpen ? (ru ? 'Закрыть' : 'Close') : (ru ? 'ПВО' : 'Command')}
        </button>
      </div>

      <footer className="sim-controls" id="simulation-controls" data-design-id="game-time-controls" data-design-name="Управление временем" style={timeDesign}>
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
    UNIT: ru ? 'Установите Gepard 1A2' : 'Place Gepard 1A2',
    FDC: ru ? 'Установите командный пункт' : 'Place command post',
    RADAR: ru ? 'Установите РЛС' : 'Place radar sensor',
    LAUNCHER: ru ? `Установите пусковую ${draftBattery.components.launchers.length + 1} из 2` : `Place launcher ${draftBattery.components.launchers.length + 1} of 2`,
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
