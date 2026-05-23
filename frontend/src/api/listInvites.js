export async function createListInvite(apiFetch, listId, { ttlDays, maxUses }) {
  const res = await apiFetch(`/api/lists/${listId}/share-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttlDays, maxUses })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte skapa länk');
  return data.invite;
}

export async function fetchListInvites(apiFetch, listId) {
  const res = await apiFetch(`/api/lists/${listId}/share-links`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte hämta länkar');
  return data.invites;
}

export async function revokeListInvite(apiFetch, listId, code) {
  const res = await apiFetch(`/api/lists/${listId}/share-link/${code}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte avaktivera');
  return data;
}

// Publika anrop (utan auth)
export async function fetchInvitePreview(code) {
  const res = await fetch(`/api/list-invite/${code}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte ladda länken');
  return data;
}

export async function acceptListInvite(apiFetch, code) {
  const res = await apiFetch(`/api/list-invite/${code}/accept`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte acceptera');
  return data;
}
