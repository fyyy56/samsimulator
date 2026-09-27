# Advanced 3D Presentation Rules

This directory owns Advanced 3D presentation: cameras, overlays, environment, model transforms and VFX.

## Visual-task boundary
For visual/environment/camera/VFX work, do NOT change:
- missile guidance,
- interceptor physics or G/energy/range,
- seeker performance,
- radar/sensor performance,
- TrackData/track estimation,
- hit/miss logic.

Solve visual problems in presentation code, visual profiles, shaders, transforms, interpolation or renderer-side effects.

## State
Consume the shared simulation state. Do not create a parallel 3D-only combat simulation.

## Interpolation
Preserve the existing visual snapshot / ZERO-JITTER interpolation architecture unless the task is specifically about a demonstrated interpolation bug.

## OLS / FPV
- OLS remains a system/camera presentation, not missile POV.
- Tor-M1 is the only current SAM with manual OLS missile steering.
- FPV camera/OSD changes must not silently alter FPV physics/warhead logic.

## Environment
Current priority is depth-aware atmosphere/cloud/smoke rendering, lighting, missile plume identity, impact/explosion VFX, thermal/OLS look and camera polish.

## Large file warning
`../AdvancedScene.jsx` is a large scene orchestrator. Prefer existing helpers or small focused helpers over adding another unrelated block directly to it.

## Validation
Use the smallest matching visual/fixture check rather than broad simulation retuning or validation.
