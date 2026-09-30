import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { fetchUnitDeletions, restoreUnitDeletion } from '../../api/study';
import StudyMarkdown from '../StudyMarkdown';
import { CodeTag, LevelPill } from './StudyBits';

// "Borttaget" på områdessidan (bara för skaparen): kort och övningar som
// tagits bort — i appen eller av AI:n — med datum, och ångra. En återställd
// uppgift får tillbaka sin gamla kod.

const when = (d) => new Date(d).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function DeletedList({ unitId, count, onRestored }) {
  const { apiFetch } = useAuth();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await fetchUnitDeletions(apiFetch, unitId));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [apiFetch, unitId]);

  // Läs in när listan öppnas — och igen när något nytt tagits bort.
  useEffect(() => { if (open) load(); }, [open, count, load]);

  const restore = async (row) => {
    setBusy(row.id);
    try {
      const r = await restoreUnitDeletion(apiFetch, unitId, row.id);
      setRows(r.deletions);
      onRestored?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <details className="card deleted-list" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary style={{ cursor: 'pointer', fontWeight: 800 }}>🗑️ Borttaget ({count})</summary>
      <p className="t-hand muted" style={{ margin: '8px 0 4px', fontSize: 14 }}>
        Det du (eller din AI) tagit bort. Ångra lägger tillbaka uppgiften med samma kod — men progressen börjar om.
      </p>
      {error && <p className="error" style={{ margin: '6px 0' }}>{error}</p>}
      {!rows ? (
        <p className="t-hand muted" style={{ margin: 0 }}>Laddar…</p>
      ) : rows.map((r) => (
        <div key={r.id} className="unit-item" style={{ opacity: r.restoredAt ? 0.6 : 1 }}>
          <div className="row between" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <CodeTag code={r.code} />
              <LevelPill level={r.level} />
              <span className="t-hand muted" style={{ fontSize: 13 }}>
                {r.kind === 'card' ? 'Kort' : r.usage === 'test' ? 'Provfråga' : 'Övning'} · borttagen {when(r.deletedAt)} {r.via === 'ai' ? 'av din AI' : r.byMe ? 'av dig' : ''}
                {r.restoredAt ? ` · återställd ${when(r.restoredAt)}` : ''}
              </span>
            </div>
            {r.canRestore && (
              <button type="button" className="btn btn-sm" disabled={busy === r.id} onClick={() => restore(r)}>
                {busy === r.id ? 'Ångrar…' : '↩ Ångra'}
              </button>
            )}
          </div>
          <div style={{ marginTop: 6, fontSize: 15 }}><StudyMarkdown>{r.prompt}</StudyMarkdown></div>
          {r.back && <div className="t-hand muted" style={{ marginTop: 4, fontSize: 14 }}><StudyMarkdown>{r.back}</StudyMarkdown></div>}
        </div>
      ))}
    </details>
  );
}
