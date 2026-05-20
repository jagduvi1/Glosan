import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchList, submitScore } from '../api/lists';
import { updateGlos } from '../api/glosor';
import GloAvatar from '../components/GloAvatar';
import Flag from '../components/Flag';
import { LANG_TO_FLAG } from '../utils/lang';
import { shuffle, answerVariants } from '../utils/quiz';

const ROUNDS = 5;
const LIVES_PER_ROUND = 10;
const KEYBOARD_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', 'Å'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ö', 'Ä'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M']
];

// Strip combining diacritics so Swedish-keyboard users can guess accented
// letters like "é" by pressing "e". Then uppercase for letter comparison.
function normLetter(ch) {
  return ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

function isGuessable(ch) {
  return /\p{L}/u.test(ch);
}

function pickTargetWord(g, reversed) {
  // The list's reversed flag matches Quiz.jsx: reversed=true means user is
  // shown target language and writes source. For galge we want the *guessed*
  // word to be whatever they'd be writing in Quiz, so we mirror that.
  const expected = reversed ? g.source : g.target;
  const variants = answerVariants(expected);
  // For galge, pick the first (usually canonical) variant — multi-variant
  // targets like "söt/gullig" don't translate cleanly to a letter game.
  return variants[0] || expected;
}

// Classic "hänga gubbe" — the gallows is built piece by piece per miss,
// then Glo's body fills in. Tenth miss = fully hanged, game over.
//   1: base           4: rope           7: left arm    10: right leg → död
//   2: post           5: head (Glo)     8: right arm
//   3: crossbeam      6: torso          9: left leg
function HangmanFigure({ misses, dead }) {
  const stroke = 'var(--ink)';
  const w = 3;
  return (
    <svg
      width="180"
      height="220"
      viewBox="0 0 180 220"
      aria-hidden="true"
      style={{ flex: 'none', overflow: 'visible' }}
    >
      <g stroke={stroke} strokeWidth={w} strokeLinecap="round" fill="none">
        {/* 1: base */}
        {misses >= 1 && <line x1="14" y1="210" x2="130" y2="210" />}
        {/* 2: post */}
        {misses >= 2 && <line x1="36" y1="210" x2="36" y2="10" />}
        {/* 3: crossbeam */}
        {misses >= 3 && <line x1="34" y1="10" x2="122" y2="10" />}
        {/* 4: rope */}
        {misses >= 4 && <line x1="122" y1="10" x2="122" y2="38" />}
      </g>

      {/* 5: Glo's head dangles from the rope */}
      {misses >= 5 && (
        <image
          href={dead ? '/assets/glo-sad.svg' : '/assets/glo-mascot.svg'}
          x="98"
          y="38"
          width="48"
          height="48"
          style={{ transform: dead ? 'rotate(8deg)' : 'rotate(0deg)', transformOrigin: '122px 62px' }}
        />
      )}

      <g stroke={stroke} strokeWidth={w} strokeLinecap="round">
        {/* 6: torso */}
        {misses >= 6 && <line x1="122" y1="86" x2="122" y2="144" />}
        {/* 7: left arm */}
        {misses >= 7 && <line x1="122" y1="98" x2="96" y2="124" />}
        {/* 8: right arm */}
        {misses >= 8 && <line x1="122" y1="98" x2="148" y2="124" />}
        {/* 9: left leg */}
        {misses >= 9 && <line x1="122" y1="144" x2="100" y2="180" />}
        {/* 10: right leg */}
        {misses >= 10 && <line x1="122" y1="144" x2="144" y2="180" />}
      </g>
    </svg>
  );
}

export default function Galge() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { apiFetch } = useAuth();
  const [list, setList] = useState(null);
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const [guessed, setGuessed] = useState(new Set());
  const [livesLeft, setLivesLeft] = useState(LIVES_PER_ROUND);
  const [score, setScore] = useState({ correct: 0, wrong: 0 });
  const [bestStreak, setBestStreak] = useState(0);
  const [streak, setStreak] = useState(0);
  const [roundEnded, setRoundEnded] = useState(null); // 'won' | 'lost' | null
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchList(apiFetch, id);
      setList(data.list);
      const pool = data.glosor.filter((g) => {
        const target = pickTargetWord(g, data.list.quizReversed ?? true);
        // Galge needs at least one guessable letter — skip empty / pure-punct.
        return target && [...target].some(isGuessable);
      });
      if (pool.length === 0) {
        setError('Den här listan har inga glosor som passar i Glos-galge.');
        return;
      }
      const shuffled = shuffle(pool).slice(0, ROUNDS);
      setQueue(shuffled.slice(1));
      setCurrent(shuffled[0]);
      setGuessed(new Set());
      setLivesLeft(LIVES_PER_ROUND);
      setRoundEnded(null);
      setScore({ correct: 0, wrong: 0 });
      setStreak(0);
      setBestStreak(0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, id]);

  useEffect(() => { load(); }, [load]);

  const reversed = list?.quizReversed ?? true;
  const targetWord = useMemo(
    () => (current ? pickTargetWord(current, reversed) : ''),
    [current, reversed]
  );
  const promptWord = current ? (reversed ? current.target : current.source) : '';
  const promptLang = list ? (reversed ? list.targetLang : list.sourceLang) : '';
  const expectedLang = list ? (reversed ? list.sourceLang : list.targetLang) : '';

  // True once every guessable letter has been revealed.
  const isWordSolved = useMemo(() => {
    if (!targetWord) return false;
    for (const ch of targetWord) {
      if (!isGuessable(ch)) continue;
      if (!guessed.has(normLetter(ch))) return false;
    }
    return true;
  }, [targetWord, guessed]);

  const recordRound = useCallback(async (didWin) => {
    if (submittingRef.current || !current) return;
    submittingRef.current = true;
    setRoundEnded(didWin ? 'won' : 'lost');
    setScore((s) => didWin
      ? { ...s, correct: s.correct + 1 }
      : { ...s, wrong: s.wrong + 1 });
    const newStreak = didWin ? streak + 1 : 0;
    setStreak(newStreak);
    setBestStreak((b) => Math.max(b, newStreak));
    try {
      await updateGlos(apiFetch, current._id, {
        stats: {
          correct: (current.stats?.correct ?? 0) + (didWin ? 1 : 0),
          wrong: (current.stats?.wrong ?? 0) + (didWin ? 0 : 1)
        }
      });
    } catch { /* swallow */ }
    submittingRef.current = false;
  }, [apiFetch, current, streak]);

  // Watch for win / lose conditions automatically.
  useEffect(() => {
    if (!current || roundEnded) return;
    if (isWordSolved) recordRound(true);
    else if (livesLeft === 0) recordRound(false);
  }, [current, isWordSolved, livesLeft, roundEnded, recordRound]);

  const onGuess = (letter) => {
    if (roundEnded || !targetWord) return;
    const norm = normLetter(letter);
    if (guessed.has(norm)) return;
    const nextGuessed = new Set(guessed);
    nextGuessed.add(norm);
    setGuessed(nextGuessed);
    // Was the letter in the word? Check normalised characters so accents count.
    const inWord = [...targetWord].some((ch) => isGuessable(ch) && normLetter(ch) === norm);
    if (!inWord) setLivesLeft((l) => l - 1);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Enter' && roundEnded) {
        onNext();
        return;
      }
      if (e.key.length !== 1) return;
      const norm = normLetter(e.key);
      if (/^[A-ZÅÄÖ]$/.test(norm)) onGuess(e.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundEnded, guessed, targetWord, livesLeft]);

  const onNext = async () => {
    if (queue.length === 0) {
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
          mode: 'galge',
          list: updatedList,
          wasNewBest
        }
      });
      return;
    }
    setCurrent(queue[0]);
    setQueue((q) => q.slice(1));
    setGuessed(new Set());
    setLivesLeft(LIVES_PER_ROUND);
    setRoundEnded(null);
  };

  if (loading) return <p className="t-hand muted">Glo letar upp orden…</p>;
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
  const totalRounds = answered + (roundEnded ? 0 : 1) + queue.length;
  const progress = totalRounds > 0 ? Math.round((answered / totalRounds) * 100) : 0;

  return (
    <div style={{ marginTop: -28 }}>
      <div className="row between" style={{ padding: '14px 0', borderBottom: '2px solid var(--ink)', marginBottom: 28 }}>
        <Link to={`/lists/${id}`}>
          <button className="btn btn-ghost btn-sm" aria-label="Avbryt spel">× Avbryt</button>
        </Link>
        <div className="bar-shell" style={{ flex: 1, margin: '0 20px' }}>
          <div className="bar-fill bar-fill-coral" style={{ width: `${progress}%` }} />
        </div>
        <span className="t-hand muted">{answered} / {totalRounds}</span>
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div className="row between" style={{ marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {flag && (
              <span className="pill" style={{ background: 'var(--coral-soft)' }}>
                <Flag code={flag} size="sm" /> {list?.sourceLang}
              </span>
            )}
            <span className="pill" style={{ background: 'var(--berry-soft)' }}>läge: galge</span>
            <span className="pill">{promptLang} → {expectedLang}</span>
          </div>
          <span
            className="pill"
            style={{
              background: livesLeft <= 2 ? 'var(--berry-soft)' : 'var(--bg-elev)',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700
            }}
            aria-label={`${livesLeft} fel kvar`}
          >
            {livesLeft} fel kvar
          </span>
        </div>

        <div className="card card-lg" style={{ padding: 28 }}>
          <div
            className="row"
            style={{
              gap: 28,
              alignItems: 'center',
              justifyContent: 'center',
              flexWrap: 'wrap'
            }}
          >
            <HangmanFigure misses={LIVES_PER_ROUND - livesLeft} dead={livesLeft === 0} />
            <div style={{ minWidth: 260, flex: '1 1 260px', textAlign: 'center' }}>
              <div className="t-hand muted" style={{ fontSize: 16 }}>
                {promptLang} · översätt och gissa bokstäverna
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 44, lineHeight: 1.1, margin: '8px 0 4px' }}>
                {promptWord}
              </div>
              {current.notes && (
                <div className="t-hand muted" style={{ fontSize: 15 }}>· {current.notes}</div>
              )}

              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                  marginTop: 22,
                  minHeight: 56
                }}
              >
                {[...targetWord].map((ch, i) => {
                  const guess = isGuessable(ch);
                  const revealed = !guess || guessed.has(normLetter(ch));
                  const showOnLoss = roundEnded === 'lost' && !revealed;
                  return (
                    <span
                      key={i}
                      style={{
                        minWidth: guess ? 32 : 12,
                        borderBottom: guess ? '3px solid var(--ink)' : 'none',
                        padding: '6px 4px',
                        fontFamily: 'var(--font-display)',
                        fontSize: 36,
                        lineHeight: 1,
                        color: showOnLoss ? 'var(--berry-deep)' : 'var(--ink)',
                        textTransform: 'uppercase'
                      }}
                    >
                      {revealed ? ch : showOnLoss ? ch : ' '}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {roundEnded ? (
          <div
            className="card pop-in"
            style={{
              marginTop: 22,
              background: roundEnded === 'won' ? 'var(--leaf-soft)' : 'var(--berry-soft)',
              borderColor: roundEnded === 'won' ? 'var(--leaf-deep)' : 'var(--berry-deep)'
            }}
          >
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <GloAvatar mood={roundEnded === 'won' ? 'wink' : 'sad'} size={56} />
              <div className="grow">
                <h3 style={{ margin: 0 }}>
                  {roundEnded === 'won'
                    ? `Räddad! ${livesLeft} liv kvar.`
                    : `Glo blev hängd. Ordet var ${targetWord}.`}
                </h3>
                {roundEnded === 'won' && streak >= 2 && (
                  <p style={{ margin: '4px 0 0', fontFamily: 'var(--font-headline)', fontSize: 22, color: 'var(--coral-deep)' }}>
                    🔥 {streak} i rad!
                  </p>
                )}
              </div>
              <button className="btn btn-primary" onClick={onNext} autoFocus>
                {queue.length === 0 ? 'Avsluta' : 'Nästa →'}
              </button>
            </div>
          </div>
        ) : (
          <div className="card" style={{ marginTop: 18, padding: 14 }}>
            <div className="stack" style={{ gap: 8 }}>
              {KEYBOARD_ROWS.map((row, ri) => (
                <div
                  key={ri}
                  className="row"
                  style={{ gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}
                >
                  {row.map((letter) => {
                    const norm = normLetter(letter);
                    const used = guessed.has(norm);
                    const hit = used && [...targetWord].some((ch) => isGuessable(ch) && normLetter(ch) === norm);
                    return (
                      <button
                        key={letter}
                        onClick={() => onGuess(letter)}
                        disabled={used}
                        className="btn btn-sm"
                        style={{
                          minWidth: 38,
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 700,
                          background: used
                            ? hit ? 'var(--leaf-soft)' : 'var(--berry-soft)'
                            : 'var(--bg-elev)',
                          opacity: used && !hit ? 0.5 : 1
                        }}
                      >
                        {letter}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="t-hand muted" style={{ textAlign: 'center', fontSize: 13, marginTop: 12, marginBottom: 0 }}>
              tryck bokstavstangenter eller klicka. <code>enter</code> efter ronden för nästa.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
