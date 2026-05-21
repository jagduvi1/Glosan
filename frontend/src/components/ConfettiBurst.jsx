import { useEffect, useState } from 'react';

const COLORS = [
  'var(--coral)',
  'var(--mustard)',
  'var(--leaf)',
  'var(--sky)',
  'var(--plum)',
  'var(--berry)'
];

let nextBurstId = 0;

// Triggas genom att höja `trigger`-talet — varje ny siffra startar en
// burst. Kan kallas flera gånger i rad utan att den gamla bursten avbryts.
export default function ConfettiBurst({ trigger, count = 80, duration = 2800 }) {
  const [bursts, setBursts] = useState([]);

  useEffect(() => {
    if (!trigger) return undefined;
    const id = ++nextBurstId;
    const pieces = Array.from({ length: count }, (_, i) => ({
      key: `${id}-${i}`,
      left: Math.random() * 100,
      delay: Math.random() * 400,
      rotation: Math.random() * 360,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: 7 + Math.random() * 9,
      driftX: (Math.random() - 0.5) * 260
    }));
    setBursts((cur) => [...cur, { id, pieces }]);
    const t = setTimeout(() => {
      setBursts((cur) => cur.filter((b) => b.id !== id));
    }, duration);
    return () => clearTimeout(t);
  }, [trigger, count, duration]);

  if (bursts.length === 0) return null;
  return (
    <div className="confetti-overlay" aria-hidden="true">
      {bursts.flatMap((b) => b.pieces).map((p) => (
        <span
          key={p.key}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            background: p.color,
            animationDelay: `${p.delay}ms`,
            '--rot-start': `${p.rotation}deg`,
            '--drift-x': `${p.driftX}px`
          }}
        />
      ))}
    </div>
  );
}
