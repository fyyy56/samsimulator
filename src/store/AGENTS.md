# Store / Simulation Rules

This directory owns simulation/core state and deterministic gameplay logic.

## Boundaries
- Do not import React, Cesium, Resium or MapLibre into core simulation modules.
- Do not add renderer-specific state to missile, track, sensor or engagement physics.
- 2D and 3D must consume the same simulation behavior.
- Prefer `src/data/` for declarative profiles/configuration rather than hardcoding presentation-specific constants into the engine.

## Guidance / sensing
- Preserve TrackData / seeker / network-track information boundaries.
- Do not replace estimated track data with perfect target truth where the existing system intentionally uses estimates.
- Do not introduce random hit/miss decisions.
- Do not retune missile G, energy, range, seeker or radar parameters during visual/UI work.

## Engine
`engine.js` is a large coordinator. Avoid making it the default home for new independent subsystems. Reuse existing specialized modules where possible.

## Stable core
Unless the task demonstrates a concrete bug, preserve:
- track estimation and lifecycle,
- seeker handoff/fallback,
- missile guidance/physics calibration,
- intercept/reattack logic,
- shared-mode behavior.

## Validation
Choose the smallest relevant `scripts/check*.mjs` check. Cross-cutting full validation is reserved for cross-cutting changes.
