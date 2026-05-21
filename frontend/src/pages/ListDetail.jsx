import { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGamification } from '../contexts/GamificationContext';
import { fetchList, swapListDirection, leaveSharedList, copyList, fetchWeeklyRecords } from '../api/lists';
import { createGlos, deleteGlos } from '../api/glosor';
import { generateList, extendList } from '../api/ai';
import ImportModal from '../components/ImportModal';
import ModePicker from '../components/ModePicker';
import ConfirmDialog from '../components/ConfirmDialog';
import ShareDialog from '../components/ShareDialog';
import ChallengeDialog from '../components/ChallengeDialog';
import Flag from '../components/Flag';
import GloAvatar from '../components/GloAvatar';
import AvatarDisplay from '../components/AvatarDisplay';
import Sparkle from '../components/Sparkle';
import { LANG_TO_FLAG } from '../utils/lang';

const LAST_MODE_KEY = 'glosan:lastMode';

function masteryOf(glos) {
  const c = glos.stats?.correct ?? 0;
  const w = glos.stats?.wrong ?? 0;
  const total = c + w;
  if (total === 0) return 'new';
  const ratio = c / total;
  if (ratio >= 0.9 && c >= 3) return 'gold';
  if (ratio >= 0.6) return 'silver';
  if (ratio >= 0.3) return 'bronze';
  return 'new';
}

const MASTERY_COLORS = {
  gold: 'var(--mustard)',
  silver: 'var(--sky)',
  bronze: 'var(--coral)',
  new: 'var(--paper-deep)'
};

function MasteryDot({ level }) {
  return (
    <span
      style={{
        width: 12, height: 12, borderRadius: '50%',
        background: MASTERY_COLORS[level],
        border: '1.5px solid var(--ink)',
        display: 'inline-block'
      }}
    />
  );
}

export default function ListDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { apiFetch } = useAuth();
  const { refresh: refreshGamification } = useGamification();
  const [list, setList] = useState(null);
  const [glosor, setGlosor] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiTopicOpen, setAiTopicOpen] = useState(false);
  const [aiTopic, setAiTopic] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showModePicker, setShowModePicker] = useState(false);
  const [showSwapConfirm, setShowSwapConfirm] = useState(false);
  const [swapBusy, setSwapBusy] = useState(false);
  const [isOwner, setIsOwner] = useState(true);
  const [sharedBy, setSharedBy] = useState(null);
  const [showShare, setShowShare] = useState(false);
  const [showChallenge, setShowChallenge] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [weeklyRecords, setWeeklyRecords] = useState([]);

  const onPickMode = (mode) => {
    try { localStorage.setItem(LAST_MODE_KEY, mode); } catch { /* private mode etc */ }
    setShowModePicker(false);
    if (mode === 'flashcard') navigate(`/lists/${id}/flashcards`);
    else if (mode === 'choice') navigate(`/lists/${id}/quiz?mode=choice`);
    else if (mode === 'galge') navigate(`/lists/${id}/galge`);
    else if (mode === 'ordfall') navigate(`/lists/${id}/ordfall`);
    else navigate(`/lists/${id}/quiz`);
  };

  const lastMode = (() => {
    try { return localStorage.getItem(LAST_MODE_KEY); } catch { return null; }
  })();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchList(apiFetch, id);
      setList(data.list);
      setGlosor(data.glosor);
      setIsOwner(data.isOwner !== false);
      setSharedBy(data.sharedBy || null);
      // Hämta veckans rekord om listan är delad (egen med mottagare, eller
      // jag är mottagare). Annars är leaderboarden bara mig själv — meningslös.
      const hasShares =
        (data.list.sharedWith && data.list.sharedWith.length > 0) ||
        data.isOwner === false;
      if (hasShares) {
        try {
          const wr = await fetchWeeklyRecords(apiFetch, id);
          setWeeklyRecords(wr.records || []);
        } catch (e) {
          console.error('Weekly records fetch failed:', e.message);
        }
      } else {
        setWeeklyRecords([]);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, id]);

  const onLeave = async () => {
    try {
      await leaveSharedList(apiFetch, id);
      navigate('/lists');
    } catch (e) {
      setError(e.message);
      setShowLeaveConfirm(false);
    }
  };

  const onCopy = async () => {
    setCopyBusy(true);
    setError('');
    try {
      const { list: copy } = await copyList(apiFetch, id);
      navigate(`/lists/${copy._id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setCopyBusy(false);
    }
  };

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

  const confirmSwapDirection = async () => {
    setSwapBusy(true);
    setError('');
    try {
      const result = await swapListDirection(apiFetch, id);
      setList(result.list);
      // Reload glosor (they were swapped on the server)
      const fresh = await fetchList(apiFetch, id);
      setGlosor(fresh.glosor);
    } catch (err) {
      setError(err.message);
    } finally {
      setSwapBusy(false);
      setShowSwapConfirm(false);
    }
  };

  const onImportConfirm = async ({ glosor: incoming }) => {
    for (const g of incoming) {
      const glos = await createGlos(apiFetch, id, g);
      setGlosor((cur) => [...cur, glos]);
    }
    setShowImport(false);
    refreshGamification();
  };

  const onAiGenerate = async (e) => {
    e.preventDefault();
    const topic = aiTopic.trim();
    if (!topic) return;
    setAiBusy(true);
    setError('');
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
      setAiTopic('');
      setAiTopicOpen(false);
      refreshGamification();
    } catch (err) {
      setError(err.message);
    } finally {
      setAiBusy(false);
    }
  };

  const onExtendFromList = async () => {
    if (glosor.length === 0) return;
    setAiBusy(true);
    setError('');
    try {
      const suggestions = await extendList(apiFetch, { listId: id, count: 10 });
      for (const s of suggestions) {
        if (!s.source || !s.target) continue;
        const glos = await createGlos(apiFetch, id, { source: s.source, target: s.target, extra: true });
        setGlosor((cur) => [...cur, glos]);
      }
      refreshGamification();
    } catch (err) {
      setError(err.message);
    } finally {
      setAiBusy(false);
    }
  };

  if (loading) return <p className="t-hand muted">Glo letar upp listan…</p>;
  if (!list) return <p>Listan hittades inte.</p>;

  const flag = LANG_TO_FLAG[list.sourceLang];
  const masteredCount = glosor.filter((g) => masteryOf(g) === 'gold').length;
  // Mottagare får också ändra glosor när list.shareMode === 'edit'. Titel,
  // riktning och radering av hela listan är fortfarande bara ägarens.
  const canEdit = isOwner || list.shareMode === 'edit';

  return (
    <div>
      <div className="row" style={{ gap: 6, marginBottom: 14, fontSize: 14 }}>
        <Link to="/lists" className="muted" style={{ textDecoration: 'none', fontWeight: 400 }}>Mina listor</Link>
        <span className="muted">/</span>
        <span style={{ fontWeight: 700 }}>{list.title}</span>
      </div>

      <div className="card card-lg" style={{ marginBottom: 22 }}>
        <div className="row between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div className="grow" style={{ minWidth: 280 }}>
            <div className="row" style={{ gap: 10, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {flag && <Flag code={flag} size="lg" />}
              <span className="pill" style={{ background: 'var(--coral-soft)' }}>
                {list.sourceLang} → {list.targetLang}
              </span>
              {isOwner && (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setShowSwapConfirm(true)}
                  style={{ fontSize: 13, padding: '4px 8px' }}
                  title="Byt källspråk och målspråk; alla glosor vänds också"
                >
                  ↔ byt riktning
                </button>
              )}
              <span className="pill">{glosor.length} glosor</span>
              {list.bestScore?.total > 0 && isOwner && (
                <span className="pill" style={{ background: 'var(--mustard-soft)' }}>
                  ⭐ bästa: {list.bestScore.correct}/{list.bestScore.total}
                </span>
              )}
              {!isOwner && sharedBy && (
                <span className="pill" style={{ background: 'var(--plum-soft)' }}>
                  <AvatarDisplay avatar={sharedBy.avatar} username={sharedBy.username} size={20} />
                  delad av {sharedBy.username}
                  {list.shareMode === 'edit' && (
                    <span style={{ fontSize: 11, marginLeft: 4, fontWeight: 600 }}>· du får ändra</span>
                  )}
                </span>
              )}
            </div>
            <h1 style={{ marginBottom: 6 }}>{list.title}</h1>
            {list.description && (
              <p className="t-hand muted" style={{ fontSize: 17, margin: 0 }}>{list.description}</p>
            )}
            {glosor.length > 0 && (
              <div style={{ marginTop: 18, maxWidth: 520 }}>
                <div className="row between" style={{ marginBottom: 6, fontSize: 13 }}>
                  <span className="t-hand muted">mästrade glosor</span>
                  <span className="t-hand">{masteredCount} / {glosor.length}</span>
                </div>
                <div className="bar-shell" style={{ display: 'flex', gap: 2, padding: 0 }}>
                  {glosor.map((g) => (
                    <div
                      key={g._id}
                      style={{ flex: 1, background: MASTERY_COLORS[masteryOf(g)] }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="list-actions">
            {isOwner && (
              <button
                className="btn"
                onClick={() => setShowShare(true)}
                title="Dela listan med en kompis"
              >
                Dela med kompis
              </button>
            )}
            <button
              className="btn"
              onClick={() => setShowChallenge(true)}
              disabled={glosor.length === 0}
              title={glosor.length === 0 ? 'Lägg till glosor först' : 'Utmana en kompis till en duell'}
              style={{ background: 'var(--berry-soft)' }}
            >
              ⚔️ Utmana
            </button>
            {!isOwner && (
              <>
                <button
                  className="btn"
                  onClick={onCopy}
                  disabled={copyBusy}
                  title="Skapa en egen kopia som du äger och kan ändra fritt"
                >
                  {copyBusy ? 'Kopierar…' : 'Kopiera till mina'}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setShowLeaveConfirm(true)}
                  style={{ color: 'var(--berry-deep)' }}
                >
                  Lämna listan
                </button>
              </>
            )}
            <button
              className="btn btn-primary btn-lg list-action-primary"
              onClick={() => setShowModePicker(true)}
              disabled={glosor.length === 0}
            >
              Starta öva →
            </button>
          </div>
        </div>
      </div>

      {weeklyRecords.length > 0 && (
        <div className="card" style={{ marginBottom: 22, background: 'var(--sky-soft)' }}>
          <div className="row between" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>📅 Veckans rekord</h3>
            <span className="t-hand muted" style={{ fontSize: 13 }}>
              bästa rond per spelare denna vecka
            </span>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {weeklyRecords.map((r, i) => {
              const medal = i < 3 ? ['🥇', '🥈', '🥉'][i] : `#${i + 1}`;
              const pct = Math.round(r.bestRatio * 100);
              return (
                <div
                  key={r._id}
                  className="row"
                  style={{
                    gap: 12,
                    padding: '8px 12px',
                    background: r.isMe ? 'var(--paper-deep)' : 'var(--bg-elev)',
                    border: '1.5px solid var(--ink)',
                    borderRadius: 10,
                    alignItems: 'center'
                  }}
                >
                  <span style={{ width: 28, fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 16, textAlign: 'center' }}>
                    {medal}
                  </span>
                  <AvatarDisplay avatar={r.avatar} username={r.username} size={32} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 15 }}>{r.username}</strong>
                      {r.isMe && <span className="t-hand muted" style={{ fontSize: 12 }}>(du)</span>}
                      {r.isOwner && <span className="pill" style={{ fontSize: 11, background: 'var(--mustard-soft)' }}>ägare</span>}
                    </div>
                    <p className="t-hand muted" style={{ fontSize: 12, margin: '2px 0 0' }}>
                      {r.runs} {r.runs === 1 ? 'rond' : 'ronder'} denna vecka
                    </p>
                  </div>
                  <span className="pill" style={{ background: 'var(--leaf-soft)' }}>
                    {r.bestCorrect} / {r.bestTotal} · {pct}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="detail-grid">
        <div>
          <h3 style={{ margin: '0 0 10px' }}>Glosor</h3>

          {canEdit && (
            <div className="card" style={{ padding: 12, marginBottom: 14 }}>
              <form onSubmit={onAdd} className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input className="inp" name="source" placeholder={list.sourceLang} required style={{ flex: 1, minWidth: 120 }} />
                <span className="t-hand muted" style={{ fontSize: 18 }}>→</span>
                <input className="inp" name="target" placeholder={list.targetLang} required style={{ flex: 1, minWidth: 120 }} />
                <input className="inp" name="notes" placeholder="anteckning (valfri)" style={{ flex: 1.4, minWidth: 140 }} />
                <button type="submit" className="btn btn-primary">Lägg till</button>
              </form>
            </div>
          )}

          {error && <p className="error" style={{ marginBottom: 12 }}>{error}</p>}

          {glosor.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 32 }}>
              <p className="t-hand muted" style={{ fontSize: 16 }}>
                Inga glosor än. Lägg till några ovan eller låt Glo föreslå.
              </p>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table className="glos-table">
                <thead>
                  <tr>
                    <th style={{ width: 24 }}></th>
                    <th>{list.sourceLang}</th>
                    <th>{list.targetLang}</th>
                    <th style={{ width: 60, textAlign: 'right' }}>rätt</th>
                    <th style={{ width: 60, textAlign: 'right' }}>fel</th>
                    <th style={{ width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {glosor.map((g) => (
                    <tr key={g._id} style={g.extra ? { background: 'var(--mustard-soft)' } : undefined}>
                      <td><MasteryDot level={masteryOf(g)} /></td>
                      <td style={{ fontWeight: 700 }}>
                        {g.extra && (
                          <img
                            src="/assets/star-sticker.svg"
                            width="14"
                            height="14"
                            alt=""
                            title="Extra-glosa — inte läxa"
                            style={{ verticalAlign: 'middle', marginRight: 6 }}
                          />
                        )}
                        {g.source}
                        {g.notes && (
                          <span className="t-hand muted" style={{ fontSize: 13, marginLeft: 6 }}>· {g.notes}</span>
                        )}
                      </td>
                      <td>{g.target}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="stat-good">{g.stats?.correct ?? 0}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="stat-bad">{g.stats?.wrong ?? 0}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {canEdit && (
                          <button
                            className="btn btn-sm btn-ghost"
                            style={{ color: 'var(--berry-deep)', padding: '4px 8px' }}
                            onClick={() => onDelete(g._id)}
                          >
                            Radera
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {glosor.length > 0 && (
            <div className="row" style={{ gap: 14, marginTop: 10, fontSize: 13, flexWrap: 'wrap' }}>
              <span className="row" style={{ gap: 6 }}><MasteryDot level="gold" /> <span className="muted">mästrad</span></span>
              <span className="row" style={{ gap: 6 }}><MasteryDot level="silver" /> <span className="muted">säker</span></span>
              <span className="row" style={{ gap: 6 }}><MasteryDot level="bronze" /> <span className="muted">repetera</span></span>
              <span className="row" style={{ gap: 6 }}><MasteryDot level="new" /> <span className="muted">ny</span></span>
            </div>
          )}
        </div>

        {isOwner && (
        <div className="card card-lg" style={{ background: 'var(--plum-soft)', alignSelf: 'flex-start', position: 'sticky', top: 24 }}>
          <div className="row" style={{ gap: 10, marginBottom: 10 }}>
            <GloAvatar size={48} mood="wink" tilt={-6} />
            <div>
              <h3 style={{ margin: 0, fontSize: 22 }}>Glo hjälper</h3>
              <span className="t-hand muted" style={{ fontSize: 15 }}>AI · Claude Haiku</span>
            </div>
          </div>
          <p style={{ fontSize: 15, margin: '0 0 14px', color: 'var(--ink-soft)' }}>
            Be om fler glosor eller importera färdig text.
          </p>

          <div className="stack" style={{ gap: 10 }}>
            {aiTopicOpen ? (
              <form onSubmit={onAiGenerate} className="stack" style={{ gap: 8 }}>
                <label className="field">
                  <span className="field-label">Vad ska Glo generera glosor om?</span>
                  <input
                    className="inp"
                    value={aiTopic}
                    onChange={(e) => setAiTopic(e.target.value)}
                    placeholder='t.ex. "frukter", "rumsverb i preteritum"'
                    autoFocus
                    disabled={aiBusy}
                    style={{ boxShadow: 'none', padding: '10px 14px' }}
                  />
                </label>
                <div className="row" style={{ gap: 8 }}>
                  <button type="submit" className="btn btn-sm btn-primary" disabled={aiBusy || !aiTopic.trim()}>
                    {aiBusy ? 'Glo tänker…' : 'Generera →'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => { setAiTopicOpen(false); setAiTopic(''); }}
                    disabled={aiBusy}
                  >
                    Avbryt
                  </button>
                </div>
              </form>
            ) : (
              <button
                className="btn btn-block"
                style={{ background: 'var(--bg-elev)', justifyContent: 'flex-start' }}
                onClick={() => setAiTopicOpen(true)}
              >
                <Sparkle size={14} color="var(--plum)" />
                Generera 10 fler glosor
              </button>
            )}
            <button
              className="btn btn-block"
              style={{ background: 'var(--bg-elev)', justifyContent: 'flex-start' }}
              onClick={onExtendFromList}
              disabled={aiBusy || glosor.length === 0}
              title={glosor.length === 0 ? 'Lägg till minst en glosa först så Glo kan gissa tema' : ''}
            >
              <Sparkle size={14} color="var(--plum)" />
              {aiBusy ? 'Glo tänker…' : 'Föreslå fler i samma ämne'}
            </button>
            <button
              className="btn btn-block"
              style={{ background: 'var(--bg-elev)', justifyContent: 'flex-start' }}
              onClick={() => setShowImport(true)}
            >
              <Sparkle size={14} color="var(--plum)" />
              Importera fler från text
            </button>
          </div>
        </div>
        )}
      </div>

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

      {showModePicker && (
        <ModePicker
          lastMode={lastMode}
          onClose={() => setShowModePicker(false)}
          onSelect={onPickMode}
        />
      )}

      {showSwapConfirm && (
        <ConfirmDialog
          title="Byt riktning på listan?"
          message={`Källspråk och målspråk byter plats (${list.sourceLang} ↔ ${list.targetLang}), och alla ${glosor.length} glosor vänds. Quizen fortsätter visa samma språk som tidigare.`}
          confirmLabel={swapBusy ? 'Vänder…' : 'Byt riktning'}
          onConfirm={confirmSwapDirection}
          onCancel={() => !swapBusy && setShowSwapConfirm(false)}
        />
      )}

      {showShare && (
        <ShareDialog
          listId={id}
          listTitle={list.title}
          initialMode={list.shareMode || 'read'}
          onClose={() => setShowShare(false)}
          onChanged={load}
        />
      )}

      {showChallenge && (
        <ChallengeDialog
          listId={id}
          listTitle={list.title}
          onClose={() => setShowChallenge(false)}
        />
      )}

      {showLeaveConfirm && (
        <ConfirmDialog
          title="Lämna den delade listan?"
          message={`${sharedBy?.username || 'Ägaren'} kan fortfarande dela listan med dig igen senare. Du tappar ingen XP du tjänat från quizen.`}
          confirmLabel="Lämna"
          destructive
          onConfirm={onLeave}
          onCancel={() => setShowLeaveConfirm(false)}
        />
      )}
    </div>
  );
}
