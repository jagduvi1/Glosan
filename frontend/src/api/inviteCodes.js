export async function fetchInviteCodes(apiFetch) {
  const res = await apiFetch('/api/me/invite-codes');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte hämta engångskoder');
  return data.inviteCodes;
}

export async function createInviteCode(apiFetch) {
  const res = await apiFetch('/api/me/invite-codes', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte skapa engångskod');
  return data.inviteCode;
}

export async function deleteInviteCode(apiFetch, id) {
  const res = await apiFetch(`/api/me/invite-codes/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte ta bort engångskod');
  return data;
}
