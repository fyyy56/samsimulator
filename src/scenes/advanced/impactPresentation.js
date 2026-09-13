import { pushVisualSnapshot } from './visualInterpolation.js';

// Contact metadata is emitted by the existing swept collision check. This
// adapter keeps the legacy coincident-sprite IMPACT phase out of 3D buffers.
export function captureImpactAwareSnapshot(cache, key, metadata, position, kinematics, time, impact = null) {
  if (impact) {
    if (metadata.visualImpact) return;
    metadata.visualImpact = impact;
    pushVisualSnapshot(cache, key, impact.position, kinematics, impact.time);
    return;
  }
  if (!metadata.visualImpact) pushVisualSnapshot(cache, key, position, kinematics, time);
}
