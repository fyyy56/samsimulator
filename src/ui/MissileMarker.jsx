import React from 'react';
import { Entity, PointGraphics, LabelGraphics } from 'resium';
import { Cartesian3, Color } from 'cesium';

export default function MissileMarker({ missile }) {
  const color = Color.fromCssColorString('#4ade80');
  
  return (
    <Entity position={Cartesian3.fromDegrees(missile.lng, missile.lat, 500)}>
      <PointGraphics pixelSize={8} color={color} outlineColor={Color.WHITE} outlineWidth={2} />
      <LabelGraphics 
        text={`${Math.round(missile.speed_kmh)} KM/H\n${missile.id}`} 
        font="10px monospace" 
        pixelOffset={{ x: 0, y: -25 }} 
        fillColor={color} 
      />
    </Entity>
  );
}
