import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchList } from '../api/lists';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchList(apiFetch, id);
      setList(data.list);
      const shuffled = shuffle(data.glosor);
      setQueue(shuffled.slice(1));
      setCurrent(shuffled[0] || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, id]);

  useEffect(() => { load(); }, [load]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!current) return;
    const isCorrect = answerVariants(current.target).includes(answer.trim().toLowerCase());

    setFeedback({ isCorrect, expected: current.target });
    setScore((s) => isCorrect ? { ...s, correct: s.correct + 1 } : { ...s, wrong: s.wrong + 1 });

    try {
      await updateGlos(apiFetch, current._id, {
        stats: {
          correct: (current.stats?.correct ?? 0) + (isCorrect ? 1 : 0),
          wrong:   (current.stats?.wrong   ?? 0) + (isCorrect ? 0 : 1)
        }
      });
    } catch { /* swallow — quiz proceeds even if stats update fails */ }
  };

  const onNext = () => {
    setAnswer('');
    setFeedback(null);
    setCurrent(queue[0] || null);
    setQueue((q) => q.slice(1));
  };

  if (loading) return <p>Laddar…</p>;
  if (error) return <p className="error">{error}</p>;

  if (!current) {
    return (
      <div className="stack">
        <h2>Quiz klart</h2>
        <p>Rätt: {score.correct} · Fel: {score.wrong}</p>
        <div className="row">
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

      <div className="card stack" style={{ textAlign: 'center' }}>
        <p className="muted" style={{ margin: 0 }}>Översätt från {list?.sourceLang} till {list?.targetLang}</p>
        <h2 style={{ fontSize: '2rem', margin: '0.5rem 0' }}>{current.source}</h2>

        {feedback ? (
          <div>
            <p className={feedback.isCorrect ? '' : 'error'} style={{ fontSize: '1.1rem' }}>
              {feedback.isCorrect ? 'Rätt!' : `Fel — rätt svar: ${feedback.expected}`}
            </p>
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
