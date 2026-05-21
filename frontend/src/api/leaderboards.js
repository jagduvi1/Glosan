export async function fetchXpLeaderboard(apiFetch, period = 'month') {
  const res = await apiFetch(`/api/me/leaderboards/xp?period=${period}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte hämta leaderboard');
  return data;
}
