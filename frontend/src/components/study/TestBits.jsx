// Byggstenar för övningsprov: poäng per nivå (E/C/A), betygsbricka,
// poängstaplar och betygsgränserna. Poäng skrivs som på de nationella proven:
// "1/1/0" = en E-poäng, en C-poäng, ingen A-poäng.

export const LEVELS = ['E', 'C', 'A'];
const GRADE_COLOR = { A: 'var(--plum-soft)', B: 'var(--sky-soft)', C: 'var(--leaf-soft)', D: 'var(--leaf-soft)', E: 'var(--mustard-soft)', F: 'var(--berry-soft)' };

export const pointsText = (p) => `${p?.E || 0}/${p?.C || 0}/${p?.A || 0}`;
export const pointsTotal = (p) => (p?.E || 0) + (p?.C || 0) + (p?.A || 0);

export function PointsLabel({ points }) {
  const total = pointsTotal(points);
  return (
    <span className="points-pill" title={`E-poäng / C-poäng / A-poäng — totalt ${total}`}>
      {pointsText(points)} <span className="muted">p</span>
    </span>
  );
}

export function GradeBadge({ grade, size = 84 }) {
  if (!grade) return null;
  return (
    <div className="grade-badge" style={{ width: size, height: size, fontSize: size * 0.55, background: GRADE_COLOR[grade] || 'var(--bg-elev)' }} aria-label={`Uppskattat betyg ${grade}`}>
      {grade}
    </div>
  );
}

export function LevelBars({ score, max }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      {LEVELS.filter((l) => (max?.[l] || 0) > 0).map((l) => {
        const pct = Math.round(((score?.[l] || 0) / max[l]) * 100);
        return (
          <div key={l} className="row" style={{ gap: 10, alignItems: 'center' }}>
            <span className={`level-pill level-${l}`} style={{ minWidth: 34, justifyContent: 'center' }}>{l}</span>
            <div className="bar-shell grow" style={{ height: 14 }}>
              <div className="bar-fill bar-fill-leaf" style={{ width: `${pct}%` }} />
            </div>
            <span className="t-hand" style={{ minWidth: 64, textAlign: 'right' }}>{score?.[l] || 0} av {max[l]}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Vad som krävs för E, C och A (D och B ligger mellan). */
export function LimitsText({ limits, max }) {
  if (!limits) return null;
  const hasCA = (max?.C || 0) + (max?.A || 0) > 0;
  const hasA = (max?.A || 0) > 0;
  const row = (g, l, extra) => (
    <li key={g}><strong>{g}:</strong> minst {l.total} poäng{extra}</li>
  );
  return (
    <ul style={{ margin: '6px 0 0', paddingLeft: 20, lineHeight: 1.7 }}>
      {row('E', limits.E, '')}
      {hasCA && row('C', limits.C, limits.C.cOrA ? `, varav ${limits.C.cOrA} på C- eller A-nivå` : '')}
      {hasA && row('A', limits.A, limits.A.a ? `, varav ${limits.A.a} på A-nivå` : '')}
      <li className="muted" style={{ listStyle: 'none', marginLeft: -20 }}>
        {hasA ? 'D och B ligger mellan.' : hasCA ? 'D ligger mellan. Provet har inga A-frågor, så det kan visa högst C.' : 'Provet har bara E-frågor, så det kan visa högst E.'}
      </li>
    </ul>
  );
}
