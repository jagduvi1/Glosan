import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchStudyUnits, fetchStudyOverview } from '../api/study';
import { PracticePicker, ProgressBar, practiceUrl, daysUntil } from '../components/study/StudyBits';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import '../styles/study.css';

// Ett ämne i Plugga: alla områden, grupperade per termin (vald termin först).
// Välj ett eller flera områden och öva på dem — eller på allt i terminen.

function UnitCard({ unit, selected, onToggle }) {
  const days = daysUntil(unit.examDate);
  return (
    <div className="card" style={{ padding: 16, outline: selected ? '3px solid var(--coral-deep)' : 'none' }}>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Välj ${unit.title}`}
          style={{ marginTop: 6, width: 20, height: 20, flex: 'none' }}
        />
        <div className="grow" style={{ minWidth: 0 }}>
          <Link to={`/plugga/omrade/${unit.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <span className="study-code">{unit.code}</span>
              <h3 style={{ margin: 0, fontSize: 20 }}>{unit.title}</h3>
            </div>
          </Link>
          <p className="t-hand muted" style={{ margin: '4px 0 8px', fontSize: 14 }}>
            {[unit.gradeYear ? `åk ${unit.gradeYear}` : null, unit.source?.book, unit.source?.chapter].filter(Boolean).join(' · ')}
            {unit.sharedBy ? ` · delad av ${unit.sharedBy}` : ''}
          </p>
          <p className="t-hand" style={{ margin: '0 0 8px', fontSize: 14 }}>
            {unit.progress.cards} kort · {unit.progress.exercises} övningar
            {unit.progress.exercises > 0 && ` (${['E', 'C', 'A'].map((l) => `${unit.progress.levels[l]} ${l}`).join(', ')})`}
            {days !== null && days >= 0 && (
              <strong style={{ marginLeft: 8, color: days <= 3 ? 'var(--berry-deep)' : 'inherit' }}>
                · Prov {days === 0 ? 'idag!' : days === 1 ? 'imorgon' : `om ${days} dagar`}
              </strong>
            )}
          </p>
          <ProgressBar progress={unit.progress} />
        </div>
      </div>
    </div>
  );
}

export default function PluggaSubject() {
  const { subject } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { apiFetch } = useAuth();
  const [units, setUnits] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState([]);
  const term = params.get('term');

  useEffect(() => {
    let active = true;
    Promise.all([fetchStudyUnits(apiFetch, { subject, allTerms: true }), fetchStudyOverview(apiFetch, term)])
      .then(([u, o]) => { if (active) { setUnits(u); setMeta(o); } })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [apiFetch, subject, term]);

  const subjectInfo = meta?.subjects.find((s) => s.key === subject);
  useDocumentTitle(subjectInfo ? `${subjectInfo.label} — Plugga` : 'Plugga');
  const shownTerm = term || meta?.currentTerm;

  // Vald termin först, sedan övriga nyast först.
  const byTerm = useMemo(() => {
    const groups = new Map();
    for (const u of units || []) {
      if (!groups.has(u.term)) groups.set(u.term, { term: u.term, label: u.termLabel, units: [] });
      groups.get(u.term).units.push(u);
    }
    return [...groups.values()].sort((a, b) => {
      if (a.term === shownTerm) return -1;
      if (b.term === shownTerm) return 1;
      return b.term.localeCompare(a.term);
    });
  }, [units, shownTerm]);

  if (error) return <p className="error">{error}</p>;
  if (!units || !meta) return <p className="t-hand muted">Glo hämtar områdena…</p>;
  if (!subjectInfo) return <p className="error">Okänt ämne.</p>;

  const toggle = (id) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const inShownTerm = units.filter((u) => u.term === shownTerm);
  const back = `/plugga/amne/${subject}${term ? `?term=${term}` : ''}`;
  const start = (opts) => {
    const scope = selected.length
      ? { unitIds: selected, back }
      : { subject, term: shownTerm, back };
    navigate(practiceUrl(scope, opts));
  };
  const practiceTarget = selected.length
    ? `${selected.length} ${selected.length === 1 ? 'valt område' : 'valda områden'}`
    : `allt i ${subjectInfo.label} ${meta.terms.find((t) => t.key === shownTerm)?.label || ''}`;

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div>
        <Link to={`/plugga${term ? `?term=${term}` : ''}`} className="t-hand" style={{ fontSize: 15 }}>← Plugga</Link>
        <h1 style={{ fontSize: 38, margin: '6px 0 0' }}>
          <span aria-hidden="true">{subjectInfo.emoji}</span> {subjectInfo.label}
        </h1>
      </div>

      {units.length === 0 ? (
        <div className="card card-lg" style={{ background: 'var(--paper-edge)' }}>
          <h2 style={{ margin: '0 0 6px' }}>Inga områden i {subjectInfo.label.toLowerCase()} än</h2>
          <p style={{ margin: 0 }}>
            Fota sidorna i boken och be din AI: <em>"Hjälp mig plugga på det här i Glosan"</em>. Den frågar vilken årskurs du går i
            och lägger sedan in genomgång, kort och övningar här.
          </p>
        </div>
      ) : (
        <>
          {(inShownTerm.length > 0 || selected.length > 0) && (
            <div className="card" style={{ background: 'var(--mustard-soft)' }}>
              <h2 style={{ margin: '0 0 10px', fontSize: 21 }}>Öva på {practiceTarget}</h2>
              <PracticePicker onStart={start} />
            </div>
          )}
          {byTerm.map((g) => (
            <div key={g.term}>
              <h2 style={{ margin: '0 0 10px', fontSize: 22 }}>
                {g.label}{g.term === meta.currentTerm ? ' (nu)' : ''}
              </h2>
              <div className="stack" style={{ gap: 12 }}>
                {g.units.map((u) => (
                  <UnitCard key={u.id} unit={u} selected={selected.includes(u.id)} onToggle={() => toggle(u.id)} />
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
