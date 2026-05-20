import Flag from './Flag';

export default function DeckCard({
  flag,
  lang,
  subtitle,
  progress = 0,
  total = 0,
  accent = 'leaf',
  sticker,
  onClick,
  children
}) {
  const pct = total ? Math.round((progress / total) * 100) : 0;
  return (
    <div
      className="card"
      style={{ position: 'relative', cursor: onClick ? 'pointer' : 'default' }}
      onClick={onClick}
    >
      {sticker && (
        <span
          className="sticker tilt-r"
          style={{
            position: 'absolute',
            top: -10,
            right: 14,
            background: sticker.color || 'var(--mustard)',
            color: sticker.fg || 'var(--ink)'
          }}
        >
          {sticker.label}
        </span>
      )}
      <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ margin: 0, wordBreak: 'break-word' }}>{lang}</h3>
          {subtitle && (
            <div className="t-hand muted" style={{ fontSize: 15, marginTop: 2 }}>{subtitle}</div>
          )}
        </div>
        {flag && <Flag code={flag} size="lg" />}
      </div>
      {total > 0 && (
        <>
          <div className="bar-shell" style={{ marginTop: 14 }}>
            <div className={`bar-fill bar-fill-${accent}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="row between" style={{ marginTop: 8, fontSize: 13 }}>
            <span className="muted">{progress} / {total} klart</span>
            <span className="t-hand" style={{ fontSize: 15 }}>{pct}%</span>
          </div>
        </>
      )}
      {children}
    </div>
  );
}
