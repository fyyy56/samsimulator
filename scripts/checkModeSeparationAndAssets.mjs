import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const storeSource = read('src/store/gameStore.js');
const viewportSource = read('src/scenes/GameViewport.jsx');
const menuSource = read('src/scenes/MainMenu.jsx');
const simpleSource = read('src/scenes/SimpleModeScene.jsx');

for (const id of ['GAME_2D', 'SANDBOX_2D', 'ADVANCED_3D', 'SANDBOX_3D']) {
  assert.match(storeSource, new RegExp(`${id}: '${id}'`), `missing canonical mode ${id}`);
}
assert.match(viewportSource, /is2DScene\(scene\)/);
assert.match(viewportSource, /isAdvancedScene\(scene\)/);
assert.doesNotMatch(viewportSource, /prewarm|setTimeout|useEffect/,
  '2D must not preload or mount the Cesium backend');
assert.match(menuSource, /openAdvanced3D/);
assert.match(menuSource, /openAdvancedSandbox/);
assert.doesNotMatch(simpleSource, /openAdvancedPreview/,
  'normal 2D top bar must not expose the Advanced mode switch');

const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
try {
  const registry = await server.ssrLoadModule('/src/data/advanced3dRegistry.js');
  const assets = Object.values(registry.ADVANCED_GROUND_ASSETS);
  assert.ok(assets.length >= 12);
  for (const asset of assets) {
    assert.equal(asset.assetType, 'GROUND');
    assert.ok(asset.forwardAxis && asset.upAxis, `${asset.key}: missing axes`);
    assert.ok(Number.isFinite(asset.uniformScale) && asset.uniformScale > 0, `${asset.key}: invalid scale`);
    assert.equal('scaleX' in asset || 'scaleY' in asset || 'scaleZ' in asset, false,
      `${asset.key}: non-uniform scale is forbidden`);
    assert.ok(Number.isFinite(asset.groundOffsetM), `${asset.key}: missing ground offset`);
    assert.ok(asset.labelOffsetM && asset.fallbackAsset, `${asset.key}: incomplete fallback metadata`);
    const resolved = registry.resolveAdvancedAssetPresentation(asset);
    assert.equal(resolved.uniformScale, asset.uniformScale);
    assert.equal(resolved.renderType, asset.modelUri ? 'MODEL' : 'BILLBOARD');
  }
  assert.equal(registry.resolveAdvancedAssetPresentation(assets.find(asset => asset.modelUri), 'FAILED').renderType,
    'BILLBOARD', 'failed GLB must resolve through the canonical fallback');
} finally {
  await server.close();
}

assert.ok(fs.existsSync(new URL('./asset-placement-fixture.html', import.meta.url)));
assert.ok(fs.existsSync(new URL('./asset-placement-fixture.js', import.meta.url)));
console.log('Mode separation + canonical Advanced asset registry: PASS');
