import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { fetchStudyFolders, createStudyFolder, updateStudyFolder } from '../../api/study';
import { useModalFocus } from '../../utils/modalFocus';

// "Lägg i mapp" — välj vilka mappar ett eller flera områden ska ligga i, eller
// skapa en ny. En mapp är bara ett urval: att ta ur ett område rör det inte.

export const FOLDER_COLORS = ['coral', 'leaf', 'sky', 'mustard', 'plum', 'berry'];

export function ColorChoice({ value, onChange }) {
  return (
    <div className="row" style={{ gap: 6 }} role="radiogroup" aria-label="Färg">
      {FOLDER_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(value === c ? null : c)}
          style={{
            width: 28, height: 28, borderRadius: 999, cursor: 'pointer',
            border: value === c ? '3px solid var(--ink)' : '2px solid var(--ink-soft)',
            background: `var(--${c})`
          }}
        />
      ))}
    </div>
  );
}

function Tri({ state }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = state === 'some'; }, [state]);
  return <input ref={ref} type="checkbox" readOnly checked={state === 'all'} tabIndex={-1} style={{ width: 18, height: 18, pointerEvents: 'none' }} />;
}

export default function FolderPicker({ unitIds, onClose, onChanged }) {
  const { apiFetch } = useAuth();
  const ref = useModalFocus(onClose);
  const [folders, setFolders] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState(null);

  const load = useCallback(async () => {
    try {
      setFolders(await fetchStudyFolders(apiFetch));
    } catch (e) {
      setError(e.message);
    }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const stateOf = (f) => {
    const n = unitIds.filter((id) => f.unitIds.includes(id)).length;
    return n === 0 ? 'none' : n === unitIds.length ? 'all' : 'some';
  };

  const replace = (folder) => setFolders((cur) => cur.map((f) => (f.id === folder.id ? folder : f)));

  const toggle = async (f) => {
    setBusy(true);
    setError('');
    try {
      const changes = stateOf(f) === 'all' ? { removeUnitIds: unitIds } : { addUnitIds: unitIds };
      replace(await updateStudyFolder(apiFetch, f.id, changes));
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const folder = await createStudyFolder(apiFetch, { name: name.trim(), color, unitIds });
      setFolders((cur) => [...cur, folder].sort((a, b) => a.name.localeCompare(b.name, 'sv')));
      setName('');
      setColor(null);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div ref={ref} className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="folder-picker-title">
        <div className="modal-header">
          <h3 id="folder-picker-title" style={{ margin: 0 }}>
            📁 Lägg {unitIds.length === 1 ? 'området' : `${unitIds.length} områden`} i en mapp
          </h3>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Stäng">×</button>
        </div>
        <div className="modal-body stack" style={{ gap: 14 }}>
          {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
          {!folders ? (
            <p className="t-hand muted" style={{ margin: 0 }}>Laddar mappar…</p>
          ) : folders.length === 0 ? (
            <p className="t-hand muted" style={{ margin: 0 }}>Du har inga mappar än — skapa en nedan, t.ex. "Inför provet v. 42".</p>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="row"
                  disabled={busy}
                  onClick={() => toggle(f)}
                  aria-pressed={stateOf(f) === 'all'}
                  style={{
                    gap: 10, padding: '8px 10px', width: '100%', textAlign: 'left', cursor: 'pointer',
                    border: '1.5px solid var(--ink)', borderRadius: 10,
                    background: f.color ? `var(--${f.color}-soft)` : 'var(--bg-elev)'
                  }}
                >
                  <Tri state={stateOf(f)} />
                  <span className="grow" style={{ fontWeight: 700 }}>{f.name}</span>
                  <span className="t-hand muted" style={{ fontSize: 13 }}>{f.unitCount} {f.unitCount === 1 ? 'område' : 'områden'}</span>
                </button>
              ))}
            </div>
          )}
          <form onSubmit={create} className="card stack" style={{ gap: 10, background: 'var(--paper-edge)', padding: 12 }}>
            <strong>+ Ny mapp</strong>
            <input className="inp" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="t.ex. Inför provet v. 42" aria-label="Mappens namn" />
            <div className="row between" style={{ gap: 10, flexWrap: 'wrap' }}>
              <ColorChoice value={color} onChange={setColor} />
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !name.trim()}>Skapa och lägg i</button>
            </div>
          </form>
        </div>
        <div className="row" style={{ padding: 16, borderTop: '1.5px dashed var(--paper-edge)', justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Klar</button>
        </div>
      </div>
    </div>
  );
}
