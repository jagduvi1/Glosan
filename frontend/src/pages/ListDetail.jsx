import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchList } from '../api/lists';
import { createGlos, deleteGlos } from '../api/glosor';
import { generateList } from '../api/ai';
import ImportModal from '../components/ImportModal';

export default function ListDetail() {
  const { id } = useParams();
  const { apiFetch } = useAuth();
  const [list, setList] = useState(null);
  const [glosor, setGlosor] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchList(apiFetch, id);
      setList(data.list);
      setGlosor(data.glosor);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, id]);

  useEffect(() => { load(); }, [load]);

  const onAdd = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    try {
      const glos = await createGlos(apiFetch, id, {
        source: fd.get('source'),
        target: fd.get('target'),
        notes: fd.get('notes')
      });
      setGlosor((cur) => [...cur, glos]);
      form.reset();
    } catch (err) {
      setError(err.message);
    }
  };

  const onDelete = async (glosId) => {
    try {
      await deleteGlos(apiFetch, glosId);
      setGlosor((cur) => cur.filter((g) => g._id !== glosId));
    } catch (err) {
      setError(err.message);
    }
  };

  const onImportConfirm = async ({ glosor: incoming }) => {
    for (const g of incoming) {
      const glos = await createGlos(apiFetch, id, g);
      setGlosor((cur) => [...cur, glos]);
    }
    setShowImport(false);
  };

  const onAiGenerate = async () => {
    const topic = window.prompt('Vad ska AI:n generera glosor om? (t.ex. "frukter", "rumsverben i preteritum")');
    if (!topic) return;
    setAiBusy(true);
    try {
      const suggestions = await generateList(apiFetch, {
        topic,
        sourceLang: list.sourceLang,
        targetLang: list.targetLang,
        count: 10
      });
      for (const s of suggestions) {
        if (!s.source || !s.target) continue;
        const glos = await createGlos(apiFetch, id, { source: s.source, target: s.target });
        setGlosor((cur) => [...cur, glos]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setAiBusy(false);
    }
  };

  if (loading) return <p>Laddar…</p>;
  if (!list) return <p>Lista hittades inte.</p>;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0 }}>{list.title}</h2>
          <p className="muted" style={{ margin: '0.25rem 0 0' }}>
            {list.sourceLang} → {list.targetLang} · {glosor.length} glosor
          </p>
        </div>
        <div className="row">
          <Link to={`/lists/${id}/quiz`}><button className="primary">Quiz</button></Link>
          <Link to={`/lists/${id}/flashcards`}><button>Flashcards</button></Link>
          <button onClick={() => setShowImport(true)}>Importera från text</button>
          <button onClick={onAiGenerate} disabled={aiBusy}>
            {aiBusy ? 'AI tänker…' : 'Föreslå med AI'}
          </button>
        </div>
      </div>

      <form onSubmit={onAdd} className="card row" style={{ flexWrap: 'wrap' }}>
        <label style={{ flex: 1, minWidth: 160 }}>{list.sourceLang}<input name="source" required /></label>
        <label style={{ flex: 1, minWidth: 160 }}>{list.targetLang}<input name="target" required /></label>
        <label style={{ flex: 1, minWidth: 200 }}>Anteckning<input name="notes" /></label>
        <button type="submit" className="primary" style={{ alignSelf: 'flex-end' }}>Lägg till</button>
      </form>

      {error && <p className="error">{error}</p>}

      {glosor.length === 0 ? (
        <p className="muted">Inga glosor än. Lägg till några ovan eller låt AI:n föreslå.</p>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th style={th}>{list.sourceLang}</th>
                <th style={th}>{list.targetLang}</th>
                <th style={th}>Rätt</th>
                <th style={th}>Fel</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {glosor.map((g) => (
                <tr key={g._id} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td style={td}>{g.source}</td>
                  <td style={td}>{g.target}</td>
                  <td style={td}>{g.stats?.correct ?? 0}</td>
                  <td style={td}>{g.stats?.wrong ?? 0}</td>
                  <td style={td}>
                    <button onClick={() => onDelete(g._id)}>Radera</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showImport && (
        <ImportModal
          mode="existing"
          defaultSourceLang={list.sourceLang}
          defaultTargetLang={list.targetLang}
          apiFetch={apiFetch}
          onClose={() => setShowImport(false)}
          onConfirm={onImportConfirm}
        />
      )}
    </div>
  );
}

const th = { textAlign: 'left', padding: '0.5rem 0.75rem', fontSize: '0.85rem', color: 'var(--color-muted)' };
const td = { padding: '0.5rem 0.75rem' };
