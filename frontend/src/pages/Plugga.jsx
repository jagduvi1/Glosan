import { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchStudyOverview } from '../api/study';
import GloAvatar from '../components/GloAvatar';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import '../styles/study.css';

// Plugga — startsidan för skolämnena (dold bakom flaggan 'study').
// Ämnen per termin, "dags att repetera" och hur man skapar sitt första
// område med sin AI. Innehållet skapas via MCP (docs/plugga.md).

// Ämnen utan grupp först (Matte överst), sedan NO- och SO-blocken.
function groupSubjects(subjects, groups) {
  const loose = subjects.filter((s) => !s.group);
  return [
    { key: 'main', label: null, subjects: loose.filter((s) => s.key === 'matematik') },
    ...groups.map((g) => ({ key: g.key, label: g.label, hint: g.description, subjects: subjects.filter((s) => s.group === g.key) })),
    { key: 'other', label: 'Övriga ämnen', subjects: loose.filter((s) => s.key !== 'matematik') }
  ].filter((g) => g.subjects.length > 0);
}

function SubjectCard({ subject, term }) {
  const empty = subject.unitCount === 0;
  return (
    <Link
      to={`/plugga/amne/${subject.key}?term=${term}`}
      className="card"
      style={{
        padding: 16,
        display: 'block',
        color: 'inherit',
        textDecoration: 'none',
        background: empty ? 'var(--bg-elev)' : `var(--${subject.color}-soft, var(--bg-elev))`,
        opacity: empty ? 0.8 : 1
      }}
    >
      <div style={{ fontSize: 30 }} aria-hidden="true">{subject.emoji}</div>
      <h3 style={{ margin: '6px 0 2px', fontSize: 19 }}>{subject.label}</h3>
      <p className="t-hand muted" style={{ margin: 0, fontSize: 14 }}>
        {empty ? 'Inga områden än' : `${subject.unitCount} ${subject.unitCount === 1 ? 'område' : 'områden'}`}
      </p>
    </Link>
  );
}

function HowToCreate() {
  return (
    <div className="card card-lg" style={{ background: 'var(--paper-edge)' }}>
      <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <GloAvatar size={72} mood="wink" tilt={-6} />
        <div className="grow" style={{ minWidth: 240 }}>
          <h2 style={{ margin: '0 0 6px' }}>Så skapar du ditt första område</h2>
          <ol style={{ margin: '0 0 8px', paddingLeft: 22, lineHeight: 1.7 }}>
            <li>Koppla din AI (t.ex. Claude) till Glosan under <Link to="/profile">Profil → Koppla din AI</Link>.</li>
            <li>Fota sidorna i boken — gärna både lätta och svåra uppgifter.</li>
            <li>Skicka bilderna till Claude och skriv <em>"Hjälp mig plugga på det här i Glosan"</em>.</li>
            <li>Claude frågar vilken årskurs du går i, föreslår vad som ska skapas och lägger in allt här.</li>
          </ol>
          <p className="t-hand muted" style={{ margin: 0, fontSize: 15 }}>
            Snart kan kompisar dela sina områden med dig — då behöver du ingen egen AI.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Plugga() {
  useDocumentTitle('Plugga');
  const { apiFetch } = useAuth();
  const [data, setData] = useState(null);
  const [params] = useSearchParams();
  const [term, setTerm] = useState(params.get('term'));
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

  const termUnits = data.subjects.reduce((n, s) => n + s.unitCount, 0);

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

      {data.due > 0 && (
        <div className="card row between" style={{ background: 'var(--sky-soft)', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22 }}>🔁 Dags att repetera: {data.due}</h2>
            <p className="t-hand muted" style={{ margin: '2px 0 0' }}>Kort och övningar som är redo att komma tillbaka — från alla ämnen.</p>
          </div>
          <Link to="/plugga/ova?mode=due&count=20&back=/plugga" className="btn btn-primary">Repetera nu →</Link>
        </div>
      )}

      {data.totalUnits === 0 && <HowToCreate />}
      {data.totalUnits > 0 && termUnits === 0 && (
        <p className="t-hand muted" style={{ fontSize: 16, margin: 0 }}>
          Inga områden {data.term === data.currentTerm ? 'den här terminen' : `under ${data.termLabel}`} — byt termin ovan för att se äldre.
        </p>
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
            {group.subjects.map((s) => <SubjectCard key={s.key} subject={s} term={data.term} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
