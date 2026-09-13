import {
  AIR_TARGET_GAMEPLAY_PROFILES,
  getAltitudeBand,
} from '../data/airTargetProfiles.js';
import {
  RADAR_CATEGORY_SENSOR_PROFILE,
  RADAR_SENSOR_PROFILE_ID,
  RADAR_SENSOR_PROFILES,
  SENSOR_EVIDENCE_CONFIG,
  SENSOR_PHYSICS_CONFIG,
  TARGET_SENSOR_PROFILES,
} from '../data/sensorDetectionProfiles.js';
import { getDestinationPoint } from './geo.js';
import { getRadarGeometry } from './radarSystem.js';
import { getEvidenceDecayDelaySeconds, getTrackCoastSeconds } from './sensorCadence.js';

export const SENSOR_EVIDENCE_STAGE = Object.freeze({
  DETECTED: 'DETECTED',
  TRACKED: 'TRACKED',
  IDENTIFIED: 'IDENTIFIED',
});

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const clamp01 = value => clamp(value, 0, 1);
export const RADAR_SOURCE_TAKEOVER_RATIO = 1.16;

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
  const sensorProfile = TARGET_SENSOR_PROFILES[target?.modelId]
    ?? TARGET_SENSOR_PROFILES[target?.type]
    ?? TARGET_SENSOR_PROFILES.DEFAULT;
  const gameplayProfile = AIR_TARGET_GAMEPLAY_PROFILES[target?.type];
  return {
    ...sensorProfile,
    radarSignature: clamp01(
      target?.radarSignature
      ?? target?.sensorSignature
      ?? sensorProfile.radarSignature
      ?? gameplayProfile?.sensorSignature
      ?? TARGET_SENSOR_PROFILES.DEFAULT.radarSignature,
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

const getRangeFactor = (distanceKm, maximumRangeKm, radarProfile, radarSignature) => {
  if (!Number.isFinite(distanceKm) || maximumRangeKm <= 0 || distanceKm > maximumRangeKm) return 0;
  const signatureRangeFactor = 0.58 + 0.42 * Math.sqrt(clamp01(radarSignature));
  const effectiveRangeKm = maximumRangeKm * signatureRangeFactor;
  if (distanceKm > effectiveRangeKm) return 0;
  const normalizedRange = clamp01(distanceKm / effectiveRangeKm);
  const falloff = 1 - normalizedRange ** radarProfile.rangeFalloffExponent;
  return Math.max(0, radarProfile.minimumRangeFactor * 0.25
    + (1 - radarProfile.minimumRangeFactor * 0.25) * falloff);
};

const smoothstep = value => {
  const normalized = clamp01(value);
  return normalized * normalized * (3 - 2 * normalized);
};

const deterministicUnit = (key) => {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
};

export function calculateRadarDetection({ battery, target }) {
  const radarProfile = getRadarSensorProfile(battery);
  const targetProfile = getTargetSensorProfile(target);
  const geometry = getRadarGeometry(battery, target, radarProfile);
  const rangeFactor = geometry.insideNominalCoverage && geometry.hasLineOfSight
    ? getRangeFactor(
      geometry.distanceKm,
      battery.radarRangeKm,
      radarProfile,
      targetProfile.radarSignature,
    )
    : 0;
  const altitudeM = geometry.targetHeightM ?? 0;
  const clutterClearance = smoothstep(
    (altitudeM - SENSOR_PHYSICS_CONFIG.lowAltitudeClutterCeilingM)
      / Math.max(1, SENSOR_PHYSICS_CONFIG.fullClutterClearanceM
        - SENSOR_PHYSICS_CONFIG.lowAltitudeClutterCeilingM),
  );
  const clutterFactor = targetProfile.lowAltitudeDetectability
    + (1 - targetProfile.lowAltitudeDetectability) * clutterClearance;
  const radarLowAltitudeFactor = (radarProfile.lowAltitudePerformance ?? 1)
    + (1 - (radarProfile.lowAltitudePerformance ?? 1)) * clutterClearance;
  const signatureFactor = 0.4 + 0.6 * Math.sqrt(targetProfile.radarSignature);
  const detectionScore = clamp01(
    rangeFactor
      * clutterFactor
      * radarLowAltitudeFactor
      * signatureFactor
      * (radarProfile.sensitivity ?? 1)
      * (targetProfile.radarSignature < 0.45 ? radarProfile.smallTargetPerformance ?? 1 : 1)
      * SENSOR_PHYSICS_CONFIG.terrainOcclusionFactor
      * SENSOR_PHYSICS_CONFIG.environmentFactor
      * SENSOR_PHYSICS_CONFIG.jammingFactor,
  );
  return {
    ...geometry,
    rangeFactor,
    clutterFactor,
    radarLowAltitudeFactor,
    signatureFactor,
    detectionScore,
    radarSignature: targetProfile.radarSignature,
    terrainOcclusionFactor: SENSOR_PHYSICS_CONFIG.terrainOcclusionFactor,
    environmentFactor: SENSOR_PHYSICS_CONFIG.environmentFactor,
    jammingFactor: SENSOR_PHYSICS_CONFIG.jammingFactor,
    detectable: geometry.insideNominalCoverage
      && geometry.hasLineOfSight
      && detectionScore >= SENSOR_PHYSICS_CONFIG.minimumDetectionScore,
  };
}

function createRadarMeasurement({ battery, target, simulationTime, sequence, detection }) {
  const radarProfile = getRadarSensorProfile(battery);
  const score = clamp01(
    detection.detectionScore * (radarProfile.measurementQualityMultiplier ?? 1),
  );
  const normalizedRange = clamp01(detection.distanceKm / Math.max(1, battery.radarRangeKm));
  const positionUncertaintyM = (SENSOR_EVIDENCE_CONFIG.measurementPositionErrorBaseM
    + SENSOR_EVIDENCE_CONFIG.measurementPositionErrorAtMaxRangeM
      * normalizedRange * (1.15 - score))
    * (radarProfile.positionUncertaintyMultiplier ?? 1);
  const altitudeUncertaintyM = (SENSOR_EVIDENCE_CONFIG.measurementAltitudeErrorBaseM
    + SENSOR_EVIDENCE_CONFIG.measurementAltitudeErrorAtMaxRangeM
      * normalizedRange * (1.15 - score))
    * (radarProfile.altitudeUncertaintyMultiplier ?? 1);
  const key = `${battery.id}:${target.id}:${sequence}`;
  const radialErrorM = (deterministicUnit(`${key}:range`) * 2 - 1) * positionUncertaintyM;
  const crossErrorM = (deterministicUnit(`${key}:cross`) * 2 - 1) * positionUncertaintyM * 0.65;
  const measuredRadial = getDestinationPoint(
    target.position.lat,
    target.position.lng,
    detection.bearingDeg,
    radialErrorM / 1000,
  );
  const measuredPosition = getDestinationPoint(
    measuredRadial.lat,
    measuredRadial.lng,
    detection.bearingDeg + 90,
    crossErrorM / 1000,
  );
  const speedErrorFraction = (deterministicUnit(`${key}:speed`) * 2 - 1)
    * SENSOR_EVIDENCE_CONFIG.measurementSpeedErrorFraction * (1.2 - score)
    * (radarProfile.velocityUncertaintyMultiplier ?? 1);
  const headingErrorDeg = (deterministicUnit(`${key}:heading`) * 2 - 1)
    * SENSOR_EVIDENCE_CONFIG.measurementHeadingErrorDeg * (1.2 - score)
    * (radarProfile.headingUncertaintyMultiplier ?? 1);
  const altitudeErrorM = (deterministicUnit(`${key}:altitude`) * 2 - 1)
    * altitudeUncertaintyM;
  const trueSpeedKmh = target.ballisticPhysics?.horizontalSpeedMps != null
    ? target.ballisticPhysics.horizontalSpeedMps * 3.6
    : (target.speedKmh ?? target.velocity?.speedKmh ?? 0);
  return {
    timestamp: simulationTime,
    sensorId: battery.components.radar.id ?? `${battery.id}-RADAR`,
    sourceBatteryId: battery.id,
    targetId: target.id,
    position: {
      lat: measuredPosition.lat,
      lng: measuredPosition.lng,
      lon: measuredPosition.lng,
      alt: Math.max(0, (target.altitudeM ?? 0) + altitudeErrorM),
    },
    altitudeM: Math.max(0, (target.altitudeM ?? 0) + altitudeErrorM),
    speedKmh: Math.max(0, trueSpeedKmh * (1 + speedErrorFraction)),
    headingDeg: ((target.heading ?? target.velocity?.heading ?? 0) + headingErrorDeg + 360) % 360,
    verticalSpeedMps: target.verticalSpeedMps ?? target.velocity?.verticalSpeedMps ?? 0,
    quality: score,
    positionUncertaintyM,
    altitudeUncertaintyM,
    velocityUncertaintyMps: Math.max(1, trueSpeedKmh / 3.6 * Math.abs(speedErrorFraction)),
    headingUncertaintyDeg: Math.abs(headingErrorDeg) + 0.35,
  };
}

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
  lastDetectionScore: 0,
  lastMeasurement: null,
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
  const detection = calculateRadarDetection({ battery, target });
  const rangeKm = detection.distanceKm;
  const rangeFactor = detection.rangeFactor;
  const altitudeBand = getAltitudeBand(target.altitudeM);
  const altitudeFactor = (radarProfile.altitudeFactors[altitudeBand] ?? 1)
    * detection.clutterFactor;
  const memoryAnchorTime = existingContact?.lastScanTime
    ?? existingTrack?.lastUpdateTime
    ?? Number.NEGATIVE_INFINITY;
  const memoryAgeSec = simulationTime - memoryAnchorTime;
  const contactWentStale = existingContact?.confirmedBefore === true
    && memoryAgeSec > getTrackCoastSeconds(existingContact);
  const reacquisition = (
    contactWentStale || existingTrack?.state === 'LOST'
  ) && memoryAgeSec <= SENSOR_EVIDENCE_CONFIG.reacquisitionMemorySec;
  const knownContact = existingContact?.confirmedBefore === true || existingTrack != null;
  const historyFactor = reacquisition
    ? SENSOR_EVIDENCE_CONFIG.reacquisitionContributionMultiplier
    : (knownContact ? SENSOR_EVIDENCE_CONFIG.knownContactContributionMultiplier : 1);
  const rawPerOpportunity = radarProfile.contributionPerOpportunity
    * detection.detectionScore
    * altitudeFactor
    * historyFactor
    * (radarProfile.trackQualityGain ?? 1);
  const contributionPerOpportunity = Math.min(
    radarProfile.maximumContributionPerOpportunity,
    rawPerOpportunity,
  );

  return {
    contribution: contributionPerOpportunity * normalizedOpportunityCount,
    contributionPerOpportunity,
    opportunityCount: detection.detectable ? normalizedOpportunityCount : 0,
    operational,
    rangeKm,
    rangeFactor,
    altitudeBand,
    altitudeFactor,
    historyFactor,
    reacquisition,
    detection,
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
  const radarProfile = getRadarSensorProfile(battery);
  const calibratedConfidence = {
    classificationConfidence: clamp01(
      confidence.classificationConfidence * (radarProfile.classificationGain ?? 1),
    ),
    identificationConfidence: clamp01(
      confidence.identificationConfidence * (radarProfile.classificationGain ?? 1),
    ),
  };
  const confirmedBefore = contact.confirmedBefore || stage != null;
  const targetProfile = getTargetSensorProfile(target);
  const radarMeasurement = createRadarMeasurement({
    battery,
    target,
    simulationTime,
    sequence: contact.totalOpportunityCount + measurement.opportunityCount,
    detection: measurement.detection,
  });
  const nextContact = {
    ...contact,
    expectedRevisitSec: radarProfile.scanMode === 'MECHANICAL_ROTATION'
      ? (battery.scanRateSec ?? radarProfile.measurementIntervalSec)
      : radarProfile.measurementIntervalSec,
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
    lastDetectionScore: measurement.detection.detectionScore,
    lastMeasurement: radarMeasurement,
    ...calibratedConfidence,
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
      expectedRevisitSec: nextContact.expectedRevisitSec,
      evidence,
      stage,
      ...calibratedConfidence,
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
      measurement: radarMeasurement,
    },
    measurement,
  };
}

export function ageSensorEvidenceContact(contact, simulationTime, deltaTimeSec) {
  const lastActivityTime = contact.lastScanTime ?? contact.createdAt;
  const ageSec = Math.max(0, simulationTime - lastActivityTime);
  if (ageSec <= getEvidenceDecayDelaySeconds(contact)) return contact;

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

/** Pure gameplay source-quality score; no radar type receives a hard-coded priority. */
export function scoreRadarSourceContact(contact, simulationTime) {
  const measurement = contact?.lastMeasurement;
  if (!measurement || contact.lastScanTime == null) return 0;
  const age = Math.max(0, simulationTime - contact.lastScanTime);
  const positionUncertainty = (measurement.positionUncertaintyM ?? 0)
    + age * SENSOR_EVIDENCE_CONFIG.trackPositionUncertaintyGrowthMps;
  const altitudeUncertainty = (measurement.altitudeUncertaintyM ?? 0)
    + age * SENSOR_EVIDENCE_CONFIG.trackAltitudeUncertaintyGrowthMps;
  const velocityUncertainty = (measurement.velocityUncertaintyMps ?? 0)
    + age * SENSOR_EVIDENCE_CONFIG.trackVelocityUncertaintyGrowthMps;
  const expectedRevisitSec = Math.max(0.25, contact.expectedRevisitSec ?? 3);
  const freshnessPenalty = age / expectedRevisitSec;
  return (measurement.quality ?? 0) * (0.58 + 0.42 * clamp01(contact.evidence ?? 0))
    / (1 + positionUncertainty / 320 + altitudeUncertainty / 520
      + velocityUncertainty / 22 + freshnessPenalty * 0.7);
}

/**
 * Fuses retained pair evidence, but emits an observation only when at least one
 * radar really scanned this target at the supplied simulation time.
 */
export function fuseSensorEvidence({ contacts, target, simulationTime, existingTrack = null, activeSourceIds = null }) {
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

  const eligible = targetContacts.filter(contact => contact.lastMeasurement
    && (!activeSourceIds || activeSourceIds.has(contact.sourceBatteryId))
    && simulationTime - contact.lastScanTime <= getTrackCoastSeconds(contact));
  const rankedEligible = eligible.map(contact => ({
    contact,
    score: scoreRadarSourceContact(contact, simulationTime),
  })).sort((first, second) => second.score - first.score
    || first.contact.id.localeCompare(second.contact.id));
  const bestCandidate = rankedEligible[0] ?? null;
  const currentCandidate = rankedEligible.find(candidate => (
    candidate.contact.sourceRadarId === existingTrack?.sourceRadarId
  )) ?? null;
  // Hysteresis prevents near-equal radars alternating ownership on adjacent scans.
  // An offline/stale owner is absent from eligible and therefore cannot block takeover.
  const sourceCandidate = currentCandidate && bestCandidate
    && bestCandidate.contact !== currentCandidate.contact
    && bestCandidate.score < currentCandidate.score * RADAR_SOURCE_TAKEOVER_RATIO
    ? currentCandidate
    : bestCandidate;
  const sourceContact = sourceCandidate?.contact ?? null;
  if (!sourceContact) return null;
  // Retaining a winner is not a new measurement: don't reset age, re-filter the
  // same sample, or fabricate a higher update rate. Engine coasts its estimate.
  if (!currentContacts.includes(sourceContact)) return null;
  const targetProfile = getTargetSensorProfile(target);
  const confidence = getConfidence(evidence, thresholds);
  const contributingSensors = targetContacts
    .filter(contact => contact.confirmedBefore || contact.stage != null)
    .map(contact => contact.sourceRadarId)
    .filter((sensorId, index, sensors) => sensorId && sensors.indexOf(sensorId) === index);
  return {
    targetId: target.id,
    sourceBatteryId: sourceContact.sourceBatteryId,
    sourceRadarId: sourceContact.sourceRadarId,
    expectedRevisitSec: sourceContact.expectedRevisitSec,
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
    contributingSensors,
    bestSensorId: sourceContact.sourceRadarId,
    bestSensorScore: sourceCandidate.score,
    previousSourceScore: currentCandidate?.score ?? null,
    sourceTakeoverRatio: RADAR_SOURCE_TAKEOVER_RATIO,
    lastMeasurementSensorId: sourceContact.sourceRadarId,
    reacquisition: currentContacts.some(contact => contact.lastHistoryFactor > 1.1),
    measurement: sourceContact.lastMeasurement,
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
  activeSourceIds = null,
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
      existingTrack,
      activeSourceIds,
    }),
  };
}

export function isTrackSensorStale(track, simulationTime) {
  if (track?.lastUpdateTime == null) return false;
  return simulationTime - track.lastUpdateTime > getTrackCoastSeconds(track);
}
