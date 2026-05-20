import { useEffect } from 'react';
import GloAvatar from './GloAvatar';

const GLO_MOODS = [
  { value: 'default', label: 'Nyfiken' },
  { value: 'wink', label: 'Glad' },
  { value: 'sad', label: 'Ledsen' }
];

const EMOJIS = [
  { value: '🦊', label: 'Räv' },
  { value: '🐱', label: 'Katt' },
  { value: '🦉', label: 'Uggla' },
  { value: '🐢', label: 'Sköldpadda' },
  { value: '🦄', label: 'Enhörning' },
  { value: '🐰', label: 'Kanin' },
  { value: '🐼', label: 'Panda' },
  { value: '🦔', label: 'Igelkott' },
  { value: '🐸', label: 'Groda' },
  { value: '🦦', label: 'Utter' },
  { value: '🐧', label: 'Pingvin' },
  { value: '🐙', label: 'Bläckfisk' }
];

function OptionButton({ children, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: selected ? 'var(--mustard)' : 'var(--bg-elev)',
        border: `${selected ? '3px' : '2px'} solid var(--ink)`,
        borderRadius: 14,
        padding: 10,
        boxShadow: selected ? '4px 4px 0 0 var(--ink)' : '2px 2px 0 0 var(--ink)',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        minWidth: 86,
        font: 'inherit',
        color: 'var(--ink)',
        transition: 'transform 120ms var(--ease-out)'
      }}
    >
      {children}
    </button>
  );
}

export default function AvatarPicker({ currentAvatar, username, onSelect, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const kind = currentAvatar?.kind || 'initial';
  const value = currentAvatar?.value || '';
  const isSelected = (k, v) => kind === k && value === v;
  const initial = (username || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>Välj profilbild</h3>
          <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Stäng">×</button>
        </div>
        <div className="modal-body stack" style={{ gap: 20 }}>
          <section>
            <h4 style={{ margin: '0 0 10px' }}>Standard</h4>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <OptionButton selected={isSelected('initial', '')} onClick={() => onSelect({ kind: 'initial', value: '' })}>
                <span className="avatar" style={{ width: 56, height: 56, background: 'var(--coral)', fontSize: 26 }}>{initial}</span>
                <div className="t-hand muted" style={{ fontSize: 13 }}>Initial</div>
              </OptionButton>
            </div>
          </section>
          <section>
            <h4 style={{ margin: '0 0 10px' }}>Glo</h4>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              {GLO_MOODS.map((m) => (
                <OptionButton
                  key={m.value}
                  selected={isSelected('glo', m.value)}
                  onClick={() => onSelect({ kind: 'glo', value: m.value })}
                >
                  <GloAvatar mood={m.value} size={56} />
                  <div className="t-hand muted" style={{ fontSize: 13 }}>{m.label}</div>
                </OptionButton>
              ))}
            </div>
          </section>
          <section>
            <h4 style={{ margin: '0 0 10px' }}>Djur</h4>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              {EMOJIS.map((e) => (
                <OptionButton
                  key={e.value}
                  selected={isSelected('emoji', e.value)}
                  onClick={() => onSelect({ kind: 'emoji', value: e.value })}
                >
                  <span className="avatar" style={{ width: 56, height: 56, background: 'var(--mustard-soft)', fontSize: 32 }}>
                    {e.value}
                  </span>
                  <div className="t-hand muted" style={{ fontSize: 13 }}>{e.label}</div>
                </OptionButton>
              ))}
            </div>
          </section>
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>Klar</button>
        </div>
      </div>
    </div>
  );
}
