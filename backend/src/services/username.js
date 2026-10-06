// Byta användarnamn — under Profil, och första gången efter en Google-
// inloggning (då föreslås ett namn ur e-posten, User.needsUsername). Namnet
// finns bara på User: kompisar, delningar och dueller pekar på kontots id, så
// inget annat behöver ändras. Man loggar in med namnet ELLER e-posten.
const User = require('../models/User');

// En gång i veckan: tillräckligt för att rätta ett dåligt namn, men kompisar
// ska inte behöva lära om sig varje dag (Johan, 2026-10-06).
const CHANGE_COOLDOWN_DAYS = 7;
const MIN_LENGTH = 3;
const MAX_LENGTH = 30; // som modellen
// Bokstäver (även å, ä, ö, é, ü), siffror, punkt, bindestreck, understreck.
const ALLOWED = /^[a-z0-9åäöéü._-]+$/;
const HAS_LETTER_OR_DIGIT = /[a-z0-9åäöéü]/;
// Namn som ser ut att vara Glosan själv.
const RESERVED = new Set([
  'admin', 'administrator', 'glosan', 'glo', 'support', 'moderator', 'system', 'root', 'null', 'undefined'
]);
const TAKEN = 'Det namnet är upptaget — välj ett annat.';

/** Som modellen sparar det: trimmat och med gemener. */
function normalizeUsername(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/** null om namnet går att använda, annars vad som är fel (på svenska). */
function usernameProblem(name) {
  if (name.length < MIN_LENGTH) return `Minst ${MIN_LENGTH} tecken.`;
  if (name.length > MAX_LENGTH) return `Högst ${MAX_LENGTH} tecken.`;
  if (!ALLOWED.test(name)) return 'Bara bokstäver, siffror, punkt, bindestreck och understreck — inga mellanslag.';
  if (!HAS_LETTER_OR_DIGIT.test(name)) return 'Minst en bokstav eller siffra.';
  if (RESERVED.has(name)) return 'Det namnet är reserverat — välj ett annat.';
  return null;
}

/** När får användaren byta namn nästa gång? null = nu. */
function nextChangeAt(user, now = new Date()) {
  if (!user?.usernameChangedAt) return null;
  const at = new Date(new Date(user.usernameChangedAt).getTime() + CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  return at > now ? at : null;
}

const dateSv = (d) => d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', timeZone: 'Europe/Stockholm' });

/**
 * Byt användarnamn — eller, första gången efter en Google-inloggning, bekräfta
 * det föreslagna. Det första valet räknas inte mot veckospärren.
 * Returnerar { user } eller { error, status, nextChangeAt? }.
 */
async function changeUsername(userId, raw, now = new Date()) {
  const user = await User.findById(userId);
  if (!user) return { error: 'Logga in igen.', status: 401 };
  const name = normalizeUsername(raw);
  const firstChoice = Boolean(user.needsUsername);
  if (name === user.username) {
    if (!firstChoice) return { error: 'Det är redan ditt användarnamn.', status: 400 };
    user.needsUsername = false;
    await user.save();
    return { user };
  }
  const problem = usernameProblem(name);
  if (problem) return { error: problem, status: 400 };
  const next = firstChoice ? null : nextChangeAt(user, now);
  if (next) return { error: `Du kan byta användarnamn igen ${dateSv(next)}.`, status: 429, nextChangeAt: next };
  if (await User.exists({ username: name, _id: { $ne: user._id } })) return { error: TAKEN, status: 409 };
  user.username = name;
  user.needsUsername = false;
  if (!firstChoice) user.usernameChangedAt = now;
  try {
    await user.save();
  } catch (err) {
    // Någon annan hann ta namnet samtidigt (unikt index).
    if (err && err.code === 11000) return { error: TAKEN, status: 409 };
    throw err;
  }
  return { user };
}

module.exports = {
  CHANGE_COOLDOWN_DAYS, MIN_LENGTH, MAX_LENGTH, normalizeUsername, usernameProblem, nextChangeAt, changeUsername
};
