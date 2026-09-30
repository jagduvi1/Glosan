import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchStudyFolder, updateStudyFolder, deleteStudyFolder } from '../api/study';
import { PracticePicker, practiceUrl } from '../components/study/StudyBits';
import UnitCard from '../components/study/UnitCard';
import { ColorChoice } from '../components/study/FolderPicker';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import ConfirmDialog from '../components/ConfirmDialog';
import ShareStudyDialog from '../components/study/ShareStudyDialog';
import '../styles/study.css';

// En mapp i Plugga: elevens eget urval av områden (tvärs över ämnen och
// terminer). Öva på allt i mappen på en gång, byt namn/färg, ta ur områden.
// Att ta bort mappen rör aldrig områdena.

export default function PluggaFolder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { apiFetch } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sharing, setSharing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await fetchStudyFolder(apiFetch, id));
    } catch (e) {
      setError(e.message);
    }
  }, [apiFetch, id]);

  useEffect(() => { load(); }, [load]);
  useDocumentTitle(data ? `${data.folder.name} — Plugga` : 'Plugga');

  const change = async (changes) => {
    setBusy(true);
    try {
      await updateStudyFolder(apiFetch, id, changes);
      await load();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p className="t-hand muted">Glo öppnar mappen…</p>;

  const { folder, units } = data;
  const back = `/plugga/mapp/${folder.id}`;
  const remove = async () => {
    setConfirmDelete(false);
    try {
      await deleteStudyFolder(apiFetch, folder.id);
      navigate('/plugga');
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <Link to="/plugga" className="t-hand" style={{ fontSize: 15 }}>← Plugga</Link>
        {editing ? (
          <form
            className="row"
            style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}
            onSubmit={async (e) => { e.preventDefault(); if (name.trim() && await change({ name: name.trim() })) setEditing(false); }}
          >
            <input className="inp" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus aria-label="Mappens namn" style={{ maxWidth: 340 }} />
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !name.trim()}>Spara</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>Avbryt</button>
          </form>
        ) : (
          <h1 style={{ fontSize: 36, margin: '6px 0 0' }}>
            <span aria-hidden="true">📁</span>{' '}
            <span style={{ borderBottom: folder.color ? `6px solid var(--${folder.color})` : 'none' }}>{folder.name}</span>
          </h1>
        )}
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
          <ColorChoice value={folder.color} onChange={(c) => change({ color: c })} />
          {!editing && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setName(folder.name); setEditing(true); }}>Byt namn</button>
          )}
          {units.some((u) => u.isOwner) && (
            <button type="button" className="btn btn-sm" onClick={() => setSharing(true)} title="Dela mappens områden med kompisar eller med en QR-kod">👥 Dela mappen</button>
          )}
          <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--berry-deep)' }} onClick={() => setConfirmDelete(true)}>Ta bort mappen</button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      {units.length === 0 ? (
        <div className="card card-lg" style={{ background: 'var(--paper-edge)' }}>
          <h2 style={{ margin: '0 0 6px' }}>Mappen är tom</h2>
          <p style={{ margin: 0 }}>
            Öppna ett område och tryck <strong>📁 Mapp</strong>, eller välj flera områden på en ämnessida och tryck <strong>Lägg i mapp</strong>.
            Du kan blanda ämnen och terminer.
          </p>
        </div>
      ) : (
        <>
          <div className="card" style={{ background: folder.color ? `var(--${folder.color}-soft)` : 'var(--mustard-soft)' }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 21 }}>Öva på allt i mappen ({units.length} {units.length === 1 ? 'område' : 'områden'})</h2>
            <PracticePicker onStart={(opts) => navigate(practiceUrl({ folderId: folder.id, back }, opts))} />
          </div>
          <div className="stack" style={{ gap: 12 }}>
            {units.map((u) => (
              <UnitCard
                key={u.id}
                unit={u}
                showSubject
                action={(
                  <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => change({ removeUnitIds: [u.id] })} title="Ta ur mappen (området finns kvar)">
                    Ta ur
                  </button>
                )}
              />
            ))}
          </div>
        </>
      )}
      {sharing && (
        <ShareStudyDialog
          units={units}
          initialSelected={units.filter((u) => u.isOwner).map((u) => u.id)}
          title={folder.name}
          onClose={() => setSharing(false)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Ta bort mappen?"
          message="Områdena i den finns kvar — det är bara mappen som försvinner."
          confirmLabel="Ta bort"
          destructive
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
