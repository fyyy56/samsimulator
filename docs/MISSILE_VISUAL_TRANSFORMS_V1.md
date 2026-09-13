# Missile visual transforms V1 — 2026-09-13

## Scope

Visual/model transforms and renderer asset lifecycle only. No changes to guidance,
seeker physics, radar/tracks, aerodynamics, collision, physical poses, or the
buffered interpolation/slerp timeline in this milestone. Existing dirty working
tree changes predate this work and were preserved.

## Root causes

1. AdvancedScene supplied GLBs immediately, but a successful asynchronous header
   check removed and recreated the entity. Auxiliary seeker entity IDs were not
   removed. Their duplicate IDs threw DeveloperError inside reconciliation; the
   asset-check catch then incorrectly marked a valid GLB FAILED. Later camera
   transitions could therefore show a flat fallback. Removed the redundant
   successful-load rebuild. Reproduced before the fix for PAC, AIM and Aster;
   no new warnings during the repeated post-fix OLS/Advanced transitions.
2. Fallback images used square dimensions, distorting long silhouettes. IRIS-T
   has no missile GLB in this project and always used this path. Its billboard
   used map heading rather than camera-projected visual heading. Preserve image
   aspect and project the visual body axis into camera right/up for IRIS-T.
3. Cesium minimumPixelSize enlarged GLBs with distance independently of the
   engine anchors. Use constant uniform 1.45 scale, minimumPixelSize=0 and
   maximumScale=1.45 for all four profiles. Distant FOLLOW models are consequently
   small; camera distances were not changed.

## Asset audit

Raw mesh POSITION bounds, before GLB node hierarchy transforms, in metres:

| Asset | Raw XYZ dimensions | Raw nose axis | Effective correction quaternion (x,y,z,w) |
|---|---|---|---|
| PAC-3 | 5.200000 × 0.533403 × 0.533333 | +X | (0,0,-0.707107,0.707107) |
| AIM-120C-7 | 0.318000 × 3.660350 × 0.318000 | -Y | (0,0,0,1) |
| Aster 30 | 4.900000 × 0.805211 × 0.805211 | +X | (0,0,-0.707107,0.707107) |
| IRIS-T SLM | No GLB; PNG 5892 × 920 | Image right | (0,0,0,1), for engine anchors |

The AIM root rotates its raw -Y nose to +Z; Cesium converts that to +X.
Existing three GLB correction rotations were correct and were preserved.
Corrected AIM's descriptive forwardAxis metadata from +Y to -Y. GLBs were not
replaced. No non-uniform node scale found. All renderer scaling is uniform.
IRIS-T uses its integral source dimensions plus one scalar (Cesium packs sprite
dimensions as integers); its world image width is 4.2 × 1.45 metres.

## Anchors

Coordinates below are model coordinates after the GLB/Cesium axis conversion,
before the model correction and uniform scale. All anchors use the shared
buffered visual pose. Historical plume samples retain their historical position.

| Asset | Exhaust | Hotspot |
|---|---|---|
| PAC-3 | (0,-2.6,0) | (0,-2.5,0) |
| AIM-120 | (-1.82135,0,0) | (-1.75,0,0) |
| Aster | (0,-2.45,0) | (0,-2.35,0) |
| IRIS-T image | (-2,0,0) | (-1.9,0,0) |

Three GLBs show exhaust and heat at the engine in side/OLS views. IRIS-T's
screen-facing image cannot provide true front/rear geometry or fully consistent
3D engine alignment head-on. Fixing that limitation requires a real missile
model and remains outside this transform-only change.

## Validation

- Real standalone Cesium Viewer: all four assets, SIDE/FRONT/REAR/FOLLOW/OLS,
  scripted movement, thermal and exhaust probe; GLB proportions remain stable.
- Full GameViewport/AdvancedScene fixture: production OLS, thermal, plume and
  return to Advanced for all four; repeated FOLLOW/SIDE/OLS transitions also
  inspected. Post-fix PAC/AIM/Aster stay as GLBs; no new renderer warnings.
- Fixture movement is scripted renderer input, not combat simulation validation.
- Existing OLS tactical vectors default off; selected tactical trail is already
  suppressed in OLS. No UI/VFX redesign was needed.
- Checks: lint, production build, checkMissileModelTransforms,
  checkAdvancedModelOrientation, checkPac3VisualIntegration, checkAdvancedPlume,
  checkVisualSmoothness, checkVisualCamera, checkOlsPresentation.
- Production build retains its existing large-chunk warning.

Run `/scripts/missile-model-fixture.html` on the Vite server for isolated asset
inspection; `/scripts/visual-regression.html` contains MODEL buttons for the
full renderer. Both are development fixtures.

## Files changed in this milestone

- src/data/advanced3dRegistry.js
- src/scenes/advanced/modelOrientation.js
- src/scenes/AdvancedScene.jsx
- scripts/checkAdvancedModelOrientation.mjs
- scripts/checkMissileModelTransforms.mjs
- scripts/missile-model-fixture.html
- scripts/missile-model-fixture.js
- scripts/missile-runtime-fixture.jsx
- scripts/visual-regression.jsx
- docs/MISSILE_VISUAL_TRANSFORMS_V1.md
