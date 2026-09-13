const markerSamplers = new Map();

export const registerInterpolatedMarker = (key, sampler) => {
  if (key) markerSamplers.set(key, sampler);
};

export const unregisterInterpolatedMarker = key => {
  if (key) markerSamplers.delete(key);
};

export const getInterpolatedMarkerPosition = key => markerSamplers.get(key)?.() ?? null;
