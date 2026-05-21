import { useEffect, useState } from 'react';

let nextBurstId = 0;

// Som ConfettiBurst men regnar emoji-tecken istället för färgade bitar.
// Använd `emoji` för texttecknet (eller en array för slumpat val).
export default function EmojiBurst({ trigger, emoji = '🥐', count = 24, duration = 3200 }) {
  const [bursts, setBursts] = useState([]);

  useEffect(() => {
    if (!trigger) return undefined;
    const id = ++nextBurstId;
    const choices = Array.isArray(emoji) ? emoji : [emoji];
    const pieces = Array.from({ length: count }, (_, i) => ({
      key: `${id}-${i}`,
      left: Math.random() * 100,
      delay: Math.random() * 600,
      rotation: (Math.random() - 0.5) * 60,
      char: choices[Math.floor(Math.random() * choices.length)],
      size: 22 + Math.random() * 18,
      driftX: (Math.random() - 0.5) * 200
    }));
    setBursts((cur) => [...cur, { id, pieces }]);
    const t = setTimeout(() => {
      setBursts((cur) => cur.filter((b) => b.id !== id));
    }, duration);
    return () => clearTimeout(t);
  }, [trigger, count, duration, emoji]);

  if (bursts.length === 0) return null;
  return (
    <div className="confetti-overlay" aria-hidden="true">
      {bursts.flatMap((b) => b.pieces).map((p) => (
        <span
          key={p.key}
          className="emoji-piece"
          style={{
            left: `${p.left}%`,
            fontSize: p.size,
            animationDelay: `${p.delay}ms`,
            '--rot-start': `${p.rotation}deg`,
            '--drift-x': `${p.driftX}px`
          }}
        >
          {p.char}
        </span>
      ))}
    </div>
  );
}
