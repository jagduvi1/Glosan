import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { fetchFriends } from '../../api/friends';
import {
  fetchStudyUnits, shareUnitsWithFriends, createStudyShareLink, fetchMyStudyShareLinks, revokeMyStudyShareLink
} from '../../api/study';
import { useModalFocus } from '../../utils/modalFocus';
import AvatarDisplay from '../AvatarDisplay';
import { LinkOptions, QrLinkCard } from './shareBits';

// Dela flera områden på en gång — från Plugga-sidorna (startsidan, ett ämne,
// en mapp). Välj vilka av DINA områden som ska med och dela dem med kompisar,
// eller med EN länk/QR-kod (t.ex. ett helt kapitel till klassen). Den som inte
// har något konto skapar ett via länken. Ingen får en kopia: alla övar med sin
// egen statistik, och bara du (och din AI) kan ändra innehållet.
//
// `units` = områdena på sidan (utelämnat → alla dina, alla terminer);
// `initialSelected` = förvalda id:n; `title` = rubriken; `linkTitle` =
// förslag på länkens namn (syns för alla med länken — därför inte en mapps
// privata namn).

const unitLabel = (u) => `${u.code} ${u.title}`;
// Samma tak som servern (services/study/sharing.js).
const SHARE_MAX = 100;
const LINK_MAX = 50;

function UnitPicker({ own, othersCount, selected, onToggle, onAll }) {
  const all = own.length > 0 && own.every((u) => selected.has(u.id));
  return (
    <div>
      <div className="row between" style={{ gap: 8, alignItems: 'baseline', marginBottom: 6 }}>
        <p className="t-hand muted" style={{ fontSize: 14, margin: 0 }}>Vad vill du dela? ({selected.size} av {own.length})</p>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onAll(!all)}>{all ? 'Avmarkera alla' : 'Välj alla'}</button>
      </div>
      <div className="stack" style={{ gap: 6, maxHeight: 240, overflowY: 'auto', paddingRight: 4 }}>
        {own.map((u) => (
          <label
            key={u.id}
            className="row"
            style={{ gap: 10, padding: 8, border: '1.5px solid var(--ink)', borderRadius: 10, cursor: 'pointer', background: selected.has(u.id) ? 'var(--leaf-soft)' : 'var(--bg-elev)' }}
          >
            <input type="checkbox" checked={selected.has(u.id)} onChange={() => onToggle(u.id)} style={{ width: 18, height: 18 }} />
            <span aria-hidden="true">{u.emoji}</span>
            <span className="grow" style={{ minWidth: 0 }}>
              <strong>{unitLabel(u)}</strong>
              <span className="t-hand muted" style={{ fontSize: 13, display: 'block' }}>{u.subjectLabel} · {u.termLabel}</span>
            </span>
          </label>
        ))}
      </div>
      {othersCount > 0 && (
        <p className="t-hand muted" style={{ fontSize: 13, margin: '6px 0 0' }}>
          {othersCount} {othersCount === 1 ? 'område här har' : 'områden här har'} någon annan skapat — bara skaparen kan dela {othersCount === 1 ? 'det' : 'dem'}.
        </p>
      )}
    </div>
  );
}

function FriendsTab({ friends, count, busy, onShare }) {
  const [picked, setPicked] = useState(() => new Set());
  const toggle = (id) => setPicked((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  if (friends.length === 0) {
    return (
      <p className="t-hand muted" style={{ margin: 0 }}>
        Du har inga kompisar i Glosan än. Lägg till dem på kompis-sidan — eller använd en QR-kod, den fungerar även för den som inte har konto.
      </p>
    );
  }
  return (
    <div>
      <p className="t-hand muted" style={{ fontSize: 14, margin: '0 0 8px' }}>Välj kompisar:</p>
      <div className="stack" style={{ gap: 6, maxHeight: 220, overflowY: 'auto', paddingRight: 4 }}>
        {friends.map((f) => (
          <label
            key={f._id}
            className="row"
            style={{ gap: 10, padding: 8, border: '1.5px solid var(--ink)', borderRadius: 10, cursor: 'pointer', background: picked.has(f._id) ? 'var(--leaf-soft)' : 'var(--bg-elev)' }}
          >
            <input type="checkbox" checked={picked.has(f._id)} onChange={() => toggle(f._id)} style={{ width: 18, height: 18 }} />
            <AvatarDisplay avatar={f.avatar} username={f.username} size={32} />
            <span className="grow" style={{ fontWeight: 700 }}>{f.username}</span>
          </label>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-primary btn-block"
        style={{ marginTop: 12 }}
        disabled={busy || picked.size === 0 || count === 0 || count > SHARE_MAX}
        onClick={async () => { if (await onShare([...picked])) setPicked(new Set()); }}
      >
        {busy ? 'Delar…' : `Dela ${count} ${count === 1 ? 'område' : 'områden'}${picked.size ? ` med ${picked.size} ${picked.size === 1 ? 'kompis' : 'kompisar'}` : ''}`}
      </button>
      {count > SHARE_MAX && <p className="t-hand muted" style={{ fontSize: 13, margin: '6px 0 0' }}>Du kan dela högst {SHARE_MAX} områden åt gången — välj färre.</p>}
    </div>
  );
}

function LinkTab({ count, defaultTitle, links, busy, onCreate, onRevoke }) {
  const [title, setTitle] = useState(defaultTitle || '');
  const [ttlDays, setTtlDays] = useState(7);
  const [maxUses, setMaxUses] = useState(30);
  const [shownCode, setShownCode] = useState(null);
  const shown = links.find((l) => l.code === shownCode) || null;

  return (
    <div className="stack" style={{ gap: 14 }}>
      {shown && <QrLinkCard link={shown} busy={busy} onRevoke={onRevoke} />}
      <div className="card stack" style={{ background: 'var(--bg-elev)', gap: 10 }}>
        <p className="t-hand muted" style={{ margin: 0, fontSize: 14 }}>
          EN QR-kod för allt du valt — scanna, logga in (eller skapa ett konto) och allt hamnar i deras Plugga. Ingen AI behövs.
        </p>
        <label className="field" style={{ margin: 0 }}>
          <span className="field-label">Namn på länken (valfritt)</span>
          <input className="inp" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="t.ex. Kapitel 4 — Procent" />
        </label>
        <LinkOptions ttlDays={ttlDays} maxUses={maxUses} onTtl={setTtlDays} onUses={setMaxUses} />
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={busy || count === 0 || count > LINK_MAX}
          onClick={async () => { const code = await onCreate({ ttlDays, maxUses, title: title.trim() }); if (code) setShownCode(code); }}
        >
          {busy ? 'Skapar…' : `Skapa QR-kod för ${count} ${count === 1 ? 'område' : 'områden'}`}
        </button>
        {count > LINK_MAX && <p className="t-hand muted" style={{ fontSize: 13, margin: 0 }}>En QR-kod kan gälla högst {LINK_MAX} områden — välj färre, eller gör en kod per kapitel.</p>}
      </div>
      {links.length > 0 && (
        <div>
          <p className="t-hand muted" style={{ fontSize: 14, margin: '0 0 6px' }}>Dina aktiva länkar:</p>
          <div className="stack" style={{ gap: 6 }}>
            {links.map((l) => (
              <div key={l.code} className="row" style={{ gap: 8, padding: 8, border: '1.5px solid var(--ink)', borderRadius: 10, flexWrap: 'wrap' }}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <strong>{l.title || l.units.map((u) => u.code).slice(0, 4).join(', ') + (l.units.length > 4 ? ` +${l.units.length - 4}` : '')}</strong>
                  <span className="t-hand muted" style={{ fontSize: 13, display: 'block' }}>
                    {l.unitCount} {l.unitCount === 1 ? 'område' : 'områden'} · {l.usedCount}/{l.maxUses} har gått med · går ut {new Date(l.expiresAt).toLocaleDateString('sv-SE')}
                  </span>
                </span>
                <button type="button" className="btn btn-sm" aria-pressed={shownCode === l.code} onClick={() => setShownCode(shownCode === l.code ? null : l.code)}>QR</button>
                <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--berry-deep)' }} disabled={busy} onClick={() => onRevoke(l.code)}>Stäng av</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ShareStudyDialog({ units: pageUnits, initialSelected = [], title = '', linkTitle = title, onClose, onChanged }) {
  const { apiFetch } = useAuth();
  const ref = useModalFocus(onClose);
  const [units, setUnits] = useState(pageUnits || null);
  const [selected, setSelected] = useState(() => new Set(initialSelected));
  const [tab, setTab] = useState('friends');
  const [friends, setFriends] = useState([]);
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    try {
      const [fs, ls, us] = await Promise.all([
        fetchFriends(apiFetch),
        fetchMyStudyShareLinks(apiFetch),
        pageUnits ? Promise.resolve(pageUnits) : fetchStudyUnits(apiFetch, { allTerms: true })
      ]);
      setFriends(fs);
      setLinks(ls);
      setUnits(us);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, pageUnits]);

  useEffect(() => { load(); }, [load]);

  const own = (units || []).filter((u) => u.isOwner);
  const othersCount = (units || []).length - own.length;
  const chosen = own.filter((u) => selected.has(u.id)).map((u) => u.id);

  const toggle = (id) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const setAll = (on) => setSelected(on ? new Set(own.map((u) => u.id)) : new Set());

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

  const onShare = (friendIds) => run(async () => {
    const r = await shareUnitsWithFriends(apiFetch, chosen, friendIds);
    setDone(r.added
      ? `Klart! ${r.friends} ${r.friends === 1 ? 'kompis har' : 'kompisar har'} nu ${r.units === 1 ? 'området' : `de ${r.units} områdena`} i sin Plugga.`
      : 'De hade redan allt du valde.');
    return r;
  });
  const onCreate = (opts) => run(async () => {
    const r = await createStudyShareLink(apiFetch, { unitIds: chosen, ...opts });
    setLinks(await fetchMyStudyShareLinks(apiFetch));
    return r.link.code;
  });
  const onRevoke = (code) => run(async () => {
    setLinks(await revokeMyStudyShareLink(apiFetch, code));
    return true;
  });

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div ref={ref} className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="share-study-title">
        <div className="modal-header">
          <h3 id="share-study-title" style={{ margin: 0 }}>👥 Dela{title ? <span className="muted"> {title}</span> : ''}</h3>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} disabled={busy} aria-label="Stäng">×</button>
        </div>
        <div className="modal-body stack" style={{ gap: 14 }}>
          {loading ? (
            <p className="t-hand muted" style={{ margin: 0 }}>Glo hämtar dina områden och kompisar…</p>
          ) : own.length === 0 ? (
            <p className="t-hand muted" style={{ margin: 0 }}>
              Du har inga egna områden här. Bara den som skapat ett område kan dela det — be din AI skapa ett, eller be kompisen som gjort det om en QR-kod.
            </p>
          ) : (
            <>
              <UnitPicker own={own} othersCount={othersCount} selected={selected} onToggle={toggle} onAll={setAll} />
              <div className="study-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={tab === 'friends'} className={`btn btn-sm ${tab === 'friends' ? 'btn-primary' : ''}`} onClick={() => setTab('friends')}>
                  👥 Kompisar
                </button>
                <button type="button" role="tab" aria-selected={tab === 'link'} className={`btn btn-sm ${tab === 'link' ? 'btn-primary' : ''}`} onClick={() => setTab('link')}>
                  📱 QR-kod / länk
                </button>
              </div>
              {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
              {done && <p className="t-hand" style={{ margin: 0, color: 'var(--leaf-deep, inherit)' }}>{done}</p>}
              {tab === 'friends' ? (
                <FriendsTab friends={friends} count={chosen.length} busy={busy} onShare={onShare} />
              ) : (
                <LinkTab count={chosen.length} defaultTitle={linkTitle} links={links} busy={busy} onCreate={onCreate} onRevoke={onRevoke} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
