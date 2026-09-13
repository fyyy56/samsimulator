const activeInterpolators = new Set();
let animationFrameId = null;
const runInterpolationFrame = timestamp => {
  activeInterpolators.forEach(interpolator => interpolator(timestamp));
  animationFrameId = activeInterpolators.size > 0
    ? window.requestAnimationFrame(runInterpolationFrame) : null;
};
// One existing shared marker loop, including tactical vector endpoints.
export const registerMarkerInterpolator = interpolator => {
  activeInterpolators.add(interpolator);
  if (animationFrameId === null) animationFrameId = window.requestAnimationFrame(runInterpolationFrame);
  return () => {
    activeInterpolators.delete(interpolator);
    if (activeInterpolators.size === 0 && animationFrameId !== null) {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  };
};
