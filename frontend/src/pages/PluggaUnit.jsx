import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchStudyUnit, startStudySession, pingStudySession, finishStudySession, leaveStudyUnit, deleteStudyUnitCopy, deleteStudyItem
} from '../api/study';
import StudyMarkdown from '../components/StudyMarkdown';
import { LevelPill, CodeTag, ProgressBar, PracticePicker, practiceUrl, sheetUrl, daysUntil } from '../components/study/StudyBits';
import ShareUnitDialog from '../components/study/ShareUnitDialog';
import { copyFromLabel } from '../components/study/copyLabel';
import FolderPicker from '../components/study/FolderPicker';
import DeletedList from '../components/study/DeletedList';
import { GradeBadge, pointsText, pointsTotal } from '../components/study/TestBits';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import ConfirmDialog from '../components/ConfirmDialog';
import '../styles/study.css';

// Ett område i Plugga: genomgångar, kort och övningar. Läsning av en
// genomgång räknas som pluggtid (en "ping" var 30:e sekund medan sidan är
// synlig). Övningar kan lösas på papper: koden (t.ex. MA3-14) skrivs överst,
// eleven fotar lösningen och ber sin AI rätta — resultatet och AI:ns tips
// syns här.

const PING_MS = 30 * 1000;

/**
 * Lästid för genomgångarna: ETT läspass per besök på området (inte ett per
 * flikbyte), som startar första gången en genomgång visas. Tiden räknas bara
 * medan genomgången syns, och passet avslutas när man lämnar sidan — även när
 * fliken stängs (pagehide, keepalive), så lästiden kan ge en pluggdag.
 */
function useReadingSession(apiFetch, unitId, reading) {
  const sessionRef = useRef(null);
  const startedFor = useRef(null);
  const readingRef = useRef(reading);
  readingRef.current = reading;

  useEffect(() => {
    if (!reading || startedFor.current === unitId) return;
    startedFor.current = unitId;
    startStudySession(apiFetch, { unitIds: [unitId], mode: 'reading' })
      .then((r) => {
        if (startedFor.current === unitId) sessionRef.current = r.session.id;
        else finishStudySession(apiFetch, r.session.id).catch(() => {});
      })
      .catch(() => { if (startedFor.current === unitId) startedFor.current = null; });
  }, [apiFetch, unitId, reading]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (sessionRef.current && readingRef.current && document.visibilityState === 'visible') {
        pingStudySession(apiFetch, sessionRef.current).catch(() => {});
      }
    }, PING_MS);
    return () => clearInterval(timer);
  }, [apiFetch]);

  useEffect(() => {
    const end = (keepalive) => {
      const sid = sessionRef.current;
      sessionRef.current = null;
      if (sid) finishStudySession(apiFetch, sid, { keepalive }).catch(() => {});
    };
    const onHide = () => end(true);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      end(false);
      startedFor.current = null;
    };
  }, [apiFetch, unitId]);
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

function PaperButton({ code, prompt = null }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      // Mallövning: talen byts varje gång — skicka med uppgiften eleven faktiskt löste.
      await navigator.clipboard.writeText(`Rätta min lösning på Glosan-uppgift ${code}${prompt ? `. Uppgiften jag löste: ${prompt}` : ''}`);
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
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState(null); // { kind: 'remove', item } | { kind: 'leave' }
  const loadedFor = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await fetchStudyUnit(apiFetch, id);
      setData(d);
      if (loadedFor.current !== id) {
        loadedFor.current = id;
        // Första fliken som har något: genomgång → övningar → kort → prov.
        const has = {
          pages: d.pages.length,
          exercises: d.items.some((i) => i.kind === 'exercise'),
          cards: d.items.some((i) => i.kind === 'card'),
          tests: (d.tests || []).length
        };
        setTab(['pages', 'exercises', 'cards', 'tests'].find((t) => has[t]) || 'exercises');
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
  const tests = data.tests || [];
  const cards = items.filter((i) => i.kind === 'card');
  const exercises = items.filter((i) => i.kind === 'exercise');
  const days = daysUntil(unit.examDate);
  const back = `/plugga/omrade/${unit.id}`;
  // Papperskorgen (bara skaparen): uppgiften tas bort för alla och loggas under "Borttaget".
  const removeItem = async (item) => {
    setConfirming(null);
    setNotice('');
    try {
      await deleteStudyItem(apiFetch, item.id);
      await load();
    } catch (e) {
      setNotice(e.message);
    }
  };
  const leave = async () => {
    setConfirming(null);
    try {
      await leaveStudyUnit(apiFetch, unit.id);
      navigate(`/plugga/amne/${unit.subject}`);
    } catch (e) {
      setError(e.message);
    }
  };
  const removeCopy = async () => {
    setConfirming(null);
    try {
      await deleteStudyUnitCopy(apiFetch, unit.id);
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
          {unit.isCopy ? ` · din kopia${copyFromLabel(unit) ? ` ${copyFromLabel(unit)}` : ''}` : ''}
        </p>
        {days !== null && days >= 0 && (
          <p style={{ margin: '6px 0 0', fontWeight: 800, color: days <= 3 ? 'var(--berry-deep)' : 'inherit' }}>
            📅 Prov {days === 0 ? 'idag — lycka till!' : days === 1 ? 'imorgon' : `om ${days} dagar`}
          </p>
        )}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <button type="button" className="btn btn-sm" onClick={() => setPicking(true)}>📁 Mapp</button>
          {/* Alla som har området kan dela det — de man delar med får en egen kopia. */}
          <button type="button" className="btn btn-sm" onClick={() => setSharing(true)}>
            👥 Dela{unit.sharedCount ? ` · ${unit.sharedCount} ${unit.sharedCount === 1 ? 'kompis' : 'kompisar'}` : ''}
          </button>
          {!unit.isOwner && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming({ kind: 'leave' })}>Lämna området</button>
          )}
          {unit.isCopy && (
            <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--berry-deep)' }} onClick={() => setConfirming({ kind: 'removeCopy' })}>
              Ta bort kopian
            </button>
          )}
        </div>
      </div>

      {sharing && <ShareUnitDialog unit={unit} onClose={() => setSharing(false)} onChanged={load} />}
      {picking && <FolderPicker unitIds={[unit.id]} onClose={() => setPicking(false)} />}
      {confirming?.kind === 'remove' && (
        <ConfirmDialog
          title={`Ta bort ${confirming.item.code}?`}
          message={unit.isCopy
            ? 'Den försvinner ur din kopia. Du kan ångra under ”Borttaget”.'
            : 'Den försvinner ur området — men inte ur kopior du gett bort. Du kan ångra under ”Borttaget”.'}
          confirmLabel="Ta bort"
          destructive
          onConfirm={() => removeItem(confirming.item)}
          onCancel={() => setConfirming(null)}
        />
      )}
      {confirming?.kind === 'leave' && (
        <ConfirmDialog
          title="Lämna området?"
          message={`Du kan gå med igen om ${unit.sharedBy || 'någon'} delar det på nytt.`}
          confirmLabel="Lämna"
          onConfirm={leave}
          onCancel={() => setConfirming(null)}
        />
      )}
      {confirming?.kind === 'removeCopy' && (
        <ConfirmDialog
          title="Ta bort din kopia?"
          message={`Hela området försvinner ur din Plugga, med din statistik på det. ${unit.copiedFrom || 'Den som delade'} har kvar sitt — och kan dela det med dig igen.`}
          confirmLabel="Ta bort"
          destructive
          onConfirm={removeCopy}
          onCancel={() => setConfirming(null)}
        />
      )}

      <div className="card">
        <ProgressBar progress={unit.progress} />
        {data.levelProgress && ['E', 'C', 'A'].some((l) => data.levelProgress[l].total > 0) && (
          <div className="level-meter" style={{ marginTop: 12 }} aria-label="Hur mycket som sitter per nivå">
            {['E', 'C', 'A'].filter((l) => data.levelProgress[l].total > 0).map((l) => {
              const lp = data.levelProgress[l];
              return (
                <div key={l}>
                  <div className="row between" style={{ gap: 6, alignItems: 'center' }}>
                    <LevelPill level={l} />
                    <span className="t-hand muted" style={{ fontSize: 13 }}>{lp.mastered}/{lp.total}</span>
                  </div>
                  <div className="bar-shell" style={{ height: 8, marginTop: 4 }}>
                    <div className="bar-fill bar-fill-leaf" style={{ width: `${Math.round((lp.mastered / lp.total) * 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {items.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <PracticePicker
              hasCards={cards.length > 0}
              hasExercises={exercises.length > 0}
              onStart={(opts) => navigate(practiceUrl({ unitIds: [unit.id], back }, opts))}
              onPrint={(opts) => navigate(sheetUrl({ unitIds: [unit.id], back }, opts))}
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
        {tests.length > 0 && (
          <button type="button" role="tab" aria-selected={tab === 'tests'} className={`btn btn-sm ${tab === 'tests' ? 'btn-primary' : ''}`} onClick={() => setTab('tests')}>
            📝 Prov ({tests.length})
          </button>
        )}
      </div>

      {tab === 'tests' && (
        <div className="stack" style={{ gap: 12 }}>
          {tests.map((t) => (
            <div key={t.id} className="card">
              <div className="row between" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0, fontSize: 21 }}>📝 {t.title}</h3>
                  <p className="t-hand muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
                    {t.questionCount} frågor · {pointsTotal(t.max)} poäng ({pointsText(t.max)} E/C/A){t.timeLimitMin ? ` · ${t.timeLimitMin} min` : ''}
                  </p>
                  {t.description && <p style={{ margin: '6px 0 0', fontSize: 15, whiteSpace: 'pre-line' }}>{t.description}</p>}
                </div>
                {t.best && (
                  <Link to={`/plugga/prov/${t.id}/resultat/${t.best.id}`} className="row" style={{ gap: 8, alignItems: 'center', color: 'inherit', textDecoration: 'none' }} title="Ditt bästa resultat">
                    <GradeBadge grade={t.best.grade} size={40} />
                    <span className="t-hand" style={{ fontSize: 14 }}>bäst: {t.best.score.total}/{t.best.max.total}</span>
                  </Link>
                )}
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                <Link to={`/plugga/prov/${t.id}`} className="btn btn-primary btn-sm">{t.attempts ? 'Gör provet igen' : 'Gör provet'}</Link>
                <Link to={`/plugga/prov/${t.id}/papper`} className="btn btn-sm">🖨️ På papper</Link>
              </div>
            </div>
          ))}
        </div>
      )}

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

      {notice && <p className="error" style={{ margin: 0 }}>{notice}</p>}

      {tab === 'cards' && (
        <div className="card">
          {cards.length === 0 && <p className="t-hand muted" style={{ margin: 0 }}>Inga kort i det här området.</p>}
          {cards.map((c) => (
            <details key={c.id} className="unit-item">
              <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <CodeTag code={c.code} />
                  <LevelPill level={c.level} />
                  <span className="grow"><StateBadge state={c.state} /></span>
                  {unit.isOwner && (
                    <button
                      type="button"
                      className="trash-btn"
                      title="Ta bort kortet"
                      aria-label={`Ta bort ${c.code}`}
                      onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); setConfirming({ kind: 'remove', item: c }); }}
                    >
                      🗑️
                    </button>
                  )}
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
                    {e.templated && <span className="t-hand muted" style={{ fontSize: 13 }} title="Nya tal varje gång du övar">🎲 nya tal varje gång</span>}
                  </div>
                  <div className="row" style={{ gap: 4, alignItems: 'center' }}>
                    <PaperButton code={e.code} prompt={e.templated ? e.prompt : null} />
                    {unit.isOwner && (
                      <button type="button" className="trash-btn" title="Ta bort övningen" aria-label={`Ta bort ${e.code}`} onClick={() => setConfirming({ kind: 'remove', item: e })}>
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ marginTop: 8 }}><StudyMarkdown>{e.prompt}</StudyMarkdown></div>
                <PaperFeedback paper={e.lastPaper} />
              </div>
            ))}
          </div>
        </div>
      )}

      {unit.isOwner && data.deletedCount > 0 && (tab === 'cards' || tab === 'exercises') && (
        <DeletedList unitId={unit.id} count={data.deletedCount} onRestored={load} />
      )}
    </div>
  );
}
