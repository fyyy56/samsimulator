# DroneFall / SAM Simulator — Agent Guide

## Purpose
This repository contains a browser-based air-defense simulation/game with separate 2D and 3D presentation modes on top of one shared simulation core.

## Stack
- React 19 + Vite
- Zustand
- Cesium / Resium for Advanced 3D
- MapLibre / react-map-gl for 2D

## Core architecture rules
1. 2D and 3D MUST share the same simulation truth and combat logic. Do not create parallel missile, sensor, track, or engagement physics for a renderer.
2. Keep simulation logic out of React/Cesium/MapLibre presentation code whenever possible.
3. Guidance should consume TrackData / seeker estimates where the current architecture expects them. Do not silently replace those inputs with perfect target truth.
4. Combat outcomes are kinematic/gameplay-simulation results. Do not introduce random hit/miss rolls.
5. Do not retune stable missile performance, seeker behavior, radar behavior, or TrackData merely to solve a visual task.
6. Tor-M1 is the only current SAM with manual missile steering through OLS. Do not generalize that behavior to other SAMs unless explicitly requested.
7. Preserve the current mode split:
   - GAME_2D
   - SANDBOX_2D
   - ADVANCED_3D
   - SANDBOX_3D
8. Keep the project buildable after each change.

## Start here before broad repo exploration
Read only the document relevant to the task:
- Overall architecture: `docs/ARCHITECTURE.md`
- Current stable/focus state: `docs/CURRENT_STATE.md`
- Missile/guidance work: `docs/MISSILE_GUIDANCE.md`
- Radar/sensors/tracks: `docs/SENSORS_TRACKING.md`
- Advanced 3D visuals/environment/VFX: `docs/ADVANCED_RENDERING.md`
- Modes/UI/localization: `docs/MODES_AND_UI.md`

Do not automatically read every document for every task.

## Main code areas
- `src/store/` — simulation state, physics, sensors, tracks, engagement, seekers, guidance
- `src/data/` — gameplay/configuration/profile registries
- `src/scenes/` — mode-level presentation and scene composition
- `src/scenes/advanced/` — Advanced 3D presentation, cameras, environment, VFX, OLS/FPV UI
- `src/ui/` — shared UI and 2D presentation helpers
- `src/content/` — editable/user scenario/content pipeline
- `scripts/` — targeted validation and regression checks

## Large orchestration files
These files are large and should not be rewritten casually:
- `src/store/engine.js`
- `src/scenes/AdvancedScene.jsx`
- `src/scenes/SimpleModeScene.jsx`
- `src/index.css`

Prefer surgical edits. Extract code only when the current task clearly benefits from it and behavior can be preserved.

## Validation
Use the smallest relevant validation first. Examples:
- Guidance: `scripts/checkMissileGuidanceV2.mjs`
- Seeker architecture: `scripts/checkSeekerArchitectureV1.mjs`
- Radar/network handoff: `scripts/checkRadarNetworkHandoffV1.mjs`
- Tor manual OLS: `scripts/checkTorManualOls.mjs`
- Tor gameplay: `scripts/checkTorM1GameplayV1.mjs`
- FPV combat: `scripts/checkFpvCombatV1.mjs`
- Visual/camera work: relevant visual regression or fixture only
- Environment work: environment fixture / targeted environment checks

Do not run a giant validation matrix unless the change is genuinely cross-cutting.

## Task execution
- Start from files/symbols named in the prompt and the relevant doc.
- Expand scope only when a dependency requires it.
- Avoid repo-wide rewrites during narrow bugfixes or visual passes.
- Preserve existing naming and data flow unless there is a concrete reason to change them.
- For military-system behavior, keep implementation at gameplay-simulation abstraction level; do not claim classified realism.

## Final report
Keep it short:
1. root cause / goal,
2. files changed,
3. validation run,
4. remaining caveat, if any.
