import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchList, submitScore } from '../api/lists';
import { updateGlos } from '../api/glosor';

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Expand slash-separated alternatives in a target into every accepted phrasing.
// "mycket söt/gullig" → ["mycket söt", "mycket gullig"]
// "den/det är/var" → ["den är", "den var", "det är", "det var"]
function answerVariants(target) {
  const tokens = target.trim().split(/\s+/);
  const perToken = tokens.map((t) => t.split('/').map((s) => s.trim()).filter(Boolean));
  return perToken
    .reduce((acc, opts) => acc.flatMap((prefix) => opts.map((opt) => [...prefix, opt])), [[]])
    .map((parts) => parts.join(' ').toLowerCase());
}

export default function Quiz() {
  const { id } = useParams();
  const { apiFetch } = useAuth();
  const [list, setList] = useState(null);
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
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
    try {
      const data = await fetchList(apiFetch, id);
      setList(data.list);
      const pool = wrongOnly
        ? data.glosor.filter((g) => (g.stats?.wrong ?? 0) > 0)
        : data.glosor;
      const shuffled = shuffle(pool);
      setQueue(shuffled.slice(1));
      setCurrent(shuffled[0] || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, id, wrongOnly]);

  useEffect(() => { load(); }, [load]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!current) return;
    const isCorrect = answerVariants(current.target).includes(answer.trim().toLowerCase());

    setFeedback({ isCorrect, expected: current.target });
    setScore((s) => isCorrect ? { ...s, correct: s.correct + 1 } : { ...s, wrong: s.wrong + 1 });
    const newStreak = isCorrect ? streak + 1 : 0;
    setStreak(newStreak);
    setBestStreak((b) => Math.max(b, newStreak));

    try {
      await updateGlos(apiFetch, current._id, {
        stats: {
          correct: (current.stats?.correct ?? 0) + (isCorrect ? 1 : 0),
          wrong:   (current.stats?.wrong   ?? 0) + (isCorrect ? 0 : 1)
        }
      });
    } catch { /* swallow — quiz proceeds even if stats update fails */ }
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

  if (loading) return <p>Laddar…</p>;
  if (error) return <p className="error">{error}</p>;

  if (!current) {
    const best = list?.bestScore;
    const total = score.correct + score.wrong;
    if (total === 0) {
      return (
        <div className="stack" style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
          <h2>{wrongOnly ? 'Inga fel-glosor att öva på' : 'Listan är tom'}</h2>
          <p className="muted">
            {wrongOnly
              ? 'Du har inte haft fel på några glosor än — eller så har du redan rättat alla.'
              : 'Lägg till glosor på listan först.'}
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            {wrongOnly && (
              <button onClick={() => setWrongOnly(false)}>Öva alla glosor istället</button>
            )}
            <Link to={`/lists/${id}`}><button>Tillbaka</button></Link>
          </div>
        </div>
      );
    }
    return (
      <div className="stack" style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
        <h2>Quiz klart{wrongOnly ? ' (bara fel-glosor)' : ''}</h2>
        {newBest && (
          <p style={{ fontSize: '1.5rem', color: 'var(--color-accent)', margin: 0 }}>
            🎉 Nytt rekord!
          </p>
        )}
        <p style={{ fontSize: '1.2rem' }}>Rätt: {score.correct} · Fel: {score.wrong}</p>
        {bestStreak >= 2 && (
          <p style={{ color: '#f97316' }}>🔥 Längsta svit: {bestStreak} i rad</p>
        )}
        {best?.total > 0 && (
          <p className="muted">
            Bästa hittills: {best.correct} / {best.total}
            {best.achievedAt && ` (${new Date(best.achievedAt).toLocaleDateString('sv-SE')})`}
          </p>
        )}
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="primary" onClick={load}>Kör igen</button>
          <Link to={`/lists/${id}`}><button>Tillbaka till listan</button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="stack" style={{ maxWidth: 480, margin: '0 auto' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Link to={`/lists/${id}`}><button>← Tillbaka</button></Link>
        <span className="muted">{list?.title}</span>
      </div>

      <div className="row" style={{ justifyContent: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
          <input
            type="checkbox"
            checked={wrongOnly}
            onChange={(e) => setWrongOnly(e.target.checked)}
            style={{ width: 'auto' }}
          />
          Öva bara glosor jag haft fel på
        </label>
      </div>

      <div className="card stack" style={{ textAlign: 'center' }}>
        <p className="muted" style={{ margin: 0 }}>Översätt från {list?.sourceLang} till {list?.targetLang}</p>
        <h2 style={{ fontSize: '2rem', margin: '0.5rem 0' }}>{current.source}</h2>

        {feedback ? (
          <div>
            <p className={feedback.isCorrect ? '' : 'error'} style={{ fontSize: '1.1rem' }}>
              {feedback.isCorrect ? 'Rätt!' : `Fel — rätt svar: ${feedback.expected}`}
            </p>
            {feedback.isCorrect && streak >= 2 && (
              <p style={{ fontSize: '1.4rem', color: '#f97316', margin: '0.5rem 0' }}>
                🔥 {streak} i rad!
              </p>
            )}
            <button className="primary" onClick={onNext}>Nästa</button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="stack">
            <input value={answer} onChange={(e) => setAnswer(e.target.value)} autoFocus required />
            <button type="submit" className="primary">Svara</button>
          </form>
        )}
      </div>

      <p className="muted" style={{ textAlign: 'center' }}>
        Rätt: {score.correct} · Fel: {score.wrong} · Kvar: {queue.length}
      </p>
    </div>
  );
}
