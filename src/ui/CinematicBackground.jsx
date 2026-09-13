import { useCallback, useEffect, useRef, useState } from 'react';

let introStartedInThisPageSession = false;

export default function CinematicBackground({ background, sceneTone, onController }) {
  const videoRef = useRef(null);
  const ambientEndRef = useRef(0);
  const ambientTimerRef = useRef(null);
  const ambientRequestedRef = useRef(false);
  const [phase, setPhase] = useState(() => (introStartedInThisPageSession ? 'AMBIENT_PENDING' : 'INTRO'));
  const [failed, setFailed] = useState(false);

  const startAmbient = useCallback(() => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      ambientRequestedRef.current = true;
      return;
    }
    ambientRequestedRef.current = false;
    window.clearTimeout(ambientTimerRef.current);
    video.pause();
    const segmentDuration = Math.min(3.2, Math.max(1.8, video.duration * 0.18));
    const minimumStart = Math.min(1.2, video.duration * 0.08);
    const maximumStart = Math.max(minimumStart, video.duration - segmentDuration - 1);
    const segmentStart = minimumStart + Math.random() * (maximumStart - minimumStart);
    ambientEndRef.current = Math.min(video.duration - 0.2, segmentStart + segmentDuration);
    video.currentTime = segmentStart;
    video.playbackRate = 0.2;
    setPhase('AMBIENT_FADE');
    ambientTimerRef.current = window.setTimeout(() => {
      setPhase('AMBIENT');
      video.play().catch(() => setFailed(true));
    }, 360);
  }, []);

  const replay = useCallback(() => {
    const video = videoRef.current;
    setFailed(false);
    setPhase('INTRO');
    ambientRequestedRef.current = false;
    window.clearTimeout(ambientTimerRef.current);
    if (!video) return;
    video.currentTime = 0;
    video.playbackRate = 1;
    video.play().catch(() => setPhase('REVEAL'));
  }, []);

  useEffect(() => {
    onController?.({ replay });
  }, [onController, replay]);

  useEffect(() => () => window.clearTimeout(ambientTimerRef.current), []);

  useEffect(() => {
    if (phase === 'INTRO') {
      introStartedInThisPageSession = true;
      const menuTimer = window.setTimeout(() => setPhase('MENU'), 1100);
      return () => window.clearTimeout(menuTimer);
    }
    if (phase === 'MENU') {
      const brandTimer = window.setTimeout(() => setPhase('BRAND'), 1700);
      return () => window.clearTimeout(brandTimer);
    }
    return undefined;
  }, [phase]);

  const handleMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    if (ambientRequestedRef.current || phase === 'AMBIENT_PENDING') {
      startAmbient();
      return;
    }
    video.play().catch(() => setPhase('REVEAL'));
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    if (phase === 'AMBIENT') {
      if (video.currentTime >= ambientEndRef.current) startAmbient();
      return;
    }
    if (phase === 'AMBIENT_FADE') return;
    const remaining = video.duration - video.currentTime;
    if (remaining <= 3.2) video.playbackRate = 0.72;
    if (remaining <= 1.45) setPhase('REVEAL');
    if (remaining <= background.freezeOffsetSec + 0.04) startAmbient();
  };

  const introActive = ['INTRO', 'MENU', 'BRAND', 'REVEAL'].includes(phase);
  return <div className={`cinematic-background is-${phase.toLowerCase()} tone-${sceneTone.toLowerCase()} ${failed ? 'is-fallback' : ''}`} style={{ '--fallback-tone': background.fallbackTone }}>
    <video
      ref={videoRef}
      className="cinematic-background__video"
      src={background.videoUrl}
      muted
      autoPlay={phase === 'INTRO'}
      playsInline
      preload="metadata"
      onLoadedMetadata={handleMetadata}
      onTimeUpdate={handleTimeUpdate}
      onEnded={startAmbient}
      onError={() => { setFailed(true); setPhase('AMBIENT'); }}
      aria-hidden="true"
    />
    <div className="cinematic-background__treatment" aria-hidden="true" />
    <div className="cinematic-background__grain" aria-hidden="true" />
    {introActive && <div className="cinematic-intro"><button onClick={startAmbient}>ПРОПУСТИТЬ / SKIP</button></div>}
  </div>;
}
