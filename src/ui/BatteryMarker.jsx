import { Entity, PointGraphics, LabelGraphics } from 'resium';
import { Cartesian3, Color, DistanceDisplayCondition, NearFarScalar } from 'cesium';
import { useEngine } from '../store/engine';

export default function BatteryMarker({ battery: providedBattery, batteryId, isSelected = false }) {
  const markerVersion = useEngine(state => {
    const battery = state.batteries.find(candidate => candidate.id === batteryId);
    if (!battery) return '';
    const { fdc, radar, launchers } = battery.components;
    const radarPosition = radar ? { lat: radar.lat, lng: radar.lng } : null;
    return JSON.stringify([battery.id, battery.status, fdc, radarPosition, launchers]);
  });
  const storedBattery = markerVersion
    ? useEngine.getState().batteries.find(candidate => candidate.id === batteryId)
    : null;
  const battery = providedBattery ?? storedBattery;
  if (!battery) return null;
  const { fdc, radar, launchers } = battery.components;
  const cssColor = battery.status === 'DEPLOYING' ? '#fbbf24' : '#38bdf8';
  const color = Color.fromCssColorString(cssColor);
  const markerColor = isSelected ? Color.WHITE : color;
  const markerScale = new NearFarScalar(150000, 1, 1800000, 0.62);
  const secondaryLabelDistance = new DistanceDisplayCondition(0, 900000);

  return (
    <>
      {fdc && (
        <Entity position={Cartesian3.fromDegrees(fdc.lng, fdc.lat)}>
          <PointGraphics pixelSize={isSelected ? 13 : 9} color={markerColor} outlineColor={Color.BLACK} outlineWidth={1.5} scaleByDistance={markerScale} />
          <LabelGraphics
            show={isSelected}
            text={`SELECTED · ${battery.id}`}
            font="10px IBM Plex Mono, monospace"
            pixelOffset={{ x: 0, y: 18 }}
            fillColor={markerColor}
          />
        </Entity>
      )}
      {radar && (
        <Entity position={Cartesian3.fromDegrees(radar.lng, radar.lat)}>
          <PointGraphics pixelSize={7} color={color.withAlpha(0.82)} outlineColor={Color.WHITE.withAlpha(0.55)} outlineWidth={0.8} scaleByDistance={markerScale} />
          <LabelGraphics
            text="RADAR"
            font="9px IBM Plex Mono, monospace"
            pixelOffset={{ x: 0, y: 14 }}
            fillColor={color.withAlpha(0.58)}
            distanceDisplayCondition={secondaryLabelDistance}
          />
        </Entity>
      )}
      {launchers && launchers.map((l, index) => (
        <Entity key={index} position={Cartesian3.fromDegrees(l.lng, l.lat)}>
          <PointGraphics pixelSize={isSelected ? 6 : 4} color={color.withAlpha(isSelected ? 0.9 : 0.55)} outlineColor={Color.BLACK} outlineWidth={1} scaleByDistance={markerScale} />
          <LabelGraphics
            show={isSelected}
            text={`LNCH-${index + 1}`}
            font="8px IBM Plex Mono, monospace"
            pixelOffset={{ x: 0, y: 13 }}
            fillColor={color.withAlpha(0.72)}
            distanceDisplayCondition={new DistanceDisplayCondition(0, 250000)}
          />
        </Entity>
      ))}
    </>
  );
}
