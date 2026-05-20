import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchList, submitScore, updateList } from '../api/lists';
import { updateGlos } from '../api/glosor';
import Flag from '../components/Flag';
import GloAvatar from '../components/GloAvatar';
import { LANG_TO_FLAG } from '../utils/lang';
import { shuffle, answerVariants, buildDistractors } from '../utils/quiz';
import { speak, stopSpeaking, createRecognition, isTTSSupported, isSTTSupported } from '../utils/voice';

const VOICE_MODE_KEY = 'glosan:quizVoiceMode';

function readVoiceMode() {
  try { return localStorage.getItem(VOICE_MODE_KEY) === 'true'; } catch { return false; }
}

export default function Quiz() {
  const { id } = useParams();
  const navigate = useNavigate();
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
  const [extraStats, setExtraStats] = useState({ correct: 0, wrong: 0 });
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [wrongOnly, setWrongOnly] = useState(false);
  const [reversed, setReversed] = useState(true);
  const [voiceMode, setVoiceMode] = useState(readVoiceMode);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const recognitionRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    try { localStorage.setItem(VOICE_MODE_KEY, String(voiceMode)); } catch { /* ignore */ }
  }, [voiceMode]);

  // Stop any ongoing speech / recognition on unmount.
  useEffect(() => {
    return () => {
      stopSpeaking();
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch { /* ignore */ }
        recognitionRef.current = null;
      }
    };
  }, []);

  const promptField = reversed ? 'target' : 'source';
  const expectedField = reversed ? 'source' : 'target';
  const promptLang = list ? (reversed ? list.targetLang : list.sourceLang) : '';
  const expectedLang = list ? (reversed ? list.sourceLang : list.targetLang) : '';

  const load = useCallback(async () => {
    setLoading(true);
    setScore({ correct: 0, wrong: 0 });
    setExtraStats({ correct: 0, wrong: 0 });
    setStreak(0);
    setBestStreak(0);
    setFeedback(null);
    setAnswer('');
    try {
      const data = await fetchList(apiFetch, id);
      setList(data.list);
      setReversed(data.list.quizReversed ?? true);
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
    const distractors = buildDistractors(current, allGlosor, expectedField);
    return shuffle([current[expectedField], ...distractors]);
  }, [current, allGlosor, mode, expectedField]);

  const recordAnswer = async (isCorrect, given) => {
    const expectedWord = current[expectedField];
    stopSpeaking();
    setListening(false);
    setFeedback({ isCorrect, expected: expectedWord, given });
    setScore((s) => isCorrect ? { ...s, correct: s.correct + 1 } : { ...s, wrong: s.wrong + 1 });
    if (current.extra) {
      setExtraStats((s) => isCorrect ? { ...s, correct: s.correct + 1 } : { ...s, wrong: s.wrong + 1 });
    }
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
    const expectedWord = current[expectedField];
    const isCorrect = answerVariants(expectedWord).includes(answer.trim().toLowerCase());
    recordAnswer(isCorrect, answer.trim());
  };

  const onPick = (option) => {
    if (!current || feedback) return;
    const expectedWord = current[expectedField];
    // Choice mode: exact-match against the literal expected on the button.
    const isCorrect = option.trim().toLowerCase() === expectedWord.trim().toLowerCase();
    recordAnswer(isCorrect, option);
  };

  const onNext = async () => {
    if (queue.length === 0) {
      const total = score.correct + score.wrong;
      if (total === 0) {
        setCurrent(null);
        setFeedback(null);
        return;
      }
      let updatedList = list;
      let wasNewBest = false;
      if (!wrongOnly) {
        try {
          const r = await submitScore(apiFetch, id, { correct: score.correct, total });
          updatedList = r.list;
          wasNewBest = r.wasNewBest;
        } catch (err) {
          console.error('Failed to submit score:', err);
        }
      }
      navigate(`/lists/${id}/results`, {
        replace: true,
        state: {
          correct: score.correct,
          wrong: score.wrong,
          extraCorrect: extraStats.correct,
          extraWrong: extraStats.wrong,
          bestStreak,
          wrongOnly,
          mode,
          list: updatedList,
          wasNewBest
        }
      });
      return;
    }
    setAnswer('');
    setFeedback(null);
    setTranscript('');
    setVoiceError('');
    setCurrent(queue[0]);
    setQueue((q) => q.slice(1));
  };

  // Auto-speak the prompt when a new card appears in voice mode.
  useEffect(() => {
    if (!voiceMode || !current || feedback || mode !== 'write') return;
    const text = current[promptField];
    if (text) speak(text, promptLang);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, voiceMode, mode]);

  const onSpeakPrompt = () => {
    if (!current) return;
    speak(current[promptField], promptLang);
  };

  const startListening = () => {
    if (!current || feedback) return;
    setVoiceError('');
    setTranscript('');
    const expectedWord = current[expectedField];
    const rec = createRecognition(expectedLang);
    if (!rec) {
      setVoiceError('Tal-läget funkar inte i den här webbläsaren — prova Chrome eller Edge.');
      return;
    }
    recognitionRef.current = rec;
    setListening(true);
    rec.onresult = (e) => {
      const txt = e.results?.[0]?.[0]?.transcript || '';
      setTranscript(txt);
      const isCorrect = answerVariants(expectedWord).includes(txt.trim().toLowerCase());
      recordAnswer(isCorrect, txt.trim());
    };
    rec.onerror = (e) => {
      setListening(false);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setVoiceError('Glo kan inte höra dig — kolla att mikrofon-tillstånd är på.');
      } else if (e.error === 'no-speech') {
        setVoiceError('Glo hörde inget. Försök igen.');
      } else {
        setVoiceError(`Mikrofon-fel: ${e.error || 'okänt'}`);
      }
    };
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    try { rec.start(); } catch (err) { setVoiceError(err.message); setListening(false); }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
    }
  };

  useEffect(() => {
    if (mode !== 'choice' || feedback || options.length === 0) return undefined;
    const onKey = (e) => {
      const idx = parseInt(e.key, 10) - 1;
      if (idx >= 0 && idx < options.length) onPick(options[idx]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, feedback, options]);

  const onToggleReversed = async () => {
    const next = !reversed;
    setReversed(next);
    setAnswer('');
    setFeedback(null);
    try {
      const updated = await updateList(apiFetch, id, { quizReversed: next });
      setList(updated);
    } catch (err) {
      // Roll back local state if save failed.
      setReversed(!next);
      setError(err.message);
    }
  };

  if (loading) return <p className="t-hand muted">Glo blandar korten…</p>;
  if (error) return <p className="error">{error}</p>;

  const flag = LANG_TO_FLAG[list?.sourceLang];
  const answered = score.correct + score.wrong;
  const progress = totalCards > 0 ? (answered / totalCards) * 100 : 0;
  const modeLabel = mode === 'choice' ? '4 val' : 'skriv';
  const modeBg = mode === 'choice' ? 'var(--mustard-soft)' : 'var(--leaf-soft)';

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

  if (!current) {
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

  const promptWord = current[promptField];
  const expectedWord = current[expectedField];

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
              type="button"
              onClick={onToggleReversed}
              style={{ background: 'transparent', border: '2px solid var(--ink)', cursor: 'pointer', font: 'inherit' }}
              title="Byt riktning"
            >
              {promptLang} → {expectedLang}
            </button>
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
            {mode === 'write' && isSTTSupported() && (
              <button
                className="pill"
                style={{
                  background: voiceMode ? 'var(--sky-soft)' : 'transparent',
                  border: '2px solid var(--ink)',
                  cursor: 'pointer',
                  font: 'inherit'
                }}
                onClick={() => setVoiceMode((v) => !v)}
                type="button"
                title="Lyssna och tala in svaret istället för att skriva"
              >
                {voiceMode ? '✓ ' : ''}🎤 tal-läge
              </button>
            )}
          </div>
        </div>

        <div className="t-hand muted" style={{ fontSize: 18, marginBottom: 8 }}>
          {mode === 'choice' ? `Vilken översättning?` : `Översätt till ${expectedLang}`}
        </div>

        <div className="card card-lg" style={{ padding: 36, textAlign: 'center', position: 'relative' }}>
          {isTTSSupported() && (
            <button
              className="btn btn-sm"
              onClick={onSpeakPrompt}
              style={{ position: 'absolute', top: 14, right: 14 }}
              title={`Läs upp på ${promptLang}`}
              type="button"
            >
              🔊 lyssna
            </button>
          )}
          <div style={{ fontFamily: 'var(--font-display)', fontSize: mode === 'choice' ? 80 : 96, lineHeight: 1 }}>
            {promptWord}
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
          ) : voiceMode && isSTTSupported() ? (
            <div style={{ marginTop: 24, textAlign: 'center' }}>
              <button
                type="button"
                className={`btn ${listening ? '' : 'btn-primary'} btn-lg`}
                onClick={listening ? stopListening : startListening}
                style={listening ? { background: 'var(--berry-soft)', borderColor: 'var(--berry-deep)' } : undefined}
              >
                {listening ? '🎤 Lyssnar… klicka för att stoppa' : '🎤 Tala in svaret'}
              </button>
              {transcript && !listening && (
                <p className="t-hand" style={{ marginTop: 12, fontSize: 16 }}>
                  Glo hörde: <strong>{transcript}</strong>
                </p>
              )}
              {voiceError && <p className="error" style={{ marginTop: 10 }}>{voiceError}</p>}
              <p className="t-hand muted" style={{ marginTop: 14, fontSize: 13 }}>
                tala på {expectedLang}. Glo jämför mot rätt svar.
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} style={{ marginTop: 24 }}>
              <input
                className="inp inp-lg"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={`skriv ${expectedLang}…`}
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
