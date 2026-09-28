import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArcType,
  Cartesian2,
  Cartesian3,
  CallbackProperty,
  CallbackPositionProperty,
  Color,
  ColorBlendMode,
  DistanceDisplayCondition,
  EllipsoidTerrainProvider,
  HeightReference,
  ImageryLayer,
  LabelStyle,
  Matrix3,
  Matrix4,
  Math as CesiumMath,
  NearFarScalar,
  PolygonHierarchy,
  Quaternion,
  SceneTransforms,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  Viewer as CesiumViewer,
} from 'cesium';
import {
  PHYSICS_UPDATE_HZ,
  useEngine,
} from '../store/engine.js';
import { useViewStore } from '../store/viewStore.js';
import {
  samplePerformance,
  setPerformanceMonitoringEnabled,
} from '../store/performanceMonitor.js';
import { PRESENTATION_MODE, UI_LANGUAGE, useGameStore } from '../store/gameStore.js';
import { localizeTechnicalTerm } from '../data/uiLocalization.js';
import { BATTERY_CONTROL_MODE } from '../store/autoDefense.js';
import {
  ADVANCED_ENTITY_KIND,
  getAdvancedControllablePresentation,
  getAdvancedInterceptorPresentation,
  getAdvancedSearchRadarPresentation,
  getAdvancedTargetPresentation,
  resolveAdvancedAssetPresentation,
} from '../data/advanced3dRegistry.js';
import {
  CONTROLLABLE_AIR_ENTITY_TYPE,
  CONTROLLABLE_CAMERA_MODE,
  CONTROLLABLE_CONTROL_MODE,
} from '../store/controllableAirEntity.js';
import { getControllableAirProfile } from '../data/controllableAirProfiles.js';
import { getThermalProfile, thermalLuminance } from '../data/thermalProfiles.js';
import { isAvailableNetworkTrack } from '../store/trackDataProvider.js';
import { THROTTLE_ASSIST_MODE, useManualControlStore } from '../store/manualControlStore.js';
import { getSeekerProfile, SEEKER_STATE } from '../data/seekerProfiles.js';
import { getTargetDisplayName } from '../data/lightModeAssets.js';
import { getBearing, getDestinationPoint, getDistanceKm } from '../store/geo.js';
import {
  MISSILE_TRAIL_VISUAL_PROFILE,
  getMissilePlumeProfile,
  getMissileSmokeProfile,
} from '../data/visualEffectProfiles.js';
import {
  ADVANCED_CAMERA_MODE as CAMERA_MODE,
  createAdvancedCameraController,
} from './advanced/AdvancedCameraController.js';
import { pushVisualSnapshot, sampleVisualState, VISUAL_DELAY_SEC } from './advanced/visualInterpolation.js';
import {
  bodyToWorldQuaternion,
  createVisualPoseProperties,
  getVisualExhaustPosition,
  createWorldMissileBillboard,
  getVisualModelAnchorPosition,
} from './advanced/modelOrientation.js';
import { createFpvCameraEffect, fpvLensSample } from './advanced/fpvCameraEffect.js';
import FpvOsd from './advanced/FpvOsd.jsx';
import OlsHud from './advanced/OlsHud.jsx';
import { createOlsCameraController } from './advanced/OlsCameraController.js';
import { useOlsViewStore } from '../store/olsViewStore.js';
import AdvancedOverlayMenu from './advanced/AdvancedOverlayMenu.jsx';
import EnvironmentControls from './advanced/EnvironmentControls.jsx';
import { createAdvancedEnvironment } from './advanced/advancedEnvironment.js';
import { useEnvironmentSettings } from './advanced/environmentSettings.js';
import { effectiveAdvancedOverlays, compactWorldLabel, createLabelLayout } from './advanced/advancedPresentation.js';
import './advanced/advancedPresentation.css';
import AdvancedSessionPanel from './advanced/AdvancedSessionPanel.jsx';
import AdvancedFireControl from './advanced/AdvancedFireControl.jsx';
import MissileLog from './advanced/MissileLog.jsx';
import GroundPlacement, { GroundObjectList } from './advanced/GroundPlacement.jsx';
import { groundObjects } from './advanced/groundPlacement.js';
import { createColdLaunchVfx } from './advanced/coldLaunchVfx.js';
import { createTerminalControlVfx } from './advanced/terminalControlVfx.js';
import { createAsterBoosterDebris, updateAsterBoosterDebris } from './advanced/asterBoosterDebris.js';
import { createImpactVfx } from './advanced/impactVfx.js';
import { sampleTrackPresentation, withTrackPresentation } from '../ui/trackPresentation.js';
import { captureImpactAwareSnapshot } from './advanced/impactPresentation.js';
import { getAssistTargetSpeedMps, updateAssistedThrottle } from './advanced/fpvThrottleAssist.js';
import {
  formatTrackCesiumLabel,
} from '../ui/trackLabelFormatting.js';

const TRAIL_SAMPLE_INTERVAL_MS = 125;
const TRAIL_MAX_POINTS = 240;
const ENTITY_REFRESH_INTERVAL_MS = 250;
const ADVANCED_PREFIX = 'advanced-sim:';
const ADVANCED_TRACK_PREFIX = 'advanced-track:';
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const formatFlightTime = seconds => {
  const totalSeconds = Math.max(0, Math.floor(seconds ?? 0));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  return `${minutes}:${(totalSeconds % 60).toString().padStart(2, '0')}`;
};
const POST_INTERCEPT_HOLD_MS = 3_400;
// Debug geometry is intentionally bounded. This is a presentation limit only;
// seeker activation and lock ranges remain owned by the gameplay profiles.
const SEEKER_VISUAL_DEBUG_RANGE_M = 20_000;
const SEEKER_ORIGIN_FORWARD_OFFSET = 0.48;
const ADVANCED_VISUAL_MODE = Object.freeze({
  DAY: 'DAY',
  LOW_LIGHT: 'LOW-LIGHT',
  THERMAL: 'THERMAL',
});

const cycleVisualMode = current => {
  const modes = Object.values(ADVANCED_VISUAL_MODE);
  return modes[(modes.indexOf(current) + 1) % modes.length];
};

const getEntityPosition = entity => {
  const source = entity.components?.radar ?? entity;
  return ({
  lat: source.worldPosition?.lat ?? source.position?.lat ?? source.lat ?? 0,
  lng: source.worldPosition?.lng ?? source.position?.lng ?? source.lng ?? source.lon ?? 0,
  altitudeM: Math.max(0,
    source.worldPosition?.altitudeM ?? source.altitudeM
      ?? source.position?.altitudeM ?? source.position?.alt ?? 0),
  });
};

const getVelocityVector = entity => {
  const stored = entity.velocity ?? {};
  if (Number.isFinite(stored.eastMps) && Number.isFinite(stored.northMps)) {
    return {
      eastMps: stored.eastMps,
      northMps: stored.northMps,
      upMps: stored.upMps ?? stored.verticalSpeedMps ?? entity.verticalSpeedMps ?? 0,
    };
  }
  if (Number.isFinite(stored.vx) && Number.isFinite(stored.vy)) {
    return {
      eastMps: stored.vx,
      northMps: stored.vy,
      upMps: stored.vz ?? stored.verticalSpeedMps ?? entity.verticalSpeedMps ?? 0,
    };
  }
  const speedMps = (entity.speedKmh ?? stored.speedKmh ?? 0) / 3.6;
  const headingRad = (entity.heading ?? stored.heading ?? 0) * Math.PI / 180;
  const pitchRad = (entity.flightPathAngleDeg ?? stored.flightPathAngleDeg ?? 0) * Math.PI / 180;
  const horizontalSpeedMps = speedMps * Math.cos(pitchRad);
  return {
    eastMps: Math.sin(headingRad) * horizontalSpeedMps,
    northMps: Math.cos(headingRad) * horizontalSpeedMps,
    upMps: Math.sin(pitchRad) * speedMps,
  };
};

const getKinematics = entity => {
  const velocity = getVelocityVector(entity);
  const horizontalSpeedMps = Math.hypot(velocity.eastMps, velocity.northMps);
  const speedMps = Math.hypot(horizontalSpeedMps, velocity.upMps);
  return {
    ...velocity,
    horizontalSpeedMps,
    speedMps,
    speedKmh: entity.speedKmh ?? entity.velocity?.speedKmh ?? speedMps * 3.6,
    headingDeg: entity.entityType === CONTROLLABLE_AIR_ENTITY_TYPE
      ? entity.heading
      : entity.controlActuators?.bodyHeadingDeg
        ?? (Math.atan2(velocity.eastMps, velocity.northMps) * 180 / Math.PI + 360) % 360,
    pitchDeg: entity.entityType === CONTROLLABLE_AIR_ENTITY_TYPE
      ? entity.pitch
      : entity.controlActuators?.bodyPitchDeg
        ?? Math.atan2(velocity.upMps, Math.max(horizontalSpeedMps, 0.001)) * 180 / Math.PI,
    rollDeg: entity.roll ?? 0,
    angularRatesDegPerSec: entity.angularVelocity ?? null,
    coldLaunchPhase: entity.coldLaunchPhase,
    attitudeJetsIntensity: entity.attitudeJetsIntensity,
    attitudeCorrectionDeg: entity.attitudeCorrectionDeg,
    controlActuators: entity.controlActuators,
    guidanceEnabled: entity.guidanceEnabled,
    motorPhase: entity.motorPhase,
    flightTime: entity.flightTime,

  };
};

const getSimulationEntity = (state, kind, id) => (
  kind === ADVANCED_ENTITY_KIND.INTERCEPTOR
    ? state.missiles.find(entity => entity.id === id)
    : kind === ADVANCED_ENTITY_KIND.SEARCH_RADAR
      ? state.searchRadars.find(entity => entity.id === id)
      : kind === ADVANCED_ENTITY_KIND.CONTROLLABLE
        ? state.controllableAirEntities.find(entity => entity.id === id)
        : state.airTargets.find(entity => entity.id === id)
);

const makeSelectionKey = (kind, id) => `${kind}:${id}`;
const parseSelectionKey = key => {
  if (!key) return null;
  const separator = key.indexOf(':');
  return { kind: key.slice(0, separator), id: key.slice(separator + 1) };
};

function AdvancedToolbar({ cameraMode, setCameraMode, resetCamera, returnToCommand,
  openOls, spawnTestEntity, controllableSelected, visualMode, setVisualMode, ru,
  engineeringEnabled, sandboxMode }) {
  const tr = term => localizeTechnicalTerm(term, ru ? 'RU' : 'EN');
  const fireMode = useEngine(state => state.globalControlMode);
  const modes = controllableSelected
    ? [CAMERA_MODE.THIRD_PERSON, CAMERA_MODE.FIRST_PERSON, CAMERA_MODE.FPV]
    : [CAMERA_MODE.FREE, CAMERA_MODE.FOLLOW, CAMERA_MODE.SIDE, CAMERA_MODE.TACTICAL];
  return <>
    <div className="advanced-toolbar map-toolbar">
      <button className="map-toolbar__button" onClick={returnToCommand}>← {ru ? 'МЕНЮ' : 'MENU'}</button>
      {Object.values(ADVANCED_VISUAL_MODE).map(mode => (
        <button key={mode} className={`map-toolbar__button${visualMode === mode ? ' is-active' : ''}`}
          aria-pressed={visualMode === mode} onClick={() => setVisualMode(mode)}>{tr(mode)}</button>
      ))}
      <button className="map-toolbar__button" onClick={openOls}>OLS</button>
      <span>{tr('FIRE')}</span>
      {['AUTO', 'MANUAL'].map(mode => <button key={mode}
        className={`map-toolbar__button${fireMode === mode ? ' is-active' : ''}`}
        aria-pressed={fireMode === mode}
        onClick={() => useEngine.getState().setAllBatteriesControlMode(mode)}>{tr(mode)}</button>)}
      {engineeringEnabled && <button className="map-toolbar__button" onClick={spawnTestEntity}>{ru ? 'СОЗДАТЬ TEST FPV' : 'SPAWN TEST FPV'}</button>}
      <span>{tr(sandboxMode ? '3D SANDBOX' : 'ADVANCED 3D')}</span>
    </div>
    <details className="advanced-camera-menu">
      <summary>{ru ? 'ВИД' : 'VIEW'}</summary>
      <nav>{modes.map(mode => <button key={mode}
        className={cameraMode === mode ? 'is-active' : ''}
        onClick={() => setCameraMode(mode)}>{tr(mode)}</button>)}
        {cameraMode !== CAMERA_MODE.FREE && <button onClick={resetCamera}>{ru ? 'СБРОС ВИДА' : 'RESET VIEW'}</button>}
      </nav>
    </details>
  </>;
}

function AdvancedTimeControls({ timeScale, setTimeScale, ru }) {
  return <div className="advanced-time-controls" aria-label={ru ? 'Управление временем' : 'Time controls'}>
    {[0, 0.5, 1, 2, 5, 10, 20].map(speed => (
      <button key={speed} className={`map-toolbar__button${timeScale === speed ? ' is-active' : ''}`}
        onClick={() => setTimeScale(speed)}>
        {speed === 0 ? (ru ? 'ПАУЗА' : 'PAUSE') : `${speed}x`}
      </button>
    ))}
  </div>;
}

function EntityList({ snapshot, selectedKey, onSelect, ru, groundSelected, onGroundSelect }) {
  const groundCount = useEngine(state => groundObjects(state).length);
  return <details className="advanced-entity-list hud-rail">
    <summary>{ru ? 'ОБЪЕКТЫ' : 'ENTITIES'}<small>{snapshot.targets.length
      + snapshot.missiles.length + groundCount
      + snapshot.controllables.length}</small></summary>
    {snapshot.controllables.length > 0 && <section>
      <h3>{ru ? 'УПРАВЛЯЕМЫЕ' : 'CONTROLLABLE'} <b>{snapshot.controllables.length}</b></h3>
      {snapshot.controllables.map(entity => {
        const key = makeSelectionKey(ADVANCED_ENTITY_KIND.CONTROLLABLE, entity.id);
        return <button key={key} className={selectedKey === key ? 'is-active' : ''}
          onClick={() => onSelect(key)}>
          <span>{entity.displayName}</span><small>{entity.id} · {entity.status}</small>
        </button>;
      })}
    </section>}
    <GroundObjectList selected={groundSelected} onSelect={onGroundSelect} ru={ru} />
    <section>
      <h3>{ru ? 'ЦЕЛИ' : 'TARGETS'} <b>{snapshot.targets.length}</b></h3>
      {snapshot.targets.map(entity => {
        const key = makeSelectionKey(ADVANCED_ENTITY_KIND.TARGET, entity.id);
        return <button key={key} className={selectedKey === key ? 'is-active' : ''}
          onClick={() => onSelect(key)}>
          <span>{entity.displayName}</span><small>{entity.id} · {(entity.altitudeM / 1000).toFixed(1)} KM</small>
        </button>;
      })}
    </section>
    <section>
      <h3>{ru ? 'ПЕРЕХВАТЧИКИ' : 'INTERCEPTORS'} <b>{snapshot.missiles.length}</b></h3>
      {snapshot.missiles.map(entity => {
        const key = makeSelectionKey(ADVANCED_ENTITY_KIND.INTERCEPTOR, entity.id);
        return <button key={key} className={selectedKey === key ? 'is-active' : ''}
          onClick={() => onSelect(key)}>
          <span>{entity.displayName}</span><small>{entity.id} · {(entity.altitudeM / 1000).toFixed(1)} KM</small>
        </button>;
      })}
    </section>
  </details>;
}

const formatControlVector = vector => vector
  ? `P ${vector.pitch.toFixed(2)} · Y ${vector.yaw.toFixed(2)} · R ${vector.roll.toFixed(2)} · T ${vector.throttle?.toFixed(2) ?? '—'}`
  : '—';
const formatRateVector = vector => vector
  ? `P ${vector.pitch.toFixed(1)} · Y ${vector.yaw.toFixed(1)} · R ${vector.roll.toFixed(1)}`
  : '—';
const formatPositionVector = position => position
  ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} · ${position.altitudeM.toFixed(1)} M`
  : '—';
const formatCartesianVector = vector => vector
  ? `${vector.x.toFixed(2)} / ${vector.y.toFixed(2)} / ${vector.z.toFixed(2)}`
  : '—';

const formatTelemetryMetric = (value, digits = 1, suffix = '') => (
  Number.isFinite(value) ? `${value.toFixed(digits)}${suffix}` : '—'
);

// The simulation stores body orientation, not a separate gimballed seeker
// quaternion. The debug ray therefore uses that same buffered body pose and is
// explicitly a visual/gameplay-default axis until a seeker attitude is stored.
const getVisualBodyOrientation = visual => bodyToWorldQuaternion(
  visual.worldPosition,
  visual.quaternion,
);

const getVisualBodyForward = visual => Matrix3.multiplyByVector(
  Matrix3.fromQuaternion(getVisualBodyOrientation(visual), new Matrix3()),
  Cartesian3.UNIT_X,
  new Cartesian3(),
);

const getVisualSeekerOrigin = (visual, presentation) => {
  const length = Math.max(1, (presentation.physicalLengthMeters ?? 4)
    * (presentation.baseVisualScale ?? 1));
  const offset = Cartesian3.multiplyByScalar(getVisualBodyForward(visual),
    length * SEEKER_ORIGIN_FORWARD_OFFSET, new Cartesian3());
  return Cartesian3.add(visual.worldPosition, offset, new Cartesian3());
};

function SelectedTelemetry({ entity, trackOptions, ru, debugOverlayVisible, controlledEntityId,
  onTakeControl, onExitControl, onDestroyControllable, onSelectTrack, onSetControlMode,
  onFollow, onOpenFpv, onOpenOls }) {
  const tr = term => localizeTechnicalTerm(term, ru ? UI_LANGUAGE.RU : UI_LANGUAGE.EN);
  if (!entity) return <aside className="advanced-telemetry is-empty">
    <span>{ru ? 'ВЫБЕРИТЕ ОБЪЕКТ' : 'SELECT ENTITY'}</span>
    <small>{ru ? 'Кликните по метке или используйте список' : 'Pick a marker or use the entity list'}</small>
  </aside>;
  const isInterceptor = entity.kind === ADVANCED_ENTITY_KIND.INTERCEPTOR;
  const entityKindLabel = isInterceptor
    ? 'MISSILE'
    : entity.kind === ADVANCED_ENTITY_KIND.SEARCH_RADAR
      ? 'SEARCH RADAR'
      : entity.kind === ADVANCED_ENTITY_KIND.CONTROLLABLE
        ? 'CONTROLLABLE AIR ENTITY'
      : 'AIR TARGET';
  const guidance = entity.guidanceDiagnostics ?? {};
  const visualDebug = debugOverlayVisible && entity.visualDebug ? (
    <dl className="advanced-telemetry__visual-debug">
      <div><dt>{tr('RENDER')}</dt><dd>{tr(entity.visualDebug.renderMode)}</dd></div>
      <div><dt>{tr('LOD')}</dt><dd>{tr(entity.visualDebug.lodState)}</dd></div>
      <div><dt>{tr('CAM DIST')}</dt><dd>{entity.visualDebug.distanceToCameraKm.toFixed(1)} km</dd></div>
      <div><dt>{tr('SCALE')}</dt><dd>{entity.visualDebug.visualScale.toFixed(2)}</dd></div>
      <div><dt>{tr('MODEL')}</dt><dd>{tr(entity.visualDebug.modelStatus)}</dd></div>
      <div><dt>{tr('PATH')}</dt><dd title={entity.visualDebug.resolvedModelPath}>{entity.visualDebug.resolvedModelPath.split('/').at(-1)}</dd></div>
    </dl>
  ) : null;
  return <aside className={`advanced-telemetry target-lock${entity.kind === ADVANCED_ENTITY_KIND.TARGET ? ' advanced-telemetry--target' : ''}${isInterceptor ? ' advanced-telemetry--missile' : ''}`}>
    <small>{tr(entityKindLabel)}</small>
    <h2>{entity.displayName}</h2>
    <strong>{entity.id}</strong>
    {isInterceptor ? <>
      <dl className="advanced-telemetry__summary">
        <div><dt>{tr('PHASE')}</dt><dd>{tr(entity.flightPhase ?? entity.kinematicPhase ?? '—')}</dd></div>
        <div><dt>{tr('GUIDANCE')}</dt><dd>{tr(entity.guidanceState ?? '—')}</dd></div>
        <div><dt>{tr('GUIDANCE SOURCE')}</dt><dd>{tr(entity.guidanceSource ?? 'NETWORK_TRACK')}</dd></div>
        <div><dt>{tr('TARGET')}</dt><dd>{entity.targetId ?? '—'}</dd></div>
        <div><dt>{tr('SEEKER')}</dt><dd>{tr(entity.seeker?.seekerType ?? 'NONE')}</dd></div>
        <div><dt>{tr('SEEKER STATE')}</dt><dd>{tr(entity.seeker?.state ?? 'OFF')}</dd></div>
        <div><dt>{tr('SOURCE')}</dt><dd>{entity.sourceBatteryId ?? entity.sourceRadarId ?? '—'}</dd></div>
        <div><dt>{tr('SPD')}</dt><dd>{Math.round(entity.speedKmh)} km/h</dd></div>
        <div><dt>{tr('ALT')}</dt><dd>{(entity.altitudeM / 1000).toFixed(2)} km</dd></div>
        <div><dt>G</dt><dd>{formatTelemetryMetric(entity.currentG, 1, ' / ')}{formatTelemetryMetric(entity.maximumG, 1, ' G')}</dd></div>
        <div><dt>{tr('RANGE')}</dt><dd>{formatTelemetryMetric(entity.distanceToTargetKm, 1, ' km')}</dd></div>
        <div><dt>{tr('CLOSING SPEED')}</dt><dd>{formatTelemetryMetric(entity.closingSpeedMps, 1, ' m/s')}</dd></div>
        <div><dt>{tr('TIME TO GO')}</dt><dd>{formatTelemetryMetric(entity.estimatedTimeToGoSec, 1, ' s')}</dd></div>
        <div><dt>{tr('INTERCEPT')}</dt><dd>{tr(entity.interceptSolutionStatus ?? '—')}</dd></div>
        {entity.seeker?.state && entity.seeker.state !== SEEKER_STATE.OFF && (
          <div><dt>{tr('SEEKER EVIDENCE')}</dt><dd>{formatTelemetryMetric(entity.seeker.evidence, 3)}</dd></div>
        )}
        {Number.isFinite(entity.seeker?.positionUncertaintyM) && (
          <div><dt>{tr('POSITION UNCERTAINTY')}</dt><dd>{formatTelemetryMetric(entity.seeker.positionUncertaintyM, 1, ' m')}</dd></div>
        )}
      </dl>
      <details className="advanced-telemetry__advanced">
        <summary>{tr('ADVANCED')}</summary>
        {visualDebug}
        <dl>
          <div><dt>{tr('LOS AZ / EL')}</dt><dd>{formatTelemetryMetric(guidance.losAzimuthDeg, 1, '°')} / {formatTelemetryMetric(guidance.losElevationDeg, 1, '°')}</dd></div>
          <div><dt>{tr('LOS RATE')}</dt><dd>{formatTelemetryMetric(guidance.losRateDegPerSec, 1, '°/s')}</dd></div>
          <div><dt>{tr('AZ / EL RATE')}</dt><dd>{formatTelemetryMetric(guidance.losAzimuthRateDegPerSec, 1, '°/s')} / {formatTelemetryMetric(guidance.losElevationRateDegPerSec, 1, '°/s')}</dd></div>
          <div><dt>{tr('HEADING ERROR')}</dt><dd>{formatTelemetryMetric(guidance.headingErrorDeg, 1, '°')}</dd></div>
          <div><dt>{tr('PITCH ERROR')}</dt><dd>{formatTelemetryMetric(guidance.pitchErrorDeg, 1, '°')}</dd></div>
          <div><dt>{tr('COMMAND H / V')}</dt><dd>{formatTelemetryMetric(guidance.commandedHorizontalG, 1, ' G')} / {formatTelemetryMetric(guidance.commandedVerticalG, 1, ' G')}</dd></div>
          <div><dt>{tr('ACTUAL H / V')}</dt><dd>{formatTelemetryMetric(guidance.actualHorizontalG, 1, ' G')} / {formatTelemetryMetric(guidance.actualVerticalG, 1, ' G')}</dd></div>
          <div><dt>{tr('REQUIRED H / V')}</dt><dd>{formatTelemetryMetric(guidance.requiredHorizontalG, 1, ' G')} / {formatTelemetryMetric(guidance.requiredVerticalG, 1, ' G')}</dd></div>
          <div><dt>{tr('AERO / ENERGY G')}</dt><dd>{formatTelemetryMetric(guidance.aeroAvailableG, 1, ' G')} / {formatTelemetryMetric(guidance.energyLimitedG, 1, ' G')}</dd></div>
          <div><dt>{tr('AUTOPILOT ALLOWED G')}</dt><dd>{formatTelemetryMetric(guidance.autopilotAllowedG, 1, ' G')}</dd></div>
          <div><dt>{tr('SEEKER RANGE')}</dt><dd>{formatTelemetryMetric(entity.seeker?.distanceKm, 2, ' km')} / {formatTelemetryMetric(entity.seeker?.effectiveRangeKm, 1, ' km')}</dd></div>
          <div><dt>{tr('ACQUISITION SCORE')}</dt><dd>{formatTelemetryMetric(entity.seeker?.acquisitionScore, 3)}</dd></div>
          <div><dt>{tr('SOURCE RADAR')}</dt><dd>{entity.sourceRadarId ?? '—'}</dd></div>
        </dl>
      </details>
    </> : <>
      <dl>
        <div><dt>{tr('ALT')}</dt><dd>{(entity.altitudeM / 1000).toFixed(2)} km</dd></div>
        <div><dt>{tr('SPD')}</dt><dd>{Math.round(entity.speedKmh)} km/h</dd></div>
        <div><dt>{tr('VZ')}</dt><dd>{entity.verticalSpeedMps >= 0 ? '+' : ''}{Math.round(entity.verticalSpeedMps)} m/s</dd></div>
        <div><dt>{tr(entity.ballistic ? 'FPA' : 'PITCH')}</dt><dd>{entity.pitchDeg.toFixed(1)}°</dd></div>
        {entity.targetId && <div><dt>{tr('TARGET')}</dt><dd>{entity.targetId}</dd></div>}
        {entity.distanceToTargetKm != null && <div><dt>{tr('DIST')}</dt><dd>{entity.distanceToTargetKm.toFixed(1)} km</dd></div>}
        {entity.guidanceState && <div><dt>{tr('GUIDANCE')}</dt><dd>{tr(entity.guidanceState)}</dd></div>}
        {entity.batteryRemaining != null && <div><dt>{tr('BATTERY')}</dt><dd>{Math.round(entity.batteryRemaining * 100)}%</dd></div>}
        {entity.batteryVoltageV != null && <div><dt>{tr('VOLTAGE')}</dt><dd>{entity.batteryVoltageV.toFixed(1)} V</dd></div>}
        {entity.currentAmps != null && <div><dt>{tr('CURRENT')}</dt><dd>{entity.currentAmps.toFixed(0)} A</dd></div>}
        {entity.currentPowerKw != null && <div><dt>{tr('POWER')}</dt><dd>{entity.currentPowerKw.toFixed(2)} kW</dd></div>}
        {entity.linkQuality != null && <div><dt>{tr('LINK')}</dt><dd>{Math.round(entity.linkQuality * 100)}%</dd></div>}
        {entity.flightTimeSec != null && <div><dt>{tr('FLIGHT')}</dt><dd>{formatFlightTime(entity.flightTimeSec)}</dd></div>}
        {entity.flightPhase && <div><dt>{tr('PHASE')}</dt><dd>{tr(entity.flightPhase)}</dd></div>}
      </dl>
      {visualDebug}
      {entity.kind === ADVANCED_ENTITY_KIND.CONTROLLABLE && <dl className="advanced-telemetry__visual-debug">
        <div><dt>{tr('CONTROL')}</dt><dd>{tr(controlledEntityId === entity.id ? 'MANUAL' : 'RELEASED')}</dd></div>
        <div><dt>{tr('SOURCE')}</dt><dd>{entity.launchSourceId ?? '—'}</dd></div>
        <div><dt>{tr('TRACK')}</dt><dd>{entity.selectedTrackId ?? '—'}</dd></div>
        <div><dt>{tr('COLLISION')}</dt><dd>{tr(entity.collisionState)}</dd></div>
        <div><dt>{tr('CAMERA')}</dt><dd>{tr(entity.cameraMode)}</dd></div>
        {debugOverlayVisible && <><div><dt>{tr('RAW INPUT')}</dt><dd>{formatControlVector(entity.rawInput)}</dd></div>
        <div><dt>{tr('SMOOTH INPUT')}</dt><dd>{formatControlVector(entity.smoothedInput)}</dd></div>
        <div><dt>{tr('DESIRED RATE')}</dt><dd>{formatRateVector(entity.desiredRatesDegPerSec)}</dd></div>
        <div><dt>{tr('ACTUAL RATE')}</dt><dd>{formatRateVector(entity.actualRatesDegPerSec)}</dd></div>
        <div><dt>{tr('MASS')}</dt><dd>{entity.forceTelemetry?.massKg?.toFixed(1) ?? '—'} KG</dd></div>
        <div><dt>{tr('THROTTLE')}</dt><dd>{entity.throttleDemand?.toFixed(2) ?? '—'}</dd></div>
        <div><dt>{tr('THRUST')}</dt><dd>{entity.forceTelemetry?.thrustN?.toFixed(1) ?? '—'} N</dd></div>
        <div><dt>{tr('DRAG')}</dt><dd>{entity.forceTelemetry?.dragN?.toFixed(1) ?? '—'} N</dd></div>
        <div><dt>{tr('VELOCITY ENU')}</dt><dd>{formatCartesianVector(entity.velocityVector)}</dd></div>
        <div><dt>{tr('ACCEL ENU')}</dt><dd>{formatCartesianVector(entity.accelerationVector)}</dd></div>
        <div><dt>{tr('PHYSICS POS')}</dt><dd>{formatPositionVector(entity.physicsPosition)}</dd></div>
        <div><dt>{tr('RENDER POS')}</dt><dd>{formatPositionVector(entity.renderPosition)}</dd></div>
        <div><dt>{tr('PHYSICS HPR')}</dt><dd>{formatRateVector(entity.physicsOrientation)}</dd></div>
        <div><dt>{tr('RENDER HPR')}</dt><dd>{formatRateVector(entity.renderOrientation)}</dd></div>
        <div><dt>{tr('PHYSICS CADENCE')}</dt><dd>{entity.visualCadence?.physicsIntervalMs?.toFixed(1) ?? '—'} MS</dd></div>
        <div><dt>{tr('RENDER CADENCE')}</dt><dd>{entity.visualCadence?.renderDeltaMs?.toFixed(1) ?? '—'} MS</dd></div>
        <div><dt>{tr('INTERPOLATION')}</dt><dd>{entity.visualCadence?.interpolationDurationMs?.toFixed(1) ?? '—'} MS</dd></div>
        <div><dt>{tr('EXTRAPOLATION')}</dt><dd>{entity.visualCadence?.extrapolationMs?.toFixed(1) ?? '—'} MS</dd></div></>}
      </dl>}
    </>}
    {entity.kind === ADVANCED_ENTITY_KIND.CONTROLLABLE && (
      <div className="advanced-telemetry__actions">
        <div className="advanced-telemetry__mode-row">
          {[CONTROLLABLE_CONTROL_MODE.MANUAL, CONTROLLABLE_CONTROL_MODE.HOLD,
            CONTROLLABLE_CONTROL_MODE.AUTO_NAV].map(mode => <button key={mode} type="button"
              className={entity.controlMode === mode ? 'is-active' : ''}
              onClick={() => onSetControlMode(entity.id, mode)}>{tr(mode)}</button>)}
        </div>
        <label className="advanced-telemetry__track-select">
          <span>{ru ? 'ТРАССА ЦЕЛИ' : 'TARGET TRACK'}</span>
          <select value={entity.selectedTrackId ?? ''}
            onChange={event => onSelectTrack(entity.id, event.target.value || null)}>
            <option value="">{ru ? 'БЕЗ ЦЕЛИ' : 'NO TARGET'}</option>
            {trackOptions.map(track => (
              <option key={track.id} value={track.id}>
                {track.displayName} · {track.id}
              </option>
            ))}
          </select>
        </label>
        {controlledEntityId === entity.id ? (
          <button type="button" onClick={onExitControl}>
            {ru ? 'ВЫЙТИ ИЗ УПРАВЛЕНИЯ' : 'EXIT CONTROL'}
          </button>
        ) : (
          <button type="button" onClick={() => onTakeControl(entity.id)}>
            {ru ? 'ВЗЯТЬ УПРАВЛЕНИЕ' : 'TAKE CONTROL'}
          </button>
        )}
        <button type="button" onClick={() => onFollow(entity.id)}>FOLLOW</button>
        <button type="button" onClick={() => onOpenFpv(entity.id)}>FPV</button>
        <button type="button" className="is-danger" onClick={() => onDestroyControllable(entity.id)}>
          {ru ? 'УДАЛИТЬ FPV' : 'DESTROY FPV'}
        </button>
      </div>
    )}
    {entity.kind === ADVANCED_ENTITY_KIND.TARGET && (
      <AdvancedFireControl key={entity.id} targetId={entity.id} ru={ru} />
    )}
    {entity.kind === ADVANCED_ENTITY_KIND.TARGET && (
      <div className="advanced-telemetry__actions">
        <button type="button" onClick={() => onOpenOls(entity.id)}>OLS · TRACK TARGET</button>
      </div>
    )}
  </aside>;
}

export default function AdvancedScene({ active = true, onVisualFrame, sandboxMode = false }) {
  const visualFrameObserverRef = useRef(onVisualFrame);
  useEffect(() => { visualFrameObserverRef.current = onVisualFrame; }, [onVisualFrame]);
  const activeRef = useRef(active);
  const prewarmFramesRef = useRef(12);
  useEffect(() => { activeRef.current = active; }, [active]);
  const olsControllerRef = useRef(null);
  const olsBracketRef = useRef(null);
  const olsFeedModeRef = useRef(false);
  const olsStationId = useGameStore(state => state.olsStationId);
  const olsMode = useOlsViewStore(state => state.mode);
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const cesiumEntitiesRef = useRef(new Map());
  const entityMetaRef = useRef(new Map());
  const interpolationRef = useRef(new Map());
  const visualStatesRef = useRef(new Map());
  const visualTimeRef = useRef(useEngine.getState().simulationTime - VISUAL_DELAY_SEC);
  const accumulatorRef = useRef(0);
  const frameTimesRef = useRef({ previous: null, samples: [] });
  const hitTimingRef = useRef({ vfxMs: 0, reconcileMs: 0, frameMaxMs: 0, untilMs: 0 });
  const trackCueEntitiesRef = useRef(new Map());
  const trailHistoryRef = useRef(new Map());
  const trailEntityRef = useRef([]);
  const plumeEntitiesRef = useRef(new Map());
  const smokePuffsRef = useRef([]);
  const smokeStrandsRef = useRef(new Map());
  const launchEffectsRef = useRef(new Map());
  const sensorExposureRef = useRef({ heat: 0, flashAt: -Infinity, flashStrength: 0, lastFrameAt: 0 });
  const thermalTrailEntitiesRef = useRef(new Map());
  const radarBeamEntitiesRef = useRef(new Map());
  const seekerDebugEntitiesRef = useRef(new Map());
  const rawMeasurementEntitiesRef = useRef(new Map());
  const guidanceDebugEntitiesRef = useRef(null);
  const fpvAttitudeRef = useRef(null);
  const fpvMapContactRef = useRef(null);
  const fpvTargetCueRef = useRef(null);
  const fpvEdgeCueRef = useRef(null);
  const lastSmokeSampleRef = useRef(new Map());
  const interceptEffectsRef = useRef(new Map());
  const asterBoosterDebrisRef = useRef(new Map());
  const trackRangeHistoryRef = useRef(new Map());
  const altitudeReferenceRef = useRef(null);
  const cameraControllerRef = useRef(null);
  const selectedKeyRef = useRef(null);
  const cameraModeRef = useRef(CAMERA_MODE.FREE);
  const visualModeRef = useRef(ADVANCED_VISUAL_MODE.DAY);
  const fpvFeedModeRef = useRef(false);
  const modelAvailabilityRef = useRef(new Map());
  const olsFromAdvancedRef = useRef(false);
  const torOlsReturnRef = useRef(null);
  const advancedFpvReturnRef = useRef(null);
  const returnToCommand = useGameStore(state => state.returnToCommand);
  const returnToMenu = useGameStore(state => state.returnToMenu);
  const presentationMode = useGameStore(state => state.presentationMode);
  const fpvFeedEntityId = useGameStore(state => state.fpvFeedEntityId);
  const olsRequestedTargetKey = useGameStore(state => state.olsRequestedTargetKey);
  const torOlsManual = useGameStore(state => state.torOlsManual);
  const torOlsReturnScene = useGameStore(state => state.torOlsReturnScene);
  const language = useGameStore(state => state.language);
  const debugOverlayVisible = useViewStore(state => state.layers.debugOverlay);
  const advancedOverlays = useViewStore(state => state.advancedOverlays);
  const [engineeringEnabled, setEngineeringEnabled] = useState(false);
  const overlaysRef = useRef(effectiveAdvancedOverlays(advancedOverlays, false));
  useEffect(() => { overlaysRef.current = effectiveAdvancedOverlays(advancedOverlays, engineeringEnabled); }, [advancedOverlays, engineeringEnabled]);
  const ru = language === UI_LANGUAGE.RU;
  const tick = useEngine(state => state.tick);
  const publishVisualSnapshot = useEngine(state => state.publishVisualSnapshot);
  const timeScale = useEngine(state => state.timeScale);
  const setTimeScale = useEngine(state => state.setTimeScale);
  const spawnControllableTestEntity = useEngine(state => state.spawnControllableTestEntity);
  const setSelectedControllableEntity = useEngine(state => state.setSelectedControllableEntity);
  const setSelectedTrack = useEngine(state => state.setSelectedTrack);
  const setControlledControllableEntity = useEngine(state => state.setControlledControllableEntity);
  const setControllableCameraMode = useEngine(state => state.setControllableCameraMode);
  const setControllableControlMode = useEngine(state => state.setControllableControlMode);
  const setControllableNavigationTrack = useEngine(state => state.setControllableNavigationTrack);
  const controlledControllableEntityId = useEngine(state => state.controlledControllableEntityId);
  const releaseControllableControl = useEngine(state => state.releaseControllableControl);
  const destroyControllableEntity = useEngine(state => state.destroyControllableEntity);
  const [activeFpvEntityId, setActiveFpvEntityId] = useState(null);
  const monitoredFpvEntityId = activeFpvEntityId ?? fpvFeedEntityId;
  const fpvFeedConnected = useEngine(state => {
    if (!monitoredFpvEntityId) return true;
    const entity = state.controllableAirEntities.find(candidate => candidate.id === monitoredFpvEntityId);
    return entity?.status === 'ACTIVE' && (entity.linkQuality ?? 1) > 0;
  });
  const setControllableSelectedTrack = useEngine(state => state.setControllableSelectedTrack);
  const [cameraMode, setCameraModeState] = useState(CAMERA_MODE.FREE);
  const [selectedKey, setSelectedKey] = useState(null);
  const [sandboxTrajectoryTrailEnabled, setSandboxTrajectoryTrailEnabled] = useState(false);
  const sandboxTrajectoryTrailEnabledRef = useRef(false);
  useEffect(() => { sandboxTrajectoryTrailEnabledRef.current = sandboxTrajectoryTrailEnabled; }, [sandboxTrajectoryTrailEnabled]);
  const sandboxModeRef = useRef(sandboxMode);
  useEffect(() => { sandboxModeRef.current = sandboxMode; }, [sandboxMode]);
  const [selectedTelemetry, setSelectedTelemetry] = useState(null);
  const [entitySnapshot, setEntitySnapshot] = useState({
    targets: [], missiles: [], searchRadars: [], controllables: [], tracks: [],
  });
  const [performanceSnapshot, setPerformanceSnapshot] = useState({ fps: 0, renderMs: 0, simulationMs: 0 });
  const [cameraToast, setCameraToast] = useState(null);
  const [controlDetailsEntityId, setControlDetailsEntityId] = useState(null);
  const [viewerReady, setViewerReady] = useState(null);
  const [groundSelected, setGroundSelected] = useState(null);
  const visualMode = olsMode;
  const setVisualMode = useOlsViewStore(state => state.setMode);
  const [lastFpvTelemetry, setLastFpvTelemetry] = useState(null);
  const fpvFeedMode = presentationMode === PRESENTATION_MODE.FPV_FEED;
  const olsFeedMode = presentationMode === PRESENTATION_MODE.OLS_FEED;
  const cameraFeedMode = fpvFeedMode || olsFeedMode || cameraMode === CAMERA_MODE.FPV;
  const signalLost = cameraMode === CAMERA_MODE.FPV
    && Boolean(monitoredFpvEntityId) && !fpvFeedConnected;

  useEffect(() => {
    if (sandboxMode && !useGameStore.getState().resumeCommandSimulation
      && useGameStore.getState().presentationMode === PRESENTATION_MODE.ADVANCED) {
      useEngine.getState().resetScenario('SANDBOX');
    }
  }, [sandboxMode]);

  useEffect(() => {
    visualModeRef.current = visualMode;
  }, [visualMode]);

  useEffect(() => { olsFeedModeRef.current = olsFeedMode; }, [olsFeedMode]);

  useEffect(() => {
    fpvFeedModeRef.current = fpvFeedMode;
  }, [fpvFeedMode]);

  const showCameraToast = useCallback(label => {
    setCameraToast(label);
    window.setTimeout(() => setCameraToast(current => current === label ? null : current), 900);
  }, []);

  const setCameraMode = useCallback(mode => {
    const selection = parseSelectionKey(selectedKeyRef.current);
    if (selection?.kind === ADVANCED_ENTITY_KIND.CONTROLLABLE
      && Object.values(CONTROLLABLE_CAMERA_MODE).includes(mode)) {
      setControllableCameraMode(selection.id, mode);
    }
    cameraModeRef.current = mode;
    cameraControllerRef.current?.setMode(mode, true);
    setCameraModeState(mode);
  }, [setControllableCameraMode]);

  const resetCamera = useCallback(() => {
    cameraControllerRef.current?.resetView();
  }, []);

  const enterAdvancedFpv = useCallback(id => {
    const viewer = viewerRef.current;
    const entity = useEngine.getState().controllableAirEntities.find(candidate => candidate.id === id);
    if (!viewer || entity?.status !== 'ACTIVE') { showCameraToast('NO FPV DRONE AVAILABLE'); return; }
    if (advancedFpvReturnRef.current) return;
    advancedFpvReturnRef.current = {
      entityId: id,
      mode: cameraModeRef.current,
      destination: Cartesian3.clone(viewer.camera.positionWC),
      direction: Cartesian3.clone(viewer.camera.directionWC),
      up: Cartesian3.clone(viewer.camera.upWC),
    };
    setSelectedControllableEntity(id);
    setActiveFpvEntityId(id);
    selectedKeyRef.current = makeSelectionKey(ADVANCED_ENTITY_KIND.CONTROLLABLE, id);
    setSelectedKey(selectedKeyRef.current);
    setControllableControlMode(id, CONTROLLABLE_CONTROL_MODE.MANUAL);
    setControlledControllableEntity(id);
    setCameraMode(CAMERA_MODE.FPV);
    cameraControllerRef.current?.beginFpvTransition(1.5);
  }, [setCameraMode, setControllableControlMode, setControlledControllableEntity,
    setSelectedControllableEntity, showCameraToast]);

  const exitAdvancedFpv = useCallback(() => {
    const saved = advancedFpvReturnRef.current;
    advancedFpvReturnRef.current = null;
    setActiveFpvEntityId(null);
    releaseControllableControl();
    setCameraMode(CAMERA_MODE.FREE);
    if (saved?.entityId) setControllableCameraMode(saved.entityId, CONTROLLABLE_CAMERA_MODE.THIRD_PERSON);
    const viewer = viewerRef.current;
    if (!saved || !viewer || viewer.isDestroyed()) return;
    viewer.camera.flyTo({ destination: saved.destination,
      orientation: { direction: saved.direction, up: saved.up }, duration: 1.5,
      complete: () => { if (saved.mode !== CAMERA_MODE.FREE) setCameraMode(saved.mode); } });
  }, [releaseControllableControl, setCameraMode, setControllableCameraMode]);

  const returnToCommandSafely = useCallback(() => {
    if (useGameStore.getState().torOlsReturnScene) {
      const saved = torOlsReturnRef.current;
      torOlsReturnRef.current = null;
      olsControllerRef.current?.leave();
      useOlsViewStore.getState().release();
      useGameStore.getState().returnFromTorOls();
      if (saved) requestAnimationFrame(() => {
        const viewer = viewerRef.current;
        if (!viewer || viewer.isDestroyed()) return;
        viewer.camera.setView({ destination: saved.destination,
          orientation: { direction: saved.direction, up: saved.up } });
        setCameraMode(saved.mode);
      });
      return;
    }
    setActiveFpvEntityId(null);
    releaseControllableControl();
    if (olsFromAdvancedRef.current) {
      olsFromAdvancedRef.current = false;
      if (sandboxMode) useGameStore.getState().openAdvancedSandbox();
      else useGameStore.getState().openAdvanced3D();
      return;
    }
    if (cameraFeedMode) returnToCommand();
    else returnToMenu();
  }, [cameraFeedMode, releaseControllableControl, returnToCommand, returnToMenu, sandboxMode, setCameraMode]);

  const openCanonicalTorOls = useCallback((station, targetKey = null) => {
    const viewer = viewerRef.current;
    if (!station || station.category !== 'TOR_M1' || !viewer || viewer.isDestroyed()) return;
    torOlsReturnRef.current = {
      mode: cameraModeRef.current,
      destination: Cartesian3.clone(viewer.camera.positionWC),
      direction: Cartesian3.clone(viewer.camera.directionWC),
      up: Cartesian3.clone(viewer.camera.upWC),
    };
    useGameStore.getState().openTorOlsFeed(station.id,
      station.controlMode === BATTERY_CONTROL_MODE.MANUAL, targetKey);
  }, []);

  useEffect(() => () => {
    useOlsViewStore.getState().release();
    releaseControllableControl();
  }, [releaseControllableControl]);

  useEffect(() => {
    if (!fpvFeedMode || !viewerReady) return;
    const frame = requestAnimationFrame(() => {
    const entity = useEngine.getState().controllableAirEntities.find(item => item.id === fpvFeedEntityId);
    if (entity?.status !== 'ACTIVE') { showCameraToast('NO FPV DRONE AVAILABLE'); returnToCommandSafely(); return; }
    selectedKeyRef.current = makeSelectionKey(ADVANCED_ENTITY_KIND.CONTROLLABLE, entity.id);
    setSelectedKey(selectedKeyRef.current);
    setSelectedControllableEntity(entity.id);
    setActiveFpvEntityId(entity.id);
    setControllableControlMode(entity.id, CONTROLLABLE_CONTROL_MODE.MANUAL);
    setControlledControllableEntity(entity.id);
    setCameraMode(CAMERA_MODE.FPV);
    });
    return () => cancelAnimationFrame(frame);
  }, [fpvFeedMode, fpvFeedEntityId, viewerReady, setCameraMode,
    setControllableControlMode, setControlledControllableEntity,
    setSelectedControllableEntity, returnToCommandSafely, showCameraToast]);

  useEffect(() => {
    if (controlledControllableEntityId) return;
    const onKey = event => {
      if (event.code === 'Escape' && !event.repeat) {
        if (fpvFeedMode) returnToCommandSafely();
        else if (advancedFpvReturnRef.current) exitAdvancedFpv();
        else if (groundSelected || selectedKeyRef.current) {
          setGroundSelected(null);
          selectedKeyRef.current = null;
          setSelectedKey(null);
          setSelectedTelemetry(null);
        }
      }
      if (event.code === 'KeyV' && fpvFeedMode && !event.repeat) setVisualMode(cycleVisualMode(useOlsViewStore.getState().mode));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controlledControllableEntityId, fpvFeedMode, groundSelected, returnToCommandSafely,
    exitAdvancedFpv, setVisualMode]);

  useEffect(() => {
    if (!viewerReady) return undefined;
    const viewer = viewerRef.current;
    if (!viewer || viewer !== viewerReady || viewer.isDestroyed()) return undefined;
    prewarmFramesRef.current = 12;
    viewer.useDefaultRenderLoop = true;
    if (!active) return undefined;
    visualTimeRef.current = useEngine.getState().simulationTime - VISUAL_DELAY_SEC;
    if (olsFeedMode) {
      releaseControllableControl();
      cameraControllerRef.current?.setMode(CAMERA_MODE.FREE, false);
      const state = useEngine.getState();
      const station = [...state.searchRadars, ...state.batteries].find(s => s.id === olsStationId);
      // An estimated radar cue may set the initial viewing direction. Optical
      // lock is still empty until the player chooses a visible rendered entity.
      const requestedTargetId = olsRequestedTargetKey?.startsWith('TARGET:')
        ? olsRequestedTargetKey.slice('TARGET:'.length) : null;
      const cue = state.tracks.find(t => t.targetId === requestedTargetId && isAvailableNetworkTrack(t))
        ?? state.tracks.find(t => t.id === state.selectedTrackId && isAvailableNetworkTrack(t))
        ?? state.tracks.find(t => t.sourceBatteryId === olsStationId && isAvailableNetworkTrack(t));
      if (station) olsControllerRef.current?.enter(station, cue,
        torOlsManual ? null : olsRequestedTargetKey,
        { manualControl: station.category === 'TOR_M1'
          && station.controlMode === BATTERY_CONTROL_MODE.MANUAL });
    }
    return () => olsControllerRef.current?.leave();
  }, [active, viewerReady, olsFeedMode, olsStationId, olsRequestedTargetKey,
    torOlsManual, releaseControllableControl]);

  useEffect(() => {
    if (!signalLost) return undefined;
    const timer = window.setTimeout(() => {
      if (advancedFpvReturnRef.current) exitAdvancedFpv();
      else returnToCommandSafely();
    }, 2300);
    return () => window.clearTimeout(timer);
  }, [exitAdvancedFpv, returnToCommandSafely, signalLost]);

  const selectEntity = useCallback((key, focus = true) => {
    const selection = parseSelectionKey(key);
    const controlledId = useEngine.getState().controlledControllableEntityId;
    const manualCameraActive = [
      CAMERA_MODE.THIRD_PERSON,
      CAMERA_MODE.FIRST_PERSON,
      CAMERA_MODE.FPV,
    ].includes(cameraModeRef.current);
    const releaseManualCamera = () => {
      if (!manualCameraActive) return;
      const nextMode = key ? CAMERA_MODE.FOLLOW : CAMERA_MODE.FREE;
      cameraModeRef.current = nextMode;
      cameraControllerRef.current?.setMode(nextMode, true);
      setCameraModeState(nextMode);
    };
    if (selection?.kind === ADVANCED_ENTITY_KIND.CONTROLLABLE) {
      setSelectedControllableEntity(selection.id);
      if (controlledId !== selection.id) {
        releaseControllableControl();
        releaseManualCamera();
      }
    } else {
      setControlledControllableEntity(null);
      releaseManualCamera();
    }
    selectedKeyRef.current = key;
    setSelectedKey(key);
    if (focus && key && cameraModeRef.current === CAMERA_MODE.FREE) {
      cameraModeRef.current = CAMERA_MODE.FOLLOW;
      cameraControllerRef.current?.setMode(CAMERA_MODE.FOLLOW, true);
      setCameraModeState(CAMERA_MODE.FOLLOW);
    }
  }, [releaseControllableControl, setControlledControllableEntity,
    setSelectedControllableEntity]);

  useEffect(() => {
    if (!controlledControllableEntityId) return undefined;
    const entity = useEngine.getState().controllableAirEntities.find(
      candidate => candidate.id === controlledControllableEntityId,
    );
    if (!entity || entity.cameraMode !== CONTROLLABLE_CAMERA_MODE.FPV) return undefined;
    const key = makeSelectionKey(ADVANCED_ENTITY_KIND.CONTROLLABLE, entity.id);
    const requestId = requestAnimationFrame(() => {
      selectEntity(key, false);
      setCameraMode(CAMERA_MODE.FPV);
    });
    return () => cancelAnimationFrame(requestId);
  }, [controlledControllableEntityId, selectEntity, setCameraMode]);

  useEffect(() => {
    if (!controlledControllableEntityId || !viewerReady) return undefined;
    const pressed = new Set();
    const controlledEntity = useEngine.getState().controllableAirEntities.find(
      candidate => candidate.id === controlledControllableEntityId,
    );
    const mouseConfig = getControllableAirProfile(controlledEntity?.profileId)
      .controller?.mouseControl ?? {};
    let desiredThrottle = clamp(controlledEntity?.throttleDemand ?? 0.42, 0, 1);
    let mouseTarget = { pitch: 0, yaw: 0, roll: 0 };
    let mouseSmoothed = { pitch: 0, yaw: 0, roll: 0 };
    let lastMouseInputMs = 0;
    let previousFrameMs = performance.now();
    let animationFrame;
    const responseCurve = value => {
      const deadzone = mouseConfig.deadzone ?? 0.012;
      if (Math.abs(value) <= deadzone) return 0;
      const normalized = clamp((Math.abs(value) - deadzone) / (1 - deadzone), 0, 1);
      return Math.sign(value) * normalized ** (mouseConfig.responseExponent ?? 1.18);
    };
    const publish = timestamp => {
      const deltaSec = clamp((timestamp - previousFrameMs) / 1000, 0, 0.05);
      previousFrameMs = timestamp;
      const throttleDirection = (pressed.has('KeyW') ? 1 : 0)
        - (pressed.has('KeyS') ? 1 : 0);
      const fineThrottleScale = pressed.has('ShiftLeft') || pressed.has('ShiftRight') ? 0.22 : 1;
      desiredThrottle = clamp(desiredThrottle + throttleDirection
        * (mouseConfig.throttleStepPerSec ?? 0.72) * fineThrottleScale * deltaSec, 0, 1);
      const engineState = useEngine.getState();
      const liveEntity = engineState.controllableAirEntities.find(
        candidate => candidate.id === controlledControllableEntityId,
      );
      const assist = useManualControlStore.getState().throttleAssist;
      const selectedTrack = engineState.tracks.find(
        candidate => candidate.id === liveEntity?.selectedTrackId,
      );
      const assistedSpeedMps = getAssistTargetSpeedMps(assist, selectedTrack);
      if (assist.mode !== THROTTLE_ASSIST_MODE.OFF && assistedSpeedMps > 0
        && throttleDirection === 0 && liveEntity) {
        desiredThrottle = updateAssistedThrottle({ throttle: desiredThrottle,
          speedMps: (liveEntity.speedKmh ?? 0) / 3.6,
          targetSpeedMps: assistedSpeedMps, deltaSec });
      }
      if (timestamp - lastMouseInputMs > 85) mouseTarget = { pitch: 0, yaw: 0, roll: 0 };
      const smoothingAlpha = 1 - Math.exp(-deltaSec
        / Math.max(0.01, mouseConfig.smoothingTimeSec ?? 0.055));
      const releaseAlpha = 1 - Math.exp(-deltaSec
        / Math.max(0.01, mouseConfig.releaseTimeSec ?? 0.11));
      const mouseAlpha = timestamp - lastMouseInputMs > 85 ? releaseAlpha : smoothingAlpha;
      mouseSmoothed.pitch += (mouseTarget.pitch - mouseSmoothed.pitch) * mouseAlpha;
      mouseSmoothed.yaw += (mouseTarget.yaw - mouseSmoothed.yaw) * mouseAlpha;
      mouseSmoothed.roll += (mouseTarget.roll - mouseSmoothed.roll) * mouseAlpha;
      const keyboardPitch = (pressed.has('ArrowUp') ? 1 : 0)
        - (pressed.has('ArrowDown') ? 1 : 0);
      const keyboardYaw = (pressed.has('KeyD') || pressed.has('ArrowRight') ? 1 : 0)
        - (pressed.has('KeyA') || pressed.has('ArrowLeft') ? 1 : 0);
      useManualControlStore.getState().setCommand(controlledControllableEntityId, {
        throttle: desiredThrottle,
        pitch: clamp(keyboardPitch + mouseSmoothed.pitch, -1, 1),
        yaw: clamp(keyboardYaw + mouseSmoothed.yaw, -1, 1),
        roll: clamp((pressed.has('KeyE') ? 1 : 0) - (pressed.has('KeyQ') ? 1 : 0)
          + mouseSmoothed.roll, -1, 1),
      });
      animationFrame = requestAnimationFrame(publish);
    };
    const isEditable = target => target instanceof HTMLElement
      && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    const onKeyDown = event => {
      if (isEditable(event.target)) return;
      if (event.code === 'KeyC' && !event.repeat) {
        const entity = useEngine.getState().controllableAirEntities.find(
          candidate => candidate.id === controlledControllableEntityId,
        );
        const modes = Object.values(CONTROLLABLE_CAMERA_MODE);
        const nextMode = modes[(modes.indexOf(entity?.cameraMode) + 1) % modes.length];
        setCameraMode(nextMode);
        showCameraToast(`CAMERA: ${nextMode.replace('_PERSON', '')}`);
        event.preventDefault();
        return;
      }
      if (event.code === 'Escape' && !event.repeat) {
        if (fpvFeedMode) returnToCommandSafely();
        else if (cameraModeRef.current === CAMERA_MODE.FPV && advancedFpvReturnRef.current) exitAdvancedFpv();
        else {
          releaseControllableControl();
          setCameraMode(CAMERA_MODE.FREE);
          showCameraToast(ru ? 'УПРАВЛЕНИЕ ОТКЛЮЧЕНО' : 'CONTROL RELEASED');
        }
        event.preventDefault();
        return;
      }
      if (event.code === 'KeyV' && !event.repeat && fpvFeedMode) {
        setVisualMode(cycleVisualMode(useOlsViewStore.getState().mode));
        event.preventDefault();
        return;
      }
      if (['KeyH', 'KeyM', 'KeyP', 'KeyX'].includes(event.code) && !event.repeat) {
        const engineState = useEngine.getState();
        const entity = engineState.controllableAirEntities.find(
          candidate => candidate.id === controlledControllableEntityId,
        );
        const track = engineState.tracks.find(candidate => candidate.id === entity?.selectedTrackId);
        const setAssist = useManualControlStore.getState().setThrottleAssist;
        if (event.code === 'KeyH') setAssist(controlledControllableEntityId,
          THROTTLE_ASSIST_MODE.SPEED_HOLD, (entity?.speedKmh ?? 0) / 3.6);
        else if (event.code === 'KeyM' && Number.isFinite(track?.reportedSpeedKmh)) {
          setAssist(controlledControllableEntityId, THROTTLE_ASSIST_MODE.MATCH_SPEED);
        } else if (event.code === 'KeyP' && Number.isFinite(track?.reportedSpeedKmh)) {
          setAssist(controlledControllableEntityId, THROTTLE_ASSIST_MODE.APPROACH);
        } else setAssist(controlledControllableEntityId, THROTTLE_ASSIST_MODE.OFF);
        event.preventDefault();
        return;
      }
      if (!['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) return;
      const controlled = useEngine.getState().controllableAirEntities.find(
        candidate => candidate.id === controlledControllableEntityId);
      if (controlled?.controlMode !== CONTROLLABLE_CONTROL_MODE.MANUAL) {
        useEngine.getState().setControllableControlMode(controlledControllableEntityId,
          CONTROLLABLE_CONTROL_MODE.MANUAL);
      }
      pressed.add(event.code);
      if (['KeyW', 'KeyS'].includes(event.code)) {
        useManualControlStore.getState().setThrottleAssist(controlledControllableEntityId,
          THROTTLE_ASSIST_MODE.OFF);
      }
      event.preventDefault();
    };
    const onKeyUp = event => {
      if (!pressed.delete(event.code)) return;
      event.preventDefault();
    };
    const onMouseMove = event => {
      const canvas = viewerRef.current?.scene?.canvas;
      if (!canvas || (document.pointerLockElement !== canvas && (event.buttons & 1) === 0)) return;
      const controlled = useEngine.getState().controllableAirEntities.find(
        candidate => candidate.id === controlledControllableEntityId);
      if (controlled?.controlMode !== CONTROLLABLE_CONTROL_MODE.MANUAL) {
        useEngine.getState().setControllableControlMode(controlledControllableEntityId,
          CONTROLLABLE_CONTROL_MODE.MANUAL);
      }
      const horizontalCommand = responseCurve(
        event.movementX * (mouseConfig.sensitivityX ?? 0.027),
      );
      mouseTarget = {
        pitch: responseCurve(-event.movementY * (mouseConfig.sensitivityY ?? 0.032)),
        yaw: horizontalCommand,
        roll: horizontalCommand * (mouseConfig.rollCoupling ?? 0.58),
      };
      lastMouseInputMs = performance.now();
    };
    const onPointerDown = event => {
      const canvas = viewerRef.current?.scene?.canvas;
      if (!canvas || event.button !== 0 || event.target !== canvas) return;
      canvas.requestPointerLock?.();
    };
    const onWheel = event => {
      const canvas = viewerRef.current?.scene?.canvas;
      if (!canvas || document.pointerLockElement !== canvas) return;
      desiredThrottle = clamp(desiredThrottle
        - event.deltaY * (mouseConfig.wheelThrottleScale ?? 0.00065), 0, 1);
      event.preventDefault();
    };
    const clear = () => {
      pressed.clear();
      mouseTarget = { pitch: 0, yaw: 0, roll: 0 };
      useManualControlStore.getState().clearCommand(controlledControllableEntityId);
    };
    const canvas = viewerRef.current?.scene?.canvas;
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clear);
    document.addEventListener('mousemove', onMouseMove);
    canvas?.addEventListener('pointerdown', onPointerDown);
    canvas?.addEventListener('wheel', onWheel, { passive: false });
    animationFrame = requestAnimationFrame(publish);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clear);
      document.removeEventListener('mousemove', onMouseMove);
      canvas?.removeEventListener('pointerdown', onPointerDown);
      canvas?.removeEventListener('wheel', onWheel);
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
      clear();
    };
  }, [controlledControllableEntityId, exitAdvancedFpv, fpvFeedMode, releaseControllableControl,
    returnToCommandSafely, ru, setCameraMode, setVisualMode, showCameraToast, viewerReady]);

  useEffect(() => {
    setPerformanceMonitoringEnabled(true);
    return () => setPerformanceMonitoringEnabled(false);
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const fixedStepSec = 1 / PHYSICS_UPDATE_HZ;
    const maximumSubsteps = 8;
    let previousTimestamp = performance.now();
    let accumulatorSec = accumulatorRef.current;
    let animationFrame;
    const advance = timestamp => {
      const elapsedRealSec = Math.min(0.25, Math.max(0, (timestamp - previousTimestamp) / 1000));
      previousTimestamp = timestamp;
      if (timeScale > 0) {
        accumulatorSec = Math.min(accumulatorSec + elapsedRealSec * timeScale,
          fixedStepSec * maximumSubsteps);
        let substeps = 0;
        while (accumulatorSec >= fixedStepSec && substeps < maximumSubsteps) {
          tick(timeScale);
          accumulatorSec -= fixedStepSec;
          substeps += 1;
        }
      }
      accumulatorRef.current = accumulatorSec;
      if (timeScale > 0) visualTimeRef.current = useEngine.getState().simulationTime
        + accumulatorSec - VISUAL_DELAY_SEC;
      animationFrame = requestAnimationFrame(advance);
    };
    animationFrame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(animationFrame);
  }, [tick, timeScale, active]);

  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(publishVisualSnapshot, 1000 / 20);
    return () => window.clearInterval(timer);
  }, [publishVisualSnapshot, active]);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const cesiumEntities = cesiumEntitiesRef.current;
    const entityMetadata = entityMetaRef.current;
    const interpolationCache = interpolationRef.current;
    const visualStates = visualStatesRef.current;
    const trackCueEntities = trackCueEntitiesRef.current;
    const trailHistory = trailHistoryRef.current;
    const plumeEntities = plumeEntitiesRef.current;
    const smokePuffs = smokePuffsRef.current;
    const smokeStrands = smokeStrandsRef.current;
    const launchEffects = launchEffectsRef.current;
    const sensorExposure = sensorExposureRef.current;
    const thermalTrailEntities = thermalTrailEntitiesRef.current;
    const radarBeamEntities = radarBeamEntitiesRef.current;
    const seekerDebugEntities = seekerDebugEntitiesRef.current;
    const rawMeasurementEntities = rawMeasurementEntitiesRef.current;
    const lastSmokeSample = lastSmokeSampleRef.current;
    const interceptEffects = interceptEffectsRef.current;
    const asterBoosterDebris = asterBoosterDebrisRef.current;
    let trackArray = null;
    let tracksById = new Map();
    const readTrackPose = id => {
      const state = useEngine.getState();
      if (trackArray !== state.tracks) {
        trackArray = state.tracks;
        tracksById = new Map(trackArray.map(track => [track.id, track]));
      }
      return sampleTrackPresentation(interpolationCache, `track:${id}`,
        tracksById.get(id), visualTimeRef.current, performance.now());
    };
    let disposed = false;
    const imageryProvider = new UrlTemplateImageryProvider({
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      maximumLevel: 16,
      credit: 'Imagery © Esri',
    });
    const viewer = new CesiumViewer(containerRef.current, {
      baseLayer: new ImageryLayer(imageryProvider),
      terrainProvider: new EllipsoidTerrainProvider(),
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: true,
    });
    viewerRef.current = viewer;
    setViewerReady(viewer);
    const createDynamicPolyline = (id, color, width = 1.4) => {
      let positions = [];
      const entity = viewer.entities.add({
        id,
        show: false,
        polyline: {
          positions: new CallbackProperty(() => positions, false),
          width,
          material: color,
          arcType: ArcType.NONE,
          depthFailMaterial: color.withAlpha(Math.min(0.22, color.alpha)),
        },
      });
      return { entity, updatePositions: next => { positions = next; } };
    };
    const createDynamicMarker = (id, label, color) => {
      let position;
      const entity = viewer.entities.add({
        id,
        show: false,
        position: new CallbackPositionProperty((_time, result) => position
          ? Cartesian3.clone(position, result) : undefined, false),
        point: {
          pixelSize: 9,
          color,
          outlineColor: Color.fromCssColorString('#071014'),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: label,
          font: '600 10px monospace',
          fillColor: color,
          outlineColor: Color.fromCssColorString('#071014'),
          outlineWidth: 3,
          pixelOffset: new Cartesian2(10, -10),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      return { entity, updatePosition: next => { position = next; } };
    };
    const seekerConeAxisCorrection = Quaternion.fromAxisAngle(
      Cartesian3.UNIT_Y,
      Math.PI / 2,
      new Quaternion(),
    );
    const createDynamicSeekerCone = id => {
      const state = {
        position: new Cartesian3(),
        orientation: new Quaternion(),
        length: 1_000,
        radius: 100,
      };
      const entity = viewer.entities.add({
        id,
        show: false,
        position: new CallbackPositionProperty((_time, result) => Cartesian3.clone(
          state.position, result), false),
        orientation: new CallbackProperty((_time, result) => Quaternion.clone(
          state.orientation, result), false),
        cylinder: {
          length: new CallbackProperty(() => state.length, false),
          topRadius: 0,
          bottomRadius: new CallbackProperty(() => state.radius, false),
          material: Color.fromCssColorString('#55e0b2').withAlpha(0.18),
          outline: false,
          slices: 24,
          distanceDisplayCondition: new DistanceDisplayCondition(0, 260_000),
        },
      });
      return {
        entity,
        updatePose: ({ position, orientation, length, radius }) => {
          Cartesian3.clone(position, state.position);
          Quaternion.clone(orientation, state.orientation);
          state.length = length;
          state.radius = radius;
        },
      };
    };
    const createSeekerDebugEntities = id => ({
      fov: createDynamicSeekerCone(`advanced-seeker-fov:${id}`),
      boresight: createDynamicPolyline(
        `advanced-seeker-boresight:${id}`,
        Color.fromCssColorString('#62e6b5').withAlpha(0.72),
        1.35,
      ),
      targetLos: createDynamicPolyline(
        `advanced-seeker-target-los:${id}`,
        Color.fromCssColorString('#8cffc8').withAlpha(0.84),
        2,
      ),
    });
    const removeSeekerDebugEntities = seekerDebug => {
      if (!seekerDebug) return;
      viewer.entities.remove(seekerDebug.fov.entity);
      viewer.entities.remove(seekerDebug.boresight.entity);
      viewer.entities.remove(seekerDebug.targetLos.entity);
    };
    const createRadarBeam = id => {
      let scanPositions = [];
      // Cesium's polygon geometry requires a PolygonHierarchy object. Keep a
      // valid placeholder until the first scan update arrives so toggling the
      // debug layer can never hand an undefined positions array to the globe.
      let sectorHierarchy = new PolygonHierarchy([
        Cartesian3.fromDegrees(30, 50, 0),
        Cartesian3.fromDegrees(30.001, 50, 0),
        Cartesian3.fromDegrees(30, 50.001, 0),
      ]);
      const beam = viewer.entities.add({
        id: `advanced-radar-beam:${id}`,
        show: false,
        polyline: {
          positions: new CallbackProperty(() => scanPositions, false), width: 1,
          material: Color.fromCssColorString('#72d8d0').withAlpha(0.055),
          arcType: ArcType.GEODESIC,
          distanceDisplayCondition: new DistanceDisplayCondition(0, 2_500_000),
        },
      });
      const sector = viewer.entities.add({
        id: `advanced-radar-sector:${id}`,
        show: false,
        polygon: {
          hierarchy: new CallbackProperty(() => sectorHierarchy, false),
          material: Color.fromCssColorString('#52cbbd').withAlpha(0.012),
          outline: false,
          outlineColor: Color.fromCssColorString('#72d8d0').withAlpha(0.1),
          outlineWidth: 1,
          arcType: ArcType.GEODESIC,
        },
      });
      beam.updateScanPositions = positions => { scanPositions = positions; };
      beam.updateSectorPositions = positions => {
        if (Array.isArray(positions) && positions.length >= 3) {
          sectorHierarchy = new PolygonHierarchy(positions);
        }
      };
      beam.sectorEntity = sector;
      return beam;
    };
    const updateGroundRadarSweep = ({ key, radar, lat, lng, rangeKm,
      headingDeg = 0, sectorDeg = 360, operational = true }) => {
      let beam = radarBeamEntities.get(key);
      if (!radar?.scanState || !operational) {
        if (beam) { beam.show = false; beam.sectorEntity.show = false; }
        return;
      }
      if (!beam) {
        beam = createRadarBeam(key);
        radarBeamEntities.set(key, beam);
      }
      const electronic = radar.scanState.scanType === 'ELECTRONIC_SECTOR';
      const azimuth = electronic ? headingDeg : radar.scanState.currentAzimuth;
      const halfWidth = electronic ? Math.min(180, sectorDeg / 2)
        : Math.max(1, radar.scanState.beamWidthDeg / 2);
      const radiusKm = Math.min(12, rangeKm ?? 12);
      const origin = Cartesian3.fromDegrees(lng, lat, 2);
      const edges = [azimuth - halfWidth, azimuth, azimuth + halfWidth].map(angle => {
        const endpoint = getDestinationPoint(lat, lng, angle, radiusKm);
        return Cartesian3.fromDegrees(endpoint.lng, endpoint.lat, 2);
      });
      beam.updateScanPositions(edges.flatMap(endpoint => [origin, endpoint]));
      beam.updateSectorPositions([origin, edges[0], edges[2]]);
      const visible = !olsFeedModeRef.current && !fpvFeedModeRef.current;
      beam.show = visible && !electronic;
      beam.sectorEntity.show = visible;
      const debug = overlaysRef.current.radarBeams;
      beam.polyline.material = Color.fromCssColorString('#72d8d0').withAlpha(debug ? .18 : .055);
      beam.sectorEntity.polygon.material = Color.fromCssColorString('#52cbbd')
        .withAlpha(debug ? .04 : .012);
    };
    guidanceDebugEntitiesRef.current = {
      intercept: createDynamicMarker('advanced-debug:intercept', 'INTERCEPT',
        Color.fromCssColorString('#ffd36b')),
      aim: createDynamicMarker('advanced-debug:aim', 'MISSILE AIM',
        Color.fromCssColorString('#ff9b65')),
      network: createDynamicMarker('advanced-debug:network', 'NETWORK EST',
        Color.fromCssColorString('#67cde0')),
      seeker: createDynamicMarker('advanced-debug:seeker', 'SEEKER EST',
        Color.fromCssColorString('#9dffc5')),
    };
    viewer.scene.globe.depthTestAgainstTerrain = false;
    viewer.scene.globe.enableLighting = false;
    viewer.scene.globe.showGroundAtmosphere = true;
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyAtmosphere.perFragmentAtmosphere = true;
    if (viewer.scene.skyBox) viewer.scene.skyBox.show = true;
    viewer.scene.fog.enabled = true;
    viewer.scene.highDynamicRange = true;
    // Avoid Cesium's rotating wheel zoom singularity at the screen centre.
    const onFreeCameraWheel = (event) => {
      if (cameraModeRef.current !== CAMERA_MODE.FREE || olsFeedModeRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const height = viewer.camera.positionCartographic.height;
      if (!Number.isFinite(height)) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 300 : 1);
      const distance = Math.max(250, height)
        * Math.expm1(Math.min(0.8, Math.abs(delta) * 0.002));
      if (delta > 0) viewer.camera.zoomOut(distance);
      else if (delta < 0) viewer.camera.zoomIn(Math.min(distance, Math.max(0, height - 15)));
    };
    viewer.canvas.addEventListener('wheel', onFreeCameraWheel, { capture: true, passive: false });
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(30.5, 48.5, 2_150_000),
      orientation: { heading: 0, pitch: CesiumMath.toRadians(-82), roll: 0 },
    });
    const cameraController = createAdvancedCameraController(viewer);
    cameraController.setMode(cameraModeRef.current, false);
    cameraControllerRef.current = cameraController;
    const olsController = createOlsCameraController(viewer, {
      getMetadata: () => entityMetaRef.current, getBracket: () => olsBracketRef.current,
      onExit: returnToCommandSafely,
      onManualAim: (stationId, azimuthDeg, elevationDeg) => {
        const battery = useEngine.getState().batteries.find(item => item.id === stationId);
        if (battery?.category === 'TOR_M1' && battery.controlMode === BATTERY_CONTROL_MODE.MANUAL) {
          useEngine.getState().setTorManualSight(stationId, azimuthDeg, elevationDeg);
        }
      },
      onLaunch: (stationId, targetKey, azimuthDeg, elevationDeg) => {
        const state = useEngine.getState();
        const isRussian = useGameStore.getState().language === UI_LANGUAGE.RU;
        const battery = state.batteries.find(item => item.id === stationId);
        if (battery?.category !== 'TOR_M1' || battery.controlMode !== BATTERY_CONTROL_MODE.MANUAL) return;
        const targetId = targetKey?.startsWith('TARGET:') ? targetKey.slice(7) : null;
        const track = state.tracks.find(item => item.targetId === targetId
          && isAvailableNetworkTrack(item));
        state.setTorManualSight(battery.id, azimuthDeg, elevationDeg);
        const missileId = useEngine.getState().queueTorManualSight(battery.id, track?.id ?? null);
        showCameraToast(missileId ? `9M331 · ${isRussian ? 'ПУСК' : 'LAUNCH'}`
          : isRussian ? 'ПУСК НЕДОСТУПЕН' : 'LAUNCH UNAVAILABLE');
      },
    });
    olsControllerRef.current = olsController;
    const launchLight = () => {
      const recent = [...launchEffects.values()].at(-1);
      return recent ? { position: Matrix4.multiplyByPoint(viewer.camera.viewMatrix,
        recent.position, new Cartesian3()), strength: Math.exp(-(performance.now() - recent.startedAt) / 280) }
        : { position: Cartesian3.ZERO, strength: 0 };
    };
    const environment = createAdvancedEnvironment(viewer);
    const cameraEffect = createFpvCameraEffect(viewer.scene, () => ({
      fpv: !olsFeedModeRef.current && cameraModeRef.current === CAMERA_MODE.FPV,
      thermal: visualModeRef.current === ADVANCED_VISUAL_MODE.THERMAL,
      ols: olsFeedModeRef.current,
      lowLight: visualModeRef.current === ADVANCED_VISUAL_MODE.LOW_LIGHT,
      ...olsController.optics(),
      flash: Math.max(olsController.flash(), sensorExposure.flashStrength
        * Math.exp(-(performance.now() - sensorExposure.flashAt) / 260)),
      flashAgeSec: Math.min(olsController.optics().flashAgeSec,
        Math.max(0, performance.now() - sensorExposure.flashAt) / 1000),
      heatLoad: sensorExposure.heat,
      launchLight: launchLight(),
    }));
    let previousEnvironmentMode = null;

    const makeEffectTexture = (kind) => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, 128, 128);
      if (kind === 'FLASH') {
        const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 60);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.12, 'rgba(255,255,255,.98)');
        gradient.addColorStop(0.38, 'rgba(255,255,255,.38)');
        gradient.addColorStop(1, 'rgba(84,67,55,0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 128, 128);
      } else {
        // Shared neutral luminance atlas: tint and heat come from the sensor mode.
        const seed = kind === 'SMOKE2' ? 7 : kind === 'SMOKE3' ? 13 : 0;
        for (let index = 0; index < 38; index++) {
          const angle = index * 2.39996 + seed;
          const spread = 8 + (index % 9) * 3.6;
          const x = 64 + Math.cos(angle) * spread;
          const y = 64 + Math.sin(angle * 1.07) * spread;
          const radius = 10 + (index % 5) * 3.7;
          const alpha = .14 + (index % 4) * .045;
          const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
          gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
          gradient.addColorStop(.45, `rgba(235,239,242,${alpha * .7})`);
          gradient.addColorStop(1, 'rgba(225,232,238,0)');
          context.fillStyle = gradient;
          context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }
      }
      // Canvas is ready now: no first-hit PNG encoding/async image decoding.
      return canvas;
    };
    const effectTextures = {
      flash: makeEffectTexture('FLASH'),
      smoke: makeEffectTexture('SMOKE'),
      smoke2: makeEffectTexture('SMOKE2'),
      smoke3: makeEffectTexture('SMOKE3'),
      fire: makeEffectTexture('FIRE'),
    };
    // Upload to the existing billboard atlas at scene startup, not on the first
    // hit. show:false would skip Cesium's upload/shader preparation entirely.
    // Sub-pixel, almost transparent samples are removed after startup frames;
    // the shared atlas retains the textures for subsequent real effects.
    const effectWarmupEntities = Object.values(effectTextures).map(image => viewer.entities.add({
      position: Cartesian3.fromDegrees(30.5, 48.5, 1000),
      billboard: { image, width: 1, height: 1, color: Color.WHITE.withAlpha(0.001),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new NearFarScalar(8_000, 1.08, 420_000, 0.42) },
    }));
    let effectWarmupFrames = 0;

    const trailStyles = [
      { alpha: 0.12, width: 1 },
      { alpha: 0.34, width: 1.5 },
      { alpha: 0.82, width: 2.4 },
    ];
    trailEntityRef.current = trailStyles.map((style, index) => viewer.entities.add({
      id: `advanced-selected-trail-${index}`,
      polyline: {
        positions: [],
        width: style.width,
        material: Color.fromCssColorString('#7be0ff').withAlpha(style.alpha),
        depthFailMaterial: Color.fromCssColorString('#7be0ff').withAlpha(style.alpha * 0.3),
        arcType: ArcType.NONE,
      },
      show: false,
    }));

    const altitudeLineEntity = viewer.entities.add({
      id: 'advanced-selected-altitude-line',
      polyline: {
        positions: [],
        width: 1,
        material: Color.fromCssColorString('#d9f4ff').withAlpha(0.42),
        depthFailMaterial: Color.fromCssColorString('#d9f4ff').withAlpha(0.12),
        arcType: ArcType.NONE,
      },
      show: false,
    });
    const groundProjectionEntity = viewer.entities.add({
      id: 'advanced-selected-ground-projection',
      position: Cartesian3.ZERO,
      point: {
        pixelSize: 6,
        color: Color.fromCssColorString('#d9f4ff').withAlpha(0.78),
        outlineColor: Color.fromCssColorString('#061014'),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      show: false,
    });
    altitudeReferenceRef.current = { altitudeLineEntity, groundProjectionEntity };

    const ensureModelAvailability = presentation => {
      if (!presentation.modelUri) return;
      const availability = modelAvailabilityRef.current;
      if (availability.has(presentation.modelUri)) return;
      availability.set(presentation.modelUri, 'LOADING');
      fetch(presentation.modelUri, { method: 'GET' })
        .then(async response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const modelBytes = new Uint8Array(await response.arrayBuffer(), 0, 4);
          if (String.fromCharCode(...modelBytes) !== 'glTF') {
            throw new Error('Invalid GLB header');
          }
          if (disposed || viewer.isDestroyed()) return;
          availability.set(presentation.modelUri, 'READY');
          // Entities already receive the GLB immediately. Rebuilding here
          // duplicated their auxiliary entity IDs and incorrectly marked a
          // valid asset FAILED when reconciliation threw DeveloperError.
        })
        .catch(error => {
          availability.set(presentation.modelUri, 'FAILED');
          if (!disposed) {
            console.warn(`Advanced 3D: ${presentation.key} model unavailable, using billboard fallback.`, error);
          }
        });
    };

    const createInterceptEffect = (key, position) => {
      if (interceptEffectsRef.current.has(key)) return;
      const startedAt = performance.now();
      if (interceptEffectsRef.current.size >= 8) {
        const [oldKey, old] = interceptEffectsRef.current.entries().next().value;
        old.entities.forEach(entity => viewer.entities.remove(entity));
        interceptEffectsRef.current.delete(oldKey);
      }
      olsController.impact(key, position);
      const cameraDistanceM = Cartesian3.distance(viewer.camera.positionWC, position);
      sensorExposure.flashAt = startedAt;
      sensorExposure.flashStrength = clamp(1.25 - cameraDistanceM / 110_000, 0.25, 1.2);
      hitTimingRef.current.reconcileMs = 0;
      // Triggered by the existing shared contact transition before hiding models.
      // VFX lifetime is cosmetic; collision timestamps and outcomes are untouched.
      interceptEffectsRef.current.set(key, createImpactVfx(viewer, position, effectTextures,
        () => visualModeRef.current === ADVANCED_VISUAL_MODE.THERMAL));
      hitTimingRef.current.vfxMs = performance.now() - startedAt;
      hitTimingRef.current.frameMaxMs = 0;
      hitTimingRef.current.untilMs = performance.now() + 2000;
    };

    const createLaunchEffect = (key, missile) => {
      if (launchEffects.has(key) || launchEffects.size >= 8) return;
      const launch = missile.launchWorldPosition ?? getEntityPosition(missile);
      const pad = Cartesian3.fromDegrees(launch.lng, launch.lat,
        Math.max(2, (launch.altitudeM ?? 0) - 1));
      const startedAt = performance.now();
      const age = () => (performance.now() - startedAt) / 1000;
      const dynamic = fn => new CallbackProperty(fn, false);
      const entities = [viewer.entities.add({
        position: pad,
        billboard: { image: effectTextures.flash, sizeInMeters: true, width: 64, height: 64,
          scale: dynamic(() => (18 + 58 * (1 - Math.exp(-age() * 9))) / 64),
          color: dynamic(() => (visualModeRef.current === ADVANCED_VISUAL_MODE.THERMAL
            ? Color.WHITE : new Color(1, .62, .28))
            .withAlpha(Math.exp(-age() / .24) * .9)),
          disableDepthTestDistance: 0 },
      })];
      for (let index = 0; index < 18; index++) {
        const angle = index * 2.39996323;
        entities.push(viewer.entities.add({
          position: new CallbackPositionProperty(() => Cartesian3.fromDegrees(
            launch.lng + Math.cos(angle) * age() * (.00002 + (index % 5) * .000009),
            launch.lat + Math.sin(angle) * age() * (.00002 + (index % 5) * .000009),
            Math.max(2, (launch.altitudeM ?? 0) + age() * 3)), false),
          billboard: { image: effectTextures.smoke, sizeInMeters: true,
            width: 64, height: 64,
            rotation: angle,
            scale: dynamic(() => (7 + age() * (18 + (index % 5) * 5)) / 64),
            color: dynamic(() => (visualModeRef.current === ADVANCED_VISUAL_MODE.THERMAL
              ? new Color(.35 + .65 * Math.exp(-age() * 3), .35 + .65 * Math.exp(-age() * 3), .35 + .65 * Math.exp(-age() * 3)) : new Color(.69, .66, .6))
              .withAlpha(clamp(1 - age() / 3.2, 0, 1) * .52)),
            disableDepthTestDistance: 0 },
        }));
      }
      for (let index = 0; index < 28; index++) {
        const angle = index * 2.399963;
        const speed = 7 + (index % 7) * 3;
        entities.push(viewer.entities.add({
          position: new CallbackPositionProperty(() => {
            const t = Math.min(age(), 1.2);
            return Cartesian3.fromDegrees(launch.lng + Math.cos(angle) * t * speed / 71000,
              launch.lat + Math.sin(angle) * t * speed / 111000,
              Math.max((launch.altitudeM ?? 0) + .3,
                (launch.altitudeM ?? 0) + 2 + t * (5 + index % 6) - 7 * t * t));
          }, false),
          billboard: { image: effectTextures.flash, width: 64, height: 64, sizeInMeters: true,
            scale: (.25 + (index % 4) * .12) / 64,
            color: dynamic(() => (visualModeRef.current === ADVANCED_VISUAL_MODE.THERMAL
              ? Color.WHITE : new Color(1, .78, .43)).withAlpha(clamp(1 - age() / 1.2, 0, 1))),
            disableDepthTestDistance: 0 },
        }));
      }
      launchEffects.set(key, { entities, position: pad, startedAt, expiresAt: startedAt + 3400 });
      const cameraDistanceM = Cartesian3.distance(viewer.camera.positionWC, pad);
      if (cameraDistanceM < 20_000) {
        sensorExposure.flashAt = startedAt;
        sensorExposure.flashStrength = clamp(1 - cameraDistanceM / 20_000, 0, 1) * .85;
      }
    };

    const coldLaunchVfx = createColdLaunchVfx(viewer, effectTextures, {
      getVisualMode: () => visualModeRef.current,
      getPose: key => sampleVisualState(visualStates, key, visualTimeRef.current),
      onIgnition: (position, now) => {
        sensorExposure.flashAt = now;
        sensorExposure.flashStrength = .7 * clamp(1 - Cartesian3.distance(
          viewer.camera.positionWC, position) / 20_000, 0, 1);
      },
    });
    const terminalControlVfx = createTerminalControlVfx(viewer, effectTextures, {
      getVisualMode: () => visualModeRef.current,
      getPose: key => sampleVisualState(visualStates, key, visualTimeRef.current),
    });
    const removePlume = key => {
      coldLaunchVfx.remove(key);
      terminalControlVfx.remove(key);
      const plume = plumeEntitiesRef.current.get(key);
      if (!plume) return;
      plume.forEach(entity => {
        // Entity visualizers may process collection removal on the next tick.
        // Hide first so the exhaust cannot outlive the contact frame.
        entity.show = false;
        viewer.entities.remove(entity);
      });
      plumeEntitiesRef.current.delete(key);
    };

    const updatePlume = (key, simulationEntity, currentPosition, presentation, emitting, visual) => {
      coldLaunchVfx.update(key, simulationEntity, visual, presentation);
      terminalControlVfx.update(key, simulationEntity, visual, presentation);
      const plumeProfile = getMissilePlumeProfile(simulationEntity.coldLaunchPhase
        ? { ...simulationEntity, motorPhase: visual.kinematics?.motorPhase ?? simulationEntity.motorPhase }
        : simulationEntity);
      const smokeProfile = getMissileSmokeProfile(simulationEntity);
      const now = performance.now();
      let plume = plumeEntitiesRef.current.get(key);
      if (!plumeProfile && !plume) return;
      if (plumeProfile && simulationEntity.launchWorldPosition
        && (simulationEntity.flightTime ?? Infinity) < .28) createLaunchEffect(key, simulationEntity);
      const acceleration = Math.max(0, simulationEntity.motorAccelerationMps2 ?? 45);
      const thrustFactor = clamp(.7 + acceleration / 125, .7, 1.45);
      const targetIntensity = plumeProfile ? plumeProfile.heat * thrustFactor : 0;
      if (plumeProfile && !plume) {
        const readPose = () => {
          const meta = entityMetaRef.current.get(key);
          return (meta?.holdUntilMs ? meta.visualState : sampleVisualState(visualStates,
            key, Math.min(visualTimeRef.current, meta?.visualImpact?.time ?? Infinity))) ?? visual;
        };
        // Every lobe reads the same buffered pose as the GLB and camera.
        plume = Array.from({ length: 12 }, (_, index) => viewer.entities.add({
          position: new CallbackPositionProperty((_time, result) => {
            const pose = readPose();
            const tail = getVisualExhaustPosition(pose, pose.worldPosition, presentation);
            const forward = getVisualBodyForward(pose);
            return Cartesian3.subtract(tail, Cartesian3.multiplyByScalar(forward,
              index * .30 * (plume?.size ?? 1) * (1 + .06 * Math.sin(performance.now() * .038 + index * 1.7)), new Cartesian3()), result ?? new Cartesian3());
          }, false),
          billboard: { image: effectTextures.flash, sizeInMeters: true,
            width: 64, height: 64, disableDepthTestDistance: 0 },
        }));
        plume.size = plumeProfile.size;
        plume.intensity = targetIntensity * .35;
        plume.lastAt = now;
        plumeEntitiesRef.current.set(key, plume);
      }
      const dt = clamp((now - plume.lastAt) / 1000, 0, .1);
      plume.lastAt = now;
      plume.intensity += (targetIntensity - plume.intensity)
        * (1 - Math.exp(-dt / (targetIntensity > plume.intensity ? .11 : .24)));
      if (!plumeProfile && plume.intensity < .025) { removePlume(key); return; }
      if (plumeProfile) plume.size += (plumeProfile.size - plume.size)
        * (1 - Math.exp(-dt / .16));
      const exhaustPosition = getVisualExhaustPosition(visual, currentPosition, presentation);
      const previousSmokeSample = lastSmokeSample.get(key) ?? -Infinity;
      if (emitting && plumeProfile && plume.intensity > .08
        && now - previousSmokeSample >= MISSILE_TRAIL_VISUAL_PROFILE.advancedSampleIntervalMs / smokeProfile.emissionRateScale) {
        lastSmokeSample.set(key, now);
        const previous = smokeStrands.get(key);
        const span = previous ? Cartesian3.distance(previous.position, exhaustPosition) : 0;
        const smokePower = clamp(plume.intensity, .35, 1.35);
        // Fill the travelled segment with overlapping soft volumes, never a polyline.
        // Cap interpolation after discontinuities rather than drawing a cross-map trail.
        const count = Math.min(16, Math.max(1, Math.ceil(span / ((6 + 3 / smokePower) / smokeProfile.emissionRateScale))));
        const origin = previous && span < 500 ? previous.position : exhaustPosition;
        const sequence = previous?.sequence ?? 0;
        for (let sample = 0; sample < count; sample++) {
          if (smokePuffs.length >= MISSILE_TRAIL_VISUAL_PROFILE.advancedMaxPuffs) {
            viewer.entities.remove(smokePuffs.shift().entity);
          }
          const seed = sequence + sample;
          const phase = seed * 2.399963;
          const center = Cartesian3.lerp(origin, exhaustPosition, (sample + 1) / count, new Cartesian3());
          const up = Cartesian3.normalize(center, new Cartesian3());
          const side = Cartesian3.cross(up, getVisualBodyForward(visual), new Cartesian3());
          if (Cartesian3.magnitudeSquared(side) < .001) Cartesian3.clone(Cartesian3.UNIT_X, side);
          Cartesian3.normalize(side, side);
          const size = smokeProfile.widthScale * (17 + smokePower * 8) * (.8 + (seed % 7) * .065);
          const createdAt = now;
          const cloudPosition = new Cartesian3();
          let cloudVisibility = 1, cloudTarget = 1, cloudSampleAt = 0, cloudBlendAt = createdAt;
          const age = () => clamp((performance.now() - createdAt)
            / smokeProfile.lifetimeMs, 0, 1);
          const puff = viewer.entities.add({
            position: new CallbackPositionProperty((_time, result) => {
              const t = age();
              const drift = Math.sin(phase + t * 3.5) * (1.5 + t * 14) * smokePower * smokeProfile.turbulenceScale;
              const offset = Cartesian3.multiplyByScalar(side, drift, new Cartesian3());
              Cartesian3.add(offset, Cartesian3.multiplyByScalar(up,
                t * 14 + Math.cos(phase + t * 2) * t * 5, new Cartesian3()), offset);
              return Cartesian3.add(center, offset, result ?? new Cartesian3());
            }, false),
            billboard: {
              image: [effectTextures.smoke, effectTextures.smoke2, effectTextures.smoke3][seed % 3],
              width: size, height: size * (.85 + (seed % 4) * .1), sizeInMeters: true,
              rotation: new CallbackProperty(() => phase + age() * ((seed % 2) ? .7 : -.6), false),
              scale: new CallbackProperty(() => .6 + Math.pow(age(), smokeProfile.expansionExponent) * 3.1 * smokeProfile.expansionScale, false),
              color: new CallbackProperty(() => {
                const t = age();
                const cloudNow = performance.now();
                if (!environment.isEnabled()) cloudVisibility = cloudTarget = 1;
                else {
                  if (cloudNow - cloudSampleAt > 80) {
                    cloudTarget = environment.cloudTransmission(puff.position.getValue(viewer.clock.currentTime, cloudPosition));
                    cloudSampleAt = cloudNow;
                  }
                  cloudVisibility += (cloudTarget - cloudVisibility) * (1 - Math.exp(-(cloudNow - cloudBlendAt) / 120));
                }
                cloudBlendAt = cloudNow;
                const thermal = visualModeRef.current === ADVANCED_VISUAL_MODE.THERMAL;
                const heat = .28 + .72 * Math.exp(-t * 6);
                const night = environment.isEnabled() && useEnvironmentSettings.getState().preset === 'NIGHT';
                const distance = Cartesian3.distance(viewer.camera.positionWC, center);
                const distantHaze = environment.isEnabled() ? 1 - Math.exp(-distance / 42000) : 0;
                const shade = thermal ? new Color(heat, heat, heat)
                  : night ? new Color(.27 + (seed % 3) * .025, .31 + (seed % 3) * .025, .36 + (seed % 3) * .025)
                    : new Color(.67 + (seed % 3) * .055 - distantHaze * .10,
                      .68 + (seed % 3) * .05 - distantHaze * .07,
                      .67 + (seed % 3) * .05 - distantHaze * .06);
                return shade.withAlpha(Math.pow(1 - t, smokeProfile.fadeExponent) * plumeProfile.opacity * smokeProfile.opacityScale
                  * smokePower * (.65 + (seed % 5) * .055) * (night ? .65 : 1)
                  * (1 - distantHaze * .35) * cloudVisibility);
              }, false),
              disableDepthTestDistance: 0,
              distanceDisplayCondition: new DistanceDisplayCondition(0, 260_000),
            },
          });
          smokePuffs.push({ entity: puff, createdAt, lifetimeMs: smokeProfile.lifetimeMs });
        }
        smokeStrands.set(key, { position: Cartesian3.clone(exhaustPosition), at: now,
          sequence: sequence + count });
      }
      const cloudVisibility = environment.cloudTransmission(exhaustPosition);
      plume.cloudVisibility = (plume.cloudVisibility ?? cloudVisibility)
        + (cloudVisibility - (plume.cloudVisibility ?? cloudVisibility)) * (1 - Math.exp(-dt / .12));
      if (!environment.isEnabled()) plume.cloudVisibility = 1;
      plume.forEach((entity, index) => {
        const flicker = 1 + .10 * Math.sin(now * .041 + index * 2.1)
          + .045 * Math.sin(now * .073 - index);
        const diameter = (index === 0 ? 1.0 : Math.max(1.15, 2.6 - index * .13)) * plume.size * flicker
          * (.52 + plume.intensity * .48);
        entity.billboard.scale = diameter / 64;
        entity.billboard.color = (visualModeRef.current === ADVANCED_VISUAL_MODE.THERMAL
          ? Color.WHITE : Color.fromCssColorString(index < 3 ? '#ffffff' : '#ffc579'))
          .withAlpha((1 - index / 14) * clamp(plume.intensity * 1.8, 0, 1) * plume.cloudVisibility);
      });
    };

    const addEntity = (kind, simulationEntity) => {
      const key = makeSelectionKey(kind, simulationEntity.id);
      if (cesiumEntitiesRef.current.has(key)) return;
      if (!activeRef.current) {
        prewarmFramesRef.current = 12;
        viewer.useDefaultRenderLoop = true;
      }
      const presentation = kind === ADVANCED_ENTITY_KIND.INTERCEPTOR
        ? getAdvancedInterceptorPresentation(simulationEntity)
        : kind === ADVANCED_ENTITY_KIND.SEARCH_RADAR
          ? getAdvancedSearchRadarPresentation(simulationEntity)
          : kind === ADVANCED_ENTITY_KIND.CONTROLLABLE
            ? getAdvancedControllablePresentation(simulationEntity)
            : getAdvancedTargetPresentation(simulationEntity);
      const positionData = getEntityPosition(simulationEntity);
      // Give Cesium the GLB immediately. The availability check is only a
      // safety net for a genuinely missing/corrupt asset; waiting for the
      // preflight request used to leave valid close-range models as markers.
      const modelAvailability = presentation.modelUri
        ? modelAvailabilityRef.current.get(presentation.modelUri)
        : null;
      const resolvedAsset = resolveAdvancedAssetPresentation(presentation, modelAvailability);
      const modelUri = presentation.separatedBodyModelUri
        && simulationEntity.motorPhase !== 'BOOST'
        ? presentation.separatedBodyModelUri : resolvedAsset.modelUri;
      const useModel = resolvedAsset.renderType === 'MODEL';
      const usePlaceholder = kind === ADVANCED_ENTITY_KIND.CONTROLLABLE && !useModel;
      const dimensions = presentation.placeholderDimensionsM;
      pushVisualSnapshot(visualStates, key, positionData, getKinematics(simulationEntity),
        useEngine.getState().simulationTime);
      let lastVisual = sampleVisualState(visualStates, key, visualTimeRef.current);
      const readVisual = () => {
        const meta = entityMetaRef.current.get(key);
        lastVisual = (meta?.holdUntilMs ? meta.visualState
          : sampleVisualState(visualStates, key, Math.min(visualTimeRef.current,
            meta?.visualImpact?.time ?? Infinity))) ?? lastVisual;
        return lastVisual;
      };
      const cesiumEntity = viewer.entities.add({
        id: `${ADVANCED_PREFIX}${key}`,
        // DataSourceDisplay consumes Entity properties in clock.onTick, BEFORE
        // scene.preRender. Setting constants in preRender left the GLB a frame
        // behind its close camera. Lazy properties sample the shared pose when
        // Cesium actually reads it; the camera uses the same memoized result.
        ...createVisualPoseProperties(readVisual, presentation),
        model: useModel ? {
          uri: modelUri,
          scale: resolvedAsset.uniformScale,
          minimumPixelSize: presentation.minPixelSize,
          maximumScale: presentation.maxVisualScale,
          distanceDisplayCondition: new DistanceDisplayCondition(
            0,
            presentation.lodFarDistanceM,
          ),
          runAnimations: false,
          shadows: new CallbackProperty(() => environment.isEnabled() ? 1 : 0, false),
        } : undefined,
        box: usePlaceholder ? {
          dimensions: new Cartesian3(dimensions.length, dimensions.width, dimensions.height),
          material: Color.fromCssColorString('#e5f2e9').withAlpha(0.92),
          outline: true,
          outlineColor: Color.fromCssColorString('#1a5b52'),
        } : undefined,
        billboard: !usePlaceholder && !useModel ? {
          image: resolvedAsset.fallbackAsset,
          width: presentation.billboardWidth,
          height: presentation.billboardHeight,
          heightReference: HeightReference.NONE,
          scaleByDistance: new NearFarScalar(5_000, 1.15, 2_000_000, 0.55),
          ...createWorldMissileBillboard(readVisual, presentation, viewer.camera),
          disableDepthTestDistance: kind === ADVANCED_ENTITY_KIND.TARGET ? 0 : Number.POSITIVE_INFINITY,
          distanceDisplayCondition: useModel
            ? new DistanceDisplayCondition(presentation.lodFarDistanceM * 0.82,
              3_000_000)
            : new DistanceDisplayCondition(0, 3_000_000),
        } : undefined,
        label: {
          text: `${presentation.displayName}\n${simulationEntity.id}`,
          font: '10px system-ui, sans-serif',
          fillColor: kind === ADVANCED_ENTITY_KIND.INTERCEPTOR
            ? Color.fromCssColorString('#9dffc5')
            : kind === ADVANCED_ENTITY_KIND.SEARCH_RADAR
              ? Color.fromCssColorString('#76d7e8')
              : kind === ADVANCED_ENTITY_KIND.CONTROLLABLE
                ? Color.fromCssColorString('#b9fff1')
              : Color.fromCssColorString('#ff9d91'),
          showBackground: false,
          backgroundColor: Color.fromCssColorString('#071014').withAlpha(0.28),
          pixelOffset: new Cartesian2(0, -28),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 650_000),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          show: kind !== ADVANCED_ENTITY_KIND.TARGET,
        },
      });
      cesiumEntitiesRef.current.set(key, cesiumEntity);
      // Register metadata before adding auxiliary entities: Cesium may render
      // synchronously while a seeker/debug primitive is being attached.
      entityMetaRef.current.set(key, { kind, id: simulationEntity.id, presentation,
        targetId: simulationEntity.targetId ?? null });
      ensureModelAvailability(presentation);
      if (presentation.separatedBodyModelUri) {
        ensureModelAvailability({ modelUri: presentation.separatedBodyModelUri });
        ensureModelAvailability({ modelUri: presentation.boosterModelUri });
      }
    };

    const reconcileEntities = () => {
      const reconcileStartedMs = performance.now();
      const state = useEngine.getState();
      const activeKeys = new Set();
      state.airTargets.forEach(entity => {
        const key = makeSelectionKey(ADVANCED_ENTITY_KIND.TARGET, entity.id);
        activeKeys.add(key);
        addEntity(ADVANCED_ENTITY_KIND.TARGET, entity);
      });
      state.missiles.forEach(entity => {
        const key = makeSelectionKey(ADVANCED_ENTITY_KIND.INTERCEPTOR, entity.id);
        activeKeys.add(key);
        addEntity(ADVANCED_ENTITY_KIND.INTERCEPTOR, entity);
      });
      state.controllableAirEntities.forEach(entity => {
        const key = makeSelectionKey(ADVANCED_ENTITY_KIND.CONTROLLABLE, entity.id);
        activeKeys.add(key);
        addEntity(ADVANCED_ENTITY_KIND.CONTROLLABLE, entity);
      });
      const activeTrackIds = new Set();
      state.tracks.forEach(track => {
        if (track.state === 'LOST' || !track.reportedPosition) return;
        activeTrackIds.add(track.id);
        if (trackCueEntities.has(track.id)) return;
        const reportedAltitudeM = track.reportedAltitudeM
          ?? track.reportedPosition.altitudeM
          ?? track.reportedPosition.alt
          ?? 0;
        const cueEntity = viewer.entities.add({
          id: `${ADVANCED_TRACK_PREFIX}${track.id}`,
          position: new CallbackPositionProperty((_time, result) => {
            const pose = readTrackPose(track.id);
            return Cartesian3.fromDegrees(pose?.lng ?? track.reportedPosition.lng,
              pose?.lat ?? track.reportedPosition.lat, pose?.altitudeM ?? reportedAltitudeM,
              undefined, result);
          }, false),
          ellipsoid: {
            radii: new Cartesian3(1, 1, 1), show: false,
            material: Color.fromCssColorString('#ffa99b').withAlpha(0.045),
            stackPartitions: 8, slicePartitions: 12,
          },
          point: {
            pixelSize: 7,
            color: Color.fromCssColorString('#ff9f91').withAlpha(0.86),
            outlineColor: Color.fromCssColorString('#071014').withAlpha(0.96),
            outlineWidth: 2,
            scaleByDistance: new NearFarScalar(350, 0.72, 120_000, 1.35),
            distanceDisplayCondition: new DistanceDisplayCondition(0, 180_000),
            disableDepthTestDistance: 0,
          },
          label: {
            text: '',
            font: '600 12px monospace',
            style: LabelStyle.FILL_AND_OUTLINE,
            fillColor: Color.fromCssColorString('#ffe3de'),
            outlineColor: Color.fromCssColorString('#071014'),
            outlineWidth: 3,
            showBackground: false,
            pixelOffset: new Cartesian2(14, -18),
            scaleByDistance: new NearFarScalar(500, 1, 120_000, 0.8),
            distanceDisplayCondition: new DistanceDisplayCondition(0, 180_000),
            disableDepthTestDistance: 0,
          },
        });
        trackCueEntities.set(track.id, { entity: cueEntity, targetId: track.targetId ?? null });
      });
      for (const [trackId, cue] of trackCueEntities) {
        if (activeTrackIds.has(trackId)) continue;
        viewer.entities.remove(cue.entity);
        trackCueEntities.delete(trackId);
        interpolationCache.delete(`track:${trackId}`);
      }
      const activeMeasurementKeys = new Set();
      for (const contact of state.sensorContacts ?? []) {
        const measurement = contact.lastMeasurement;
        if (!measurement?.position) continue;
        const measurementKey = `${contact.sourceRadarId}:${contact.targetId}`;
        activeMeasurementKeys.add(measurementKey);
        let marker = rawMeasurementEntities.get(measurementKey);
        if (!marker) {
          marker = createDynamicMarker(`advanced-raw-measurement:${measurementKey}`,
            'RAW MEAS', Color.fromCssColorString('#eab5ff'));
          rawMeasurementEntities.set(measurementKey, marker);
        }
        marker.updatePosition(Cartesian3.fromDegrees(
          measurement.position.lng,
          measurement.position.lat,
          measurement.altitudeM ?? measurement.position.alt ?? 0,
        ));
        marker.entity.show = overlaysRef.current.rawRadarMeasurements
          && !fpvFeedModeRef.current && !olsFeedModeRef.current;
      }
      for (const [measurementKey, marker] of rawMeasurementEntities) {
        if (activeMeasurementKeys.has(measurementKey)) continue;
        viewer.entities.remove(marker.entity);
        rawMeasurementEntities.delete(measurementKey);
      }
      for (const [key, cesiumEntity] of cesiumEntitiesRef.current) {
        if (activeKeys.has(key)) continue;
        const removedMeta = entityMetaRef.current.get(key);
        const now = performance.now();
        // Finish the buffered contact frame even when batched/high-timescale
        // physics has already removed both participants from the store.
        if (removedMeta?.visualImpact && !removedMeta.holdUntilMs) continue;
        const confirmedHit = removedMeta?.kind === ADVANCED_ENTITY_KIND.TARGET
          && state.events?.some(event => event.type === 'TARGET_INTERCEPTED'
            && event.details?.targetId === removedMeta.id);
        const confirmedControllableEvent = removedMeta?.kind === ADVANCED_ENTITY_KIND.CONTROLLABLE
          && state.events?.some(event => (
            ['CONTROLLABLE_HIT', 'CONTROLLABLE_CRASHED'].includes(event.type)
            && event.details?.entityId === removedMeta.id
          ));
        if ((confirmedHit || confirmedControllableEvent) && !removedMeta.holdUntilMs) {
          removedMeta.holdUntilMs = now + (confirmedControllableEvent ? 1_000 : POST_INTERCEPT_HOLD_MS);
          const heldPosition = cesiumEntity.position?.getValue(viewer.clock.currentTime);
          if (heldPosition) createInterceptEffect(key, heldPosition);
          cesiumEntity.show = false;
          removePlume(key);
          if (cesiumEntity.label) cesiumEntity.label.show = false;
          continue;
        }
        if (removedMeta?.holdUntilMs && now < removedMeta.holdUntilMs) continue;
        removePlume(key);
        const seekerDebug = seekerDebugEntities.get(key);
        if (seekerDebug) {
          removeSeekerDebugEntities(seekerDebug);
          seekerDebugEntities.delete(key);
        }
        const radarBeam = radarBeamEntities.get(key);
        if (radarBeam) {
          viewer.entities.remove(radarBeam);
          viewer.entities.remove(radarBeam.sectorEntity);
        }
        radarBeamEntities.delete(key);
        lastSmokeSample.delete(key);
        viewer.entities.remove(cesiumEntity);
        cesiumEntitiesRef.current.delete(key);
        entityMetaRef.current.delete(key);
        interpolationRef.current.delete(key);
        visualStates.delete(key);
        trailHistoryRef.current.delete(key);
        if (selectedKeyRef.current === key) {
          // Do not whip the close camera onto another entity after removal.
          // FREE preserves its final world pose; selection is always explicit.
          selectEntity(null, false);
          setCameraMode(CAMERA_MODE.FREE);
        }
      }
      for (const [effectKey, effect] of interceptEffectsRef.current) {
        if (performance.now() < effect.expiresAt) continue;
        effect.entities.forEach(entity => viewer.entities.remove(entity));
        interceptEffectsRef.current.delete(effectKey);
      }
      const smokeNow = performance.now();
      for (const [key, effect] of launchEffects) {
        if (smokeNow < effect.expiresAt) continue;
        effect.entities.forEach(entity => viewer.entities.remove(entity));
        launchEffects.delete(key);
      }
      for (const [key, strand] of smokeStrands) {
        if (smokeNow - strand.at > MISSILE_TRAIL_VISUAL_PROFILE.advancedSmokeLifetimeMs)
          smokeStrands.delete(key);
      }
      for (let index = smokePuffs.length - 1; index >= 0; index -= 1) {
        if (smokeNow - smokePuffs[index].createdAt
          < smokePuffs[index].lifetimeMs) continue;
        viewer.entities.remove(smokePuffs[index].entity);
        smokePuffs.splice(index, 1);
      }
      if (performance.now() < hitTimingRef.current.untilMs) {
        hitTimingRef.current.reconcileMs = Math.max(hitTimingRef.current.reconcileMs,
          performance.now() - reconcileStartedMs);
      }
    };

    const updateScene = () => {
      if (!activeRef.current) return;
      const now = performance.now();
      const simulationTime = useEngine.getState().simulationTime;
      for (const [id, debris] of asterBoosterDebris) {
        if (updateAsterBoosterDebris(debris, simulationTime,
          visualModeRef.current === ADVANCED_VISUAL_MODE.THERMAL)) continue;
        viewer.entities.remove(debris.entity);
        asterBoosterDebris.delete(id);
      }
      coldLaunchVfx.prune(now);
      const state = useEngine.getState();
      const thermalActive = visualModeRef.current === ADVANCED_VISUAL_MODE.THERMAL;
      const lowLight = visualModeRef.current === ADVANCED_VISUAL_MODE.LOW_LIGHT;
      const frameDelta = sensorExposure.lastFrameAt
        ? clamp((now - sensorExposure.lastFrameAt) / 1000, 0, .1) : 1 / 60;
      sensorExposure.lastFrameAt = now;
      let visibleHeatLoad = 0;
      cameraEffect.enabled = thermalActive || lowLight || olsFeedModeRef.current
        || cameraModeRef.current === CAMERA_MODE.FPV
        || now - sensorExposure.flashAt < 1500;
      const environmentMode = thermalActive ? 'THERMAL' : lowLight ? 'LOW-LIGHT' : 'DAY';
      const environmentActive = !olsFeedModeRef.current && !fpvFeedModeRef.current
        && cameraModeRef.current !== CAMERA_MODE.FPV && !thermalActive;
      environment.update(environmentActive, now);
      if (environmentActive) previousEnvironmentMode = null;
      if (!environmentActive && previousEnvironmentMode !== environmentMode) {
        // Semantic presentation: cold environment, bright airborne surfaces.
        // No sensor/detection changes and no depth-test bypass.
        viewer.imageryLayers.get(0).brightness = thermalActive ? 0.7 : lowLight ? 0.27 : 1;
        viewer.scene.skyAtmosphere.brightnessShift = thermalActive ? -0.8 : lowLight ? -0.85 : 0;
        viewer.scene.skyAtmosphere.show = !thermalActive && !lowLight;
        if (viewer.scene.skyBox) viewer.scene.skyBox.show = !thermalActive && !lowLight;
        viewer.scene.backgroundColor = thermalActive ? Color.fromCssColorString('#242424')
          : lowLight ? Color.fromCssColorString('#101820') : Color.BLACK;
        viewer.scene.globe.showGroundAtmosphere = !thermalActive && !lowLight;
        previousEnvironmentMode = environmentMode;
      }
      const targetMap = new Map(state.airTargets.map(entity => [entity.id, entity]));
      const missileMap = new Map(state.missiles.map(entity => [entity.id, entity]));
      const searchRadarMap = new Map(state.searchRadars.map(entity => [entity.id, entity]));
      const controllableMap = new Map(
        state.controllableAirEntities.map(entity => [entity.id, entity]),
      );
      const trackMap = new Map(state.tracks.map(track => [track.id, track]));
      const placeLabel = createLabelLayout(viewer.scene.canvas.clientWidth, viewer.scene.canvas.clientHeight);
      const orderedEntities = [...cesiumEntitiesRef.current].sort(([a], [b]) =>
        Number(b === selectedKeyRef.current) - Number(a === selectedKeyRef.current));
      for (const [key, cesiumEntity] of orderedEntities) {
        const meta = entityMetaRef.current.get(key);
        if (!meta) continue;
        if (meta.visualImpact && (meta.holdUntilMs || visualTimeRef.current >= meta.visualImpact.time)) {
          if (!meta.holdUntilMs) {
            meta.visualState = sampleVisualState(visualStates, key, meta.visualImpact.time);
            meta.holdUntilMs = now + POST_INTERCEPT_HOLD_MS;
            const eventPosition = meta.visualImpact.eventPosition;
            createInterceptEffect(meta.visualImpact.effectKey,
              Cartesian3.fromDegrees(eventPosition.lng, eventPosition.lat, eventPosition.altitudeM));
            cesiumEntity.show = false;
            const heat = thermalTrailEntities.get(key);
            if (heat) {
              viewer.entities.remove(heat.hotSpot);
              heat.segments.forEach(segment => viewer.entities.remove(segment));
              thermalTrailEntities.delete(key);
            }
          }
          // Contact is a one-way lifecycle transition. A clock resync must
          // never revive the exhaust while its model is already held/hidden.
          removePlume(key);
          continue;
        }
        const simulationEntity = meta.kind === ADVANCED_ENTITY_KIND.INTERCEPTOR
          ? missileMap.get(meta.id)
          : meta.kind === ADVANCED_ENTITY_KIND.SEARCH_RADAR
            ? searchRadarMap.get(meta.id)
            : meta.kind === ADVANCED_ENTITY_KIND.CONTROLLABLE
              ? controllableMap.get(meta.id)
              : targetMap.get(meta.id);
        if (!simulationEntity) {
          if (meta.visualImpact) meta.visualState = sampleVisualState(visualStates, key,
            Math.min(visualTimeRef.current, meta.visualImpact.time));
          continue;
        }
        const physicsPosition = getEntityPosition(simulationEntity);
        const physicsKinematics = getKinematics(simulationEntity);
        // The subscription captures every fixed step, including batched 20x
        // substeps. This fallback seeds new render objects without a zero origin.
        if (!visualStates.has(key)) pushVisualSnapshot(visualStates, key,
          physicsPosition, physicsKinematics, state.simulationTime);
        const visual = sampleVisualState(visualStates, key,
          Math.min(visualTimeRef.current, meta.visualImpact?.time ?? Infinity));
        visual.diagnostics.renderDeltaMs = now - (meta.lastRenderMs ?? now);
        meta.lastRenderMs = now;
        const displayed = visual.position;
        const position = visual.worldPosition;
        const kinematics = visual.kinematics;
        if (meta.kind === ADVANCED_ENTITY_KIND.INTERCEPTOR) {
          const profile = getMissilePlumeProfile(simulationEntity);
          if (profile) {
            const rangeM = Cartesian3.distance(viewer.camera.positionWC, position);
            visibleHeatLoad = Math.max(visibleHeatLoad,
              profile.heat * clamp(1 - rangeM / (olsFeedModeRef.current ? 90_000 : 18_000), 0, 1));
          }
        }
        meta.visualState = visual;
        if (meta.kind === ADVANCED_ENTITY_KIND.SEARCH_RADAR) {
          const radar = simulationEntity.components?.radar;
          updateGroundRadarSweep({ key, radar, lat: displayed.lat, lng: displayed.lng,
            rangeKm: simulationEntity.radarRangeKm ?? simulationEntity.nominalRangeKm,
            headingDeg: simulationEntity.radarHeading ?? radar?.heading ?? 0,
            sectorDeg: simulationEntity.radarSector ?? 360,
            operational: simulationEntity.operational !== false });
        }
        if (cesiumEntity.billboard && !meta.presentation.billboardDimensionsM) {
          cesiumEntity.billboard.rotation = CesiumMath.toRadians(
            -(kinematics.headingDeg + (meta.presentation.billboardYawOffsetDeg
              ?? meta.presentation.yawOffsetDeg ?? 0)));
        }
        const thermallyBright = meta.kind === ADVANCED_ENTITY_KIND.TARGET
          || meta.kind === ADVANCED_ENTITY_KIND.INTERCEPTOR
          || meta.kind === ADVANCED_ENTITY_KIND.CONTROLLABLE;
        if (cesiumEntity.model) {
          const thermalProfile = getThermalProfile(meta.presentation.key, meta.kind);
          const luminance = thermalLuminance(thermalProfile, kinematics.speedKmh);
          cesiumEntity.model.color = thermalActive && thermallyBright
            ? new Color(luminance, luminance, luminance, 1) : Color.WHITE;
          cesiumEntity.model.colorBlendMode = thermalActive && thermallyBright
            ? ColorBlendMode.MIX : ColorBlendMode.HIGHLIGHT;
          cesiumEntity.model.colorBlendAmount = thermalActive && thermallyBright ? 0.52 : 0;
        }
        if (cesiumEntity.box) {
          cesiumEntity.box.material = thermalActive && thermallyBright
            ? Color.fromCssColorString('#fff8d7').withAlpha(0.98)
            : Color.fromCssColorString('#e5f2e9').withAlpha(0.92);
        }
        if (cesiumEntity.billboard) {
          cesiumEntity.billboard.color = thermalActive && thermallyBright
            ? Color.fromCssColorString('#fff8d7') : Color.WHITE;
        }
        const selected = selectedKeyRef.current === key;
        const controlledOwnModel = meta.kind === ADVANCED_ENTITY_KIND.CONTROLLABLE
          && state.controlledControllableEntityId === meta.id;
        const hideOwnModel = controlledOwnModel
          && [CAMERA_MODE.FIRST_PERSON, CAMERA_MODE.FPV].includes(cameraModeRef.current);
        if (cesiumEntity.model) cesiumEntity.model.show = !hideOwnModel;
        if (cesiumEntity.box) cesiumEntity.box.show = !hideOwnModel;
        if (cesiumEntity.billboard && (controlledOwnModel || meta.kind === ADVANCED_ENTITY_KIND.SEARCH_RADAR)) {
          cesiumEntity.billboard.show = !hideOwnModel
            && !(fpvFeedModeRef.current && meta.kind === ADVANCED_ENTITY_KIND.SEARCH_RADAR);
        }
        if (cesiumEntity.model) {
          cesiumEntity.model.minimumPixelSize = olsFeedModeRef.current ? 0 : meta.presentation.minPixelSize;
          cesiumEntity.model.maximumScale = olsFeedModeRef.current
            ? meta.presentation.baseVisualScale : meta.presentation.maxVisualScale;
        }
        const heatTrace = thermalTrailEntities.get(key);
        if (heatTrace) {
          // Anchor is a lazy property sharing the GLB's buffered pose.
          const engineHot = meta.kind !== ADVANCED_ENTITY_KIND.INTERCEPTOR
            || Boolean(getMissilePlumeProfile(simulationEntity));
          heatTrace.hotSpot.show = thermalActive && engineHot && !hideOwnModel;
          heatTrace.segments.forEach(segment => {
            segment.show = overlaysRef.current.thermalTraces && thermalActive && !hideOwnModel && segment.show;
          });
        }
        if (controlledOwnModel && fpvAttitudeRef.current) {
          // Same continuously rendered attitude as model/camera, not 4 Hz React snapshots.
          fpvAttitudeRef.current.style.transform = `translate(-50%, calc(-50% + ${clamp(kinematics.pitchDeg, -25, 25)}px)) rotate(${-kinematics.rollDeg}deg)`;
        }
        if (cesiumEntity.label) {
          const assigned = targetMap.get(simulationEntity.targetId);
          const targetPose = assigned && entityMetaRef.current.get(
            makeSelectionKey(ADVANCED_ENTITY_KIND.TARGET, assigned.id))?.visualState;
          const labelText = compactWorldLabel({ name: meta.presentation.displayName,
            id: simulationEntity.id, selected,
            distanceM: Cartesian3.distance(viewer.camera.positionWC, position),
            speedMps: kinematics.speedKmh / 3.6,
            altitudeM: visual.position.altitudeM,
            rangeKm: targetPose ? Cartesian3.distance(position, targetPose.worldPosition) / 1000 : null,
            seeker: simulationEntity.seeker, phase: simulationEntity.flightPhase,
            language: useGameStore.getState().language });
          const seekerDetail = (overlaysRef.current.seekerLabels || overlaysRef.current.seekerState)
            && simulationEntity.seeker ? `\n${simulationEntity.guidanceSource ?? ''}` : '';
          cesiumEntity.label.text = labelText + seekerDetail;
          cesiumEntity.label.show = !fpvFeedModeRef.current && !olsFeedModeRef.current
            && (meta.kind !== ADVANCED_ENTITY_KIND.TARGET || (selected && overlaysRef.current.trackLabels)) && !controlledOwnModel
            && placeLabel(SceneTransforms.worldToWindowCoordinates(viewer.scene, position), labelText);
          cesiumEntity.label.font = '11px monospace';
          cesiumEntity.label.pixelOffset = new Cartesian2(0, -42);
          cesiumEntity.label.showBackground = false;
          cesiumEntity.label.backgroundColor = Color.fromCssColorString('#071014').withAlpha(0.28);
        }
        if (meta.kind === ADVANCED_ENTITY_KIND.INTERCEPTOR) {
          const seeker = simulationEntity.seeker;
          const overlays = overlaysRef.current;
          const seekerFovVisible = overlays.seekerFov || overlays.irSeekerFov || overlays.arhSeekerFov;
          const seekerGeometryVisible = seekerFovVisible || overlays.seekerBoresight
            || overlays.seekerTargetLos;
          let seekerDebug = seekerDebugEntities.get(key);
          if (seekerGeometryVisible && !seekerDebug) {
            seekerDebug = createSeekerDebugEntities(meta.id);
            seekerDebugEntities.set(key, seekerDebug);
          } else if (!seekerGeometryVisible && seekerDebug) {
            removeSeekerDebugEntities(seekerDebug);
            seekerDebugEntities.delete(key);
            seekerDebug = null;
          }
          if (seekerDebug && seeker) {
            const profile = getSeekerProfile(seeker.profileId);
            const activeState = seeker.enabled !== false && seeker.state !== SEEKER_STATE.OFF;
            const showFov = seekerFovVisible && activeState && !fpvFeedModeRef.current
              && !olsFeedModeRef.current;
            const stateAlpha = seeker.state === SEEKER_STATE.WARMUP ? 0.07
              : seeker.state === SEEKER_STATE.SEARCH ? 0.2
                : seeker.state === SEEKER_STATE.ACQUIRED ? 0.34
                  : seeker.state === SEEKER_STATE.TERMINAL ? 0.42
                    : seeker.state === SEEKER_STATE.LOST ? 0.08 : 0;
            const rangeM = Math.max(1_000, Math.min(
              SEEKER_VISUAL_DEBUG_RANGE_M,
              (profile.seekerActivationRangeKm ?? 0) * 1_000 || 1_000,
            ));
            const origin = getVisualSeekerOrigin(visual, meta.presentation);
            const bodyOrientation = getVisualBodyOrientation(visual);
            const forward = getVisualBodyForward(visual);
            const end = Cartesian3.add(origin,
              Cartesian3.multiplyByScalar(forward, rangeM, new Cartesian3()), new Cartesian3());
            const coneMidpoint = Cartesian3.lerp(origin, end, 0.5, new Cartesian3());
            const coneOrientation = Quaternion.multiply(bodyOrientation,
              seekerConeAxisCorrection, new Quaternion());
            const radius = Math.max(12, Math.tan(CesiumMath.toRadians(
              Math.max(0.5, profile.fovDeg ?? 0) * 0.5,
            )) * rangeM);
            seekerDebug.fov.updatePose({ position: coneMidpoint, orientation: coneOrientation,
              length: rangeM, radius });
            seekerDebug.fov.entity.cylinder.material = Color.fromCssColorString('#55e0b2')
              .withAlpha(stateAlpha);
            seekerDebug.fov.entity.show = showFov && stateAlpha > 0;

            const showBoresight = overlays.seekerBoresight && activeState
              && !fpvFeedModeRef.current && !olsFeedModeRef.current
              && seeker.state !== SEEKER_STATE.WARMUP;
            if (showBoresight) seekerDebug.boresight.updatePositions([origin, end]);
            seekerDebug.boresight.entity.polyline.material = Color.fromCssColorString('#62e6b5')
              .withAlpha(seeker.state === SEEKER_STATE.LOST ? 0.22 : 0.78);
            seekerDebug.boresight.entity.show = showBoresight;

            const estimate = seeker.targetEstimate;
            const estimatePosition = estimate?.position;
            const estimateAltitudeM = estimate?.altitudeM ?? estimatePosition?.altitudeM
              ?? estimatePosition?.alt ?? 0;
            const estimateLng = estimatePosition?.lng ?? estimatePosition?.lon;
            const hasEstimate = Number.isFinite(estimatePosition?.lat)
              && Number.isFinite(estimateLng);
            const lostRecently = seeker.state === SEEKER_STATE.LOST
              && Number.isFinite(seeker.lostAt)
              && state.simulationTime - seeker.lostAt <= 1;
            const showTargetLos = overlays.seekerTargetLos && activeState && hasEstimate
              && !fpvFeedModeRef.current && !olsFeedModeRef.current
              && seeker.state !== SEEKER_STATE.WARMUP
              && (seeker.state !== SEEKER_STATE.LOST || lostRecently);
            if (showTargetLos) {
              seekerDebug.targetLos.updatePositions([origin, Cartesian3.fromDegrees(
                estimateLng,
                estimatePosition.lat,
                estimateAltitudeM,
              )]);
            }
            const targetLosAlpha = seeker.state === SEEKER_STATE.SEARCH ? 0.25
              : seeker.state === SEEKER_STATE.LOST ? 0.16 : 0.82;
            seekerDebug.targetLos.entity.polyline.material = Color.fromCssColorString('#8cffc8')
              .withAlpha(targetLosAlpha);
            seekerDebug.targetLos.entity.show = showTargetLos;
          } else if (seekerDebug) {
            seekerDebug.fov.entity.show = false;
            seekerDebug.boresight.entity.show = false;
            seekerDebug.targetLos.entity.show = false;
          }
          updatePlume(key, simulationEntity, position, meta.presentation, state.timeScale > 0, visual);
        }
      }
      const activeBatteryRadarKeys = new Set();
      state.batteries.forEach(battery => {
        const radar = battery.components?.radar;
        if (!radar || !Number.isFinite(radar.lat) || !Number.isFinite(radar.lng)) return;
        const key = `battery:${battery.id}`;
        activeBatteryRadarKeys.add(key);
        updateGroundRadarSweep({ key, radar, lat: radar.lat, lng: radar.lng,
          rangeKm: battery.radarRangeKm, headingDeg: battery.radarHeading,
          sectorDeg: battery.radarSector, operational: radar.operational !== false });
      });
      for (const [key, beam] of radarBeamEntities) {
        if (!key.startsWith('battery:') || activeBatteryRadarKeys.has(key)) continue;
        viewer.entities.remove(beam);
        viewer.entities.remove(beam.sectorEntity);
        radarBeamEntities.delete(key);
      }
      sensorExposure.heat += (visibleHeatLoad - sensorExposure.heat)
        * (1 - Math.exp(-frameDelta / (visibleHeatLoad > sensorExposure.heat ? .12 : 1.2)));

      const controlledEntity = controllableMap.get(state.controlledControllableEntityId);
      const controlledMeta = controlledEntity
        ? entityMetaRef.current.get(makeSelectionKey(
          ADVANCED_ENTITY_KIND.CONTROLLABLE,
          controlledEntity.id,
        ))
        : null;
      const controlledPositionData = controlledMeta?.visualState?.position
        ?? (controlledEntity ? getEntityPosition(controlledEntity) : null);
      const controlledPosition = controlledPositionData
        ? Cartesian3.fromDegrees(
          controlledPositionData.lng,
          controlledPositionData.lat,
          controlledPositionData.altitudeM,
        )
        : null;
      for (const [trackId, cue] of trackCueEntities) {
        const track = trackMap.get(trackId);
        if (!track?.reportedPosition || track.state === 'LOST') {
          cue.entity.show = false;
          continue;
        }
        const selected = state.selectedTrackId === trackId
          || controlledEntity?.selectedTrackId === trackId;
        // Selected FPV annotation is drawn once, by FpvOsd, not twice in Cesium.
        cue.entity.show = overlaysRef.current.trackLabels && !fpvFeedModeRef.current && !olsFeedModeRef.current;
        const trackVisual = readTrackPose(trackId);
        if (!trackVisual) continue;
        const trackPosition = Cartesian3.fromDegrees(trackVisual.lng, trackVisual.lat, trackVisual.altitudeM);
        const presentedTrack = withTrackPresentation(track, trackVisual);
        const referencePosition = controlledPosition ?? viewer.camera.positionWC;
        const distanceKm = referencePosition
          ? Cartesian3.distance(referencePosition, trackPosition) / 1000
          : null;
        if (controlledEntity?.selectedTrackId === trackId && controlledPositionData
          && fpvMapContactRef.current) {
          const bearing = getBearing(controlledPositionData.lat, controlledPositionData.lng,
            trackVisual.lat, trackVisual.lng)
            - (controlledMeta?.visualState?.kinematics?.headingDeg ?? controlledEntity.heading ?? 0);
          const radius = Math.min(68, (distanceKm ?? 0)
            / Number(fpvMapContactRef.current.dataset.rangeKm || 5) * 68);
          const radians = bearing * Math.PI / 180;
          fpvMapContactRef.current.setAttribute('transform',
            `translate(${90 + Math.sin(radians) * radius} ${80 - Math.cos(radians) * radius})`);
        }
        const displayName = track.identifiedModelId
          ? getTargetDisplayName(track.identifiedModelId)
          : track.identifiedType ?? track.classifiedType ?? 'AIR TRACK';

        const sensorSourceLine = overlaysRef.current.sensorSource
          ? `\nSENSOR ${track.lastMeasurementSensorId ?? track.sourceRadarId ?? '—'}` : '';
        const networkOwnerLine = overlaysRef.current.networkOwner
          ? `\nOWNER ${track.sourceRadarId ?? track.bestSensorId ?? '—'}` : '';
        const compactLabel = compactWorldLabel({ name: displayName, id: trackId, selected,
          distanceM: (distanceKm ?? Infinity) * 1000, speedMps: track.reportedSpeedKmh / 3.6,
          rangeKm: distanceKm, altitudeM: track.reportedAltitudeM,
          language: useGameStore.getState().language });
        cue.entity.label.text = overlaysRef.current.debug ? formatTrackCesiumLabel(presentedTrack, distanceKm, displayName,
          useGameStore.getState().language)
          : `${compactLabel}${sensorSourceLine}${networkOwnerLine}`;
        cue.entity.label.show = placeLabel(SceneTransforms.worldToWindowCoordinates(viewer.scene, trackPosition),
          cue.entity.label.text.getValue());
        cue.entity.label.font = '11px monospace';
        cue.entity.label.fillColor = Color.fromCssColorString(
          visualModeRef.current === ADVANCED_VISUAL_MODE.THERMAL
            ? '#ffffff' : selected ? '#ffffff' : '#ffe3de',
        );
        cue.entity.label.backgroundColor = Color.fromCssColorString(
          selected ? '#18312f' : '#071014',
        ).withAlpha(selected ? 0.3 : 0.12);
        cue.entity.point.pixelSize = selected ? 11 : 7;
        cue.entity.point.color = Color.fromCssColorString(
          visualModeRef.current === ADVANCED_VISUAL_MODE.THERMAL
            ? '#fff6c9' : selected ? '#b9fff1' : '#ff9f91',
        ).withAlpha(selected ? 1 : 0.86);
        cue.entity.label.scale = 1;
        cue.entity.ellipsoid.show = overlaysRef.current.trackUncertainty;
        const horizontalUncertainty = Math.max(10, track.positionUncertaintyM ?? 10);
        const verticalUncertainty = Math.max(10, track.altitudeUncertaintyM ?? 10);
        cue.entity.ellipsoid.radii = new Cartesian3(horizontalUncertainty,
          horizontalUncertainty, verticalUncertainty);
      }

      if (olsFeedModeRef.current) {
        if (altitudeReferenceRef.current) {
          altitudeReferenceRef.current.altitudeLineEntity.show = false;
          altitudeReferenceRef.current.groundProjectionEntity.show = false;
        }
        olsController.update(now);
        return;
      }
      const selection = parseSelectionKey(selectedKeyRef.current);
      const selected = selection
        ? getSimulationEntity(state, selection.kind, selection.id)
        : null;
      const heldMeta = selection ? entityMetaRef.current.get(selectedKeyRef.current) : null;
      const heldPosition = !selected && (heldMeta?.holdUntilMs > now || heldMeta?.visualImpact)
        ? cesiumEntitiesRef.current.get(selectedKeyRef.current)?.position?.getValue(
          viewer.clock.currentTime,
        )
        : null;
      const eventPosition = heldMeta?.holdUntilMs && heldMeta.visualImpact?.eventPosition;
      const contactPosition = eventPosition ? Cartesian3.fromDegrees(eventPosition.lng,
        eventPosition.lat, eventPosition.altitudeM) : null;
      const altitudeReference = altitudeReferenceRef.current;
      const guidanceDebug = guidanceDebugEntitiesRef.current;
      if (guidanceDebug) Object.values(guidanceDebug).forEach(marker => {
        marker.entity.show = false;
      });
      if (guidanceDebug && selected?.seeker) {
        const setDebugMarker = (marker, source, visible) => {
          if (!source || !visible) return;
          const altitudeM = source.altitudeM ?? source.alt ?? source.position?.altitudeM
            ?? source.position?.alt ?? 0;
          const lat = source.lat ?? source.position?.lat;
          const lng = source.lng ?? source.lon ?? source.position?.lng ?? source.position?.lon;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
          marker.updatePosition(Cartesian3.fromDegrees(lng, lat, altitudeM));
          marker.entity.show = true;
        };
        const missileTrack = trackMap.get(selected.trackId);
        setDebugMarker(guidanceDebug.intercept,
          selected.guidance?.interceptSolution?.interceptPoint,
          overlaysRef.current.interceptPoint);
        setDebugMarker(guidanceDebug.aim, selected.guidance?.commandPosition,
          overlaysRef.current.missileAimPoint);
        setDebugMarker(guidanceDebug.network, missileTrack?.reportedPosition,
          overlaysRef.current.networkTrackEstimate);
        setDebugMarker(guidanceDebug.seeker, selected.seeker.targetEstimate,
          overlaysRef.current.seekerEstimate);
      }
      if (selected) {
        const selectedVisual = heldMeta?.visualState;
        const selectedPositionData = selectedVisual?.position
          ?? interpolationRef.current.get(selectedKeyRef.current)?.displayed
          ?? getEntityPosition(selected);
        const selectedPosition = Cartesian3.fromDegrees(
          selectedPositionData.lng,
          selectedPositionData.lat,
          selectedPositionData.altitudeM,
        );
        const groundPosition = Cartesian3.fromDegrees(
          selectedPositionData.lng,
          selectedPositionData.lat,
          0,
        );
        if (altitudeReference) {
          altitudeReference.altitudeLineEntity.polyline.positions = [groundPosition, selectedPosition];
          altitudeReference.altitudeLineEntity.show = overlaysRef.current.debug && selectedPositionData.altitudeM > 15
            && ![CAMERA_MODE.FIRST_PERSON, CAMERA_MODE.FPV, CAMERA_MODE.THIRD_PERSON].includes(cameraModeRef.current);
          altitudeReference.groundProjectionEntity.position.setValue(groundPosition);
          altitudeReference.groundProjectionEntity.show = altitudeReference.altitudeLineEntity.show;
        }
        const target = selected.targetId ? targetMap.get(selected.targetId) : null;
        const targetData = target ? entityMetaRef.current.get(
          makeSelectionKey(ADVANCED_ENTITY_KIND.TARGET, target.id),
        )?.visualState?.position : null;
        const targetPosition = targetData ? Cartesian3.fromDegrees(
          targetData.lng,
          targetData.lat,
          targetData.altitudeM,
        ) : null;
        const velocity = selectedVisual?.kinematics ?? getKinematics(selected);
        cameraController.update({
          selectedPosition,
          contactPosition,
          targetPosition,
          headingDeg: velocity.headingDeg,
          pitchDeg: velocity.pitchDeg,
          rollDeg: velocity.rollDeg,
          bodyQuaternion: selectedVisual?.quaternion,
          selectedAltitudeM: selectedPositionData.altitudeM,
          firstPersonOffsetM: heldMeta?.presentation?.firstPersonCameraOffsetM ?? 0.65,
          cameraConfig: heldMeta?.presentation?.cameraConfig ?? {
            sideDistanceM: Math.max(32, (heldMeta?.presentation?.physicalLengthMeters ?? 5) * 9),
            followDistanceM: Math.max(42, (heldMeta?.presentation?.physicalLengthMeters ?? 5) * 12),
          },
          timestampMs: now,
        });
        if (fpvFeedModeRef.current && cameraModeRef.current === CAMERA_MODE.FPV && containerRef.current) {
          containerRef.current.style.visibility = 'visible';
        }
      } else if (heldPosition) {
        cameraController.update({
          selectedPosition: heldPosition,
          contactPosition,
          ...heldMeta?.visualState?.kinematics,
          bodyQuaternion: heldMeta?.visualState?.quaternion,
          selectedAltitudeM: heldMeta?.visualState?.position?.altitudeM ?? 0,
          timestampMs: now,
        });
      } else {
        if (altitudeReference) {
          altitudeReference.altitudeLineEntity.show = false;
          altitudeReference.groundProjectionEntity.show = false;
        }
        cameraController.update({ selectedPosition: null, timestampMs: now });
      }
      environment.sync(entityMetadata, state.missiles, smokePuffs);
    };

    const pickHandler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    pickHandler.setInputAction(event => {
      if (olsFeedModeRef.current) return;
      let pickPosition = event.position;
      if (cameraModeRef.current === CAMERA_MODE.FPV) {
        const { clientWidth, clientHeight } = viewer.scene.canvas;
        const sample = fpvLensSample(event.position.x / clientWidth * 2 - 1,
          event.position.y / clientHeight * 2 - 1);
        pickPosition = new Cartesian2((sample.x + 1) * clientWidth / 2,
          (sample.y + 1) * clientHeight / 2);
      }
      const picked = viewer.scene.pick(pickPosition);
      const cesiumId = picked?.id?.id;
      if (typeof cesiumId !== 'string') {
        selectedKeyRef.current = null;
        setSelectedKey(null);
        setSelectedTelemetry(null);
        setGroundSelected(null);
        return;
      }
      if (cesiumId.startsWith(ADVANCED_TRACK_PREFIX)) {
        setGroundSelected(null);
        const trackId = cesiumId.slice(ADVANCED_TRACK_PREFIX.length);
        const engineState = useEngine.getState();
        const track = engineState.tracks.find(candidate => candidate.id === trackId);
        if (!track || track.state === 'LOST') return;
        if (engineState.controlledControllableEntityId) {
          setControllableSelectedTrack(engineState.controlledControllableEntityId, trackId);
        } else {
          setSelectedTrack(trackId);
          const target = engineState.airTargets.find(candidate => candidate.id === track.targetId);
          if (target) selectEntity(makeSelectionKey(ADVANCED_ENTITY_KIND.TARGET, target.id), false);
        }
        return;
      }
      if (!cesiumId.startsWith(ADVANCED_PREFIX)) {
        if (picked?.id?.properties?.groundKey) return;
        selectedKeyRef.current = null;
        setSelectedKey(null);
        setSelectedTelemetry(null);
        setGroundSelected(null);
        return;
      }
      setGroundSelected(null);
      selectEntity(cesiumId.slice(ADVANCED_PREFIX.length), false);
    }, ScreenSpaceEventType.LEFT_CLICK);

    const captureVisualSnapshots = state => {
      const impactSources = [...state.missiles, ...state.controllableAirEntities]
        .filter(entity => entity.visualImpact);
      const impactsByTarget = new Map(impactSources.map(entity =>
        [entity.visualImpact.targetId ?? entity.targetId, entity.visualImpact]));
      const groups = [[ADVANCED_ENTITY_KIND.TARGET, state.airTargets],
        [ADVANCED_ENTITY_KIND.INTERCEPTOR, state.missiles],
        [ADVANCED_ENTITY_KIND.CONTROLLABLE, state.controllableAirEntities],
        [ADVANCED_ENTITY_KIND.SEARCH_RADAR, state.searchRadars]];
      for (const [kind, entities] of groups) for (const entity of entities) {
        const key = makeSelectionKey(kind, entity.id);
        const meta = entityMetadata.get(key);
        if (!meta) continue;
        const impact = [ADVANCED_ENTITY_KIND.INTERCEPTOR, ADVANCED_ENTITY_KIND.CONTROLLABLE].includes(kind) ? entity.visualImpact
          : kind === ADVANCED_ENTITY_KIND.TARGET ? impactsByTarget.get(entity.id) : null;
        captureImpactAwareSnapshot(visualStates, key, meta,
          getEntityPosition(entity), getKinematics(entity), state.simulationTime,
          impact ? { time: impact.time,
            position: kind !== ADVANCED_ENTITY_KIND.TARGET ? impact.missilePosition : impact.targetPosition,
            eventPosition: impact.targetPosition,
            effectKey: makeSelectionKey(ADVANCED_ENTITY_KIND.TARGET,
              kind !== ADVANCED_ENTITY_KIND.TARGET ? impact.targetId ?? entity.targetId : entity.id),
          } : null);
      }
      // FPV collision removes the target in this same tick. Its render object
      // still needs the buffered contact snapshot before reconciliation.
      for (const [targetId, impact] of impactsByTarget) {
        const key = makeSelectionKey(ADVANCED_ENTITY_KIND.TARGET, targetId);
        const meta = entityMetadata.get(key);
        const pose = meta?.visualState ?? sampleVisualState(visualStates, key, visualTimeRef.current);
        if (!meta || !pose || meta.visualImpact) continue;
        captureImpactAwareSnapshot(visualStates, key, meta, impact.targetPosition,
          pose.kinematics, impact.time, { time: impact.time, position: impact.targetPosition,
            eventPosition: impact.targetPosition, effectKey: key });
      }
    };
    const unsubscribeSnapshots = useEngine.subscribe((state, previous) => {
      if (state.simulationTime !== previous.simulationTime) captureVisualSnapshots(state);
      // Register every new airframe on its first fixed step. A delayed general
      // reconcile made the launcher flash appear before the NASAMS model.
      if (state.missiles !== previous.missiles) state.missiles.forEach(missile => {
        if (!previous.missiles.some(candidate => candidate.id === missile.id)) {
          addEntity(ADVANCED_ENTITY_KIND.INTERCEPTOR, missile);
        }
        if (missile.interceptorSpecId !== 'INT-ASTER30-V1' || missile.motorPhase === 'BOOST'
          || asterBoosterDebris.has(missile.id)) return;
        const before = previous.missiles.find(candidate => candidate.id === missile.id);
        if (!before || before.motorPhase !== 'BOOST') return;
        const presentation = getAdvancedInterceptorPresentation(missile);
        const key = makeSelectionKey(ADVANCED_ENTITY_KIND.INTERCEPTOR, missile.id);
        const visual = sampleVisualState(visualStates, key, state.simulationTime);
        if (!visual) return;
        asterBoosterDebris.set(missile.id, createAsterBoosterDebris(viewer,
          visual, presentation, state.simulationTime, missile.id));
        const missileEntity = cesiumEntities.get(key);
        if (missileEntity?.model) missileEntity.model.uri = presentation.separatedBodyModelUri;
        const meta = entityMetadata.get(key);
        if (meta) meta.presentation = presentation;
      });
    });
    const removePreRender = viewer.scene.preRender.addEventListener(updateScene);
    // Screen projection must happen after camera update, every rendered frame.
    // React still refreshes text at its existing low telemetry cadence.
    const removePostRender = viewer.scene.postRender.addEventListener(() => {
      // Optional development capture observes the actual completed frame.
      visualFrameObserverRef.current?.(viewer.canvas, visualTimeRef.current, {
        plumes: [...plumeEntitiesRef.current.keys()],
        impacts: [...entityMetaRef.current].filter(([, meta]) => meta.visualImpact)
          .map(([key, meta]) => ({ key, time: meta.visualImpact.time, held: Boolean(meta.holdUntilMs) })),
      });
      if (!activeRef.current && --prewarmFramesRef.current <= 0) viewer.useDefaultRenderLoop = false;
      if (effectWarmupEntities.length && ++effectWarmupFrames >= 8) {
        effectWarmupEntities.forEach(entity => viewer.entities.remove(entity));
        effectWarmupEntities.length = 0;
      }
      const frameNow = performance.now();
      olsController.project(frameNow);
      const frameTimes = frameTimesRef.current;
      if (frameTimes.previous != null) {
        frameTimes.samples.push(frameNow - frameTimes.previous);
        if (frameNow < hitTimingRef.current.untilMs) hitTimingRef.current.frameMaxMs = Math.max(
          hitTimingRef.current.frameMaxMs, frameNow - frameTimes.previous);
        if (frameTimes.samples.length > 240) frameTimes.samples.shift();
      }
      frameTimes.previous = frameNow;
      const state = useEngine.getState();
      const controlled = state.controllableAirEntities.find(e => e.id === state.controlledControllableEntityId);
      const track = state.tracks.find(t => t.id === controlled?.selectedTrackId);
      const cue = fpvTargetCueRef.current;
      const edge = fpvEdgeCueRef.current;
      const estimate = track && track.state !== 'LOST'
        ? interpolationCache.get(`track:${track.id}`)?.displayed : null;
      if (!cue || !edge) return;
      if (!estimate || !overlaysRef.current.trackLabels || cameraModeRef.current !== CAMERA_MODE.FPV) {
        cue.style.display = 'none'; edge.style.display = 'none'; return;
      }
      const world = Cartesian3.fromDegrees(estimate.lng, estimate.lat, estimate.altitudeM);
      const screen = SceneTransforms.worldToWindowCoordinates(viewer.scene, world);
      const ahead = Cartesian3.dot(viewer.camera.directionWC,
        Cartesian3.subtract(world, viewer.camera.positionWC, new Cartesian3())) > 0;
      const inView = ahead && screen && screen.x > 0 && screen.y > 0
        && screen.x < viewer.canvas.clientWidth && screen.y < viewer.canvas.clientHeight;
      cue.style.display = inView ? 'flex' : 'none';
      edge.style.display = inView ? 'none' : 'flex';
      if (inView) {
        cue.style.left = `${screen.x}px`;
        cue.style.top = `${screen.y}px`;
      }
    });
    const reconcileTimer = window.setInterval(reconcileEntities, ENTITY_REFRESH_INTERVAL_MS);
    reconcileEntities();

    return () => {
      disposed = true;
      window.clearInterval(reconcileTimer);
      removePreRender();
      removePostRender();
      unsubscribeSnapshots();
      pickHandler.destroy();
      viewer.canvas.removeEventListener('wheel', onFreeCameraWheel, true);
      cesiumEntities.clear();
      entityMetadata.clear();
      interpolationCache.clear();
      visualStates.clear();
      trackCueEntities.clear();
      trailHistory.clear();
      plumeEntities.clear();
      smokeStrands.clear();
      launchEffects.clear();
      thermalTrailEntities.clear();
      radarBeamEntities.clear();
      seekerDebugEntities.clear();
      rawMeasurementEntities.clear();
      guidanceDebugEntitiesRef.current = null;
      smokePuffs.splice(0, smokePuffs.length);
      lastSmokeSample.clear();
      interceptEffects.clear();
      asterBoosterDebris.clear();
      trailEntityRef.current = [];
      altitudeReferenceRef.current = null;
      coldLaunchVfx.destroy();
      terminalControlVfx.destroy();
      environment.destroy();
      olsController.destroy();
      olsControllerRef.current = null;
      cameraController.destroy();
      cameraControllerRef.current = null;
      viewerRef.current = null;
      if (!viewer.isDestroyed()) viewer.destroy();
    };
  }, [selectEntity, setCameraMode, setControllableSelectedTrack, setSelectedTrack,
    returnToCommandSafely, showCameraToast]);

  useEffect(() => {
    const sampleTrails = () => {
      if (!activeRef.current) return;
      const state = useEngine.getState();
      const sampleable = [
        ...state.missiles.map(entity => ({ kind: ADVANCED_ENTITY_KIND.INTERCEPTOR, entity })),
        ...state.airTargets.map(entity => ({ kind: ADVANCED_ENTITY_KIND.TARGET, entity })),
        ...state.controllableAirEntities.map(entity => ({
          kind: ADVANCED_ENTITY_KIND.CONTROLLABLE,
          entity,
        })),
      ];
      const activeKeys = new Set();
      sampleable.forEach(({ kind, entity }) => {
        const key = makeSelectionKey(kind, entity.id);
        activeKeys.add(key);
        const history = trailHistoryRef.current.get(key) ?? [];
        const point = entityMetaRef.current.get(key)?.visualState?.position;
        if (!point) return;
        const previous = history.at(-1);
        if (!previous || previous.lat !== point.lat || previous.lng !== point.lng
          || previous.altitudeM !== point.altitudeM) {
          history.push(point);
          if (history.length > TRAIL_MAX_POINTS) history.splice(0, history.length - TRAIL_MAX_POINTS);
          trailHistoryRef.current.set(key, history);
        }
      });
      for (const key of trailHistoryRef.current.keys()) {
        if (!activeKeys.has(key)) trailHistoryRef.current.delete(key);
      }
      const selectedHistory = !olsFeedModeRef.current && trailHistoryRef.current.get(selectedKeyRef.current);
      const trailEntities = trailEntityRef.current;
      const selectedKind = parseSelectionKey(selectedKeyRef.current)?.kind;
      const trailEnabled = selectedKind === ADVANCED_ENTITY_KIND.INTERCEPTOR
        ? overlaysRef.current.missileVectors
        : overlaysRef.current.targetVectors
          || (sandboxModeRef.current && sandboxTrajectoryTrailEnabledRef.current
            && selectedKind === ADVANCED_ENTITY_KIND.TARGET);
      if (trailEnabled && selectedHistory?.length > 1
        && ![CAMERA_MODE.FIRST_PERSON, CAMERA_MODE.FPV].includes(cameraModeRef.current)) {
        const segmentSize = Math.max(2, Math.ceil(selectedHistory.length / 3));
        trailEntities.forEach((trailEntity, index) => {
          const start = Math.max(0, index * segmentSize - (index > 0 ? 1 : 0));
          const end = index === 2 ? selectedHistory.length : Math.min(
            selectedHistory.length,
            (index + 1) * segmentSize,
          );
          const segment = selectedHistory.slice(start, end);
          const positions = segment.length > 1
            ? Cartesian3.fromDegreesArrayHeights(
              segment.flatMap(point => [point.lng, point.lat, point.altitudeM]))
            : [];
          // Only the live end advances every rendered frame; historical points
          // stay pooled at the existing sampling cadence.
          const trailKey = selectedKeyRef.current;
          trailEntity.polyline.positions = new CallbackProperty(() => {
            if (index !== 2 || positions.length < 2) return positions;
            const pose = sampleVisualState(visualStatesRef.current, trailKey, visualTimeRef.current);
            return pose ? [...positions.slice(0, -1), pose.worldPosition] : positions;
          }, false);
          trailEntity.show = segment.length > 1;
        });
      } else trailEntities.forEach(entity => { entity.show = false; });

      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) return;
      const thermalTrails = thermalTrailEntitiesRef.current;
      if (visualModeRef.current !== ADVANCED_VISUAL_MODE.THERMAL) {
        thermalTrails.forEach(effect => {
          viewer.entities.remove(effect.hotSpot);
          effect.segments.forEach(segment => viewer.entities.remove(segment));
        });
        thermalTrails.clear();
        return;
      }
      for (const { kind, entity } of sampleable) {
        const key = makeSelectionKey(kind, entity.id);
        if (entityMetaRef.current.get(key)?.visualImpact) continue;
        const history = trailHistoryRef.current.get(key)?.slice(-20) ?? [];
        if (history.length < 2) continue;
        const presentation = kind === ADVANCED_ENTITY_KIND.INTERCEPTOR
          ? getAdvancedInterceptorPresentation(entity)
          : kind === ADVANCED_ENTITY_KIND.CONTROLLABLE
            ? getAdvancedControllablePresentation(entity)
            : getAdvancedTargetPresentation(entity);
        const thermalProfile = getThermalProfile(presentation.key, kind);
        let heatTrace = thermalTrails.get(key);
        if (!heatTrace) {
          const hotSpot = viewer.entities.add({
            id: `advanced-thermal-trace:${key}`,
            position: new CallbackPositionProperty((_time, result) => {
              const meta = entityMetaRef.current.get(key);
              const pose = meta?.holdUntilMs ? meta.visualState
                : sampleVisualState(visualStatesRef.current, key,
                  Math.min(visualTimeRef.current, meta?.visualImpact?.time ?? Infinity));
              if (!pose) return undefined;
              const anchorPresentation = meta?.presentation ?? presentation;
              const anchorPosition = anchorPresentation.thermalAnchorModelM
                ? getVisualModelAnchorPosition(pose, anchorPresentation, anchorPresentation.thermalAnchorModelM)
                : getVisualExhaustPosition(pose, pose.worldPosition, {
                exhaustOffsetMeters: presentation.exhaustOffsetMeters
                  ?? presentation.physicalLengthMeters * presentation.baseVisualScale * 0.4,
              });
              return Cartesian3.clone(anchorPosition, result);
            }, false),
            point: {
              pixelSize: 3 + thermalProfile.engineHeat * 3,
              color: Color.WHITE.withAlpha(0.46 + thermalProfile.engineHeat * 0.46),
              outlineColor: Color.WHITE.withAlpha(0.25), outlineWidth: 2,
              scaleByDistance: new NearFarScalar(200, 1, 30000, 0.3),
              distanceDisplayCondition: new DistanceDisplayCondition(0, 30000),
              disableDepthTestDistance: 0,
            },
          });
          const segments = [0.2, 0.42, 0.72].map((ageLuminance, index) => viewer.entities.add({
            id: `advanced-thermal-trace:${key}:${index}`,
            polyline: {
              positions: [],
              width: 0.8 + thermalProfile.exhaustHeat * 1.5,
              // Old plume segments cool and fade; the youngest remains hottest.
              material: Color.WHITE.withAlpha(ageLuminance
                * (0.2 + thermalProfile.exhaustHeat * 0.42)),
              arcType: ArcType.NONE,
              distanceDisplayCondition: new DistanceDisplayCondition(0, 180_000),
            },
          }));
          heatTrace = { hotSpot, segments };
          thermalTrails.set(key, heatTrace);
        }
        const segmentSize = Math.max(2, Math.ceil(history.length / heatTrace.segments.length));
        heatTrace.segments.forEach((segmentEntity, index) => {
          const start = Math.max(0, index * segmentSize - (index > 0 ? 1 : 0));
          const end = index === heatTrace.segments.length - 1
            ? history.length : Math.min(history.length, (index + 1) * segmentSize);
          const segment = history.slice(start, end);
          const positions = segment.length > 1
            ? Cartesian3.fromDegreesArrayHeights(
              segment.flatMap(point => [point.lng, point.lat, point.altitudeM]))
            : [];
          segmentEntity.polyline.positions = new CallbackProperty(() => {
            if (index !== heatTrace.segments.length - 1 || positions.length < 2) return positions;
            const head = heatTrace.hotSpot.position.getValue(viewer.clock.currentTime);
            return head ? [...positions.slice(0, -1), head] : positions;
          }, false);
          segmentEntity.show = overlaysRef.current.thermalTraces && segment.length > 1;
        });
        const hideHeatTrace = kind === ADVANCED_ENTITY_KIND.CONTROLLABLE
          && state.controlledControllableEntityId === entity.id
          && [CAMERA_MODE.FIRST_PERSON, CAMERA_MODE.FPV].includes(cameraModeRef.current);
        heatTrace.hotSpot.show = !hideHeatTrace;
        heatTrace.segments.forEach(segment => { segment.show = segment.show && !hideHeatTrace; });
      }
      for (const [key, heatTrace] of thermalTrails) {
        if (activeKeys.has(key)) continue;
        viewer.entities.remove(heatTrace.hotSpot);
        heatTrace.segments.forEach(segment => viewer.entities.remove(segment));
        thermalTrails.delete(key);
      }
    };
    const timer = window.setInterval(sampleTrails, TRAIL_SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const refreshOverlay = () => {
      if (!activeRef.current) return;
      const state = useEngine.getState();
      const targetById = new Map(state.airTargets.map(target => [target.id, target]));
      const trackById = new Map(state.tracks.map(track => [track.id, track]));
      const toSnapshot = (kind, entity) => {
        const presentation = kind === ADVANCED_ENTITY_KIND.INTERCEPTOR
          ? getAdvancedInterceptorPresentation(entity)
          : kind === ADVANCED_ENTITY_KIND.SEARCH_RADAR
            ? getAdvancedSearchRadarPresentation(entity)
            : kind === ADVANCED_ENTITY_KIND.CONTROLLABLE
              ? getAdvancedControllablePresentation(entity)
              : getAdvancedTargetPresentation(entity);
        const position = getEntityPosition(entity);
        const kinematics = getKinematics(entity);
        const key = makeSelectionKey(kind, entity.id);
        const meta = entityMetaRef.current.get(key);
        const modelStatus = presentation.modelUri
          ? (modelAvailabilityRef.current.get(presentation.modelUri) ?? 'LOADING')
          : 'NONE';
        const viewer = viewerRef.current;
        const positionCartesian = Cartesian3.fromDegrees(position.lng, position.lat, position.altitudeM);
        const distanceToCameraM = viewer && !viewer.isDestroyed()
          ? Cartesian3.distance(viewer.camera.positionWC, positionCartesian)
          : 0;
        const lodState = distanceToCameraM <= presentation.lodNearDistanceM
          ? 'CLOSE'
          : distanceToCameraM <= presentation.lodFarDistanceM ? 'MEDIUM' : 'FAR';
        const renderMode = meta?.presentation?.modelUri && modelStatus !== 'FAILED'
            && distanceToCameraM <= presentation.lodFarDistanceM
          ? 'GLB'
          : kind === ADVANCED_ENTITY_KIND.CONTROLLABLE ? 'PRIMITIVE' : 'BILLBOARD';
        let distanceToTargetKm = null;
        if (kind === ADVANCED_ENTITY_KIND.INTERCEPTOR && entity.targetId) {
          const target = targetById.get(entity.targetId);
          if (target) {
            const targetPosition = getEntityPosition(target);
            distanceToTargetKm = Cartesian3.distance(
              Cartesian3.fromDegrees(position.lng, position.lat, position.altitudeM),
              Cartesian3.fromDegrees(
                targetPosition.lng,
                targetPosition.lat,
                targetPosition.altitudeM,
              ),
            ) / 1000;
          }
        }
        const selectedTrack = kind === ADVANCED_ENTITY_KIND.CONTROLLABLE
          && isAvailableNetworkTrack(trackById.get(entity.selectedTrackId))
          ? trackById.get(entity.selectedTrackId)
          : null;
        const missileTrack = kind === ADVANCED_ENTITY_KIND.INTERCEPTOR
          ? trackById.get(entity.trackId) : null;
        const seekerProfile = entity.seeker ? getSeekerProfile(entity.seeker.profileId) : null;
        const guidanceData = entity.guidance ?? {};
        const accelerationToG = value => Number.isFinite(value)
          ? value / 9.80665 : null;
        const guidanceDiagnostics = {
          losAzimuthDeg: entity.losAzimuthDeg ?? guidanceData.losAzimuthDeg ?? null,
          losElevationDeg: entity.losElevationDeg ?? guidanceData.losElevationDeg ?? null,
          losRateDegPerSec: entity.losRateDegPerSec ?? guidanceData.losRateDegPerSec ?? null,
          losAzimuthRateDegPerSec: entity.losAzimuthRateDegPerSec
            ?? guidanceData.losAzimuthRateDegPerSec ?? null,
          losElevationRateDegPerSec: entity.losElevationRateDegPerSec
            ?? guidanceData.losElevationRateDegPerSec ?? null,
          headingErrorDeg: entity.headingCorrectionDeg ?? guidanceData.headingCorrectionDeg ?? null,
          pitchErrorDeg: entity.pitchErrorDeg ?? guidanceData.pitchErrorDeg ?? null,
          commandedHorizontalG: accelerationToG(entity.commandedHorizontalAccelerationMps2
            ?? guidanceData.commandedHorizontalAccelerationMps2),
          commandedVerticalG: accelerationToG(entity.commandedVerticalAccelerationMps2
            ?? guidanceData.commandedVerticalAccelerationMps2),
          actualHorizontalG: accelerationToG(entity.actualHorizontalAccelerationMps2
            ?? guidanceData.actualHorizontalAccelerationMps2),
          actualVerticalG: accelerationToG(entity.actualVerticalAccelerationMps2
            ?? guidanceData.actualVerticalAccelerationMps2),
          requiredHorizontalG: accelerationToG(entity.requiredCorrectionAccelerationMps2
            ?? guidanceData.requiredCorrectionAccelerationMps2),
          requiredVerticalG: accelerationToG(entity.requiredVerticalAccelerationMps2
            ?? guidanceData.requiredVerticalAccelerationMps2),
          aeroAvailableG: entity.aeroAvailableG ?? guidanceData.aeroAvailableG ?? null,
          energyLimitedG: entity.energyLimitedG ?? guidanceData.energyLimitedG ?? null,
          autopilotAllowedG: entity.autopilotAllowedG ?? guidanceData.autopilotAllowedG ?? null,
        };
        let selectedTrackDistanceKm = null;
        let selectedTrackBearingDeltaDeg = null;
        let selectedTrackVisibleLineOfSight = null;
        let selectedTrackClosingMps = null;
        let selectedTrackScreen = null;
        if (selectedTrack?.reportedPosition) {
          const selectedTrackAltitudeM = selectedTrack.reportedAltitudeM
            ?? selectedTrack.reportedPosition.altitudeM
            ?? selectedTrack.reportedPosition.alt
            ?? 0;
          const selectedTrackCartesian = Cartesian3.fromDegrees(
            selectedTrack.reportedPosition.lng,
            selectedTrack.reportedPosition.lat,
            selectedTrackAltitudeM,
          );
          selectedTrackDistanceKm = Cartesian3.distance(
            positionCartesian,
            selectedTrackCartesian,
          ) / 1000;
          const viewer = viewerRef.current;
          const projected = viewer && !viewer.isDestroyed()
            ? SceneTransforms.worldToWindowCoordinates(viewer.scene, selectedTrackCartesian)
            : null;
          if (projected && viewer?.canvas) {
            const x = projected.x / viewer.canvas.clientWidth;
            const y = projected.y / viewer.canvas.clientHeight;
            const targetFromCamera = Cartesian3.subtract(
              selectedTrackCartesian,
              viewer.camera.positionWC,
              new Cartesian3(),
            );
            const isAheadOfCamera = Cartesian3.dot(
              viewer.camera.directionWC,
              targetFromCamera,
            ) > 0;
            selectedTrackScreen = { x, y, inView: isAheadOfCamera
              && x >= 0.05 && x <= 0.95 && y >= 0.05 && y <= 0.95 };
          }
          const absoluteBearingDeg = getBearing(
            position.lat,
            position.lng,
            selectedTrack.reportedPosition.lat,
            selectedTrack.reportedPosition.lng,
          );
          selectedTrackBearingDeltaDeg = ((absoluteBearingDeg - (entity.heading ?? 0) + 540) % 360) - 180;
          const surfaceDistanceKm = getDistanceKm(
            position.lat,
            position.lng,
            selectedTrack.reportedPosition.lat,
            selectedTrack.reportedPosition.lng,
          );
          const geometricHorizonKm = 3.57 * (
            Math.sqrt(Math.max(0, position.altitudeM))
            + Math.sqrt(Math.max(0, selectedTrackAltitudeM))
          );
          selectedTrackVisibleLineOfSight = surfaceDistanceKm <= geometricHorizonKm * 1.04;
          const rangeKey = `${entity.id}:${selectedTrack.id}`;
          const timestampMs = performance.now();
          const previousRange = trackRangeHistoryRef.current.get(rangeKey);
          if (previousRange && timestampMs - previousRange.timestampMs >= 100) {
            const instantaneousMps = (previousRange.distanceKm - selectedTrackDistanceKm)
              * 1_000 / ((timestampMs - previousRange.timestampMs) / 1_000);
            selectedTrackClosingMps = clamp(
              previousRange.closingMps == null ? instantaneousMps
                : previousRange.closingMps * 0.65 + instantaneousMps * 0.35,
              -500, 500,
            );
          }
          trackRangeHistoryRef.current.set(rangeKey, {
            distanceKm: selectedTrackDistanceKm,
            timestampMs,
            closingMps: selectedTrackClosingMps ?? previousRange?.closingMps ?? null,
          });
        }
        return {
          kind, id: entity.id, displayName: presentation.displayName,
          altitudeM: position.altitudeM, speedKmh: kinematics.speedKmh,
          headingDeg: kinematics.headingDeg,
          verticalSpeedMps: kinematics.upMps, pitchDeg: kinematics.pitchDeg,
          rollDeg: kinematics.rollDeg,
          targetId: entity.targetId ?? null,
          trackId: entity.trackId ?? null,
          guidanceSource: entity.guidanceSource ?? entity.guidance?.guidanceSource ?? null,
          sourceBatteryId: entity.sourceBatteryId ?? null,
          sourceRadarId: missileTrack?.sourceRadarId ?? null,
          seeker: entity.seeker ? {
            seekerType: entity.seeker.seekerType,
            state: entity.seeker.state,
            evidence: entity.seeker.evidence ?? 0,
            acquisitionScore: entity.seeker.acquisitionScore ?? 0,
            distanceKm: entity.seeker.distanceKm,
            baselineRangeKm: seekerProfile?.baselineLockRangeKm ?? 0,
            effectiveRangeKm: entity.seeker.effectiveRangeKm ?? 0,
            positionUncertaintyM: entity.seeker.targetEstimate?.positionUncertaintyM ?? null,
          } : null,
          distanceToTargetKm,
          guidanceState: entity.guidanceState ?? entity.ballisticPhysics?.phase ?? null,
          kinematicPhase: entity.kinematicPhase ?? null,
          currentG: entity.currentG ?? guidanceData.currentG ?? null,
          maximumG: entity.maximumG ?? guidanceData.maximumG ?? entity.profileMaxG ?? null,
          closingSpeedMps: entity.closingSpeedMps ?? guidanceData.closingSpeedMps ?? null,
          estimatedTimeToGoSec: entity.estimatedTimeToGoSec
            ?? guidanceData.estimatedTimeToGoSec ?? null,
          interceptSolutionStatus: entity.interceptSolutionStatus
            ?? guidanceData.interceptSolutionStatus ?? null,
          guidanceDiagnostics,
          ballistic: entity.ballisticPhysics?.enabled === true,
          status: entity.status ?? entity.state ?? 'ACTIVE',
          batteryRemaining: entity.batteryRemaining ?? null,
          batteryRemainingWh: entity.batteryRemainingWh ?? null,
          batteryVoltageV: entity.batteryVoltageV ?? null,
          nominalVoltageV: entity.nominalVoltageV ?? null,
          currentPowerKw: entity.currentPowerKw ?? null,
          currentAmps: entity.currentAmps ?? null,
          flightTimeSec: entity.flightTimeSec ?? null,
          linkQuality: entity.linkQuality ?? null,
          flightPhase: entity.flightPhase ?? null,
          manualControlEnabled: entity.manualControlEnabled ?? null,
          launchSourceId: entity.launchSourceId ?? null,
          selectedTrackId: entity.selectedTrackId ?? null,
          controlMode: entity.controlMode ?? CONTROLLABLE_CONTROL_MODE.MANUAL,
          navigation: entity.navigation ?? null,
          cameraMode: entity.cameraMode ?? null,
          rawInput: entity.controlState?.rawInput ?? null,
          smoothedInput: entity.controlState?.smoothedInput ?? null,
          desiredRatesDegPerSec: entity.controlState?.desiredRatesDegPerSec ?? null,
          actualRatesDegPerSec: entity.controlState?.actualRatesDegPerSec ?? null,
          throttleDemand: entity.throttleDemand ?? entity.controlState?.smoothedInput?.throttle ?? null,
          forceTelemetry: entity.forceTelemetry ?? null,
          velocityVector: kind === ADVANCED_ENTITY_KIND.CONTROLLABLE ? {
            x: entity.vx ?? 0,
            y: entity.vy ?? 0,
            z: entity.vz ?? 0,
          } : null,
          accelerationVector: kind === ADVANCED_ENTITY_KIND.CONTROLLABLE
            ? entity.acceleration ?? null
            : null,
          physicsPosition: position,
          physicsOrientation: {
            pitch: kinematics.pitchDeg,
            yaw: kinematics.headingDeg,
            roll: kinematics.rollDeg,
          },
          renderPosition: meta?.visualState?.diagnostics?.renderPosition ?? null,
          renderOrientation: meta?.visualState?.diagnostics?.renderOrientation ? {
            pitch: meta.visualState.diagnostics.renderOrientation.pitchDeg,
            yaw: meta.visualState.diagnostics.renderOrientation.headingDeg,
            roll: meta.visualState.diagnostics.renderOrientation.rollDeg,
          } : null,
          visualCadence: meta?.visualState?.diagnostics ? {
            physicsIntervalMs: meta.visualState.diagnostics.physicsIntervalMs,
            renderDeltaMs: meta.visualState.diagnostics.renderDeltaMs,
            interpolationDurationMs: meta.visualState.diagnostics.interpolationDurationMs,
            extrapolationMs: meta.visualState.diagnostics.extrapolationMs,
          } : null,
          selectedTrack: selectedTrack ? {
            id: selectedTrack.id,
            displayName: selectedTrack.identifiedModelId
              ? getTargetDisplayName(selectedTrack.identifiedModelId)
              : selectedTrack.identifiedType ?? selectedTrack.classifiedType ?? 'AIR TRACK',
            state: selectedTrack.state,
            altitudeM: selectedTrack.reportedAltitudeM
              ?? selectedTrack.reportedPosition?.altitudeM
              ?? selectedTrack.reportedPosition?.alt
              ?? null,
            speedKmh: selectedTrack.reportedSpeedKmh ?? null,
            distanceKm: selectedTrackDistanceKm,
            bearingDeltaDeg: selectedTrackBearingDeltaDeg,
            visibleLineOfSight: selectedTrackVisibleLineOfSight,
            trackQuality: selectedTrack.trackQuality ?? 0,
            measurementAgeSec: selectedTrack.measurementAgeSec ?? 0,
            closingSpeedMps: selectedTrackClosingMps,
            uncertaintyM: Math.max(20, (1 - (selectedTrack.trackQuality ?? 0)) * 450
              + (selectedTrack.measurementAgeSec ?? 0) * 55),
            screen: selectedTrackScreen,
          } : null,
          throttleAssist: kind === ADVANCED_ENTITY_KIND.CONTROLLABLE
            && state.controlledControllableEntityId === entity.id
            ? useManualControlStore.getState().throttleAssist : null,
          collisionState: entity.lastCollision?.kind ?? 'CLEAR',
          visualDebug: {
            renderMode,
            lodState,
            distanceToCameraKm: distanceToCameraM / 1000,
            resolvedModelPath: presentation.modelUri ?? '—',
            modelStatus,
            visualScale: presentation.baseVisualScale,
          },
        };
      };
      const targets = state.airTargets.map(entity => toSnapshot(ADVANCED_ENTITY_KIND.TARGET, entity));
      const missiles = state.missiles.map(entity => toSnapshot(ADVANCED_ENTITY_KIND.INTERCEPTOR, entity));
      const searchRadars = state.searchRadars.map(entity => ({
        ...toSnapshot(ADVANCED_ENTITY_KIND.SEARCH_RADAR, entity),
        status: entity.operational ? 'ACTIVE' : 'OFF',
      }));
      const controllables = state.controllableAirEntities.map(entity => (
        toSnapshot(ADVANCED_ENTITY_KIND.CONTROLLABLE, entity)
      ));
      const tracks = state.tracks
        .filter(isAvailableNetworkTrack)
        .map(track => ({
          id: track.id,
          displayName: track.identifiedModelId
            ? getTargetDisplayName(track.identifiedModelId)
            : track.identifiedType ?? track.classifiedType ?? 'AIR TRACK',
        }));
      setEntitySnapshot({ targets, missiles, searchRadars, controllables, tracks });
      const selection = parseSelectionKey(selectedKeyRef.current);
      const selected = selection
        ? [...targets, ...missiles, ...searchRadars, ...controllables].find(
          entity => entity.kind === selection.kind
          && entity.id === selection.id)
        : null;
      setSelectedTelemetry(selected ?? null);
      if (selected?.kind === ADVANCED_ENTITY_KIND.CONTROLLABLE
        && state.controlledControllableEntityId === selected.id
        && cameraModeRef.current === CAMERA_MODE.FPV) {
        setLastFpvTelemetry(selected);
      }
    };
    const timer = window.setInterval(refreshOverlay, ENTITY_REFRESH_INTERVAL_MS);
    refreshOverlay();
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const enginePerformance = samplePerformance();
      const samples = frameTimesRef.current.samples.splice(0).sort((a, b) => a - b);
      const average = samples.length ? samples.reduce((sum, ms) => sum + ms, 0) / samples.length : 0;
      setPerformanceSnapshot({
        fps: average > 0 ? Math.round(1000 / average) : 0,
        averageMs: average,
        p95Ms: samples[Math.floor(samples.length * .95)] ?? 0,
        renderMs: samples.at(-1) ?? 0,
        simulationMs: enginePerformance.simulationUpdateMs,
        hit: { ...hitTimingRef.current },
      });
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const activeControl = selectedTelemetry?.kind === ADVANCED_ENTITY_KIND.CONTROLLABLE
    && controlledControllableEntityId === selectedTelemetry.id;
  const controlDetailsOpen = activeControl && controlDetailsEntityId === controlledControllableEntityId;
  const compactControl = activeControl && !controlDetailsOpen;
  const fpvTelemetry = selectedTelemetry ?? lastFpvTelemetry;

  return <main className={`advanced-scene${activeControl ? ' has-active-control' : ''}${cameraMode === CAMERA_MODE.FPV ? ' is-fpv-camera' : ''}${fpvFeedMode ? ' is-fpv-feed' : ''}${signalLost ? ' is-signal-lost' : ''}${visualMode === ADVANCED_VISUAL_MODE.THERMAL ? ' is-thermal' : ''}${visualMode === ADVANCED_VISUAL_MODE.LOW_LIGHT ? ' is-low-light' : ''}`}>
    <div ref={containerRef} className="advanced-scene__globe" />
    {olsFeedMode && <OlsHud stationId={olsStationId} ru={ru} bracketRef={olsBracketRef}
      torMode={Boolean(torOlsReturnScene)} torManual={torOlsManual}
      onSelect={key => olsControllerRef.current?.select(key)}
      onLock={() => olsControllerRef.current?.lockCrosshair()}
      onRelease={() => olsControllerRef.current?.releaseLock()}
      onExit={returnToCommandSafely}
      returnLabel={ru ? 'НАЗАД' : 'BACK'} />}
    {!cameraFeedMode && <AdvancedToolbar cameraMode={cameraMode} setCameraMode={setCameraMode}
      resetCamera={resetCamera}
      returnToCommand={returnToCommandSafely}
      visualMode={visualMode}
      setVisualMode={setVisualMode}
      openOls={() => {
        const state = useEngine.getState();
        const station = state.searchRadars[0] ?? state.batteries[0];
        if (!station) return;
        olsFromAdvancedRef.current = true;
        useGameStore.getState().openOlsFeed(useGameStore.getState().commandScene, station.id);
      }}
      spawnTestEntity={() => {
        const id = spawnControllableTestEntity();
        if (id) selectEntity(makeSelectionKey(ADVANCED_ENTITY_KIND.CONTROLLABLE, id), true);
      }}
      controllableSelected={selectedTelemetry?.kind === ADVANCED_ENTITY_KIND.CONTROLLABLE
        && controlledControllableEntityId === selectedTelemetry.id}
      ru={ru} engineeringEnabled={engineeringEnabled} sandboxMode={sandboxMode} />}
    <GroundPlacement viewer={viewerReady} enabled={!cameraFeedMode} selected={groundSelected}
      onSelect={key => { setGroundSelected(key); if (key) { setCameraMode(CAMERA_MODE.FREE); setSelectedKey(null); } }}
      onOpenTorOls={stationId => {
        const battery = useEngine.getState().batteries.find(item => item.id === stationId);
        openCanonicalTorOls(battery);
      }} ru={ru} />
    {!cameraFeedMode && <AdvancedSessionPanel viewer={viewerReady} ru={ru} sandboxMode={sandboxMode}
      trajectoryTrailEnabled={sandboxTrajectoryTrailEnabled} onTrajectoryTrailChange={setSandboxTrajectoryTrailEnabled}
      onFocus={key => selectEntity(key, true)}
      onOls={stationId => {
        const tor = useEngine.getState().batteries.find(item => item.id === stationId
          && item.category === 'TOR_M1');
        if (tor) { openCanonicalTorOls(tor); return; }
        olsFromAdvancedRef.current = true;
        useGameStore.getState().openOlsFeed(useGameStore.getState().commandScene, stationId);
      }} />}
    {!cameraFeedMode && <AdvancedTimeControls timeScale={timeScale} setTimeScale={setTimeScale} ru={ru} />}
    {!cameraFeedMode && !compactControl && <EntityList snapshot={entitySnapshot} selectedKey={selectedKey}
      onSelect={key => { setGroundSelected(null); selectEntity(key, true); }} ru={ru}
      groundSelected={groundSelected} onGroundSelect={key => { setGroundSelected(key); setCameraMode(CAMERA_MODE.FREE); setSelectedKey(null); }} />}
    {!cameraFeedMode && <aside className="advanced-right-dock">
      <EnvironmentControls sandboxMode={sandboxMode} ru={ru} />
      <AdvancedOverlayMenu engineeringEnabled={engineeringEnabled} onEngineeringChange={setEngineeringEnabled} />
      <MissileLog />
      {!compactControl && selectedTelemetry && <SelectedTelemetry entity={selectedTelemetry} trackOptions={entitySnapshot.tracks}
        ru={ru} debugOverlayVisible={engineeringEnabled && (debugOverlayVisible || advancedOverlays.debug)}
        controlledEntityId={controlledControllableEntityId}
        onTakeControl={id => {
          setControllableControlMode(id, CONTROLLABLE_CONTROL_MODE.MANUAL);
          setControlDetailsEntityId(null);
          if (timeScale !== 1) setTimeScale(1);
          enterAdvancedFpv(id);
        }}
        onExitControl={() => {
          if (advancedFpvReturnRef.current) { exitAdvancedFpv(); return; }
          releaseControllableControl();
          setCameraMode(CAMERA_MODE.FREE);
          showCameraToast(ru ? 'УПРАВЛЕНИЕ ОТКЛЮЧЕНО' : 'CONTROL RELEASED');
        }}
        onDestroyControllable={id => {
          destroyControllableEntity(id);
          selectedKeyRef.current = null;
          setSelectedKey(null);
          setSelectedTelemetry(null);
          setCameraMode(CAMERA_MODE.FREE);
        }}
        onSelectTrack={setControllableSelectedTrack}
        onSetControlMode={(id, mode) => {
          const entity = useEngine.getState().controllableAirEntities.find(candidate => candidate.id === id);
          if (mode === CONTROLLABLE_CONTROL_MODE.MANUAL) {
            setControllableControlMode(id, mode);
            setControlledControllableEntity(id);
          } else if (mode === CONTROLLABLE_CONTROL_MODE.HOLD) {
            setControllableControlMode(id, mode);
          } else if (entity?.selectedTrackId) {
            releaseControllableControl();
            setControllableNavigationTrack(id, entity.selectedTrackId);
          }
        }}
        onFollow={id => {
          setSelectedControllableEntity(id);
          setCameraMode(CAMERA_MODE.THIRD_PERSON);
        }}
        onOpenFpv={enterAdvancedFpv}
        onOpenOls={targetId => {
          const state = useEngine.getState();
          const station = state.batteries.find(item => item.id === state.selectedBatteryId
            && item.category === 'TOR_M1')
            ?? state.batteries.find(item => item.category === 'TOR_M1')
            ?? state.searchRadars[0] ?? state.batteries.find(item => item.components?.radar);
          if (!station) { showCameraToast(ru ? 'OLS НЕДОСТУПНА' : 'OLS UNAVAILABLE'); return; }
          olsFromAdvancedRef.current = true;
          const targetKey = makeSelectionKey(ADVANCED_ENTITY_KIND.TARGET, targetId);
          if (station.category === 'TOR_M1') openCanonicalTorOls(station, targetKey);
          else useGameStore.getState().openOlsFeed(useGameStore.getState().commandScene,
            station.id, targetKey);
        }} />}
      {engineeringEnabled && advancedOverlays.performance && <output className="advanced-performance">
        FPS {performanceSnapshot.fps} · AVG {(performanceSnapshot.averageMs ?? 0).toFixed(1)} · P95 {(performanceSnapshot.p95Ms ?? 0).toFixed(1)} · FRAME MAX {performanceSnapshot.renderMs.toFixed(1)} MS · SIM {performanceSnapshot.simulationMs.toFixed(2)} MS
        {' · '}HIT VFX {(performanceSnapshot.hit?.vfxMs ?? 0).toFixed(2)} · CLEANUP {(performanceSnapshot.hit?.reconcileMs ?? 0).toFixed(2)} · HIT FRAME {(performanceSnapshot.hit?.frameMaxMs ?? 0).toFixed(1)} MS
      </output>}
    </aside>}
    {!cameraFeedMode && activeControl && <aside className="advanced-control-summary" aria-label={ru ? 'Управление видом' : 'View controls'}>
      <span>CAM {cameraMode}</span>
      {cameraMode !== CAMERA_MODE.FPV && <>
        <span>BATT {Math.round(selectedTelemetry.batteryRemaining * 100)}%</span>
        {selectedTelemetry.batteryVoltageV != null && <span>{selectedTelemetry.batteryVoltageV.toFixed(1)} V</span>}
        <span>SPD {Math.round(selectedTelemetry.speedKmh)} KM/H</span>
        <span>ALT {Math.round(selectedTelemetry.altitudeM)} M</span>
        <span>LINK {Math.round(selectedTelemetry.linkQuality * 100)}%</span>
      </>}
      <button type="button" aria-expanded={controlDetailsOpen}
        onClick={() => setControlDetailsEntityId(controlDetailsOpen ? null : controlledControllableEntityId)}>
        {ru ? (controlDetailsOpen ? 'СВЕРНУТЬ ПАНЕЛИ' : 'ПАНЕЛИ') : (controlDetailsOpen ? 'HIDE PANELS' : 'PANELS')}
      </button>
      <button type="button" onClick={() => {
        if (advancedFpvReturnRef.current) { exitAdvancedFpv(); return; }
        releaseControllableControl();
        setCameraMode(CAMERA_MODE.FREE);
      }}>{ru ? 'ВЫЙТИ · ESC' : 'EXIT · ESC'}</button>
    </aside>}
    {!cameraFeedMode && cameraToast && <div className="advanced-camera-toast">{cameraToast}</div>}
    {cameraMode === CAMERA_MODE.FPV && !olsFeedMode && <nav className="fpv-feed-actions">
      {fpvTelemetry && <>
        <button className={fpvTelemetry.controlMode === CONTROLLABLE_CONTROL_MODE.MANUAL ? 'is-active' : ''}
          onClick={() => {
            setControllableControlMode(fpvTelemetry.id, CONTROLLABLE_CONTROL_MODE.MANUAL);
            setControlledControllableEntity(fpvTelemetry.id);
          }}>{ru ? 'РУЧНОЙ' : 'MANUAL'}</button>
        <button className={fpvTelemetry.controlMode === CONTROLLABLE_CONTROL_MODE.HOLD ? 'is-active' : ''}
          onClick={() => setControllableControlMode(fpvTelemetry.id, CONTROLLABLE_CONTROL_MODE.HOLD)}>{ru ? 'ВИСЕНИЕ' : 'HOVER'}</button>
        <button disabled={!fpvTelemetry.selectedTrackId}
          className={fpvTelemetry.controlMode === CONTROLLABLE_CONTROL_MODE.AUTO_NAV ? 'is-active' : ''}
          onClick={() => setControllableNavigationTrack(fpvTelemetry.id,
            fpvTelemetry.selectedTrackId)}>{ru ? 'АВТО НАВ.' : 'AUTO NAV'}</button>
      </>}
      {Object.values(ADVANCED_VISUAL_MODE).map(mode => (
        <button key={mode} className={visualMode === mode ? 'is-active' : ''}
          aria-pressed={visualMode === mode} onClick={() => setVisualMode(mode)}>{mode}</button>
      ))}
      <button onClick={fpvFeedMode ? returnToCommandSafely : exitAdvancedFpv}>ESC · {fpvFeedMode ? 'COMMAND' : (ru ? 'НАЗАД' : 'BACK')}</button>
    </nav>}
    {cameraMode === CAMERA_MODE.FPV && fpvTelemetry && (
      <FpvOsd telemetry={fpvTelemetry} visualMode={visualMode} signalLost={signalLost}
        trackOptions={entitySnapshot.tracks}
        onSelectTrack={trackId => setControllableSelectedTrack(fpvTelemetry.id, trackId)}
        attitudeRef={fpvAttitudeRef} contactRef={fpvMapContactRef}
        targetCueRef={fpvTargetCueRef} edgeCueRef={fpvEdgeCueRef} />
    )}
    {!cameraFeedMode && entitySnapshot.targets.length + entitySnapshot.missiles.length
      + entitySnapshot.controllables.length === 0 && (
      <div className="advanced-empty-state">
        <strong>{ru ? 'НЕТ АКТИВНЫХ ВОЗДУШНЫХ ОБЪЕКТОВ' : 'NO ACTIVE AIRBORNE ENTITIES'}</strong>
        <span>{sandboxMode
          ? (ru ? 'Добавьте ПВО и радар, затем цель. Выберите цель для пуска или OLS.' : 'Add a SAM and radar, then a target. Select the target to launch or open OLS.')
          : (ru ? 'Добавьте цель или FPV через панель «Добавить цель».' : 'Add a target or FPV using Add target.')}</span>
      </div>
    )}
  </main>;
}
