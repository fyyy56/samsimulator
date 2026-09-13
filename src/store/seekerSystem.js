import {
  SEEKER_PROFILE_ID,
  SEEKER_STATE,
  SEEKER_TYPE,
  getSeekerProfile,
} from '../data/seekerProfiles.js';
import { getGameplayIrSignature } from '../data/seekerSignatures.js';
import { getBearing, getDestinationPoint, getSlantDistanceKm } from './geo.js';
import { getTargetSensorProfile } from './sensorDetection.js';
import { getWorldPosition } from './worldPosition.js';

export const SEEKER_GUIDANCE_SOURCE = Object.freeze({
  NETWORK_TRACK: 'NETWORK_TRACK',
  OWN_SEEKER: 'OWN_SEEKER',
});

export const SEEKER_TRANSITION_EVENT = Object.freeze({
  SEARCH: 'SEEKER_SEARCH',
  ACQUIRED: 'SEEKER_ACQUIRED',
  LOST: 'SEEKER_LOST',
  REACQUIRED: 'SEEKER_REACQUIRED',
});

const clamp01 = value => Math.max(0, Math.min(1, value));
const normalizeAngleDelta = delta => ((delta + 540) % 360) - 180;

const getElevationDeg = (origin, target) => {
  const horizontalDistanceKm = Math.max(0.0001, getSlantDistanceKm(
    origin, origin.altitudeM, target, origin.altitudeM,
  ));
  return Math.atan2((target.altitudeM - origin.altitudeM) / 1000,
    horizontalDistanceKm) * 180 / Math.PI;
};

const angularSeparationDeg = (azimuthA, elevationA, azimuthB, elevationB) => Math.hypot(
  normalizeAngleDelta(azimuthA - azimuthB) * Math.cos((elevationA + elevationB)
    * 0.5 * Math.PI / 180),
  elevationA - elevationB,
);

const getTargetAspect = (missilePosition, target) => {
  const targetPosition = getWorldPosition(target);
  const bearingFromTargetToMissile = getBearing(targetPosition.lat, targetPosition.lng,
    missilePosition.lat, missilePosition.lng);
  const relativeAngleDeg = Math.abs(normalizeAngleDelta(
    bearingFromTargetToMissile - (target.heading ?? target.velocity?.heading ?? 0),
  ));
  const rearAspectBlend = (1 - Math.cos(relativeAngleDeg * Math.PI / 180)) * 0.5;
  return { relativeAngleDeg, rearAspectBlend };
};

const getSearchLookPosition = (seeker, missile, networkTrack) => (
  networkTrack?.reportedPosition
  ?? seeker?.targetEstimate?.position
  ?? missile?.guidance?.commandPosition
  ?? null
);

/** Assigned-target sensor geometry and signal score. No entity-list search occurs here. */
export function evaluateSeekerAcquisition({ seeker, profile, missile, target,
  networkTrack = null, deltaTimeSec = 0.05 }) {
  const missilePosition = getWorldPosition(missile);
  const targetPosition = getWorldPosition(target);
  const searchLookPosition = getSearchLookPosition(seeker, missile, networkTrack);
  if (!target?.position || !searchLookPosition) return {
    activationReady: false, canSense: false, acquisitionScore: 0,
    distanceKm: Number.POSITIVE_INFINITY, effectiveRangeKm: 0, geometry: null,
  };
  const distanceKm = getSlantDistanceKm(missilePosition, missilePosition.altitudeM,
    targetPosition, targetPosition.altitudeM);
  const trueAzimuthDeg = getBearing(missilePosition.lat, missilePosition.lng,
    targetPosition.lat, targetPosition.lng);
  const trueElevationDeg = getElevationDeg(missilePosition, targetPosition);
  const lookAltitudeM = searchLookPosition.altitudeM ?? searchLookPosition.alt ?? 0;
  const lookPosition = { ...searchLookPosition, altitudeM: lookAltitudeM };
  const lookAzimuthDeg = getBearing(missilePosition.lat, missilePosition.lng,
    lookPosition.lat, lookPosition.lng);
  const lookElevationDeg = getElevationDeg(missilePosition, lookPosition);
  const searchErrorDeg = angularSeparationDeg(trueAzimuthDeg, trueElevationDeg,
    lookAzimuthDeg, lookElevationDeg);
  const boresightErrorDeg = angularSeparationDeg(trueAzimuthDeg, trueElevationDeg,
    missile.heading ?? 0, missile.flightPathAngleDeg ?? 0);
  const previousGeometry = seeker?.geometry;
  const losRateDegSec = previousGeometry && deltaTimeSec > 0
    ? angularSeparationDeg(trueAzimuthDeg, trueElevationDeg,
      previousGeometry.trueAzimuthDeg, previousGeometry.trueElevationDeg) / deltaTimeSec
    : 0;
  const insideHardRange = distanceKm <= profile.hardMaxLockRangeKm;
  const insideFov = searchErrorDeg <= profile.fovDeg * 0.5;
  const insideGimbal = boresightErrorDeg <= profile.gimbalLimitDeg;
  const trackable = losRateDegSec <= profile.trackRateDegSec;
  const aspect = getTargetAspect(missilePosition, target);
  let signature = 0;
  let signatureFactor = 0;
  let aspectFactor = 1;
  let effectiveRangeKm = profile.baselineLockRangeKm;
  if (profile.seekerType === SEEKER_TYPE.IR) {
    signature = getGameplayIrSignature(target);
    signatureFactor = Math.max(0.3, Math.min(1.25,
      0.42 + signature * 0.72 * profile.signatureSensitivity));
    aspectFactor = 0.52 + aspect.rearAspectBlend * 0.48 * profile.aspectSensitivity;
    const aspectRangeKm = profile.baselineLockRangeKm
      + ((profile.baselineRearLockRangeKm ?? profile.baselineLockRangeKm)
        - profile.baselineLockRangeKm) * aspect.rearAspectBlend;
    effectiveRangeKm = Math.min(profile.hardMaxLockRangeKm,
      aspectRangeKm * signatureFactor);
  } else if (profile.seekerType === SEEKER_TYPE.ACTIVE_RADAR) {
    signature = getTargetSensorProfile(target).radarSignature;
    signatureFactor = Math.max(0.3, Math.min(1.2,
      0.48 + signature * 0.68 * profile.signatureSensitivity));
    aspectFactor = 0.88 + aspect.rearAspectBlend * 0.12 * profile.aspectSensitivity;
    effectiveRangeKm = Math.min(profile.hardMaxLockRangeKm,
      profile.baselineLockRangeKm * signatureFactor);
  }
  const rangeFactor = insideHardRange
    ? clamp01(1.32 - distanceKm / Math.max(effectiveRangeKm, 0.1))
    : 0;
  const fieldFactor = insideFov ? 1 - 0.35 * clamp01(
    searchErrorDeg / Math.max(profile.fovDeg * 0.5, 0.1),
  ) : 0;
  const gimbalFactor = insideGimbal ? 1 - 0.25 * clamp01(
    boresightErrorDeg / Math.max(profile.gimbalLimitDeg, 0.1),
  ) : 0;
  const trackRateFactor = trackable ? 1 - 0.35 * clamp01(
    losRateDegSec / Math.max(profile.trackRateDegSec, 0.1),
  ) : 0;
  const acquisitionScore = clamp01(rangeFactor * signatureFactor * aspectFactor
    * fieldFactor * gimbalFactor * trackRateFactor);
  const activationReady = distanceKm <= profile.seekerActivationRangeKm;
  const canSense = activationReady && insideHardRange && insideFov && insideGimbal
    && trackable && acquisitionScore > 0.025;
  return {
    activationReady,
    canSense,
    acquisitionScore,
    distanceKm,
    effectiveRangeKm,
    signature,
    signatureFactor,
    aspectFactor,
    rangeFactor,
    geometry: {
      trueAzimuthDeg,
      trueElevationDeg,
      lookAzimuthDeg,
      lookElevationDeg,
      searchErrorDeg,
      boresightErrorDeg,
      losRateDegSec,
      insideHardRange,
      insideFov,
      insideGimbal,
      trackable,
      rearAspectBlend: aspect.rearAspectBlend,
      relativeAspectDeg: aspect.relativeAngleDeg,
    },
  };
}

export function advanceMissileSeekerSensing({ seeker, profile = getSeekerProfile(seeker.profileId),
  missile, target, networkTrack = null, simulationTime, deltaTimeSec, enabled = true }) {
  const acquisition = evaluateSeekerAcquisition({ seeker, profile, missile, target,
    networkTrack, deltaTimeSec });
  return advanceSeekerState({ seeker, profile, simulationTime, deltaTimeSec, enabled,
    ...acquisition });
}

const deterministicPhase = (key) => {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295 * Math.PI * 2;
};

const offsetPosition = (position, headingDeg, alongM, crossM) => {
  const along = getDestinationPoint(position.lat, position.lng, headingDeg, alongM / 1000);
  return getDestinationPoint(along.lat, along.lng, headingDeg + 90, crossM / 1000);
};

const getTargetMotion = target => ({
  speedKmh: target.ballisticPhysics?.horizontalSpeedMps != null
    ? target.ballisticPhysics.horizontalSpeedMps * 3.6
    : (target.speedKmh ?? target.velocity?.speedKmh ?? 0),
  headingDeg: target.heading ?? target.velocity?.heading ?? 0,
  verticalSpeedMps: target.verticalSpeedMps ?? target.velocity?.verticalSpeedMps ?? 0,
});

/** Truth is consumed only here to produce an imperfect deterministic seeker measurement. */
export function createSeekerMeasurement({ missile, target, profile, acquisition,
  simulationTime }) {
  if (!acquisition?.canSense) return null;
  const targetPosition = getWorldPosition(target);
  const targetMotion = getTargetMotion(target);
  const quality = Math.max(0.35, Math.min(0.98,
    0.52 + acquisition.acquisitionScore * 0.46));
  const positionUncertaintyM = Math.max(6, Math.min(90,
    (5 + acquisition.distanceKm * 2.4) / Math.max(quality, 0.25)));
  const altitudeUncertaintyM = Math.max(5, positionUncertaintyM * 0.72);
  const velocityUncertaintyMps = Math.max(0.6,
    0.65 + acquisition.distanceKm * 0.075 / Math.max(quality, 0.25));
  const headingUncertaintyDeg = Math.max(0.18,
    0.18 + acquisition.distanceKm * 0.028 / Math.max(quality, 0.25));
  const phase = deterministicPhase(`${missile.id}:${target.id}:${profile.id}`);
  // Smooth deterministic bias prevents artificial white-noise jitter while still
  // keeping the sensor estimate imperfect and repeatable.
  const alongErrorM = Math.sin(simulationTime * 0.73 + phase)
    * positionUncertaintyM * 0.58;
  const crossErrorM = Math.cos(simulationTime * 0.51 + phase * 1.37)
    * positionUncertaintyM * 0.52;
  const altitudeErrorM = Math.sin(simulationTime * 0.43 + phase * 0.71)
    * altitudeUncertaintyM * 0.5;
  const measuredPosition = offsetPosition(targetPosition, targetMotion.headingDeg,
    alongErrorM, crossErrorM);
  const headingErrorDeg = Math.sin(simulationTime * 0.61 + phase * 1.11)
    * headingUncertaintyDeg * 0.55;
  const speedErrorMps = Math.cos(simulationTime * 0.47 + phase * 0.83)
    * velocityUncertaintyMps * 0.55;
  return {
    timestamp: simulationTime,
    sensorId: `${missile.id}-SEEKER`,
    targetId: target.id,
    position: {
      lat: measuredPosition.lat,
      lng: measuredPosition.lng,
      lon: measuredPosition.lng,
      alt: Math.max(0, targetPosition.altitudeM + altitudeErrorM),
    },
    altitudeM: Math.max(0, targetPosition.altitudeM + altitudeErrorM),
    speedKmh: Math.max(0, targetMotion.speedKmh + speedErrorMps * 3.6),
    headingDeg: (targetMotion.headingDeg + headingErrorDeg + 360) % 360,
    verticalSpeedMps: targetMotion.verticalSpeedMps,
    quality,
    positionUncertaintyM,
    altitudeUncertaintyM,
    velocityUncertaintyMps,
    headingUncertaintyDeg,
  };
}

const seedSeekerEstimate = (networkTrack, missile, simulationTime) => {
  const source = networkTrack?.reportedPosition ? networkTrack : missile?.guidance;
  if (!source?.reportedPosition) return null;
  const altitudeM = source.reportedAltitudeM ?? source.reportedPosition.alt ?? 0;
  return {
    position: {
      lat: source.reportedPosition.lat,
      lng: source.reportedPosition.lng,
      lon: source.reportedPosition.lng,
      alt: altitudeM,
    },
    altitudeM,
    speedKmh: source.reportedHorizontalSpeedKmh ?? source.reportedSpeedKmh ?? 0,
    heading: source.reportedHeading ?? 0,
    verticalSpeedMps: source.reportedVerticalSpeedMps ?? 0,
    quality: source.trackQuality ?? 0.45,
    timestamp: simulationTime,
    updateAgeSec: 0,
    positionUncertaintyM: source.positionUncertaintyM ?? 250,
    altitudeUncertaintyM: source.altitudeUncertaintyM ?? 180,
    velocityUncertaintyMps: source.velocityUncertaintyMps ?? 12,
    headingUncertaintyDeg: source.headingUncertaintyDeg ?? 4,
    seededFrom: networkTrack?.reportedPosition ? SEEKER_GUIDANCE_SOURCE.NETWORK_TRACK : 'GUIDANCE_MEMORY',
  };
};

const propagateSeekerTargetEstimate = (estimate, simulationTime) => {
  if (!estimate) return null;
  const deltaTimeSec = Math.max(0, simulationTime - estimate.timestamp);
  if (deltaTimeSec <= 0) return { ...estimate, updateAgeSec: 0 };
  const projected = getDestinationPoint(estimate.position.lat, estimate.position.lng,
    estimate.heading, estimate.speedKmh * deltaTimeSec / 3600);
  const altitudeM = Math.max(0, estimate.altitudeM
    + estimate.verticalSpeedMps * deltaTimeSec);
  return {
    ...estimate,
    position: { lat: projected.lat, lng: projected.lng, lon: projected.lng, alt: altitudeM },
    altitudeM,
    timestamp: simulationTime,
    updateAgeSec: (estimate.updateAgeSec ?? 0) + deltaTimeSec,
    positionUncertaintyM: estimate.positionUncertaintyM + 8 * deltaTimeSec,
    altitudeUncertaintyM: estimate.altitudeUncertaintyM + 4 * deltaTimeSec,
    velocityUncertaintyMps: estimate.velocityUncertaintyMps + 0.55 * deltaTimeSec,
    headingUncertaintyDeg: estimate.headingUncertaintyDeg + 0.22 * deltaTimeSec,
  };
};

const combineUncertainty = (prior, measurement, floor) => Math.max(floor,
  1 / Math.sqrt(1 / Math.max(prior, floor) ** 2
    + 1 / Math.max(measurement, floor) ** 2));

export function updateSeekerTargetEstimate({ previousEstimate = null, networkTrack = null,
  missile, measurement, simulationTime }) {
  const seed = previousEstimate
    ? propagateSeekerTargetEstimate(previousEstimate, simulationTime)
    : seedSeekerEstimate(networkTrack, missile, simulationTime);
  if (!seed) {
    return {
      position: { ...measurement.position }, altitudeM: measurement.altitudeM,
      speedKmh: measurement.speedKmh, heading: measurement.headingDeg,
      verticalSpeedMps: measurement.verticalSpeedMps,
      quality: measurement.quality, timestamp: simulationTime, updateAgeSec: 0,
      positionUncertaintyM: measurement.positionUncertaintyM,
      altitudeUncertaintyM: measurement.altitudeUncertaintyM,
      velocityUncertaintyMps: measurement.velocityUncertaintyMps,
      headingUncertaintyDeg: measurement.headingUncertaintyDeg,
      seededFrom: 'SEEKER_MEASUREMENT',
    };
  }
  const firstOwnMeasurement = !previousEstimate;
  const positionGain = firstOwnMeasurement
    ? 0.32 : 0.42 + measurement.quality * 0.28;
  const velocityGain = firstOwnMeasurement
    ? 0.34 : 0.36 + measurement.quality * 0.22;
  const altitudeM = seed.altitudeM
    + (measurement.altitudeM - seed.altitudeM) * positionGain;
  return {
    position: {
      lat: seed.position.lat + (measurement.position.lat - seed.position.lat) * positionGain,
      lng: seed.position.lng + (measurement.position.lng - seed.position.lng) * positionGain,
      lon: seed.position.lng + (measurement.position.lng - seed.position.lng) * positionGain,
      alt: altitudeM,
    },
    altitudeM,
    speedKmh: seed.speedKmh + (measurement.speedKmh - seed.speedKmh) * velocityGain,
    heading: (seed.heading + normalizeAngleDelta(measurement.headingDeg - seed.heading)
      * velocityGain + 360) % 360,
    verticalSpeedMps: seed.verticalSpeedMps
      + (measurement.verticalSpeedMps - seed.verticalSpeedMps) * velocityGain,
    quality: Math.min(0.99, seed.quality + (measurement.quality - seed.quality) * 0.55),
    timestamp: simulationTime,
    updateAgeSec: 0,
    positionUncertaintyM: combineUncertainty(seed.positionUncertaintyM,
      measurement.positionUncertaintyM, 4),
    altitudeUncertaintyM: combineUncertainty(seed.altitudeUncertaintyM,
      measurement.altitudeUncertaintyM, 4),
    velocityUncertaintyMps: combineUncertainty(seed.velocityUncertaintyMps,
      measurement.velocityUncertaintyMps, 0.35),
    headingUncertaintyDeg: combineUncertainty(seed.headingUncertaintyDeg,
      measurement.headingUncertaintyDeg, 0.12),
    seededFrom: seed.seededFrom,
  };
}

export function advanceMissileSeeker({ seeker, missile, target, networkTrack = null,
  simulationTime, deltaTimeSec, enabled = true }) {
  const profile = getSeekerProfile(seeker.profileId);
  const sensed = evaluateSeekerAcquisition({ seeker, profile, missile, target,
    networkTrack, deltaTimeSec });
  let next = advanceSeekerState({ seeker, profile, simulationTime, deltaTimeSec,
    enabled, ...sensed });
  next.enabled = enabled;
  let targetEstimate = seeker.targetEstimate;
  const hasOwnMeasurement = sensed.canSense
    && [SEEKER_STATE.ACQUIRED, SEEKER_STATE.TERMINAL].includes(next.state)
    && (seeker.lastSeekerMeasurementTime == null
      || simulationTime - seeker.lastSeekerMeasurementTime + 1e-9
        >= profile.seekerMeasurementIntervalSec);
  if (hasOwnMeasurement) {
    const measurement = createSeekerMeasurement({ missile, target, profile,
      acquisition: sensed, simulationTime });
    targetEstimate = updateSeekerTargetEstimate({ previousEstimate: targetEstimate,
      networkTrack, missile, measurement, simulationTime });
    next.lastSeekerMeasurementTime = simulationTime;
    next.lastSeekerMeasurement = measurement;
  } else if (targetEstimate) {
    targetEstimate = propagateSeekerTargetEstimate(targetEstimate, simulationTime);
  }
  const networkAvailable = networkTrack && networkTrack.state !== 'LOST';
  if ([SEEKER_STATE.ACQUIRED, SEEKER_STATE.TERMINAL].includes(next.state)) {
    next.guidanceSource = SEEKER_GUIDANCE_SOURCE.OWN_SEEKER;
  } else if (next.state === SEEKER_STATE.LOST && targetEstimate && !networkAvailable
    && simulationTime - (next.lostAt ?? simulationTime) <= profile.breakLockMemorySec) {
    next.guidanceSource = SEEKER_GUIDANCE_SOURCE.OWN_SEEKER;
  } else {
    next.guidanceSource = SEEKER_GUIDANCE_SOURCE.NETWORK_TRACK;
  }
  next.targetEstimate = targetEstimate;
  return next;
}

export function getSeekerGuidanceTrack(seeker, networkTrack) {
  if (seeker?.guidanceSource !== SEEKER_GUIDANCE_SOURCE.OWN_SEEKER
    || !seeker.targetEstimate) return networkTrack;
  const estimate = seeker.targetEstimate;
  return {
    id: networkTrack?.id ?? `SEEKER-${seeker.profileId}`,
    targetId: networkTrack?.targetId ?? seeker.lastSeekerMeasurement?.targetId,
    state: 'TRACKED',
    reportedPosition: { ...estimate.position },
    reportedAltitudeM: estimate.altitudeM,
    reportedSpeedKmh: estimate.speedKmh,
    reportedHorizontalSpeedKmh: estimate.speedKmh,
    reportedHeading: estimate.heading,
    reportedVerticalSpeedMps: estimate.verticalSpeedMps,
    estimatedTurnRateDegPerSec: 0,
    trackQuality: estimate.quality,
    lastUpdateTime: estimate.timestamp,
    lastMeasurementTime: estimate.timestamp,
    positionUncertaintyM: estimate.positionUncertaintyM,
    altitudeUncertaintyM: estimate.altitudeUncertaintyM,
    velocityUncertaintyMps: estimate.velocityUncertaintyMps,
    headingUncertaintyDeg: estimate.headingUncertaintyDeg,
    sourceRadarId: `${seeker.profileId}:OWN_SEEKER`,
    sourceBatteryId: null,
    guidanceSource: SEEKER_GUIDANCE_SOURCE.OWN_SEEKER,
  };
}

export function createMissileSeeker(profileId = SEEKER_PROFILE_ID.NONE, simulationTime = 0) {
  const profile = getSeekerProfile(profileId);
  return {
    profileId: profile.id,
    seekerType: profile.seekerType,
    enabled: true,
    state: SEEKER_STATE.OFF,
    stateEnteredAt: simulationTime,
    lastUpdateTime: simulationTime,
    evidence: 0,
    acquisitionScore: 0,
    effectiveRangeKm: 0,
    distanceKm: Number.POSITIVE_INFINITY,
    guidanceSource: SEEKER_GUIDANCE_SOURCE.NETWORK_TRACK,
    searchStartedAt: null,
    acquiredAt: null,
    lostAt: null,
    badConditionSince: null,
    hasAcquiredBefore: false,
    reacquisitionCount: 0,
    targetEstimate: null,
    geometry: null,
    transition: null,
  };
}

const transitionTo = (seeker, state, simulationTime, eventType = null) => ({
  ...seeker,
  state,
  stateEnteredAt: simulationTime,
  transition: eventType ? {
    type: eventType,
    fromState: seeker.state,
    toState: state,
    simulationTime,
  } : null,
});

/**
 * Generic deterministic state machine. Sensor-specific scoring and measurement
 * generation are deliberately supplied as inputs by the seeker sensor model.
 */
export function advanceSeekerState({ seeker, profile = getSeekerProfile(seeker.profileId),
  simulationTime, deltaTimeSec, enabled = true, activationReady = false,
  canSense = false, acquisitionScore = 0, distanceKm = Number.POSITIVE_INFINITY,
  effectiveRangeKm = 0, geometry = null }) {
  if (!enabled || profile.seekerType === SEEKER_TYPE.NONE) {
    return {
      ...seeker,
      state: SEEKER_STATE.OFF,
      stateEnteredAt: seeker.state === SEEKER_STATE.OFF
        ? seeker.stateEnteredAt : simulationTime,
      lastUpdateTime: simulationTime,
      evidence: 0,
      acquisitionScore: 0,
      guidanceSource: SEEKER_GUIDANCE_SOURCE.NETWORK_TRACK,
      transition: null,
    };
  }

  let next = {
    ...seeker,
    lastUpdateTime: simulationTime,
    acquisitionScore: clamp01(acquisitionScore),
    distanceKm,
    effectiveRangeKm,
    geometry,
    transition: null,
  };
  if (next.state === SEEKER_STATE.OFF) {
    if (!activationReady) return next;
    next = transitionTo(next, SEEKER_STATE.WARMUP, simulationTime);
  }
  if (next.state === SEEKER_STATE.WARMUP) {
    if (!activationReady) return transitionTo(next, SEEKER_STATE.OFF, simulationTime);
    if (simulationTime - next.stateEnteredAt + 1e-9 < profile.warmupSec) return next;
    next = transitionTo({ ...next, searchStartedAt: simulationTime }, SEEKER_STATE.SEARCH,
      simulationTime, SEEKER_TRANSITION_EVENT.SEARCH);
  }

  const gainingEvidence = canSense && next.acquisitionScore > 0;
  if (next.state === SEEKER_STATE.SEARCH || next.state === SEEKER_STATE.LOST) {
    const evidenceRate = next.state === SEEKER_STATE.LOST
      ? profile.reacquisitionEvidenceRate : profile.acquisitionEvidenceRate;
    next.evidence = clamp01(next.evidence + (gainingEvidence
      ? evidenceRate * next.acquisitionScore * deltaTimeSec
      : -profile.lossEvidenceRate * deltaTimeSec));
    const searchAgeSec = simulationTime - (next.searchStartedAt ?? next.stateEnteredAt);
    if (next.evidence >= profile.acquisitionThreshold) {
      const reacquired = next.hasAcquiredBefore;
      next = transitionTo({
        ...next,
        acquiredAt: simulationTime,
        lostAt: null,
        badConditionSince: null,
        hasAcquiredBefore: true,
        reacquisitionCount: next.reacquisitionCount + (reacquired ? 1 : 0),
      }, SEEKER_STATE.ACQUIRED, simulationTime,
      reacquired ? SEEKER_TRANSITION_EVENT.REACQUIRED : SEEKER_TRANSITION_EVENT.ACQUIRED);
    } else if (next.state === SEEKER_STATE.SEARCH
      && searchAgeSec >= profile.searchDurationSec) {
      next = transitionTo({ ...next, lostAt: simulationTime }, SEEKER_STATE.LOST,
        simulationTime, SEEKER_TRANSITION_EVENT.LOST);
    }
    return next;
  }

  if (next.state === SEEKER_STATE.ACQUIRED || next.state === SEEKER_STATE.TERMINAL) {
    next.evidence = clamp01(next.evidence + (gainingEvidence
      ? profile.acquisitionEvidenceRate * next.acquisitionScore * deltaTimeSec * 0.55
      : -profile.lossEvidenceRate * deltaTimeSec));
    next.badConditionSince = gainingEvidence ? null
      : (next.badConditionSince ?? simulationTime);
    const badConditionAgeSec = next.badConditionSince == null
      ? 0 : simulationTime - next.badConditionSince;
    if (next.evidence <= profile.lostThreshold
      && badConditionAgeSec >= profile.breakLockMemorySec) {
      return transitionTo({
        ...next,
        lostAt: simulationTime,
        guidanceSource: SEEKER_GUIDANCE_SOURCE.OWN_SEEKER,
      }, SEEKER_STATE.LOST, simulationTime, SEEKER_TRANSITION_EVENT.LOST);
    }
    next.guidanceSource = SEEKER_GUIDANCE_SOURCE.OWN_SEEKER;
    if (next.state === SEEKER_STATE.ACQUIRED
      && simulationTime - next.stateEnteredAt >= profile.terminalConfirmationSec) {
      next = transitionTo(next, SEEKER_STATE.TERMINAL, simulationTime);
    }
  }
  return next;
}
