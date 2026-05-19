export async function fetchLists(apiFetch) {
  const res = await apiFetch('/api/lists');
  if (!res.ok) throw new Error('Kunde inte hämta listor');
  const data = await res.json();
  return data.lists;
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

export async function deleteList(apiFetch, id) {
  const res = await apiFetch(`/api/lists/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Kunde inte radera lista');
  }
}
