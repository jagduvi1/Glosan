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
  'emoji:🦄': 5
};

function unlockLevelFor(kind, value) {
  const key = `${kind}:${kind === 'initial' ? '' : value}`;
  return AVATAR_UNLOCK_LEVELS[key] ?? 999;
}

module.exports = { AVATAR_UNLOCK_LEVELS, unlockLevelFor };
