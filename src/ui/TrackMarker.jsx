import { memo, useMemo } from 'react';
import { BillboardGraphics, Entity, LabelGraphics, PolylineGraphics } from 'resium';
import {
  CallbackProperty,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  NearFarScalar,
  PolylineDashMaterialProperty,
} from 'cesium';
import { useEngine } from '../store/engine';
import { getDestinationPoint } from '../store/geo.js';
import { TRACK_STATE } from '../store/trackSystem.js';
import { getTrackScanPulseImage, getTrackSymbolImage, TRACK_VISUALS } from './trackVisuals.js';

function TrackMarker({ track, isSelected }) {
  const visual = TRACK_VISUALS[track.state] ?? TRACK_VISUALS[TRACK_STATE.DETECTED];
  const isLost = track.state === TRACK_STATE.LOST;
  const color = Color.fromCssColorString(visual.color).withAlpha(visual.opacity);
  const symbolScale = useMemo(() => new CallbackProperty(() => {
    const currentState = useEngine.getState();
    const currentTrack = currentState.tracks.find(candidate => candidate.id === track.id);
    const baseScale = isSelected ? 1.18 : 1;
    if (!currentTrack || currentTrack.state === TRACK_STATE.LOST) return baseScale;

    const updateAge = currentState.simulationTime - currentTrack.lastUpdateTime;
    const pulseDuration = 0.35;
    if (updateAge < 0 || updateAge >= pulseDuration) return baseScale;
    return baseScale + 0.18 * (1 - updateAge / pulseDuration);
  }, false), [track.id, isSelected]);
  const pulseScale = useMemo(() => new CallbackProperty(() => {
    const currentState = useEngine.getState();
    const currentTrack = currentState.tracks.find(candidate => candidate.id === track.id);
    if (!currentTrack || currentTrack.state === TRACK_STATE.LOST) return 1;
    const updateAge = currentState.simulationTime - currentTrack.lastUpdateTime;
    return 1 + Math.max(0, Math.min(1, updateAge / 0.45)) * 0.65;
  }, false), [track.id]);
  const pulseVisible = useMemo(() => new CallbackProperty(() => {
    const currentState = useEngine.getState();
    const currentTrack = currentState.tracks.find(candidate => candidate.id === track.id);
    if (!currentTrack || currentTrack.state === TRACK_STATE.LOST) return false;
    const updateAge = currentState.simulationTime - currentTrack.lastUpdateTime;
    return updateAge >= 0 && updateAge < 0.45;
  }, false), [track.id]);
  const vectorPositions = useMemo(() => {
    if (track.reportedHeading === null) return [];
    const vectorLengthKm = Math.min(28, 10 + (track.reportedSpeedKmh ?? 0) / 180);
    const endpoint = getDestinationPoint(
      track.reportedPosition.lat,
      track.reportedPosition.lng,
      track.reportedHeading,
      vectorLengthKm,
    );
    return Cartesian3.fromDegreesArrayHeights([
      track.reportedPosition.lng,
      track.reportedPosition.lat,
      track.reportedPosition.alt,
      endpoint.lng,
      endpoint.lat,
      track.reportedPosition.alt,
    ]);
  }, [track.reportedHeading, track.reportedPosition, track.reportedSpeedKmh]);
  const vectorMaterial = useMemo(() => (
    visual.dashed
      ? new PolylineDashMaterialProperty({ color, dashLength: 10 })
      : color
  ), [color, visual.dashed]);
  const markerPosition = useMemo(() => Cartesian3.fromDegrees(
    track.reportedPosition.lng,
    track.reportedPosition.lat,
    track.reportedPosition.alt,
  ), [track.reportedPosition]);
  const symbolScaleByDistance = useMemo(() => new NearFarScalar(
    120000,
    1,
    2400000,
    0.7,
  ), []);
  const labelDistance = useMemo(() => new DistanceDisplayCondition(
    0,
    isSelected ? 3000000 : 1800000,
  ), [isSelected]);

  return (
    <>
      {vectorPositions.length > 0 && (
        <Entity>
          <PolylineGraphics positions={vectorPositions} width={1.25} material={vectorMaterial} />
        </Entity>
      )}
      <Entity id={`${track.id}-PULSE`} position={markerPosition}>
        <BillboardGraphics
          image={getTrackScanPulseImage()}
          width={30}
          height={30}
          scale={pulseScale}
          scaleByDistance={symbolScaleByDistance}
          show={pulseVisible}
          disableDepthTestDistance={Number.POSITIVE_INFINITY}
        />
      </Entity>
      <Entity id={track.id} position={markerPosition}>
        <BillboardGraphics
          image={getTrackSymbolImage(track.state, isSelected, track.identifiedType)}
          width={24}
          height={24}
          scale={symbolScale}
          scaleByDistance={symbolScaleByDistance}
          disableDepthTestDistance={Number.POSITIVE_INFINITY}
        />
        <LabelGraphics
          text={track.id}
          font="11px monospace"
          pixelOffset={{ x: 0, y: 26 }}
          fillColor={isSelected ? Color.WHITE : color}
          showBackground
          backgroundColor={new Color(0.1, 0.06, 0.06, isLost ? 0.4 : 0.72)}
          distanceDisplayCondition={labelDistance}
        />
      </Entity>
    </>
  );
}

export default memo(TrackMarker);
