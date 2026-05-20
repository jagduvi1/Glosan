export default function StatTile({ value, label, color, icon, compact = false }) {
  return (
    <div
      className="card"
      style={{
        flex: 1,
        minWidth: compact ? 100 : 140,
        background: color || 'var(--bg-elev)',
        padding: compact ? 14 : 20
      }}
    >
      <div className="row" style={{ gap: 10, alignItems: 'center', marginBottom: 4 }}>
        {icon && <img src={icon} width={compact ? 22 : 26} alt="" />}
        <div style={{ fontFamily: 'var(--font-headline)', fontSize: compact ? 24 : 30, lineHeight: 1, whiteSpace: 'nowrap' }}>
          {value}
        </div>
      </div>
      <div className="t-hand muted" style={{ fontSize: compact ? 14 : 16 }}>{label}</div>
    </div>
  );
}
