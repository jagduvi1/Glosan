import { useEffect } from 'react';

const MODES = [
  {
    id: 'flashcard',
    label: 'Flashkort',
    description: 'Klick för att vända. Ingen skrivning — bara nöt in.',
    bg: 'var(--plum-soft)',
    iconBg: 'var(--plum)',
    icon: '🃏'
  },
  {
    id: 'write',
    label: 'Skriv',
    description: 'Stava översättningen själv. Hårdast — och bäst.',
    bg: 'var(--leaf-soft)',
    iconBg: 'var(--leaf)',
    icon: '✎'
  },
  {
    id: 'choice',
    label: '4 val',
    description: 'Välj rätt av fyra. Snabb och rolig. Kräver minst 4 glosor.',
    bg: 'var(--mustard-soft)',
    iconBg: 'var(--mustard)',
    icon: '◉'
  },
  {
    id: 'galge',
    label: 'Glos-galge',
    description: 'Hangman med Glo. Gissa bokstäverna i översättningen — 5 ord.',
    bg: 'var(--berry-soft)',
    iconBg: 'var(--berry)',
    icon: '🪢'
  },
  {
    id: 'ordfall',
    label: 'Ordfall',
    description: 'Orden faller, du skriver översättningen innan de landar. Tre liv.',
    bg: 'var(--sky-soft)',
    iconBg: 'var(--sky)',
    icon: '⬇'
  },
  {
    id: 'orm',
    label: 'Orm',
    description: 'Styr ormen och ät rätt översättning av fyra. Tre liv.',
    bg: 'var(--leaf-soft)',
    iconBg: 'var(--leaf)',
    icon: '🐍'
  }
];

export default function ModePicker({ onClose, onSelect, lastMode }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>Hur vill du öva?</h3>
          <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Stäng">×</button>
        </div>
        <div className="modal-body stack">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => onSelect(m.id)}
              className="card"
              style={{
                background: m.bg,
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
                font: 'inherit',
                position: 'relative',
                color: 'var(--ink)'
              }}
            >
              <div className="row" style={{ gap: 16, alignItems: 'center' }}>
                <div
                  style={{
                    fontSize: 24,
                    width: 56,
                    height: 56,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: m.iconBg,
                    color: 'var(--paper)',
                    borderRadius: 12,
                    border: '2px solid var(--ink)',
                    flex: 'none'
                  }}
                >
                  {m.icon}
                </div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0 }}>{m.label}</h3>
                  <p className="t-hand muted" style={{ fontSize: 15, margin: '4px 0 0' }}>{m.description}</p>
                </div>
                {lastMode === m.id && (
                  <span className="sticker tilt-r" style={{ background: 'var(--mustard)', flex: 'none' }}>
                    SENAST
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
