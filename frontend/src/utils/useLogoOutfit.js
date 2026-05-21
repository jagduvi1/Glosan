import { useCallback, useState } from 'react';

// Lista av outfits Glo kan bära. null = ingen outfit (default).
// Byts var 10:e klick på logon i navbaren och cyklar.
const OUTFITS = [null, '🎩', '🕶️', '👑', '🧢', '🎀'];
const STORAGE_KEY = 'glo-logo-clicks';
const CLICKS_PER_OUTFIT = 10;

export function useLogoOutfit() {
  const [clicks, setClicks] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    } catch {
      return 0;
    }
  });

  const onClick = useCallback(() => {
    setClicks((c) => {
      const next = c + 1;
      try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const outfitIdx = Math.floor(clicks / CLICKS_PER_OUTFIT) % OUTFITS.length;
  const outfit = OUTFITS[outfitIdx];

  return { onClick, outfit, clicks };
}
