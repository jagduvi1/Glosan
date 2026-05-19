import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchLists, createList, deleteList } from '../api/lists';

export default function Lists() {
  const { apiFetch } = useAuth();
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLists(await fetchLists(apiFetch));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const onCreate = async (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await createList(apiFetch, {
        title: form.get('title'),
        description: form.get('description'),
        sourceLang: form.get('sourceLang') || 'sv',
        targetLang: form.get('targetLang') || 'en'
      });
      setShowForm(false);
      e.currentTarget.reset();
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const onDelete = async (id) => {
    if (!window.confirm('Radera listan?')) return;
    try {
      await deleteList(apiFetch, id);
      setLists((cur) => cur.filter((l) => l._id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Mina glos-listor</h2>
        <button className="primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Avbryt' : 'Ny lista'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={onCreate} className="card stack" style={{ marginBottom: '1rem' }}>
          <label>Titel<input name="title" required maxLength={100} /></label>
          <label>Beskrivning<input name="description" maxLength={500} /></label>
          <div className="row">
            <label style={{ flex: 1 }}>Från (språkkod)<input name="sourceLang" defaultValue="sv" maxLength={10} /></label>
            <label style={{ flex: 1 }}>Till (språkkod)<input name="targetLang" defaultValue="en" maxLength={10} /></label>
          </div>
          <button type="submit" className="primary">Skapa</button>
        </form>
      )}

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p>Laddar…</p>
      ) : lists.length === 0 ? (
        <p className="muted">Du har inga listor än. Skapa din första ovan.</p>
      ) : (
        <div className="stack">
          {lists.map((list) => (
            <div key={list._id} className="card row" style={{ justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: 0 }}>
                  <Link to={`/lists/${list._id}`}>{list.title}</Link>
                </h3>
                <p className="muted" style={{ margin: '0.25rem 0 0' }}>
                  {list.sourceLang} → {list.targetLang}
                  {list.description ? ` · ${list.description}` : ''}
                </p>
              </div>
              <button className="danger" onClick={() => onDelete(list._id)}>Radera</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
