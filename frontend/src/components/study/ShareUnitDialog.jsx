import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { fetchFriends, blockUser } from '../../api/friends';
import {
  fetchUnitShares, shareUnitWithFriends, removeUnitRecipient, createUnitShareLink, revokeUnitShareLink
} from '../../api/study';
import { useModalFocus } from '../../utils/modalFocus';
import AvatarDisplay from '../AvatarDisplay';
import { LinkOptions, QrLinkCard, isActiveLink } from './shareBits';

// Dela ett område i Plugga — med kompisar eller med en länk/QR-kod till
// klasskompisar (de blir inte kompisar med dig). Alla får en EGEN KOPIA: de
// kan ta bort det de inte vill ha och ändra med sin egen AI. Delar du igen
// senare får de bara det nya (services/study/copies.js).
//
// De som fick området före kopiorna följer originalet: de syns här och kan tas
// bort (skaparen: alla; den som delat vidare: dem hen själv lagt till).

function FriendsTab({ friends, copies, recipients, isOwner, gaveMe, busy, onShare, onRemove, onBlock }) {
  const [selected, setSelected] = useState(() => new Set());
  const [confirmBlock, setConfirmBlock] = useState(null);
  // De som följer originalet har det redan, och den som gav dig kopian har sitt
  // eget. Den som fått en kopia av dig kan väljas igen — då får hen bara det
  // nya. Vilka andra som har området syns aldrig.
  const following = new Set(recipients.map((r) => r._id));
  const hasCopy = new Set(copies.map((c) => c._id));
  const available = friends.filter((f) => !following.has(f._id) && f.username !== gaveMe);
  const toggle = (id) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="stack" style={{ gap: 14 }}>
      {copies.length > 0 && (
        <p className="t-hand muted" style={{ fontSize: 14, margin: 0 }}>
          Har fått en kopia av dig: {copies.map((c) => c.username).join(', ')}
        </p>
      )}

      {recipients.length > 0 && (
        <div>
          <p className="t-hand muted" style={{ fontSize: 14, margin: '0 0 8px' }}>
            {isOwner ? 'Följer ditt original (från före kopiorna):' : 'Följer originalet — du delade med:'}
          </p>
          <div className="stack" style={{ gap: 6 }}>
            {recipients.map((r) => (
              <div key={r._id} className="row" style={{ gap: 10, padding: 8, border: '1.5px solid var(--ink)', borderRadius: 10, background: 'var(--plum-soft)' }}>
                <AvatarDisplay avatar={r.avatar} username={r.username} size={32} />
                <span className="grow" style={{ fontWeight: 700, minWidth: 0 }}>
                  {r.username}
                  {r.via && <span className="t-hand muted" style={{ fontWeight: 400, fontSize: 13 }}> · via {r.via}</span>}
                </span>
                {confirmBlock === r._id ? (
                  <>
                    <span className="t-hand" style={{ fontSize: 13 }}>Blockera? Allt ni delar tas bort.</span>
                    <button type="button" className="btn btn-sm" style={{ background: 'var(--berry-soft)', color: 'var(--berry-deep)' }} disabled={busy} onClick={async () => { setConfirmBlock(null); await onBlock(r._id); }}>
                      Blockera
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmBlock(null)}>Avbryt</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--berry-deep)' }} disabled={busy} onClick={() => onRemove(r._id)}>
                      Ta bort
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--berry-deep)' }} disabled={busy} onClick={() => setConfirmBlock(r._id)} title="Ta bort och stoppa allt från den här personen">
                      Blockera
                    </button>
                  </>
                )}
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
          <p className="t-hand muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
            Har en kompis redan en kopia får hen bara det nya.
          </p>
          <div className="stack" style={{ gap: 6 }}>
            {available.map((f) => (
              <label
                key={f._id}
                className="row"
                style={{ gap: 10, padding: 8, border: '1.5px solid var(--ink)', borderRadius: 10, cursor: 'pointer', background: selected.has(f._id) ? 'var(--leaf-soft)' : 'var(--bg-elev)' }}
              >
                <input type="checkbox" checked={selected.has(f._id)} onChange={() => toggle(f._id)} style={{ width: 18, height: 18 }} />
                <AvatarDisplay avatar={f.avatar} username={f.username} size={32} />
                <span className="grow" style={{ fontWeight: 700, minWidth: 0 }}>
                  {f.username}
                  {hasCopy.has(f._id) && <span className="t-hand muted" style={{ fontWeight: 400, fontSize: 13 }}> · har en kopia av dig</span>}
                </span>
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

  // Egna länkar visas som QR-kod; länkar andra gjort (bara skaparen ser dem,
  // med `via`) kan bara stängas av — de är inte ens egna att sprida.
  const active = links.filter((l) => isActiveLink(l) && !l.via);
  const others = links.filter((l) => isActiveLink(l) && l.via);
  const shown = active.find((l) => l.code === shownCode) || active[0] || null;

  return (
    <div className="stack" style={{ gap: 14 }}>
      {shown ? (
        <QrLinkCard link={shown} busy={busy} onRevoke={onRevoke} />
      ) : (
        <p className="t-hand muted" style={{ margin: 0 }}>
          Skapa en QR-kod som klasskompisar kan scanna. De loggar in (eller skapar ett konto) och får en egen kopia av området i sin Plugga — ingen AI behövs.
        </p>
      )}

      {others.length > 0 && (
        <div>
          <p className="t-hand muted" style={{ fontSize: 14, margin: '0 0 6px' }}>Länkar andra har gjort till området:</p>
          <div className="stack" style={{ gap: 6 }}>
            {others.map((l) => (
              <div key={l.id} className="row" style={{ gap: 8, padding: 8, border: '1.5px solid var(--ink)', borderRadius: 10, flexWrap: 'wrap' }}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <strong>via {l.via}</strong>
                  <span className="t-hand muted" style={{ fontSize: 13, display: 'block' }}>
                    {l.usedCount}/{l.maxUses} har gått med · går ut {new Date(l.expiresAt).toLocaleDateString('sv-SE')}
                  </span>
                </span>
                {/* Andras länkar har ingen kod här — de stängs med länkens id. */}
                <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--berry-deep)' }} disabled={busy} onClick={() => onRevoke(l.id)}>
                  Stäng av
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {active.length > 1 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {active.map((l) => (
            <button key={l.code} type="button" className="chip" aria-pressed={shown?.code === l.code} onClick={() => setShownCode(l.code)}>
              {l.title || l.code} · {l.usedCount}/{l.maxUses}{l.unitCount > 1 ? ` · ${l.unitCount} områden` : ''}
            </button>
          ))}
        </div>
      )}

      <details className="card" style={{ background: 'var(--bg-elev)' }} open={!shown}>
        <summary style={{ fontWeight: 800, cursor: 'pointer' }}>+ Ny QR-kod</summary>
        <div className="stack" style={{ gap: 10, marginTop: 12 }}>
          <LinkOptions ttlDays={ttlDays} maxUses={maxUses} onTtl={setTtlDays} onUses={setMaxUses} />
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
  const [copies, setCopies] = useState([]); // fått en kopia av mig
  const [recipients, setRecipients] = useState([]); // följer originalet (från före kopiorna)
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    try {
      const [fs, shares] = await Promise.all([fetchFriends(apiFetch), fetchUnitShares(apiFetch, unit.id)]);
      setFriends(fs);
      setCopies(shares.copies || []);
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
    setDone('');
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
    // Hoppades någon över (hade redan allt, eller kan inte få det) säger vi
    // inget om vem — en blockering mellan skaparen och kompisen får inte märkas.
    setCopies(r.copies || []);
    setRecipients(r.recipients);
    setDone('Klart! De har nu området i sin Plugga — som en egen kopia.');
    return r;
  });
  const onRemove = (userId) => run(async () => {
    const r = await removeUnitRecipient(apiFetch, unit.id, userId);
    setRecipients(r.recipients);
    return r;
  });
  const onBlock = (userId) => run(async () => {
    await blockUser(apiFetch, userId);
    setRecipients((cur) => cur.filter((x) => x._id !== userId));
    setFriends((cur) => cur.filter((x) => x._id !== userId));
    return true;
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
            De du delar med får en egen kopia — ingen AI behövs. Den är deras: de kan ta bort det de inte vill ha, och ändra med sin egen AI.
            Det du ändrar sedan når inte kopian, men delar du igen får de bara det nya.
          </p>
          <div className="study-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'friends'} className={`btn btn-sm ${tab === 'friends' ? 'btn-primary' : ''}`} onClick={() => setTab('friends')}>
              👥 Kompisar{copies.length + recipients.length ? ` (${copies.length + recipients.length})` : ''}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'link'} className={`btn btn-sm ${tab === 'link' ? 'btn-primary' : ''}`} onClick={() => setTab('link')}>
              📱 QR-kod / länk
            </button>
          </div>
          {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
          {done && <p className="t-hand" style={{ margin: 0, color: 'var(--leaf-deep, inherit)' }}>{done}</p>}
          {loading ? (
            <p className="t-hand muted" style={{ margin: 0 }}>Glo hämtar dina kompisar…</p>
          ) : tab === 'friends' ? (
            <FriendsTab
              friends={friends}
              copies={copies}
              recipients={recipients}
              isOwner={unit.isOwner}
              gaveMe={unit.isCopy ? unit.copiedFrom : null}
              busy={busy}
              onShare={onShare}
              onRemove={onRemove}
              onBlock={onBlock}
            />
          ) : (
            <LinkTab links={links} busy={busy} onCreate={onCreate} onRevoke={onRevoke} />
          )}
        </div>
      </div>
    </div>
  );
}
