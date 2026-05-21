import { useEffect } from 'react';
import { EGGS, getFoundEggs } from '../utils/easterEggs';

export default function EasterEggListModal({ onClose }) {
  const found = getFoundEggs();
  const totalFound = found.size;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>🥚 Påskägg du har hittat</h3>
          <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Stäng">×</button>
        </div>
        <div className="modal-body">
          <p className="t-hand muted" style={{ fontSize: 15, margin: '0 0 14px' }}>
            {totalFound} av {EGGS.length} upptäckta. Hintar för de återstående:
          </p>
          <div className="stack">
            {EGGS.map((egg) => {
              const hit = found.has(egg.id);
              return (
                <div
                  key={egg.id}
                  className="row"
                  style={{
                    gap: 12,
                    padding: '10px 12px',
                    border: '2px solid var(--ink)',
                    borderRadius: 10,
                    background: hit ? 'var(--leaf-soft)' : 'var(--paper-deep)',
                    boxShadow: '2px 2px 0 0 var(--ink)'
                  }}
                >
                  <span style={{ fontSize: 22, flex: 'none' }} aria-hidden="true">
                    {hit ? '✅' : '❓'}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>
                      {hit ? egg.label : '???'}
                    </div>
                    <div className="t-hand muted" style={{ fontSize: 13 }}>
                      {egg.hint}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
