import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchList, submitScore } from '../api/lists';
import { updateGlos } from '../api/glosor';
import GloAvatar from '../components/GloAvatar';
import Flag from '../components/Flag';
import { LANG_TO_FLAG } from '../utils/lang';
import { shuffle, answerVariants } from '../utils/quiz';

const ROUNDS = 15;
const LIVES = 3;
const START_DURATION_MS = 10000; // first word fall
const END_DURATION_MS = 4500;    // last word fall — pressure ramps as game goes
const LAND_REVEAL_MS = 1100;     // how long the answer flashes before next word

function durationForRound(roundIndex, totalRounds) {
  if (totalRounds <= 1) return START_DURATION_MS;
  const t = roundIndex / (totalRounds - 1);
  return Math.round(START_DURATION_MS + (END_DURATION_MS - START_DURATION_MS) * t);
}

export default function Ordfall() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { apiFetch } = useAuth();
  const [list, setList] = useState(null);
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const [progress, setProgress] = useState(0); // 0 → 1 fall progress for current word
  const [livesLeft, setLivesLeft] = useState(LIVES);
  const [score, setScore] = useState({ correct: 0, wrong: 0 });
  const [bestStreak, setBestStreak] = useState(0);
  const [streak, setStreak] = useState(0);
  const [feedback, setFeedback] = useState(null); // { kind, expected, given } | null
  const [answer, setAnswer] = useState('');
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [roundIndex, setRoundIndex] = useState(0);
  const [totalRounds, setTotalRounds] = useState(0);

  // Refs the animation loop needs to read without triggering rerenders.
  const rafRef = useRef(0);
  const startedAtRef = useRef(0);
  const elapsedAtPauseRef = useRef(0);
  const durationRef = useRef(START_DURATION_MS);
  const landedRef = useRef(false);
  const inputRef = useRef(null);

  const reversed = list?.quizReversed ?? true;
  const promptField = reversed ? 'target' : 'source';
  const expectedField = reversed ? 'source' : 'target';
  const promptLang = list ? (reversed ? list.targetLang : list.sourceLang) : '';
  const expectedLang = list ? (reversed ? list.sourceLang : list.targetLang) : '';

  const cancelRaf = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchList(apiFetch, id);
      setList(data.list);
      if (data.glosor.length === 0) {
        setError('Listan är tom — lägg till några glosor först.');
        return;
      }
      const shuffled = shuffle(data.glosor).slice(0, ROUNDS);
      setTotalRounds(shuffled.length);
      setQueue(shuffled.slice(1));
      setCurrent(shuffled[0]);
      setRoundIndex(0);
      setLivesLeft(LIVES);
      setScore({ correct: 0, wrong: 0 });
      setStreak(0);
      setBestStreak(0);
      setFeedback(null);
      setAnswer('');
      setProgress(0);
      elapsedAtPauseRef.current = 0;
      durationRef.current = durationForRound(0, shuffled.length);
      landedRef.current = false;
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, id]);

  useEffect(() => { load(); }, [load]);

  const recordOutcome = useCallback(async (isCorrect, given, expected) => {
    if (landedRef.current) return;
    landedRef.current = true;
    cancelRaf();
    const newStreak = isCorrect ? streak + 1 : 0;
    setStreak(newStreak);
    setBestStreak((b) => Math.max(b, newStreak));
    setScore((s) => isCorrect
      ? { ...s, correct: s.correct + 1 }
      : { ...s, wrong: s.wrong + 1 });
    if (!isCorrect) setLivesLeft((l) => l - 1);
    setFeedback({ kind: isCorrect ? 'correct' : 'wrong', expected, given });
    try {
      if (current) {
        await updateGlos(apiFetch, current._id, {
          stats: {
            correct: (current.stats?.correct ?? 0) + (isCorrect ? 1 : 0),
            wrong: (current.stats?.wrong ?? 0) + (isCorrect ? 0 : 1)
          }
        });
      }
    } catch { /* swallow */ }
  }, [apiFetch, current, streak]);

  // Drive the falling animation. progress 1 → word landed → wrong.
  useEffect(() => {
    if (!current || feedback || paused) return;
    const start = performance.now() - elapsedAtPauseRef.current;
    startedAtRef.current = start;
    const tick = (now) => {
      const elapsed = now - startedAtRef.current;
      const p = Math.min(1, elapsed / durationRef.current);
      setProgress(p);
      if (p >= 1) {
        if (!landedRef.current) {
          const expected = current[expectedField];
          recordOutcome(false, null, expected);
        }
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelRaf();
  }, [current, feedback, paused, expectedField, recordOutcome]);

  // Pause stash: remember how far we'd fallen so resume can continue smoothly.
  useEffect(() => {
    if (paused) {
      cancelRaf();
      elapsedAtPauseRef.current = progress * durationRef.current;
    }
  }, [paused, progress]);

  const acceptedAnswers = useMemo(() => {
    if (!current) return [];
    return answerVariants(current[expectedField]);
  }, [current, expectedField]);

  const onSubmit = (e) => {
    e.preventDefault();
    if (!current || feedback || paused) return;
    const cleaned = answer.trim().toLowerCase();
    if (!cleaned) return;
    if (acceptedAnswers.includes(cleaned)) {
      recordOutcome(true, answer.trim(), current[expectedField]);
    } else {
      // Wrong submission — flash the input red but don't penalize until it lands.
      const el = inputRef.current;
      if (el) {
        el.classList.remove('shake-once');
        // Force reflow so the animation can replay if user is rapid-firing.
        // eslint-disable-next-line no-unused-expressions
        el.offsetWidth;
        el.classList.add('shake-once');
      }
      setAnswer('');
    }
  };

  const onNext = useCallback(async () => {
    setFeedback(null);
    setAnswer('');
    setProgress(0);
    elapsedAtPauseRef.current = 0;
    landedRef.current = false;
    if (livesLeft <= 0 || queue.length === 0) {
      const total = score.correct + score.wrong;
      if (total === 0) {
        navigate(`/lists/${id}`);
        return;
      }
      let updatedList = list;
      let wasNewBest = false;
      try {
        const r = await submitScore(apiFetch, id, { correct: score.correct, total });
        updatedList = r.list;
        wasNewBest = r.wasNewBest;
      } catch (err) {
        console.error('Failed to submit score:', err);
      }
      navigate(`/lists/${id}/results`, {
        replace: true,
        state: {
          correct: score.correct,
          wrong: score.wrong,
          extraCorrect: 0,
          extraWrong: 0,
          bestStreak,
          wrongOnly: false,
          mode: 'ordfall',
          list: updatedList,
          wasNewBest
        }
      });
      return;
    }
    setRoundIndex((i) => {
      const next = i + 1;
      durationRef.current = durationForRound(next, totalRounds);
      return next;
    });
    setCurrent(queue[0]);
    setQueue((q) => q.slice(1));
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [apiFetch, bestStreak, id, list, livesLeft, navigate, queue.length, score, totalRounds]);

  // Auto-advance after the brief reveal flash.
  useEffect(() => {
    if (!feedback) return undefined;
    const t = setTimeout(onNext, LAND_REVEAL_MS);
    return () => clearTimeout(t);
  }, [feedback, onNext]);

  if (loading) return <p className="t-hand muted">Glo värmer upp ord-regnet…</p>;
  if (error) {
    return (
      <div className="card card-lg" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
        <GloAvatar size={120} float mood="sad" style={{ margin: '0 auto 12px' }} />
        <h2>{error}</h2>
        <Link to={`/lists/${id}`}><button className="btn btn-primary">Tillbaka till listan</button></Link>
      </div>
    );
  }
  if (!current) return null;

  const flag = LANG_TO_FLAG[list?.sourceLang];
  const answered = score.correct + score.wrong;
  const overallProgress = totalRounds > 0 ? Math.round((answered / totalRounds) * 100) : 0;
  const fallingWord = current[promptField];
  const fallY = `${(progress * 100).toFixed(2)}%`;
  const danger = progress > 0.75;

  return (
    <div style={{ marginTop: -28 }}>
      <div className="row between" style={{ padding: '14px 0', borderBottom: '2px solid var(--ink)', marginBottom: 28 }}>
        <Link to={`/lists/${id}`}>
          <button className="btn btn-ghost btn-sm" aria-label="Avbryt spel">× Avbryt</button>
        </Link>
        <div className="bar-shell" style={{ flex: 1, margin: '0 20px' }}>
          <div className="bar-fill bar-fill-coral" style={{ width: `${overallProgress}%` }} />
        </div>
        <span className="t-hand muted">{answered} / {totalRounds}</span>
      </div>

      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div className="row between" style={{ marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {flag && (
              <span className="pill" style={{ background: 'var(--coral-soft)' }}>
                <Flag code={flag} size="sm" /> {list?.sourceLang}
              </span>
            )}
            <span className="pill" style={{ background: 'var(--sky-soft)' }}>läge: ordfall</span>
            <span className="pill">{promptLang} → {expectedLang}</span>
            <button
              className="pill"
              type="button"
              style={{
                background: paused ? 'var(--mustard-soft)' : 'transparent',
                border: '2px solid var(--ink)',
                cursor: 'pointer',
                font: 'inherit'
              }}
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? '▶ fortsätt' : '⏸ paus'}
            </button>
          </div>
          <div className="row" style={{ gap: 6 }} aria-label={`${livesLeft} liv kvar`}>
            {Array.from({ length: LIVES }).map((_, i) => (
              <GloAvatar
                key={i}
                size={26}
                mood={i < livesLeft ? 'default' : 'sad'}
                style={{ opacity: i < livesLeft ? 1 : 0.35 }}
              />
            ))}
          </div>
        </div>

        <div
          className="card"
          style={{
            position: 'relative',
            height: 280,
            overflow: 'hidden',
            background: paused
              ? 'var(--paper-edge)'
              : danger
                ? 'var(--berry-soft)'
                : 'var(--paper)',
            transition: 'background 200ms ease'
          }}
        >
          {paused && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--font-display)',
                fontSize: 32,
                color: 'var(--ink-soft)'
              }}
            >
              pausad
            </div>
          )}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: fallY,
              transform: 'translate(-50%, -50%)',
              fontFamily: 'var(--font-display)',
              fontSize: 44,
              lineHeight: 1,
              whiteSpace: 'nowrap',
              color: feedback?.kind === 'wrong' ? 'var(--berry-deep)' : 'var(--ink)',
              willChange: 'top'
            }}
          >
            {fallingWord}
          </div>
          {/* Ground line */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 3,
              background: 'var(--ink)'
            }}
          />
          {current.notes && (
            <div
              className="t-hand muted"
              style={{ position: 'absolute', bottom: 10, left: 14, fontSize: 13 }}
            >
              · {current.notes}
            </div>
          )}
        </div>

        {feedback ? (
          <div
            className="card pop-in"
            style={{
              marginTop: 18,
              background: feedback.kind === 'correct' ? 'var(--leaf-soft)' : 'var(--berry-soft)',
              borderColor: feedback.kind === 'correct' ? 'var(--leaf-deep)' : 'var(--berry-deep)'
            }}
          >
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <GloAvatar mood={feedback.kind === 'correct' ? 'wink' : 'sad'} size={48} />
              <div className="grow">
                <h3 style={{ margin: 0 }}>
                  {feedback.kind === 'correct'
                    ? `Snyggt! ${streak >= 2 ? `🔥 ${streak} i rad` : ''}`
                    : `Ordet landade — ${feedback.expected}.`}
                </h3>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} style={{ marginTop: 18 }}>
            <input
              ref={inputRef}
              className="inp inp-lg"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={paused ? 'pausad…' : `skriv ${expectedLang}…`}
              disabled={paused}
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <div className="row between" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
              <span className="t-hand muted" style={{ fontSize: 14 }}>
                tryck <code>enter</code> innan ordet landar
              </span>
              <button type="submit" className="btn btn-primary" disabled={paused}>Svara</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
