import {
  getAirTargetGameplayProfile,
  getAltitudeBand,
  ROUTE_PATTERN,
  SIMPLE_TARGET_TYPE,
} from '../data/airTargetProfiles.js';
import { LIGHT_TARGET_MODEL } from '../data/lightTargetModels.js';
import {
  createGroupMemberRoute,
  createLogicalRoute,
} from './routeGenerator.js';
import { ISKANDER_GAMEPLAY_PROFILE } from './simpleBallisticProfile.js';
import { getTheaterObject } from '../data/theaterObjects.js';

export { SIMPLE_TARGET_TYPE } from '../data/airTargetProfiles.js';
export { THEATER_OBJECTS } from '../data/theaterObjects.js';

const createSeededRandom = (seed) => {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
};

const between = (random, min, max) => min + (max - min) * random();
const integerBetween = (random, min, max) => Math.floor(between(random, min, max + 1));
const pick = (random, values) => values[Math.floor(random() * values.length)];

const THREAT_ORIGINS = Object.freeze([
  { id: 'BLACK_SEA_WEST', position: { lat: 43.65, lng: 30.2 }, preferred: ['ODESA_PORT', 'CHORNOMORSK_PORT', 'MYKOLAIV_PORT', 'VINNYTSIA'] },
  { id: 'BLACK_SEA_EAST', position: { lat: 44.05, lng: 36.4 }, preferred: ['MYKOLAIV_PORT', 'DNIPRO', 'ODESA_PORT', 'KREMENCHUK'] },
  { id: 'EAST', position: { lat: 49.3, lng: 40.2 }, preferred: ['KHARKIV', 'DNIPRO', 'KREMENCHUK', 'KYIV'] },
  { id: 'NORTH_EAST', position: { lat: 52.25, lng: 39.2 }, preferred: ['KYIV', 'MYRHOROD', 'KHARKIV', 'STAROKOSTIANTYNIV'] },
]);

const getObjective = objectiveId => (
  getTheaterObject(objectiveId)
);

const altitudeFromRange = (random, range) => integerBetween(random, range[0], range[1]);

const createAltitudeProfile = ({ type, gameplayProfile, random, requestedAltitudeM }) => {
  if (type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE || !gameplayProfile.altitudeProfile) {
    return {
      altitudeM: 250,
      targetAltitudeM: 250,
      verticalSpeedMps: 0,
      altitudeBand: getAltitudeBand(250),
      altitudeProfile: null,
    };
  }

  const profile = gameplayProfile.altitudeProfile;
  const cruiseAltitudeM = Number.isFinite(requestedAltitudeM)
    ? Math.max(20, Math.round(requestedAltitudeM + between(random, -12, 12)))
    : altitudeFromRange(random, profile.cruiseRangeM);
  const startAltitudeM = Number.isFinite(requestedAltitudeM)
    ? Math.max(20, Math.round(cruiseAltitudeM + between(random, -18, 18)))
    : altitudeFromRange(random, profile.startRangeM);
  const terminalAltitudeM = Number.isFinite(requestedAltitudeM)
    ? Math.max(20, Math.round(cruiseAltitudeM * between(random, 0.76, 0.94)))
    : altitudeFromRange(random, profile.terminalRangeM);

  return {
    altitudeM: startAltitudeM,
    targetAltitudeM: cruiseAltitudeM,
    verticalSpeedMps: 0,
    altitudeBand: getAltitudeBand(startAltitudeM),
    altitudeProfile: {
      startAltitudeM,
      cruiseAltitudeM,
      terminalAltitudeM,
      maximumVerticalSpeedMps: profile.maximumVerticalSpeedMps,
      cruiseTransitionEndProgress: profile.cruiseTransitionEndProgress,
      terminalTransitionStartProgress: profile.terminalTransitionStartProgress,
    },
  };
};

const createSharedRoutePlan = ({
  type,
  count,
  startPosition,
  destination,
  gameplayProfile,
  random,
}) => {
  if (type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE) {
    return {
      routeType: ROUTE_PATTERN.BALLISTIC,
      baseRouteType: ROUTE_PATTERN.BALLISTIC,
      route: [{ ...destination, routeProgress: 1 }],
      corridor: null,
    };
  }

  const baseRouteType = pick(random, gameplayProfile.routePatterns);
  const logicalRoute = createLogicalRoute({
    startPosition,
    destination,
    routeType: baseRouteType,
    random,
  });
  return {
    routeType: count > 1 ? ROUTE_PATTERN.GROUP : baseRouteType,
    baseRouteType,
    ...logicalRoute,
  };
};

const createTargetDefinition = ({
  id,
  type,
  spawnOffsetSeconds,
  objective,
  groupId,
  groupSize,
  launchPattern,
  routePlanId,
  routeType,
  baseRouteType,
  routeCorridor,
  route,
  spawnPosition,
  speedKmh,
  altitudeState,
  modelId,
  gameplayProfile,
}) => {
  return {
    id,
    spawnOffsetSeconds,
    type,
    speedKmh,
    ...altitudeState,
    turnRateDegPerSec: gameplayProfile.turnRateDegPerSec,
    sensorSignature: gameplayProfile.sensorSignature,
    detectability: gameplayProfile.sensorSignature,
    modelId,
    spawnPosition: { ...spawnPosition },
    destination: { ...objective.position },
    route: route.map(waypoint => ({ ...waypoint })),
    routeType,
    baseRouteType,
    routePlanId,
    routeCorridor,
    objectiveId: objective.id,
    objectiveName: objective.name,
    objectiveCategory: objective.category,
    objectivePriority: objective.protectionPriority,
    groupId,
    groupSize,
    launchPattern,
  };
};

const createWaveGroup = ({
  random,
  waveId,
  groupIndex,
  type,
  count,
  waveStartSec,
  targetSequence,
}) => {
  const origin = pick(random, THREAT_ORIGINS);
  const objectiveId = pick(random, origin.preferred);
  const objective = getObjective(objectiveId);
  const launchPattern = count === 1 ? 'SINGLE' : (random() > 0.45 ? 'FORMATION' : 'GROUP');
  const groupId = `${waveId}-GRP-${String(groupIndex + 1).padStart(2, '0')}`;
  const groupDelay = between(random, 0, 13);
  const gameplayProfile = getAirTargetGameplayProfile(type);
  const modelId = pick(random, gameplayProfile.models);
  const sharedRoutePlan = createSharedRoutePlan({
    type,
    count,
    startPosition: origin.position,
    destination: objective.position,
    gameplayProfile,
    random,
  });
  const routePlanId = `${groupId}-ROUTE`;

  return Array.from({ length: count }, (_, memberIndex) => {
    const memberRoute = count > 1
      ? createGroupMemberRoute({
        baseStartPosition: origin.position,
        destination: objective.position,
        sharedRoute: sharedRoutePlan.route,
        memberIndex,
        groupSize: count,
      })
      : { spawnPosition: origin.position, route: sharedRoutePlan.route, formationOffsetKm: 0 };
    const speedKmh = type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE
      ? ISKANDER_GAMEPLAY_PROFILE.speedKmh
      : integerBetween(random, ...gameplayProfile.speedRangeKmh);
    return createTargetDefinition({
      id: `AIR-${String(targetSequence + memberIndex).padStart(3, '0')}`,
      type,
      spawnOffsetSeconds: waveStartSec + groupDelay + (launchPattern === 'GROUP' ? memberIndex * between(random, 0.7, 2.2) : between(random, 0, 1.2)),
      objective,
      groupId,
      groupSize: count,
      launchPattern,
      routePlanId,
      routeType: sharedRoutePlan.routeType,
      baseRouteType: sharedRoutePlan.baseRouteType,
      routeCorridor: sharedRoutePlan.corridor,
      route: memberRoute.route,
      spawnPosition: memberRoute.spawnPosition,
      speedKmh,
      altitudeState: createAltitudeProfile({ type, gameplayProfile, random }),
      modelId,
      gameplayProfile,
    });
  });
};

const splitIntoGroups = (random, total) => {
  const groups = [];
  let remaining = total;
  while (remaining > 0) {
    const groupSize = remaining === 1 ? 1 : Math.min(remaining, integerBetween(random, 1, 5));
    groups.push(groupSize);
    remaining -= groupSize;
  }
  return groups;
};

export function createMassRaidScenario(seed = Date.now() >>> 0) {
  const random = createSeededRandom(seed);
  const waveBlueprints = [
    { id: 'WAVE-01', startSec: between(random, 4, 10), types: [{ type: SIMPLE_TARGET_TYPE.UAV, count: integerBetween(random, 8, 11) }] },
    { id: 'WAVE-02', startSec: between(random, 42, 58), types: [{ type: SIMPLE_TARGET_TYPE.CRUISE_MISSILE, count: integerBetween(random, 5, 8) }] },
    {
      id: 'WAVE-03', startSec: between(random, 88, 112), types: [
        { type: SIMPLE_TARGET_TYPE.UAV, count: integerBetween(random, 13, 17) },
        { type: SIMPLE_TARGET_TYPE.CRUISE_MISSILE, count: integerBetween(random, 4, 7) },
      ],
    },
  ];
  let targetSequence = 1;
  const waves = waveBlueprints.map(wave => {
    const groups = [];
    wave.types.forEach(typeEntry => {
      splitIntoGroups(random, typeEntry.count).forEach(count => {
        groups.push({ type: typeEntry.type, count });
      });
    });
    const targets = groups.flatMap((group, groupIndex) => {
      const definitions = createWaveGroup({
        random,
        waveId: wave.id,
        groupIndex,
        type: group.type,
        count: group.count,
        waveStartSec: wave.startSec,
        targetSequence,
      });
      targetSequence += definitions.length;
      return definitions;
    });
    return { id: wave.id, startOffsetSeconds: wave.startSec, targetCount: targets.length, targets };
  });

  return Object.freeze({
    id: `BLACK-SEA-ATTACK-${seed}`,
    name: 'BLACK SEA ATTACK',
    theater: 'UKRAINE',
    seed,
    startTimeSeconds: 20 * 3600,
    waves,
    targets: waves.flatMap(wave => wave.targets),
  });
}

export function createSandboxScenario(seed = Date.now() >>> 0) {
  return {
    id: `SANDBOX-${seed}`,
    name: 'SANDBOX RANGE',
    theater: 'UKRAINE',
    seed,
    startTimeSeconds: 12 * 3600,
    waves: [],
    targets: [],
  };
}

export function createManualTargetDefinitions({
  type,
  count,
  speedKmh,
  altitudeM,
  modelId,
  startPosition,
  objectiveId,
  seed,
  idStart,
  spawnOffsetSeconds = 0,
}) {
  const random = createSeededRandom(seed);
  const objective = getObjective(objectiveId);
  const groupId = `SANDBOX-GRP-${String(idStart).padStart(3, '0')}`;
  const launchPattern = count === 1 ? 'SINGLE' : 'FORMATION';
  const gameplayProfile = getAirTargetGameplayProfile(type);
  const sharedRoutePlan = createSharedRoutePlan({
    type,
    count,
    startPosition,
    destination: objective.position,
    gameplayProfile,
    random,
  });
  const routePlanId = `${groupId}-ROUTE`;
  return Array.from({ length: count }, (_, index) => {
    const memberRoute = count > 1
      ? createGroupMemberRoute({
        baseStartPosition: startPosition,
        destination: objective.position,
        sharedRoute: sharedRoutePlan.route,
        memberIndex: index,
        groupSize: count,
      })
      : { spawnPosition: startPosition, route: sharedRoutePlan.route };
    return createTargetDefinition({
      id: `SAN-${String(idStart + index).padStart(3, '0')}`,
      type,
      spawnOffsetSeconds,
      objective,
      groupId,
      groupSize: count,
      launchPattern,
      routePlanId,
      routeType: sharedRoutePlan.routeType,
      baseRouteType: sharedRoutePlan.baseRouteType,
      routeCorridor: sharedRoutePlan.corridor,
      route: memberRoute.route,
      spawnPosition: memberRoute.spawnPosition,
      speedKmh: type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE
        ? ISKANDER_GAMEPLAY_PROFILE.speedKmh
        : speedKmh,
      altitudeState: createAltitudeProfile({
        type,
        gameplayProfile,
        random,
        requestedAltitudeM: altitudeM,
      }),
      modelId: modelId ?? (
        type === SIMPLE_TARGET_TYPE.BALLISTIC_MISSILE
          ? LIGHT_TARGET_MODEL.ISKANDER_M
          : gameplayProfile.models[0]
      ),
      gameplayProfile,
    });
  });
}

export const TEST_RAID_SCENARIO = createMassRaidScenario(20260812);
