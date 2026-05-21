import { useEffect, useRef } from 'react';

// Klassisk Konami-kod: ↑↑↓↓←→←→ B A
const SEQUENCE = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
  'b', 'a'
];

export function useKonamiCode(onMatch) {
  const positionRef = useRef(0);
  const onMatchRef = useRef(onMatch);
  onMatchRef.current = onMatch;

  useEffect(() => {
    const onKey = (e) => {
      // Stör inte text-input om någon råkar trycka sekvensen i en input
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      const expected = SEQUENCE[positionRef.current];
      const got = e.key;
      const ok = got === expected || (expected.length === 1 && got.toLowerCase() === expected);
      if (ok) {
        positionRef.current += 1;
        if (positionRef.current === SEQUENCE.length) {
          onMatchRef.current?.();
          positionRef.current = 0;
        }
      } else {
        // Tillåt direkt restart om denna tangent matchar början av sekvensen
        positionRef.current = (got === SEQUENCE[0]) ? 1 : 0;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
