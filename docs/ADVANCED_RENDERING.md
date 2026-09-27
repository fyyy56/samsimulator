# Advanced 3D Rendering / VFX Guide

## Scope
This document applies to Advanced 3D presentation work. Its purpose is to keep rendering tasks from leaking into simulation/weapon tuning.

## Main files
- `src/scenes/AdvancedScene.jsx` — scene-level 3D presentation orchestration.
- `src/scenes/advanced/advancedEnvironment.js` — environment orchestration.
- `src/scenes/advanced/environmentSettings.js` — weather/environment settings.
- `src/scenes/advanced/environmentClouds.glsl` — cloud shader.
- `src/scenes/advanced/cloudSmokeOverlay.js` — cloud/smoke presentation integration.
- `src/scenes/advanced/environment.css` — environment controls/presentation styling.
- `src/scenes/advanced/advancedPresentation.js` / `.css` — advanced UI/presentation helpers.
- `src/scenes/advanced/visualInterpolation.js` — visual snapshot interpolation.
- `src/scenes/advanced/coldLaunchVfx.js` — cold-launch effects.
- `src/scenes/advanced/impactVfx.js` — impact effects.
- `src/scenes/advanced/asterBoosterDebris.js` — Aster booster/debris visuals.
- `src/data/visualEffectProfiles.js` — visual-effect configuration.
- `src/scenes/advanced/modelOrientation.js` — presentation/model transforms.

## Hard boundary
A rendering task must not change:
- interceptor physics,
- G/energy/range calibration,
- seeker acquisition/performance,
- radar detection performance,
- TrackData behavior,
- hit/miss logic,
unless the prompt explicitly identifies a simulation bug.

Use visual transforms, renderer-side state and presentation profiles instead.

## Current rendering priorities
1. World-space/depth-aware atmospheric foundation.
2. Better cloud depth, occlusion and distance attenuation.
3. Correct smoke/cloud depth relation.
4. Atmospheric haze and lighting hooks.
5. Distinct missile plume/trail identities.
6. HDRI/IBL-style environment-lighting hooks.
7. Explosion/impact presentation.
8. Thermal/OLS sensor look.
9. Camera polish.
10. Terrain later.

## Known issues
- clouds can read as slices/layers rather than a coherent volume,
- horizon banding can appear cyan/green/white,
- night terrain can stay too green/bright,
- smoke can composite in front of clouds at invalid depth,
- translucent elements need more coherent distance/depth treatment.

## Visual identity rules
- IRIS-T: very thin / nearly smokeless.
- AIM-120: thin, slightly broader/more expanding.
- PAC-3: thin smoke; older trail disperses and darkens/greys.
- Aster: strong booster phase; body trail closer to AIM-120 after separation.
- Night: powered missile is primarily a bright point/small glow, not a giant light sphere.
- Cloud penetration: attenuate plume and allow localized glow; avoid giant emissive balls.

## Assets
Prefer reusable browser-friendly assets (GLB, PNG/TGA/EXR, sprite sheets/flipbooks, texture/noise maps). Do not introduce Unreal-only assets or workflows into the browser renderer.

## Validation
Use the relevant fixture/check only:
- environment fixture for environment/cloud work,
- visual regression for broad presentation changes,
- `checkAdvancedPlume.mjs` for plume-specific work,
- `checkAdvancedModelOrientation.mjs` for model orientation,
- `checkAsterBoosterVisual.mjs` for Aster booster presentation,
- `checkTorColdLaunchVisual.mjs` for Tor cold-launch visuals.

Do not use a visual pass as a reason to rerun or recalibrate all missile physics.
