import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchFriends } from '../api/friends';
import { createDuel } from '../api/duels';
import AvatarDisplay from './AvatarDisplay';
import GloAvatar from './GloAvatar';

// Modal för att starta en async-duell på en given lista. Användaren väljer
// en eller flera kompisar; backend lottar frågorna och sparar dem på Duel-
// dokumentet så alla deltagare ser exakt samma frågor i samma ordning.
export default function ChallengeDialog({ listId, listTitle, onClose }) {
  const { apiFetch } = useAuth();
  const navigate = useNavigate();
  const [friends, setFriends] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [questionCount, setQuestionCount] = useState(5);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setFriends(await fetchFriends(apiFetch));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (id) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const onSend = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    setError('');
    try {
      const duel = await createDuel(apiFetch, {
        listId,
        opponentIds: Array.from(selected),
        questionCount
      });
      // Skickaren spelar direkt — det är hela poängen med utmaningen.
      navigate(`/duels/${duel._id}/play`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="row" style={{ gap: 12 }}>
            <GloAvatar size={40} mood="wink" tilt={-6} />
            <h3 style={{ margin: 0 }}>Utmana på <span className="muted">{listTitle}</span></h3>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose} disabled={busy} aria-label="Stäng">×</button>
        </div>

        <div className="modal-body stack" style={{ gap: 14 }}>
          {error && <p className="error">{error}</p>}

          <label className="field">
            <span className="field-label">Antal frågor</span>
            <input
              type="number"
              className="inp"
              min={1}
              max={20}
              value={questionCount}
              onChange={(e) => setQuestionCount(Math.max(1, Math.min(20, Number(e.target.value) || 5)))}
              style={{ maxWidth: 120 }}
            />
          </label>

          {loading ? (
            <p className="t-hand muted">Glo hämtar dina kompisar…</p>
          ) : friends.length === 0 ? (
            <p className="t-hand muted">Du har inga kompisar än — lägg till någon på kompis-sidan först.</p>
          ) : (
            <div>
              <p className="t-hand muted" style={{ fontSize: 14, margin: '0 0 8px' }}>
                Välj vem (eller vilka) du vill utmana:
              </p>
              <div className="stack" style={{ gap: 6 }}>
                {friends.map((f) => {
                  const sel = selected.has(f._id);
                  return (
                    <label
                      key={f._id}
                      className="row"
                      style={{
                        gap: 10,
                        padding: 8,
                        border: '1.5px solid var(--ink)',
                        borderRadius: 10,
                        background: sel ? 'var(--coral-soft)' : 'var(--bg-elev)',
                        cursor: 'pointer'
                      }}
                    >
                      <input type="checkbox" checked={sel} onChange={() => toggle(f._id)} style={{ width: 18, height: 18 }} />
                      <AvatarDisplay avatar={f.avatar} username={f.username} size={32} />
                      <span className="grow" style={{ fontWeight: 700 }}>{f.username}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="row between" style={{ padding: 16, borderTop: '1.5px dashed var(--paper-edge)' }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Avbryt</button>
          <button
            className="btn btn-primary"
            onClick={onSend}
            disabled={busy || selected.size === 0}
          >
            {busy ? 'Skickar…' : `Utmana ${selected.size || ''}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}
