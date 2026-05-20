import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGamification } from '../contexts/GamificationContext';
import { fetchCategories, fetchCategoryPool } from '../api/categories';
import { updateGlos } from '../api/glosor';
import { postQuizComplete } from '../api/me';
import Flag from '../components/Flag';
import GloAvatar from '../components/GloAvatar';
import StatTile from '../components/StatTile';
import { shuffle, answerVariants } from '../utils/quiz';
import { LANG_TO_FLAG } from '../utils/lang';
import { speak, stopSpeaking, createRecognition, isTTSSupported, isSTTSupported } from '../utils/voice';

const VOICE_MODE_KEY = 'glosan:quizVoiceMode';
const readVoiceMode = () => {
  try { return localStorage.getItem(VOICE_MODE_KEY) === 'true'; } catch { return false; }
};

export default function CategoryQuiz() {
  const { catId } = useParams();
  const [searchParams] = useSearchParams();
  const { apiFetch } = useAuth();
  const { refresh } = useGamification();

  const mode = searchParams.get('mode') === 'review' ? 'review' : 'all';
  const excludeListId = searchParams.get('excludeListId') || undefined;
  const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined;

  const [category, setCategory] = useState(null);
  const [lists, setLists] = useState([]);
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const [totalCards, setTotalCards] = useState(0);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [score, setScore] = useState({ correct: 0, wrong: 0 });
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [finished, setFinished] = useState(false);
  const [voiceMode, setVoiceMode] = useState(readVoiceMode);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const [voiceAttempts, setVoiceAttempts] = useState(0);
  const voiceAttemptsRef = useRef(0);
  const recognitionRef = useRef(null);

  const MAX_VOICE_ATTEMPTS = 3;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    try { localStorage.setItem(VOICE_MODE_KEY, String(voiceMode)); } catch { /* ignore */ }
  }, [voiceMode]);

  useEffect(() => {
    return () => {
      stopSpeaking();
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch { /* ignore */ }
        recognitionRef.current = null;
      }
    };
  }, []);

  const listById = useMemo(() => Object.fromEntries(lists.map((l) => [String(l._id), l])), [lists]);

  // For each card, derive the parent list's direction and field choice. We
  // always show the "translation" (the user's native, typically) and prompt
  // for the source — matching the design's "Översätt till X" semantics.
  const cardInfo = (g) => {
    const parent = listById[String(g.list)];
    const reversed = parent ? (parent.quizReversed ?? true) : true;
    const promptField = reversed ? 'target' : 'source';
    const expectedField = reversed ? 'source' : 'target';
    const promptLang = parent ? (reversed ? parent.targetLang : parent.sourceLang) : '';
    const expectedLang = parent ? (reversed ? parent.sourceLang : parent.targetLang) : '';
    return { reversed, promptField, expectedField, promptLang, expectedLang, parent };
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setScore({ correct: 0, wrong: 0 });
    setStreak(0);
    setBestStreak(0);
    setFeedback(null);
    setAnswer('');
    setFinished(false);
    try {
      const allCats = await fetchCategories(apiFetch);
      const cat = allCats.find((c) => c._id === catId);
      if (!cat) {
        setError('Kategorin hittades inte.');
        return;
      }
      setCategory(cat);

      const pool = await fetchCategoryPool(apiFetch, catId, { mode, excludeListId, limit });
      setLists(pool.lists);
      const shuffled = shuffle(pool.glosor);
      setTotalCards(shuffled.length);
      setQueue(shuffled.slice(1));
      setCurrent(shuffled[0] || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, catId, mode, excludeListId, limit]);

  useEffect(() => { load(); }, [load]);

  const recordAnswer = async (isCorrect, given, expectedWord) => {
    stopSpeaking();
    setListening(false);
    setFeedback({ isCorrect, expected: expectedWord, given });
    setScore((s) => isCorrect ? { ...s, correct: s.correct + 1 } : { ...s, wrong: s.wrong + 1 });
    const newStreak = isCorrect ? streak + 1 : 0;
    setStreak(newStreak);
    setBestStreak((b) => Math.max(b, newStreak));
    if (current) {
      try {
        await updateGlos(apiFetch, current._id, {
          stats: {
            correct: (current.stats?.correct ?? 0) + (isCorrect ? 1 : 0),
            wrong: (current.stats?.wrong ?? 0) + (isCorrect ? 0 : 1)
          }
        });
      } catch { /* swallow */ }
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (!current) return;
    const { expectedField } = cardInfo(current);
    const expectedWord = current[expectedField];
    const isCorrect = answerVariants(expectedWord).includes(answer.trim().toLowerCase());
    recordAnswer(isCorrect, answer.trim(), expectedWord);
  };

  // Auto-speak the prompt when a new card appears in voice mode.
  useEffect(() => {
    if (!voiceMode || !current || feedback) return;
    const { promptField, promptLang } = cardInfo(current);
    const text = current[promptField];
    if (text) speak(text, promptLang);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, voiceMode]);

  const onSpeakPrompt = () => {
    if (!current) return;
    const { promptField, promptLang } = cardInfo(current);
    speak(current[promptField], promptLang);
  };

  const startListening = () => {
    if (!current || feedback) return;
    setVoiceError('');
    setTranscript('');
    const { expectedField, expectedLang } = cardInfo(current);
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
      if (isCorrect) {
        voiceAttemptsRef.current = 0;
        setVoiceAttempts(0);
        recordAnswer(true, txt.trim(), expectedWord);
        return;
      }
      const next = voiceAttemptsRef.current + 1;
      voiceAttemptsRef.current = next;
      setVoiceAttempts(next);
      if (next >= MAX_VOICE_ATTEMPTS) {
        recordAnswer(false, txt.trim(), expectedWord);
      }
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

  const onNext = async () => {
    setAnswer('');
    setFeedback(null);
    setTranscript('');
    setVoiceError('');
    setVoiceAttempts(0);
    voiceAttemptsRef.current = 0;
    if (queue.length === 0) {
      // Finished — attribute XP to the first list in the pool so the user's
      // language progression / streak still ticks for this practice session.
      const attributeListId = lists[0]?._id;
      const total = score.correct + score.wrong;
      if (attributeListId && total > 0) {
        try {
          await postQuizComplete(apiFetch, { correct: score.correct, total, listId: attributeListId });
          refresh();
        } catch (err) {
          console.error('Quiz-complete failed:', err);
        }
      }
      setFinished(true);
      return;
    }
    setCurrent(queue[0]);
    setQueue((q) => q.slice(1));
  };

  if (loading) return <p className="t-hand muted">Glo blandar korten…</p>;
  if (error) return <p className="error">{error}</p>;

  const modeLabel = mode === 'review' ? 'repetera' : 'öva allt';
  const modeBg = mode === 'review' ? 'var(--coral-soft)' : 'var(--leaf-soft)';

  // Empty pool
  if (!current && !finished) {
    return (
      <div className="card card-lg" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
        <GloAvatar size={120} float mood="sad" style={{ margin: '0 auto 12px' }} />
        <h2 style={{ marginBottom: 8 }}>Inga glosor att öva på</h2>
        <p className="muted" style={{ marginBottom: 18 }}>
          {mode === 'review'
            ? 'Glo hittade inga glosor med fel att repetera i den här kategorin.'
            : 'Den här kategorin har inga listor med glosor än.'}
        </p>
        <Link to="/lists"><button className="btn btn-primary">Tillbaka till listor</button></Link>
      </div>
    );
  }

  // End screen
  if (finished) {
    const total = score.correct + score.wrong;
    const pct = total > 0 ? Math.round((score.correct / total) * 100) : 0;
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
        <GloAvatar size={140} float mood="wink" style={{ margin: '0 auto 12px' }} />
        <h1 style={{ fontSize: 44, margin: '6px 0' }}>
          {mode === 'review' ? 'Repetition klar!' : 'Klart!'}
        </h1>
        <p className="t-hand muted" style={{ fontSize: 17, margin: '0 0 22px' }}>
          {category?.name}
        </p>
        <div className="row" style={{ gap: 14, marginBottom: 22, flexWrap: 'wrap', justifyContent: 'center' }}>
          <StatTile value={score.correct} label="rätt" color="var(--leaf-soft)" icon="/assets/star-sticker.svg" />
          <StatTile value={score.wrong} label="att öva på" color="var(--berry-soft)" />
          <StatTile value={`${pct}%`} label="rätt-procent" color="var(--mustard-soft)" />
          {bestStreak >= 2 && (
            <StatTile value={bestStreak} label="längsta svit" color="var(--coral-soft)" icon="/assets/flame-streak.svg" />
          )}
        </div>
        <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
          <button className="btn btn-primary" onClick={load}>En till runda</button>
          <Link to="/lists"><button className="btn">Tillbaka till listor</button></Link>
        </div>
      </div>
    );
  }

  const info = cardInfo(current);
  const promptWord = current[info.promptField];
  const flag = LANG_TO_FLAG[info.parent?.sourceLang];
  const answered = score.correct + score.wrong;
  const progress = totalCards > 0 ? (answered / totalCards) * 100 : 0;

  return (
    <div style={{ marginTop: -28 }}>
      <div className="row between" style={{ padding: '14px 0', borderBottom: '2px solid var(--ink)', marginBottom: 28 }}>
        <Link to="/lists">
          <button className="btn btn-ghost btn-sm" aria-label="Avbryt">× Avbryt</button>
        </Link>
        <div className="bar-shell" style={{ flex: 1, margin: '0 20px' }}>
          <div className="bar-fill bar-fill-coral" style={{ width: `${progress}%` }} />
        </div>
        <span className="t-hand muted">{answered} / {totalCards}</span>
      </div>

      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div className="row" style={{ gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
          <span className="pill" style={{ background: 'var(--plum-soft)' }}>
            {category?.name || 'Kategori'}
          </span>
          <span className="pill" style={{ background: modeBg }}>läge: {modeLabel}</span>
          {flag && (
            <span className="pill" style={{ background: 'var(--coral-soft)' }}>
              <Flag code={flag} size="sm" /> {info.parent?.sourceLang}
            </span>
          )}
          {info.parent && (
            <span className="pill" title={info.parent.title} style={{ background: 'var(--bg-elev)' }}>
              {info.parent.title.length > 24 ? info.parent.title.slice(0, 22) + '…' : info.parent.title}
            </span>
          )}
          {isSTTSupported() && (
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

        <div className="t-hand muted" style={{ fontSize: 18, marginBottom: 8 }}>
          Översätt till {info.expectedLang}
        </div>

        <div className="card card-lg" style={{ padding: 36, textAlign: 'center', position: 'relative' }}>
          {isTTSSupported() && (
            <button
              className="btn btn-sm"
              onClick={onSpeakPrompt}
              style={{ position: 'absolute', top: 14, right: 14 }}
              title={`Läs upp på ${info.promptLang}`}
              type="button"
            >
              🔊 lyssna
            </button>
          )}
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 96, lineHeight: 1 }}>
            {promptWord}
          </div>
          {current.notes && (
            <div className="t-hand muted" style={{ fontSize: 16, marginTop: 6 }}>· {current.notes}</div>
          )}
        </div>

        {!feedback ? (
          voiceMode && isSTTSupported() ? (
            <div style={{ marginTop: 24, textAlign: 'center' }}>
              <button
                type="button"
                className={`btn ${listening ? '' : 'btn-primary'} btn-lg`}
                onClick={listening ? stopListening : startListening}
                style={listening ? { background: 'var(--berry-soft)', borderColor: 'var(--berry-deep)' } : undefined}
              >
                {listening
                  ? '🎤 Lyssnar… klicka för att stoppa'
                  : voiceAttempts > 0
                    ? '🎤 Försök igen'
                    : '🎤 Tala in svaret'}
              </button>
              {transcript && !listening && voiceAttempts > 0 && voiceAttempts < MAX_VOICE_ATTEMPTS && (
                <p className="t-hand" style={{ marginTop: 12, fontSize: 16 }}>
                  Glo hörde: <strong>{transcript}</strong> — det stämmer inte. Försök igen, du har {MAX_VOICE_ATTEMPTS - voiceAttempts} försök kvar.
                </p>
              )}
              {transcript && !listening && voiceAttempts === 0 && (
                <p className="t-hand" style={{ marginTop: 12, fontSize: 16 }}>
                  Glo hörde: <strong>{transcript}</strong>
                </p>
              )}
              {voiceError && <p className="error" style={{ marginTop: 10 }}>{voiceError}</p>}
              <p className="t-hand muted" style={{ marginTop: 14, fontSize: 13 }}>
                tala på {info.expectedLang}. Du har upp till {MAX_VOICE_ATTEMPTS} försök per glosa.
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} style={{ marginTop: 24 }}>
              <input
                className="inp inp-lg"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={`skriv ${info.expectedLang}…`}
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
                  {feedback.isCorrect ? 'Snyggt! Glo tappar hakan.' : `Nära! Det stavas ${feedback.expected}.`}
                </h3>
                {feedback.isCorrect && streak >= 2 && (
                  <p style={{ margin: '4px 0 0', fontFamily: 'var(--font-headline)', fontSize: 22, color: 'var(--coral-deep)' }}>
                    🔥 {streak} i rad!
                  </p>
                )}
                {!feedback.isCorrect && feedback.given && (
                  <p className="t-hand muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
                    Du skrev: {feedback.given}
                  </p>
                )}
              </div>
              <button className="btn btn-primary" onClick={onNext} autoFocus>
                {queue.length === 0 ? 'Avsluta →' : 'Nästa →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
