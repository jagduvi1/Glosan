import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchList, submitScore } from '../api/lists';
import { updateGlos } from '../api/glosor';
import { fetchCategoryPool } from '../api/categories';
import GloAvatar from '../components/GloAvatar';
import Flag from '../components/Flag';
import ConfettiBurst from '../components/ConfettiBurst';
import { LANG_TO_FLAG } from '../utils/lang';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import { shuffle, answerVariants } from '../utils/quiz';

const SNAKE_MASTER_THRESHOLD = 50;

// Spelplan: rutnät av celler. Cellstorlek räknas ut i CSS via clamp så
// det funkar både på mobil och desktop utan att jaga viewport-mått i JS.
// Orm är "endless" — spelet slutar bara när ormen krockar eller liven
// tar slut, och poolen fylls på med ord från samma kategori när listans
// egna glosor börjar ta slut.
const COLS = 16;
const ROWS = 12;
const TICK_MS = 220;     // hur ofta ormen flyttas
const LIVES = 3;
const MIN_FOODS = 3;     // alltid 1 rätt + 2-3 fel
const POOL_FETCH_LIMIT = 200;

// Färgpalett för matrutorna. Varje runda får varje matruta en egen färg
// och i sidopanelen står ordet i samma färg. Spelaren måste läsa ordet,
// notera färgen, och styra ormen till boxen med rätt färg.
const FOOD_COLORS = [
  { key: 'coral',   var: 'var(--coral)' },
  { key: 'sky',     var: 'var(--sky)' },
  { key: 'mustard', var: 'var(--mustard)' },
  { key: 'plum',    var: 'var(--plum)' }
];

function emptyCellFar(occupied, near) {
  // Hitta en cell som inte ligger på ormen/maten och inte alldeles intill `near`.
  for (let attempt = 0; attempt < 100; attempt++) {
    const x = Math.floor(Math.random() * COLS);
    const y = Math.floor(Math.random() * ROWS);
    if (occupied.some((c) => c.x === x && c.y === y)) continue;
    if (near && Math.abs(x - near.x) < 2 && Math.abs(y - near.y) < 2) continue;
    return { x, y };
  }
  // fallback om planen är supertajt
  return { x: 0, y: 0 };
}

function pickFood(glosor, currentGlosId, reversed) {
  // Plocka 3 distraktorer från andra glosor + det rätta svaret, och tilldela
  // varje matruta en egen färg från paletten (slumpas varje runda).
  const cur = glosor.find((g) => g._id === currentGlosId);
  if (!cur) return { correctText: '', foods: [] };
  const correctText = (reversed ? cur.source : cur.target).split('/')[0].trim();
  const distractorPool = glosor
    .filter((g) => g._id !== currentGlosId)
    .map((g) => (reversed ? g.source : g.target).split('/')[0].trim())
    .filter((t) => t && t.toLowerCase() !== correctText.toLowerCase());
  const distractorCount = Math.min(3, distractorPool.length);
  const distractors = shuffle(distractorPool).slice(0, distractorCount);
  const items = shuffle([
    { text: correctText, correct: true },
    ...distractors.map((t) => ({ text: t, correct: false }))
  ]);
  const colors = shuffle(FOOD_COLORS).slice(0, items.length);
  const all = items.map((item, i) => ({ ...item, color: colors[i] }));
  return { correctText, foods: all };
}

function placeFoods(snake, foods, dir = { dx: 1, dy: 0 }) {
  // Slumpa slut-positioner för 3-4 mat-celler så att de inte krockar med
  // ormen eller varandra. Lägg också intro-positioner: en rad framför
  // ormhuvudet i rörelseriktningen, så spelaren ser alla orden samlade
  // under nedräkningen innan de flyger ut till sina slumpmässiga platser.
  const occupied = [...snake];
  const placed = [];
  for (const f of foods) {
    const head = snake[snake.length - 1];
    const cell = emptyCellFar(occupied, head);
    placed.push({ ...f, ...cell });
    occupied.push(cell);
  }

  const head = snake[snake.length - 1];
  const { dx, dy } = dir;
  // Vinkelrät enhetsvektor — raden ligger tvärs ormens rörelse
  const px = -dy;
  const py = dx;
  const count = placed.length;
  const offset = 3; // antal rutor framför ormhuvudet
  const startX = head.x + dx * offset - px * Math.floor((count - 1) / 2);
  const startY = head.y + dy * offset - py * Math.floor((count - 1) / 2);
  const intros = Array.from({ length: count }, (_, i) => ({
    introX: startX + px * i,
    introY: startY + py * i
  }));
  const allInBounds = intros.every((p) =>
    p.introX >= 0 && p.introX < COLS && p.introY >= 0 && p.introY < ROWS
  );
  if (allInBounds) {
    return placed.map((f, i) => ({ ...f, ...intros[i] }));
  }
  // Fallback: central rad nära toppen, alltid synlig
  const fStart = Math.floor((COLS - count) / 2);
  const fY = Math.max(1, Math.floor(ROWS / 4));
  return placed.map((f, i) => ({ ...f, introX: fStart + i, introY: fY }));
}

export default function SnakeGame() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { apiFetch } = useAuth();
  const [list, setList] = useState(null);
  const [glosor, setGlosor] = useState([]);
  const [phase, setPhase] = useState('loading'); // loading | menu | playing | error
  const [error, setError] = useState('');

  // Spel-state
  const [snake, setSnake] = useState([]); // array av {x, y}, sista = huvud
  const [dir, setDir] = useState({ dx: 1, dy: 0 });
  const dirRef = useRef({ dx: 1, dy: 0 });
  const pendingDirRef = useRef(null);
  const [foods, setFoods] = useState([]);
  const [pool, setPool] = useState([]); // växande pool: börjar = listans glosor, fylls på från kategorin
  const [currentGlosId, setCurrentGlosId] = useState(null);
  const [lives, setLives] = useState(LIVES);
  const [score, setScore] = useState({ correct: 0, wrong: 0 });
  const [feedback, setFeedback] = useState(null); // 'correct' | 'wrong' | null
  const [bestStreak, setBestStreak] = useState(0);
  const [streak, setStreak] = useState(0);
  const submittingRef = useRef(false);
  const fetchingPoolRef = useRef(false);     // hindrar parallella fetches
  const poolExhaustedRef = useRef(false);    // satt när kategorin inte har fler ord
  const pausedRef = useRef(false);           // game-loop tickar inte när true
  const [pauseCountdown, setPauseCountdown] = useState(0); // 3..2..1..0 = ingen paus
  const [masterTrigger, setMasterTrigger] = useState(0);   // höjs när påskägg-sticker triggas
  const [showMasterSticker, setShowMasterSticker] = useState(false);
  const masterTriggeredRef = useRef(false);  // bara en gång per spelrunda

  useDocumentTitle(list ? `Orm · ${list.title}` : 'Orm');

  const reversed = list?.quizReversed ?? true;
  const currentGlos = useMemo(
    () => pool.find((g) => g._id === currentGlosId),
    [pool, currentGlosId]
  );
  const promptWord = currentGlos
    ? (reversed ? currentGlos.target : currentGlos.source)
    : '';
  const promptLang = list ? (reversed ? list.targetLang : list.sourceLang) : '';
  const expectedLang = list ? (reversed ? list.sourceLang : list.targetLang) : '';

  const load = useCallback(async () => {
    setPhase('loading');
    try {
      const data = await fetchList(apiFetch, id);
      setList(data.list);
      const pool = data.glosor.filter((g) => (g.source || '').trim() && (g.target || '').trim());
      if (pool.length < 4) {
        setError('Listan behöver minst 4 glosor för att spela Orm.');
        setPhase('error');
        return;
      }
      setGlosor(shuffle(pool));
      setPhase('menu');
    } catch (e) {
      setError(e.message);
      setPhase('error');
    }
  }, [apiFetch, id]);

  useEffect(() => { load(); }, [load]);

  const startGame = useCallback(() => {
    const startSnake = [
      { x: 4, y: Math.floor(ROWS / 2) },
      { x: 5, y: Math.floor(ROWS / 2) },
      { x: 6, y: Math.floor(ROWS / 2) }
    ];
    setSnake(startSnake);
    setDir({ dx: 1, dy: 0 });
    dirRef.current = { dx: 1, dy: 0 };
    pendingDirRef.current = null;
    setLives(LIVES);
    setScore({ correct: 0, wrong: 0 });
    setStreak(0);
    setBestStreak(0);
    setFeedback(null);
    fetchingPoolRef.current = false;
    poolExhaustedRef.current = false;
    pausedRef.current = true;
    setPauseCountdown(3);
    masterTriggeredRef.current = false;
    setShowMasterSticker(false);
    const initialPool = shuffle(glosor);
    setPool(initialPool);
    const firstGlos = initialPool[0];
    setCurrentGlosId(firstGlos._id);
    const { foods: f } = pickFood(initialPool, firstGlos._id, reversed);
    setFoods(placeFoods(startSnake, f, { dx: 1, dy: 0 }));
    setPhase('playing');
  }, [glosor, reversed]);

  // Nedräknings-timer som pausar ormens rörelse. Sätt pauseCountdown till
  // ett tal > 0 så räknas det ner till 0 och pausedRef synkas automatiskt.
  // När countdown når 0 ger vi 500 ms extra så foods hinner glida ut till
  // sina slutpositioner innan ormen får röra sig igen.
  useEffect(() => {
    if (pauseCountdown <= 0) {
      const t = setTimeout(() => { pausedRef.current = false; }, 500);
      return () => clearTimeout(t);
    }
    pausedRef.current = true;
    const timer = setTimeout(() => setPauseCountdown((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(timer);
  }, [pauseCountdown]);

  // Tangentbordskontroll: pilar / WASD. Buffrar nästa riktning så man inte
  // kan tvärvända (180°) som dödar ormen direkt.
  useEffect(() => {
    if (phase !== 'playing') return undefined;
    const onKey = (e) => {
      const k = e.key;
      const map = {
        ArrowUp: { dx: 0, dy: -1 }, w: { dx: 0, dy: -1 }, W: { dx: 0, dy: -1 },
        ArrowDown: { dx: 0, dy: 1 }, s: { dx: 0, dy: 1 }, S: { dx: 0, dy: 1 },
        ArrowLeft: { dx: -1, dy: 0 }, a: { dx: -1, dy: 0 }, A: { dx: -1, dy: 0 },
        ArrowRight: { dx: 1, dy: 0 }, d: { dx: 1, dy: 0 }, D: { dx: 1, dy: 0 }
      };
      const next = map[k];
      if (!next) return;
      e.preventDefault();
      const cur = dirRef.current;
      // Spärra 180-graders vändning
      if (next.dx === -cur.dx && next.dy === -cur.dy) return;
      pendingDirRef.current = next;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  // Game-loop: var TICK_MS flyttas ormen ett steg i nuvarande riktning,
  // efter att eventuell köad ny riktning applicerats. Pausad mellan rundor
  // så spelaren hinner läsa orden i sidopanelen.
  useEffect(() => {
    if (phase !== 'playing') return undefined;
    const tick = () => {
      if (pausedRef.current) return;
      setSnake((cur) => {
        // Applicera buffrad riktning
        if (pendingDirRef.current) {
          dirRef.current = pendingDirRef.current;
          pendingDirRef.current = null;
        }
        const { dx, dy } = dirRef.current;
        const head = cur[cur.length - 1];
        const nextHead = { x: head.x + dx, y: head.y + dy };

        // Vägg-krock
        if (nextHead.x < 0 || nextHead.x >= COLS || nextHead.y < 0 || nextHead.y >= ROWS) {
          handleCrash();
          return cur;
        }
        // Själv-krock
        if (cur.some((c) => c.x === nextHead.x && c.y === nextHead.y)) {
          handleCrash();
          return cur;
        }
        // Mat?
        const eaten = foods.find((f) => f.x === nextHead.x && f.y === nextHead.y);
        if (eaten) {
          handleEat(eaten);
          // Vid rätt mat växer ormen; vid fel mat förblir längden samma
          if (eaten.correct) {
            return [...cur, nextHead];
          }
          return [...cur.slice(1), nextHead];
        }
        // Vanligt steg — flytta huvudet, ta bort svansen
        return [...cur.slice(1), nextHead];
      });
    };
    const interval = setInterval(tick, TICK_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, foods]);

  const maybeFetchMore = useCallback((curIdx) => {
    // Förladda fler glosor från samma kategori när vi passerat halva poolen
    // och inte redan har hämtat (eller försökt och fått tomt).
    if (poolExhaustedRef.current || fetchingPoolRef.current) return;
    if (!list?.categoryId) { poolExhaustedRef.current = true; return; }
    if (curIdx < Math.floor(pool.length / 2)) return;

    fetchingPoolRef.current = true;
    fetchCategoryPool(apiFetch, list.categoryId, {
      mode: 'all',
      excludeListId: id,
      limit: POOL_FETCH_LIMIT
    }).then((data) => {
      const existing = new Set(pool.map((g) => g._id));
      const fresh = (data.glosor || []).filter((g) =>
        !existing.has(g._id) && (g.source || '').trim() && (g.target || '').trim()
      );
      if (fresh.length > 0) {
        setPool((cur) => [...cur, ...shuffle(fresh)]);
      } else {
        poolExhaustedRef.current = true;
      }
    }).catch((err) => {
      console.error('Snake category-pool fetch failed:', err);
      // Vid fel: cykla bara om från befintlig pool
      poolExhaustedRef.current = true;
    }).finally(() => {
      fetchingPoolRef.current = false;
    });
  }, [apiFetch, id, list, pool]);

  const handleEat = (eaten) => {
    const wasCorrect = eaten.correct;
    setFeedback(wasCorrect ? 'correct' : 'wrong');
    setTimeout(() => setFeedback(null), 350);

    if (wasCorrect) {
      setScore((s) => ({ ...s, correct: s.correct + 1 }));
      const newStreak = streak + 1;
      setStreak(newStreak);
      setBestStreak((b) => Math.max(b, newStreak));

      // Påskägg: 50 rätt i rad → Orm-mästare-sticker + konfetti, en gång per körning
      if (!masterTriggeredRef.current && newStreak >= SNAKE_MASTER_THRESHOLD) {
        masterTriggeredRef.current = true;
        setMasterTrigger((t) => t + 1);
        setShowMasterSticker(true);
        setTimeout(() => setShowMasterSticker(false), 4000);
      }

      // Räkna glos-stat på server (best-effort)
      if (currentGlos) {
        updateGlos(apiFetch, currentGlos._id, {
          stats: {
            correct: (currentGlos.stats?.correct ?? 0) + 1,
            wrong: currentGlos.stats?.wrong ?? 0
          }
        }).catch(() => { /* swallow */ });
      }

      // Nästa glosa från poolen (cyklar runt om vi inte hunnit fylla på)
      const curIdx = pool.findIndex((g) => g._id === currentGlos._id);
      const nextIdx = (curIdx + 1) % pool.length;
      const nextGlos = pool[nextIdx];
      setCurrentGlosId(nextGlos._id);
      const { foods: f } = pickFood(pool, nextGlos._id, reversed);
      // placera nya mat — men vi måste använda *nyaste* ormen, så vänta en mikrotick
      setTimeout(() => {
        setSnake((s) => {
          setFoods(placeFoods(s, f, dirRef.current));
          return s;
        });
      }, 0);

      // Pausa ormen 3 sekunder så spelaren hinner läsa det nya ordet
      pausedRef.current = true;
      setPauseCountdown(3);

      // Trigga ev. förladdning av fler ord från kategorin (best-effort)
      maybeFetchMore(curIdx);
    } else {
      // Fel mat — förlorar liv, glosan kvarstår, generera nya mat-positioner
      setScore((s) => ({ ...s, wrong: s.wrong + 1 }));
      setStreak(0);
      if (currentGlos) {
        updateGlos(apiFetch, currentGlos._id, {
          stats: {
            correct: currentGlos.stats?.correct ?? 0,
            wrong: (currentGlos.stats?.wrong ?? 0) + 1
          }
        }).catch(() => { /* swallow */ });
      }
      setLives((l) => {
        const next = l - 1;
        if (next <= 0) {
          finishGame(score.correct, score.wrong + 1);
          return 0;
        }
        // Refresh foods för samma glosa
        const { foods: f } = pickFood(pool, currentGlos._id, reversed);
        setTimeout(() => {
          setSnake((s) => {
            setFoods(placeFoods(s, f, dirRef.current));
            return s;
          });
        }, 0);
        return next;
      });
    }
  };

  const handleCrash = () => {
    finishGame(score.correct, score.wrong + 1);
  };

  const finishGame = async (correct, wrong) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setPhase('loading');
    const total = correct + wrong;
    let updatedList = list;
    let wasNewBest = false;
    if (total > 0) {
      try {
        const r = await submitScore(apiFetch, id, { correct, total });
        updatedList = r.list;
        wasNewBest = r.wasNewBest;
      } catch (e) {
        console.error('Submit score failed:', e.message);
      }
    }
    navigate(`/lists/${id}/results`, {
      replace: true,
      state: {
        correct,
        wrong,
        extraCorrect: 0,
        extraWrong: 0,
        bestStreak,
        wrongOnly: false,
        mode: 'snake',
        list: updatedList,
        wasNewBest
      }
    });
  };

  // Touch / swipe-kontroller för mobil
  const touchStartRef = useRef(null);
  const onTouchStart = (e) => {
    const t = e.changedTouches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    const start = touchStartRef.current;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
    const cur = dirRef.current;
    let next;
    if (Math.abs(dx) > Math.abs(dy)) {
      next = dx > 0 ? { dx: 1, dy: 0 } : { dx: -1, dy: 0 };
    } else {
      next = dy > 0 ? { dx: 0, dy: 1 } : { dx: 0, dy: -1 };
    }
    if (next.dx === -cur.dx && next.dy === -cur.dy) return;
    pendingDirRef.current = next;
  };

  if (phase === 'loading') {
    return <p className="t-hand muted">Glo förbereder ormen…</p>;
  }
  if (phase === 'error') {
    return (
      <div className="card card-lg" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
        <GloAvatar size={120} float mood="sad" style={{ margin: '0 auto 12px' }} />
        <h2>{error}</h2>
        <Link to={`/lists/${id}`}><button className="btn btn-primary">Tillbaka till listan</button></Link>
      </div>
    );
  }

  if (phase === 'menu') {
    return (
      <div className="card card-lg" style={{ maxWidth: 560, margin: '40px auto', textAlign: 'center' }}>
        <GloAvatar size={140} float mood="wink" style={{ margin: '0 auto 8px' }} />
        <h1 style={{ marginBottom: 6 }}>🐍 Orm</h1>
        <p className="t-hand muted" style={{ fontSize: 16, margin: '0 0 18px' }}>
          Läs orden i sidopanelen, hitta rätt översättning och styr ormen till
          boxen med samma färg. Pilar/WASD på datorn, svep med fingret på mobil.
          {' '}{LIVES} liv — kör så långt du kan!
        </p>
        <button className="btn btn-primary btn-lg" onClick={startGame}>Starta →</button>
        <p className="t-hand muted" style={{ fontSize: 13, marginTop: 14 }}>
          Tips: när listans glosor tar slut fyller Glo på med fler ord från samma
          tema. Fel färg krymper inte ormen, men kostar ett liv.
        </p>
      </div>
    );
  }

  // Spelvy
  const flag = LANG_TO_FLAG[list?.sourceLang];
  const snakeHead = snake[snake.length - 1];
  const cellSet = new Map();
  snake.forEach((c, i) => cellSet.set(`${c.x}-${c.y}`, i === snake.length - 1 ? 'head' : 'body'));
  const foodMap = new Map(foods.map((f) => [`${f.x}-${f.y}`, f]));

  return (
    <div style={{ marginTop: -28, position: 'relative' }}>
      <ConfettiBurst trigger={masterTrigger} count={120} duration={3400} />
      {showMasterSticker && (
        <div className="snake-master-sticker pop-in" role="status">
          🐍 ORM-MÄSTARE!
          <div className="t-hand" style={{ fontSize: 13, fontWeight: 600, opacity: 0.85, marginTop: 2 }}>
            50 rätt i rad — galet bra
          </div>
        </div>
      )}
      <div className="row between" style={{ padding: '14px 0', borderBottom: '2px solid var(--ink)', marginBottom: 16 }}>
        <Link to={`/lists/${id}`}>
          <button className="btn btn-ghost btn-sm" aria-label="Avbryt spel">× Avbryt</button>
        </Link>
        <span className="t-hand muted">{score.correct} rätt{streak >= 2 ? ` · ${streak} i rad` : ''}</span>
      </div>

      <div className="row between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {flag && (
            <span className="pill" style={{ background: 'var(--coral-soft)' }}>
              <Flag code={flag} size="sm" /> {list?.sourceLang}
            </span>
          )}
          <span className="pill" style={{ background: 'var(--leaf-soft)' }}>🐍 orm</span>
          <span className="pill">{promptLang} → {expectedLang}</span>
        </div>
        <div className="row" style={{ gap: 4 }}>
          {Array.from({ length: LIVES }).map((_, i) => (
            <span
              key={i}
              style={{
                fontSize: 18, lineHeight: 1,
                opacity: i < lives ? 1 : 0.25,
                filter: i < lives ? 'none' : 'grayscale(1)'
              }}
            >
              {i < lives ? '❤' : '✕'}
            </span>
          ))}
        </div>
      </div>

      <div className="snake-layout">
        <aside className="snake-wordlist card">
          <p className="t-hand muted" style={{ fontSize: 14, margin: '0 0 2px' }}>
            Hitta översättningen av:
          </p>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, lineHeight: 1.05, marginBottom: 14, wordBreak: 'break-word' }}>
            {promptWord}
          </div>
          <p className="t-hand muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
            Ät boxen med rätt färg ↓
          </p>
          <div className="snake-wordlist-items">
            {foods.map((f, i) => (
              <div key={`${f.text}-${i}`} className="snake-wordlist-item">
                <span className="snake-wordlist-swatch" style={{ background: f.color.var }} aria-hidden="true" />
                <span className="snake-wordlist-text">{f.text}</span>
              </div>
            ))}
          </div>
        </aside>

        <div className="snake-board-wrap" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <div
            className="snake-board"
            style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gridTemplateRows: `repeat(${ROWS}, 1fr)` }}
          >
            {Array.from({ length: ROWS * COLS }).map((_, i) => {
              const x = i % COLS;
              const y = Math.floor(i / COLS);
              const seg = cellSet.get(`${x}-${y}`);
              return (
                <div
                  key={i}
                  className={`snake-cell ${seg ? 'snake-' + seg : ''}`}
                />
              );
            })}
            <div className="snake-food-layer" aria-hidden="true">
              {foods.map((f, i) => {
                const useIntro = pauseCountdown > 0;
                const fx = useIntro ? f.introX : f.x;
                const fy = useIntro ? f.introY : f.y;
                let bg = f.color.var;
                if (!useIntro) {
                  if (feedback === 'correct' && f.correct) bg = 'var(--leaf)';
                  else if (feedback === 'wrong' && !f.correct) bg = 'var(--berry)';
                }
                return (
                  <div
                    key={`food-${i}`}
                    className="snake-food-piece"
                    style={{
                      left: `${(fx / COLS) * 100}%`,
                      top: `${(fy / ROWS) * 100}%`,
                      width: `${(1 / COLS) * 100}%`,
                      height: `${(1 / ROWS) * 100}%`,
                      background: bg
                    }}
                  />
                );
              })}
            </div>
            {pauseCountdown > 0 && (
              <div className="snake-pause-overlay" aria-live="polite">
                <div className="snake-pause-card">
                  <p className="t-hand" style={{ margin: 0, fontSize: 14 }}>Nytt ord</p>
                  <div className="snake-pause-count">{pauseCountdown}</div>
                </div>
              </div>
            )}
          </div>

          {/* Pil-knappar för mobil */}
          <div className="snake-dpad" aria-hidden="true">
            <button className="snake-dpad-btn" onClick={() => { const c = dirRef.current; if (!(c.dy === 1)) pendingDirRef.current = { dx: 0, dy: -1 }; }}>↑</button>
            <div className="row" style={{ gap: 36 }}>
              <button className="snake-dpad-btn" onClick={() => { const c = dirRef.current; if (!(c.dx === 1)) pendingDirRef.current = { dx: -1, dy: 0 }; }}>←</button>
              <button className="snake-dpad-btn" onClick={() => { const c = dirRef.current; if (!(c.dx === -1)) pendingDirRef.current = { dx: 1, dy: 0 }; }}>→</button>
            </div>
            <button className="snake-dpad-btn" onClick={() => { const c = dirRef.current; if (!(c.dy === -1)) pendingDirRef.current = { dx: 0, dy: 1 }; }}>↓</button>
          </div>
        </div>
      </div>
    </div>
  );
}
