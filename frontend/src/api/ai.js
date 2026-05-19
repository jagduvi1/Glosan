export async function generateList(apiFetch, body) {
  const res = await apiFetch('/api/ai/generate-list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'AI-generering misslyckades');
  return data.glosor;
}

export async function exampleSentence(apiFetch, body) {
  const res = await apiFetch('/api/ai/example-sentence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'AI-anrop misslyckades');
  return data.sentence;
}

export async function translate(apiFetch, body) {
  const res = await apiFetch('/api/ai/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'AI-anrop misslyckades');
  return data.translation;
}
