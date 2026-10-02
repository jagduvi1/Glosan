import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchFriends } from '../api/friends';
import { fetchListShares, shareList, unshareList, setShareMode } from '../api/lists';
import { useModalFocus } from '../utils/modalFocus';
import AvatarDisplay from './AvatarDisplay';
import GloAvatar from './GloAvatar';

// Modal för att dela en lista med kompisar. Visar vilka som har listan (som
// kan tas bort) och kompisar att dela med. Vi accepterar bara att dela med
// konfirmerade kompisar (backend dubbelkollar).
//
// Alla som har listan kan dela den vidare. Ägaren ser alla som har den ("via
// …" när någon annan delade) och styr läget (read/edit) — om mottagarna bara
// får titta + öva eller också lägga till och redigera glosor. Edit gäller bara
// dem ägaren själv delat med. Den som delar vidare ser och tar bort dem hen
// själv lagt till.
export default function ShareDialog({ listId, listTitle, initialMode = 'read', isOwner = true, onClose, onChanged }) {
  const { apiFetch } = useAuth();
  const ref = useModalFocus(onClose);
  const [friends, setFriends] = useState([]);
  const [shares, setShares] = useState([]); // de jag ser: alla (ägaren) eller de jag själv lagt till
  const [selectIds, setSelectIds] = useState(new Set()); // user-IDs valda för ny delning
  const [mode, setMode] = useState(initialMode);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [fs, data] = await Promise.all([
        fetchFriends(apiFetch),
        fetchListShares(apiFetch, listId)
      ]);
      setFriends(fs);
      setShares(data.shares || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, listId]);

  useEffect(() => { load(); }, [load]);
  // Escape + focus-trap hanteras av useModalFocus-hooken ovan.

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
      // Läget skickas bara av ägaren — den som delar vidare ger alltid läsrätt.
      // Hoppades någon över (hade redan listan, eller kan inte få den) säger vi
      // inget om det — en blockering mellan ägaren och kompisen får inte märkas.
      await shareList(apiFetch, listId, Array.from(selectIds), isOwner ? mode : undefined);
      await load();
      setSelectIds(new Set());
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onChangeMode = async (newMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    // Om det redan finns mottagare ska serverns shareMode uppdateras direkt
    // — annars triggar nästa share-anrop bytet ändå.
    if (shares.length > 0) {
      try {
        await setShareMode(apiFetch, listId, newMode);
        onChanged?.();
      } catch (e) {
        setError(e.message);
        setMode(mode); // rulla tillbaka
      }
    }
  };

  const onRemove = async (userId) => {
    setBusy(true);
    setError('');
    try {
      const r = await unshareList(apiFetch, listId, userId);
      setShares(r.shares || shares.filter((s) => s._id !== userId));
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Den som delar vidare ser bara dem hen själv lagt till — vilka andra som har
  // listan (eller inte kan få den) syns aldrig, så alla andra kompisar erbjuds.
  const have = new Set(shares.map((s) => s._id));
  const availableToShare = friends.filter((f) => !have.has(f._id));

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div
        ref={ref}
        className="modal"
        style={{ maxWidth: 520 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          <div className="row" style={{ gap: 12 }}>
            <GloAvatar size={40} mood="wink" tilt={-6} />
            <h3 style={{ margin: 0 }}>Dela <span className="muted">{listTitle}</span></h3>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose} disabled={busy} aria-label="Stäng">×</button>
        </div>

        <div className="modal-body stack" style={{ gap: 16 }}>
          {error && <p className="error">{error}</p>}

          {isOwner ? (
            <div className="card" style={{ padding: 12, background: 'var(--paper-edge)' }}>
              <p className="t-hand muted" style={{ fontSize: 14, margin: '0 0 8px' }}>
                Vad får kompisarna göra?
              </p>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {[
                  { id: 'read', label: 'Bara titta + öva', desc: 'Mottagare kan se listan och köra quiz men inte ändra glosor.' },
                  { id: 'edit', label: 'Får också lägga till', desc: 'De du delar med kan lägga till + redigera glosor. Du äger fortfarande listan och rekordet.' }
                ].map((opt) => (
                  <label
                    key={opt.id}
                    style={{
                      flex: 1,
                      minWidth: 180,
                      padding: 10,
                      border: '2px solid var(--ink)',
                      borderRadius: 10,
                      background: mode === opt.id ? 'var(--leaf-soft)' : 'var(--bg-elev)',
                      cursor: 'pointer'
                    }}
                  >
                    <div className="row" style={{ gap: 6, alignItems: 'center', marginBottom: 4 }}>
                      <input
                        type="radio"
                        name="shareMode"
                        checked={mode === opt.id}
                        onChange={() => onChangeMode(opt.id)}
                        disabled={busy}
                      />
                      <strong style={{ fontSize: 14 }}>{opt.label}</strong>
                    </div>
                    <p className="t-hand muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.3 }}>
                      {opt.desc}
                    </p>
                  </label>
                ))}
              </div>
              <p className="t-hand muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
                Alla som har listan kan dela den vidare — de får bara titta + öva.
              </p>
            </div>
          ) : (
            <p className="t-hand muted" style={{ fontSize: 14, margin: 0 }}>
              De du delar med kan titta och öva på listan. Bara den som äger listan kan ändra den.
            </p>
          )}

          {shares.length > 0 && (
            <div>
              <p className="t-hand muted" style={{ fontSize: 14, margin: '0 0 8px' }}>
                {isOwner ? 'Listan delas redan med:' : 'Du har delat listan med:'}
              </p>
              <div className="stack" style={{ gap: 6 }}>
                {shares.map((s) => (
                  <div
                    key={s._id}
                    className="row"
                    style={{
                      gap: 10,
                      padding: 8,
                      border: '1.5px solid var(--ink)',
                      borderRadius: 10,
                      background: 'var(--plum-soft)'
                    }}
                  >
                    <AvatarDisplay avatar={s.avatar} username={s.username} size={32} />
                    <span className="grow" style={{ fontWeight: 700, minWidth: 0 }}>
                      {s.username}
                      {s.via && <span className="t-hand muted" style={{ fontWeight: 400, fontSize: 13 }}> · via {s.via}</span>}
                    </span>
                    <button
                      className="btn btn-sm btn-ghost"
                      style={{ color: 'var(--berry-deep)' }}
                      onClick={() => onRemove(s._id)}
                      disabled={busy}
                    >
                      Ta bort
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loading ? (
            <p className="t-hand muted">Glo hämtar dina kompisar…</p>
          ) : friends.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 16 }}>
              <p className="t-hand muted">Inga kompisar än. Lägg till någon på kompis-sidan först.</p>
            </div>
          ) : availableToShare.length > 0 ? (
            <div>
              <p className="t-hand muted" style={{ fontSize: 14, margin: '0 0 8px' }}>
                Välj kompisar att dela med:
              </p>
              {!isOwner && (
                <p className="t-hand muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
                  Har en kompis redan listan händer inget när du delar den med hen.
                </p>
              )}
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
          ) : (
            <p className="t-hand muted" style={{ fontSize: 14 }}>
              Alla dina kompisar har redan tillgång.
            </p>
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
