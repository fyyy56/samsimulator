import {
  AIR_TARGET_GAMEPLAY_PROFILES,
  getAltitudeBand,
} from '../data/airTargetProfiles.js';
import {
  RADAR_CATEGORY_SENSOR_PROFILE,
  RADAR_SENSOR_PROFILE_ID,
  RADAR_SENSOR_PROFILES,
  SENSOR_EVIDENCE_CONFIG,
  TARGET_SENSOR_PROFILES,
} from '../data/sensorDetectionProfiles.js';
import { getDistanceKm } from './geo.js';

export const SENSOR_EVIDENCE_STAGE = Object.freeze({
  DETECTED: 'DETECTED',
  TRACKED: 'TRACKED',
  IDENTIFIED: 'IDENTIFIED',
});

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const clamp01 = value => clamp(value, 0, 1);

export const makeSensorContactKey = (sourceBatteryId, targetId) => (
  `${sourceBatteryId}:${targetId}`
);

export function isRadarSensorOperational(battery) {
  const radar = battery?.components?.radar;
  if (!radar || radar.operational === false || battery.operational === false) return false;
  return battery.status !== 'OFFLINE' && battery.status !== 'DESTROYED';
}

export function getRadarSensorProfile(battery) {
  const explicitProfileId = battery?.sensorProfileId
    ?? battery?.components?.radar?.sensorProfileId;
  const categoryProfileId = RADAR_CATEGORY_SENSOR_PROFILE[battery?.category];
  const electronicFallback = battery?.radarScanType === 'ELECTRONIC_SECTOR'
    ? RADAR_SENSOR_PROFILE_ID.GENERIC_ELECTRONIC
    : RADAR_SENSOR_PROFILE_ID.GENERIC_MECHANICAL;
  const profileId = explicitProfileId ?? categoryProfileId ?? electronicFallback;
  return RADAR_SENSOR_PROFILES[profileId]
    ?? RADAR_SENSOR_PROFILES[RADAR_SENSOR_PROFILE_ID.GENERIC_MECHANICAL];
}

export function getTargetSensorProfile(target) {
  const sensorProfile = TARGET_SENSOR_PROFILES[target?.type]
    ?? TARGET_SENSOR_PROFILES.DEFAULT;
  const gameplayProfile = AIR_TARGET_GAMEPLAY_PROFILES[target?.type];
  return {
    ...sensorProfile,
    sensorSignature: clamp01(
      target?.sensorSignature
      ?? gameplayProfile?.sensorSignature
      ?? TARGET_SENSOR_PROFILES.DEFAULT.sensorSignature,
    ),
  };
}

export function getSensorEvidenceThresholds(target) {
  const targetProfile = getTargetSensorProfile(target);
  const baseThresholds = SENSOR_EVIDENCE_CONFIG.thresholds;
  const detected = baseThresholds.detected;
  const tracked = clamp(
    baseThresholds.tracked * targetProfile.classificationDifficulty,
    detected + 0.05,
    0.76,
  );
  const identified = clamp(
    baseThresholds.identified * targetProfile.identificationDifficulty,
    tracked + 0.05,
    SENSOR_EVIDENCE_CONFIG.maximumEvidence,
  );
  return { detected, tracked, identified };
}

export function getSensorEvidenceStage(evidence, thresholds = SENSOR_EVIDENCE_CONFIG.thresholds) {
  if (evidence >= thresholds.identified) return SENSOR_EVIDENCE_STAGE.IDENTIFIED;
  if (evidence >= thresholds.tracked) return SENSOR_EVIDENCE_STAGE.TRACKED;
  if (evidence >= thresholds.detected) return SENSOR_EVIDENCE_STAGE.DETECTED;
  return null;
}

const getConfidence = (evidence, thresholds) => ({
  classificationConfidence: clamp01(evidence / thresholds.tracked),
  identificationConfidence: clamp01(
    (evidence - thresholds.tracked) / (thresholds.identified - thresholds.tracked),
  ),
});

const getRangeFactor = (distanceKm, maximumRangeKm, radarProfile) => {
  if (!Number.isFinite(distanceKm) || maximumRangeKm <= 0 || distanceKm > maximumRangeKm) return 0;
  const normalizedRange = clamp01(distanceKm / maximumRangeKm);
  const falloff = 1 - normalizedRange ** radarProfile.rangeFalloffExponent;
  return radarProfile.minimumRangeFactor
    + (1 - radarProfile.minimumRangeFactor) * falloff;
};

const createEmptySensorContact = ({ battery, target, simulationTime, thresholds }) => ({
  id: makeSensorContactKey(battery.id, target.id),
  sourceBatteryId: battery.id,
  sourceRadarId: battery.components.radar.id ?? `${battery.id}-RADAR`,
  targetId: target.id,
  evidence: 0,
  stage: null,
  confirmedBefore: false,
  firstConfirmedTime: null,
  createdAt: simulationTime,
  lastScanTime: null,
  lastOpportunityTime: null,
  lastOpportunityCount: 0,
  totalOpportunityCount: 0,
  lastContribution: 0,
  lastRangeKm: null,
  lastRangeFactor: 0,
  lastAltitudeBand: getAltitudeBand(target.altitudeM),
  lastAltitudeFactor: 0,
  lastHistoryFactor: 1,
  classificationConfidence: 0,
  identificationConfidence: 0,
  broadClassification: null,
  thresholds,
});

export function calculateSensorEvidenceContribution({
  battery,
  target,
  opportunityCount,
  existingContact = null,
  existingTrack = null,
  simulationTime,
}) {
  const radar = battery?.components?.radar;
  const normalizedOpportunityCount = Math.max(0, Math.floor(opportunityCount ?? 0));
  const operational = isRadarSensorOperational(battery);
  if (!radar || !operational || normalizedOpportunityCount === 0) {
    return {
      contribution: 0,
      contributionPerOpportunity: 0,
      opportunityCount: 0,
      operational,
      rangeKm: Number.POSITIVE_INFINITY,
      rangeFactor: 0,
      altitudeBand: getAltitudeBand(target?.altitudeM),
      altitudeFactor: 0,
      historyFactor: 1,
      reacquisition: false,
    };
  }

  const radarProfile = getRadarSensorProfile(battery);
  const targetProfile = getTargetSensorProfile(target);
  const rangeKm = getDistanceKm(
    radar.lat,
    radar.lng,
    target.position.lat,
    target.position.lng,
  );
  const rangeFactor = getRangeFactor(rangeKm, battery.radarRangeKm, radarProfile);
  const altitudeBand = getAltitudeBand(target.altitudeM);
  const altitudeFactor = radarProfile.altitudeFactors[altitudeBand] ?? 1;
  const memoryAnchorTime = existingContact?.lastScanTime
    ?? existingTrack?.lastUpdateTime
    ?? Number.NEGATIVE_INFINITY;
  const memoryAgeSec = simulationTime - memoryAnchorTime;
  const contactWentStale = existingContact?.confirmedBefore === true
    && memoryAgeSec > SENSOR_EVIDENCE_CONFIG.trackCoastTimeSec;
  const reacquisition = (
    contactWentStale || existingTrack?.state === 'LOST'
  ) && memoryAgeSec <= SENSOR_EVIDENCE_CONFIG.reacquisitionMemorySec;
  const knownContact = existingContact?.confirmedBefore === true || existingTrack != null;
  const historyFactor = reacquisition
    ? SENSOR_EVIDENCE_CONFIG.reacquisitionContributionMultiplier
    : (knownContact ? SENSOR_EVIDENCE_CONFIG.knownContactContributionMultiplier : 1);
  const rawPerOpportunity = radarProfile.contributionPerOpportunity
    * targetProfile.sensorSignature
    * rangeFactor
    * altitudeFactor
    * historyFactor;
  const contributionPerOpportunity = Math.min(
    radarProfile.maximumContributionPerOpportunity,
    rawPerOpportunity,
  );

  return {
    contribution: contributionPerOpportunity * normalizedOpportunityCount,
    contributionPerOpportunity,
    opportunityCount: rangeFactor > 0 ? normalizedOpportunityCount : 0,
    operational,
    rangeKm,
    rangeFactor,
    altitudeBand,
    altitudeFactor,
    historyFactor,
    reacquisition,
  };
}

/**
 * Applies one or more real scan opportunities for one Radar–Target pair.
 * No opportunity means no evidence gain and no reported-position refresh.
 */
export function applySensorScanOpportunities({
  existingContact = null,
  battery,
  target,
  opportunityCount,
  simulationTime,
  existingTrack = null,
}) {
  const thresholds = getSensorEvidenceThresholds(target);
  const emptyContact = createEmptySensorContact({
    battery,
    target,
    simulationTime,
    thresholds,
  });
  const isNetworkHandoff = !existingContact
    && existingTrack != null
    && existingTrack.sourceBatteryId !== battery.id;
  const retainedHandoffEvidence = isNetworkHandoff
    ? Math.max(
      thresholds.detected * SENSOR_EVIDENCE_CONFIG.networkHandoffEvidenceFloorFraction,
      (existingTrack.detectionEvidence ?? thresholds.detected)
        * SENSOR_EVIDENCE_CONFIG.networkHandoffEvidenceRetention,
    )
    : 0;
  const contact = existingContact ?? (isNetworkHandoff ? {
    ...emptyContact,
    evidence: Math.min(SENSOR_EVIDENCE_CONFIG.maximumEvidence, retainedHandoffEvidence),
    stage: getSensorEvidenceStage(retainedHandoffEvidence, thresholds),
    confirmedBefore: true,
    firstConfirmedTime: existingTrack.lastUpdateTime ?? simulationTime,
    broadClassification: existingTrack.classifiedType ?? null,
  } : emptyContact);
  const measurement = calculateSensorEvidenceContribution({
    battery,
    target,
    opportunityCount,
    existingContact: contact,
    existingTrack,
    simulationTime,
  });

  if (measurement.opportunityCount === 0) {
    return {
      contact,
      observation: null,
      measurement,
    };
  }

  const reacquisitionFloor = measurement.reacquisition
    ? thresholds.detected * SENSOR_EVIDENCE_CONFIG.reacquisitionEvidenceFloorFraction
    : 0;
  const startingEvidence = Math.max(contact.evidence, reacquisitionFloor);
  const evidence = Math.min(
    SENSOR_EVIDENCE_CONFIG.maximumEvidence,
    startingEvidence + measurement.contribution,
  );
  const stage = getSensorEvidenceStage(evidence, thresholds);
  const confidence = getConfidence(evidence, thresholds);
  const confirmedBefore = contact.confirmedBefore || stage != null;
  const targetProfile = getTargetSensorProfile(target);
  const nextContact = {
    ...contact,
    evidence,
    stage,
    confirmedBefore,
    firstConfirmedTime: contact.firstConfirmedTime
      ?? (stage == null ? null : simulationTime),
    lastScanTime: simulationTime,
    lastOpportunityTime: simulationTime,
    lastOpportunityCount: measurement.opportunityCount,
    totalOpportunityCount: contact.totalOpportunityCount + measurement.opportunityCount,
    lastContribution: measurement.contribution,
    lastRangeKm: measurement.rangeKm,
    lastRangeFactor: measurement.rangeFactor,
    lastAltitudeBand: measurement.altitudeBand,
    lastAltitudeFactor: measurement.altitudeFactor,
    lastHistoryFactor: measurement.historyFactor,
    ...confidence,
    broadClassification: (
      stage === SENSOR_EVIDENCE_STAGE.TRACKED
      || stage === SENSOR_EVIDENCE_STAGE.IDENTIFIED
    ) ? targetProfile.broadClassification : null,
    thresholds,
  };

  return {
    contact: nextContact,
    observation: stage == null ? null : {
      targetId: target.id,
      sourceBatteryId: battery.id,
      sourceRadarId: nextContact.sourceRadarId,
      evidence,
      stage,
      ...confidence,
      broadClassification: nextContact.broadClassification,
      identifiedType: stage === SENSOR_EVIDENCE_STAGE.IDENTIFIED ? target.type : null,
      identifiedModelId: stage === SENSOR_EVIDENCE_STAGE.IDENTIFIED
        ? (target.modelId ?? null)
        : null,
      scanOpportunityCount: measurement.opportunityCount,
      lastContribution: measurement.contribution,
      lastScanTime: simulationTime,
      thresholds,
      reacquisition: measurement.reacquisition,
    },
    measurement,
  };
}

export function ageSensorEvidenceContact(contact, simulationTime, deltaTimeSec) {
  const lastActivityTime = contact.lastScanTime ?? contact.createdAt;
  const ageSec = Math.max(0, simulationTime - lastActivityTime);
  if (ageSec <= SENSOR_EVIDENCE_CONFIG.evidenceDecayDelaySec) return contact;

  const withinReacquisitionMemory = contact.confirmedBefore
    && ageSec <= SENSOR_EVIDENCE_CONFIG.reacquisitionMemorySec;
  const memoryExpired = contact.confirmedBefore
    && ageSec > SENSOR_EVIDENCE_CONFIG.reacquisitionMemorySec;
  const decayMultiplier = contact.confirmedBefore
    ? SENSOR_EVIDENCE_CONFIG.confirmedEvidenceDecayMultiplier
    : 1;
  const memoryFloor = withinReacquisitionMemory
    ? contact.thresholds.detected * SENSOR_EVIDENCE_CONFIG.reacquisitionEvidenceFloorFraction
    : 0;
  const evidenceBeforeDecay = memoryExpired
    ? Math.min(contact.evidence, contact.thresholds.detected * 0.25)
    : contact.evidence;
  const evidence = Math.max(
    memoryFloor,
    evidenceBeforeDecay
      - SENSOR_EVIDENCE_CONFIG.evidenceDecayPerSec * decayMultiplier * deltaTimeSec,
  );
  const confirmedBefore = withinReacquisitionMemory;
  if (
    ageSec > SENSOR_EVIDENCE_CONFIG.staleContactRetentionSec
    && evidence <= 0
  ) return null;

  const stage = getSensorEvidenceStage(evidence, contact.thresholds);
  return {
    ...contact,
    evidence,
    stage,
    confirmedBefore,
    lastOpportunityCount: 0,
    lastContribution: 0,
    ...getConfidence(evidence, contact.thresholds),
    broadClassification: stage === SENSOR_EVIDENCE_STAGE.TRACKED
      || stage === SENSOR_EVIDENCE_STAGE.IDENTIFIED
      ? contact.broadClassification
      : null,
  };
}

export function ageSensorEvidenceContacts(contacts, simulationTime, deltaTimeSec) {
  return contacts
    .map(contact => ageSensorEvidenceContact(contact, simulationTime, deltaTimeSec))
    .filter(Boolean);
}

export function upsertSensorEvidenceContact(contacts, nextContact) {
  const existingIndex = contacts.findIndex(contact => contact.id === nextContact.id);
  if (existingIndex < 0) return [...contacts, nextContact];
  return contacts.map((contact, index) => index === existingIndex ? nextContact : contact);
}

/**
 * Fuses retained pair evidence, but emits an observation only when at least one
 * radar really scanned this target at the supplied simulation time.
 */
export function fuseSensorEvidence({ contacts, target, simulationTime }) {
  const targetContacts = contacts.filter(contact => contact.targetId === target.id);
  const currentContacts = targetContacts.filter(contact => (
    contact.lastScanTime != null
    && Math.abs(contact.lastScanTime - simulationTime) < 1e-6
    && contact.lastOpportunityCount > 0
  ));
  if (currentContacts.length === 0) return null;

  const rankedContacts = [...targetContacts].sort((first, second) => (
    second.evidence - first.evidence
    || second.lastScanTime - first.lastScanTime
    || first.id.localeCompare(second.id)
  ));
  const strongestEvidence = rankedContacts[0]?.evidence ?? 0;
  const secondaryEvidence = rankedContacts
    .slice(1)
    .reduce((sum, contact) => sum + contact.evidence, 0);
  const evidence = Math.min(
    SENSOR_EVIDENCE_CONFIG.maximumEvidence,
    strongestEvidence
      + secondaryEvidence * SENSOR_EVIDENCE_CONFIG.secondarySensorFusionWeight,
  );
  const thresholds = getSensorEvidenceThresholds(target);
  const stage = getSensorEvidenceStage(evidence, thresholds);
  if (stage == null) return null;

  const sourceContact = [...currentContacts].sort((first, second) => (
    second.lastContribution - first.lastContribution
    || second.evidence - first.evidence
    || first.id.localeCompare(second.id)
  ))[0];
  const targetProfile = getTargetSensorProfile(target);
  const confidence = getConfidence(evidence, thresholds);
  return {
    targetId: target.id,
    sourceBatteryId: sourceContact.sourceBatteryId,
    sourceRadarId: sourceContact.sourceRadarId,
    evidence,
    stage,
    ...confidence,
    broadClassification: stage === SENSOR_EVIDENCE_STAGE.TRACKED
      || stage === SENSOR_EVIDENCE_STAGE.IDENTIFIED
      ? targetProfile.broadClassification
      : null,
    identifiedType: stage === SENSOR_EVIDENCE_STAGE.IDENTIFIED ? target.type : null,
    identifiedModelId: stage === SENSOR_EVIDENCE_STAGE.IDENTIFIED
      ? (target.modelId ?? null)
      : null,
    scanOpportunityCount: currentContacts.reduce(
      (sum, contact) => sum + contact.lastOpportunityCount,
      0,
    ),
    lastContribution: currentContacts.reduce(
      (sum, contact) => sum + contact.lastContribution,
      0,
    ),
    lastScanTime: simulationTime,
    thresholds,
    contributorCount: targetContacts.length,
    reacquisition: currentContacts.some(contact => contact.lastHistoryFactor > 1.1),
  };
}

/**
 * Convenience integration for a target and all radars that obtained real scan
 * opportunities in the current simulation tick.
 */
export function applySensorScanBatch({
  contacts,
  target,
  scanOpportunities,
  simulationTime,
  existingTrack = null,
}) {
  let updatedContacts = contacts;
  scanOpportunities.forEach(({ battery, opportunityCount }) => {
    const contactId = makeSensorContactKey(battery.id, target.id);
    const existingContact = updatedContacts.find(contact => contact.id === contactId) ?? null;
    const result = applySensorScanOpportunities({
      existingContact,
      battery,
      target,
      opportunityCount,
      simulationTime,
      existingTrack,
    });
    updatedContacts = upsertSensorEvidenceContact(updatedContacts, result.contact);
  });

  return {
    contacts: updatedContacts,
    observation: fuseSensorEvidence({
      contacts: updatedContacts,
      target,
      simulationTime,
    }),
  };
}

export function isTrackSensorStale(track, simulationTime) {
  if (track?.lastUpdateTime == null) return false;
  return simulationTime - track.lastUpdateTime > SENSOR_EVIDENCE_CONFIG.trackCoastTimeSec;
}
