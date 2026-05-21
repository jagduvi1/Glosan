export async function createDuel(apiFetch, body) {
  const res = await apiFetch('/api/duels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte skapa utmaning');
  return data.duel;
}

export async function fetchDuels(apiFetch) {
  const res = await apiFetch('/api/duels');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte hämta utmaningar');
  return data.duels;
}

export async function fetchDuel(apiFetch, id) {
  const res = await apiFetch(`/api/duels/${id}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte hämta utmaningen');
  return data.duel;
}

export async function submitDuel(apiFetch, id, body) {
  const res = await apiFetch(`/api/duels/${id}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte spara resultatet');
  return data.duel;
}

export async function deleteDuel(apiFetch, id) {
  const res = await apiFetch(`/api/duels/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Kunde inte ta bort utmaningen');
  }
}
