import React from 'react';
import { Entity, PointGraphics, LabelGraphics } from 'resium';
import { Cartesian3, Color } from 'cesium';

export default function BatteryMarker({ battery }) {
  const { fdc, radar, launchers } = battery.components;
  const cssColor = battery.status === 'DEPLOYING' ? '#fbbf24' : '#38bdf8';
  const color = Color.fromCssColorString(cssColor);

  return (
    <>
      {fdc && (
        <Entity position={Cartesian3.fromDegrees(fdc.lng, fdc.lat)}>
          <PointGraphics pixelSize={12} color={color} outlineColor={Color.BLACK} outlineWidth={2} />
          <LabelGraphics text={battery.id} font="12px monospace" pixelOffset={{ x: 0, y: 20 }} fillColor={color} />
        </Entity>
      )}
      {radar && (
        <Entity position={Cartesian3.fromDegrees(radar.lng, radar.lat)}>
          <PointGraphics pixelSize={8} color={color} outlineColor={Color.WHITE} outlineWidth={1} />
          <LabelGraphics text="RADAR" font="10px monospace" pixelOffset={{ x: 0, y: 15 }} fillColor={color} />
        </Entity>
      )}
      {launchers && launchers.map((l, index) => (
        <Entity key={index} position={Cartesian3.fromDegrees(l.lng, l.lat)}>
          <PointGraphics pixelSize={6} color={color} outlineColor={Color.BLACK} outlineWidth={1} />
          <LabelGraphics text={`LNCH-${index + 1}`} font="10px monospace" pixelOffset={{ x: 0, y: 15 }} fillColor={color} />
        </Entity>
      ))}
    </>
  );
}
