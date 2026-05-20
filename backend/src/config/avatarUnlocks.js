// Avatar unlock level table — keyed by `${kind}:${value}`.
// IMPORTANT: keep in sync with frontend/src/config/avatars.js — a drift means
// the picker may show options the server rejects with 403, or vice versa.

const AVATAR_UNLOCK_LEVELS = {
  'initial:': 1,
  'glo:default': 1,
  'glo:wink': 2,
  'glo:sad': 3,
  'emoji:🦊': 1,
  'emoji:🐱': 1,
  'emoji:🐰': 1,
  'emoji:🦉': 2,
  'emoji:🐧': 2,
  'emoji:🐙': 2,
  'emoji:🐢': 3,
  'emoji:🐸': 3,
  'emoji:🦔': 3,
  'emoji:🐼': 4,
  'emoji:🦦': 4,
  'emoji:🦄': 5,
  // Endgame mascots — one per unlock tier (2–4 levels apart).
  'emoji:🦁': 7,
  'emoji:🐳': 9,
  'emoji:🦋': 12,
  'emoji:🦒': 15,
  'emoji:🦅': 18,
  'emoji:🦩': 22,
  'emoji:🦚': 26,
  'emoji:🐉': 30
};

function unlockLevelFor(kind, value) {
  const key = `${kind}:${kind === 'initial' ? '' : value}`;
  return AVATAR_UNLOCK_LEVELS[key] ?? 999;
}

module.exports = { AVATAR_UNLOCK_LEVELS, unlockLevelFor };
