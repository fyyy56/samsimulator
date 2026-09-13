import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = relativePath => fs.existsSync(path.join(root, relativePath));
const parseJson = relativePath => JSON.parse(read(relativePath));
const sourceFiles = fs.readdirSync(path.join(root, 'src'), { recursive: true })
  .filter(file => /\.(?:js|jsx)$/.test(file))
  .map(file => `src/${file}`);
const sourceText = sourceFiles.map(file => read(file)).join('\n');

const assertUnique = (values, label) => {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  assert.equal(duplicates.length, 0, `${label} duplicate: ${[...new Set(duplicates)].join(', ')}`);
};

// A: production entry and current scene ownership.
const main = read('src/main.jsx');
const app = read('src/App.jsx');
const viewport = read('src/scenes/GameViewport.jsx');
assert.match(main, /from ['"]\.\/App\.jsx['"]/);
assert.match(app, /import\(['"]\.\/scenes\/GameViewport\.jsx['"]\)/);
assert.match(viewport, /import\(['"]\.\/AdvancedScene\.jsx['"]\)/);
assert.match(viewport, /import\(['"]\.\/SimpleModeScene\.jsx['"]\)/);
assert.doesNotMatch(app, /PlaceholderScene/);

// B/J: one active implementation per production route; known old files stay
// as unimported source so they can be inspected without entering the bundle.
for (const [label, file, token] of [
  ['HUD', 'src/ui/HUD.jsx', 'export default function HUD'],
  ['AdvancedScene', 'src/scenes/AdvancedScene.jsx', 'export default function AdvancedScene'],
  ['OLS HUD', 'src/scenes/advanced/OlsHud.jsx', 'export default function OlsHud'],
  ['Reference', 'src/scenes/ReferenceScene.jsx', 'export default function ReferenceScene'],
]) assert.equal((read(file).match(new RegExp(token, 'g')) ?? []).length, 1, `${label} registration drift`);
assert.equal((sourceText.match(/from ['"][^'"]*PlaceholderScene[^'"]*['"]/g) ?? []).length, 0,
  'legacy PlaceholderScene is imported by production code');
assert.equal((sourceText.match(/from ['"][^'"]*TrackMarker[^'"]*['"]/g) ?? []).length, 0,
  'orphan TrackMarker must not become an alternate production renderer');

// C: track symbols and user-facing tactical asset labels are never empty.
const trackVisuals = await import('../src/ui/trackVisuals.js');
for (const [state, visual] of Object.entries(trackVisuals.TRACK_VISUALS)) {
  assert.ok(state && visual.color, `track visual ${state} has no label/color`);
  assert.match(trackVisuals.getTrackSymbolImage(state, false, 'UAV_TARGET'), /^data:image\/svg\+xml/);
}
const targetModels = await import('../src/data/lightTargetModels.js');
assertUnique(targetModels.LIGHT_TARGET_MODEL_OPTIONS.map(item => item.id), 'target model IDs');
targetModels.LIGHT_TARGET_MODEL_OPTIONS.forEach(item => assert.ok(item.displayName?.trim(), `empty target label ${item.id}`));
const labels = await import('../src/ui/trackLabelFormatting.js');
const sampleLabel = labels.formatTrackCesiumLabel({
  id: 'TRK-TEST', state: 'TRACKED', trackQuality: 0.9, measurementAgeSec: 0,
  reportedPosition: { lat: 50, lng: 30, alt: 100 }, reportedSpeedKmh: 360,
}, 12.345, 'Герань-2');
assert.ok(sampleLabel.includes('T-TEST') && sampleLabel.includes('Герань-2'));
assert.doesNotMatch(sampleLabel, /undefined|null/);
const radarProfiles = await import('../src/data/searchRadarProfiles.js');
Object.values(radarProfiles.SEARCH_RADAR_PROFILES).forEach(profile => {
  assert.ok(profile.displayName?.trim() && profile.englishName?.trim(), `empty radar label ${profile.id}`);
});
const gunSystems = await import('../src/data/gunSystems.js');
Object.values(gunSystems.GUN_SYSTEM_SPECS).forEach(spec => {
  assert.ok(spec.displayName?.trim() && spec.weaponLabel?.trim(), `empty SAM/gun label ${spec.id}`);
});
const interceptorData = await import('../src/data/interceptors.js');
Object.values(interceptorData.INTERCEPTOR_SPECS).forEach(spec => {
  assert.ok(spec.publicDisplay?.displayName?.trim(), `empty missile label ${spec.id}`);
});

// D: the handbook/reference catalog is the canonical packaged source.
const catalogFiles = fs.readdirSync(path.join(root, 'src/content/catalog'))
  .filter(file => file.endsWith('.json'));
const catalog = catalogFiles.flatMap(file => parseJson(`src/content/catalog/${file}`));
assertUnique(catalog.map(item => item.id), 'reference IDs');
catalog.forEach(item => {
  assert.ok(item.id?.trim() && item.name?.trim() && item.kind?.trim(), `invalid reference ${item.id}`);
  for (const field of ['name', 'role', 'type']) assert.ok(!String(item[field] ?? '').includes('undefined'), `${item.id} has bad ${field}`);
});
assert.match(read('src/scenes/ReferenceScene.jsx'), /PACKAGED_CONTENT/);

// E/F/G: canonical overlay, missile registry and radar IDs remain unique.
const overlays = await import('../src/store/viewStore.js');
assert.equal(overlays.ADVANCED_OVERLAY_DEFAULTS.missileVectors, false, 'missile vectors must default OFF');
assert.equal(Object.keys(overlays.ADVANCED_OVERLAY_DEFAULTS).length,
  new Set(Object.keys(overlays.ADVANCED_OVERLAY_DEFAULTS)).size, 'overlay keys duplicate');
const radarSource = read('src/data/searchRadarProfiles.js');
const radarIds = [...radarSource.matchAll(/id: ['"](RADAR_[A-Z0-9]+)['"]/g)].map(match => match[1]);
assertUnique(radarIds, 'radar profile IDs');
const registrySource = read('src/data/advanced3dRegistry.js');
const missileIds = [...registrySource.matchAll(/^  ['"](INT-[A-Z0-9-]+)['"]:/gm)].map(match => match[1]);
assertUnique(missileIds, 'advanced missile registry IDs');
assert.equal(missileIds.length, 4, 'expected four interceptor presentation profiles');

// H/I: test fixtures are not imported by the production entry and every
// local GLB/image import in the current registries resolves on disk.
for (const file of ['scripts/visual-regression.jsx', 'scripts/missile-runtime-fixture.jsx', 'scripts/missile-model-fixture.js']) {
  assert.ok(exists(file), `missing development fixture ${file}`);
  assert.doesNotMatch(main + app + viewport, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
const assetImportFiles = ['src/data/advanced3dRegistry.js', 'src/data/lightModeAssets.js'];
for (const file of assetImportFiles) {
  for (const match of read(file).matchAll(/from ['"](\.\.?\/assets\/[^'"]+?)(?:\?url)?['"]/g)) {
    const assetPath = match[1].replace(/\\/g, '/');
    assert.ok(exists(path.posix.normalize(path.posix.join(path.posix.dirname(file), assetPath))), `${file} missing ${assetPath}`);
  }
}
const assetBasenames = new Set(fs.readdirSync(path.join(root, 'src/assets'), { recursive: true })
  .filter(file => /\.(?:glb|gltf)$/.test(file)).map(file => path.basename(file).toLowerCase()));
catalog.filter(item => item.model3dAsset).forEach(item => {
  assert.ok(assetBasenames.has(item.model3dAsset.toLowerCase()), `${item.id} missing ${item.model3dAsset}`);
});

// A no-store dev server and no service worker keep the browser on the current tree.
const vite = read('vite.config.js');
assert.match(vite, /port:\s*5173/);
assert.match(vite, /strictPort:\s*true/);
assert.match(vite, /Cache-Control['"]?\s*:\s*['"]no-store['"]/);
assert.equal(fs.existsSync(path.join(root, 'public/service-worker.js')), false, 'unexpected service worker cache');

console.log(`Maintenance checks passed: ${catalog.length} reference entries, ${missileIds.length} missile profiles, ${radarIds.length} radar profiles.`);
