// Användarnamn: veckospärren och hur länge ett gammalt namn hålls åt sin
// ägare. Egen fil så att både User-modellen (toJSON) och services/username.js
// kan använda den utan att kräva varandra.

// En gång i veckan: nog för att rätta ett dåligt namn, men kompisar ska inte
// behöva lära om sig varje dag (Johan, 2026-10-06). Lika länge hålls det gamla
// namnet åt ägaren, så att ingen annan kan ta det och så att ägaren kan ångra
// ett byte (en felskrivning, eller ett skämt någon gjort på en olåst dator).
const CHANGE_COOLDOWN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** När får man byta nästa gång efter ett byte vid `changedAt`? null = nu. */
function nextUsernameChangeAt(changedAt, now = new Date()) {
  if (!changedAt) return null;
  const at = new Date(new Date(changedAt).getTime() + CHANGE_COOLDOWN_DAYS * DAY_MS);
  return at > now ? at : null;
}

/** Mongo-filter för ett namn som någon annan just bytt bort och som hålls åt hen. */
function heldUsernameFilter(name, now = new Date()) {
  return { previousUsername: name, usernameChangedAt: { $gt: new Date(now.getTime() - CHANGE_COOLDOWN_DAYS * DAY_MS) } };
}

module.exports = { CHANGE_COOLDOWN_DAYS, nextUsernameChangeAt, heldUsernameFilter };
