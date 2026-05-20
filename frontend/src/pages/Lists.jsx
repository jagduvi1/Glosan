import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchLists, createList, deleteList } from '../api/lists';
import { createGlos } from '../api/glosor';
import ImportModal from '../components/ImportModal';
import ConfirmDialog from '../components/ConfirmDialog';
import DeckCard from '../components/DeckCard';
import GloAvatar from '../components/GloAvatar';
import { LANG_TO_FLAG } from '../utils/lang';

const ACCENTS = ['coral', 'leaf', 'sky', 'mustard'];

const dateFmt = new Intl.DateTimeFormat('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });

export default function Lists() {
  const { user, apiFetch } = useAuth();
  const navigate = useNavigate();
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

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
    const form = e.currentTarget;
    const fd = new FormData(form);
    try {
      await createList(apiFetch, {
        title: fd.get('title'),
        description: fd.get('description'),
        sourceLang: fd.get('sourceLang') || 'sv',
        targetLang: fd.get('targetLang') || 'en'
      });
      setShowForm(false);
      form.reset();
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteList(apiFetch, pendingDelete._id);
      setLists((cur) => cur.filter((l) => l._id !== pendingDelete._id));
    } catch (err) {
      setError(err.message);
    } finally {
      setPendingDelete(null);
    }
  };

  const onImportConfirm = async ({ title, description, sourceLang, targetLang, glosor }) => {
    const list = await createList(apiFetch, { title, description, sourceLang, targetLang });
    for (const g of glosor) {
      await createGlos(apiFetch, list._id, g);
    }
    setShowImport(false);
    load();
  };

  return (
    <div>
      <div className="row between" style={{ marginBottom: 24, alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div className="t-hand muted" style={{ fontSize: 17 }}>{dateFmt.format(new Date())}</div>
          <h1 style={{ fontSize: 40, margin: '4px 0 0' }}>
            Hej {user?.username || 'där'} — <span className="mark-highlight">hänger du med?</span>
          </h1>
        </div>
        <div style={{ position: 'relative' }}>
          <GloAvatar size={92} float tilt={-4} />
        </div>
      </div>

      <div className="row between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ margin: 0 }}>Mina glos-listor</h2>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn-sm" onClick={() => setShowImport(true)}>Importera från text</button>
          <button className="btn btn-sm btn-primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? '× Avbryt' : '+ Ny lista'}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={onCreate} className="card stack" style={{ marginBottom: 20 }}>
          <label className="field">
            <span className="field-label">Titel</span>
            <input className="inp" name="title" required maxLength={100} autoFocus />
          </label>
          <label className="field">
            <span className="field-label">Beskrivning (valfri)</span>
            <input className="inp" name="description" maxLength={500} />
          </label>
          <div className="row" style={{ gap: 14 }}>
            <label className="field" style={{ flex: 1 }}>
              <span className="field-label">Från (språkkod)</span>
              <input className="inp" name="sourceLang" defaultValue="sv" maxLength={10} />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span className="field-label">Till (språkkod)</span>
              <input className="inp" name="targetLang" defaultValue="en" maxLength={10} />
            </label>
          </div>
          <button type="submit" className="btn btn-primary">Skapa lista</button>
        </form>
      )}

      {error && <p className="error" style={{ marginBottom: 14 }}>{error}</p>}

      {loading ? (
        <p className="t-hand muted">Glo letar upp dina listor…</p>
      ) : lists.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <GloAvatar size={120} float />
          </div>
          <h3 style={{ margin: '0 0 6px' }}>Inga listor än.</h3>
          <p className="muted">Skapa din första lista eller importera från en text.</p>
        </div>
      ) : (
        <div className="deck-grid">
          {lists.map((list, i) => {
            const accent = ACCENTS[i % ACCENTS.length];
            const flag = LANG_TO_FLAG[list.sourceLang];
            const subtitle = [list.description, `${list.sourceLang} → ${list.targetLang}`].filter(Boolean).join(' · ');
            const progress = list.bestScore?.correct ?? 0;
            const total = list.bestScore?.total ?? 0;
            return (
              <DeckCard
                key={list._id}
                flag={flag}
                lang={list.title}
                subtitle={subtitle}
                progress={progress}
                total={total}
                accent={accent}
                onClick={() => navigate(`/lists/${list._id}`)}
              >
                <div className="row between" style={{ marginTop: 10 }}>
                  {total > 0 ? (
                    <span className="t-hand muted" style={{ fontSize: 13 }}>bästa: {progress} / {total}</span>
                  ) : (
                    <span className="t-hand muted" style={{ fontSize: 13 }}>inga rekord än</span>
                  )}
                  <button
                    className="btn btn-sm btn-ghost"
                    style={{ color: 'var(--berry-deep)', padding: '4px 8px' }}
                    onClick={(e) => { e.stopPropagation(); setPendingDelete(list); }}
                  >
                    Radera
                  </button>
                </div>
              </DeckCard>
            );
          })}
        </div>
      )}

      {showImport && (
        <ImportModal
          mode="new"
          apiFetch={apiFetch}
          onClose={() => setShowImport(false)}
          onConfirm={onImportConfirm}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Radera listan?"
          message={`"${pendingDelete.title}" och alla glosor i listan raderas permanent. Det här går inte att ångra.`}
          confirmLabel="Radera"
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
