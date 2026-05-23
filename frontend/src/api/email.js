// Email-relaterade endpoints: verify, resend, m.fl.

export async function verifyEmail(apiFetch, token) {
  const res = await apiFetch('/api/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte verifiera email');
  return data;
}

export async function resendVerification(apiFetch) {
  const res = await apiFetch('/api/auth/resend-verification', {
    method: 'POST'
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte skicka mail');
  return data;
}

// Forgot/reset-password — använder fetch direkt eftersom dessa flöden
// inte kräver auth-cookie eller token.
export async function forgotPassword(email) {
  const res = await fetch('/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte skicka mail');
  return data;
}

export async function resetPassword(token, password) {
  const res = await fetch('/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte återställa lösenord');
  return data;
}

export async function requestMagicLink(email) {
  const res = await fetch('/api/auth/magic-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte skicka länk');
  return data;
}

export async function consumeMagicLink(token) {
  const res = await fetch('/api/auth/magic-link/consume', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Inloggning misslyckades');
  return data;
}
