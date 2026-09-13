import { getDestinationPoint } from '../store/geo.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const headingDelta = (to, from) => ((to - from + 540) % 360 + 360) % 360 - 180;

/** Presentation only. Input is a radar estimate, never an AirTarget.
 * Feed-forward follows reported velocity; damping absorbs measurement residuals
 * instead of delaying the entire moving marker. Cache belongs to the view.
 */
export function sampleTrackPresentation(cache, key, track, simulationTime, nowMs) {
  if (!track?.reportedPosition || track.state === 'LOST') return null;
  const heading = track.reportedHeading ?? 0;
  const speedKmh = track.reportedHorizontalSpeedKmh ?? track.reportedSpeedKmh ?? 0;
  const verticalMps = track.reportedVerticalSpeedMps ?? 0;
  const predictionTime = track.lastPredictionTime ?? track.lastUpdateTime ?? simulationTime;
  // Rendering may extrapolate briefly, but must not manufacture radar updates.
  const aheadSec = clamp(simulationTime - predictionTime, 0, 0.15);
  const position = getDestinationPoint(track.reportedPosition.lat, track.reportedPosition.lng,
    heading, speedKmh * aheadSec / 3600);
  const desired = {
    ...position,
    altitudeM: Math.max(0, (track.reportedAltitudeM ?? track.reportedPosition.alt ?? 0) + verticalMps * aheadSec),
    headingDeg: heading, speedKmh, verticalMps,
  };
  let item = cache.get(key);
  if (!item || simulationTime < item.simulationTime - 1 || nowMs - item.sampledAt > 1500) {
    item = { displayed: desired, sampledAt: nowMs, simulationTime };
    cache.set(key, item);
    return desired;
  }
  if (nowMs === item.sampledAt) return item.displayed;
  const realDt = clamp((nowMs - item.sampledAt) / 1000, 0, 0.25);
  const simDt = clamp(simulationTime - item.simulationTime, 0, 2);
  const displayed = item.displayed;
  const predicted = getDestinationPoint(displayed.lat, displayed.lng,
    displayed.headingDeg, displayed.speedKmh * simDt / 3600);
  const predictedAltitude = Math.max(0, displayed.altitudeM + displayed.verticalMps * simDt);
  const errorM = Math.hypot((desired.lat - predicted.lat) * 111_195,
    (desired.lng - predicted.lng) * 111_195 * Math.cos(desired.lat * Math.PI / 180),
    desired.altitudeM - predictedAltitude);
  const uncertaintyM = Math.hypot(track.positionUncertaintyM ?? 0, track.altitudeUncertaintyM ?? 0);
  const baseResponse = 0.18 + clamp(uncertaintyM / 500, 0, 1) * 0.2;
  // A genuine large correction catches up quickly; ordinary uncertainty doesn't
  // continuously trigger the fast path. No per-measurement animation restart.
  const correctionThreshold = Math.max(150, uncertaintyM * 3);
  const responseSec = baseResponse / (1 + clamp((errorM - correctionThreshold) / correctionThreshold, 0, 3));
  const alpha = 1 - Math.exp(-realDt / responseSec);
  const angularAlpha = 1 - Math.exp(-realDt / 0.2);
  item.displayed = {
    lat: predicted.lat + (desired.lat - predicted.lat) * alpha,
    lng: predicted.lng + (desired.lng - predicted.lng) * alpha,
    altitudeM: predictedAltitude + (desired.altitudeM - predictedAltitude) * alpha,
    headingDeg: displayed.headingDeg + headingDelta(heading, displayed.headingDeg) * angularAlpha,
    speedKmh: displayed.speedKmh + (speedKmh - displayed.speedKmh) * angularAlpha,
    verticalMps: displayed.verticalMps + (verticalMps - displayed.verticalMps) * angularAlpha,
  };
  item.sampledAt = nowMs;
  // A late UI snapshot may briefly trail the extrapolated render clock. That
  // is not a scenario reset and must not snap the marker back to its estimate.
  item.simulationTime = Math.max(item.simulationTime, simulationTime);
  return item.displayed;
}

export const withTrackPresentation = (track, pose) => pose ? ({
  ...track, reportedPosition: { lat: pose.lat, lng: pose.lng, alt: pose.altitudeM },
  reportedAltitudeM: pose.altitudeM, reportedHeading: pose.headingDeg,
  reportedSpeedKmh: pose.speedKmh,
}) : track;
