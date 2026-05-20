import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchLists, createList, deleteList, updateList } from '../api/lists';
import { createGlos } from '../api/glosor';
import {
  fetchCategories,
  createCategory,
  updateCategory,
  deleteCategory
} from '../api/categories';
import ImportModal from '../components/ImportModal';
import ConfirmDialog from '../components/ConfirmDialog';
import CategoryManagerModal from '../components/CategoryManagerModal';
import DeckCard from '../components/DeckCard';
import GloAvatar from '../components/GloAvatar';
import { LANG_TO_FLAG } from '../utils/lang';

const ACCENTS = ['coral', 'leaf', 'sky', 'mustard'];

const COLOR_VARS = {
  coral: 'var(--coral)',
  leaf: 'var(--leaf)',
  sky: 'var(--sky)',
  mustard: 'var(--mustard)',
  plum: 'var(--plum)',
  berry: 'var(--berry)'
};

const dateFmt = new Intl.DateTimeFormat('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });

export default function Lists() {
  const { user, apiFetch } = useAuth();
  const navigate = useNavigate();
  const [lists, setLists] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listsData, categoriesData] = await Promise.all([
        fetchLists(apiFetch),
        fetchCategories(apiFetch)
      ]);
      setLists(listsData);
      setCategories(categoriesData);
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
        targetLang: fd.get('targetLang') || 'en',
        categoryId: fd.get('categoryId') || null
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

  const onAssignCategory = async (listId, categoryId) => {
    try {
      const updated = await updateList(apiFetch, listId, { categoryId: categoryId || null });
      setLists((cur) => cur.map((l) => (l._id === listId ? updated : l)));
      // Refresh categories so the listCount stays in sync
      setCategories(await fetchCategories(apiFetch));
    } catch (err) {
      setError(err.message);
    }
  };

  const onCreateCategory = async (body) => {
    await createCategory(apiFetch, body);
    setCategories(await fetchCategories(apiFetch));
  };

  const onRenameCategory = async (id, name) => {
    await updateCategory(apiFetch, id, { name });
    setCategories(await fetchCategories(apiFetch));
  };

  const onSetCategoryColor = async (id, color) => {
    await updateCategory(apiFetch, id, { color });
    setCategories(await fetchCategories(apiFetch));
  };

  const onDeleteCategory = async (id) => {
    await deleteCategory(apiFetch, id);
    setCategories(await fetchCategories(apiFetch));
    // Lists in that category had their categoryId cleared server-side; refresh.
    setLists(await fetchLists(apiFetch));
  };

  // Group lists by category, with Uncategorised last.
  const groupedLists = (() => {
    const buckets = new Map();
    categories.forEach((c) => buckets.set(c._id, { category: c, lists: [] }));
    const uncategorised = [];
    lists.forEach((l) => {
      const cid = l.categoryId;
      if (cid && buckets.has(cid)) {
        buckets.get(cid).lists.push(l);
      } else {
        uncategorised.push(l);
      }
    });
    const sections = [];
    buckets.forEach(({ category, lists: catLists }) => {
      if (catLists.length > 0) sections.push({ category, lists: catLists });
    });
    if (uncategorised.length > 0) {
      sections.push({ category: null, lists: uncategorised });
    }
    return sections;
  })();

  const renderDeckCard = (list, i) => {
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
        <div className="row between" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
          {total > 0 ? (
            <span className="t-hand muted" style={{ fontSize: 13 }}>bästa: {progress} / {total}</span>
          ) : (
            <span className="t-hand muted" style={{ fontSize: 13 }}>inga rekord än</span>
          )}
          <div className="row" style={{ gap: 6 }}>
            <select
              value={list.categoryId || ''}
              onChange={(e) => onAssignCategory(list._id, e.target.value)}
              onClick={(e) => e.stopPropagation()}
              style={{
                border: '2px solid var(--ink)',
                borderRadius: 8,
                padding: '4px 6px',
                background: 'var(--bg-elev)',
                fontSize: 12,
                maxWidth: 160
              }}
            >
              <option value="">— ingen kategori</option>
              {categories.map((c) => (
                <option key={c._id} value={c._id}>{c.name}</option>
              ))}
            </select>
            <button
              className="btn btn-sm btn-ghost"
              style={{ color: 'var(--berry-deep)', padding: '4px 8px' }}
              onClick={(e) => { e.stopPropagation(); setPendingDelete(list); }}
            >
              Radera
            </button>
          </div>
        </div>
      </DeckCard>
    );
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
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={() => setShowCategoryManager(true)}>
            Hantera kategorier ({categories.length})
          </button>
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
          {categories.length > 0 && (
            <label className="field">
              <span className="field-label">Kategori (valfri)</span>
              <select className="inp" name="categoryId" defaultValue="">
                <option value="">— ingen kategori</option>
                {categories.map((c) => (
                  <option key={c._id} value={c._id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}
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
        <div className="stack" style={{ gap: 26 }}>
          {groupedLists.map(({ category, lists: catLists }, sectionIdx) => (
            <section key={category?._id || 'uncategorised'}>
              <div className="row between" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
                <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  {category?.color && (
                    <span
                      style={{
                        width: 16, height: 16, borderRadius: '50%',
                        background: COLOR_VARS[category.color] || 'var(--paper-deep)',
                        border: '2px solid var(--ink)',
                        display: 'inline-block'
                      }}
                    />
                  )}
                  <h3 style={{ margin: 0 }}>
                    {category ? category.name : <span className="muted">Okategoriserade</span>}
                  </h3>
                  <span className="t-hand muted" style={{ fontSize: 14 }}>
                    {catLists.length} {catLists.length === 1 ? 'lista' : 'listor'}
                  </span>
                </div>
                {category && (
                  <div className="row" style={{ gap: 8 }}>
                    <Link to={`/categories/${category._id}/quiz?mode=review`}>
                      <button className="btn btn-sm" style={{ background: 'var(--coral-soft)' }}>
                        Repetera allt
                      </button>
                    </Link>
                    <Link to={`/categories/${category._id}/quiz?mode=all`}>
                      <button className="btn btn-sm" style={{ background: 'var(--leaf-soft)' }}>
                        Öva allt
                      </button>
                    </Link>
                  </div>
                )}
              </div>
              <div className="deck-grid">
                {catLists.map((list, i) => renderDeckCard(list, sectionIdx * 100 + i))}
              </div>
            </section>
          ))}
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

      {showCategoryManager && (
        <CategoryManagerModal
          categories={categories}
          onCreate={onCreateCategory}
          onRename={onRenameCategory}
          onSetColor={onSetCategoryColor}
          onDelete={onDeleteCategory}
          onClose={() => setShowCategoryManager(false)}
        />
      )}
    </div>
  );
}
