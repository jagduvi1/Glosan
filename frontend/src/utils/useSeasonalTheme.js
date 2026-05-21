import { useEffect, useState } from 'react';

// Säsongsteman triggas av dagens datum. Listan kollas i ordning — första
// match vinner, så lägg specifika dagar (1 april) före breda intervall
// (påsktid) om de kan överlappa.
const SEASONS = [
  {
    name: 'aprilfools',
    test: (m, d) => m === 4 && d === 1,
    accessory: '🤡',
    message: '1 april — lita inte på Glo idag!'
  },
  {
    name: 'lucia',
    test: (m, d) => m === 12 && d === 13,
    accessory: '🕯️',
    message: 'Glad Lucia! ✨'
  },
  {
    name: 'christmas',
    test: (m, d) => m === 12 && d >= 24 && d <= 26,
    accessory: '🎄',
    message: 'God jul! 🎁'
  },
  {
    name: 'newyear',
    test: (m, d) => (m === 12 && d === 31) || (m === 1 && d === 1),
    accessory: '🎆',
    message: 'Gott nytt år!'
  },
  {
    name: 'easter',
    test: (m, d) => (m === 3 && d >= 25) || (m === 4 && d <= 15),
    accessory: '🐰',
    message: 'Glad påsk! 🐣'
  },
  {
    name: 'walpurgis',
    test: (m, d) => m === 4 && d === 30,
    accessory: '🔥',
    message: 'Glad Valborg!'
  },
  {
    name: 'midsummer',
    test: (m, d) => m === 6 && d >= 19 && d <= 25,
    accessory: '🌻',
    message: 'Glad midsommar!'
  },
  {
    name: 'kanelbullen',
    test: (m, d) => m === 10 && d === 4,
    accessory: '🥐',
    message: 'Kanelbullens dag — ta en med fikat!'
  },
  {
    name: 'halloween',
    test: (m, d) => m === 10 && d === 31,
    accessory: '🎃',
    message: 'Bus eller godis! 👻'
  }
];

// Returnerar aktuellt säsongstema + om det är "nattläge" (00:00-04:59).
// Re-evalueras varje minut så ett tema byts in/ut även om sidan står
// öppen vid midnatt.
export function useSeasonalTheme() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const m = now.getMonth() + 1;
  const d = now.getDate();
  const h = now.getHours();

  const season = SEASONS.find((s) => s.test(m, d)) || null;
  const lateNight = h >= 0 && h < 5;

  return {
    season,
    accessory: season?.accessory || null,
    message: season?.message || null,
    lateNight
  };
}
