import assert from 'node:assert/strict';
import { effectiveAdvancedOverlays, compactWorldLabel, createLabelLayout } from '../src/scenes/advanced/advancedPresentation.js';
import { impactEnvelope, fragmentOffset, createImpactVfx, IMPACT_FRAGMENT_COUNT } from '../src/scenes/advanced/impactVfx.js';
import { Cartesian3 } from 'cesium';

const saved = { trackLabels: true, seekerFov: true, debug: true, missileVectors: true };
assert.deepEqual(effectiveAdvancedOverlays(saved, false), {
  trackLabels: true, seekerFov: false, debug: false, missileVectors: false,
});
assert.deepEqual(effectiveAdvancedOverlays(saved, true), saved);
assert.equal(compactWorldLabel({ name: 'PAC-3', id: 'M1', distanceM: 40000 }), '');
assert.equal(compactWorldLabel({ name: 'PAC-3', id: 'M1', distanceM: 4000 }), 'M1');
assert.match(compactWorldLabel({ name: 'PAC-3', id: 'M1', distanceM: 100, selected: true,
  speedMps: 812, rangeKm: 6.4, seeker: { seekerType: 'ARH', state: 'ACQUIRED' } }), /RNG 6.4 km · 812 m\/s\nARH · ACQUIRED/);
const place = createLabelLayout(1280, 720);
assert.equal(place({ x: 640, y: 360 }, 'Selected\n812 m/s'), true);
assert.equal(place({ x: 642, y: 360 }, 'Neighbour'), false);
assert.equal(place({ x: 200, y: 360 }, 'Clear'), true);
assert.equal(place({ x: 20, y: 20 }, 'Toolbar'), false);

let now = 0;
const added = [];
const vfx = createImpactVfx({ entities: { add: e => { added.push(e); return e; } } },
  Cartesian3.fromDegrees(30, 50, 2500), { flash: 'flash', smoke: 'smoke', fire: 'fire' }, () => false, () => now);
assert.equal(added.length, 33 + IMPACT_FRAGMENT_COUNT);
assert.ok(added.filter(entity => entity.polyline).length >= 20,
  'impact fragments must carry short luminous trails');
assert.equal(vfx.expiresAt, 8000);
for (now = 0; now <= 9000; now += 50) {
  const e = impactEnvelope(now);
  assert.ok(Object.values(e).every(Number.isFinite));
  for (const entity of added) {
    const color = entity.billboard.color.getValue();
    assert.ok(color.alpha >= 0 && color.alpha <= 1);
    assert.ok(entity.billboard.scale.getValue() > 0);
    // Avoid Cesium's integer billboard dimensions quantizing sub-metre fragments to zero.
    assert.ok(entity.billboard.width >= 1 && entity.billboard.height >= 1);
  }
}
assert.equal(impactEnvelope(8000).smoke, 0);
assert.ok(impactEnvelope(1000).heat > impactEnvelope(3000).heat);
assert.notDeepEqual(fragmentOffset(1, 500), fragmentOffset(2, 500));
assert.ok(fragmentOffset(2, 3000).z < fragmentOffset(2, 1000).z);
console.log('Advanced presentation: debug gate, label priority, bounded world VFX, cooling and fragment packing PASS.');
