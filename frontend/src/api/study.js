// Plugga (skolämnen) — dold bakom funktionsflaggan 'study'. Innehållet skapas
// via MCP av användarens egen AI; de här anropen läser, organiserar och tar
// emot övningssvar. Rättningen sker på servern (ingen AI — rena regler).

async function readJson(res, fallback) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let message = data.error || data.message || fallback;
    // Plugga avstängt för kontot (flaggan togs bort): säg det på svenska och
    // låt AuthContext hämta om användaren, så sidorna försvinner ur menyn.
    if (res.status === 404 && data.error === 'Route not found') {
      message = 'Plugga är inte påslaget för ditt konto just nu.';
      try { window.dispatchEvent(new Event('glosan:feature-off')); } catch { /* ignore */ }
    }
    // Valideringsfel från servern är på engelska (för utvecklare) — visa vår text.
    if (res.status === 400 && !/[åäöÅÄÖ]/.test(message)) message = fallback;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const post = (apiFetch, url, body, init = {}) => apiFetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
  ...init
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
// keepalive: true när fliken stängs (pagehide) — anropet hinner iväg ändå.
export async function finishStudySession(apiFetch, sessionId, { keepalive = false } = {}) {
  return readJson(await post(apiFetch, `/api/study/sessions/${sessionId}/finish`, {}, keepalive ? { keepalive: true } : {}), 'Kunde inte avsluta passet');
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

// Ta bort en kopia man fått (den är ens egen; den som delade har sitt original kvar).
export async function deleteStudyUnitCopy(apiFetch, unitId) {
  return readJson(await apiFetch(`/api/study/units/${unitId}`, { method: 'DELETE' }), 'Kunde inte ta bort kopian');
}

// POST → { link: { code, expiresAt, maxUses, usedCount, revoked } }
export async function createUnitShareLink(apiFetch, unitId, { ttlDays, maxUses }) {
  return readJson(await post(apiFetch, `/api/study/units/${unitId}/share-links`, { ttlDays, maxUses }), 'Kunde inte skapa länken');
}

export async function revokeUnitShareLink(apiFetch, unitId, code) {
  return readJson(await apiFetch(`/api/study/units/${unitId}/share-links/${code}`, { method: 'DELETE' }), 'Kunde inte stänga av länken');
}

// Dela flera områden på en gång (Plugga-sidornas Dela: ett kapitel, en mapp).
// POST → { units, friends, added }
export async function shareUnitsWithFriends(apiFetch, unitIds, friendIds) {
  return readJson(await post(apiFetch, '/api/study/share', { unitIds, friendIds }), 'Kunde inte dela');
}

// POST → { link } — EN länk/QR-kod som gäller alla valda områden.
export async function createStudyShareLink(apiFetch, { unitIds, ttlDays, maxUses, title }) {
  return readJson(await post(apiFetch, '/api/study/share-links', { unitIds, ttlDays, maxUses, title }), 'Kunde inte skapa länken');
}

// Mina aktiva länkar, med områdena de gäller.
export async function fetchMyStudyShareLinks(apiFetch) {
  return (await readJson(await apiFetch('/api/study/share-links'), 'Kunde inte hämta länkarna')).links;
}

export async function revokeMyStudyShareLink(apiFetch, code) {
  return (await readJson(await apiFetch(`/api/study/share-links/${code}`, { method: 'DELETE' }), 'Kunde inte stänga av länken')).links;
}

// Publik: förhandsvisning av en delningslänk /p/<kod>. Med apiFetch (inloggad)
// visas samma urval som man får när man går med.
export async function fetchStudyInvitePreview(code, apiFetch = null) {
  const url = `/api/study-invite/${encodeURIComponent(code)}`;
  return readJson(await (apiFetch ? apiFetch(url) : fetch(url)), 'Kunde inte läsa länken');
}

// POST → { unitId, unitIds, joined, own? } — kräver inloggning men inte Plugga-flaggan.
export async function acceptStudyInvite(apiFetch, code) {
  return readJson(await post(apiFetch, `/api/study-invite/${encodeURIComponent(code)}/accept`), 'Kunde inte gå med');
}

// ── Mappar ───────────────────────────────────────────────────────────────────

// GET → { folders: [{ id, name, color, unitIds, unitCount, emojis }] }
export async function fetchStudyFolders(apiFetch) {
  const data = await readJson(await apiFetch('/api/study/folders'), 'Kunde inte hämta mapparna');
  return data.folders;
}

// GET → { folder, units: [unit summaries med progress] }
export async function fetchStudyFolder(apiFetch, folderId) {
  return readJson(await apiFetch(`/api/study/folders/${folderId}`), 'Kunde inte hämta mappen');
}

export async function createStudyFolder(apiFetch, { name, color, unitIds }) {
  const data = await readJson(await post(apiFetch, '/api/study/folders', { name, color, unitIds }), 'Kunde inte skapa mappen');
  return data.folder;
}

// Body: { name?, color?, addUnitIds?, removeUnitIds? } → folder
export async function updateStudyFolder(apiFetch, folderId, changes) {
  const res = await apiFetch(`/api/study/folders/${folderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes)
  });
  const data = await readJson(res, 'Kunde inte ändra mappen');
  return data.folder;
}

export async function deleteStudyFolder(apiFetch, folderId) {
  return readJson(await apiFetch(`/api/study/folders/${folderId}`, { method: 'DELETE' }), 'Kunde inte ta bort mappen');
}

// ── Min plugg ────────────────────────────────────────────────────────────────

// GET /api/study/activity?period=day|week|month|term&date=YYYY-MM-DD →
// { period, start, end, prev, next, today, totals, bySubject, days, timeline, streak }
export async function fetchStudyActivity(apiFetch, { period, date } = {}) {
  const q = new URLSearchParams();
  if (period) q.set('period', period);
  if (date) q.set('date', date);
  return readJson(await apiFetch(`/api/study/activity?${q}`), 'Kunde inte hämta Min plugg');
}

// ── Övningsprov ──────────────────────────────────────────────────────────────

// GET → { test: { id, title, description, timeLimitMin, questionCount, max, limits, unit }, attempts, inProgress }
export async function fetchStudyTest(apiFetch, testId) {
  return readJson(await apiFetch(`/api/study/tests/${testId}`), 'Kunde inte hämta provet');
}

// GET → { test, questions } — att skriva ut (inget facit)
// GET → { units, items (med facit och mallvariant), total } — ett övningsblad
// att skriva ut. `query`: URLSearchParams från scopeQuery (StudyBits).
export async function fetchStudySheet(apiFetch, query) {
  return readJson(await apiFetch(`/api/study/sheet?${query}`), 'Kunde inte hämta övningarna');
}

export async function fetchStudyTestSheet(apiFetch, testId) {
  return readJson(await apiFetch(`/api/study/tests/${testId}/sheet`), 'Kunde inte hämta provet');
}

// POST → { attempt: { id, status, startedAt, deadline, serverNow, sessionId, resumed }, test, questions, needsSelf? }
export async function startStudyTest(apiFetch, testId) {
  return readJson(await post(apiFetch, `/api/study/tests/${testId}/start`), 'Kunde inte starta provet');
}

// POST → { status: 'done', attemptId, … } | { status: 'awaiting_self', needsSelf }.
// 422 = några svar gick inte att tolka → err.data.invalid = [{ n, itemId, message }].
// lenient (när tiden är slut): oläsbara svar räknas som obesvarade i stället.
export async function submitStudyTest(apiFetch, attemptId, answers, { lenient = false } = {}) {
  return readJson(await post(apiFetch, `/api/study/tests/attempts/${attemptId}/submit`, { answers, ...(lenient ? { lenient: true } : {}) }), 'Kunde inte lämna in provet');
}

// assessments: [{ itemId, level: 'none'|'E'|'C'|'A' }]
export async function assessStudyTest(apiFetch, attemptId, assessments) {
  return readJson(await post(apiFetch, `/api/study/tests/attempts/${attemptId}/assess`, { assessments }), 'Kunde inte spara bedömningen');
}

// GET → resultatet (poäng per nivå, uppskattat betyg, facit per fråga)
export async function fetchStudyTestAttempt(apiFetch, attemptId) {
  return readJson(await apiFetch(`/api/study/tests/attempts/${attemptId}`), 'Kunde inte hämta resultatet');
}

// ── Ta bort uppgifter ────────────────────────────────────────────────────────

// DELETE → { deleted: 'MA2-7' } (bara skaparen; loggas under "Borttaget")
export async function deleteStudyItem(apiFetch, itemId) {
  return readJson(await apiFetch(`/api/study/items/${itemId}`, { method: 'DELETE' }), 'Kunde inte ta bort uppgiften');
}

// GET → { deletions: [{ id, code, kind, prompt, back?, level, via, byMe, deletedAt, restoredAt, canRestore }] }
export async function fetchUnitDeletions(apiFetch, unitId) {
  const data = await readJson(await apiFetch(`/api/study/units/${unitId}/deletions`), 'Kunde inte hämta borttagna');
  return data.deletions;
}

// POST → { restored: 'MA2-7', deletions }
export async function restoreUnitDeletion(apiFetch, unitId, deletionId) {
  return readJson(await post(apiFetch, `/api/study/units/${unitId}/deletions/${deletionId}/restore`), 'Kunde inte ångra');
}
