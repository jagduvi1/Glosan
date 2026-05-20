export async function fetchCategories(apiFetch) {
  const res = await apiFetch('/api/categories');
  if (!res.ok) throw new Error('Kunde inte hämta kategorier');
  const data = await res.json();
  return data.categories;
}

export async function createCategory(apiFetch, body) {
  const res = await apiFetch('/api/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte skapa kategori');
  return data.category;
}

export async function updateCategory(apiFetch, id, body) {
  const res = await apiFetch(`/api/categories/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kunde inte uppdatera kategori');
  return data.category;
}

export async function deleteCategory(apiFetch, id) {
  const res = await apiFetch(`/api/categories/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Kunde inte radera kategori');
  }
  return res.json();
}
