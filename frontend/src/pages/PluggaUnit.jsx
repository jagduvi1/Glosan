import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchStudyUnit, startStudySession, pingStudySession, finishStudySession, leaveStudyUnit } from '../api/study';
import StudyMarkdown from '../components/StudyMarkdown';
import { LevelPill, CodeTag, ProgressBar, PracticePicker, practiceUrl, daysUntil } from '../components/study/StudyBits';
import ShareUnitDialog from '../components/study/ShareUnitDialog';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import '../styles/study.css';

// Ett område i Plugga: genomgångar, kort och övningar. Läsning av en
// genomgång räknas som pluggtid (en "ping" var 30:e sekund medan sidan är
// synlig). Övningar kan lösas på papper: koden (t.ex. MA3-14) skrivs överst,
// eleven fotar lösningen och ber sin AI rätta — resultatet och AI:ns tips
// syns här.

const PING_MS = 30 * 1000;

/** Räkna lästid för genomgången medan fliken är öppen och synlig. */
function useReadingSession(apiFetch, unitId, active) {
  useEffect(() => {
    if (!active) return undefined;
    let sessionId = null;
    let cancelled = false;
    startStudySession(apiFetch, { unitIds: [unitId], mode: 'reading' })
      .then((r) => { if (!cancelled) sessionId = r.session.id; else finishStudySession(apiFetch, r.session.id).catch(() => {}); })
      .catch(() => {});
    const timer = setInterval(() => {
      if (sessionId && document.visibilityState === 'visible') pingStudySession(apiFetch, sessionId).catch(() => {});
    }, PING_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      if (sessionId) finishStudySession(apiFetch, sessionId).catch(() => {});
    };
  }, [apiFetch, unitId, active]);
}

function StateBadge({ state }) {
  if (!state) return <span className="t-hand muted" style={{ fontSize: 13 }}>ny</span>;
  if (state.lastResult === 'wrong') return <span className="t-hand" style={{ fontSize: 13, color: 'var(--berry-deep)' }}>✗ missad</span>;
  if (state.box >= 3) return <span className="t-hand" style={{ fontSize: 13, color: 'var(--leaf-deep, #1f7a52)' }}>✓ sitter</span>;
  return <span className="t-hand muted" style={{ fontSize: 13 }}>↻ övar</span>;
}

const RESULT_LABEL = { correct: 'Rätt', partial: 'Delvis rätt', wrong: 'Inte rätt än' };

function PaperFeedback({ paper }) {
  const [open, setOpen] = useState(false);
  if (!paper) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen((o) => !o)} style={{ padding: '4px 8px' }}>
        📷 På papper: {RESULT_LABEL[paper.result]} {open ? '▴' : '▾'}
      </button>
      {open && paper.feedback && (
        <div className="card" style={{ padding: 12, marginTop: 6, background: 'var(--sky-soft)' }}>
          <div className="t-hand muted" style={{ fontSize: 13, marginBottom: 4 }}>
            AI:ns återkoppling · {new Date(paper.at).toLocaleDateString('sv-SE')}
          </div>
          <StudyMarkdown>{paper.feedback}</StudyMarkdown>
        </div>
      )}
    </div>
  );
}

function PaperButton({ code }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Rätta min lösning på Glosan-uppgift ${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* clipboard saknas — tipset räcker */ }
  };
  return (
    <button type="button" className="btn btn-sm" onClick={copy} title="Kopiera en text att skicka till din AI tillsammans med fotot">
      {copied ? 'Kopierat ✓' : '✏️ Lös på papper'}
    </button>
  );
}

export default function PluggaUnit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { apiFetch } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(null);
  const [sharing, setSharing] = useState(false);
  const loadedFor = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await fetchStudyUnit(apiFetch, id);
      setData(d);
      if (loadedFor.current !== id) {
        loadedFor.current = id;
        setTab(d.pages.length ? 'pages' : 'exercises');
      }
    } catch (e) {
      setError(e.message);
    }
  }, [apiFetch, id]);

  useEffect(() => { load(); }, [load]);
  useDocumentTitle(data ? `${data.unit.title} — Plugga` : 'Plugga');
  useReadingSession(apiFetch, id, tab === 'pages' && !!data?.pages.length);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="t-hand muted">Glo öppnar området…</p>;

  const { unit, pages, items } = data;
  const cards = items.filter((i) => i.kind === 'card');
  const exercises = items.filter((i) => i.kind === 'exercise');
  const days = daysUntil(unit.examDate);
  const back = `/plugga/omrade/${unit.id}`;
  const leave = async () => {
    if (!window.confirm(`Lämna "${unit.title}"? Du kan gå med igen om ${unit.sharedBy} delar det på nytt.`)) return;
    try {
      await leaveStudyUnit(apiFetch, unit.id);
      navigate(`/plugga/amne/${unit.subject}`);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <Link to={`/plugga/amne/${unit.subject}?term=${unit.term}`} className="t-hand" style={{ fontSize: 15 }}>
          ← {unit.emoji} {unit.subjectLabel}
        </Link>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'baseline', marginTop: 6 }}>
          <CodeTag code={unit.code} />
          <h1 style={{ fontSize: 34, margin: 0 }}>{unit.title}</h1>
        </div>
        <p className="t-hand muted" style={{ margin: '4px 0 0', fontSize: 15 }}>
          {[unit.termLabel, unit.gradeYear ? `åk ${unit.gradeYear}` : null, unit.source?.book, unit.source?.chapter, unit.source?.pages ? `s. ${unit.source.pages}` : null]
            .filter(Boolean).join(' · ')}
          {unit.sharedBy ? ` · delad av ${unit.sharedBy}` : ''}
        </p>
        {days !== null && days >= 0 && (
          <p style={{ margin: '6px 0 0', fontWeight: 800, color: days <= 3 ? 'var(--berry-deep)' : 'inherit' }}>
            📅 Prov {days === 0 ? 'idag — lycka till!' : days === 1 ? 'imorgon' : `om ${days} dagar`}
          </p>
        )}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {unit.isOwner ? (
            <button type="button" className="btn btn-sm" onClick={() => setSharing(true)}>
              👥 Dela{unit.sharedCount ? ` · ${unit.sharedCount} ${unit.sharedCount === 1 ? 'kompis' : 'kompisar'}` : ''}
            </button>
          ) : (
            <button type="button" className="btn btn-sm btn-ghost" onClick={leave}>Lämna området</button>
          )}
        </div>
      </div>

      {sharing && <ShareUnitDialog unit={unit} onClose={() => setSharing(false)} onChanged={load} />}

      <div className="card">
        <ProgressBar progress={unit.progress} />
        {items.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <PracticePicker
              hasCards={cards.length > 0}
              hasExercises={exercises.length > 0}
              onStart={(opts) => navigate(practiceUrl({ unitIds: [unit.id], back }, opts))}
            />
          </div>
        )}
      </div>

      <div className="study-tabs" role="tablist">
        {pages.length > 0 && (
          <button type="button" role="tab" aria-selected={tab === 'pages'} className={`btn btn-sm ${tab === 'pages' ? 'btn-primary' : ''}`} onClick={() => setTab('pages')}>
            Genomgång
          </button>
        )}
        <button type="button" role="tab" aria-selected={tab === 'cards'} className={`btn btn-sm ${tab === 'cards' ? 'btn-primary' : ''}`} onClick={() => setTab('cards')}>
          Kort ({cards.length})
        </button>
        <button type="button" role="tab" aria-selected={tab === 'exercises'} className={`btn btn-sm ${tab === 'exercises' ? 'btn-primary' : ''}`} onClick={() => setTab('exercises')}>
          Övningar ({exercises.length})
        </button>
      </div>

      {tab === 'pages' && (
        <div className="stack" style={{ gap: 16 }}>
          {pages.map((p) => (
            <article key={p.id} className="card card-lg">
              <h2 style={{ marginTop: 0 }}>{p.title}</h2>
              <StudyMarkdown>{p.body}</StudyMarkdown>
            </article>
          ))}
        </div>
      )}

      {tab === 'cards' && (
        <div className="card">
          {cards.length === 0 && <p className="t-hand muted" style={{ margin: 0 }}>Inga kort i det här området.</p>}
          {cards.map((c) => (
            <details key={c.id} className="unit-item">
              <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <CodeTag code={c.code} />
                  <LevelPill level={c.level} />
                  <StateBadge state={c.state} />
                </div>
                <div style={{ marginTop: 6 }}><StudyMarkdown>{c.prompt}</StudyMarkdown></div>
              </summary>
              <div className="card" style={{ padding: 12, marginTop: 8, background: 'var(--paper-edge)' }}>
                <StudyMarkdown>{c.back}</StudyMarkdown>
              </div>
            </details>
          ))}
        </div>
      )}

      {tab === 'exercises' && (
        <div className="stack" style={{ gap: 14 }}>
          {exercises.length > 0 && (
            <div className="card" style={{ background: 'var(--sky-soft)' }}>
              <strong>✏️ Lös på papper?</strong>
              <p style={{ margin: '4px 0 0' }}>
                Skriv uppgiftens kod (t.ex. <span className="study-code">{exercises[0].code}</span>) överst på pappret, lös uppgiften,
                fota den och skicka till din AI med texten <em>"Rätta min lösning på Glosan-uppgift {exercises[0].code}"</em>.
                Du får tips och resultatet sparas här.
              </p>
            </div>
          )}
          <div className="card">
            {exercises.length === 0 && <p className="t-hand muted" style={{ margin: 0 }}>Inga övningar i det här området.</p>}
            {exercises.map((e) => (
              <div key={e.id} className="unit-item">
                <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <CodeTag code={e.code} />
                    <LevelPill level={e.level} />
                    <StateBadge state={e.state} />
                    {e.sourceRef && <span className="t-hand muted" style={{ fontSize: 13 }}>som {e.sourceRef}</span>}
                  </div>
                  <PaperButton code={e.code} />
                </div>
                <div style={{ marginTop: 8 }}><StudyMarkdown>{e.prompt}</StudyMarkdown></div>
                <PaperFeedback paper={e.lastPaper} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
