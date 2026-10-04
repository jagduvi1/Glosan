import { useState, useEffect } from 'react';
import QRCode from 'qrcode';

// Delat mellan områdessidans Dela (ShareUnitDialog) och Plugga-sidornas Dela
// (ShareStudyDialog): länkens val och QR-kortet.

export const TTL = [
  { value: 1, label: '1 dag' },
  { value: 7, label: '1 vecka', rec: true },
  { value: 30, label: '30 dagar' }
];
export const USES = [
  { value: 10, label: '10' },
  { value: 30, label: '30', rec: true },
  { value: 100, label: '100' }
];

// Även en full länk visas: de som redan använt den hämtar det nya med den.
export const isActiveLink = (l) => !l.revoked && new Date(l.expiresAt) > new Date();
export const inviteUrl = (code) => `${window.location.origin}/p/${code}`;

/** Hur länge och hur många — valen för en ny länk. */
export function LinkOptions({ ttlDays, maxUses, onTtl, onUses }) {
  return (
    <>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }} role="group" aria-label="Hur länge">
        <span className="t-hand muted" style={{ fontSize: 14, minWidth: 90 }}>Hur länge?</span>
        {TTL.map((o) => (
          <button key={o.value} type="button" className="chip" aria-pressed={ttlDays === o.value} onClick={() => onTtl(o.value)}>
            {o.label}{o.rec ? ' ★' : ''}
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }} role="group" aria-label="Hur många">
        <span className="t-hand muted" style={{ fontSize: 14, minWidth: 90 }}>Hur många?</span>
        {USES.map((o) => (
          <button key={o.value} type="button" className="chip" aria-pressed={maxUses === o.value} onClick={() => onUses(o.value)}>
            {o.label}{o.rec ? ' ★' : ''}
          </button>
        ))}
      </div>
    </>
  );
}

/** En länk: QR-kod, adressen, kopiera — och "stäng av" om onRevoke finns. */
export function QrLinkCard({ link, busy = false, onRevoke }) {
  const [qr, setQr] = useState(null);
  const [copied, setCopied] = useState(false);
  const code = link.code;

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(inviteUrl(code), { width: 320, margin: 1, color: { dark: '#1F1B16', light: '#FBF5E6' } })
      .then((url) => { if (alive) setQr(url); })
      .catch(() => { if (alive) setQr(null); });
    return () => { alive = false; };
  }, [code]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ingen urklippsåtkomst — länken syns ändå */ }
  };

  return (
    <div className="card" style={{ background: 'var(--paper-deep)', textAlign: 'center' }}>
      {qr && <img src={qr} alt="QR-kod till det du delar" style={{ width: 220, height: 220, display: 'block', margin: '0 auto 10px' }} />}
      {link.title && <p style={{ fontWeight: 800, margin: '0 0 6px' }}>{link.title}</p>}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, marginBottom: 6, overflowWrap: 'anywhere' }}>{inviteUrl(code)}</div>
      <button type="button" className="btn btn-sm" onClick={copy} style={{ marginBottom: 8 }}>{copied ? '✓ Kopierad' : '📋 Kopiera länk'}</button>
      <p className="t-hand muted" style={{ fontSize: 14, margin: 0 }}>
        {link.usedCount} av {link.maxUses} har gått med · går ut {new Date(link.expiresAt).toLocaleDateString('sv-SE')}
        {link.unitCount > 1 ? ` · gäller ${link.unitCount} områden` : ''}
      </p>
      {link.usedCount >= link.maxUses && (
        <p className="t-hand" style={{ fontSize: 14, margin: '4px 0 0', color: 'var(--berry-deep)' }}>
          Full — ingen ny kan gå med, men de som redan gjort det kan hämta det nya. Gör en ny QR-kod för fler.
        </p>
      )}
      {onRevoke && (
        <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: 6 }} disabled={busy} onClick={() => onRevoke(code)}>
          Stäng av länken
        </button>
      )}
    </div>
  );
}
