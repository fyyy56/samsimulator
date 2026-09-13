import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import {
  registerInterpolatedMarker,
  unregisterInterpolatedMarker,
} from './markerInterpolationRegistry.js';
import { registerMarkerInterpolator } from './markerAnimationLoop.js';
import { sampleTrackPresentation } from './trackPresentation.js';

const clamp01 = value => Math.max(0, Math.min(1, value));
const interpolate = (from, to, amount) => from + (to - from) * amount;

const samplePosition = (state, timestamp) => {
  const durationMs = Math.max(1, state.endsAt - state.startedAt);
  const amount = clamp01((timestamp - state.startedAt) / durationMs);
  return {
    longitude: interpolate(state.from.longitude, state.to.longitude, amount),
    latitude: interpolate(state.from.latitude, state.to.latitude, amount),
  };
};

/**
 * Visual-only interpolation for MapLibre DOM markers. Simulation snapshots
 * remain authoritative; a shared rAF loop moves marker instances directly so
 * HUD and scene React trees are not rendered at monitor refresh rate.
 */
export default function InterpolatedMapMarker({
  longitude,
  latitude,
  simulationTime,
  visualPositionKey = null,
  presentationTrack = null,
  timeScale = 0,
  children,
  ...markerProps
}) {
  const markerRef = useRef(null);
  const trackRef = useRef(null);
  const trackCacheRef = useRef(new Map());
  const [initialPosition] = useState(() => ({ longitude, latitude }));
  const interpolationRef = useRef({
    from: { longitude, latitude },
    to: { longitude, latitude },
    startedAt: 0,
    endsAt: 0,
    previousSimulationTime: simulationTime,
    currentSimulationTime: simulationTime,
    lastSnapshotArrivedAt: null,
  });

  useLayoutEffect(() => {
    const timestamp = window.performance.now();
    trackRef.current = presentationTrack
      ? { track: presentationTrack, simulationTime, arrivedAt: timestamp, timeScale } : null;
    const state = interpolationRef.current;
    const currentPosition = samplePosition(state, timestamp);
    const snapshotIntervalMs = state.lastSnapshotArrivedAt === null
      ? 50
      : timestamp - state.lastSnapshotArrivedAt;
    const teleported = Math.abs(longitude - state.to.longitude) > 1
      || Math.abs(latitude - state.to.latitude) > 1;
    const durationMs = teleported ? 1 : Math.max(24, Math.min(300, snapshotIntervalMs));
    interpolationRef.current = {
      from: teleported ? { longitude, latitude } : currentPosition,
      to: { longitude, latitude },
      startedAt: timestamp,
      endsAt: timestamp + durationMs,
      previousSimulationTime: state.currentSimulationTime,
      currentSimulationTime: simulationTime,
      lastSnapshotArrivedAt: timestamp,
    };
    if (teleported) markerRef.current?.setLngLat([longitude, latitude]);
  }, [latitude, longitude, simulationTime, visualPositionKey, presentationTrack, timeScale]);

  useEffect(() => {
    const trackCache = trackCacheRef.current;
    const sample = timestamp => {
      const input = trackRef.current;
      if (!input) return samplePosition(interpolationRef.current, timestamp);
      const pose = sampleTrackPresentation(trackCache, visualPositionKey,
        input.track, input.simulationTime + Math.min(0.15,
          Math.max(0, timestamp - input.arrivedAt) / 1000 * input.timeScale), timestamp);
      return pose ? { longitude: pose.lng, latitude: pose.lat,
        headingDeg: pose.headingDeg, speedKmh: pose.speedKmh } : samplePosition(interpolationRef.current, timestamp);
    };
    registerInterpolatedMarker(visualPositionKey, () => sample(window.performance.now()));
    const unregister = registerMarkerInterpolator(timestamp => {
      const marker = markerRef.current;
      if (!marker) return;
      const position = sample(timestamp);
      marker.setLngLat([position.longitude, position.latitude]);
      const glyph = trackRef.current ? marker.getElement()?.querySelector('[data-track-heading]') : null;
      if (glyph && Number.isFinite(position.headingDeg)) {
        glyph.style.transform = `rotate(${position.headingDeg - (trackRef.current?.track.reportedHeading ?? 0)}deg)`;
      }
    });
    return () => {
      unregister();
      unregisterInterpolatedMarker(visualPositionKey);
      trackCache.clear();
    };
  }, [visualPositionKey]);

  return (
    <Marker
      {...markerProps}
      ref={markerRef}
      longitude={initialPosition.longitude}
      latitude={initialPosition.latitude}
    >
      {children}
    </Marker>
  );
}
