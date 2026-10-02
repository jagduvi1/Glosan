import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchStudyUnits, fetchStudyOverview } from '../api/study';
import { PracticePicker, practiceUrl, sheetUrl } from '../components/study/StudyBits';
import UnitCard from '../components/study/UnitCard';
import FolderPicker from '../components/study/FolderPicker';
import ShareStudyDialog from '../components/study/ShareStudyDialog';
import { groupByChapter } from '../components/study/chapters';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import '../styles/study.css';

// Ett ämne i Plugga: alla områden, grupperade per termin (vald termin först)
// och inom terminen per kapitel (samma bok + kapitel, components/study/chapters.js).
// Välj ett eller flera områden — eller ett helt kapitel — och öva på dem, eller
// på allt i terminen.

function ChapterGroup({ chapter, selected, onToggle, onToggleAll }) {
  const ids = chapter.units.map((u) => u.id);
  const all = ids.every((id) => selected.includes(id));
  const total = chapter.units.reduce((n, u) => n + (u.progress?.total || 0), 0);
  const mastered = chapter.units.reduce((n, u) => n + (u.progress?.mastered || 0), 0);
  return (
    <section className="chapter-group" aria-label={`Kapitel ${chapter.label}`}>
      <div className="row between" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 20 }}>📖 {chapter.label}</h3>
          <p className="t-hand muted" style={{ margin: '2px 0 0', fontSize: 14 }}>
            {[chapter.book, `${chapter.units.length} områden`, total ? `${mastered} av ${total} sitter` : null].filter(Boolean).join(' · ')}
          </p>
        </div>
        <button type="button" className="btn btn-sm" aria-pressed={all} onClick={() => onToggleAll(ids, !all)}>
          {all ? '✓ Kapitlet valt' : 'Välj hela kapitlet'}
        </button>
      </div>
      <div className="stack" style={{ gap: 10 }}>
        {chapter.units.map((u) => (
          <UnitCard key={u.id} unit={u} hideSource selected={selected.includes(u.id)} onToggle={() => onToggle(u.id)} />
        ))}
      </div>
    </section>
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
  const [picking, setPicking] = useState(false);
  const [sharing, setSharing] = useState(false);
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
    // Nyast först: HT kommer efter VT samma år ("2026-HT" > "2026-VT"), vilket
    // en ren strängjämförelse får om bakfoten.
    const termOrder = (t) => Number(t.slice(0, 4)) * 2 + (t.endsWith('HT') ? 1 : 0);
    return [...groups.values()].sort((a, b) => {
      if (a.term === shownTerm) return -1;
      if (b.term === shownTerm) return 1;
      return termOrder(b.term) - termOrder(a.term);
    });
  }, [units, shownTerm]);

  if (error) return <p className="error">{error}</p>;
  if (!units || !meta) return <p className="t-hand muted">Glo hämtar områdena…</p>;
  if (!subjectInfo) return <p className="error">Okänt ämne.</p>;

  const toggle = (id) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const toggleAll = (ids, on) => setSelected((cur) => (on ? [...new Set([...cur, ...ids])] : cur.filter((x) => !ids.includes(x))));
  // Är exakt ett kapitel valt? Då heter passet efter kapitlet.
  const chapters = byTerm.flatMap((g) => groupByChapter(g.units)).filter((b) => b.kind === 'chapter');
  const selectedChapter = chapters.find((c) => c.units.length === selected.length && c.units.every((u) => selected.includes(u.id)));
  const inShownTerm = units.filter((u) => u.term === shownTerm);
  const back = `/plugga/amne/${subject}${term ? `?term=${term}` : ''}`;
  const pickedScope = () => (selected.length ? { unitIds: selected, back } : { subject, term: shownTerm, back });
  const start = (opts) => navigate(practiceUrl(pickedScope(), opts));
  const print = (opts) => navigate(sheetUrl(pickedScope(), opts));
  const practiceTarget = selectedChapter
    ? `kapitlet ${selectedChapter.label}`
    : selected.length
      ? `${selected.length} ${selected.length === 1 ? 'valt område' : 'valda områden'}`
      : `allt i ${subjectInfo.label} ${meta.terms.find((t) => t.key === shownTerm)?.label || ''}`;

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="row between" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <Link to={`/plugga${term ? `?term=${term}` : ''}`} className="t-hand" style={{ fontSize: 15 }}>← Plugga</Link>
          <h1 style={{ fontSize: 38, margin: '6px 0 0' }}>
            <span aria-hidden="true">{subjectInfo.emoji}</span> {subjectInfo.label}
          </h1>
        </div>
        {units.length > 0 && (
          <button type="button" className="btn" onClick={() => setSharing(true)} title="Dela områden med kompisar eller med en QR-kod">
            👥 Dela
          </button>
        )}
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
              <div className="row between" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 10 }}>
                <h2 style={{ margin: 0, fontSize: 21 }}>Öva på {practiceTarget}</h2>
                {selected.length > 0 && (
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-sm" onClick={() => setPicking(true)}>📁 Lägg i mapp</button>
                    <button type="button" className="btn btn-sm" onClick={() => setSharing(true)}>👥 Dela</button>
                  </div>
                )}
              </div>
              <PracticePicker onStart={start} onPrint={print} />
            </div>
          )}
          {byTerm.map((g) => (
            <div key={g.term}>
              <h2 style={{ margin: '0 0 10px', fontSize: 22 }}>
                {g.label}{g.term === meta.currentTerm ? ' (nu)' : ''}
              </h2>
              <div className="stack" style={{ gap: 12 }}>
                {groupByChapter(g.units).map((b) => (b.kind === 'chapter' ? (
                  <ChapterGroup key={b.key} chapter={b} selected={selected} onToggle={toggle} onToggleAll={toggleAll} />
                ) : (
                  <UnitCard key={b.unit.id} unit={b.unit} selected={selected.includes(b.unit.id)} onToggle={() => toggle(b.unit.id)} />
                )))}
              </div>
            </div>
          ))}
        </>
      )}
      {picking && <FolderPicker unitIds={selected} onClose={() => setPicking(false)} />}
      {sharing && (
        <ShareStudyDialog
          units={units}
          initialSelected={selected}
          title={selectedChapter ? `${subjectInfo.label} — ${selectedChapter.label}` : subjectInfo.label}
          onClose={() => setSharing(false)}
        />
      )}
    </div>
  );
}
