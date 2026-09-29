// Plugga (skolämnen) — dold bakom funktionsflaggan 'study'. Innehållet skapas
// via MCP av användarens egen AI; de här anropen läser och organiserar.

// GET /api/study/overview?term=2026-HT → { term, termLabel, currentTerm,
// terms: [{key,label}], groups, subjects: [{key,label,code,group,emoji,color,unitCount}] }
export async function fetchStudyOverview(apiFetch, term) {
  const q = term ? `?term=${encodeURIComponent(term)}` : '';
  const res = await apiFetch(`/api/study/overview${q}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Kunde inte hämta Plugga');
  return data;
}
