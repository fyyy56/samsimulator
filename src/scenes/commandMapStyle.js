export const COMMAND_MAP_STYLE = Object.freeze({
  version: 8,
  sources: {
    commandTerrain: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 8,
      attribution: 'Tiles © Esri',
    },
    commandReference: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 10,
      attribution: 'Boundaries and places © Esri',
    },
  },
  layers: [
    {
      id: 'command-background',
      type: 'background',
      paint: { 'background-color': '#879078' },
    },
    {
      id: 'command-terrain',
      type: 'raster',
      source: 'commandTerrain',
      paint: {
        'raster-saturation': 0.04,
        'raster-contrast': 0.22,
        'raster-brightness-min': 0.04,
        'raster-brightness-max': 0.68,
        'raster-fade-duration': 120,
      },
    },
    {
      id: 'command-reference',
      type: 'raster',
      source: 'commandReference',
      paint: {
        'raster-opacity': ['interpolate', ['linear'], ['zoom'], 4.5, 0.56, 8, 0.82],
        'raster-contrast': 0.08,
        'raster-fade-duration': 120,
      },
    },
  ],
});
