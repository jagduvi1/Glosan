export default function GloAvatar({ mood = 'default', size = 120, float = false, tilt = 0, style = {} }) {
  const src = mood === 'wink' ? '/assets/glo-wink.svg'
            : mood === 'sad'  ? '/assets/glo-sad.svg'
            :                   '/assets/glo-mascot.svg';
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt="Glo"
      className={float ? 'float' : ''}
      style={{ transform: tilt ? `rotate(${tilt}deg)` : undefined, display: 'block', ...style }}
    />
  );
}
