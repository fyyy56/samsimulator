import ukraineMapImage from '../assets/map/command-map.png?url';
import { COMMAND_MAP_LABEL_FEATURES } from '../data/commandMapLabels.js';

export const SATELLITE_MAP_STYLE = Object.freeze({
  version: 8,
  sources: {
    base: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '© Esri',
    },
    satelliteReference: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 13,
      attribution: 'Boundaries and places © Esri',
    },
  },
  layers: [
    { id: 'satellite-operational-map', type: 'raster', source: 'base' },
    {
      id: 'satellite-place-reference', type: 'raster', source: 'satelliteReference',
      paint: {
        'raster-opacity': ['interpolate', ['linear'], ['zoom'], 4.5, 0.3, 7, 0.46, 10, 0.66, 13, 0.76],
        'raster-contrast': 0.16,
        'raster-fade-duration': 120,
      },
    },
  ],
});

export const SATELLITE_MAP_STYLE_NO_LABELS = Object.freeze({
  ...SATELLITE_MAP_STYLE,
  sources: { base: SATELLITE_MAP_STYLE.sources.base },
  layers: [SATELLITE_MAP_STYLE.layers[0]],
});

const MAP_IMAGE_COORDINATES = [
  [21.5, 52.7], [40.7, 52.7], [40.7, 44.1], [21.5, 44.1],
];

const cityLodLayers = (id, minzoom, filter, sizes) => [{
  id: `command-city-dots-${id}`, type: 'circle', source: 'commandLabels', minzoom, filter,
  paint: {
    'circle-radius': sizes.dot, 'circle-color': '#695650',
    'circle-stroke-color': '#f3efdf', 'circle-stroke-width': sizes.stroke, 'circle-opacity': 0.88,
  },
}, {
  id: `command-city-labels-${id}`, type: 'symbol', source: 'commandLabels', minzoom, filter,
  layout: {
    'text-field': ['get', 'nameRu'], 'text-font': ['Noto Sans Regular'], 'text-size': sizes.text,
    'text-offset': [0, 0.8], 'text-anchor': 'top', 'text-allow-overlap': false,
    'text-optional': true, 'symbol-sort-key': ['get', 'importance'],
  },
  paint: {
    'text-color': '#514d48', 'text-halo-color': 'rgba(247,243,230,.92)',
    'text-halo-width': 1.2, 'text-opacity': 0.92,
  },
}];

export const COMMAND_MAP_STYLE = Object.freeze({
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    commandSvg: {
      type: 'image',
      url: ukraineMapImage,
      coordinates: MAP_IMAGE_COORDINATES,
    },
    commandLabels: { type: 'geojson', data: COMMAND_MAP_LABEL_FEATURES },
  },
  layers: [
    {
      id: 'command-background',
      type: 'background',
      paint: { 'background-color': '#e7e2d6' },
    },
    {
      id: 'command-svg-base',
      type: 'raster',
      source: 'commandSvg',
      paint: {
        'raster-opacity': 1,
        'raster-saturation': -0.04,
        'raster-contrast': 0.02,
        'raster-brightness-min': 0,
        'raster-brightness-max': 1,
        'raster-fade-duration': 0,
      },
    },
    {
      id: 'command-country-labels',
      type: 'symbol', source: 'commandLabels', minzoom: 3.6, maxzoom: 7.2,
      filter: ['==', ['get', 'kind'], 'COUNTRY'],
      layout: {
        'text-field': ['get', 'nameRu'], 'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 3.6, 12, 6.5, 16],
        'text-letter-spacing': 0.22, 'text-allow-overlap': false, 'symbol-sort-key': 1,
      },
      paint: { 'text-color': '#676b68', 'text-opacity': 0.42, 'text-halo-color': 'rgba(241,238,226,.75)', 'text-halo-width': 1.1 },
    },
    {
      id: 'command-region-labels',
      type: 'symbol', source: 'commandLabels', minzoom: 4.45, maxzoom: 8.2,
      filter: ['==', ['get', 'kind'], 'REGION'],
      layout: {
        'text-field': ['get', 'nameRu'], 'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4.45, 8, 6.6, 10],
        'text-max-width': 9, 'text-letter-spacing': 0.06, 'text-allow-overlap': false, 'symbol-sort-key': 8,
      },
      paint: {
        'text-color': '#68665f',
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 4.45, 0.42, 6.5, 0.3, 8.2, 0.08],
        'text-halo-color': 'rgba(244,240,226,.74)', 'text-halo-width': 1,
      },
    },
    {
      id: 'command-neighbor-region-labels',
      type: 'symbol', source: 'commandLabels', minzoom: 4.7, maxzoom: 7.4,
      filter: ['==', ['get', 'kind'], 'NEIGHBOR_REGION'],
      layout: {
        'text-field': ['get', 'nameRu'], 'text-font': ['Noto Sans Regular'], 'text-size': 8.4,
        'text-max-width': 9, 'text-letter-spacing': 0.06, 'text-allow-overlap': false, 'symbol-sort-key': 9,
      },
      paint: { 'text-color': '#73746e', 'text-opacity': 0.3, 'text-halo-color': 'rgba(242,239,229,.8)', 'text-halo-width': 1 },
    },
    ...cityLodLayers('capital', 3.9, ['all', ['==', ['get', 'kind'], 'CITY'], ['==', ['get', 'importance'], 0]], { dot: 3.8, stroke: 1.2, text: 12 }),
    ...cityLodLayers('ua-major', 3.9, ['all', ['==', ['get', 'kind'], 'CITY'], ['==', ['get', 'country'], 'UA'], ['==', ['get', 'importance'], 1]], { dot: 2.8, stroke: 0.8, text: 10.5 }),
    ...cityLodLayers('neighbor-major', 4.5, ['all', ['==', ['get', 'kind'], 'CITY'], ['!=', ['get', 'country'], 'UA'], ['==', ['get', 'importance'], 1]], { dot: 2.5, stroke: 0.7, text: 9.8 }),
    ...cityLodLayers('regional', 5.55, ['all', ['==', ['get', 'kind'], 'CITY'], ['==', ['get', 'importance'], 2]], { dot: 2.1, stroke: 0.65, text: 9.3 }),
    ...cityLodLayers('local', 7.25, ['all', ['==', ['get', 'kind'], 'CITY'], ['==', ['get', 'importance'], 3]], { dot: 1.45, stroke: 0.5, text: 8.4 }),
  ],
});

export const COMMAND_MAP_BOUNDS = Object.freeze([[21.5, 44.1], [40.7, 52.7]]);
export const COMMAND_MAP_PAN_BOUNDS = COMMAND_MAP_BOUNDS;
export const COMMAND_MAP_MIN_ZOOM = 3.6;
export const COMMAND_MAP_MAX_ZOOM = 16.5;

const longitudeToWorldX = longitude => (longitude + 180) / 360;
const latitudeToWorldY = (latitude) => {
  const latitudeRadians = latitude * Math.PI / 180;
  return (1 - Math.log(Math.tan(latitudeRadians) + (1 / Math.cos(latitudeRadians))) / Math.PI) / 2;
};

const worldYToLatitude = (worldY) => {
  const mercatorRadians = Math.PI * (1 - 2 * worldY);
  return Math.atan(Math.sinh(mercatorRadians)) * 180 / Math.PI;
};

export const getCommandMapCoverView = (map) => {
  const canvas = map.getCanvas();
  const [[west, south], [east, north]] = COMMAND_MAP_BOUNDS;
  const westX = longitudeToWorldX(west);
  const eastX = longitudeToWorldX(east);
  const northY = latitudeToWorldY(north);
  const southY = latitudeToWorldY(south);
  const zoomX = Math.log2(canvas.clientWidth / (512 * (eastX - westX)));
  const zoomY = Math.log2(canvas.clientHeight / (512 * (southY - northY)));

  return {
    center: [(west + east) / 2, worldYToLatitude((northY + southY) / 2)],
    // Cover, not contain: on wide screens the unused outer sea/neighbor margin is cropped.
    zoom: Math.min(COMMAND_MAP_MAX_ZOOM, Math.max(COMMAND_MAP_MIN_ZOOM, zoomX, zoomY)),
  };
};
export const COMMAND_MAP_ALIGNMENT_DEBUG = Object.freeze({
  originalViewBox: '0 0 1545.703 1038.492',
  worldBounds: '0.00 0.00 1545.70 1038.49',
  ukraineBounds: '51.52 39.85 1456.38 963.66',
  points: {
    type: 'FeatureCollection',
    features: [
      ['КИЕВ', 30.5234, 50.4501], ['ЛЬВОВ', 24.0297, 49.8397],
      ['ХАРЬКОВ', 36.2304, 49.9935], ['ОДЕССА', 30.7233, 46.4825],
      ['ГОМЕЛЬ', 30.9754, 52.4345],
    ].map(([name, longitude, latitude], index) => ({
      type: 'Feature', id: `align-${index}`, properties: { name },
      geometry: { type: 'Point', coordinates: [longitude, latitude] },
    })),
  },
});
