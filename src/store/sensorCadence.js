import { SENSOR_EVIDENCE_CONFIG } from '../data/sensorDetectionProfiles.js';

// A missed measurement is meaningful only after the source could revisit.
// This changes retention, not beam opportunities, sensitivity or uncertainty.
export const getTrackCoastSeconds = track => Math.max(
  SENSOR_EVIDENCE_CONFIG.trackCoastTimeSec,
  (track?.expectedRevisitSec ?? 0) * 1.15,
);

export const getEvidenceDecayDelaySeconds = contact => Math.max(
  SENSOR_EVIDENCE_CONFIG.evidenceDecayDelaySec,
  (contact?.expectedRevisitSec ?? 0) * 1.15,
);
