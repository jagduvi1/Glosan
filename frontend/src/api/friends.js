export async function fetchFriends(apiFetch) {
  const res = await apiFetch('/api/me/friends');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte hämta kompisar');
  return data.friends;
}

export async function addFriendByCode(apiFetch, code) {
  const res = await apiFetch('/api/me/friends/by-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte lägga till kompisen');
  return data.friend;
}

// Blockera: tar bort vänskap och allt ni delat, och stoppar nya (services/blocks.js).
async function blocksJson(res, fallback) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || fallback);
  return data.blocked;
}

export async function fetchBlocked(apiFetch) {
  return blocksJson(await apiFetch('/api/me/blocks'), 'Kunde inte hämta blockeringarna');
}

export async function blockUser(apiFetch, userId) {
  return blocksJson(await apiFetch('/api/me/blocks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId })
  }), 'Kunde inte blockera');
}

export async function unblockUser(apiFetch, userId) {
  return blocksJson(await apiFetch(`/api/me/blocks/${userId}`, { method: 'DELETE' }), 'Kunde inte häva blockeringen');
}

export async function removeFriend(apiFetch, friendId) {
  const res = await apiFetch(`/api/me/friends/${friendId}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Kunde inte ta bort kompisen');
  }
}
