import { EVENT_TYPE } from './simulationEvents.js';

const MISSILE_EVENTS = new Set([
  EVENT_TYPE.INTERCEPTOR_LAUNCHED,
  EVENT_TYPE.MISSILE_PHASE,
  EVENT_TYPE.MISSILE_TRACK_SOURCE,
  EVENT_TYPE.MISSILE_PREDICTED_INTERCEPT,
  EVENT_TYPE.MISSILE_SOURCE,
  EVENT_TYPE.MISSILE_FALLBACK_NETWORK,
  EVENT_TYPE.MISSILE_MISS,
  EVENT_TYPE.SECOND_ATTACK_ALLOWED,
  EVENT_TYPE.SECOND_ATTACK_DENIED,
  EVENT_TYPE.STAGE_SEPARATION,
  EVENT_TYPE.GROUND_RISK,
  EVENT_TYPE.SEEKER_SEARCH,
  EVENT_TYPE.SEEKER_ACQUIRED,
  EVENT_TYPE.SEEKER_LOST,
  EVENT_TYPE.SEEKER_REACQUIRED,
  EVENT_TYPE.INTERCEPTOR_FAILED,
  EVENT_TYPE.INTERCEPTOR_SELF_DESTRUCT,
  EVENT_TYPE.TARGET_INTERCEPTED,
]);

export function appendMissileLog(log, event) {
  const missileId = event.details?.missileId;
  if (!missileId || !MISSILE_EVENTS.has(event.type)) return log;
  const index = log.findIndex(entry => entry.id === missileId);
  if (index >= 0) return log.map((entry, position) => position === index
    ? { ...entry, events: [...entry.events, event] } : entry);
  // A late event from an evicted interceptor or a gun engagement must not
  // displace one of the five most recently launched missiles.
  if (event.type !== EVENT_TYPE.INTERCEPTOR_LAUNCHED) return log;
  return [{ id: missileId, batteryId: event.details?.batteryId ?? null,
    events: [event] }, ...log].slice(0, 5);
}
