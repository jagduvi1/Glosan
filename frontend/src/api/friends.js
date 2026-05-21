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

export async function removeFriend(apiFetch, friendId) {
  const res = await apiFetch(`/api/me/friends/${friendId}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Kunde inte ta bort kompisen');
  }
}
