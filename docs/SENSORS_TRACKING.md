# Sensors / Tracking Map

## Ownership
- Sensor detection/evidence: `src/store/sensorDetection.js`
- Radar scan/geometry: `src/store/radarSystem.js`
- Sensor cadence/coast behavior: `src/store/sensorCadence.js`
- Track lifecycle: `src/store/trackSystem.js`
- Track estimation/prediction: `src/store/trackEstimator.js`
- Track data exposed to fire control/guidance: `src/store/trackDataProvider.js`
- Search-radar profiles: `src/data/searchRadarProfiles.js`
- Detection profiles: `src/data/sensorDetectionProfiles.js`
- Target/sensor signatures: related profile files under `src/data/`
- Seeker acquisition/tracking: `src/store/seekerSystem.js`

## Track lifecycle
The project intentionally distinguishes target truth from what the defense network knows. Track states and estimated motion are part of gameplay.

Do not bypass the track pipeline to make labels, fire control, or missile guidance look more accurate.

## Important invariants
- Track estimates may coast/predict between measurements.
- Reacquisition should preserve the intended track-memory behavior.
- Radar source changes and source quality/cadence are meaningful state.
- Fire control and guidance should consume the proper TrackData/network estimate.
- Sensor uncertainty/presentation must remain deterministic where the current implementation is deterministic; do not add random hit/detection outcomes casually.

## Current stability
A previous unconfirmed-track motion-lag issue was corrected by accounting for measured target motion. Treat current estimator/TrackData behavior as stable unless a new reproducible issue is shown.

## Presentation vs core
Visual radar beams, labels, scan animation, OLS graphics and overlays belong in scene/UI presentation. Changing them must not silently change detection timing/range/quality.

## Useful targeted checks
- `scripts/checkCoreTrackEstimatorV1.mjs`
- `scripts/checkSensorSystemV2.mjs`
- `scripts/checkSensorPresentationV1.mjs`
- `scripts/checkRadarNetworkHandoffV1.mjs`
- `scripts/checkRadarNetworkOptimization.mjs`
- `scripts/checkSearchRadarsV1.mjs`
- `scripts/checkSeekerEstimateV1.mjs`
- `scripts/checkSeekerArchitectureV1.mjs`

Prefer one or two checks that match the touched subsystem.
