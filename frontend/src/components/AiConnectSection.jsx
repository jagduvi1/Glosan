import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchMcpConnections, revokeMcpConnection } from '../api/mcp';

// Profil → "Koppla din AI". Visar MCP-adressen att klistra in i claude.ai
// (eller en annan AI som stöder MCP-connectors) och de AI:er som redan är
// anslutna, med en knapp för att koppla bort var och en. Se docs/mcp.md.

const SCOPE_LABEL = {
  read: 'läsa',
  write: 'skapa och ändra'
};

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function AiConnectSection() {
  const { apiFetch } = useAuth();
  const [connections, setConnections] = useState(null);
  const [endpoint, setEndpoint] = useState(`${window.location.origin}/api/mcp`);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchMcpConnections(apiFetch);
      setConnections(data.connections);
      if (data.endpoint) setEndpoint(data.endpoint);
    } catch (e) {
      setError(e.message);
    }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard-API:t kan saknas (http, gamla browsers) — adressen står ju där.
    }
  };

  const onRevoke = async (id) => {
    setError('');
    setBusyId(id);
    try {
      await revokeMcpConnection(apiFetch, id);
      setConnections((list) => list.filter((c) => c.id !== id));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>🤖 Koppla din AI</h2>
      <p className="t-hand muted" style={{ fontSize: 16, marginTop: 0 }}>
        Fota glosbladet i Claude och säg <em>"gör en glosa av det här"</em> — så skapas listan direkt i Glosan.
        Lägg till Glosan som connector i din AI med adressen nedan.
      </p>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <code
          style={{
            background: 'var(--paper-edge)',
            padding: '8px 12px',
            borderRadius: 8,
            fontFamily: 'var(--font-mono)',
            fontSize: 15,
            wordBreak: 'break-all'
          }}
        >
          {endpoint}
        </code>
        <button className="btn btn-sm" type="button" onClick={onCopy}>
          {copied ? 'Kopierad ✓' : 'Kopiera'}
        </button>
      </div>

      <details style={{ marginBottom: 14 }}>
        <summary className="t-hand" style={{ cursor: 'pointer', fontSize: 16 }}>Så gör du i Claude</summary>
        <ol style={{ margin: '8px 0 0', paddingLeft: 22, lineHeight: 1.6 }}>
          <li>Öppna <strong>claude.ai</strong> → <strong>Settings → Connectors</strong>.</li>
          <li>Välj <strong>Add custom connector</strong>, döp den till <em>Glosan</em> och klistra in adressen ovan.</li>
          <li>Klicka <strong>Connect</strong> — du hamnar här i Glosan, loggar in och godkänner.</li>
          <li>Klart! Skicka en bild på glosorna i en chatt och be Claude skapa listan.</li>
        </ol>
      </details>

      {error && <p className="error">{error}</p>}

      {connections === null && !error && <p className="t-hand muted">Laddar…</p>}
      {connections && connections.length === 0 && (
        <p className="t-hand muted" style={{ margin: 0 }}>Ingen AI är ansluten ännu.</p>
      )}
      {connections && connections.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {connections.map((c) => (
            <div
              key={c.id}
              className="row between"
              style={{ gap: 12, flexWrap: 'wrap', padding: '10px 12px', background: 'var(--paper-edge)', borderRadius: 10 }}
            >
              <div>
                <strong>{c.name}</strong>
                <div className="t-hand muted" style={{ fontSize: 14 }}>
                  Får {c.scopes.map((s) => SCOPE_LABEL[s] || s).join(' och ')} · ansluten {formatDate(c.createdAt)}
                  {c.lastUsedAt ? ` · senast använd ${formatDate(c.lastUsedAt)}` : ''}
                </div>
                {c.missingModules?.length > 0 && (
                  <div className="t-hand" style={{ fontSize: 14, color: 'var(--berry-deep)', marginTop: 2 }}>
                    Når inte {c.missingModules.map((m) => m.label).join(' och ')} — det slogs på efter att du anslöt.
                    Koppla bort och anslut igen från din AI om den ska få det.
                  </div>
                )}
              </div>
              <button
                className="btn btn-sm"
                type="button"
                style={{ background: 'var(--berry-soft)', color: 'var(--berry-deep)' }}
                onClick={() => onRevoke(c.id)}
                disabled={busyId === c.id}
              >
                {busyId === c.id ? 'Kopplar bort…' : 'Koppla bort'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
