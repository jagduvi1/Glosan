export async function createGlos(apiFetch, listId, body) {
  const res = await apiFetch(`/api/lists/${listId}/glosor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte skapa glosa');
  return data.glos;
}

export async function updateGlos(apiFetch, id, body) {
  const res = await apiFetch(`/api/glosor/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte uppdatera glosa');
  return data.glos;
}

export async function deleteGlos(apiFetch, id) {
  const res = await apiFetch(`/api/glosor/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Kunde inte radera glosa');
  }
}
