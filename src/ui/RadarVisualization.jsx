import { memo, useMemo } from 'react';
import { Entity, PolygonGraphics, PolylineGraphics } from 'resium';
import { CallbackProperty, Cartesian3, Color } from 'cesium';
import { generateRadarBeam, generateRadarPolygon, useEngine } from '../store/engine';
import {
  ELECTRONIC_PULSE_DURATION_SEC,
  getRadarAzimuthAtPhase,
  RADAR_SCAN_TYPE,
} from '../store/radarSystem.js';
import { RADAR_VISUALS } from './radarVisuals.js';

export const RadarCoverage = memo(function RadarCoverage({ battery: providedBattery, batteryId }) {
  const coverageVersion = useEngine(state => {
    const battery = state.batteries.find(candidate => candidate.id === batteryId);
    const radar = battery?.components.radar;
    return battery && radar
      ? `${battery.id}:${radar.lat}:${radar.lng}:${battery.radarRangeKm}:${battery.radarSector}:${battery.radarHeading}`
      : '';
  });
  const storedBattery = coverageVersion
    ? useEngine.getState().batteries.find(candidate => candidate.id === batteryId)
    : null;
  const battery = providedBattery ?? storedBattery;
  const radar = battery?.components.radar;
  const radarRangeKm = battery?.radarRangeKm;
  const radarSector = battery?.radarSector;
  const radarHeading = battery?.radarHeading;
  const geometry = useMemo(() => {
    if (!radar) return { hierarchy: [], outline: [] };
    const coordinates = generateRadarPolygon(
      radar.lat,
      radar.lng,
      radarRangeKm,
      radarSector,
      radarHeading,
    );
    const outlineCoordinates = radarSector >= 360
      ? [...coordinates.slice(1, -1), coordinates[1]]
      : coordinates;
    return {
      hierarchy: Cartesian3.fromDegreesArray(coordinates.flatMap(coordinate => coordinate)),
      outline: Cartesian3.fromDegreesArray(outlineCoordinates.flatMap(coordinate => coordinate)),
    };
  }, [radar, radarRangeKm, radarSector, radarHeading]);

  if (!battery || !radar) return null;

  const fillColor = Color
    .fromCssColorString(RADAR_VISUALS.coverageFill)
    .withAlpha(RADAR_VISUALS.coverageFillAlpha);
  const outlineColor = Color
    .fromCssColorString(RADAR_VISUALS.coverageOutline)
    .withAlpha(RADAR_VISUALS.coverageOutlineAlpha);

  return (
    <>
      <Entity>
      <PolygonGraphics
        hierarchy={geometry.hierarchy}
        height={0}
        material={fillColor}
      />
      </Entity>
      <Entity>
        <PolylineGraphics
          positions={geometry.outline}
          width={0.65}
          material={outlineColor}
          clampToGround
        />
      </Entity>
    </>
  );
});

export const RadarSweep = memo(function RadarSweep({ batteryId }) {
  const scanType = useEngine(state => (
    state.batteries.find(candidate => candidate.id === batteryId)
      ?.components.radar?.scanState.scanType
  ));
  const sweepLines = useMemo(() => RADAR_VISUALS.sweepTrail.map(trailStep => {
    const positions = new CallbackProperty(() => {
      const battery = useEngine.getState().batteries.find(candidate => candidate.id === batteryId);
      const radar = battery?.components.radar;
      if (!battery || !radar) return [];

      const sweepAngle = getTrailAngle(battery, trailStep.offsetDegrees);
      if (sweepAngle === null) return [];

      const coordinates = generateRadarBeam(radar.lat, radar.lng, battery.radarRangeKm, sweepAngle);
      return Cartesian3.fromDegreesArray(coordinates.flatMap(coordinate => coordinate));
    }, false);

    return {
      ...trailStep,
      positions,
      color: Color.fromCssColorString(RADAR_VISUALS.sweep).withAlpha(trailStep.alpha),
    };
  }), [batteryId]);

  const electronicPulseLines = useMemo(() => Array.from({ length: 4 }, (_, slotIndex) => ({
    slotIndex,
    positions: new CallbackProperty(() => {
      const state = useEngine.getState();
      const battery = state.batteries.find(candidate => candidate.id === batteryId);
      const radar = battery?.components.radar;
      const pulse = radar?.scanState.electronicPulses[slotIndex];
      if (!battery || !radar || !pulse) return [];
      const ageSeconds = state.simulationTime - pulse.simulationTime;
      if (ageSeconds < 0 || ageSeconds >= ELECTRONIC_PULSE_DURATION_SEC) return [];
      const coordinates = generateRadarBeam(
        radar.lat,
        radar.lng,
        Math.min(battery.radarRangeKm, Math.max(6, pulse.distanceKm + 2)),
        pulse.bearing,
      );
      return Cartesian3.fromDegreesArray(coordinates.flatMap(coordinate => coordinate));
    }, false),
  })), [batteryId]);

  if (scanType === RADAR_SCAN_TYPE.ELECTRONIC_SECTOR) {
    const pulseColor = Color.fromCssColorString(RADAR_VISUALS.electronicPulse).withAlpha(0.52);
    return electronicPulseLines.map(line => (
      <Entity key={`${batteryId}-electronic-pulse-${line.slotIndex}`}>
        <PolylineGraphics positions={line.positions} width={1.15} material={pulseColor} />
      </Entity>
    ));
  }

  return sweepLines.map(line => (
    <Entity key={`${batteryId}-sweep-${line.offsetDegrees}`}>
      <PolylineGraphics
        positions={line.positions}
        width={line.width}
        material={line.color}
      />
    </Entity>
  ));
});

function getTrailAngle(battery, offsetDegrees) {
  const scanState = battery.components.radar?.scanState;
  if (!scanState) return null;
  const angularTravelPerCycle = battery.radarSector >= 360
    ? 360
    : battery.radarSector * 2;
  const trailPhase = scanState.traversalPhase - offsetDegrees / angularTravelPerCycle;
  return getRadarAzimuthAtPhase(trailPhase, battery.radarSector, battery.radarHeading);
}
