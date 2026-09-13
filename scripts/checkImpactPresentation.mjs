import assert from 'node:assert/strict';
import { Cartesian3, Quaternion } from 'cesium';
import { captureImpactAwareSnapshot } from '../src/scenes/advanced/impactPresentation.js';
import { sampleVisualState } from '../src/scenes/advanced/visualInterpolation.js';

const cache = new Map(), meta = {};
const kinematics = { headingDeg: 90, pitchDeg: 0, rollDeg: 0,
  eastMps: 600, northMps: 0, upMps: 0, speedKmh: 2160 };
const start = { lat: 50, lng: 30, altitudeM: 2500 };
captureImpactAwareSnapshot(cache, 'M', meta, start, kinematics, 10);
const contact = { ...start, lng: 30.0003 };
const fakeLegacySprite = { ...start, lat: 50.005, lng: 30.005 };
const impact = { time: 10.04, position: contact };
captureImpactAwareSnapshot(cache, 'M', meta, fakeLegacySprite, kinematics, 10.05, impact);
// Legacy IMPACT beat and following ticks cannot pollute the final buffer.
for (let i = 1; i <= 4; i++) captureImpactAwareSnapshot(cache, 'M', meta, fakeLegacySprite,
  { ...kinematics, headingDeg: 120 }, 10.05 + i * 0.05, impact);
assert.equal(cache.get('M').samples.length, 2);
const before = sampleVisualState(cache, 'M', 10.035);
const hit = sampleVisualState(cache, 'M', impact.time);
assert.ok(Cartesian3.distance(before.worldPosition, hit.worldPosition) < 4);
assert.ok(Cartesian3.distance(hit.worldPosition,
  Cartesian3.fromDegrees(contact.lng, contact.lat, contact.altitudeM)) < 1e-6);
assert.ok(Math.abs(Quaternion.dot(before.quaternion, hit.quaternion)) > 0.999999);
assert.equal(meta.visualImpact.time, 10.04);
console.log('Impact timeline: swept contact retained, legacy sprite snap excluded, final orientation continuous.');
