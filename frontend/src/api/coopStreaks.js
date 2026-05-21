export async function fetchCoopStreaks(apiFetch) {
  const res = await apiFetch('/api/me/coop-streaks');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte hämta co-op-streaks');
  return data.coopStreaks;
}

export async function startCoopStreak(apiFetch, friendId) {
  const res = await apiFetch('/api/me/coop-streaks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ friendId })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte starta co-op-streak');
  return data.coopStreak;
}

export async function endCoopStreak(apiFetch, id) {
  const res = await apiFetch(`/api/me/coop-streaks/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte avsluta co-op-streak');
  return data;
}
