import GloAvatar from './GloAvatar';

export default function AvatarDisplay({ avatar, username, size = 38, bg = 'var(--coral)', style = {} }) {
  const kind = avatar?.kind || 'initial';
  const value = avatar?.value || '';

  if (kind === 'glo') {
    const mood = ['default', 'wink', 'sad'].includes(value) ? value : 'default';
    return (
      <span
        style={{
          width: size,
          height: size,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 'none',
          ...style
        }}
      >
        <GloAvatar mood={mood} size={size} />
      </span>
    );
  }

  if (kind === 'emoji' && value) {
    return (
      <span
        className="avatar"
        style={{
          width: size,
          height: size,
          background: 'var(--mustard-soft)',
          fontSize: Math.round(size * 0.6),
          color: 'var(--ink)',
          ...style
        }}
      >
        {value}
      </span>
    );
  }

  const initial = (username || '?').trim().charAt(0).toUpperCase();
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        background: bg,
        fontSize: Math.round(size * 0.5),
        ...style
      }}
    >
      {initial}
    </span>
  );
}
