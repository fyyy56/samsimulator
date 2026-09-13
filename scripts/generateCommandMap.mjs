import { readFile, writeFile } from 'node:fs/promises';

const regions = JSON.parse(await readFile(new URL('../src/assets/map/ukraine-regions.geojson', import.meta.url), 'utf8'));
const referenceSvg = await readFile(new URL('../src/assets/map/Ukraine_location_map.svg', import.meta.url), 'utf8');
const ORIGINAL_VIEWBOX = Object.freeze({ width: 1545.703, height: 1038.492 });
const ORIGINAL_GEO_BOUNDS = Object.freeze({ west: 21.5, east: 40.7, south: 44.1, north: 52.7 });
const PALETTE = ['#9fb2c8', '#cdbb87', '#c89491', '#dce9a8', '#aec9b5', '#d9caa6'];

const projectToOriginalViewBox = ([longitude, latitude]) => [
  ((longitude - ORIGINAL_GEO_BOUNDS.west) / (ORIGINAL_GEO_BOUNDS.east - ORIGINAL_GEO_BOUNDS.west)) * ORIGINAL_VIEWBOX.width,
  ((ORIGINAL_GEO_BOUNDS.north - latitude) / (ORIGINAL_GEO_BOUNDS.north - ORIGINAL_GEO_BOUNDS.south)) * ORIGINAL_VIEWBOX.height,
];
const ringPath = ring => ring.map((coordinate, index) => {
  const [x, y] = projectToOriginalViewBox(coordinate);
  return `${index ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
}).join(' ') + ' Z';
const geometryPath = geometry => {
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  return polygons.flatMap(polygon => polygon.map(ringPath)).join(' ');
};
const slug = value => value.toLowerCase().replaceAll(' ', '-')
  .replaceAll(/[іїєґ]/g, character => ({ і: 'i', ї: 'yi', є: 'ye', ґ: 'g' })[character])
  .replaceAll(/[^a-zа-я0-9-]/g, '');

const regionPaths = regions.features.map((feature, index) => {
  const name = feature.properties.region;
  return `<path id="region-${slug(name)}" class="command-region" data-region="${name}" fill="${PALETTE[index % PALETTE.length]}" d="${geometryPath(feature.geometry)}"/>`;
}).join('\n');
const originalContent = referenceSvg.match(/<svg\b[\s\S]*?>([\s\S]*)<\/svg>/)?.[1] ?? '';
const referencePaths = referenceSvg.match(/<path\b[\s\S]*?\/>/g) ?? [];
const foregroundReference = referencePaths.filter(path => (
  (path.includes('fill="none"') && path.includes('stroke="#0978AC"'))
  || path.includes('fill="#C7EDFF"')
  || (path.includes('fill="none"') && path.includes('stroke="#646464"'))
)).join('\n');

const combinedSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${ORIGINAL_VIEWBOX.width}" height="${ORIGINAL_VIEWBOX.height}" viewBox="0 0 ${ORIGINAL_VIEWBOX.width} ${ORIGINAL_VIEWBOX.height}" preserveAspectRatio="xMidYMid meet">
  <title>SAM Simulator unified COMMAND map</title>
  <desc>Original reference geography, Ukrainian region fills and hydrography in one source viewBox.</desc>
  <g id="map-world-transform">
    <g id="base-geography">${originalContent}</g>
    <g id="ukraine-regions">${regionPaths}</g>
    <g id="reference-foreground">${foregroundReference}</g>
  </g>
  <style>.command-region { stroke: #8b897f; stroke-width: 1.4; stroke-linejoin: round; }</style>
</svg>\n`;

await writeFile(new URL('../src/assets/map/command-map.svg', import.meta.url), combinedSvg);
