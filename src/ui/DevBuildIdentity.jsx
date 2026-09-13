const DEV_BUILD_LOADED_AT = new Date().toISOString();
const DEV_BUILD_ID = import.meta.env.VITE_DRONEFALL_BUILD_ID || `working-tree-${DEV_BUILD_LOADED_AT}`;

// This marker is deliberately development-only. It makes a stale browser tab
// obvious without adding version noise to the player-facing build.
export default function DevBuildIdentity() {
  if (!import.meta.env.DEV) return null;
  return <output
    className="dev-build-identity"
    data-testid="dev-build-identity"
    aria-label={`DEV BUILD ${DEV_BUILD_ID}`}
    title={`Loaded ${DEV_BUILD_LOADED_AT}`}
  >{`DEV BUILD · ${DEV_BUILD_ID}`}</output>;
}
