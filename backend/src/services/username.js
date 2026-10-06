// Användarnamn — reglerna för ett namn, och att byta det under Profil eller
// första gången efter en Google-inloggning (då föreslås ett namn ur e-posten,
// User.needsUsername). Namnet finns bara på User: kompisar, delningar och
// dueller pekar på kontots id. Man loggar in med namnet ELLER e-posten.
//
// Samma regler gäller när ett konto skapas (middleware/validateRegistration.js)
// och när ett Google-konto får sitt förslag (routes/oauth.js).
const User = require('../models/User');
const { CHANGE_COOLDOWN_DAYS, nextUsernameChangeAt, heldUsernameFilter } = require('../config/username');

const MIN_LENGTH = 3;
const MAX_LENGTH = 30; // som modellen
// Bokstäver (även å, ä, ö, é, ü), siffror, punkt, bindestreck, understreck —
// inga mellanslag, inget @ (inloggningen tar namn ELLER e-post) och inga
// bokstäver från andra alfabet som ser likadana ut.
const ALLOWED = /^[a-z0-9åäöéü._-]+$/;
const HAS_LETTER_OR_DIGIT = /[a-z0-9åäöéü]/;
// Namn som ser ut att vara Glosan själv. Jämförs ord för ord (namnet delat
// vid punkt, bindestreck, understreck och siffror), så "glosan-support",
// "admin1" och "glosån" stoppas men "badminton" och "aik.supporter" går bra.
// Ett ord som BÖRJAR med glosan ("glosanteam") räknas också.
const RESERVED_WORDS = new Set(['admin', 'administrator', 'support', 'moderator']);
const RESERVED = new Set(['glo', 'system', 'root', 'null', 'undefined']);
const TAKEN = 'Det namnet är upptaget — välj ett annat.';

/** Som modellen sparar det: trimmat och med gemener. */
function normalizeUsername(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

// "glosån" → "glosan": prickar och ringar bort, för jämförelsen med de reserverade orden.
const folded = (name) => name.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** null om namnet går att använda, annars vad som är fel (på svenska). */
function usernameProblem(name) {
  if (name.length < MIN_LENGTH) return `Minst ${MIN_LENGTH} tecken.`;
  if (name.length > MAX_LENGTH) return `Högst ${MAX_LENGTH} tecken.`;
  if (!ALLOWED.test(name)) return 'Bara bokstäver, siffror, punkt, bindestreck och understreck — inga mellanslag.';
  if (!HAS_LETTER_OR_DIGIT.test(name)) return 'Minst en bokstav eller siffra.';
  const words = folded(name).split(/[._\-0-9]+/).filter(Boolean);
  if (RESERVED.has(name) || words.some((w) => RESERVED_WORDS.has(w) || w.startsWith('glosan'))) {
    return 'Det namnet ser ut att höra till Glosan — välj ett annat.';
  }
  return null;
}

/** Används namnet — av någon annan, eller hålls det åt någon som just bytt bort det? */
async function usernameTaken(name, exceptId = null, now = new Date()) {
  return Boolean(await User.exists({
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
    $or: [{ username: name }, heldUsernameFilter(name, now)]
  }));
}

/** När får användaren byta namn nästa gång? null = nu. */
function nextChangeAt(user, now = new Date()) {
  return nextUsernameChangeAt(user?.usernameChangedAt, now);
}

const whenSv = (d) => d.toLocaleString('sv-SE', {
  day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm'
});

/**
 * Byt användarnamn. Tre fall utöver ett vanligt byte:
 * - första valet efter en Google-inloggning: att behålla förslaget bekräftar
 *   bara det, och valet startar ingen veckospärr;
 * - ångra: tillbaka till det förra namnet går alltid under veckan (det hålls
 *   åt en), och spärren förlängs inte;
 * - samma namn igen: inget att byta.
 * Returnerar { user } eller { error, status, nextChangeAt? }.
 */
async function changeUsername(userId, raw, now = new Date()) {
  const user = await User.findById(userId);
  if (!user) return { error: 'Logga in igen.', status: 401 };
  const name = normalizeUsername(raw);
  const firstChoice = Boolean(user.needsUsername);
  if (name === user.username) {
    if (!firstChoice) return { error: 'Det är redan ditt användarnamn.', status: 400 };
    // Förslaget ur e-posten måste också klara reglerna (t.ex. support@…).
    if (usernameProblem(name)) return { error: 'Det namnet går inte att använda — välj ett annat.', status: 400 };
    user.needsUsername = false;
    await user.save();
    return { user };
  }
  const problem = usernameProblem(name);
  if (problem) return { error: problem, status: 400 };
  const undo = Boolean(user.previousUsername) && name === user.previousUsername && Boolean(nextChangeAt(user, now));
  if (!firstChoice && !undo) {
    const next = nextChangeAt(user, now);
    if (next) return { error: `Du kan byta användarnamn igen ${whenSv(next)}.`, status: 429, nextChangeAt: next };
  }
  if (await usernameTaken(name, user._id, now)) return { error: TAKEN, status: 409 };
  if (undo) {
    // Tillbaka till det gamla: spärren löper som den gjorde, och namnet man
    // ångrar hålls inte kvar åt en.
    user.previousUsername = null;
  } else if (!firstChoice) {
    // Det gamla namnet hålls (och går att ångra till) bara om det klarar
    // reglerna — ett konto från före dem kan ha ett som inte gör det.
    user.previousUsername = usernameProblem(user.username) ? null : user.username;
    user.usernameChangedAt = now;
  }
  user.username = name;
  user.needsUsername = false;
  try {
    await user.save();
  } catch (err) {
    // Någon annan hann ta namnet samtidigt (unikt index).
    if (err && err.code === 11000) return { error: TAKEN, status: 409 };
    throw err;
  }
  return { user };
}

/**
 * Admin byter namnet åt någon (t.ex. ett elakt namn): samma regler, och
 * kontot låses en vecka utan väg tillbaka — det gamla namnet hålls inte och
 * går inte att ångra till. (Den som utsatts för ett skämt kan ångra själv.)
 */
async function adminSetUsername(userId, raw, now = new Date()) {
  const user = await User.findById(userId);
  if (!user) return { error: 'User not found', status: 404 };
  const name = normalizeUsername(raw);
  const problem = usernameProblem(name);
  if (problem) return { error: problem, status: 400 };
  if (name !== user.username && await usernameTaken(name, user._id)) return { error: TAKEN, status: 409 };
  user.username = name;
  user.previousUsername = null;
  user.usernameChangedAt = now;
  user.needsUsername = false;
  try {
    await user.save();
  } catch (err) {
    if (err && err.code === 11000) return { error: TAKEN, status: 409 };
    throw err;
  }
  return { user };
}

module.exports = {
  CHANGE_COOLDOWN_DAYS, MIN_LENGTH, MAX_LENGTH,
  normalizeUsername, usernameProblem, usernameTaken, nextChangeAt, changeUsername, adminSetUsername
};
