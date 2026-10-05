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

// MCP-adressen att lägga in i en AI — utan inloggning (guiden /koppla-ai).
// Läses ur den publika resursmetadatan (RFC 9728), så det blir den riktiga
// adressen även på den gamla domänen (glosan.jeklund.dev).
export async function fetchMcpEndpoint() {
  const fallback = `${window.location.origin}/api/mcp`;
  try {
    const res = await fetch('/.well-known/oauth-protected-resource/api/mcp');
    const data = res.ok ? await res.json() : null;
    return typeof data?.resource === 'string' ? data.resource : fallback;
  } catch {
    return fallback;
  }
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

// GET /api/mcp/oauth/client — vem vill ansluta? Namnet valde klienten själv
// vid registreringen, så svaret har också redirect-värden och `trust`:
// 'known' (en AI-tjänst Glosan känner igen), 'local' (en app på datorn) eller
// 'unknown'. Publik (samtyckessidan visas före inloggningen). null = okänd klient.
export async function fetchMcpClientInfo(clientId, redirectUri) {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri });
  const res = await fetch(`/api/mcp/oauth/client?${q}`);
  if (!res.ok) return null;
  return res.json().catch(() => null);
}
