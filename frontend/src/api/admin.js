export async function fetchAdminUsers(apiFetch) {
  const res = await apiFetch('/api/admin/users');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte hämta användare');
  return data.users;
}

export async function fetchAdminPlans(apiFetch) {
  const res = await apiFetch('/api/admin/plans');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte hämta planer');
  return data.plans;
}

export async function setUserPlan(apiFetch, userId, plan) {
  const res = await apiFetch(`/api/admin/users/${userId}/plan`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte ändra plan');
  return data.user;
}

export async function grantTrial(apiFetch, userId, plan, days) {
  const res = await apiFetch(`/api/admin/users/${userId}/trial`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan, days })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte ge trial');
  return data.user;
}

export async function clearTrial(apiFetch, userId) {
  const res = await apiFetch(`/api/admin/users/${userId}/trial`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte avsluta trial');
  return data.user;
}

export async function resetUsage(apiFetch, userId) {
  const res = await apiFetch(`/api/admin/users/${userId}/reset-usage`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte nollställa användning');
  return data.user;
}

// Funktionsflaggor (dolda moduler, t.ex. Plugga). Katalogen + vilka som är på
// för alla kommer från backend (config/features.js).
export async function fetchAdminFeatures(apiFetch) {
  const res = await apiFetch('/api/admin/features');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte hämta funktioner');
  return data.features;
}

// PATCH /api/admin/users/:id/username — byt namn åt någon (kontot låses en vecka).
export async function setUsernameAsAdmin(apiFetch, userId, username) {
  const res = await apiFetch(`/api/admin/users/${userId}/username`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Kunde inte byta namn');
  return data.user;
}

export async function setUserFeature(apiFetch, userId, feature, enabled) {
  const res = await apiFetch(`/api/admin/users/${userId}/features`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feature, enabled })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte ändra funktion');
  return data.user;
}
