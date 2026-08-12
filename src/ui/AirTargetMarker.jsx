import { memo, useMemo } from 'react';
import { BillboardGraphics, Entity, LabelGraphics, PolylineGraphics } from 'resium';
import {
  CallbackProperty,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  NearFarScalar,
} from 'cesium';
import { useEngine } from '../store/engine';
import { getDestinationPoint } from '../store/geo.js';
import { getGlobalTargetImage, GLOBAL_TARGET_COLOR } from './trackVisuals.js';

function AirTargetMarker({ targetId }) {
  const position = useMemo(() => new CallbackProperty(() => {
    const target = useEngine.getState().airTargets.find(candidate => candidate.id === targetId);
    return target
      ? Cartesian3.fromDegrees(target.position.lng, target.position.lat, target.altitudeM)
      : undefined;
  }, false), [targetId]);

  const courseVector = useMemo(() => new CallbackProperty(() => {
    const target = useEngine.getState().airTargets.find(candidate => candidate.id === targetId);
    if (!target) return [];
    const vectorLengthKm = Math.min(28, 10 + target.speedKmh / 180);
    const endpoint = getDestinationPoint(
      target.position.lat,
      target.position.lng,
      target.heading,
      vectorLengthKm,
    );
    return Cartesian3.fromDegreesArrayHeights([
      target.position.lng,
      target.position.lat,
      target.altitudeM,
      endpoint.lng,
      endpoint.lat,
      target.altitudeM,
    ]);
  }, false), [targetId]);

  const color = Color.fromCssColorString(GLOBAL_TARGET_COLOR).withAlpha(0.82);
  const symbolScale = useMemo(() => new NearFarScalar(120000, 0.95, 2200000, 0.65), []);
  const labelDistance = useMemo(() => new DistanceDisplayCondition(0, 1200000), []);

  return (
    <>
      <Entity>
        <PolylineGraphics positions={courseVector} width={1} material={color} />
      </Entity>
      <Entity position={position}>
        <BillboardGraphics
          image={getGlobalTargetImage()}
          width={22}
          height={22}
          scaleByDistance={symbolScale}
          disableDepthTestDistance={Number.POSITIVE_INFINITY}
        />
        <LabelGraphics
          text={targetId}
          font="10px monospace"
          pixelOffset={{ x: 0, y: 24 }}
          fillColor={color}
          showBackground
          backgroundColor={new Color(0.1, 0.04, 0.04, 0.62)}
          distanceDisplayCondition={labelDistance}
        />
      </Entity>
    </>
  );
}

export default memo(AirTargetMarker);
