import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchFriends } from '../api/friends';
import { fetchLists, fetchList } from '../api/lists';
import { createGoalChallenge } from '../api/duels';
import AvatarDisplay from './AvatarDisplay';
import GloAvatar from './GloAvatar';

const MAX_GLOSOR = 20;

// "Klarar du den här?" — A handplockar upp till 20 glosor från sina egna
// listor, sätter ett mål (X / N rätt) och skickar till kompis(ar). Sparas
// som en Duel med kind='goal' så vi återanvänder play/result-flödet.
export default function GoalChallengeDialog({ onClose }) {
  const { apiFetch } = useAuth();
  const navigate = useNavigate();

  const [friends, setFriends] = useState([]);
  const [lists, setLists] = useState([]);
  const [glosorByList, setGlosorByList] = useState({}); // listId → glosor[]
  const [openListIds, setOpenListIds] = useState(new Set()); // expanded accordions
  const [selectedGlosIds, setSelectedGlosIds] = useState([]); // order matters
  const [selectedFriends, setSelectedFriends] = useState(new Set());
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [fs, ls] = await Promise.all([
        fetchFriends(apiFetch),
        fetchLists(apiFetch)
      ]);
      setFriends(fs);
      // Bara egna listor — backend tillåter även delade men för MVP håller
      // vi UI:t enkelt.
      setLists(ls.owned || []);
    } catch (e) {
      setError(e.message);
    }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Default-mål = 80 % av antal valda, alltid minst 1, alltid ≤ antal valda.
  useEffect(() => {
    const n = selectedGlosIds.length;
    if (n === 0) {
      setGoal(1);
    } else {
      const suggested = Math.max(1, Math.ceil(n * 0.8));
      setGoal((cur) => Math.min(suggested, n));
    }
  }, [selectedGlosIds.length]);

  const toggleList = async (listId) => {
    setOpenListIds((cur) => {
      const next = new Set(cur);
      if (next.has(listId)) next.delete(listId); else next.add(listId);
      return next;
    });
    if (!glosorByList[listId]) {
      try {
        const data = await fetchList(apiFetch, listId);
        setGlosorByList((cur) => ({ ...cur, [listId]: data.glosor || [] }));
      } catch (e) {
        setError(e.message);
      }
    }
  };

  const toggleGlos = (id) => {
    setSelectedGlosIds((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= MAX_GLOSOR) return cur;
      return [...cur, id];
    });
  };

  const toggleFriend = (id) => {
    setSelectedFriends((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedSet = useMemo(() => new Set(selectedGlosIds), [selectedGlosIds]);

  const onSend = async () => {
    if (selectedGlosIds.length === 0 || selectedFriends.size === 0) return;
    setBusy(true);
    setError('');
    try {
      const duel = await createGoalChallenge(apiFetch, {
        glosIds: selectedGlosIds,
        opponentIds: Array.from(selectedFriends),
        goal,
        title: title.trim()
      });
      navigate(`/duels/${duel._id}/play`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal" style={{ maxWidth: 620, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="row" style={{ gap: 12 }}>
            <GloAvatar size={40} mood="wink" tilt={-6} />
            <h3 style={{ margin: 0 }}>Klarar du den här?</h3>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose} disabled={busy} aria-label="Stäng">×</button>
        </div>

        <div className="modal-body stack" style={{ gap: 14, overflow: 'auto', flex: 1 }}>
          {error && <p className="error">{error}</p>}

          <label className="field">
            <span className="field-label">Rubrik (valfri)</span>
            <input
              className="inp"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              placeholder="t.ex. V20-läxan"
            />
          </label>

          <div>
            <p className="t-hand muted" style={{ fontSize: 14, margin: '0 0 8px' }}>
              Välj upp till {MAX_GLOSOR} glosor ({selectedGlosIds.length} valda):
            </p>
            {lists.length === 0 ? (
              <p className="t-hand muted">Du har inga egna listor — skapa en först.</p>
            ) : (
              <div className="stack" style={{ gap: 6 }}>
                {lists.map((l) => {
                  const open = openListIds.has(l._id);
                  const glosor = glosorByList[l._id] || [];
                  const pickedInList = glosor.filter((g) => selectedSet.has(g._id)).length;
                  return (
                    <div key={l._id} style={{ border: '1.5px solid var(--ink)', borderRadius: 10, overflow: 'hidden' }}>
                      <button
                        type="button"
                        className="row"
                        onClick={() => toggleList(l._id)}
                        style={{
                          width: '100%',
                          background: 'var(--paper-edge)',
                          padding: '8px 12px',
                          gap: 8,
                          border: 'none',
                          cursor: 'pointer',
                          font: 'inherit',
                          textAlign: 'left'
                        }}
                      >
                        <span style={{ width: 16, fontWeight: 800 }}>{open ? '▾' : '▸'}</span>
                        <strong className="grow" style={{ fontSize: 15 }}>{l.title}</strong>
                        {pickedInList > 0 && (
                          <span className="pill" style={{ background: 'var(--coral-soft)', fontSize: 12 }}>
                            {pickedInList} valda
                          </span>
                        )}
                      </button>
                      {open && (
                        <div className="stack" style={{ gap: 2, padding: 8, background: 'var(--bg-elev)' }}>
                          {glosor.length === 0 ? (
                            <p className="t-hand muted" style={{ fontSize: 13, margin: 0 }}>Hämtar…</p>
                          ) : (
                            glosor.map((g) => {
                              const sel = selectedSet.has(g._id);
                              const max = !sel && selectedGlosIds.length >= MAX_GLOSOR;
                              return (
                                <label
                                  key={g._id}
                                  className="row"
                                  style={{
                                    gap: 8,
                                    padding: '4px 8px',
                                    borderRadius: 6,
                                    background: sel ? 'var(--coral-soft)' : 'transparent',
                                    cursor: max ? 'not-allowed' : 'pointer',
                                    opacity: max ? 0.45 : 1
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={sel}
                                    disabled={max}
                                    onChange={() => toggleGlos(g._id)}
                                  />
                                  <span style={{ fontWeight: 700 }}>{g.source}</span>
                                  <span className="t-hand muted" style={{ fontSize: 13 }}>→</span>
                                  <span>{g.target}</span>
                                </label>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {selectedGlosIds.length > 0 && (
            <label className="field">
              <span className="field-label">
                Mål: minst <strong>{goal}</strong> av {selectedGlosIds.length} rätt
              </span>
              <input
                type="range"
                min={1}
                max={selectedGlosIds.length}
                value={goal}
                onChange={(e) => setGoal(Math.min(selectedGlosIds.length, Number(e.target.value) || 1))}
                style={{ width: '100%' }}
              />
            </label>
          )}

          <div>
            <p className="t-hand muted" style={{ fontSize: 14, margin: '0 0 8px' }}>
              Skicka till ({selectedFriends.size} valda):
            </p>
            {friends.length === 0 ? (
              <p className="t-hand muted">Du har inga kompisar än.</p>
            ) : (
              <div className="stack" style={{ gap: 6 }}>
                {friends.map((f) => {
                  const sel = selectedFriends.has(f._id);
                  return (
                    <label
                      key={f._id}
                      className="row"
                      style={{
                        gap: 10,
                        padding: 8,
                        border: '1.5px solid var(--ink)',
                        borderRadius: 10,
                        background: sel ? 'var(--leaf-soft)' : 'var(--bg-elev)',
                        cursor: 'pointer'
                      }}
                    >
                      <input type="checkbox" checked={sel} onChange={() => toggleFriend(f._id)} style={{ width: 18, height: 18 }} />
                      <AvatarDisplay avatar={f.avatar} username={f.username} size={32} />
                      <span className="grow" style={{ fontWeight: 700 }}>{f.username}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="row between" style={{ padding: 16, borderTop: '1.5px dashed var(--paper-edge)' }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Avbryt</button>
          <button
            className="btn btn-primary"
            onClick={onSend}
            disabled={busy || selectedGlosIds.length === 0 || selectedFriends.size === 0}
          >
            {busy ? 'Skickar…' : `Skicka utmaning (${selectedGlosIds.length} ord)`}
          </button>
        </div>
      </div>
    </div>
  );
}
