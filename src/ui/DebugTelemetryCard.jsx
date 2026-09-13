export function DebugTelemetryCard({ title, entityId, children, footer, className = '' }) {
  return (
    <aside className={`debug-telemetry-card ${className}`.trim()}>
      <header>
        <span>{title}</span>
        <strong>{entityId}</strong>
      </header>
      {children}
      {footer && <small>{footer}</small>}
    </aside>
  );
}

export function DebugSection({ title, children }) {
  return (
    <section className="debug-telemetry-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function DebugRow({ label, value, tone = '' }) {
  return (
    <div className="debug-telemetry-row">
      <span>{label}</span>
      <b className={tone}>{value}</b>
    </div>
  );
}

export function DebugStatus({ value }) {
  const tone = value === 'VALID' ? 'is-valid'
    : value === 'MARGINAL' || value === 'OVERSHOOT' || value === 'UNDERSHOOT'
      ? 'is-marginal'
      : 'is-invalid';
  return <em className={`debug-telemetry-status ${tone}`}>{value}</em>;
}
