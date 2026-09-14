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

export function takePostLoginRedirect() {
  try {
    const v = sessionStorage.getItem(KEY);
    if (v) sessionStorage.removeItem(KEY);
    // Bara interna paths — aldrig absoluta URL:er eller //host (open redirect).
    return v && v.startsWith('/') && !v.startsWith('//') ? v : null;
  } catch {
    return null;
  }
}
