import { getBearing, getDistanceKm } from './geo.js';
import { SENSOR_PHYSICS_CONFIG } from '../data/sensorDetectionProfiles.js';

export const DEFAULT_RADAR_BEAM_WIDTH_DEG = 6;
export const RADAR_SCAN_TYPE = Object.freeze({
  MECHANICAL_ROTATION: 'MECHANICAL_ROTATION',
  SECTOR_MECHANICAL: 'SECTOR_MECHANICAL',
  ELECTRONIC_SECTOR: 'ELECTRONIC_SECTOR',
});

export const ELECTRONIC_PULSE_DURATION_SEC = 0.45;
const NETWORK_HANDOFF_RANGE_ADVANTAGE = 0.18;

const normalizeDegrees = angle => ((angle % 360) + 360) % 360;

const getSectorDifference = (bearing, heading) => {
  const difference = Math.abs(normalizeDegrees(bearing) - normalizeDegrees(heading));
  return difference > 180 ? 360 - difference : difference;
};

export function getRadarAzimuthAtPhase(traversalPhase, sector, heading) {
  if (sector >= 360) return normalizeDegrees(traversalPhase * 360);

  const cyclePhase = traversalPhase - Math.floor(traversalPhase);
  const outbound = cyclePhase <= 0.5;
  const sectorProgress = outbound ? cyclePhase * 2 : (1 - cyclePhase) * 2;
  return normalizeDegrees(heading - sector / 2 + sector * sectorProgress);
}

export function getRadarDirectionAtPhase(traversalPhase, sector) {
  if (sector >= 360) return 1;
  const cyclePhase = traversalPhase - Math.floor(traversalPhase);
  return cyclePhase <= 0.5 ? 1 : -1;
}

export function createRadarScanState({
  sector,
  heading,
  scanPeriodSec,
  beamWidthDeg = DEFAULT_RADAR_BEAM_WIDTH_DEG,
  scanType = sector >= 360
    ? RADAR_SCAN_TYPE.MECHANICAL_ROTATION
    : RADAR_SCAN_TYPE.SECTOR_MECHANICAL,
}) {
  return {
    previousTraversalPhase: 0,
    traversalPhase: 0,
    currentAzimuth: getRadarAzimuthAtPhase(0, sector, heading),
    direction: getRadarDirectionAtPhase(0, sector),
    scanPeriodSec,
    beamWidthDeg,
    scanType,
    electronicPulses: [],
  };
}

export function advanceRadarScan(scanState, deltaTimeSec, sector, heading) {
  const previousTraversalPhase = scanState.traversalPhase;
  const traversalPhase = previousTraversalPhase + deltaTimeSec / scanState.scanPeriodSec;
  return {
    ...scanState,
    previousTraversalPhase,
    traversalPhase,
    currentAzimuth: getRadarAzimuthAtPhase(traversalPhase, sector, heading),
    direction: getRadarDirectionAtPhase(traversalPhase, sector),
  };
}

export function isTargetInRadarCoverage(battery, target) {
  return getRadarGeometry(battery, target).insideNominalCoverage;
}

export function calculateRadioHorizonKm(radarHeightM, targetHeightM) {
  const radarHeight = Math.max(0, radarHeightM ?? SENSOR_PHYSICS_CONFIG.defaultRadarHeightM);
  const targetHeight = Math.max(0, targetHeightM ?? 0);
  return SENSOR_PHYSICS_CONFIG.radioHorizonCoefficient
    * (Math.sqrt(radarHeight) + Math.sqrt(targetHeight));
}

export function getRadarGeometry(battery, target, radarProfile = null) {
  const radar = battery.components.radar;
  if (!radar || !target?.position) return {
    insideNominalCoverage: false,
    insideSector: false,
    hasLineOfSight: false,
    distanceKm: Number.POSITIVE_INFINITY,
    radioHorizonKm: 0,
    bearingDeg: 0,
  };

  const distanceKm = getDistanceKm(
    target.position.lat,
    target.position.lng,
    radar.lat,
    radar.lng,
  );
  const bearing = getBearing(radar.lat, radar.lng, target.position.lat, target.position.lng);
  const insideSector = battery.radarSector >= 360
    || getSectorDifference(bearing, battery.radarHeading) <= battery.radarSector / 2 + 1e-6;
  const radarHeightM = radar.antennaHeightM
    ?? radarProfile?.antennaHeightM
    ?? SENSOR_PHYSICS_CONFIG.defaultRadarHeightM;
  const targetHeightM = target.altitudeM ?? target.position.altitudeM ?? target.position.alt ?? 0;
  const radioHorizonKm = calculateRadioHorizonKm(radarHeightM, targetHeightM);
  return {
    insideNominalCoverage: distanceKm <= battery.radarRangeKm && insideSector,
    insideSector,
    hasLineOfSight: distanceKm <= radioHorizonKm,
    distanceKm,
    radioHorizonKm,
    bearingDeg: bearing,
    radarHeightM,
    targetHeightM,
  };
}

const countPhaseCrossings = (startPhase, endPhase, crossingOffset) => (
  Math.floor(endPhase - crossingOffset) - Math.floor(startPhase - crossingOffset)
);

const getElectronicScheduleOffset = (targetId) => {
  const numericSequence = Number.parseInt(targetId.match(/\d+/)?.[0] ?? '0', 10);
  return ((numericSequence * 0.2) % 1 + 1) % 1;
};

export function countRadarMeasurements(battery, target, radarProfile = null) {
  const radar = battery.components.radar;
  const scanState = radar?.scanState;
  const geometry = getRadarGeometry(battery, target, radarProfile);
  if (!radar || !scanState || !geometry.insideNominalCoverage || !geometry.hasLineOfSight) return 0;

  const bearing = getBearing(radar.lat, radar.lng, target.position.lat, target.position.lng);
  const halfBeamWidth = scanState.beamWidthDeg / 2;
  const startPhase = scanState.previousTraversalPhase;
  const endPhase = scanState.traversalPhase;

  if (scanState.scanType === RADAR_SCAN_TYPE.ELECTRONIC_SECTOR) {
    return countPhaseCrossings(
      startPhase,
      endPhase,
      getElectronicScheduleOffset(target.id),
    );
  }

  if (battery.radarSector >= 360) {
    const beamEntryPhase = normalizeDegrees(bearing - halfBeamWidth) / 360;
    return countPhaseCrossings(startPhase, endPhase, beamEntryPhase);
  }

  const sectorStart = normalizeDegrees(battery.radarHeading - battery.radarSector / 2);
  const relativeBearing = normalizeDegrees(bearing - sectorStart);
  const outboundEntry = Math.max(0, relativeBearing - halfBeamWidth)
    / battery.radarSector / 2;
  const inboundEntry = 1 - Math.min(battery.radarSector, relativeBearing + halfBeamWidth)
    / battery.radarSector / 2;
  const entryPhases = new Set([outboundEntry, inboundEntry]);

  return [...entryPhases].reduce((count, entryPhase) => (
    count + countPhaseCrossings(startPhase, endPhase, entryPhase)
  ), 0);
}

export function getNetworkRadarScanOpportunities(batteries, target, getProfile = null) {
  return batteries.flatMap(battery => {
    const radarProfile = getProfile?.(battery) ?? null;
    const opportunityCount = countRadarMeasurements(battery, target, radarProfile);
    if (opportunityCount <= 0) return [];
    const geometry = getRadarGeometry(battery, target, radarProfile);
    return [{
      battery,
      opportunityCount,
      geometry,
      score: opportunityCount * 10
        + (battery.radarScanType === RADAR_SCAN_TYPE.ELECTRONIC_SECTOR ? 4 : 0)
        + (1 - geometry.distanceKm / Math.max(1, battery.radarRangeKm)),
    }];
  }).sort((first, second) => second.score - first.score
    || first.battery.id.localeCompare(second.battery.id))
    .slice(0, SENSOR_PHYSICS_CONFIG.maximumFusedSensors);
}

/**
 * Selects one radar as the network measurement owner for a target. Once a
 * Track has a valid source, other radars consume the shared C2 Track instead
 * of maintaining duplicate Radar–Target evidence contacts.
 */
export function selectNetworkRadarScanOpportunity(
  batteries,
  target,
  preferredSourceBatteryId = null,
) {
  const preferredBattery = preferredSourceBatteryId
    ? batteries.find(battery => battery.id === preferredSourceBatteryId)
    : null;
  // The fused-candidate list is intentionally capped for performance. Check
  // the current Track owner before applying that cap; otherwise a healthy
  // fourth radar can disappear from the candidate list and force an invalid
  // handoff/null measurement every sweep.
  if (preferredBattery && getRadarGeometry(preferredBattery, target).hasLineOfSight
    && isTargetInRadarCoverage(preferredBattery, target)) {
    const preferredOpportunityCount = countRadarMeasurements(preferredBattery, target);
    if (preferredOpportunityCount > 0) {
      return { battery: preferredBattery, opportunityCount: preferredOpportunityCount };
    }
  }
  const candidates = getNetworkRadarScanOpportunities(batteries, target).map(candidate => ({
    ...candidate,
    normalizedRange: candidate.geometry.distanceKm / Math.max(1, candidate.battery.radarRangeKm),
  }));
  const selectedOpportunity = candidates.sort((first, second) => (
    second.score - first.score || first.battery.id.localeCompare(second.battery.id)
  ))[0] ?? null;

  if (preferredBattery && getRadarGeometry(preferredBattery, target).hasLineOfSight
    && isTargetInRadarCoverage(preferredBattery, target)) {
    if (!selectedOpportunity) return null;
    const preferredRadar = preferredBattery.components.radar;
    const preferredDistanceKm = getDistanceKm(
      preferredRadar.lat,
      preferredRadar.lng,
      target.position.lat,
      target.position.lng,
    );
    const preferredNormalizedRange = preferredDistanceKm
      / Math.max(1, preferredBattery.radarRangeKm);
    if (
      selectedOpportunity.normalizedRange + NETWORK_HANDOFF_RANGE_ADVANTAGE
      >= preferredNormalizedRange
    ) return null;
  }

  if (!selectedOpportunity) return null;
  return {
    battery: selectedOpportunity.battery,
    opportunityCount: selectedOpportunity.opportunityCount,
  };
}
