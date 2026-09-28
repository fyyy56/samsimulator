# Targeted Validation Checks

Use the smallest relevant check set for the task. Do not run the full script suite unless the task explicitly requires broad regression coverage.

## Core guidance / missile physics
- Guidance behavior: `scripts/checkMissileGuidanceV2.mjs`
- Guidance separation / architecture: `scripts/checkGuidanceSeparation.mjs`
- Guidance kinematics: `scripts/checkGuidanceKinematics.mjs`
- Missile physics: `scripts/checkMissilePhysicsV2.mjs`
- Aster PIF / PAC attitude impulses + control jets: `scripts/checkTerminalControlActuators.mjs`
- Missile calibration: `scripts/checkMissileCalibration.mjs`
- Intercept feasibility: `scripts/checkInterceptFeasibility.mjs`
- Ballistic intercepts: `scripts/checkBallisticInterceptV2.mjs`
- Ballistic target physics: `scripts/checkBallisticPhysicsV2.mjs`
- Short-range launch behavior: `scripts/checkCloseRangeLaunches.mjs`
- Launch exit / initial phase: `scripts/checkLaunchExit.mjs`
- Vertical launch transition: `scripts/checkVerticalLaunchTransitionV1.mjs`
- Short IRIS-T launch: `scripts/checkShortIrisLaunch.mjs`

## Seeker / terminal guidance
- Seeker architecture: `scripts/checkSeekerArchitectureV1.mjs`
- Seeker acquisition: `scripts/checkSeekerAcquisitionV1.mjs`
- Seeker estimate: `scripts/checkSeekerEstimateV1.mjs`
- Terminal seeker integration: `scripts/checkTerminalSeekerIntegrationV1.mjs`

## Radar / sensors / tracks
- Core track estimator: `scripts/checkCoreTrackEstimatorV1.mjs`
- Sensor system: `scripts/checkSensorSystemV2.mjs`
- Sensor presentation: `scripts/checkSensorPresentationV1.mjs`
- Sensor debug overlays: `scripts/checkSensorDebugOverlaysV1.mjs`
- Search radars: `scripts/checkSearchRadarsV1.mjs`
- Radar-network handoff: `scripts/checkRadarNetworkHandoffV1.mjs`
- Radar-network optimization: `scripts/checkRadarNetworkOptimization.mjs`
- Routes + sensors: `scripts/checkRoutesAndSensors.mjs`
- Ballistic sensor comparison: `scripts/checkSensorBallisticComparison.mjs`

## AUTO / fire control / coordination
- Auto-defense priority: `scripts/checkAutoDefensePriority.mjs`
- Auto engagement planner: `scripts/checkAutoEngagementPlanner.mjs`
- Engagement coordinator: `scripts/checkEngagementCoordinator.mjs`
- Shared battery / launcher behavior: `scripts/checkSharedBatteryLaunchers.mjs`
- System integration: `scripts/checkSystemIntegrationV1.mjs`

## Tor / OLS
- Tor gameplay: `scripts/checkTorM1GameplayV1.mjs`
- Tor manual OLS: `scripts/checkTorManualOls.mjs`
- Tor sight-only launch: `scripts/checkTorSightOnlyLaunch.mjs`
- Tor cold-launch visual: `scripts/checkTorColdLaunchVisual.mjs`
- OLS presentation: `scripts/checkOlsPresentation.mjs`
- Manual fire during track coast: `scripts/checkManualFireTrackCoast.mjs`

## FPV / controllable air
- FPV gameplay: `scripts/checkFpvGameplayV1.mjs`
- FPV combat: `scripts/checkFpvCombatV1.mjs`
- FPV flight feel: `scripts/checkFpvFlightFeelV1.mjs`
- FPV rebuilt physics: `scripts/checkFpvFlightPhysicsRebuildV1.mjs`
- FPV OSD visual: `scripts/checkFpvOsdVisual.mjs`
- FPV sensor presentation: `scripts/checkFpvSensorPresentation.mjs`
- FPV visual regression: `scripts/checkFpvVisualRegression.mjs`
- Controllable-air baseline: `scripts/checkControllableAirEntityV0.mjs`
- Skyfall FPV: `scripts/checkSkyfallFpvV1.mjs`

## Advanced 3D presentation / models / VFX
- Advanced presentation: `scripts/checkAdvancedPresentationV1.mjs`
- Advanced model orientation: `scripts/checkAdvancedModelOrientation.mjs`
- Advanced plume: `scripts/checkAdvancedPlume.mjs`
- Missile model transforms: `scripts/checkMissileModelTransforms.mjs`
- Missile zoom invariance: `scripts/checkMissileZoomInvariance.mjs`
- PAC-3 visual integration: `scripts/checkPac3VisualIntegration.mjs`
- Aster assembly: `scripts/checkAsterAssembly.mjs`
- Aster booster visual: `scripts/checkAsterBoosterVisual.mjs`
- Impact presentation: `scripts/checkImpactPresentation.mjs`
- Visual camera: `scripts/checkVisualCamera.mjs`
- Visual smoothness: `scripts/checkVisualSmoothness.mjs`
- Visual regression fixture: `scripts/visual-regression.jsx`

## Environment / atmosphere
- Environment fixture: `scripts/environment-fixture.jsx`
- For atmosphere/cloud/smoke-only changes, prefer the environment fixture plus the nearest visual check. Do not run guidance or seeker checks unless simulation/core was touched.

## 2D / mode separation / assets
- Mode separation + assets: `scripts/checkModeSeparationAndAssets.mjs`
- Display catalog: `scripts/checkDisplayCatalog.mjs`
- Gepard: `scripts/checkGepard.mjs`
- Vinnytsia Patriot scenario: `scripts/checkVinnytsiaPatriot.mjs`

## Performance / maintenance
- Simulation performance: `scripts/checkSimulationPerformance.mjs`
- Performance milestone: `scripts/checkPerformanceMilestone.mjs`
- Maintenance: `scripts/checkMaintenance.mjs`

## Validation rule for agents

1. Start with the check closest to the modified subsystem.
2. Add one adjacent integration check only when the change crosses a subsystem boundary.
3. Run `npm run build` when source changes could affect bundling/imports.
4. Run `npm run lint` only when useful for the touched scope or before a larger integration commit.
5. Do not run every `check*.mjs` script by default.
6. For visual-only work under `src/scenes/advanced/`, avoid simulation checks unless core files changed.
7. In the final report, list only the checks actually run and their outcome.
