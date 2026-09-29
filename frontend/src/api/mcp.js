// AI-anslutningar via MCP (Model Context Protocol) — se docs/mcp.md.
// Alla anrop här görs med användarens egen inloggning (JWT); en ansluten AI
// kan inte själv lista, godkänna eller koppla bort anslutningar.

// GET /api/mcp/connections → { connections: [...], endpoint }
export async function fetchMcpConnections(apiFetch) {
  const res = await apiFetch('/api/mcp/connections');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Kunde inte hämta AI-anslutningar');
  return data;
}

// DELETE /api/mcp/connections/:id — kopplar bort en AI direkt.
export async function revokeMcpConnection(apiFetch, id) {
  const res = await apiFetch(`/api/mcp/connections/${id}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Kunde inte koppla bort anslutningen');
  return data;
}

// POST /api/mcp/oauth/approve — samtyckesbeslutet på /connect-ai/authorize.
// `body` bär OAuth-parametrarna backend redirectade hit med, plus `approved`
// och (vid godkännande) de `scopes` användaren valde. Svarar { redirect } för
// BÅDE ja och nej — browsern skickas dit (AI-klientens redirect_uri). Backend
// validerar om allt; sidan är UX, inte en säkerhetsgräns.
export async function approveMcpConnection(apiFetch, body) {
  const res = await apiFetch('/api/mcp/oauth/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.redirect) throw new Error(data.error || 'Kunde inte slutföra anslutningen. Försök igen.');
  return data.redirect;
}
