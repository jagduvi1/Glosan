import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getSocket } from '../utils/socket';
import GloAvatar from '../components/GloAvatar';
import AvatarDisplay from '../components/AvatarDisplay';

// Realtidsduell över WebSocket. Lobby först (väntar på båda + ready),
// sen frågor en åt gången där först rätt vinner poängen.
export default function LiveDuel() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { token, user } = useAuth();

  const [phase, setPhase] = useState('connecting'); // connecting | lobby | starting | round | result | error
  const [lobby, setLobby] = useState(null); // { participants, questionCount }
  const [round, setRound] = useState(null); // { index, total, question }
  const [scores, setScores] = useState([]); // [{ userId, score }]
  const [feedback, setFeedback] = useState(null); // { winnerId, expected, isCorrect, given }
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [opponentLeft, setOpponentLeft] = useState(false);
  const [iAmReady, setIAmReady] = useState(false);
  const myId = user?.id || user?._id;

  const socketRef = useRef(null);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    let cleanup = null;

    (async () => {
      const socket = await getSocket(token);
      if (cancelled || !socket) return;
      socketRef.current = socket;

      const onConnect = () => {
        setPhase('connecting');
        socket.emit('live:join', { duelId: id });
      };
      const onLobby = (data) => {
        setLobby(data);
        setPhase((p) => (p === 'round' || p === 'starting' ? p : 'lobby'));
      };
      const onLobbyUpdate = (data) => {
        setLobby((cur) => cur ? { ...cur, participants: cur.participants.map((p) => ({ ...p, ready: data.ready.includes(String(p.userId)) })) } : cur);
      };
      const onStart = () => {
        setPhase('starting');
        setFeedback(null);
      };
      const onRound = (data) => {
        setPhase('round');
        setRound(data);
        setFeedback(null);
        setAnswer('');
        setSubmitting(false);
      };
      const onRoundResult = (data) => {
        setFeedback(data);
        setScores(data.scores);
      };
      const onGameOver = () => {
        setPhase('result');
        setTimeout(() => navigate(`/duels/${id}/result`, { replace: true }), 600);
      };
      const onOpponentLeft = ({ userId }) => {
        if (String(userId) !== String(myId)) setOpponentLeft(true);
      };
      const onError = (msg) => {
        setError(typeof msg === 'string' ? msg : 'Något gick fel.');
        setPhase('error');
      };
      const onConnectError = (err) => onError(err.message);

      socket.on('connect', onConnect);
      socket.on('live:lobby', onLobby);
      socket.on('live:lobby-update', onLobbyUpdate);
      socket.on('live:start', onStart);
      socket.on('live:round', onRound);
      socket.on('live:round-result', onRoundResult);
      socket.on('live:game-over', onGameOver);
      socket.on('live:opponent-left', onOpponentLeft);
      socket.on('live:error', onError);
      socket.on('connect_error', onConnectError);

      if (socket.connected) onConnect();

      cleanup = () => {
        socket.off('connect', onConnect);
        socket.off('live:lobby', onLobby);
        socket.off('live:lobby-update', onLobbyUpdate);
        socket.off('live:start', onStart);
        socket.off('live:round', onRound);
        socket.off('live:round-result', onRoundResult);
        socket.off('live:game-over', onGameOver);
        socket.off('live:opponent-left', onOpponentLeft);
        socket.off('live:error', onError);
        socket.off('connect_error', onConnectError);
      };
    })();

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
  }, [id, token, myId, navigate]);

  const sendReady = () => {
    socketRef.current?.emit('live:ready');
    setIAmReady(true);
  };

  const sendAnswer = (e) => {
    e.preventDefault();
    if (!round || submitting || feedback) return;
    const trimmed = answer.trim();
    if (!trimmed) return;
    setSubmitting(true);
    socketRef.current?.emit('live:answer', { index: round.index, given: trimmed });
  };

  if (phase === 'error') {
    return (
      <div className="card card-lg" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
        <GloAvatar size={120} float mood="sad" style={{ margin: '0 auto 12px' }} />
        <h2>Live-duellen kraschade</h2>
        <p className="muted">{error}</p>
        <Link to="/kompisar"><button className="btn btn-primary">Till kompisar</button></Link>
      </div>
    );
  }

  if (phase === 'connecting' || !lobby) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <GloAvatar size={120} float />
        <p className="t-hand muted" style={{ marginTop: 16 }}>Kopplar upp mot live-duellen…</p>
      </div>
    );
  }

  // Lobby
  if (phase === 'lobby') {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
        <h1 style={{ marginBottom: 6 }}>⚡ Live-duell</h1>
        <p className="t-hand muted" style={{ fontSize: 17, margin: '0 0 24px' }}>
          {lobby.questionCount} frågor. Först rätt på varje fråga vinner poängen.
        </p>
        <div className="card" style={{ padding: 18, marginBottom: 18 }}>
          <div className="stack" style={{ gap: 10 }}>
            {lobby.participants.map((p) => (
              <div key={p.userId} className="row" style={{ gap: 12, alignItems: 'center', padding: 8 }}>
                <AvatarDisplay avatar={p.avatar} username={p.username || '?'} size={44} />
                <div className="grow" style={{ textAlign: 'left' }}>
                  <strong style={{ fontSize: 17 }}>{p.username || 'okänd'}</strong>
                  {String(p.userId) === String(myId) && (
                    <span className="t-hand muted" style={{ fontSize: 13, marginLeft: 6 }}>(du)</span>
                  )}
                </div>
                <span className="pill" style={{ background: !p.connected ? 'var(--paper-edge)' : p.ready ? 'var(--leaf-soft)' : 'var(--mustard-soft)' }}>
                  {!p.connected ? '⏳ ej online' : p.ready ? '✓ redo' : 'inte redo'}
                </span>
              </div>
            ))}
          </div>
        </div>
        {opponentLeft && (
          <p className="error" style={{ marginBottom: 16 }}>Motståndaren har lämnat lobbyn.</p>
        )}
        <button
          className="btn btn-primary btn-lg"
          onClick={sendReady}
          disabled={iAmReady}
        >
          {iAmReady ? 'Väntar på motståndaren…' : 'Jag är redo!'}
        </button>
        <p className="t-hand muted" style={{ fontSize: 13, marginTop: 12 }}>
          När båda är redo räknar Glo ner och spelet börjar.
        </p>
      </div>
    );
  }

  if (phase === 'starting') {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <GloAvatar size={140} float mood="wink" />
        <h2 style={{ marginTop: 18 }}>Glo räknar ner…</h2>
      </div>
    );
  }

  // Round
  if (phase === 'round' && round) {
    const me = scores.find((s) => String(s.userId) === String(myId));
    const opp = scores.find((s) => String(s.userId) !== String(myId));
    return (
      <div style={{ marginTop: -28 }}>
        <div className="row between" style={{ padding: '14px 0', borderBottom: '2px solid var(--ink)', marginBottom: 28 }}>
          <Link to="/kompisar">
            <button className="btn btn-ghost btn-sm">× Lämna</button>
          </Link>
          <div className="row" style={{ gap: 16 }}>
            <span className="pill" style={{ background: 'var(--leaf-soft)' }}>du: {me?.score ?? 0}</span>
            <span className="pill" style={{ background: 'var(--coral-soft)' }}>motståndare: {opp?.score ?? 0}</span>
          </div>
          <span className="t-hand muted">{round.index + 1} / {round.total}</span>
        </div>

        <div style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
          <div className="card card-lg" style={{ padding: 36 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 80, lineHeight: 1 }}>
              {round.question.prompt}
            </div>
            {round.question.notes && (
              <div className="t-hand muted" style={{ fontSize: 16, marginTop: 6 }}>· {round.question.notes}</div>
            )}
          </div>

          {!feedback ? (
            <form onSubmit={sendAnswer} style={{ marginTop: 24 }}>
              <input
                className="inp inp-lg"
                value={answer}
                onChange={(e) => { setAnswer(e.target.value); setSubmitting(false); }}
                placeholder="skriv översättningen…"
                autoFocus
                required
                autoComplete="off"
                spellCheck={false}
              />
              <div className="row between" style={{ marginTop: 16 }}>
                <span className="t-hand muted" style={{ fontSize: 14 }}>
                  först rätt vinner poängen
                </span>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Skickat…' : 'Svara'}
                </button>
              </div>
            </form>
          ) : (
            <div
              className="card pop-in"
              style={{
                marginTop: 24,
                background: String(feedback.winnerId) === String(myId)
                  ? 'var(--leaf-soft)'
                  : feedback.winnerId
                    ? 'var(--berry-soft)'
                    : 'var(--paper-edge)'
              }}
            >
              <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                <GloAvatar
                  mood={String(feedback.winnerId) === String(myId) ? 'wink' : feedback.winnerId ? 'sad' : 'default'}
                  size={48}
                />
                <div className="grow">
                  <h3 style={{ margin: 0 }}>
                    {String(feedback.winnerId) === String(myId)
                      ? 'Du vann rundan!'
                      : feedback.winnerId
                        ? 'Motståndaren var snabbare.'
                        : 'Ingen hann svara rätt.'}
                  </h3>
                  <p className="t-hand muted" style={{ margin: '4px 0 0' }}>
                    Rätt svar: <strong>{feedback.expected}</strong>
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center', padding: 60 }}>
      <GloAvatar size={120} float />
      <p className="t-hand muted" style={{ marginTop: 16 }}>Räknar ihop resultatet…</p>
    </div>
  );
}
