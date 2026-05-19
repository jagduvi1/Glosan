// Wraps fetch with: (1) Authorization header from a getter, (2) auto-refresh
// on 401 via a provided refresher, (3) forced logout if refresh fails.
export function createApiFetch(getToken, refreshToken, onLogout) {
  return async function apiFetch(input, init = {}) {
    const headers = new Headers(init.headers || {});
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const opts = { ...init, headers, credentials: 'include' };
    let response = await fetch(input, opts);

    if (response.status !== 401) return response;

    const newToken = await refreshToken();
    if (!newToken) {
      await onLogout();
      return response;
    }

    headers.set('Authorization', `Bearer ${newToken}`);
    response = await fetch(input, { ...init, headers, credentials: 'include' });
    return response;
  };
}
