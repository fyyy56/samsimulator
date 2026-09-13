import { useEffect, useMemo, useRef, useState } from 'react';
import {
  cloneLaunchProfile,
  DEFAULT_LAUNCH_PROFILES,
  LAUNCH_MODE,
  LAUNCH_PROFILE_LIST,
  normalizeLaunchProfile,
} from '../data/launchProfiles.js';
import { getLightAsset } from '../data/lightModeAssets.js';
import { getLaunchProfile, useLaunchProfileStore } from '../store/launchProfileStore.js';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const TEST_TARGET = Object.freeze({ x: 0.82, y: 0.24 });

export default function LaunchProfileEditor() {
  const savedProfiles = useLaunchProfileStore(state => state.savedProfiles);
  const saveProfile = useLaunchProfileStore(state => state.saveProfile);
  const resetProfile = useLaunchProfileStore(state => state.resetProfile);
  const initialProfileId = LAUNCH_PROFILE_LIST[0].interceptorSpecId;
  const [profileId, setProfileId] = useState(initialProfileId);
  const [draft, setDraft] = useState(() => getLaunchProfile(initialProfileId));
  const [baseline, setBaseline] = useState(() => getLaunchProfile(initialProfileId));
  const [draggingPoint, setDraggingPoint] = useState(false);
  const [testTime, setTestTime] = useState(null);
  const [notice, setNotice] = useState('');
  const previewRef = useRef(null);
  const testStartRef = useRef(0);
  const testActive = testTime !== null;
  const activePoint = draft.launchPoints[0];
  const launcherAsset = getLightAsset(draft.launcherAssetId);
  const missileAsset = getLightAsset(draft.missileAssetId);
  const hasUnsavedChanges = useMemo(() => (
    JSON.stringify(normalizeLaunchProfile(draft, DEFAULT_LAUNCH_PROFILES[profileId]))
    !== JSON.stringify(baseline)
  ), [baseline, draft, profileId]);

  const loadProfile = interceptorSpecId => {
    const loaded = getLaunchProfile(interceptorSpecId);
    setProfileId(interceptorSpecId);
    setDraft(loaded);
    setBaseline(cloneLaunchProfile(loaded));
    setDraggingPoint(false);
    setTestTime(null);
    testStartRef.current = 0;
    setNotice('');
  };

  const updatePointFromEvent = event => {
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nextPoint = {
      ...activePoint,
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
    setDraft(current => ({ ...current, launchPoints: [nextPoint] }));
  };

  const updateDraft = (key, value) => {
    setDraft(current => ({ ...current, [key]: value }));
    setNotice('');
  };

  const updateDirection = value => {
    setDraft(current => ({
      ...current,
      launchPoints: [{
        ...current.launchPoints[0],
        launchDirectionOffsetDeg: Number(value),
      }],
    }));
    setNotice('');
  };

  useEffect(() => {
    if (!testActive) return undefined;
    let animationFrame;
    const animate = timestamp => {
      if (!testStartRef.current) testStartRef.current = timestamp;
      const elapsedSec = (timestamp - testStartRef.current) / 1000;
      setTestTime(elapsedSec);
      if (elapsedSec < 2.8) animationFrame = window.requestAnimationFrame(animate);
      else {
        setTestTime(null);
        testStartRef.current = 0;
      }
    };
    animationFrame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [testActive]);

  const testMissile = useMemo(() => {
    if (testTime === null) return null;
    const directionRad = activePoint.launchDirectionOffsetDeg * Math.PI / 180;
    const guidanceDelay = Math.max(draft.guidanceEnableDelaySec, draft.initialTurnDelaySec ?? 0);
    const targetHeading = Math.atan2(
      TEST_TARGET.x - activePoint.x,
      -(TEST_TARGET.y - activePoint.y),
    ) * 180 / Math.PI;
    if (draft.launchMode === 'VERTICAL') {
      const exitDurationSec = Math.max(0.1, draft.verticalDepartureDurationSec ?? 0.5);
      const pitchDurationSec = Math.max(0.1, draft.turnToTargetDurationSec ?? 0.6);
      if (testTime <= exitDurationSec) return {
        x: activePoint.x,
        y: activePoint.y,
        heading: targetHeading,
        guidanceEnabled: false,
        phase: 'LAUNCH_EXIT',
      };
      const pitchProgress = clamp((testTime - exitDurationSec) / pitchDurationSec, 0, 1);
      const easedPitch = pitchProgress * pitchProgress * (3 - 2 * pitchProgress);
      const pitchDistance = 0.08 * easedPitch;
      if (pitchProgress < 1) return {
        x: activePoint.x + Math.sin(targetHeading * Math.PI / 180) * pitchDistance,
        y: activePoint.y - Math.cos(targetHeading * Math.PI / 180) * pitchDistance,
        heading: targetHeading,
        guidanceEnabled: false,
        phase: 'PITCH_OVER',
      };
      const guidanceProgress = clamp((testTime - exitDurationSec - pitchDurationSec) / 0.8, 0, 1);
      return {
        x: activePoint.x + (TEST_TARGET.x - activePoint.x) * guidanceProgress,
        y: activePoint.y + (TEST_TARGET.y - activePoint.y) * guidanceProgress,
        heading: targetHeading,
        guidanceEnabled: true,
        phase: 'GUIDANCE',
      };
    }
    const departureProgress = clamp(testTime / Math.max(guidanceDelay, 0.1), 0, 1);
    const departureDistance = 0.2 * departureProgress;
    const departure = {
      x: activePoint.x + Math.sin(directionRad) * departureDistance,
      y: activePoint.y - Math.cos(directionRad) * departureDistance,
    };
    if (testTime <= guidanceDelay) return {
      ...departure,
      heading: activePoint.launchDirectionOffsetDeg,
      guidanceEnabled: false,
      phase: 'LAUNCH_EXIT',
    };
    const turnProgress = clamp(
      (testTime - guidanceDelay) / Math.max(draft.turnToTargetDurationSec, 0.1),
      0,
      1,
    );
    const eased = turnProgress * turnProgress * (3 - 2 * turnProgress);
    const x = departure.x + (TEST_TARGET.x - departure.x) * eased;
    const y = departure.y + (TEST_TARGET.y - departure.y) * eased;
    return {
      x,
      y,
      heading: Math.atan2(TEST_TARGET.x - x, -(TEST_TARGET.y - y)) * 180 / Math.PI,
      guidanceEnabled: true,
      phase: 'GUIDANCE',
    };
  }, [activePoint, draft.guidanceEnableDelaySec, draft.initialTurnDelaySec, draft.launchMode, draft.turnToTargetDurationSec, draft.verticalDepartureDurationSec, testTime]);

  const save = () => {
    const normalized = normalizeLaunchProfile(draft, DEFAULT_LAUNCH_PROFILES[profileId]);
    saveProfile(normalized);
    setDraft(cloneLaunchProfile(normalized));
    setBaseline(cloneLaunchProfile(normalized));
    setNotice('PROFILE SAVED');
    window.setTimeout(() => setNotice(''), 1800);
  };

  const startTest = () => {
    testStartRef.current = 0;
    setTestTime(0);
  };

  const reset = () => {
    resetProfile(profileId);
    const fallback = cloneLaunchProfile(DEFAULT_LAUNCH_PROFILES[profileId]);
    setDraft(fallback);
    setBaseline(cloneLaunchProfile(fallback));
    setTestTime(null);
    testStartRef.current = 0;
    setNotice('PROFILE RESET');
  };

  const numberField = (label, key, minimum, maximum, step = 0.01, suffix = '') => (
    <label className="launch-profile-field">
      <span>{label}</span>
      <div>
        <input
          type="number"
          min={minimum}
          max={maximum}
          step={step}
          value={draft[key]}
          onChange={event => updateDraft(key, Number(event.target.value))}
        />
        {suffix && <small>{suffix}</small>}
      </div>
    </label>
  );

  return <div className="launch-profile-editor is-simple" data-design-ui="true">
    <header className="launch-profile-editor__selector">
      <div className="launch-profile-editor__identity">
        <label>SYSTEM<select value={profileId} onChange={event => loadProfile(event.target.value)}>{LAUNCH_PROFILE_LIST.map(profileValue => <option key={profileValue.interceptorSpecId} value={profileValue.interceptorSpecId}>{profileValue.systemName}</option>)}</select></label>
        <label>LAUNCHER<select value={draft.launcherId} disabled><option value={draft.launcherId}>{draft.launcherName}</option></select></label>
        <label>MISSILE<select value={draft.interceptorSpecId} disabled><option value={draft.interceptorSpecId}>{draft.missileName}</option></select></label>
        <label>LAUNCH MODE<select value={draft.launchMode} onChange={event => updateDraft('launchMode', event.target.value)}><option value={LAUNCH_MODE.INCLINED}>INCLINED</option><option value={LAUNCH_MODE.VERTICAL}>VERTICAL</option></select></label>
      </div>
      <strong className={hasUnsavedChanges ? 'is-unsaved' : 'is-saved'}>{hasUnsavedChanges ? 'UNSAVED' : notice || (savedProfiles[draft.id] ? 'PROFILE SAVED' : 'STARTING PROFILE')}</strong>
    </header>

    <section className="launch-profile-preview">
      <div
        className="launch-profile-preview__stage"
      >
        <div
        ref={previewRef}
        className="launch-profile-preview__launcher-frame"
        onPointerMove={event => { if (draggingPoint) updatePointFromEvent(event); }}
        onPointerUp={() => setDraggingPoint(false)}
        onPointerCancel={() => setDraggingPoint(false)}
      >
        <img className="launch-profile-preview__launcher" src={launcherAsset.src} alt={launcherAsset.label} draggable="false" />
        {draft.launchMode === LAUNCH_MODE.INCLINED && <span
          className="launch-direction-gizmo"
          style={{ left: `${activePoint.x * 100}%`, top: `${activePoint.y * 100}%`, '--direction': `${activePoint.launchDirectionOffsetDeg}deg` }}
          aria-hidden="true"
        ><i /></span>}
        {draft.launchMode === LAUNCH_MODE.VERTICAL && <span className="launch-vertical-label" style={{ left: `${activePoint.x * 100}%`, top: `${activePoint.y * 100}%` }}>VERTICAL DEPARTURE<br /><small>PITCH-OVER PREVIEW</small></span>}
        <button
          className="launch-point-marker is-active"
          style={{ left: `${activePoint.x * 100}%`, top: `${activePoint.y * 100}%` }}
          onPointerDown={event => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setDraggingPoint(true);
            updatePointFromEvent(event);
          }}
          aria-label="Launch point"
        />
        <span className="launch-point-marker__label" style={{ left: `${activePoint.x * 100}%`, top: `${activePoint.y * 100}%` }}>LAUNCH</span>
        {testMissile && <span className="launch-test-missile" style={{ left: `${testMissile.x * 100}%`, top: `${testMissile.y * 100}%`, '--missile-heading': `${testMissile.heading + draft.spriteRotationOffsetDeg}deg`, '--missile-scale-x': draft.mirrorX ? -draft.visualScale : draft.visualScale, '--missile-scale-y': draft.mirrorY ? -draft.visualScale : draft.visualScale }}><img src={missileAsset.src} alt="" /><b>{testMissile.phase}</b></span>}
        </div>
      </div>
      <div className="launch-point-readout">
        <span>X <b>{activePoint.x.toFixed(3)}</b></span>
        <span>Y <b>{activePoint.y.toFixed(3)}</b></span>
        {draft.launchMode === LAUNCH_MODE.INCLINED && <label>ANGLE <input type="number" min="-180" max="180" step="1" value={activePoint.launchDirectionOffsetDeg} onChange={event => updateDirection(event.target.value)} /></label>}
        <span className="launch-missile-preview"><img src={missileAsset.src} alt={missileAsset.label} /><b>{draft.missileName}</b></span>
        <small>ПЕРЕТАЩИТЕ ТОЧКУ НА МЕСТО ВЫХОДА РАКЕТЫ</small>
      </div>
      <details className="launch-profile-advanced">
        <summary>ADVANCED SETTINGS</summary>
        <div className="launch-profile-advanced__grid">
          {numberField('PRE-LAUNCH DELAY', 'preLaunchDelaySec', 0, 5, 0.01, 'SEC')}
          {numberField('INITIAL SPEED', 'initialLaunchSpeedMps', 1, 300, 1, 'M/S')}
          {numberField('INITIAL ACCELERATION', 'initialLaunchAccelerationMps2', 1, 400, 1, 'M/S²')}
          {numberField('ACCELERATION TIME', 'initialAccelerationDurationSec', 0.1, 3, 0.05, 'SEC')}
          {numberField('GUIDANCE DELAY', 'guidanceEnableDelaySec', 0, 4, 0.01, 'SEC')}
          {numberField('VISUAL DEPARTURE', 'visualDepartureDurationSec', 0.1, 4, 0.01, 'SEC')}
          {numberField('TURN DELAY', 'initialTurnDelaySec', 0, 4, 0.01, 'SEC')}
          {numberField('TURN TO TARGET', 'turnToTargetDurationSec', 0.1, 5, 0.01, 'SEC')}
          {draft.launchMode === LAUNCH_MODE.VERTICAL && numberField('VERTICAL DEPARTURE', 'verticalDepartureDurationSec', 0.1, 4, 0.01, 'SEC')}
          {numberField('SPRITE ROTATION', 'spriteRotationOffsetDeg', -360, 360, 1, 'DEG')}
          {numberField('VISUAL SCALE', 'visualScale', 0.25, 3, 0.05, 'X')}
        </div>
        <div className="launch-profile-checks">
          <label><input type="checkbox" checked={draft.mirrorX} onChange={event => updateDraft('mirrorX', event.target.checked)} /> MIRROR X</label>
          <label><input type="checkbox" checked={draft.mirrorY} onChange={event => updateDraft('mirrorY', event.target.checked)} /> MIRROR Y</label>
        </div>
      </details>
    </section>

    <footer className="launch-profile-editor__actions">
      <button className="content-primary" onClick={startTest}>TEST LAUNCH</button>
      <button onClick={save}>SAVE PROFILE</button>
      <button onClick={reset}>RESET</button>
      <strong className={hasUnsavedChanges ? 'is-unsaved' : 'is-saved'}>{hasUnsavedChanges ? 'UNSAVED' : notice || 'READY'}</strong>
    </footer>
  </div>;
}
