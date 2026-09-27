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

export const formatTrackLabelData = (track, distanceKm = null, language = 'EN') => {
  const ru = language === 'RU';
  const units = ru ? { km: 'км', m: 'м', mps: 'м/с' } : { km: 'km', m: 'm', mps: 'm/s' };
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
      ? `${prefix}${distanceKm.toFixed(quality.approximate ? 1 : 3)} ${units.km}`
      : `${prefix}— ${units.km}`,
    altitudeText: roundedAltitudeM == null ? `${prefix}— ${units.m}` : `${prefix}${roundedAltitudeM} ${units.m}`,
    speedText: roundedSpeedMps == null ? `${prefix}— ${units.mps}` : `${prefix}${roundedSpeedMps} ${units.mps}`,
  };
};

export const formatTrackCesiumLabel = (track, distanceKm = null, displayName = null, language = 'EN') => {
  const data = formatTrackLabelData(track, distanceKm, language);
  return [
    `${data.id}${displayName ? ` · ${displayName}` : ''}`,
    data.distanceText,
    data.altitudeText,
    `${data.speedText}${data.approximate ? (language === 'RU' ? ' · ОЦЕНКА' : ' · EST') : ''}`,
  ].join('\n');
};
