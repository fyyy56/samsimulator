import { getBearing, getDistanceKm } from './geo.js';

export const DEFAULT_RADAR_BEAM_WIDTH_DEG = 6;
export const RADAR_SCAN_TYPE = Object.freeze({
  MECHANICAL_ROTATION: 'MECHANICAL_ROTATION',
  SECTOR_MECHANICAL: 'SECTOR_MECHANICAL',
  ELECTRONIC_SECTOR: 'ELECTRONIC_SECTOR',
});

export const ELECTRONIC_PULSE_DURATION_SEC = 0.45;

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
  const radar = battery.components.radar;
  if (!radar) return false;

  const distanceKm = getDistanceKm(
    target.position.lat,
    target.position.lng,
    radar.lat,
    radar.lng,
  );
  if (distanceKm > battery.radarRangeKm) return false;
  if (battery.radarSector >= 360) return true;

  const bearing = getBearing(radar.lat, radar.lng, target.position.lat, target.position.lng);
  return getSectorDifference(bearing, battery.radarHeading) <= battery.radarSector / 2;
}

const countPhaseCrossings = (startPhase, endPhase, crossingOffset) => (
  Math.floor(endPhase - crossingOffset) - Math.floor(startPhase - crossingOffset)
);

const getElectronicScheduleOffset = (targetId) => {
  const numericSequence = Number.parseInt(targetId.match(/\d+/)?.[0] ?? '0', 10);
  return ((numericSequence * 0.2) % 1 + 1) % 1;
};

export function countRadarMeasurements(battery, target) {
  const radar = battery.components.radar;
  const scanState = radar?.scanState;
  if (!radar || !scanState || !isTargetInRadarCoverage(battery, target)) return 0;

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
