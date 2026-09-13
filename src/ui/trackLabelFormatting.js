const finite = value => Number.isFinite(value);

export const getTrackLabelQuality = track => {
  const quality = track?.trackQuality ?? 0;
  const ageSec = track?.measurementAgeSec ?? 0;
  const stable = ['TRACKED', 'IDENTIFIED'].includes(track?.state)
    && quality >= 0.62
    && ageSec <= 1.5;
  return { quality, ageSec, stable, approximate: !stable };
};

export const getShortTrackId = id => String(id ?? 'T-???').replace(/^TRK-/, 'T-');

export const formatTrackLabelData = (track, distanceKm = null) => {
  const quality = getTrackLabelQuality(track);
  const prefix = quality.approximate ? '~' : '';
  const altitudeM = track?.reportedAltitudeM ?? track?.reportedPosition?.altitudeM ?? track?.reportedPosition?.alt ?? null;
  const speedMps = finite(track?.reportedSpeedKmh) ? track.reportedSpeedKmh / 3.6 : null;
  const roundedAltitudeM = finite(altitudeM)
    ? (quality.approximate ? Math.round(altitudeM / 50) * 50 : Math.round(altitudeM))
    : null;
  const roundedSpeedMps = finite(speedMps)
    ? (quality.approximate ? Math.round(speedMps / 5) * 5 : Math.round(speedMps))
    : null;
  return {
    ...quality,
    id: getShortTrackId(track?.id),
    distanceText: finite(distanceKm)
      ? `${prefix}${distanceKm.toFixed(quality.approximate ? 1 : 3)} km`
      : `${prefix}— km`,
    altitudeText: roundedAltitudeM == null ? `${prefix}— m` : `${prefix}${roundedAltitudeM} m`,
    speedText: roundedSpeedMps == null ? `${prefix}— m/s` : `${prefix}${roundedSpeedMps} m/s`,
  };
};

export const formatTrackCesiumLabel = (track, distanceKm = null, displayName = null) => {
  const data = formatTrackLabelData(track, distanceKm);
  return [
    `${data.id}${displayName ? ` · ${displayName}` : ''}`,
    data.distanceText,
    data.altitudeText,
    `${data.speedText}${data.approximate ? ' · EST' : ''}`,
  ].join('\n');
};
