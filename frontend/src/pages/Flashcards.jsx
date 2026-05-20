import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchList } from '../api/lists';
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

export default function Flashcards() {
  const { id } = useParams();
  const { apiFetch } = useAuth();
  const [list, setList] = useState(null);
  const [cards, setCards] = useState([]);
  const [index, setIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [reversed, setReversed] = useState(true);
  const [wrongOnly, setWrongOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchList(apiFetch, id);
      setList(data.list);
      const pool = wrongOnly
        ? data.glosor.filter((g) => (g.stats?.wrong ?? 0) > 0)
        : data.glosor;
      setCards(shuffle(pool));
      setIndex(0);
      setShowAnswer(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, id, wrongOnly]);

  useEffect(() => { load(); }, [load]);

  const next = () => {
    setShowAnswer(false);
    setIndex((i) => i + 1);
  };

  const flag = LANG_TO_FLAG[list?.sourceLang];
  const current = cards[index];
  const progress = cards.length > 0 ? (index / cards.length) * 100 : 0;

  if (loading) return <p className="t-hand muted">Glo blandar korten…</p>;
  if (error) return <p className="error">{error}</p>;

  // Empty state
  if (!current) {
    if (cards.length === 0) {
      return (
        <div className="card card-lg" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
          <GloAvatar size={120} float mood={wrongOnly ? 'wink' : 'default'} style={{ margin: '0 auto 12px' }} />
          <h2 style={{ marginBottom: 8 }}>
            {wrongOnly ? 'Inga fel-glosor att öva på' : 'Listan är tom'}
          </h2>
          <p className="muted" style={{ marginBottom: 18 }}>
            {wrongOnly
              ? 'Du har inte haft fel på några glosor än.'
              : 'Lägg till glosor på listan först.'}
          </p>
          <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
            {wrongOnly && (
              <button className="btn" onClick={() => setWrongOnly(false)}>Visa alla kort</button>
            )}
            <Link to={`/lists/${id}`}><button className="btn btn-primary">Tillbaka</button></Link>
          </div>
        </div>
      );
    }
    // Finished — all cards seen
    return (
      <div className="card card-lg" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
        <GloAvatar size={120} float mood="wink" style={{ margin: '0 auto 12px' }} />
        <h1 style={{ fontSize: 38 }}>Klart!</h1>
        <p className="t-hand muted" style={{ fontSize: 17, marginBottom: 18 }}>
          Alla {cards.length} kort genomgångna.
        </p>
        <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
          <button className="btn btn-primary" onClick={load}>Blanda och kör igen</button>
          <Link to={`/lists/${id}`}><button className="btn">Tillbaka till listan</button></Link>
        </div>
      </div>
    );
  }

  const frontLang = reversed ? list?.targetLang : list?.sourceLang;
  const backLang = reversed ? list?.sourceLang : list?.targetLang;
  const frontText = reversed ? current.target : current.source;
  const backText = reversed ? current.source : current.target;

  const onSwap = () => {
    setReversed((r) => !r);
    setShowAnswer(false);
  };

  return (
    <div style={{ marginTop: -28 }}>
      <div className="row between" style={{ padding: '14px 0', borderBottom: '2px solid var(--ink)', marginBottom: 28 }}>
        <Link to={`/lists/${id}`}>
          <button className="btn btn-ghost btn-sm" aria-label="Avbryt">× Avbryt</button>
        </Link>
        <div className="bar-shell" style={{ flex: 1, margin: '0 20px' }}>
          <div className="bar-fill bar-fill-coral" style={{ width: `${progress}%` }} />
        </div>
        <span className="t-hand muted">{index + 1} / {cards.length}</span>
      </div>

      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div className="row between" style={{ marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {flag && (
              <span className="pill" style={{ background: 'var(--coral-soft)' }}>
                <Flag code={flag} size="sm" /> {list?.sourceLang}
              </span>
            )}
            <span className="pill" style={{ background: 'var(--plum-soft)' }}>läge: flashkort</span>
            <button
              className="pill"
              type="button"
              onClick={onSwap}
              style={{
                background: 'transparent', border: '2px solid var(--ink)',
                cursor: 'pointer', font: 'inherit'
              }}
            >
              {frontLang} → {backLang}
            </button>
            <button
              className="pill"
              type="button"
              onClick={() => setWrongOnly((v) => !v)}
              style={{
                background: wrongOnly ? 'var(--berry-soft)' : 'transparent',
                border: '2px solid var(--ink)', cursor: 'pointer', font: 'inherit'
              }}
            >
              {wrongOnly ? '✓ ' : ''}bara fel
            </button>
          </div>
        </div>

        <div className="t-hand muted" style={{ fontSize: 18, marginBottom: 8 }}>
          {showAnswer ? 'Översättningen:' : 'Vad betyder ordet?'}
        </div>

        <div
          className="card card-lg"
          onClick={() => setShowAnswer((s) => !s)}
          style={{
            padding: 40,
            textAlign: 'center',
            cursor: 'pointer',
            userSelect: 'none',
            minHeight: 280,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            position: 'relative',
            background: showAnswer ? 'var(--mustard-soft)' : 'var(--bg-elev)'
          }}
        >
          <span
            className="sticker tilt-l"
            style={{ position: 'absolute', top: 14, left: 16, background: showAnswer ? 'var(--leaf)' : 'var(--coral)', color: 'var(--paper)' }}
          >
            {showAnswer ? backLang?.toUpperCase() : frontLang?.toUpperCase()}
          </span>
          <div className="t-hand muted" style={{ fontSize: 15, marginTop: 4 }}>
            {showAnswer ? 'tryck för att vända tillbaka' : 'tryck för att vända →'}
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 90, lineHeight: 1, margin: '12px 0' }}>
            {showAnswer ? backText : frontText}
          </div>
          {current.notes && !showAnswer && (
            <div className="t-hand muted" style={{ fontSize: 16 }}>· {current.notes}</div>
          )}
        </div>

        <div className="row between" style={{ marginTop: 24 }}>
          <span className="t-hand muted" style={{ fontSize: 14 }}>
            Kort {index + 1} / {cards.length}
          </span>
          <button className="btn btn-primary" onClick={next}>Nästa →</button>
        </div>
      </div>
    </div>
  );
}
