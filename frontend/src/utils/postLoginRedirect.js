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

/** Bara interna paths — aldrig absoluta URL:er, //host eller /\host (open redirect). */
export function internalPath(v) {
  return typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.includes('\\') ? v : null;
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
