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
