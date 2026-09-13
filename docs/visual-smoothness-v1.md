# Visual smoothness V1 — implementation checkpoint, 2026-09-10

## Scope

Render-only changes. No changes to simulation physics, missile guidance,
radar detection, Fire Control or collision radii. The tree already contained
many unrelated uncommitted milestones; those were retained.

## Root causes and implementation

- Targets/missiles restarted a position lerp at alpha=0 on each incoming
  position. Orientation used a separate Euler interpolator. This introduced
  tick-shaped speed modulation even on a straight route.
- FPV used a different interpolator, starting Hermite segments from the last
  rendered position but using physical time/velocity tangents for that altered
  endpoint. It was not interpolation between actual consecutive snapshots.
- Normal follow cameras used raw kinematics even when model position was
  interpolated. Exhaust offsets also used raw kinematics.
- FPV target screen coordinates were refreshed by the low-frequency React
  telemetry interval, rather than after every camera frame.
- Additional close-view root cause: CesiumWidget calls clock.tick() and
  DataSourceDisplay.update() BEFORE scene.preRender. Writing constant Entity
  transforms in preRender put the rendered GLB one frame behind the camera.
  Physical models now use CallbackPositionProperty/CallbackProperty that read
  the shared memoized visual pose during Cesium's actual property-consumption
  phase. The camera reads exactly the same pose later in that frame. A new
  deterministic phase-order test covers this regression. Plume heads also use
  lazy visual-pose properties. No duplicate DataSourceDisplay update was added.

Now all Advanced physical entities share a bounded 32-snapshot buffer, captured
by one store subscription at fixed simulation steps. Cesium property reads and
the preRender camera sample the same memoized timeline. Time is simulationTime + the existing fixed
step accumulator - 0.05 seconds. Pausing preserves that timeline and accumulator.
No extra physics loop was introduced.

Positions use ECEF Cartesian lerp with alpha=(visualTime-t0)/(t1-t0).
Orientations use local-body quaternion slerp, followed by ENU-to-world and
model-specific GLB corrections. Emergency position extrapolation is capped at
50 ms; normal buffered rendering does not require it. Simulation poses are
never overwritten. Spawn seeds the buffer at its real position; despawn retains
the last rendered pose for the effect.

Camera, model, billboard rotation, thermal hot spot and plume anchors consume
this visual state. Onboard cameras mount directly on its quaternion/position;
only cosmetic rotation retains extra smoothing. Orbit heading damping now
accounts for a moving goal rather than a stationary goal per frame.

Track markers are a separate estimate-only cache with time-based correction
damping. No TrackData-to-physical-model transform bypass was found in the
audited Advanced path. FPV cue screen placement runs in postRender; telemetry
text remains throttled. No integer screen-position rounding was added.

## Hit-related corrections (user addendum)

- Hold camera uses the destroyed object's last orientation, not heading zero.
- Cleanup no longer automatically selects a different target and swings the
  camera onto it; FREE retains the last camera pose.
- Destroyed model is hidden while its effect remains at the last visual pose.
- Fire has its own bright pre-created canvas texture, not the dark smoke image.
  Canvas textures avoid the first-hit data-URL image decode. Flash/fire sizes
  are 64/100 px before scaling; existing 180/680/3800 ms timing is retained.
- Diagnostics record actual Cesium frame average/p95/max, VFX creation CPU,
  reconciliation CPU and maximum frame during the following 2 seconds.
- First visual-event replay reproduced a 224.7 ms frame, versus 21.0 ms on the
  second replay. VFX creation/reconciliation were only 0.5/1.2 ms. This pattern
  supports first-use graphics preparation as a contributor (not proof that all
  224.7 ms were texture work). Pre-uploading the three effect textures through
  tiny near-transparent startup billboards reduced the next fresh-scene first
  replay to 36.2 ms, with 0.4 ms creation / 1.0 ms reconciliation. Viewport and
  scene load differed, so these are diagnostic samples, not a controlled FPS
  benchmark. Warmup objects are removed after eight startup render frames.
- Fixed duplicate React root creation during hot reload of the dev-only test
  page. That warning was fixture-only, not a production-game warning.

The hitch was reproduced with a dev-only visual destruction replay, NOT a
measured successful physical interception. The replay removes a target and
publishes the same renderer event, without modifying collision/guidance.
Flash was visible; camera retained its pose through cleanup instead of selecting
another entity. This is not proof that every GPU/upload/audio hitch is eliminated.

## Verification

- checkVisualSmoothness: 60 s straight motion, 30/60/120 FPS × 1/2/5/10/20x,
  no repeated/backward/spiking position steps; world error < 1e-6 m in fixture.
  North wrap, apex, steep descent, bounded extrapolation and pause pass.
  Lazy model-property reads and later camera reads now assert identical poses.
- checkVisualCamera: six camera modes × three frame rates; finite and orthogonal
  frames, <1 m destination difference between 30/120 FPS after the fixture,
  listener cleanup passes.
- Existing FPV physics/feel, controllable entity, sensor presentation, OSD,
  visual regression, PAC-3 integration, Iskander orientation and plume checks
  pass. OSD test expectations were stale from the previous label-precision
  milestone; updated to 19.492 km / ~19.5 km without changing display logic.
- Browser: 20 Kh-555 loaded, SIDE/FOLLOW including maximum available zoom,
  accelerated simulation, test-controllable FPV camera and pause. No captured
  console warnings/errors. Static screenshots do not establish frame-perfect
  smoothness for every entity.
- One browser snapshot with 20 targets: 51 FPS, average 19.5 ms, p95 25.6 ms,
  max 26.9 ms. One test-FPV snapshot: 60 FPS, average 16.7 ms, p95 18.5 ms,
  max 19.5 ms. In-app viewport ~639×734; these are not desktop benchmark averages
  and there is no comparable pre-change GPU baseline.
- Pure interpolation CPU fixture (not GPU/FPS): 20/40/60 entities typically
  averages ~0.005–0.095 ms/frame across runs; occasional GC/scheduler outliers
  up to ~15 ms in the busy-browser run. This is not a before/after GPU comparison.
- Final lint and production build passed on 2026-09-10; build retains the
  existing >500 kB chunk warning. Final movement/camera/orientation/plume/FPV
  visual/OSD regression scripts passed. Latest isolated interpolation averages:
  0.005 / 0.009 / 0.015 ms for 20 / 40 / 60 entities.
- Final fresh browser page loaded and spawned a target, but the browser session
  lost its tabs before the final close-camera inspection. Therefore the last
  Cesium phase-order change is build/test verified, not fully revalidated by eye.

## Not completed / do not claim acceptance yet

### Follow-up acceptance run, 2026-09-10

- Added repeatable dev-only scenarios using existing target factories,
  deployment, queueEngagement and fixed-step tick. No synthetic hits in these
  scenarios. INTERCEPTOR pauses immediately after the normal launch; APEX and
  DESCENT seek with existing simulation ticks, not invented poses.
- Real PAC-3 interception completed in the browser: INTERCEPTOR_QUEUED →
  INTERCEPTOR_LAUNCHED → TARGET_INTERCEPTED, then zero targets/missiles/tracks.
  First run: HIT FRAME 18.0 ms, VFX 0.30 ms, cleanup 1.10 ms. Further real hits:
  19.6 ms and 18.3 ms maximum hit-window frames. No synthetic replay was used.
- PAC-3 inspected in SIDE/FOLLOW, pause/resume, boost/midcourse/terminal,
  and live plume. Motor-phase/burnout checks also passed numerically. Model diagnostics: GLB, CLOSE, READY, scale 1.45,
  pac-3-mse-colored.glb. No new model-load warnings captured.
- Iskander ran through launch/boost/ascent/midcourse/descent/terminal in the
  browser at 10x and cleaned up. Also visually inspected existing-physics
  apex checkpoint (pitch -2.7° through -7.1°) and terminal descent (-31° through
  -37.2°); no visible quaternion flip in the inspected poses. Full-trajectory
  sampling remains covered by deterministic tests, not continuous video analysis.
- RADAR scenario: three mechanical radar profiles and a Geran; >50 seconds
  of repeated track corrections, close SIDE/FOLLOW. Track label estimate moved
  separately; no TrackData physical-pose path exists. Source separation and
  phase-order regression checks pass.
- MIXED: started with 40 targets and three search radars, observed four
  simultaneous missiles, then real hits and continued remaining movement.
  Captured frame snapshot: 60 FPS, avg 16.7 ms, p95 17.6 ms, max 18.7 ms,
  simulation 0.56 ms. This is a snapshot, not a controlled before/after benchmark.
- Captured browser error/warning log was empty during the follow-up run.
- Gerbera spawned for the final inspection, but the subsequent browser session
  no longer contained the tab. User requested stopping; no further browser
  sessions were opened.

Still not claiming every A–J visual criterion is exhaustively accepted:
remaining final-version close visual runs are Gerbera/Kalibr and the mixed
FPV + missiles + radars case. Earlier Kh-555/FPV/20x checks and current numeric
30/60/120 FPS tests passed, but do not substitute for those visual runs.
No F chase or proximity-hit gameplay was added.

## Files in this pass

- src/scenes/AdvancedScene.jsx
- src/scenes/advanced/visualInterpolation.js
- src/scenes/advanced/modelOrientation.js
- src/scenes/advanced/AdvancedCameraController.js
- src/scenes/advanced/FpvOsd.jsx
- scripts/checkVisualSmoothness.mjs
- scripts/checkVisualCamera.mjs
- scripts/checkFpvOsdVisual.mjs (previous formatting expectations)
- scripts/visual-regression.html / .jsx (dev-only, excluded from production)
- scripts/visual-test-scenarios.js (dev-only real-engine acceptance fixtures)
- this checkpoint report
