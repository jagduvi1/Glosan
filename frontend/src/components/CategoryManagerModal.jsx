import { useEffect, useState } from 'react';

const COLOR_OPTIONS = [
  { value: null, label: 'ingen', cssVar: 'var(--paper-deep)' },
  { value: 'coral', label: 'koral', cssVar: 'var(--coral)' },
  { value: 'leaf', label: 'löv', cssVar: 'var(--leaf)' },
  { value: 'sky', label: 'himmel', cssVar: 'var(--sky)' },
  { value: 'mustard', label: 'senap', cssVar: 'var(--mustard)' },
  { value: 'plum', label: 'plommon', cssVar: 'var(--plum)' },
  { value: 'berry', label: 'bär', cssVar: 'var(--berry)' }
];

function colorDot(color) {
  const cssVar = COLOR_OPTIONS.find((c) => c.value === color)?.cssVar || 'var(--paper-deep)';
  return (
    <span
      style={{
        width: 14, height: 14, borderRadius: '50%',
        background: cssVar,
        border: '2px solid var(--ink)',
        display: 'inline-block',
        flex: 'none'
      }}
    />
  );
}

export default function CategoryManagerModal({
  categories,
  onCreate,
  onRename,
  onSetColor,
  onDelete,
  onClose
}) {
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // category id being renamed
  const [editingName, setEditingName] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onCreate({ name: newName.trim(), color: newColor });
      setNewName('');
      setNewColor(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (cat) => {
    setEditing(cat._id);
    setEditingName(cat.name);
  };

  const saveEdit = async () => {
    if (!editingName.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onRename(editing, editingName.trim());
      setEditing(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (cat) => {
    if (!window.confirm(`Radera kategorin "${cat.name}"? Listorna i den blir okategoriserade men raderas inte.`)) return;
    setBusy(true);
    setError('');
    try {
      await onDelete(cat._id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>Hantera kategorier</h3>
          <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Stäng">×</button>
        </div>
        <div className="modal-body stack" style={{ gap: 16 }}>
          {error && <p className="error">{error}</p>}

          <form onSubmit={handleCreate} className="card" style={{ padding: 14, background: 'var(--paper-deep)' }}>
            <label className="field" style={{ marginBottom: 10 }}>
              <span className="field-label">Ny kategori</span>
              <input
                className="inp"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="t.ex. Franska VT 2026"
                maxLength={60}
                disabled={busy}
              />
            </label>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {COLOR_OPTIONS.map((opt) => (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => setNewColor(opt.value)}
                  style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: opt.cssVar,
                    border: `${newColor === opt.value ? '3px' : '2px'} solid var(--ink)`,
                    cursor: 'pointer',
                    padding: 0
                  }}
                  title={opt.label}
                  aria-label={`färg ${opt.label}`}
                />
              ))}
            </div>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !newName.trim()}>
              + Skapa kategori
            </button>
          </form>

          {categories.length === 0 ? (
            <p className="t-hand muted" style={{ fontSize: 14, textAlign: 'center' }}>
              Du har inga kategorier än. Skapa en ovan.
            </p>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {categories.map((cat) => (
                <div key={cat._id} className="card" style={{ padding: 10 }}>
                  <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                    {colorDot(cat.color)}
                    {editing === cat._id ? (
                      <input
                        className="inp"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        maxLength={60}
                        style={{ flex: 1, minWidth: 120, boxShadow: 'none', padding: '6px 10px' }}
                        autoFocus
                      />
                    ) : (
                      <span style={{ fontWeight: 700, flex: 1 }}>{cat.name}</span>
                    )}
                    <span className="t-hand muted" style={{ fontSize: 13 }}>{cat.listCount || 0} listor</span>
                    {editing === cat._id ? (
                      <>
                        <button className="btn btn-sm btn-primary" onClick={saveEdit} disabled={busy}>Spara</button>
                        <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)} disabled={busy}>Avbryt</button>
                      </>
                    ) : (
                      <>
                        <select
                          value={cat.color || ''}
                          onChange={(e) => onSetColor(cat._id, e.target.value || null).catch((err) => setError(err.message))}
                          disabled={busy}
                          style={{
                            border: '2px solid var(--ink)',
                            borderRadius: 8,
                            padding: '4px 8px',
                            background: 'var(--bg-elev)',
                            fontSize: 13
                          }}
                        >
                          {COLOR_OPTIONS.map((opt) => (
                            <option key={String(opt.value)} value={opt.value || ''}>{opt.label}</option>
                          ))}
                        </select>
                        <button className="btn btn-sm" onClick={() => startEdit(cat)} disabled={busy}>Döp om</button>
                        <button
                          className="btn btn-sm btn-ghost"
                          style={{ color: 'var(--berry-deep)' }}
                          onClick={() => handleDelete(cat)}
                          disabled={busy}
                        >
                          Radera
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>Klar</button>
        </div>
      </div>
    </div>
  );
}
