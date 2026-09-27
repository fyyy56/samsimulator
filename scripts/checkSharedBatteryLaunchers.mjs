import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
try {
  const { useEngine } = await server.ssrLoadModule('/src/store/engine.js');
  const { placeGroundObject } = await server.ssrLoadModule('/src/scenes/advanced/groundPlacement.js');
  useEngine.getState().resetScenario('SANDBOX');
  const radarKey = placeGroundObject('PATRIOT_RADAR', 50, 30);
  const firstKey = placeGroundObject('PATRIOT_LAUNCHER', 50.0002, 30);
  const secondKey = placeGroundObject('PATRIOT_LAUNCHER', 50.0003, 30.0002);
  assert.equal(firstKey, radarKey);
  assert.equal(secondKey, radarKey);
  const battery = useEngine.getState().batteries.find(item => `BATTERY:${item.id}` === radarKey);
  assert.ok(battery.components.radar);
  assert.equal(battery.components.launchers.length, 2);
  assert.notEqual(battery.components.launchers[0].id, battery.components.launchers[1].id);
  console.log('Two Patriot launchers share one radar and Fire Control battery: PASS');
} finally {
  await server.close();
}
