import { useEffect, useRef, useState } from 'react';
import { getLightAsset } from '../data/lightModeAssets.js';

const processedAssetCache = new Map();

const unwrapRotationDegrees = (previousRotation, targetRotation) => {
  if (!Number.isFinite(previousRotation)) return targetRotation;
  const shortestDelta = ((targetRotation - previousRotation + 540) % 360 + 360) % 360 - 180;
  return previousRotation + shortestDelta;
};

const prepareOpaqueAsset = (source) => {
  if (processedAssetCache.has(source)) return processedAssetCache.get(source);
  const promise = new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const { data } = imageData;
      const corners = [
        0,
        (canvas.width - 1) * 4,
        (canvas.height - 1) * canvas.width * 4,
        (canvas.width * canvas.height - 1) * 4,
      ];
      const background = corners.reduce((sum, offset) => [
        sum[0] + data[offset],
        sum[1] + data[offset + 1],
        sum[2] + data[offset + 2],
      ], [0, 0, 0]).map(channel => channel / corners.length);

      for (let offset = 0; offset < data.length; offset += 4) {
        const distance = Math.hypot(
          data[offset] - background[0],
          data[offset + 1] - background[1],
          data[offset + 2] - background[2],
        );
        const edgeAlpha = Math.max(0, Math.min(1, (distance - 8) / 34));
        data[offset + 3] = Math.round(data[offset + 3] * edgeAlpha);
      }
      context.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => resolve(source);
    image.src = source;
  });
  processedAssetCache.set(source, promise);
  return promise;
};

export default function LightMapSprite({ assetId, sourceUrl = null, sourceOffsetX = 0, sourceOffsetY = 0, heading = 0, className = '', selected = false, sizePx = null }) {
  const packagedAsset = getLightAsset(assetId);
  const asset = sourceUrl ? {
    ...packagedAsset,
    src: sourceUrl,
    label: 'Пользовательская модель',
    opaqueBackground: false,
    assetRotationOffsetDeg: 0,
  } : packagedAsset;
  const [renderedSource, setRenderedSource] = useState(() => (
    asset.opaqueBackground ? null : asset.src
  ));
  const requestedRotation = asset.lockSpriteRotation
    ? 0
    : heading + (asset.assetRotationOffsetDeg ?? asset.orientationOffsetDeg ?? 0);
  const imageRef = useRef(null);
  const continuousRotationRef = useRef(Number.NaN);

  useEffect(() => {
    const continuousRotation = asset.lockSpriteRotation
      ? 0
      : unwrapRotationDegrees(continuousRotationRef.current, requestedRotation);
    continuousRotationRef.current = continuousRotation;
    if (imageRef.current) {
      imageRef.current.style.transform = `translate(${sourceOffsetX}px, ${sourceOffsetY}px) rotate(${continuousRotation}deg)`;
    }
  }, [asset.lockSpriteRotation, requestedRotation, renderedSource, sourceOffsetX, sourceOffsetY]);

  useEffect(() => {
    let active = true;
    if (!asset.opaqueBackground) {
      Promise.resolve(asset.src).then(source => {
        if (active) setRenderedSource(source);
      });
      return () => { active = false; };
    }
    prepareOpaqueAsset(asset.src).then(source => {
      if (active) setRenderedSource(source);
    });
    return () => { active = false; };
  }, [asset.opaqueBackground, asset.src]);

  return (
    <span
      className={`light-map-sprite light-map-sprite--${asset.className} ${asset.opaqueBackground ? 'has-opaque-source' : ''} ${renderedSource ? 'is-ready' : 'is-processing'} ${selected ? 'is-selected' : ''} ${className}`}
      title={asset.label}
      style={sizePx ? { '--sprite-size': `${sizePx}px` } : undefined}
    >
      {renderedSource && <img ref={imageRef} src={renderedSource} alt="" draggable="false" />}
    </span>
  );
}
