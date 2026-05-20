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
  { value: '🦄', label: 'Enhörning', unlockLevel: 5 }
];

export const TOTAL_AVATAR_COUNT = 1 /* Initial */ + GLO_MOODS.length + EMOJIS.length;
