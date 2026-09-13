export const createWorldPosition = (lat, lng, altitudeM = 0) => ({
  lat,
  lng,
  lon: lng,
  altitudeM,
});

export const getWorldPosition = entity => {
  if (entity?.worldPosition) return entity.worldPosition;
  const position = entity?.position ?? entity;
  return createWorldPosition(
    position?.lat ?? 0,
    position?.lng ?? position?.lon ?? 0,
    entity?.altitudeM ?? position?.altitudeM ?? position?.alt ?? 0,
  );
};
