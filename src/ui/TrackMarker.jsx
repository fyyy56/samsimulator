import React from 'react';
import { Entity, PointGraphics, LabelGraphics } from 'resium';
import { Cartesian3, Color } from 'cesium';

export default function TrackMarker({ track, isSelected }) {
  let strokeColorHex = '#eab308'; // Вне зоны (желтый)
  if (track.status === 'TRACKED') strokeColorHex = '#ef4444'; // Захвачен (красный)
  
  const color = Color.fromCssColorString(strokeColorHex);
  const selectedColor = isSelected ? Color.WHITE : color;

  const labelText = isSelected 
    ? `TRK: ${track.id}\nSPD: ${Math.round(track.speed_kmh)}\nALT: ${track.alt}m\nDIST: ${track.distanceToSam}km`
    : track.id;

  return (
    <Entity 
      id={track.id} 
      position={Cartesian3.fromDegrees(track.lng, track.lat, track.alt)}
    >
      <PointGraphics 
        pixelSize={isSelected ? 14 : 10} 
        color={selectedColor} 
        outlineColor={Color.BLACK} 
        outlineWidth={2} 
      />
      <LabelGraphics 
        text={labelText} 
        font="11px monospace" 
        pixelOffset={{ x: 0, y: 35 }} 
        fillColor={Color.WHITE} 
        showBackground={true}
        backgroundColor={new Color(0.1, 0.1, 0.1, 0.8)}
      />
    </Entity>
  );
}
