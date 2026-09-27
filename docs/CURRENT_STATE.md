# Current Project State

Snapshot intent: guide agents working on the current DroneFall codebase without forcing them to rediscover recent project history.

## Stable unless a concrete bug is demonstrated
Treat these as frozen during unrelated work:
- shared 2D/3D simulation core,
- TrackData pipeline and track prediction,
- seeker handoff / network-track fallback architecture,
- current missile guidance and physics calibration,
- ZERO-JITTER / visual snapshot interpolation behavior,
- Patriot manual-fire flow,
- OLS pointer-lock / continuous camera rotation flow.

A visual task is not permission to retune missile G limits, energy, seeker range, radar range, target tracks, or hit logic.

## Current primary direction
The current development focus is Advanced 3D presentation/render quality:
1. atmospheric rendering foundation,
2. cloud depth/occlusion/transparency behavior,
3. missile smoke identity,
4. environment lighting / HDRI-style IBL hooks,
5. explosion/impact VFX,
6. thermal/OLS visual treatment,
7. camera polish,
8. terrain later.

## Current environment/weather features
Advanced mode already has day/time and weather-style controls including day/sunrise/sunset/night and multiple cloud conditions.

Known visual problems to solve at the presentation layer:
- clouds can look layered/striped/billboard-like,
- horizon can produce cyan/green/white banding,
- night terrain can remain too bright/green,
- cloud/smoke depth ordering can be incorrect,
- distant smoke/cloud attenuation and occlusion need stronger world/depth awareness.

## Missile visual identity targets
Use these only as visual identities; do not alter physics to force the look:
- IRIS-T: thin / near-smokeless trail, compact plume.
- AIM-120: thin trail, somewhat more expanding than IRIS-T.
- PAC-3: thin smoky trail; old smoke disperses and greys/darkens.
- Aster 30: strong booster visual; body trail after separation closer to AIM-120.
- Night powered missile: bright point / small luminous cocoon, weak afterglow after burnout.
- In cloud: attenuated plume and localized soft glow, not a huge sphere.

## Tor-M1
- Tor supports cold launch.
- Tor has AUTO and MANUAL behavior.
- Tor is the only current SAM intended to allow manual missile steering through OLS.
- Manual Tor OLS should not become missile POV.
- Do not add equivalent manual OLS missile control to Patriot/NASAMS/IRIS-T/SAMP-T unless explicitly requested.

## Reattack behavior
SECOND ATTACK is conditional, not guaranteed. It should only occur when a fresh usable intercept solution and sufficient track/time/energy/geometry exist. Otherwise SELF-DESTRUCT is valid. Do not add long meaningless circling to make a second attack visible.

## Benchmark caution
Current ballistic-intercept thresholds are gameplay benchmarks for this configuration, not claims about real-world system ranking or classified capability. Do not use them as justification for broad retuning during unrelated work.

## Large files
Current large orchestrators:
- `src/scenes/AdvancedScene.jsx`
- `src/store/engine.js`
- `src/scenes/SimpleModeScene.jsx`
- `src/index.css`
- `src/ui/HUD.jsx`

Prefer surgical changes and existing helper modules. Do not rewrite these wholesale unless explicitly tasked.
