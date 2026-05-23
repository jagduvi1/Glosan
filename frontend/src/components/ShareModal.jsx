import { useEffect, useState } from 'react';

// Visas när Web Share API saknas (vanligtvis desktop). Erbjuder
// förvalda Twitter/X / Discord / kopiera-länk-knappar med pre-fylld
// text + URL.
export default function ShareModal({ text, url, onClose }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fullText = `${text} ${url}`;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(fullText)}`;
  const linkedinUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
  const blueskyUrl = `https://bsky.app/intent/compose?text=${encodeURIComponent(fullText)}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>Dela din vinst</h3>
          <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Stäng">×</button>
        </div>
        <div className="modal-body">
          <p className="t-hand muted" style={{ fontSize: 15, margin: '0 0 14px' }}>
            Kopiera texten eller välj en plattform.
          </p>
          <div
            className="card"
            style={{ background: 'var(--paper-deep)', padding: 14, marginBottom: 14, fontSize: 15 }}
          >
            {text}
            <br />
            <span style={{ color: 'var(--coral-deep)' }}>{url}</span>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <button className="btn btn-primary btn-block" onClick={onCopy}>
              {copied ? '✓ Kopierat!' : '📋 Kopiera text + länk'}
            </button>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <a href={twitterUrl} target="_blank" rel="noopener noreferrer" style={{ flex: 1, textDecoration: 'none' }}>
              <button className="btn btn-block">𝕏 Twitter/X</button>
            </a>
            <a href={blueskyUrl} target="_blank" rel="noopener noreferrer" style={{ flex: 1, textDecoration: 'none' }}>
              <button className="btn btn-block">🦋 Bluesky</button>
            </a>
            <a href={linkedinUrl} target="_blank" rel="noopener noreferrer" style={{ flex: 1, textDecoration: 'none' }}>
              <button className="btn btn-block">in LinkedIn</button>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
