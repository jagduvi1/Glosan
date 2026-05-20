import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchList } from '../api/lists';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchList(apiFetch, id);
      setList(data.list);
      setCards(shuffle(data.glosor));
      setIndex(0);
      setShowAnswer(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, id]);

  useEffect(() => { load(); }, [load]);

  const next = () => {
    setShowAnswer(false);
    setIndex((i) => i + 1);
  };

  if (loading) return <p>Laddar…</p>;
  if (error) return <p className="error">{error}</p>;

  const current = cards[index];

  if (!current) {
    return (
      <div className="stack" style={{ maxWidth: 480, margin: '0 auto' }}>
        <h2>Klar — alla {cards.length} kort genomgångna</h2>
        <div className="row">
          <button className="primary" onClick={load}>Blanda och kör igen</button>
          <Link to={`/lists/${id}`}><button>Tillbaka till listan</button></Link>
        </div>
      </div>
    );
  }

  const frontLang = reversed ? list?.targetLang : list?.sourceLang;
  const backLang  = reversed ? list?.sourceLang : list?.targetLang;
  const frontText = reversed ? current.target : current.source;
  const backText  = reversed ? current.source : current.target;

  const onSwap = () => {
    setReversed((r) => !r);
    setShowAnswer(false);
  };

  return (
    <div className="stack" style={{ maxWidth: 480, margin: '0 auto' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Link to={`/lists/${id}`}><button>← Tillbaka</button></Link>
        <span className="muted">{list?.title}</span>
      </div>

      <div className="row" style={{ justifyContent: 'center' }}>
        <button onClick={onSwap}>Riktning: {frontLang} → {backLang} (byt)</button>
      </div>

      <div
        className="card"
        onClick={() => setShowAnswer((s) => !s)}
        style={{
          textAlign: 'center',
          cursor: 'pointer',
          minHeight: '220px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          userSelect: 'none'
        }}
      >
        <p className="muted" style={{ margin: 0 }}>
          {showAnswer ? backLang : frontLang}
        </p>
        <h2 style={{ fontSize: '2rem', margin: '0.5rem 0' }}>
          {showAnswer ? backText : frontText}
        </h2>
        <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
          {showAnswer ? 'Klicka för att vända tillbaka' : 'Klicka för att se översättningen'}
        </p>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted">Kort {index + 1} / {cards.length}</span>
        <button className="primary" onClick={next}>Nästa</button>
      </div>
    </div>
  );
}
