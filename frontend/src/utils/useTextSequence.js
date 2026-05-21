import { useEffect, useRef } from 'react';

// Lyssnar globalt på keydown och triggar callback när användaren skriver
// `sequence` (case-insensitive) någonstans på sidan, även när inget input
// är fokuserat. Bra för dolda "skriv X"-påskägg.
export function useTextSequence(sequence, onMatch) {
  const positionRef = useRef(0);
  const onMatchRef = useRef(onMatch);
  onMatchRef.current = onMatch;
  const seqLower = sequence.toLowerCase();

  useEffect(() => {
    const onKey = (e) => {
      // Strunta i modifier-tangenter och ej-bokstäver
      if (e.key.length !== 1) {
        positionRef.current = 0;
        return;
      }
      const c = e.key.toLowerCase();
      const expected = seqLower[positionRef.current];
      if (c === expected) {
        positionRef.current += 1;
        if (positionRef.current === seqLower.length) {
          onMatchRef.current?.();
          positionRef.current = 0;
        }
      } else {
        positionRef.current = c === seqLower[0] ? 1 : 0;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [seqLower]);
}
