# Architecture Map

## High-level flow

```
App / GameViewport
├─ SimpleModeScene      -> 2D GAME / SANDBOX presentation
└─ AdvancedScene        -> 3D GAME / SANDBOX presentation
                         |
                         v
                 shared Zustand/core state
                         |
        +----------------+----------------+
        |                |                |
     sensors          tracks          engagement
        |                |                |
        +-------> TrackData <--------------+
                         |
                    guidance
                         |
                      seeker
                         |
                 interceptor physics
                         |
                    world state
```

The renderers are consumers of shared simulation state. They must not become alternate physics engines.

## Entry and mode selection
- `src/App.jsx` — application-level scene routing/composition.
- `src/scenes/GameViewport.jsx` — viewport/mode boundary.
- `src/store/gameStore.js` — mode, scene, language, presentation state.
- `src/scenes/SimpleModeScene.jsx` — primary 2D scene.
- `src/scenes/AdvancedScene.jsx` — primary 3D scene.

## Simulation orchestration
- `src/store/engine.js` — central simulation orchestration/tick integration. Large file; treat as coordinator, not the preferred home for every new subsystem.
- `src/store/simulationEvents.js` — simulation event definitions/emission.
- `src/store/scenarios.js` — scenario/theater setup.
- `src/store/airTargetSystem.js` — air-target advancement.
- `src/store/ballisticTargetPhysics.js` — ballistic-target physics.
- `src/store/controllableAirEntity.js` — controllable aircraft/FPV-style air entity state/physics integration.

## Sensors and tracks
- `src/store/sensorDetection.js` — radar/sensor detection/evidence logic.
- `src/store/radarSystem.js` — radar geometry/scan behavior.
- `src/store/sensorCadence.js` — cadence/coast timing helpers.
- `src/store/trackSystem.js` — track lifecycle/state.
- `src/store/trackEstimator.js` — measurement-to-estimate propagation/update.
- `src/store/trackDataProvider.js` — fire-control/network track estimates exposed to consumers.

## Engagement and weapon control
- `src/store/engagement.js` — engagement state/logic.
- `src/store/engagementCoordinator.js` — engagement coordination.
- `src/store/autoDefense.js` — battery AUTO/MANUAL behavior.
- `src/store/autoEngagementPlanner.js` — automatic target/engagement planning.
- `src/store/interceptFeasibility.js` — intercept feasibility evaluation.
- `src/data/weaponCompatibility.js` — weapon/system compatibility.

## Missile path
- `src/store/interceptorLaunch.js` — launch state/transition.
- `src/store/coldLaunch.js` — cold-launch gameplay state.
- `src/store/interceptorGuidance.js` — guidance state machine and guidance-source behavior.
- `src/store/missileGuidanceCore.js` — kinematic intercept/guidance math.
- `src/store/interceptorPhysics.js` — missile performance/turn/energy physics.
- `src/store/interceptorAltitudePhysics.js` — altitude/flight-phase related behavior.
- `src/store/seekerSystem.js` — seeker search/acquisition/track/fallback.
- `src/data/interceptors.js` — interceptor gameplay specifications.
- `src/data/seekerProfiles.js` — seeker configuration.
- `src/data/launchProfiles.js` — launch behavior profiles.

## Advanced 3D presentation
- `src/scenes/AdvancedScene.jsx` — 3D scene orchestration. Large: camera, entities, visual interpolation, environment, VFX, OLS/FPV integration.
- `src/scenes/advanced/AdvancedCameraController.js` — camera control.
- `src/scenes/advanced/OlsCameraController.js` — OLS camera control.
- `src/scenes/advanced/FpvOsd.jsx` / `fpvCameraEffect.js` — FPV presentation.
- `src/scenes/advanced/OlsHud.jsx` — OLS presentation.
- `src/scenes/advanced/advancedEnvironment.js` — advanced environment orchestration.
- `src/scenes/advanced/environmentSettings.js` — environment settings/state.
- `src/scenes/advanced/environmentClouds.glsl` — cloud shader.
- `src/scenes/advanced/cloudSmokeOverlay.js` — cloud/smoke presentation bridge.
- `src/scenes/advanced/coldLaunchVfx.js` — cold-launch VFX.
- `src/scenes/advanced/impactVfx.js` — impact VFX.
- `src/scenes/advanced/asterBoosterDebris.js` — Aster booster visual/debris behavior.
- `src/scenes/advanced/visualInterpolation.js` — visual snapshot interpolation.
- `src/scenes/advanced/AdvancedFireControl.jsx` — 3D fire-control UI.
- `src/scenes/advanced/MissileLog.jsx` — missile diagnostic/event UI.
- `src/scenes/advanced/GroundPlacement.jsx` / `groundPlacement.js` — ground object placement/presentation.

## 2D / shared UI
- `src/ui/HUD.jsx` — main 2D/shared HUD; large, edit surgically.
- `src/ui/TrackMarker.jsx`, `MissileMarker.jsx`, tactical asset/icon helpers — marker presentation.
- `src/ui/trackPresentation.js` / `trackLabelFormatting.js` — presentation formatting for track state.
- `src/ui/DesignModeOverlay.jsx` — design/editor overlay.

## Data/configuration
`src/data/` is the preferred home for declarative gameplay/display configuration: interceptor specs, registries, launch profiles, visual profiles, localization, compatibility, map/profile data.

## Known architectural pressure points
- `engine.js` and `AdvancedScene.jsx` are orchestration-heavy.
- `SimpleModeScene.jsx` and `HUD.jsx` are presentation-heavy.
- `index.css` is very large.
Do not split these merely to reduce line count. Refactor only when a task has a clear ownership boundary and regression coverage.
