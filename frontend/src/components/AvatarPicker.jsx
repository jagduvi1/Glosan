import { useEffect } from 'react';
import GloAvatar from './GloAvatar';
import { GLO_MOODS, EMOJIS, TOTAL_AVATAR_COUNT } from '../config/avatars';

function OptionButton({ children, selected, locked, lockLabel, onClick }) {
  return (
    <button
      type="button"
      onClick={locked ? undefined : onClick}
      disabled={locked}
      aria-disabled={locked}
      title={locked ? lockLabel : undefined}
      style={{
        background: selected ? 'var(--mustard)' : locked ? 'var(--paper-edge)' : 'var(--bg-elev)',
        border: `${selected ? '3px' : '2px'} solid ${locked ? 'var(--ink-mute)' : 'var(--ink)'}`,
        borderRadius: 14,
        padding: 10,
        boxShadow: locked
          ? '2px 2px 0 0 var(--ink-mute)'
          : selected
            ? '4px 4px 0 0 var(--ink)'
            : '2px 2px 0 0 var(--ink)',
        cursor: locked ? 'not-allowed' : 'pointer',
        opacity: locked ? 0.55 : 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        minWidth: 86,
        font: 'inherit',
        color: 'var(--ink)',
        position: 'relative',
        transition: 'transform 120ms var(--ease-out)'
      }}
    >
      {children}
      {locked && lockLabel && (
        <div className="t-hand" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
          🔒 {lockLabel}
        </div>
      )}
    </button>
  );
}

export default function AvatarPicker({ currentAvatar, username, userLevel = 1, onSelect, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const kind = currentAvatar?.kind || 'initial';
  const value = currentAvatar?.value || '';
  const isSelected = (k, v) => kind === k && value === v;
  const isLocked = (optKind, optValue, unlockLevel) =>
    !isSelected(optKind, optValue) && unlockLevel > userLevel;
  const initial = (username || '?').trim().charAt(0).toUpperCase();
  const unlockedCount =
    1 + GLO_MOODS.filter((m) => m.unlockLevel <= userLevel).length + EMOJIS.filter((e) => e.unlockLevel <= userLevel).length;
  const totalCount = TOTAL_AVATAR_COUNT;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>Välj profilbild</h3>
          <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Stäng">×</button>
        </div>
        <div className="modal-body stack" style={{ gap: 20 }}>
          <p className="t-hand muted" style={{ fontSize: 14, margin: 0 }}>
            Du har låst upp {unlockedCount} av {totalCount} profilbilder. Levla upp för fler.
          </p>

          <section>
            <h4 style={{ margin: '0 0 10px' }}>Standard</h4>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <OptionButton
                selected={isSelected('initial', '')}
                onClick={() => onSelect({ kind: 'initial', value: '' })}
              >
                <span className="avatar" style={{ width: 56, height: 56, background: 'var(--coral)', fontSize: 26 }}>
                  {initial}
                </span>
                <div className="t-hand muted" style={{ fontSize: 13 }}>Initial</div>
              </OptionButton>
            </div>
          </section>

          <section>
            <h4 style={{ margin: '0 0 10px' }}>Glo</h4>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              {GLO_MOODS.map((m) => {
                const locked = isLocked('glo', m.value, m.unlockLevel);
                return (
                  <OptionButton
                    key={m.value}
                    selected={isSelected('glo', m.value)}
                    locked={locked}
                    lockLabel={`nivå ${m.unlockLevel}`}
                    onClick={() => onSelect({ kind: 'glo', value: m.value })}
                  >
                    <GloAvatar mood={m.value} size={56} />
                    <div className="t-hand muted" style={{ fontSize: 13 }}>{m.label}</div>
                  </OptionButton>
                );
              })}
            </div>
          </section>

          <section>
            <h4 style={{ margin: '0 0 10px' }}>Djur</h4>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              {EMOJIS.map((e) => {
                const locked = isLocked('emoji', e.value, e.unlockLevel);
                return (
                  <OptionButton
                    key={e.value}
                    selected={isSelected('emoji', e.value)}
                    locked={locked}
                    lockLabel={`nivå ${e.unlockLevel}`}
                    onClick={() => onSelect({ kind: 'emoji', value: e.value })}
                  >
                    <span
                      className="avatar"
                      style={{ width: 56, height: 56, background: 'var(--mustard-soft)', fontSize: 32 }}
                    >
                      {e.value}
                    </span>
                    <div className="t-hand muted" style={{ fontSize: 13 }}>{e.label}</div>
                  </OptionButton>
                );
              })}
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
