import { memo, useMemo } from 'react';
import { BillboardGraphics, Entity, LabelGraphics, PolylineGraphics } from 'resium';
import {
  CallbackProperty,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  Math as CesiumMath,
  NearFarScalar,
} from 'cesium';
import { useEngine } from '../store/engine';
import { getDistanceKm } from '../store/geo.js';

const interceptorSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
    <path d="M14 2 L23 23 L14 18 L5 23 Z" fill="rgba(74,222,128,0.28)"
      stroke="#75b98a" stroke-width="2" />
    <circle cx="14" cy="16" r="2" fill="#d7ffe2" />
  </svg>`;
const interceptorImage = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(interceptorSvg)}`;

function MissileMarker({ missileId }) {
  const color = Color.fromCssColorString('#4ade80');
  const position = useMemo(() => new CallbackProperty(() => {
    const missile = useEngine.getState().missiles.find(candidate => candidate.id === missileId);
    return missile ? Cartesian3.fromDegrees(missile.lng, missile.lat, 500) : undefined;
  }, false), [missileId]);
  const rotation = useMemo(() => new CallbackProperty(() => {
    const missile = useEngine.getState().missiles.find(candidate => candidate.id === missileId);
    return missile ? -CesiumMath.toRadians(missile.heading) : 0;
  }, false), [missileId]);
  const label = useMemo(() => new CallbackProperty(() => {
    const missile = useEngine.getState().missiles.find(candidate => candidate.id === missileId);
    if (!missile) return missileId;
    const speed = Math.round(missile.speedKmh).toLocaleString('en-US').replaceAll(',', ' ');
    return `${missile.id}\n${missile.guidanceState}\n${speed} km/h`;
  }, false), [missileId]);
  const trajectory = useMemo(() => new CallbackProperty(() => {
    const missile = useEngine.getState().missiles.find(candidate => candidate.id === missileId);
    if (!missile) return [];
    const points = [...missile.trajectory, { lat: missile.lat, lng: missile.lng }];
    return Cartesian3.fromDegreesArrayHeights(points.flatMap(point => [
      point.lng,
      point.lat,
      500,
    ]));
  }, false), [missileId]);
  const guidanceRelation = useMemo(() => new CallbackProperty(() => {
    const state = useEngine.getState();
    const missile = state.missiles.find(candidate => candidate.id === missileId);
    if (!missile || !['MIDCOURSE', 'TERMINAL', 'REATTACK'].includes(missile.guidanceState)) return [];
    const track = state.tracks.find(candidate => candidate.id === missile.trackId);
    if (!track) return [];
    const relationDistanceKm = getDistanceKm(
      missile.lat,
      missile.lng,
      track.reportedPosition.lat,
      track.reportedPosition.lng,
    );
    if (relationDistanceKm > 30) return [];
    return Cartesian3.fromDegreesArrayHeights([
      missile.lng,
      missile.lat,
      500,
      track.reportedPosition.lng,
      track.reportedPosition.lat,
      track.reportedPosition.alt,
    ]);
  }, false), [missileId]);
  const symbolScale = useMemo(() => new NearFarScalar(100000, 1, 2200000, 0.72), []);
  const labelDistance = useMemo(() => new DistanceDisplayCondition(0, 1600000), []);
  
  return (
    <>
      <Entity>
        <PolylineGraphics
          positions={trajectory}
          width={1.15}
          material={Color.fromCssColorString('#75b98a').withAlpha(0.58)}
        />
      </Entity>
      <Entity>
        <PolylineGraphics
          positions={guidanceRelation}
          width={0.75}
          material={Color.fromCssColorString('#75b98a').withAlpha(0.22)}
        />
      </Entity>
      <Entity position={position}>
        <BillboardGraphics
          image={interceptorImage}
          width={22}
          height={22}
          rotation={rotation}
          scaleByDistance={symbolScale}
          disableDepthTestDistance={Number.POSITIVE_INFINITY}
        />
        <LabelGraphics
          text={label}
          font="10px monospace"
          pixelOffset={{ x: 0, y: -25 }}
          fillColor={color}
          distanceDisplayCondition={labelDistance}
        />
      </Entity>
    </>
  );
}

export default memo(MissileMarker);
