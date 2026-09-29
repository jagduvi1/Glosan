import { Fragment, memo, useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGamification } from '../contexts/GamificationContext';
import { fetchStudyTest, startStudyTest, submitStudyTest, assessStudyTest, pingStudySession } from '../api/study';
import StudyMarkdown from '../components/StudyMarkdown';
import { MultiChoice, OrderList } from '../components/study/AnswerInputs';
import { CodeTag } from '../components/study/StudyBits';
import { PointsLabel, GradeBadge, LimitsText, pointsText, pointsTotal } from '../components/study/TestBits';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import ConfirmDialog from '../components/ConfirmDialog';
import '../styles/study.css';

// Övningsprov i appen: översikt → skriv provet (alla frågor på en sida, som
// ett riktigt prov; ev. tidsgräns) → lämna in → bedöm dina öppna svar mot
// modellsvaret → resultat. Rättningen sker på servern utan AI. Svaren sparas
// lokalt medan man skriver, så en omladdning inte tömmer provet.

const PING_MS = 30 * 1000;
const DRAFT_PREFIX = 'glosan.test.';
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const draftKey = (attemptId) => `${DRAFT_PREFIX}${attemptId}`;
const SELF_OPTIONS = [
  { level: 'E', label: 'E — enkelt' },
  { level: 'C', label: 'C — utvecklat' },
  { level: 'A', label: 'A — välutvecklat' }
];

// Utkast: { at, answers }. Gamla utkast (övergivna prov) städas bort, så de
// inte blir kvar på en delad skoldator.
function pruneDrafts() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(DRAFT_PREFIX)) continue;
      const at = JSON.parse(localStorage.getItem(key) || '{}')?.at || 0;
      if (Date.now() - at > DRAFT_MAX_AGE_MS) localStorage.removeItem(key);
    }
  } catch { /* ignore */ }
}
function loadDraft(attemptId) {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey(attemptId)) || '{}') || {};
    return d.answers && typeof d.answers === 'object' ? d.answers : {};
  } catch { return {}; }
}
function saveDraft(attemptId, answers) {
  try { localStorage.setItem(draftKey(attemptId), JSON.stringify({ at: Date.now(), answers })); } catch { /* privat läge — svaren finns ändå i sidan */ }
}
function clearDraft(attemptId) {
  try { localStorage.removeItem(draftKey(attemptId)); } catch { /* ignore */ }
}

const isAnswered = (v) => v !== undefined && v !== null && !(typeof v === 'string' && !v.trim());

function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Klockan är en egen komponent: bara den ritas om varje sekund, inte hela
 * provet. Den räknar mot serverns deadline med datorns klocka korrigerad
 * (offset = serverns tid − datorns när provet hämtades), så en fel ställd
 * klocka inte lämnar in provet i förtid. onTimeUp anropas en gång.
 */
function TestClock({ deadline, offset, onTimeUp }) {
  const left = () => deadline - (Date.now() + offset);
  const [ms, setMs] = useState(left);
  const fired = useRef(false);
  const onTimeUpRef = useRef(onTimeUp);
  onTimeUpRef.current = onTimeUp;
  useEffect(() => {
    const tick = () => {
      const m = deadline - (Date.now() + offset);
      setMs(m);
      if (m <= 0 && !fired.current) {
        fired.current = true;
        onTimeUpRef.current();
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [deadline, offset]);
  const low = ms < 5 * 60 * 1000;
  return (
    <span className="test-clock" role="timer" style={{ color: low ? 'var(--berry-deep)' : 'inherit' }} aria-label="Tid kvar">⏱ {clock(ms)}</span>
  );
}

function Overview({ data, onStart, busy }) {
  const { test, attempts, inProgress } = data;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <Link to={`/plugga/omrade/${test.unit.id}`} className="t-hand" style={{ fontSize: 15 }}>
          ← {test.unit.emoji} {test.unit.code} {test.unit.title}
        </Link>
        <h1 style={{ fontSize: 34, margin: '6px 0 0' }}>📝 {test.title}</h1>
        {test.description && <p style={{ margin: '6px 0 0', whiteSpace: 'pre-line' }}>{test.description}</p>}
      </div>

      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <span className="pill">{test.questionCount} frågor</span>
          <span className="pill">{pointsTotal(test.max)} poäng ({pointsText(test.max)} E/C/A)</span>
          <span className="pill">{test.timeLimitMin ? `⏱ ${test.timeLimitMin} min` : 'Ingen tidsgräns'}</span>
        </div>
        <p className="t-hand muted" style={{ margin: '0 0 14px' }}>
          Inga ledtrådar under provet. Du ser facit och ditt uppskattade betyg när du lämnat in.
        </p>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary btn-lg" onClick={onStart} disabled={busy}>
            {busy ? 'Startar…' : inProgress ? 'Fortsätt provet →' : 'Starta provet →'}
          </button>
          <Link to={`/plugga/prov/${test.id}/papper`} className="btn btn-lg">🖨️ Gör det på papper</Link>
        </div>
      </div>

      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 800 }}>Så räknas betyget</summary>
        <p style={{ margin: '8px 0 0' }}>Varje fråga ger poäng på nivåerna E, C och A — som på de nationella proven. Ungefärliga gränser:</p>
        <LimitsText limits={test.limits} max={test.max} />
        <p className="t-hand muted" style={{ margin: '8px 0 0', fontSize: 14 }}>Betyget är bara en uppskattning — det är läraren som sätter betyg.</p>
      </details>

      {attempts.length > 0 && (
        <div className="card">
          <h3 style={{ margin: '0 0 6px' }}>Dina resultat</h3>
          {attempts.map((a) => (
            <Link key={a.id} to={`/plugga/prov/${test.id}/resultat/${a.id}`} className="unit-item row between" style={{ display: 'flex', gap: 10, color: 'inherit', textDecoration: 'none', alignItems: 'center' }}>
              <span className="row" style={{ gap: 10, alignItems: 'center' }}>
                <GradeBadge grade={a.grade} size={36} />
                <span>
                  <strong>{a.score.total} av {a.max.total} poäng</strong>
                  <span className="t-hand muted" style={{ display: 'block', fontSize: 14 }}>
                    {new Date(a.finishedAt).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {a.source === 'paper' ? ' · 📷 på papper' : ''}
                  </span>
                </span>
              </span>
              <span className="t-hand">Se svaren ›</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionInput({ q, value, onChange, invalid }) {
  if (q.answerType === 'multi') {
    return (
      <>
        <MultiChoice choices={q.choices} value={value || []} onChange={(v) => onChange(v.length ? v : undefined)} />
        {invalid && <p className="error" style={{ margin: '6px 0 0' }}>{invalid}</p>}
      </>
    );
  }
  if (q.answerType === 'order') {
    // Ordningen som visas är svaret (den förifylls när provet startar).
    return (
      <>
        <OrderList items={value || q.items} onChange={onChange} />
        {invalid && <p className="error" style={{ margin: '6px 0 0' }}>{invalid}</p>}
      </>
    );
  }
  if (q.answerType === 'choice') {
    return (
      <div className="stack" style={{ gap: 8 }} role="radiogroup" aria-label={`Svar på fråga ${q.n}`}>
        {q.choices.map((c, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i}
            className={`btn practice-choice ${value === i ? 'is-picked' : ''}`}
            onClick={() => onChange(value === i ? undefined : i)}
          >
            <span className="practice-choice-key">{String.fromCharCode(65 + i)}</span>
            <StudyMarkdown inline>{c}</StudyMarkdown>
          </button>
        ))}
      </div>
    );
  }
  if (q.answerType === 'self') {
    return (
      <textarea
        className="inp"
        rows={5}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        maxLength={2000}
        placeholder="Skriv ditt svar. Du jämför det själv med modellsvaret när du lämnat in."
        aria-label={`Svar på fråga ${q.n}`}
      />
    );
  }
  return (
    <div>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input
          className="inp inp-lg grow"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          inputMode={q.answerType === 'number' ? 'decimal' : 'text'}
          autoComplete="off"
          maxLength={200}
          placeholder={q.answerType === 'number' ? 'Svar, t.ex. 3,5' : q.answerType === 'factors' ? 't.ex. 2·3·3·5' : 'Svar'}
          aria-label={`Svar på fråga ${q.n}`}
          aria-invalid={Boolean(invalid)}
        />
        {q.unitLabel && <span className="t-hand" style={{ fontSize: 18 }}>{q.unitLabel}</span>}
      </div>
      {invalid && <p className="error" style={{ margin: '6px 0 0' }}>{invalid}</p>}
    </div>
  );
}

/** En fråga på provet. memo + stabil onAnswer: ett tangenttryck ritar bara om sin egen fråga. */
const QuestionCard = memo(function QuestionCard({ q, part, value, invalid, onAnswer }) {
  return (
    <>
      {part && <h2 className="test-part">{part}</h2>}
      <div id={`q-${q.itemId}`} className="card card-lg" style={invalid ? { outline: '3px solid var(--berry)' } : undefined}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
          <strong>Fråga {q.n}</strong>
          <CodeTag code={q.code} />
          <PointsLabel points={q.points} />
        </div>
        <StudyMarkdown>{q.prompt}</StudyMarkdown>
        <div style={{ marginTop: 12 }}>
          <QuestionInput q={q} value={value} invalid={invalid} onChange={(v) => onAnswer(q.itemId, v)} />
        </div>
      </div>
    </>
  );
});

function SelfAssess({ items, levels, setLevels, onDone, busy, error }) {
  const all = items.every((it) => levels[it.itemId]);
  return (
    <div className="practice-shell stack" style={{ gap: 16 }}>
      <div className="card" style={{ background: 'var(--mustard-soft)' }}>
        <h2 style={{ margin: '0 0 4px' }}>Nästan klart!</h2>
        <p style={{ margin: 0 }}>
          De här frågorna rättar du själv: jämför ditt svar med modellsvaret och välj vilken nivå det når —
          <strong> enkla</strong>, <strong>utvecklade</strong> eller <strong>välutvecklade</strong> resonemang. Var ärlig, det är du som lär dig.
        </p>
      </div>
      {items.map((it) => {
        const options = SELF_OPTIONS.filter((o) => (it.points?.[o.level] || 0) > 0);
        let cumulative = 0;
        return (
          <div key={it.itemId} className="card card-lg">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <strong>Fråga {it.n}</strong>
              <CodeTag code={it.code} />
              <PointsLabel points={it.points} />
            </div>
            <StudyMarkdown>{it.prompt}</StudyMarkdown>
            <div className="card" style={{ padding: 12, marginTop: 10, background: 'var(--paper-deep)' }}>
              <div className="t-hand muted" style={{ fontSize: 14, marginBottom: 4 }}>Ditt svar</div>
              {it.given ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{it.given}</p> : <p className="t-hand muted" style={{ margin: 0 }}>(inget skrivet — tänk på vad du hade svarat)</p>}
            </div>
            <div className="card" style={{ padding: 12, marginTop: 10, background: 'var(--paper-edge)' }}>
              <div className="t-hand muted" style={{ fontSize: 14, marginBottom: 4 }}>Modellsvar</div>
              <StudyMarkdown>{it.modelAnswer}</StudyMarkdown>
            </div>
            <p className="t-hand" style={{ margin: '12px 0 6px' }}>Vilken nivå når ditt svar?</p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }} role="radiogroup" aria-label={`Nivå för fråga ${it.n}`}>
              <button type="button" className="chip" role="radio" aria-checked={levels[it.itemId] === 'none'} onClick={() => setLevels((c) => ({ ...c, [it.itemId]: 'none' }))}>
                Inte än (0 p)
              </button>
              {options.map((o) => {
                cumulative += it.points[o.level];
                return (
                  <button key={o.level} type="button" className="chip" role="radio" aria-checked={levels[it.itemId] === o.level} onClick={() => setLevels((c) => ({ ...c, [it.itemId]: o.level }))}>
                    {o.label} ({cumulative} p)
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {error && <p className="error">{error}</p>}
      <button type="button" className="btn btn-primary btn-lg btn-block" disabled={!all || busy} onClick={onDone}>
        {busy ? 'Räknar…' : all ? 'Visa resultatet →' : 'Bedöm alla frågor först'}
      </button>
    </div>
  );
}

export default function PluggaTest() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { apiFetch } = useAuth();
  const { refresh } = useGamification();
  const [overview, setOverview] = useState(null);
  const [run, setRun] = useState(null);
  const [phase, setPhase] = useState('overview'); // overview | taking | self
  const [answers, setAnswers] = useState({});
  const [invalid, setInvalid] = useState({});
  const [needsSelf, setNeedsSelf] = useState([]);
  const [levels, setLevels] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [timeUp, setTimeUp] = useState(false);
  const [confirmUnanswered, setConfirmUnanswered] = useState(0);
  const autoSubmitted = useRef(false);

  useDocumentTitle(overview ? `${overview.test.title} — Plugga` : 'Övningsprov');

  useEffect(() => {
    fetchStudyTest(apiFetch, id).then(setOverview).catch((e) => setError(e.message));
  }, [apiFetch, id]);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      pruneDrafts();
      const r = await startStudyTest(apiFetch, id);
      // Datorns klocka kan gå fel — räkna med serverns tid.
      const offset = r.attempt.serverNow ? new Date(r.attempt.serverNow).getTime() - Date.now() : 0;
      setRun({ ...r, clockOffset: offset });
      // Ordna-frågor: ordningen som visas är svaret tills eleven ändrar den.
      const shown = Object.fromEntries(r.questions.filter((q) => q.answerType === 'order').map((q) => [q.itemId, q.items]));
      setAnswers({ ...shown, ...loadDraft(r.attempt.id) });
      if (r.needsSelf?.length) {
        setNeedsSelf(r.needsSelf);
        setPhase('self');
      } else {
        setPhase('taking');
      }
      window.scrollTo(0, 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Spara utkastet lokalt medan man skriver.
  useEffect(() => {
    if (run && phase === 'taking') saveDraft(run.attempt.id, answers);
  }, [run, phase, answers]);

  // Pluggtid: pinga provets pass medan fliken syns.
  useEffect(() => {
    const sessionId = run?.attempt.sessionId;
    if (!sessionId || phase === 'overview') return undefined;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') pingStudySession(apiFetch, sessionId).catch(() => {});
    }, PING_MS);
    return () => clearInterval(t);
  }, [apiFetch, run, phase]);

  const deadline = run?.attempt.deadline ? new Date(run.attempt.deadline).getTime() : null;

  const finishWith = useCallback((r) => {
    clearDraft(r.attemptId);
    refresh?.();
    navigate(`/plugga/prov/${id}/resultat/${r.attemptId}`);
  }, [id, navigate, refresh]);

  const submit = useCallback(async ({ force = false, lenient = false } = {}) => {
    if (!run || busy) return;
    const unanswered = run.questions.filter((q) => !isAnswered(answers[q.itemId])).length;
    if (!force && unanswered > 0) {
      setConfirmUnanswered(unanswered);
      return;
    }
    setConfirmUnanswered(0);
    setBusy(true);
    setError('');
    setInvalid({});
    try {
      const list = run.questions.map((q) => ({ itemId: q.itemId, answer: isAnswered(answers[q.itemId]) ? answers[q.itemId] : null }));
      const r = await submitStudyTest(apiFetch, run.attempt.id, list, { lenient });
      if (r.status === 'awaiting_self') {
        saveDraft(run.attempt.id, answers);
        setNeedsSelf(r.needsSelf);
        setPhase('self');
        window.scrollTo(0, 0);
      } else {
        finishWith(r);
      }
    } catch (e) {
      if (e.status === 422 && e.data?.invalid) {
        setInvalid(Object.fromEntries(e.data.invalid.map((x) => [x.itemId, x.message])));
        setError(`Några svar gick inte att läsa (fråga ${e.data.invalid.map((x) => x.n).join(', ')}) — skriv om dem och lämna in igen. De räknas inte som fel.`);
        document.getElementById(`q-${e.data.invalid[0].itemId}`)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
      } else {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  }, [apiFetch, answers, busy, finishWith, run]);

  // Tiden är slut → lås svaren och lämna in (en gång). Oläsbara svar räknas
  // då som obesvarade i stället för att stoppa inlämningen.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const onTimeUp = useCallback(() => {
    setTimeUp(true);
    if (!autoSubmitted.current) {
      autoSubmitted.current = true;
      submitRef.current({ force: true, lenient: true });
    }
  }, []);

  const onAnswer = useCallback((itemId, v) => {
    setAnswers((cur) => ({ ...cur, [itemId]: v }));
    setInvalid((cur) => (cur[itemId] ? { ...cur, [itemId]: undefined } : cur));
  }, []);

  const assess = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await assessStudyTest(apiFetch, run.attempt.id, needsSelf.map((it) => ({ itemId: it.itemId, level: levels[it.itemId] })));
      finishWith(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!overview) return error ? <p className="error">{error}</p> : <p className="t-hand muted">Glo hämtar provet…</p>;
  if (phase === 'overview') {
    return (
      <>
        <Overview data={overview} onStart={start} busy={busy} />
        {error && <p className="error">{error}</p>}
      </>
    );
  }
  if (phase === 'self') {
    return <SelfAssess items={needsSelf} levels={levels} setLevels={setLevels} onDone={assess} busy={busy} error={error} />;
  }

  const answered = run.questions.filter((q) => isAnswered(answers[q.itemId])).length;

  return (
    <div className="practice-shell stack" style={{ gap: 16 }}>
      <div className="test-bar card">
        <div style={{ minWidth: 0 }}>
          <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.test.title}</strong>
          <span className="t-hand muted" style={{ fontSize: 14 }}>{answered} av {run.questions.length} besvarade</span>
        </div>
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          {deadline !== null && <TestClock deadline={deadline} offset={run.clockOffset || 0} onTimeUp={onTimeUp} />}
          <button type="button" className="btn btn-primary btn-sm" onClick={() => submit()} disabled={busy || timeUp}>Lämna in</button>
        </div>
      </div>

      {run.attempt.resumed && <p className="t-hand muted" style={{ margin: 0 }}>Du fortsätter där du var.</p>}
      {timeUp && <p className="card" role="status" style={{ margin: 0, background: 'var(--mustard-soft)' }}>⏱ Tiden är slut — provet lämnas in med det du hunnit svara.</p>}

      {/* fieldset disabled: när tiden är slut går inget svar att ändra */}
      <fieldset disabled={timeUp} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="stack">
        {run.questions.map((q, i) => (
          <Fragment key={q.itemId}>
            <QuestionCard
              q={q}
              part={q.part && q.part !== run.questions[i - 1]?.part ? q.part : ''}
              value={answers[q.itemId]}
              invalid={invalid[q.itemId]}
              onAnswer={onAnswer}
            />
          </Fragment>
        ))}
      </fieldset>

      {error && <p className="error">{error}</p>}
      <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => submit()} disabled={busy || timeUp}>
        {busy ? 'Lämnar in…' : 'Lämna in provet'}
      </button>
      {confirmUnanswered > 0 && (
        <ConfirmDialog
          title="Lämna in provet?"
          message={`${confirmUnanswered} ${confirmUnanswered === 1 ? 'fråga är' : 'frågor är'} obesvarade och ger 0 poäng.`}
          confirmLabel="Lämna in ändå"
          cancelLabel="Fortsätt skriva"
          onConfirm={() => submit({ force: true })}
          onCancel={() => setConfirmUnanswered(0)}
        />
      )}
    </div>
  );
}
