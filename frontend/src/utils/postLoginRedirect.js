// Vart användaren var på väg innan Google-login-varvet. Rundresan via Google
// är en full sidladdning, så React Router-state överlever inte — men
// sessionStorage gör det. Engångs-stash: skriv innan avfärd, konsumera vid
// landning på /login/callback.
const KEY = 'glosan.postLoginRedirect';

export function stashPostLoginRedirect(path) {
  try {
    if (path) sessionStorage.setItem(KEY, path);
  } catch {
    // sessionStorage kan saknas (privat läge m.m.) — då landar man på /lists.
  }
}

/**
 * Bara interna paths — aldrig absoluta URL:er, //host eller /\host (open
 * redirect). Inga blanksteg heller: webbläsaren stryker tabb och radbrytning
 * ur en länk, så "/⇥/ond.example" blev "//ond.example".
 */
export function internalPath(v) {
  return typeof v === 'string' && /^\/(?![/\\])[^\s\\]*$/.test(v) ? v : null;
}

const INVITE = /^[A-Za-z0-9]{4,16}$/;

/**
 * Vart man ska efter inloggning eller registrering: en QR-inbjudan
 * (?invite= → /j/, ?studyInvite= → /p/), annars dit man var på väg
 * (state.from), annars listorna. Samma svar för sidan OCH för /login- och
 * /register-vakten i App.jsx: React Router 7 byter sida i en transition, så
 * vakten hann före sidans navigate — och alla hamnade på /lists (QR-länkar
 * gick aldrig med).
 */
export function postLoginPath(location) {
  const params = new URLSearchParams(location?.search || '');
  const invite = params.get('invite');
  const study = params.get('studyInvite');
  if (invite && INVITE.test(invite)) return `/j/${invite}`;
  if (study && INVITE.test(study)) return `/p/${study}`;
  return internalPath(location?.state?.from) || '/lists';
}

export function takePostLoginRedirect() {
  try {
    const v = sessionStorage.getItem(KEY);
    if (v) sessionStorage.removeItem(KEY);
    return internalPath(v);
  } catch {
    return null;
  }
}
