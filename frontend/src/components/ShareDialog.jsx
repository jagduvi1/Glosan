import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchFriends } from '../api/friends';
import { fetchListShares, shareList, unshareList } from '../api/lists';
import AvatarDisplay from './AvatarDisplay';
import GloAvatar from './GloAvatar';

// Modal för att dela en lista med kompisar. Visar alla kompisar; redan delade
// kan tas bort, övriga kan markeras för att dela med. Vi accepterar bara att
// dela med konfirmerade kompisar (backend dubbelkollar).
export default function ShareDialog({ listId, listTitle, onClose, onChanged }) {
  const { apiFetch } = useAuth();
  const [friends, setFriends] = useState([]);
  const [shareIds, setShareIds] = useState(new Set()); // user-IDs som har access nu
  const [selectIds, setSelectIds] = useState(new Set()); // user-IDs valda för ny delning
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [fs, shares] = await Promise.all([
        fetchFriends(apiFetch),
        fetchListShares(apiFetch, listId)
      ]);
      setFriends(fs);
      setShareIds(new Set(shares.map((s) => s._id)));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, listId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggleSelect = (id) => {
    setSelectIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const onShare = async () => {
    if (selectIds.size === 0) return;
    setBusy(true);
    setError('');
    try {
      await shareList(apiFetch, listId, Array.from(selectIds));
      await load();
      setSelectIds(new Set());
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (userId) => {
    setBusy(true);
    setError('');
    try {
      await unshareList(apiFetch, listId, userId);
      setShareIds((cur) => {
        const next = new Set(cur);
        next.delete(userId);
        return next;
      });
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const availableToShare = friends.filter((f) => !shareIds.has(f._id));
  const currentShares = friends.filter((f) => shareIds.has(f._id));

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="row" style={{ gap: 12 }}>
            <GloAvatar size={40} mood="wink" tilt={-6} />
            <h3 style={{ margin: 0 }}>Dela <span className="muted">{listTitle}</span></h3>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose} disabled={busy} aria-label="Stäng">×</button>
        </div>

        <div className="modal-body stack" style={{ gap: 16 }}>
          {error && <p className="error">{error}</p>}

          {loading ? (
            <p className="t-hand muted">Glo hämtar dina kompisar…</p>
          ) : friends.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 16 }}>
              <p className="t-hand muted">Inga kompisar än. Lägg till någon på kompis-sidan först.</p>
            </div>
          ) : (
            <>
              {currentShares.length > 0 && (
                <div>
                  <p className="t-hand muted" style={{ fontSize: 14, margin: '0 0 8px' }}>
                    Listan delas redan med:
                  </p>
                  <div className="stack" style={{ gap: 6 }}>
                    {currentShares.map((f) => (
                      <div
                        key={f._id}
                        className="row"
                        style={{
                          gap: 10,
                          padding: 8,
                          border: '1.5px solid var(--ink)',
                          borderRadius: 10,
                          background: 'var(--plum-soft)'
                        }}
                      >
                        <AvatarDisplay avatar={f.avatar} username={f.username} size={32} />
                        <span className="grow" style={{ fontWeight: 700 }}>{f.username}</span>
                        <button
                          className="btn btn-sm btn-ghost"
                          style={{ color: 'var(--berry-deep)' }}
                          onClick={() => onRemove(f._id)}
                          disabled={busy}
                        >
                          Ta bort
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {availableToShare.length > 0 && (
                <div>
                  <p className="t-hand muted" style={{ fontSize: 14, margin: '0 0 8px' }}>
                    Välj kompisar att dela med:
                  </p>
                  <div className="stack" style={{ gap: 6 }}>
                    {availableToShare.map((f) => {
                      const selected = selectIds.has(f._id);
                      return (
                        <label
                          key={f._id}
                          className="row"
                          style={{
                            gap: 10,
                            padding: 8,
                            border: '1.5px solid var(--ink)',
                            borderRadius: 10,
                            background: selected ? 'var(--leaf-soft)' : 'var(--bg-elev)',
                            cursor: 'pointer'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleSelect(f._id)}
                            style={{ width: 18, height: 18 }}
                          />
                          <AvatarDisplay avatar={f.avatar} username={f.username} size={32} />
                          <span className="grow" style={{ fontWeight: 700 }}>{f.username}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {availableToShare.length === 0 && currentShares.length > 0 && (
                <p className="t-hand muted" style={{ fontSize: 14 }}>
                  Alla dina kompisar har redan tillgång.
                </p>
              )}
            </>
          )}
        </div>

        <div className="row between" style={{ padding: 16, borderTop: '1.5px dashed var(--paper-edge)' }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Stäng</button>
          {availableToShare.length > 0 && (
            <button
              className="btn btn-primary"
              onClick={onShare}
              disabled={busy || selectIds.size === 0}
            >
              {busy ? 'Delar…' : `Dela med ${selectIds.size || ''}`.trim()}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
