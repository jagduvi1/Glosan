export async function getProfile(apiFetch) {
  const res = await apiFetch('/api/me/profile');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte hämta profilen');
  return data;
}

export async function updateAvatar(apiFetch, body) {
  const res = await apiFetch('/api/me/avatar', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte uppdatera avataren');
  return data;
}

export async function postQuizComplete(apiFetch, body) {
  const res = await apiFetch('/api/me/quiz-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte spara resultatet');
  return data;
}

export async function getMyPlan(apiFetch) {
  const res = await apiFetch('/api/me/plan');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte hämta plan');
  return data;
}

export async function startMyTrial(apiFetch) {
  const res = await apiFetch('/api/me/trial', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte starta trial');
  return data;
}

// Returnerar hela export-bloben som JSON så Profile-sidan kan triggera
// en nedladdning via Blob + objectURL.
export async function exportMyData(apiFetch) {
  const res = await apiFetch('/api/me/export');
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Kunde inte exportera data');
  }
  return res.json();
}

export async function deleteMyAccount(apiFetch) {
  const res = await apiFetch('/api/me', { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Kunde inte radera kontot');
  }
  return res.json();
}
