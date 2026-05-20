import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchList, submitScore } from '../api/lists';
import { updateGlos } from '../api/glosor';
import Flag from '../components/Flag';
import GloAvatar from '../components/GloAvatar';

const LANG_TO_FLAG = {
  fr: 'fr', de: 'de', es: 'es', en: 'uk', sv: 'se'
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Expand slash-separated alternatives in a target into every accepted phrasing.
function answerVariants(target) {
  const tokens = target.trim().split(/\s+/);
  const perToken = tokens.map((t) => t.split('/').map((s) => s.trim()).filter(Boolean));
  return perToken
    .reduce((acc, opts) => acc.flatMap((prefix) => opts.map((opt) => [...prefix, opt])), [[]])
    .map((parts) => parts.join(' ').toLowerCase());
}

function buildDistractors(currentGlos, pool) {
  const others = pool.filter((g) =>
    g._id !== currentGlos._id && g.target.trim().toLowerCase() !== currentGlos.target.trim().toLowerCase()
  );
  return shuffle(others).slice(0, 3).map((g) => g.target);
}

export default function Quiz() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode') === 'choice' ? 'choice' : 'write';
  const { apiFetch } = useAuth();
  const [list, setList] = useState(null);
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const [totalCards, setTotalCards] = useState(0);
  const [allGlosor, setAllGlosor] = useState([]);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [score, setScore] = useState({ correct: 0, wrong: 0 });
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [wrongOnly, setWrongOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setScore({ correct: 0, wrong: 0 });
    setStreak(0);
    setBestStreak(0);
    setNewBest(false);
    setFeedback(null);
    setAnswer('');
    try {
      const data = await fetchList(apiFetch, id);
      setList(data.list);
      setAllGlosor(data.glosor);
      const pool = wrongOnly
        ? data.glosor.filter((g) => (g.stats?.wrong ?? 0) > 0)
        : data.glosor;
      const shuffled = shuffle(pool);
      setTotalCards(shuffled.length);
      setQueue(shuffled.slice(1));
      setCurrent(shuffled[0] || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, id, wrongOnly]);

  useEffect(() => { load(); }, [load]);

  const options = useMemo(() => {
    if (mode !== 'choice' || !current || allGlosor.length === 0) return [];
    const distractors = buildDistractors(current, allGlosor);
    return shuffle([current.target, ...distractors]);
  }, [current, allGlosor, mode]);

  const recordAnswer = async (isCorrect, given) => {
    setFeedback({ isCorrect, expected: current.target, given });
    setScore((s) => isCorrect ? { ...s, correct: s.correct + 1 } : { ...s, wrong: s.wrong + 1 });
    const newStreak = isCorrect ? streak + 1 : 0;
    setStreak(newStreak);
    setBestStreak((b) => Math.max(b, newStreak));
    try {
      await updateGlos(apiFetch, current._id, {
        stats: {
          correct: (current.stats?.correct ?? 0) + (isCorrect ? 1 : 0),
          wrong: (current.stats?.wrong ?? 0) + (isCorrect ? 0 : 1)
        }
      });
    } catch { /* swallow */ }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (!current) return;
    const isCorrect = answerVariants(current.target).includes(answer.trim().toLowerCase());
    recordAnswer(isCorrect, answer.trim());
  };

  const onPick = (option) => {
    if (!current || feedback) return;
    const isCorrect = answerVariants(current.target).includes(option.trim().toLowerCase());
    recordAnswer(isCorrect, option);
  };

  const onNext = async () => {
    const wasLast = queue.length === 0;
    setAnswer('');
    setFeedback(null);
    setCurrent(queue[0] || null);
    setQueue((q) => q.slice(1));

    if (wasLast && !wrongOnly) {
      const total = score.correct + score.wrong;
      if (total > 0) {
        try {
          const { list: updatedList, wasNewBest } = await submitScore(apiFetch, id, {
            correct: score.correct,
            total
          });
          setList(updatedList);
          setNewBest(wasNewBest);
        } catch (err) {
          console.error('Failed to submit score:', err);
        }
      }
    }
  };

  // Keyboard 1-4 for choice mode (only when not in feedback)
  useEffect(() => {
    if (mode !== 'choice' || feedback || options.length === 0) return undefined;
    const onKey = (e) => {
      const idx = parseInt(e.key, 10) - 1;
      if (idx >= 0 && idx < options.length) onPick(options[idx]);
      else if (e.key === 'Enter' && feedback) onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, feedback, options]);

  if (loading) return <p className="t-hand muted">Glo blandar korten…</p>;
  if (error) return <p className="error">{error}</p>;

  const flag = LANG_TO_FLAG[list?.sourceLang];
  const answered = score.correct + score.wrong;
  const progress = totalCards > 0 ? (answered / totalCards) * 100 : 0;
  const modeLabel = mode === 'choice' ? '4 val' : 'skriv';
  const modeBg = mode === 'choice' ? 'var(--mustard-soft)' : 'var(--leaf-soft)';

  // Choice mode needs at least 4 glosor for distractors
  if (mode === 'choice' && allGlosor.length > 0 && allGlosor.length < 4) {
    return (
      <div className="card card-lg" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
        <GloAvatar size={120} float mood="sad" style={{ margin: '0 auto 12px' }} />
        <h2 style={{ marginBottom: 8 }}>För få glosor för 4 val</h2>
        <p className="muted" style={{ marginBottom: 18 }}>
          4-val behöver minst 4 glosor i listan för att kunna bygga distraktorer. Lägg till några till — eller välj ett annat läge.
        </p>
        <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
          <Link to={`/lists/${id}/quiz`}><button className="btn">Skriv-läge istället</button></Link>
          <Link to={`/lists/${id}`}><button className="btn btn-primary">Tillbaka till listan</button></Link>
        </div>
      </div>
    );
  }

  // End screen
  if (!current) {
    const best = list?.bestScore;
    const sessionTotal = score.correct + score.wrong;

    if (sessionTotal === 0) {
      return (
        <div className="card card-lg" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
          <GloAvatar size={120} float mood={wrongOnly ? 'wink' : 'default'} style={{ margin: '0 auto 12px' }} />
          <h2 style={{ marginBottom: 8 }}>
            {wrongOnly ? 'Inga fel-glosor att öva på' : 'Listan är tom'}
          </h2>
          <p className="muted" style={{ marginBottom: 18 }}>
            {wrongOnly
              ? 'Du har inte haft fel på några glosor än — eller så har du redan rättat alla.'
              : 'Lägg till glosor på listan först.'}
          </p>
          <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
            {wrongOnly && (
              <button className="btn" onClick={() => setWrongOnly(false)}>Öva alla glosor</button>
            )}
            <Link to={`/lists/${id}`}><button className="btn btn-primary">Tillbaka till listan</button></Link>
          </div>
        </div>
      );
    }

    return (
      <div className="card card-lg" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center', position: 'relative' }}>
        <GloAvatar size={140} float mood="wink" style={{ margin: '0 auto 8px' }} />
        {newBest && (
          <img
            src="/assets/star-sticker.svg"
            width="56"
            alt=""
            style={{ position: 'absolute', top: 18, right: 28, transform: 'rotate(18deg)' }}
          />
        )}
        <h1 style={{ fontSize: 40, margin: '6px 0' }}>
          {newBest ? <>Klart! <span className="mark-highlight">Nytt rekord.</span></> : <>Klart!</>}
        </h1>
        <p className="t-hand muted" style={{ fontSize: 18, margin: '0 0 18px' }}>
          {wrongOnly ? 'En omgång med fel-glosor — bra jobbat.' : 'Glo behöver lägga sig och vila ögonen.'}
        </p>

        <div className="row" style={{ justifyContent: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <div className="pill" style={{ background: 'var(--leaf-soft)', fontSize: 16 }}>
            ✓ {score.correct} rätt
          </div>
          <div className="pill" style={{ background: 'var(--berry-soft)', fontSize: 16 }}>
            ✗ {score.wrong} fel
          </div>
          {bestStreak >= 2 && (
            <div className="pill" style={{ background: 'var(--coral-soft)', fontSize: 16 }}>
              🔥 svit: {bestStreak}
            </div>
          )}
        </div>

        {best?.total > 0 && !wrongOnly && (
          <p className="t-hand muted" style={{ fontSize: 15, marginBottom: 18 }}>
            Bästa hittills: {best.correct} / {best.total}
            {best.achievedAt && ` (${new Date(best.achievedAt).toLocaleDateString('sv-SE')})`}
          </p>
        )}

        <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
          <button className="btn btn-primary" onClick={load}>En till runda</button>
          <Link to={`/lists/${id}`}><button className="btn">Tillbaka till listan</button></Link>
        </div>
      </div>
    );
  }

  // In-quiz
  return (
    <div style={{ marginTop: -28 }}>
      <div className="row between" style={{ padding: '14px 0', borderBottom: '2px solid var(--ink)', marginBottom: 28 }}>
        <Link to={`/lists/${id}`}>
          <button className="btn btn-ghost btn-sm" aria-label="Avbryt quiz">× Avbryt</button>
        </Link>
        <div className="bar-shell" style={{ flex: 1, margin: '0 20px' }}>
          <div className="bar-fill bar-fill-coral" style={{ width: `${progress}%` }} />
        </div>
        <span className="t-hand muted">{answered} / {totalCards}</span>
      </div>

      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div className="row between" style={{ marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {flag && (
              <span className="pill" style={{ background: 'var(--coral-soft)' }}>
                <Flag code={flag} size="sm" /> {list?.sourceLang}
              </span>
            )}
            <span className="pill" style={{ background: modeBg }}>läge: {modeLabel}</span>
            <button
              className="pill"
              style={{
                background: wrongOnly ? 'var(--berry-soft)' : 'transparent',
                border: '2px solid var(--ink)',
                cursor: 'pointer',
                font: 'inherit'
              }}
              onClick={() => setWrongOnly((v) => !v)}
              type="button"
            >
              {wrongOnly ? '✓ ' : ''}bara fel
            </button>
          </div>
        </div>

        <div className="t-hand muted" style={{ fontSize: 18, marginBottom: 8 }}>
          {mode === 'choice' ? `Vilken översättning?` : `Översätt till ${list?.targetLang}`}
        </div>

        <div className="card card-lg" style={{ padding: 36, textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: mode === 'choice' ? 80 : 96, lineHeight: 1 }}>
            {current.source}
          </div>
          {current.notes && (
            <div className="t-hand muted" style={{ fontSize: 16, marginTop: 6 }}>· {current.notes}</div>
          )}
        </div>

        {!feedback ? (
          mode === 'choice' ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 22 }}>
                {options.map((opt, i) => (
                  <button
                    key={`${opt}-${i}`}
                    className="btn"
                    onClick={() => onPick(opt)}
                    style={{ justifyContent: 'flex-start', padding: '16px 20px', fontSize: 18 }}
                  >
                    <span
                      style={{
                        width: 28, height: 28, border: '2px solid var(--ink)', borderRadius: 6,
                        fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 800,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        background: 'var(--paper-deep)', flex: 'none'
                      }}
                    >
                      {i + 1}
                    </span>
                    <span style={{ textAlign: 'left' }}>{opt}</span>
                  </button>
                ))}
              </div>
              <p className="t-hand muted" style={{ textAlign: 'center', fontSize: 13, marginTop: 14 }}>
                tryck <code>1–4</code> för att svara snabbt
              </p>
            </>
          ) : (
            <form onSubmit={onSubmit} style={{ marginTop: 24 }}>
              <input
                className="inp inp-lg"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={`skriv ${list?.targetLang}…`}
                autoFocus
                required
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <div className="row between" style={{ marginTop: 16 }}>
                <span className="t-hand muted" style={{ fontSize: 14 }}>
                  tryck <code>enter</code> för att svara
                </span>
                <button type="submit" className="btn btn-primary">Svara</button>
              </div>
            </form>
          )
        ) : (
          <div
            className="card pop-in"
            style={{
              marginTop: 24,
              background: feedback.isCorrect ? 'var(--leaf-soft)' : 'var(--berry-soft)',
              borderColor: feedback.isCorrect ? 'var(--leaf-deep)' : 'var(--berry-deep)'
            }}
          >
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <GloAvatar mood={feedback.isCorrect ? 'wink' : 'sad'} size={56} />
              <div className="grow">
                <h3 style={{ margin: 0 }}>
                  {feedback.isCorrect
                    ? 'Snyggt! Glo tappar hakan.'
                    : mode === 'choice'
                      ? `Nära! Rätt svar: ${feedback.expected}.`
                      : `Nära! Det stavas ${feedback.expected}.`}
                </h3>
                {feedback.isCorrect && streak >= 2 && (
                  <p style={{ margin: '4px 0 0', fontFamily: 'var(--font-headline)', fontSize: 22, color: 'var(--coral-deep)' }}>
                    🔥 {streak} i rad!
                  </p>
                )}
                {!feedback.isCorrect && feedback.given && mode === 'write' && (
                  <p className="t-hand muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
                    Du skrev: {feedback.given}
                  </p>
                )}
              </div>
              <button className="btn btn-primary" onClick={onNext} autoFocus>Nästa →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
