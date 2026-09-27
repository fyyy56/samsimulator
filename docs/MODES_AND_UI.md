# Modes / UI / Localization

## Mode split
Mode state lives in `src/store/gameStore.js`.

Current scene modes:
- `GAME_2D`
- `SANDBOX_2D`
- `ADVANCED_3D`
- `SANDBOX_3D`

2D and 3D are separate presentations and interaction flows, but they share the underlying simulation core.

## 2D
Primary scene:
- `src/scenes/SimpleModeScene.jsx`

Primary HUD/shared UI:
- `src/ui/HUD.jsx`
- marker/presentation helpers under `src/ui/`

Keep the 2D experience intentionally Ukraine/command-map oriented. Do not make it a second implementation of Advanced 3D physics.

## Advanced 3D
Primary scene:
- `src/scenes/AdvancedScene.jsx`

Specialized UI/presentation is under:
- `src/scenes/advanced/`

Examples:
- OLS HUD/camera,
- FPV OSD/camera effects,
- fire-control UI,
- environment controls,
- session panel,
- missile log,
- ground placement.

## Localization
Technical/UI localization data is centralized in:
- `src/data/uiLocalization.js`

Do not translate weapon/system designations such as:
Patriot, NASAMS, IRIS-T, SAMP/T, Tor-M1, PAC-3 MSE, AIM-120C-7, Aster 30, 9M331.

Preserve existing Russian technical terminology and key structure when editing UI.

## Presentation rule
UI may summarize or format simulation data, but should not invent a second gameplay state to make the display convenient. If UI needs derived data, prefer selectors/presentation helpers over mutating core state.

## Large presentation files
- `src/scenes/SimpleModeScene.jsx`
- `src/scenes/AdvancedScene.jsx`
- `src/ui/HUD.jsx`
- `src/index.css`

Make focused edits. Extract a component/helper when it creates a clear ownership boundary; do not perform large aesthetic refactors during unrelated gameplay work.
