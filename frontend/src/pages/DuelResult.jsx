import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchDuel } from '../api/duels';
import GloAvatar from '../components/GloAvatar';
import AvatarDisplay from '../components/AvatarDisplay';

function formatTime(ms) {
  if (!ms || ms <= 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// Resultatvy för en async-duell. Visar alla deltagares status; om alla är
// klara markeras vinnaren (flest rätt, tie-break på snabbast tid). Pending-
// deltagare visas med en "väntar"-pill.
export default function DuelResult() {
  const { id } = useParams();
  const { user, apiFetch } = useAuth();
  const [duel, setDuel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDuel(await fetchDuel(apiFetch, id));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="t-hand muted">Glo räknar ihop…</p>;
  if (error || !duel) {
    return (
      <div className="card card-lg" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
        <GloAvatar size={120} float mood="sad" style={{ margin: '0 auto 12px' }} />
        <h2>Kunde inte hämta utmaningen</h2>
        <p className="muted">{error || 'Något gick snett.'}</p>
        <Link to="/kompisar"><button className="btn btn-primary">Till kompisar</button></Link>
      </div>
    );
  }

  const allCompleted = duel.allCompleted;
  const isGoal = duel.kind === 'goal';
  // Rangordna: status=completed först, sen på correct desc, sen durationMs asc.
  const ranked = [...duel.participants].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'completed' ? -1 : 1;
    if (b.correct !== a.correct) return b.correct - a.correct;
    return (a.durationMs || 0) - (b.durationMs || 0);
  });

  const winnerId = allCompleted && ranked.length > 0 ? ranked[0].user?.toString() : null;
  const myId = user?.id || (typeof user === 'object' ? user._id : null);
  const goalMet = (p) => isGoal && duel.goal != null && p.status === 'completed' && p.correct >= duel.goal;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
      <div style={{ margin: '20px 0' }}>
        <GloAvatar
          size={150}
          float
          mood={allCompleted && winnerId === String(myId) ? 'wink' : allCompleted ? 'sad' : 'default'}
        />
      </div>
      <h1 style={{ fontSize: 44, margin: '8px 0 4px' }}>
        {isGoal && allCompleted
          ? (goalMet(ranked.find((p) => String(p.user) === String(myId))) ? <>Du <span className="mark-highlight">klarade målet</span>!</> : 'Klarade inte målet')
          : allCompleted
            ? (winnerId === String(myId) ? <>Du <span className="mark-highlight">vann</span>!</> : 'Slutresultat')
            : 'Utmaning pågår'}
      </h1>
      <p className="t-hand muted" style={{ fontSize: 17, margin: '0 0 24px' }}>
        {isGoal ? (duel.title || 'Klarar du den här?') : duel.list?.title}
        {isGoal && duel.goal != null && ` · mål: ${duel.goal}`}
        {!allCompleted && ' · väntar på att alla ska spela'}
      </p>

      <div className="card" style={{ padding: 0, overflow: 'hidden', textAlign: 'left' }}>
        {ranked.map((p, i) => {
          const isMe = p.user && String(p.user) === String(myId);
          // För 'duel': vinnare = #1. För 'goal': "vinnare"-färgning ges alla
          // som klarat målet, inte bara den första.
          const made = goalMet(p);
          const isWinner = isGoal
            ? made
            : (allCompleted && i === 0 && p.status === 'completed');
          const bg = isGoal
            ? (made ? 'var(--leaf-soft)' : p.status === 'completed' ? 'var(--berry-soft)' : 'var(--bg-elev)')
            : (isWinner ? 'var(--mustard-soft)' : isMe ? 'var(--paper-deep)' : 'var(--bg-elev)');
          return (
            <div
              key={p.user}
              className="row"
              style={{
                gap: 12,
                padding: '14px 18px',
                background: bg,
                borderBottom: i < ranked.length - 1 ? '1px dashed var(--paper-edge)' : 'none',
                alignItems: 'center'
              }}
            >
              <span style={{ width: 28, fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 18, textAlign: 'center' }}>
                {isGoal
                  ? (p.status === 'completed' ? (made ? '✓' : '✗') : '⏳')
                  : (isWinner ? '🥇' : p.status === 'completed' ? `#${i + 1}` : '⏳')}
              </span>
              <AvatarDisplay avatar={p.avatar} username={p.username || '?'} size={40} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 16 }}>{p.username || 'okänd'}</strong>
                  {isMe && <span className="t-hand muted" style={{ fontSize: 13 }}>(du)</span>}
                </div>
                <p className="t-hand muted" style={{ fontSize: 13, margin: '2px 0 0' }}>
                  {p.status === 'completed'
                    ? `${p.correct} / ${p.total} rätt · ${formatTime(p.durationMs)}${isGoal ? (made ? ' · klarade målet' : ' · missade målet') : ''}`
                    : 'har inte spelat än'}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="row" style={{ justifyContent: 'center', gap: 10, marginTop: 24 }}>
        <Link to="/kompisar"><button className="btn">Till kompisar</button></Link>
        {duel.list?._id && (
          <Link to={`/lists/${duel.list._id}`}><button className="btn btn-primary">Till listan →</button></Link>
        )}
      </div>
    </div>
  );
}
