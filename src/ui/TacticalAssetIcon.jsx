const ICON_PATHS = Object.freeze({
  command: (
    <>
      <path d="M6 4h12l3 5-3 11H6L3 9z" />
      <path d="M8 8h8M8 12h8M10 16h4" />
    </>
  ),
  radar: (
    <>
      <path d="M5 18h14M9 18l3-5 3 5" />
      <path d="M6 10a6 6 0 0 1 12 0M9 10a3 3 0 0 1 6 0" />
      <path d="M12 10l5-5" />
    </>
  ),
  launcher: (
    <>
      <path d="M4 16h16v3H4zM6 16l2-8h8l2 8" />
      <path d="M9 8V4M12 8V3M15 8V4" />
    </>
  ),
  uav: (
    <>
      <path d="M12 3v16M3 10l9 3 9-3M6 17l6-2 6 2" />
      <circle cx="12" cy="13" r="1.4" />
    </>
  ),
  cruise: (
    <>
      <path d="M12 2l3 8 6 4-7-1-2 9-2-9-7 1 6-4z" />
      <path d="M12 5v9" />
    </>
  ),
  ballistic: (
    <>
      <path d="M12 2c3 3 4 7 3 11l-3 7-3-7c-1-4 0-8 3-11z" />
      <path d="M9 13l-3 4 4-1M15 13l3 4-4-1" />
    </>
  ),
  interceptor: (
    <>
      <path d="M12 2l4 14-4-2-4 2z" />
      <path d="M10 15l2 7 2-7" />
    </>
  ),
});

export default function TacticalAssetIcon({ type, className = '' }) {
  return (
    <svg className={`tactical-asset-icon ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      {ICON_PATHS[type] ?? ICON_PATHS.command}
    </svg>
  );
}
