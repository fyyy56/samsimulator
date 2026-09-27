# Missile / Guidance Map

## Ownership
- Specs/config: `src/data/interceptors.js`
- Launch profiles: `src/data/launchProfiles.js`
- Launch transition: `src/store/interceptorLaunch.js`
- Cold launch: `src/store/coldLaunch.js`
- Guidance state machine: `src/store/interceptorGuidance.js`
- Guidance/intercept math: `src/store/missileGuidanceCore.js`
- Physics/turn authority/energy: `src/store/interceptorPhysics.js`
- Altitude/flight-phase behavior: `src/store/interceptorAltitudePhysics.js`
- Seeker: `src/store/seekerSystem.js`
- Seeker profiles: `src/data/seekerProfiles.js`
- Feasibility: `src/store/interceptFeasibility.js`
- Engine integration: `src/store/engine.js`

## Core invariants
- No random hit chance.
- Guidance should use TrackData/network-track/seeker-derived information according to the existing state machine, not silently read perfect target truth.
- Network Track -> seeker search/acquisition -> own-seeker terminal guidance is an intentional pipeline.
- If seeker geometry is lost, fallback to valid network-track behavior where the existing architecture permits it.
- Negative closing rate after closest approach is not itself a bug; MISS/reattack decisions belong to the guidance/state-machine logic.
- SECOND ATTACK requires a new feasible intercept, usable track, time, energy and geometry.
- Do not globally raise max-G or energy to solve a single late-intercept case.

## Current change policy
Guidance/physics are considered stable. During rendering, UI, VFX, camera, environment, model-orientation or smoke tasks:
- do not alter G limits,
- do not alter seeker performance,
- do not alter missile speed/range/energy,
- do not alter PN/intercept math,
- do not change hit logic,
unless a reproducible gameplay bug is the explicit task.

## Tor manual control
Tor manual missile steering is a special path and must stay isolated from the standard autonomous guidance behavior of other SAMs.

## Aster model/staging
Aster has BODY + BOOSTER visual assets and staging presentation work. Visual staging is not a reason to change Aster guidance or physics.

## Useful targeted checks
Start with the smallest applicable script:
- `scripts/checkMissileGuidanceV2.mjs`
- `scripts/checkGuidanceKinematics.mjs`
- `scripts/checkGuidanceSeparation.mjs`
- `scripts/checkMissilePhysicsV2.mjs`
- `scripts/checkInterceptFeasibility.mjs`
- `scripts/checkSeekerArchitectureV1.mjs`
- `scripts/checkTerminalSeekerIntegrationV1.mjs`
- `scripts/checkRadarNetworkHandoffV1.mjs`
- `scripts/checkLaunchExit.mjs`
- `scripts/checkVerticalLaunchTransitionV1.mjs`
- `scripts/checkTorManualOls.mjs`
- `scripts/checkTorM1GameplayV1.mjs`

Do not run all missile checks by default.
