import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchFriendCode, fetchFriends, addFriendByCode, removeFriend } from '../api/friends';
import AvatarDisplay from '../components/AvatarDisplay';
import GloAvatar from '../components/GloAvatar';
import ConfirmDialog from '../components/ConfirmDialog';

function formatCode(code) {
  if (!code) return '';
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export default function Friends() {
  const { apiFetch } = useAuth();
  const [code, setCode] = useState(null);
  const [friends, setFriends] = useState([]);
  const [addInput, setAddInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingRemove, setPendingRemove] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const [c, fs] = await Promise.all([
        fetchFriendCode(apiFetch),
        fetchFriends(apiFetch)
      ]);
      setCode(c);
      setFriends(fs);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const onAdd = async (e) => {
    e.preventDefault();
    const cleaned = addInput.trim().replace(/\s+/g, '').toUpperCase();
    if (!cleaned) return;
    setAddBusy(true);
    setError('');
    setNotice('');
    try {
      const friend = await addFriendByCode(apiFetch, cleaned);
      setNotice(`Klart — du och ${friend.username} är nu kompisar.`);
      setAddInput('');
      // Refresh list to capture the new entry (and dedupe if already added).
      setFriends(await fetchFriends(apiFetch));
    } catch (err) {
      setError(err.message);
    } finally {
      setAddBusy(false);
    }
  };

  const onRemoveConfirmed = async () => {
    if (!pendingRemove) return;
    const f = pendingRemove;
    setPendingRemove(null);
    try {
      await removeFriend(apiFetch, f._id);
      setFriends((cur) => cur.filter((x) => x._id !== f._id));
    } catch (err) {
      setError(err.message);
    }
  };

  const onCopy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Older browsers / non-https — fallback to selection isn't worth it.
      setError('Kunde inte kopiera. Markera koden manuellt och kopiera.');
    }
  };

  if (busy && !code && friends.length === 0) {
    return <p className="t-hand muted">Glo letar upp dina kompisar…</p>;
  }

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row between" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div className="t-hand muted" style={{ fontSize: 17 }}>Glo:s kompis-koder</div>
          <h1 style={{ fontSize: 40, margin: '4px 0 0' }}>
            Plugga <span className="mark-highlight">med kompisar</span>
          </h1>
        </div>
        <GloAvatar size={92} float tilt={-4} mood="wink" />
      </div>

      <div className="card card-lg" style={{ background: 'var(--mustard-soft)' }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="grow" style={{ minWidth: 200 }}>
            <p className="t-hand muted" style={{ fontSize: 16, margin: '0 0 6px' }}>
              Din personliga kod
            </p>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 42,
                fontWeight: 800,
                letterSpacing: '0.15em',
                lineHeight: 1
              }}
            >
              {formatCode(code) || '— — —'}
            </div>
            <p className="t-hand muted" style={{ fontSize: 14, margin: '8px 0 0' }}>
              Skicka den till en kompis så lägger ni till varandra.
            </p>
          </div>
          <button className="btn" onClick={onCopy} disabled={!code}>
            {copied ? 'Kopierad!' : 'Kopiera kod'}
          </button>
        </div>
      </div>

      <form onSubmit={onAdd} className="card stack">
        <label className="field">
          <span className="field-label">Lägg till en kompis med deras kod</span>
          <input
            className="inp"
            value={addInput}
            onChange={(e) => setAddInput(e.target.value.toUpperCase())}
            placeholder="t.ex. AB3 D7X"
            maxLength={10}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          {notice && <span className="t-hand" style={{ color: 'var(--leaf-deep)', fontSize: 15 }}>{notice}</span>}
          <button type="submit" className="btn btn-primary" disabled={addBusy || !addInput.trim()}>
            {addBusy ? 'Glo söker…' : 'Lägg till kompis'}
          </button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}

      <div>
        <div className="row between" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Dina kompisar</h2>
          <span className="t-hand muted" style={{ fontSize: 14 }}>
            {friends.length} {friends.length === 1 ? 'kompis' : 'kompisar'}
          </span>
        </div>
        {friends.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 32 }}>
            <p className="t-hand muted" style={{ fontSize: 16 }}>
              Inga kompisar än. Dela din kod ovan så händer det fort.
            </p>
          </div>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {friends.map((f) => (
              <div key={f._id} className="card row" style={{ padding: 14, gap: 14, alignItems: 'center' }}>
                <AvatarDisplay avatar={f.avatar} username={f.username} size={48} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0, fontSize: 20 }}>{f.username}</h3>
                  <p className="t-hand muted" style={{ fontSize: 14, margin: '2px 0 0' }}>
                    Kompisar sedan {new Date(f.addedAt).toLocaleDateString('sv-SE')}
                  </p>
                </div>
                <button
                  className="btn btn-sm btn-ghost"
                  style={{ color: 'var(--berry-deep)' }}
                  onClick={() => setPendingRemove(f)}
                >
                  Ta bort
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {pendingRemove && (
        <ConfirmDialog
          title="Ta bort kompisen?"
          message={`${pendingRemove.username} tas bort från din kompislista, och du från ${pendingRemove.username}s. Ni kan alltid lägga till varandra igen.`}
          confirmLabel="Ta bort"
          destructive
          onConfirm={onRemoveConfirmed}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </div>
  );
}
