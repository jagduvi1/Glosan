import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchList } from '../api/lists';
import Flag from '../components/Flag';
import GloAvatar from '../components/GloAvatar';
import { LANG_TO_FLAG } from '../utils/lang';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import { shuffle } from '../utils/quiz';

const CARDS_PER_PAGE = 5;

export default function Flashcards() {
  const { id } = useParams();
  const { apiFetch } = useAuth();
  const [list, setList] = useState(null);
  const [cards, setCards] = useState([]);
  const [page, setPage] = useState(0);
  const [flipped, setFlipped] = useState(() => new Set());
  const [reversed, setReversed] = useState(true);
  const [wrongOnly, setWrongOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useDocumentTitle(list?.title);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchList(apiFetch, id);
      setList(data.list);
      const pool = wrongOnly
        ? data.glosor.filter((g) => (g.stats?.wrong ?? 0) > 0)
        : data.glosor;
      setCards(shuffle(pool));
      setPage(0);
      setFlipped(new Set());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, id, wrongOnly]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(cards.length / CARDS_PER_PAGE));
  const pageCards = useMemo(
    () => cards.slice(page * CARDS_PER_PAGE, (page + 1) * CARDS_PER_PAGE),
    [cards, page]
  );

  const toggleFlip = (idx) => {
    setFlipped((cur) => {
      const next = new Set(cur);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const goPage = (delta) => {
    const next = Math.max(0, Math.min(totalPages - 1, page + delta));
    setPage(next);
    setFlipped(new Set()); // reset flip-state vid sidbyte
  };

  const flipAll = () => {
    // Om alla på sidan är flippade → vänd tillbaka, annars flippa alla
    setFlipped((cur) => {
      const allFlipped = pageCards.every((_, i) => cur.has(i));
      return allFlipped ? new Set() : new Set(pageCards.map((_, i) => i));
    });
  };

  const flag = LANG_TO_FLAG[list?.sourceLang];
  const progress = cards.length > 0 ? ((page + 1) / totalPages) * 100 : 0;

  if (loading) return <p className="t-hand muted">Glo blandar korten…</p>;
  if (error) return <p className="error">{error}</p>;

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

  const frontLang = reversed ? list?.targetLang : list?.sourceLang;
  const backLang = reversed ? list?.sourceLang : list?.targetLang;

  return (
    <div style={{ marginTop: -28 }}>
      <div className="row between" style={{ padding: '14px 0', borderBottom: '2px solid var(--ink)', marginBottom: 24 }}>
        <Link to={`/lists/${id}`}>
          <button className="btn btn-ghost btn-sm" aria-label="Avbryt">× Avbryt</button>
        </Link>
        <div className="bar-shell" style={{ flex: 1, margin: '0 20px' }}>
          <div className="bar-fill bar-fill-coral" style={{ width: `${progress}%` }} />
        </div>
        <span className="t-hand muted">sida {page + 1} / {totalPages}</span>
      </div>

      <div className="row between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
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
            onClick={() => { setReversed((r) => !r); setFlipped(new Set()); }}
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
        <button className="btn btn-sm" onClick={flipAll}>
          ↻ Vänd alla
        </button>
      </div>

      <div className="flashcard-grid">
        {pageCards.map((card, idx) => {
          const isFlipped = flipped.has(idx);
          const frontText = reversed ? card.target : card.source;
          const backText = reversed ? card.source : card.target;
          return (
            <button
              key={card._id}
              type="button"
              onClick={() => toggleFlip(idx)}
              className="card flashcard"
              aria-pressed={isFlipped}
              aria-label={`Glos ${idx + 1} på sidan. ${isFlipped ? 'Visar översättning' : 'Visar fråga'}. Klicka för att vända.`}
              style={{
                background: isFlipped ? 'var(--mustard-soft)' : 'var(--bg-elev)',
                cursor: 'pointer',
                position: 'relative',
                textAlign: 'left',
                font: 'inherit',
                color: 'var(--ink)',
                width: '100%'
              }}
            >
              <span
                className="sticker tilt-l"
                style={{
                  position: 'absolute', top: 10, left: 10,
                  background: isFlipped ? 'var(--leaf)' : 'var(--coral)',
                  color: 'var(--paper)',
                  fontSize: 11
                }}
              >
                {(isFlipped ? backLang : frontLang)?.toUpperCase()}
              </span>
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 28,
                  lineHeight: 1.15,
                  marginTop: 30,
                  wordBreak: 'break-word'
                }}
              >
                {isFlipped ? backText : frontText}
              </div>
              {card.notes && !isFlipped && (
                <div className="t-hand muted" style={{ fontSize: 13, marginTop: 6 }}>· {card.notes}</div>
              )}
              <div className="t-hand muted" style={{ fontSize: 12, marginTop: 8 }}>
                {isFlipped ? '↶ tryck för att vända tillbaka' : 'tryck för att vända →'}
              </div>
            </button>
          );
        })}
      </div>

      <div className="row between" style={{ marginTop: 24, flexWrap: 'wrap', gap: 10 }}>
        <button className="btn" onClick={() => goPage(-1)} disabled={page === 0}>← Föregående</button>
        <span className="t-hand muted">
          {page * CARDS_PER_PAGE + 1}–{Math.min((page + 1) * CARDS_PER_PAGE, cards.length)} av {cards.length}
        </span>
        {page < totalPages - 1 ? (
          <button className="btn btn-primary" onClick={() => goPage(1)}>Nästa {CARDS_PER_PAGE} →</button>
        ) : (
          <button className="btn btn-primary" onClick={load}>Blanda om & börja om</button>
        )}
      </div>
    </div>
  );
}
