// Avatar options + unlock levels.
// IMPORTANT: keep in sync with backend/src/config/avatarUnlocks.js — the
// backend enforces unlock levels server-side and a drift means a user can
// be locked out of an option the picker shows as available (or vice versa).

export const GLO_MOODS = [
  { value: 'default', label: 'Nyfiken', unlockLevel: 1 },
  { value: 'wink', label: 'Glad', unlockLevel: 2 },
  { value: 'sad', label: 'Ledsen', unlockLevel: 3 }
];

export const EMOJIS = [
  { value: '🦊', label: 'Räv', unlockLevel: 1 },
  { value: '🐱', label: 'Katt', unlockLevel: 1 },
  { value: '🐰', label: 'Kanin', unlockLevel: 1 },
  { value: '🦉', label: 'Uggla', unlockLevel: 2 },
  { value: '🐧', label: 'Pingvin', unlockLevel: 2 },
  { value: '🐙', label: 'Bläckfisk', unlockLevel: 2 },
  { value: '🐢', label: 'Sköldpadda', unlockLevel: 3 },
  { value: '🐸', label: 'Groda', unlockLevel: 3 },
  { value: '🦔', label: 'Igelkott', unlockLevel: 3 },
  { value: '🐼', label: 'Panda', unlockLevel: 4 },
  { value: '🦦', label: 'Utter', unlockLevel: 4 },
  { value: '🦄', label: 'Enhörning', unlockLevel: 5 },
  // Endgame mascots — one per unlock tier, 2–4 levels apart
  { value: '🦁', label: 'Lejon', unlockLevel: 7 },
  { value: '🐳', label: 'Val', unlockLevel: 9 },
  { value: '🦋', label: 'Fjäril', unlockLevel: 12 },
  { value: '🦒', label: 'Giraff', unlockLevel: 15 },
  { value: '🦅', label: 'Örn', unlockLevel: 18 },
  { value: '🦩', label: 'Flamingo', unlockLevel: 22 },
  { value: '🦚', label: 'Påfågel', unlockLevel: 26 },
  { value: '🐉', label: 'Drake', unlockLevel: 30 }
];

export const TOTAL_AVATAR_COUNT = 1 /* Initial */ + GLO_MOODS.length + EMOJIS.length;
