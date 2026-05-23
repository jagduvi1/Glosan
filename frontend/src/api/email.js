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
