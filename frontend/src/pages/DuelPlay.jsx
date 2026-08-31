import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchDuel, submitDuel } from '../api/duels';
import GloAvatar from '../components/GloAvatar';
import Flag from '../components/Flag';
import { LANG_TO_FLAG } from '../utils/lang';
import { answerVariants } from '../utils/quiz';

// Sida för att spela en async-duell. Frågorna är låsta vid skapandet, så
// vi visar dem i samma ordning som alla andra deltagare. Timer startar
// första gången användaren ser första frågan, stannar vid sista svar.
export default function DuelPlay() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { apiFetch } = useAuth();
  const [duel, setDuel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState('');
  const [results, setResults] = useState([]); // [{ glosId, given, isCorrect }]
  const [feedback, setFeedback] = useState(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const startedAtRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetchDuel(apiFetch, id);
      setDuel(d);
      if (d.myStatus === 'completed') {
        navigate(`/duels/${id}/result`, { replace: true });
        return;
      }
      if (!d.questions || d.questions.length === 0) {
        setError('Utmaningen har inga frågor.');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, id, navigate]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    // Starta timern första gången frågorna är synliga.
    if (duel && duel.questions && startedAtRef.current === null) {
      startedAtRef.current = performance.now();
    }
  }, [duel]);

  if (loading) return <p className="t-hand muted">Glo dukar upp utmaningen…</p>;
  if (error || !duel || !duel.questions) {
    return (
      <div className="card card-lg" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
        <GloAvatar size={120} float mood="sad" style={{ margin: '0 auto 12px' }} />
        <h2>Kunde inte starta utmaningen</h2>
        <p className="muted">{error || 'Något gick snett.'}</p>
        <Link to="/kompisar"><button className="btn btn-primary">Till kompisar</button></Link>
      </div>
    );
  }

  const total = duel.questions.length;
  const current = duel.questions[idx];
  const promptWord = duel.reversed ? current.target : current.source;
  const expectedWord = duel.reversed ? current.source : current.target;

  const checkAnswer = (given) => {
    const variants = answerVariants(expectedWord);
    return variants.includes(given.trim().toLowerCase());
  };

  const onSubmitAnswer = (e) => {
    e.preventDefault();
    if (feedback) return;
    const isCorrect = checkAnswer(answer);
    const entry = { glosId: current.glosId, given: answer.trim(), isCorrect, expected: expectedWord };
    setResults((cur) => [...cur, entry]);
    setFeedback(entry);
  };

  const onNext = async () => {
    setFeedback(null);
    setAnswer('');
    if (idx < total - 1) {
      setIdx((i) => i + 1);
      return;
    }
    // Sista frågan besvarad — submitt resultatet
    const allResults = results; // results har precis fått sista entry via setFeedback
    const correctCount = allResults.filter((r) => r.isCorrect).length;
    const durationMs = startedAtRef.current
      ? Math.round(performance.now() - startedAtRef.current)
      : 0;
    setSubmitBusy(true);
    try {
      await submitDuel(apiFetch, id, { correct: correctCount, total, durationMs });
      navigate(`/duels/${id}/result`, { replace: true });
    } catch (e) {
      setError(e.message);
      setSubmitBusy(false);
    }
  };

  const flag = LANG_TO_FLAG[duel.list?.sourceLang || 'sv'];
  const progress = Math.round(((idx + (feedback ? 1 : 0)) / total) * 100);

  return (
    <div style={{ marginTop: -28 }}>
      <div className="row between" style={{ padding: '14px 0', borderBottom: '2px solid var(--ink)', marginBottom: 28 }}>
        <Link to="/kompisar">
          <button className="btn btn-ghost btn-sm" aria-label="Avbryt utmaning">× Avbryt</button>
        </Link>
        <div className="bar-shell" style={{ flex: 1, margin: '0 20px' }}>
          <div className="bar-fill bar-fill-coral" style={{ width: `${progress}%` }} />
        </div>
        <span className="t-hand muted">{idx + (feedback ? 1 : 0)} / {total}</span>
      </div>

      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          {flag && <span className="pill" style={{ background: 'var(--coral-soft)' }}><Flag code={flag} size="sm" /></span>}
          <span className="pill" style={{ background: 'var(--berry-soft)' }}>⚔️ utmaning</span>
          <span className="pill">{duel.list?.title}</span>
        </div>

        <div className="t-hand muted" style={{ fontSize: 18, marginBottom: 8 }}>
          Översätt:
        </div>

        <div className="card card-lg" style={{ padding: 36, textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 80, lineHeight: 1 }}>
            {promptWord}
          </div>
          {current.notes && (
            <div className="t-hand muted" style={{ fontSize: 16, marginTop: 6 }}>· {current.notes}</div>
          )}
        </div>

        {!feedback ? (
          <form onSubmit={onSubmitAnswer} style={{ marginTop: 24 }}>
            <input
              className="inp inp-lg"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="skriv översättningen…"
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
              <GloAvatar mood={feedback.isCorrect ? 'wink' : 'sad'} size={48} />
              <div className="grow">
                <h3 style={{ margin: 0 }}>
                  {feedback.isCorrect ? 'Rätt!' : `Fel — det rätta svaret är ${feedback.expected}.`}
                </h3>
                {!feedback.isCorrect && feedback.given && (
                  <p className="t-hand muted" style={{ margin: '4px 0 0' }}>Du skrev: {feedback.given}</p>
                )}
              </div>
              <button
                className="btn btn-primary"
                onClick={onNext}
                autoFocus
                disabled={submitBusy}
              >
                {idx < total - 1 ? 'Nästa →' : (submitBusy ? 'Sparar…' : 'Klart')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
