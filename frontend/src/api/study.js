// Plugga (skolämnen) — dold bakom funktionsflaggan 'study'. Innehållet skapas
// via MCP av användarens egen AI; de här anropen läser, organiserar och tar
// emot övningssvar. Rättningen sker på servern (ingen AI — rena regler).

async function readJson(res, fallback) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.message || fallback);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const post = (apiFetch, url, body) => apiFetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {})
});

// GET /api/study/overview?term=2026-HT → { term, termLabel, currentTerm, terms,
// groups, subjects: [{key,label,code,group,emoji,color,unitCount}], totalUnits, due }
export async function fetchStudyOverview(apiFetch, term) {
  const q = term ? `?term=${encodeURIComponent(term)}` : '';
  return readJson(await apiFetch(`/api/study/overview${q}`), 'Kunde inte hämta Plugga');
}

// GET /api/study/units?subject=…&term=…&allTerms=1 → { units: [...] }
export async function fetchStudyUnits(apiFetch, { subject, group, term, allTerms } = {}) {
  const q = new URLSearchParams();
  if (subject) q.set('subject', subject);
  if (group) q.set('group', group);
  if (term) q.set('term', term);
  if (allTerms) q.set('allTerms', '1');
  const data = await readJson(await apiFetch(`/api/study/units?${q}`), 'Kunde inte hämta områden');
  return data.units;
}

// GET /api/study/units/:id → { unit, pages, items }
export async function fetchStudyUnit(apiFetch, id) {
  return readJson(await apiFetch(`/api/study/units/${id}`), 'Kunde inte hämta området');
}

// POST /api/study/sessions → { session: {id, kind}, items, total }
export async function startStudySession(apiFetch, params) {
  return readJson(await post(apiFetch, '/api/study/sessions', params), 'Kunde inte starta passet');
}

// POST /api/study/sessions/:id/answer → rättning + facit. 422 = svaret gick
// inte att tolka (räknas inte som fel) → err.data.message.
export async function answerStudyItem(apiFetch, sessionId, body) {
  return readJson(await post(apiFetch, `/api/study/sessions/${sessionId}/answer`, body), 'Kunde inte skicka svaret');
}

export async function pingStudySession(apiFetch, sessionId) {
  return readJson(await post(apiFetch, `/api/study/sessions/${sessionId}/ping`), 'ping');
}

// POST /api/study/sessions/:id/finish → { answered, correct, partial, activeSeconds, xpEarned, streak, … }
export async function finishStudySession(apiFetch, sessionId) {
  return readJson(await post(apiFetch, `/api/study/sessions/${sessionId}/finish`), 'Kunde inte avsluta passet');
}

// POST /api/study/items/:id/flag — "Rapportera fel i facit"
export async function flagStudyItem(apiFetch, itemId, note) {
  return readJson(await post(apiFetch, `/api/study/items/${itemId}/flag`, { note }), 'Kunde inte skicka rapporten');
}

// ── Dela ─────────────────────────────────────────────────────────────────────

// GET /api/study/units/:id/shares → { recipients: [{_id, username, avatar}], links: [...] } (bara skaparen)
export async function fetchUnitShares(apiFetch, unitId) {
  return readJson(await apiFetch(`/api/study/units/${unitId}/shares`), 'Kunde inte hämta delningarna');
}

export async function shareUnitWithFriends(apiFetch, unitId, friendIds) {
  return readJson(await post(apiFetch, `/api/study/units/${unitId}/share`, { friendIds }), 'Kunde inte dela området');
}

export async function removeUnitRecipient(apiFetch, unitId, userId) {
  return readJson(await apiFetch(`/api/study/units/${unitId}/share/${userId}`, { method: 'DELETE' }), 'Kunde inte ta bort');
}

export async function leaveStudyUnit(apiFetch, unitId) {
  return readJson(await post(apiFetch, `/api/study/units/${unitId}/leave`), 'Kunde inte lämna området');
}

// POST → { link: { code, expiresAt, maxUses, usedCount, revoked } }
export async function createUnitShareLink(apiFetch, unitId, { ttlDays, maxUses }) {
  return readJson(await post(apiFetch, `/api/study/units/${unitId}/share-links`, { ttlDays, maxUses }), 'Kunde inte skapa länken');
}

export async function revokeUnitShareLink(apiFetch, unitId, code) {
  return readJson(await apiFetch(`/api/study/units/${unitId}/share-links/${code}`, { method: 'DELETE' }), 'Kunde inte stänga av länken');
}

// Publik (ingen inloggning): förhandsvisning av en delningslänk /p/<kod>.
export async function fetchStudyInvitePreview(code) {
  return readJson(await fetch(`/api/study-invite/${encodeURIComponent(code)}`), 'Kunde inte läsa länken');
}

// POST → { unitId, joined, own? } — kräver inloggning men inte Plugga-flaggan.
export async function acceptStudyInvite(apiFetch, code) {
  return readJson(await post(apiFetch, `/api/study-invite/${encodeURIComponent(code)}/accept`), 'Kunde inte gå med');
}
