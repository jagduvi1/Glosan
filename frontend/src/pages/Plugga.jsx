import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchStudyOverview } from '../api/study';
import GloAvatar from '../components/GloAvatar';
import { useDocumentTitle } from '../utils/useDocumentTitle';

// Plugga — startsidan för skolämnena (dold bakom flaggan 'study').
// Fas 0: ämnen per termin med antal områden. Områden, genomgångar, kort,
// övningar och prov kommer i nästa fas — de skapas av användarens egen AI via
// MCP (se docs/plugga.md).

// Ämnen utan grupp först (Matte överst), sedan NO- och SO-blocken.
function groupSubjects(subjects, groups) {
  const loose = subjects.filter((s) => !s.group);
  return [
    { key: 'main', label: null, subjects: loose.filter((s) => s.key === 'matematik') },
    ...groups.map((g) => ({ key: g.key, label: g.label, hint: g.description, subjects: subjects.filter((s) => s.group === g.key) })),
    { key: 'other', label: 'Övriga ämnen', subjects: loose.filter((s) => s.key !== 'matematik') }
  ].filter((g) => g.subjects.length > 0);
}

function SubjectCard({ subject }) {
  const empty = subject.unitCount === 0;
  return (
    <div
      className="card"
      style={{
        padding: 16,
        background: empty ? 'var(--bg-elev)' : `var(--${subject.color}-soft, var(--bg-elev))`,
        opacity: empty ? 0.75 : 1
      }}
    >
      <div style={{ fontSize: 30 }} aria-hidden="true">{subject.emoji}</div>
      <h3 style={{ margin: '6px 0 2px', fontSize: 19 }}>{subject.label}</h3>
      <p className="t-hand muted" style={{ margin: 0, fontSize: 14 }}>
        {empty ? 'Inga områden än' : `${subject.unitCount} ${subject.unitCount === 1 ? 'område' : 'områden'}`}
      </p>
    </div>
  );
}

export default function Plugga() {
  useDocumentTitle('Plugga');
  const { apiFetch } = useAuth();
  const [data, setData] = useState(null);
  const [term, setTerm] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await fetchStudyOverview(apiFetch, term));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [apiFetch, term]);

  useEffect(() => { load(); }, [load]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="t-hand muted">Glo letar fram dina ämnen…</p>;

  const totalUnits = data.subjects.reduce((n, s) => n + s.unitCount, 0);

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row between" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <h1 style={{ fontSize: 40, margin: 0 }}>
              <span className="mark-highlight">Plugga</span>
            </h1>
            <span className="pill" style={{ background: 'var(--mustard-soft)', fontSize: 13 }}>beta</span>
          </div>
          <p className="t-hand muted" style={{ fontSize: 17, margin: '4px 0 0' }}>
            Matte, NO, SO och alla andra ämnen — sorterat per termin.
          </p>
        </div>
        <label className="field" style={{ minWidth: 160 }}>
          <span className="field-label">Termin</span>
          <select className="inp" value={data.term} onChange={(e) => setTerm(e.target.value)}>
            {data.terms.map((t) => (
              <option key={t.key} value={t.key}>{t.label}{t.key === data.currentTerm ? ' (nu)' : ''}</option>
            ))}
          </select>
        </label>
      </div>

      {totalUnits === 0 && (
        <div className="card card-lg" style={{ background: 'var(--paper-edge)' }}>
          <div className="row" style={{ gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <GloAvatar size={72} mood="wink" tilt={-6} />
            <div className="grow" style={{ minWidth: 240 }}>
              <h2 style={{ margin: '0 0 6px' }}>Inga områden {data.term === data.currentTerm ? 'den här terminen' : `under ${data.termLabel}`} än</h2>
              <p style={{ margin: 0 }}>
                Snart kan du fota sidor ur boken och be din AI (t.ex. Claude med Glosan kopplat) skapa ett område:
                genomgång, plugg-kort, övningar på olika nivåer och övningsprov — allt hamnar här, sorterat per ämne och termin.
              </p>
            </div>
          </div>
        </div>
      )}

      {groupSubjects(data.subjects, data.groups).map((group) => (
        <div key={group.key}>
          {group.label && (
            <div className="row" style={{ gap: 10, alignItems: 'baseline', marginBottom: 10, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>{group.label}</h2>
              {group.hint && <span className="t-hand muted" style={{ fontSize: 15 }}>{group.hint}</span>}
            </div>
          )}
          <div className="features-grid">
            {group.subjects.map((s) => <SubjectCard key={s.key} subject={s} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
