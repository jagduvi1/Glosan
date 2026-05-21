// Returnerar { owned, shared } så Lists-sidan kan visa två sektioner.
// Bakåtkompatibilitet: gamla anrop som bara läser första värdet i tuplen
// får ändå sin owned-array.
export async function fetchLists(apiFetch) {
  const res = await apiFetch('/api/lists');
  if (!res.ok) throw new Error('Kunde inte hämta listor');
  const data = await res.json();
  return { owned: data.lists || [], shared: data.sharedLists || [] };
}

export async function createList(apiFetch, body) {
  const res = await apiFetch('/api/lists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte skapa lista');
  return data.list;
}

export async function fetchList(apiFetch, id) {
  const res = await apiFetch(`/api/lists/${id}`);
  if (!res.ok) throw new Error('Kunde inte hämta lista');
  return res.json();
}

export async function updateList(apiFetch, id, body) {
  const res = await apiFetch(`/api/lists/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte uppdatera lista');
  return data.list;
}

export async function submitScore(apiFetch, id, body) {
  const res = await apiFetch(`/api/lists/${id}/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte spara resultat');
  return data;
}

export async function swapListDirection(apiFetch, id) {
  const res = await apiFetch(`/api/lists/${id}/swap-direction`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte byta riktning');
  return data;
}

export async function deleteList(apiFetch, id) {
  const res = await apiFetch(`/api/lists/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Kunde inte radera lista');
  }
}

export async function fetchListShares(apiFetch, id) {
  const res = await apiFetch(`/api/lists/${id}/shares`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte hämta delningar');
  return data.shares;
}

export async function shareList(apiFetch, id, friendIds, mode) {
  const body = mode ? { friendIds, mode } : { friendIds };
  const res = await apiFetch(`/api/lists/${id}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte dela listan');
  return data;
}

export async function setShareMode(apiFetch, id, mode) {
  const res = await apiFetch(`/api/lists/${id}/share-mode`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte byta delningsläge');
  return data.list;
}

export async function copyList(apiFetch, id, title) {
  const res = await apiFetch(`/api/lists/${id}/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(title ? { title } : {})
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte kopiera listan');
  return data;
}

export async function unshareList(apiFetch, id, userId) {
  const res = await apiFetch(`/api/lists/${id}/share/${userId}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte ta bort delningen');
  return data;
}

export async function leaveSharedList(apiFetch, id) {
  const res = await apiFetch(`/api/lists/${id}/leave`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte lämna listan');
  return data;
}
