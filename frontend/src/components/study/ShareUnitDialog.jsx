import { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import { useAuth } from '../../contexts/AuthContext';
import { fetchFriends } from '../../api/friends';
import {
  fetchUnitShares, shareUnitWithFriends, removeUnitRecipient, createUnitShareLink, revokeUnitShareLink
} from '../../api/study';
import { useModalFocus } from '../../utils/modalFocus';
import AvatarDisplay from '../AvatarDisplay';

// Dela ett område i Plugga — med kompisar (de ser det direkt) eller med en
// länk/QR-kod till klasskompisar (de får området, men blir inte kompisar med dig).
// Ingen får en kopia: alla övar med sin egen statistik, och bara du (och din
// AI) kan ändra innehållet — rättar du något når det alla.

const TTL = [
  { value: 1, label: '1 dag' },
  { value: 7, label: '1 vecka', rec: true },
  { value: 30, label: '30 dagar' }
];
const USES = [
  { value: 10, label: '10' },
  { value: 30, label: '30', rec: true },
  { value: 100, label: '100' }
];

const isActive = (l) => !l.revoked && new Date(l.expiresAt) > new Date() && l.usedCount < l.maxUses;
const inviteUrl = (code) => `${window.location.origin}/p/${code}`;

function FriendsTab({ friends, recipients, busy, onShare, onRemove }) {
  const [selected, setSelected] = useState(() => new Set());
  const have = new Set(recipients.map((r) => r._id));
  const available = friends.filter((f) => !have.has(f._id));
  const toggle = (id) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="stack" style={{ gap: 14 }}>
      {recipients.length > 0 && (
        <div>
          <p className="t-hand muted" style={{ fontSize: 14, margin: '0 0 8px' }}>Pluggar redan på området:</p>
          <div className="stack" style={{ gap: 6 }}>
            {recipients.map((r) => (
              <div key={r._id} className="row" style={{ gap: 10, padding: 8, border: '1.5px solid var(--ink)', borderRadius: 10, background: 'var(--plum-soft)' }}>
                <AvatarDisplay avatar={r.avatar} username={r.username} size={32} />
                <span className="grow" style={{ fontWeight: 700 }}>{r.username}</span>
                <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--berry-deep)' }} disabled={busy} onClick={() => onRemove(r._id)}>
                  Ta bort
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {friends.length === 0 ? (
        <p className="t-hand muted" style={{ margin: 0 }}>
          Du har inga kompisar i Glosan än. Lägg till dem på kompis-sidan — eller använd en QR-kod.
        </p>
      ) : available.length === 0 ? (
        <p className="t-hand muted" style={{ margin: 0 }}>Alla dina kompisar har redan området.</p>
      ) : (
        <div>
          <p className="t-hand muted" style={{ fontSize: 14, margin: '0 0 8px' }}>Välj kompisar:</p>
          <div className="stack" style={{ gap: 6 }}>
            {available.map((f) => (
              <label
                key={f._id}
                className="row"
                style={{ gap: 10, padding: 8, border: '1.5px solid var(--ink)', borderRadius: 10, cursor: 'pointer', background: selected.has(f._id) ? 'var(--leaf-soft)' : 'var(--bg-elev)' }}
              >
                <input type="checkbox" checked={selected.has(f._id)} onChange={() => toggle(f._id)} style={{ width: 18, height: 18 }} />
                <AvatarDisplay avatar={f.avatar} username={f.username} size={32} />
                <span className="grow" style={{ fontWeight: 700 }}>{f.username}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-primary btn-block"
            style={{ marginTop: 12 }}
            disabled={busy || selected.size === 0}
            onClick={async () => { if (await onShare([...selected])) setSelected(new Set()); }}
          >
            {busy ? 'Delar…' : selected.size ? `Dela med ${selected.size}` : 'Dela'}
          </button>
        </div>
      )}
    </div>
  );
}

function LinkTab({ links, busy, onCreate, onRevoke }) {
  const [ttlDays, setTtlDays] = useState(7);
  const [maxUses, setMaxUses] = useState(30);
  const [shownCode, setShownCode] = useState(null);
  const [qr, setQr] = useState(null);
  const [copied, setCopied] = useState(false);

  const active = links.filter(isActive);
  const shown = active.find((l) => l.code === shownCode) || active[0] || null;
  const qrCode = shown?.code || null;

  useEffect(() => {
    if (!qrCode) { setQr(null); return undefined; }
    let alive = true;
    QRCode.toDataURL(inviteUrl(qrCode), { width: 320, margin: 1, color: { dark: '#1F1B16', light: '#FBF5E6' } })
      .then((url) => { if (alive) setQr(url); })
      .catch(() => { if (alive) setQr(null); });
    return () => { alive = false; };
  }, [qrCode]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl(shown.code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ingen urklippsåtkomst — länken syns ändå */ }
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      {shown ? (
        <div className="card" style={{ background: 'var(--paper-deep)', textAlign: 'center' }}>
          {qr && <img src={qr} alt="QR-kod till området" style={{ width: 220, height: 220, display: 'block', margin: '0 auto 10px' }} />}
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, marginBottom: 6, overflowWrap: 'anywhere' }}>{inviteUrl(shown.code)}</div>
          <button type="button" className="btn btn-sm" onClick={copy} style={{ marginBottom: 8 }}>{copied ? '✓ Kopierad' : '📋 Kopiera länk'}</button>
          <p className="t-hand muted" style={{ fontSize: 14, margin: 0 }}>
            {shown.usedCount} av {shown.maxUses} har gått med · går ut {new Date(shown.expiresAt).toLocaleDateString('sv-SE')}
          </p>
          <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: 6 }} disabled={busy} onClick={() => onRevoke(shown.code)}>
            Stäng av länken
          </button>
        </div>
      ) : (
        <p className="t-hand muted" style={{ margin: 0 }}>
          Skapa en QR-kod som klasskompisar kan scanna. De loggar in (eller skapar ett konto) och får området i sin Plugga — ingen AI behövs.
        </p>
      )}

      {active.length > 1 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {active.map((l) => (
            <button key={l.code} type="button" className="chip" aria-pressed={shown?.code === l.code} onClick={() => setShownCode(l.code)}>
              {l.code} · {l.usedCount}/{l.maxUses}
            </button>
          ))}
        </div>
      )}

      <details className="card" style={{ background: 'var(--bg-elev)' }} open={!shown}>
        <summary style={{ fontWeight: 800, cursor: 'pointer' }}>+ Ny QR-kod</summary>
        <div className="stack" style={{ gap: 10, marginTop: 12 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }} role="group" aria-label="Hur länge">
            <span className="t-hand muted" style={{ fontSize: 14, minWidth: 90 }}>Hur länge?</span>
            {TTL.map((o) => (
              <button key={o.value} type="button" className="chip" aria-pressed={ttlDays === o.value} onClick={() => setTtlDays(o.value)}>
                {o.label}{o.rec ? ' ★' : ''}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }} role="group" aria-label="Hur många">
            <span className="t-hand muted" style={{ fontSize: 14, minWidth: 90 }}>Hur många?</span>
            {USES.map((o) => (
              <button key={o.value} type="button" className="chip" aria-pressed={maxUses === o.value} onClick={() => setMaxUses(o.value)}>
                {o.label}{o.rec ? ' ★' : ''}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={busy}
            onClick={async () => { const code = await onCreate({ ttlDays, maxUses }); if (code) setShownCode(code); }}
          >
            {busy ? 'Skapar…' : 'Skapa QR-kod'}
          </button>
        </div>
      </details>
    </div>
  );
}

export default function ShareUnitDialog({ unit, onClose, onChanged }) {
  const { apiFetch } = useAuth();
  const ref = useModalFocus(onClose);
  const [tab, setTab] = useState('friends');
  const [friends, setFriends] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [fs, shares] = await Promise.all([fetchFriends(apiFetch), fetchUnitShares(apiFetch, unit.id)]);
      setFriends(fs);
      setRecipients(shares.recipients);
      setLinks(shares.links);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, unit.id]);

  useEffect(() => { load(); }, [load]);

  // Kör en ändring med gemensam upptaget-/felhantering. Returnerar resultatet eller null.
  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      const r = await fn();
      onChanged?.();
      return r;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const onShare = (ids) => run(async () => {
    const r = await shareUnitWithFriends(apiFetch, unit.id, ids);
    setRecipients(r.recipients);
    return r;
  });
  const onRemove = (userId) => run(async () => {
    const r = await removeUnitRecipient(apiFetch, unit.id, userId);
    setRecipients(r.recipients);
    return r;
  });
  const onCreate = (opts) => run(async () => {
    const r = await createUnitShareLink(apiFetch, unit.id, opts);
    setLinks((cur) => [r.link, ...cur]);
    return r.link.code;
  });
  const onRevoke = (code) => run(async () => {
    const r = await revokeUnitShareLink(apiFetch, unit.id, code);
    setLinks(r.links);
    return r;
  });

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div ref={ref} className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="share-unit-title">
        <div className="modal-header">
          <h3 id="share-unit-title" style={{ margin: 0 }}>Dela <span className="muted">{unit.code} {unit.title}</span></h3>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} disabled={busy} aria-label="Stäng">×</button>
        </div>
        <div className="modal-body stack" style={{ gap: 14 }}>
          <p className="t-hand muted" style={{ margin: 0, fontSize: 15 }}>
            De du delar med övar med sin egen statistik — ingen AI behövs. Bara du kan ändra innehållet, så rättar din AI något når det alla.
          </p>
          <div className="study-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'friends'} className={`btn btn-sm ${tab === 'friends' ? 'btn-primary' : ''}`} onClick={() => setTab('friends')}>
              👥 Kompisar{recipients.length ? ` (${recipients.length})` : ''}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'link'} className={`btn btn-sm ${tab === 'link' ? 'btn-primary' : ''}`} onClick={() => setTab('link')}>
              📱 QR-kod / länk
            </button>
          </div>
          {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
          {loading ? (
            <p className="t-hand muted" style={{ margin: 0 }}>Glo hämtar dina kompisar…</p>
          ) : tab === 'friends' ? (
            <FriendsTab friends={friends} recipients={recipients} busy={busy} onShare={onShare} onRemove={onRemove} />
          ) : (
            <LinkTab links={links} busy={busy} onCreate={onCreate} onRevoke={onRevoke} />
          )}
        </div>
      </div>
    </div>
  );
}
