import { useEffect, useState, useCallback } from 'react';
import QRCode from 'qrcode';
import { createListInvite, fetchListInvites, revokeListInvite } from '../api/listInvites';
import { useAuth } from '../contexts/AuthContext';

const TTL_OPTIONS = [
  { value: 1,  label: '24 timmar' },
  { value: 7,  label: '1 vecka', recommended: true },
  { value: 30, label: '30 dagar' }
];
const MAX_USES_OPTIONS = [
  { value: 10,  label: '10' },
  { value: 30,  label: '30', recommended: true },
  { value: 100, label: '100' },
  { value: 1000, label: 'Obegränsat' }
];

export default function QrShareModal({ listId, listTitle, onClose }) {
  const { apiFetch } = useAuth();
  const [ttlDays, setTtlDays] = useState(7);
  const [maxUses, setMaxUses] = useState(30);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [selectedCode, setSelectedCode] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchListInvites(apiFetch, listId);
      setInvites(list);
      // Visa senaste aktiva som default-QR
      const active = list.find((i) => !i.revoked && new Date(i.expiresAt) > new Date());
      if (active) setSelectedCode(active.code);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, listId]);

  useEffect(() => { load(); }, [load]);

  // Generera QR-bild för vald kod
  useEffect(() => {
    if (!selectedCode) { setQrDataUrl(null); return; }
    const url = `${window.location.origin}/j/${selectedCode}`;
    QRCode.toDataURL(url, { width: 320, margin: 1, color: { dark: '#1F1B16', light: '#FBF5E6' } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [selectedCode]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onCreate = async () => {
    setError('');
    setCreating(true);
    try {
      const invite = await createListInvite(apiFetch, listId, { ttlDays, maxUses });
      setInvites((cur) => [invite, ...cur]);
      setSelectedCode(invite.code);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const onRevoke = async (code) => {
    if (!confirm('Säker på att du vill avaktivera länken? Kompisar som ännu inte scannat tappar tillgång.')) return;
    try {
      await revokeListInvite(apiFetch, listId, code);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const selectedInvite = invites.find((i) => i.code === selectedCode);
  const fullUrl = selectedCode ? `${window.location.origin}/j/${selectedCode}` : '';

  const copyUrl = () => navigator.clipboard?.writeText(fullUrl).catch(() => {});

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>📱 Dela "{listTitle}" med kompisarna</h3>
          <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Stäng">×</button>
        </div>
        <div className="modal-body">
          {loading ? (
            <p className="t-hand muted">Laddar…</p>
          ) : (
            <>
              {!selectedCode && (
                <p className="t-hand muted" style={{ marginTop: 0 }}>
                  Skapa en länk så kan klasskompisar scanna QR-koden och få listan kopierad till sitt eget konto.
                </p>
              )}

              {qrDataUrl && selectedInvite && (
                <div className="card" style={{ background: 'var(--paper-deep)', textAlign: 'center', marginBottom: 14 }}>
                  <img src={qrDataUrl} alt="QR-kod" style={{ width: 240, height: 240, display: 'block', margin: '0 auto 10px' }} />
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, marginBottom: 4 }}>{fullUrl}</div>
                  <button className="btn btn-sm" onClick={copyUrl} style={{ marginBottom: 8 }}>📋 Kopiera länk</button>
                  <p className="t-hand muted" style={{ fontSize: 14, margin: 0 }}>
                    {selectedInvite.usedCount} av {selectedInvite.maxUses === 1000 ? '∞' : selectedInvite.maxUses} har använt
                    {' · '}
                    går ut {new Date(selectedInvite.expiresAt).toLocaleDateString('sv-SE')}
                  </p>
                </div>
              )}

              <details className="card" style={{ background: 'var(--bg-elev)', marginBottom: 14 }}>
                <summary style={{ fontWeight: 800, cursor: 'pointer' }}>+ Skapa ny länk</summary>
                <div className="stack" style={{ marginTop: 12 }}>
                  <div>
                    <div className="t-hand muted" style={{ fontSize: 14, marginBottom: 6 }}>Hur länge?</div>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {TTL_OPTIONS.map((o) => (
                        <button
                          key={o.value}
                          className={`btn btn-sm ${ttlDays === o.value ? 'btn-primary' : ''}`}
                          onClick={() => setTtlDays(o.value)}
                          type="button"
                        >
                          {o.label}{o.recommended ? ' ★' : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="t-hand muted" style={{ fontSize: 14, marginBottom: 6 }}>Max antal som får använda?</div>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {MAX_USES_OPTIONS.map((o) => (
                        <button
                          key={o.value}
                          className={`btn btn-sm ${maxUses === o.value ? 'btn-primary' : ''}`}
                          onClick={() => setMaxUses(o.value)}
                          type="button"
                        >
                          {o.label}{o.recommended ? ' ★' : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                  {error && <p className="error">{error}</p>}
                  <button className="btn btn-primary btn-block" onClick={onCreate} disabled={creating}>
                    {creating ? 'Skapar…' : 'Generera ny QR-länk'}
                  </button>
                </div>
              </details>

              {invites.length > 1 && (
                <div>
                  <div className="t-hand muted" style={{ fontSize: 14, marginBottom: 8 }}>Dina invite-länkar:</div>
                  <div className="stack" style={{ gap: 6 }}>
                    {invites.map((i) => {
                      const expired = new Date(i.expiresAt) < new Date();
                      const inactive = i.revoked || expired || i.usedCount >= i.maxUses;
                      return (
                        <div
                          key={i.code}
                          className="row between"
                          style={{
                            padding: '8px 10px',
                            border: '2px solid var(--ink)',
                            borderRadius: 8,
                            background: i.code === selectedCode ? 'var(--mustard-soft)' : 'var(--paper-deep)',
                            opacity: inactive ? 0.55 : 1,
                            cursor: inactive ? 'default' : 'pointer'
                          }}
                          onClick={() => !inactive && setSelectedCode(i.code)}
                        >
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>
                            {i.code} · {i.usedCount}/{i.maxUses === 1000 ? '∞' : i.maxUses}
                            {i.revoked && ' (avaktiverad)'}
                            {expired && !i.revoked && ' (utgången)'}
                          </span>
                          {!inactive && (
                            <button
                              className="btn btn-sm btn-ghost"
                              onClick={(e) => { e.stopPropagation(); onRevoke(i.code); }}
                              title="Avaktivera"
                            >
                              Stäng av
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
