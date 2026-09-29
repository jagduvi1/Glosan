import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGamification } from '../contexts/GamificationContext';
import { startStudySession, answerStudyItem, finishStudySession, flagStudyItem } from '../api/study';
import StudyMarkdown from '../components/StudyMarkdown';
import { LevelPill, CodeTag, LadderSteps, LEVEL_LABEL, practiceUrl, formatDuration } from '../components/study/StudyBits';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import '../styles/study.css';

// Pluggpasset: kort (vänd + bedöm dig själv) och övningar (tal, flerval,
// kort text, öppna frågor). Rättningen sker på servern med rena regler —
// ingen AI. Omfånget kommer från URL:en (se practiceUrl i StudyBits).

const RESULT_TEXT = { correct: 'Rätt! 🎉', partial: 'Nästan!', wrong: 'Inte rätt den här gången' };
const SELF_CARD = [
  { self: 'correct', label: 'Kunde ✓' },
  { self: 'partial', label: 'Nästan' },
  { self: 'wrong', label: 'Kunde inte' }
];
const SELF_OPEN = [
  { self: 'correct', label: 'Klarade det ✓' },
  { self: 'partial', label: 'Delvis' },
  { self: 'wrong', label: 'Inte än' }
];

function readScope(params) {
  const list = (k) => (params.get(k) ? params.get(k).split(',').filter(Boolean) : undefined);
  return {
    unitIds: list('units'),
    folderId: params.get('folder') || undefined,
    subject: params.get('subject') || undefined,
    group: params.get('group') || undefined,
    term: params.get('term') || undefined,
    allTerms: params.get('allTerms') === '1',
    mode: params.get('mode') || 'mixed',
    levels: list('levels'),
    count: Number(params.get('count')) || 15,
    back: params.get('back') || '/plugga'
  };
}

function FlagForm({ itemId }) {
  const { apiFetch } = useAuth();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [state, setState] = useState('idle');
  if (state === 'sent') return <p className="t-hand muted" style={{ margin: 0, fontSize: 14 }}>Tack! Rapporten skickas till den som skapade området.</p>;
  if (!open) {
    return (
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)} style={{ padding: '4px 8px' }}>
        🚩 Fel i facit?
      </button>
    );
  }
  const send = async () => {
    setState('sending');
    try {
      await flagStudyItem(apiFetch, itemId, note);
      setState('sent');
    } catch {
      setState('error');
    }
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <textarea className="inp" rows={2} maxLength={500} placeholder="Vad är fel? (valfritt)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-sm" onClick={send} disabled={state === 'sending'}>Skicka rapport</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>Avbryt</button>
        {state === 'error' && <span className="error" style={{ fontSize: 14 }}>Kunde inte skicka.</span>}
      </div>
    </div>
  );
}

export default function PluggaPractice() {
  useDocumentTitle('Öva — Plugga');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { apiFetch } = useAuth();
  const { refresh } = useGamification();
  const scope = useMemo(() => readScope(params), [params]);

  const [session, setSession] = useState(null);
  const [items, setItems] = useState([]);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState('loading'); // loading | question | feedback | done | empty
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [hintsShown, setHintsShown] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const [invalidMsg, setInvalidMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [summary, setSummary] = useState(null);
  const [missed, setMissed] = useState(0);
  // Nivåstegen: { level, reached, levels, count, moved } — nästa uppgift kommer med varje svar.
  const [ladder, setLadder] = useState(null);
  const finished = useRef(false);
  const answeredCount = useRef(0);
  const sessionRef = useRef(null);

  useEffect(() => {
    let active = true;
    setPhase('loading');
    startStudySession(apiFetch, {
      unitIds: scope.unitIds, folderId: scope.folderId, subject: scope.subject, group: scope.group, term: scope.term,
      allTerms: scope.allTerms, mode: scope.mode, levels: scope.levels, count: scope.count
    })
      .then((r) => {
        if (!active) return;
        setSession(r.session);
        sessionRef.current = r.session;
        setItems(r.items);
        setLadder(r.ladder ? { ...r.ladder, moved: null } : null);
        setIndex(0);
        setPhase('question');
      })
      .catch((e) => {
        if (!active) return;
        setMessage(e.message);
        setPhase('empty');
      });
    return () => { active = false; };
  }, [apiFetch, scope]);

  // Lämnar man mitt i ett pass sparas ändå XP för det man hunnit svara på.
  // Bara vid unmount (tom dep-array + ref) — aldrig mitt i ett pass.
  const apiFetchRef = useRef(apiFetch);
  apiFetchRef.current = apiFetch;
  useEffect(() => () => {
    if (sessionRef.current && !finished.current && answeredCount.current > 0) {
      finishStudySession(apiFetchRef.current, sessionRef.current.id).catch(() => {});
    }
  }, []);

  const current = items[index];

  const resetForNext = () => {
    setAnswer('');
    setRevealed(false);
    setHintsShown(0);
    setFeedback(null);
    setInvalidMsg('');
  };

  const submit = async (payload) => {
    if (busy || !current) return;
    setBusy(true);
    setInvalidMsg('');
    try {
      const res = await answerStudyItem(apiFetch, session.id, { itemId: current.id, ...payload });
      answeredCount.current += 1;
      if (res.result !== 'correct') setMissed((m) => m + 1);
      if (res.ladder) {
        setLadder((cur) => ({ ...cur, level: res.ladder.level, reached: res.ladder.reached, moved: res.ladder.moved }));
        if (res.ladder.next) setItems((cur) => (cur.some((i) => i.id === res.ladder.next.id) ? cur : [...cur, res.ladder.next]));
      }
      setFeedback(res);
      setPhase('feedback');
    } catch (e) {
      if (e.status === 422) setInvalidMsg(e.data?.message || 'Svaret gick inte att tolka.');
      else setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      const s = await finishStudySession(apiFetch, session.id);
      finished.current = true;
      setSummary(s);
      setPhase('done');
      refresh?.();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (index + 1 < items.length) {
      resetForNext();
      setIndex((i) => i + 1);
      setPhase('question');
    } else {
      finish();
    }
  };

  if (phase === 'loading') return <p className="t-hand muted">Glo plockar fram uppgifter…</p>;

  if (phase === 'empty') {
    return (
      <div className="card card-lg practice-shell" style={{ textAlign: 'center' }}>
        <h2 style={{ marginTop: 0 }}>{message || 'Inget att öva på här.'}</h2>
        <Link to={scope.back} className="btn btn-primary">Tillbaka</Link>
      </div>
    );
  }

  if (phase === 'done' && summary) {
    const againUrl = practiceUrl({ ...scope, unitIds: scope.unitIds }, { mode: scope.mode, levels: scope.levels, count: scope.count });
    return (
      <div className="card card-lg practice-shell" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48 }} aria-hidden="true">{summary.perfect ? '🏆' : '💪'}</div>
        <h1 style={{ margin: '6px 0 4px' }}>{summary.perfect ? 'Alla rätt!' : 'Bra kämpat!'}</h1>
        <p style={{ fontSize: 18, margin: '0 0 12px' }}>
          {summary.correct} av {summary.answered} rätt{summary.partial ? ` · ${summary.partial} nästan` : ''}
          {' · '}{formatDuration(summary.activeSeconds)} plugg
        </p>
        <div className="row" style={{ gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
          {summary.xpEarned > 0 && <span className="pill" style={{ background: 'var(--mustard-soft)' }}>+{summary.xpEarned} XP</span>}
          {summary.ladderReached && <span className="pill" style={{ background: 'var(--sky-soft)' }}>🪜 Högsta nivå: {LEVEL_LABEL[summary.ladderReached]} · {summary.ladderReached}</span>}
          {summary.streak && (
            <span className="pill" style={{ background: 'var(--coral-soft)' }}>
              🔥 {summary.streak.current} {summary.streak.current === 1 ? 'dag' : 'dagar'} i rad
            </span>
          )}
        </div>
        <div className="row" style={{ gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          {missed > 0 && (
            <button type="button" className="btn btn-primary" onClick={() => navigate(practiceUrl(scope, { mode: 'wrong', count: scope.count }))}>
              Öva på det du missade
            </button>
          )}
          <button type="button" className="btn" onClick={() => navigate(`${againUrl}&n=${Date.now()}`)}>Öva igen</button>
          <Link to={scope.back} className="btn btn-ghost">Tillbaka</Link>
        </div>
        <p style={{ margin: '16px 0 0' }}>
          <Link to="/plugga/min-plugg?p=day" className="t-hand">📊 Se allt du pluggat idag</Link>
        </p>
      </div>
    );
  }

  if (!current) return null;
  const isCard = current.kind === 'card';
  const type = current.answerType;

  return (
    <div className="practice-shell stack" style={{ gap: 16 }}>
      <div className="row between" style={{ gap: 10, flexWrap: 'wrap' }}>
        <Link to={scope.back} className="t-hand" style={{ fontSize: 15 }}>← Avsluta</Link>
        <span className="t-hand muted">{index + 1} / {ladder ? ladder.count : items.length}</span>
      </div>
      <div className="bar-shell" style={{ height: 10 }}>
        <div className="bar-fill bar-fill-coral" style={{ width: `${Math.round((index / (ladder ? ladder.count : items.length)) * 100)}%` }} />
      </div>
      {ladder && <LadderSteps levels={ladder.levels} level={ladder.level} reached={ladder.reached} />}

      <div className="card card-lg">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <CodeTag code={current.code} />
          <LevelPill level={current.level} />
          <span className="t-hand muted" style={{ fontSize: 14 }}>{isCard ? 'Kort' : 'Övning'} · {current.unitTitle}</span>
        </div>
        <StudyMarkdown>{current.prompt}</StudyMarkdown>

        {!isCard && current.hints?.length > 0 && phase === 'question' && (
          <div style={{ marginTop: 12 }}>
            {current.hints.slice(0, hintsShown).map((h, i) => (
              <div key={i} className="card" style={{ padding: 10, marginTop: 8, background: 'var(--mustard-soft)' }}>
                💡 <StudyMarkdown inline>{h}</StudyMarkdown>
              </div>
            ))}
            {hintsShown < current.hints.length && (
              <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: 8 }} onClick={() => setHintsShown((n) => n + 1)}>
                💡 Ledtråd ({hintsShown + 1}/{current.hints.length})
              </button>
            )}
          </div>
        )}
      </div>

      {message && <p className="error">{message}</p>}

      {phase === 'question' && isCard && (
        !revealed ? (
          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => setRevealed(true)}>Vänd kortet</button>
        ) : (
          <>
            <div className="card" style={{ background: 'var(--paper-edge)' }}><StudyMarkdown>{current.back}</StudyMarkdown></div>
            <p className="t-hand muted" style={{ margin: 0, textAlign: 'center' }}>Kunde du det?</p>
            <div className="self-grade">
              {SELF_CARD.map((o) => (
                <button key={o.self} type="button" className="btn" disabled={busy} onClick={() => submit({ self: o.self })}>{o.label}</button>
              ))}
            </div>
          </>
        )
      )}

      {phase === 'question' && !isCard && (type === 'number' || type === 'text') && (
        <form
          className="stack"
          style={{ gap: 8 }}
          onSubmit={(e) => { e.preventDefault(); if (answer.trim()) submit({ answer: answer.trim() }); }}
        >
          <div className="row" style={{ gap: 8 }}>
            <input
              className="inp inp-lg grow"
              value={answer}
              onChange={(e) => { setAnswer(e.target.value); setInvalidMsg(''); }}
              inputMode={type === 'number' ? 'decimal' : 'text'}
              autoComplete="off"
              autoFocus
              maxLength={200}
              placeholder={type === 'number' ? 't.ex. 3,5 eller 7/2' : 'Skriv ditt svar'}
              aria-label="Ditt svar"
            />
            {current.unitLabel && <span className="t-hand" style={{ fontSize: 18 }}>{current.unitLabel}</span>}
          </div>
          {invalidMsg && <p className="error" style={{ margin: 0 }}>{invalidMsg}</p>}
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy || !answer.trim()}>Svara</button>
        </form>
      )}

      {phase === 'question' && !isCard && type === 'choice' && (
        <div className="stack" style={{ gap: 10 }}>
          {current.choices.map((c, i) => (
            <button key={i} type="button" className="btn practice-choice" disabled={busy} onClick={() => submit({ answer: i })}>
              <span className="practice-choice-key">{i + 1}</span>
              <StudyMarkdown inline>{c}</StudyMarkdown>
            </button>
          ))}
        </div>
      )}

      {phase === 'question' && !isCard && type === 'self' && (
        <div className="stack" style={{ gap: 10 }}>
          <textarea
            className="inp"
            rows={4}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Skriv ditt svar här (valfritt) — eller lös på papper och låt din AI rätta"
          />
          {!revealed ? (
            <button type="button" className="btn btn-primary" onClick={() => setRevealed(true)}>Visa modellsvar</button>
          ) : (
            <>
              <div className="card" style={{ background: 'var(--paper-edge)' }}>
                <div className="t-hand muted" style={{ fontSize: 14, marginBottom: 4 }}>Modellsvar</div>
                <StudyMarkdown>{current.modelAnswer}</StudyMarkdown>
              </div>
              <p className="t-hand muted" style={{ margin: 0, textAlign: 'center' }}>Jämför med ditt svar — hur gick det?</p>
              <div className="self-grade">
                {SELF_OPEN.map((o) => (
                  <button
                    key={o.self}
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => submit({ self: o.self, ...(answer.trim() ? { answer: answer.trim().slice(0, 200) } : {}) })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {phase === 'feedback' && feedback && (
        <div className="stack" style={{ gap: 12 }}>
          {ladder?.moved === 'up' && (
            <div className="ladder-moved is-up">🎉 Snyggt — upp till {LEVEL_LABEL[ladder.level]} · {ladder.level}!</div>
          )}
          {ladder?.moved === 'down' && (
            <div className="ladder-moved is-down">Vi tar det lite lugnare — tillbaka till {LEVEL_LABEL[ladder.level]} · {ladder.level}. Du klättrar snart igen.</div>
          )}
          <div className={`result-banner result-${feedback.result}`}>
            {RESULT_TEXT[feedback.result]}
            {feedback.note && <div style={{ fontWeight: 600, fontSize: 16, marginTop: 4 }}>{feedback.note}</div>}
          </div>
          {!isCard && type !== 'self' && feedback.expected && feedback.result !== 'correct' && (
            <p style={{ margin: 0, fontSize: 18 }}>
              Rätt svar: <strong><StudyMarkdown inline>{feedback.expected}</StudyMarkdown></strong>
            </p>
          )}
          {!isCard && feedback.solution && (
            <details open={feedback.result !== 'correct'} className="card" style={{ padding: 14 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 800 }}>Så löser man den</summary>
              <div style={{ marginTop: 8 }}><StudyMarkdown>{feedback.solution}</StudyMarkdown></div>
            </details>
          )}
          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={next} disabled={busy} autoFocus>
            {index + 1 < items.length ? 'Nästa →' : 'Se resultat →'}
          </button>
          <div style={{ textAlign: 'center' }}>
            <FlagForm key={current.id} itemId={current.id} />
          </div>
        </div>
      )}
    </div>
  );
}
