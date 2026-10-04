import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import GloAvatar from '../components/GloAvatar';
import { useAuth } from '../contexts/AuthContext';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import { fetchStudyInvitePreview, acceptStudyInvite } from '../api/study';

// /p/<kod> — någon delar ett eller flera områden i Plugga (QR-koden i "Dela",
// t.ex. ett helt kapitel). Publik förhandsvisning; den som går med får en egen
// kopia (har hen redan en: det nya) och får Plugga påslaget. Inte inloggad →
// skapa konto/logga in och kom tillbaka hit, då går man med automatiskt.

const PENDING_KEY = 'pending-study-invite';

export default function JoinStudyUnit() {
  useDocumentTitle('Gå med i ett område');
  const { code } = useParams();
  const navigate = useNavigate();
  const { user, apiFetch, refreshUser } = useAuth();
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | preview | joined | error
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);
  const tried = useRef(false);
  // Inloggad hämtas förhandsvisningen med inloggningen: då visas bara det man
  // faktiskt får. Hämtas om när man loggat in (samma id → ingen ny hämtning).
  const userId = user?._id || user?.id || null;

  useEffect(() => {
    let alive = true;
    fetchStudyInvitePreview(code, userId ? apiFetch : null)
      .then((data) => {
        if (!alive) return;
        setPreview(data);
        setStatus((s) => (s === 'joined' ? s : 'preview'));
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message);
        setStatus((s) => (s === 'joined' ? s : 'error'));
      });
    return () => { alive = false; };
  }, [code, userId, apiFetch]);

  // Vidarebefordran efter "Du är med!" — städas om sidan lämnas innan dess.
  const redirectTimer = useRef(null);
  useEffect(() => () => clearTimeout(redirectTimer.current), []);

  const join = useCallback(async () => {
    if (tried.current) return;
    tried.current = true;
    setJoining(true);
    try {
      const r = await acceptStudyInvite(apiFetch, code);
      await refreshUser(); // Plugga-flaggan kan just ha slagits på
      setStatus('joined');
      // Flera områden: till ämnessidan om alla hör till samma ämne (den visar
      // alla terminer), annars till Plugga.
      const subjects = [...new Set((preview?.units || []).map((x) => x.subject))];
      const target = r.unitIds && r.unitIds.length > 1
        ? (subjects.length === 1 ? `/plugga/amne/${subjects[0]}` : '/plugga')
        : `/plugga/omrade/${r.unitId}`;
      redirectTimer.current = setTimeout(() => navigate(target), 1200);
    } catch (e) {
      setError(e.message);
      setStatus('error');
      tried.current = false;
    } finally {
      setJoining(false);
    }
  }, [apiFetch, code, navigate, refreshUser, preview]);

  const rememberInvite = () => {
    try { sessionStorage.setItem(PENDING_KEY, code); } catch { /* privat läge — man får klicka en gång till */ }
  };

  // Tillbaka från registrering/inloggning → gå med direkt.
  useEffect(() => {
    if (status !== 'preview' || !user) return;
    let pending = null;
    try { pending = sessionStorage.getItem(PENDING_KEY); } catch { /* ignore */ }
    if (pending === code) {
      try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
      join();
    }
  }, [status, user, code, join]);

  const units = preview?.units || (preview?.unit ? [preview.unit] : []);
  const u = units[0];
  const multi = units.length > 1;
  const countText = (x) => [
    x.pages ? `${x.pages} ${x.pages === 1 ? 'genomgång' : 'genomgångar'}` : null,
    `${x.cards} kort`,
    `${x.exercises} övningar`
  ].filter(Boolean).join(' · ');

  return (
    <div className="paper-texture" style={{ minHeight: '100vh', padding: '0 16px' }}>
      <Helmet>
        <title>Gå med i ett område — Glosan</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className="card card-lg" style={{ maxWidth: 540, margin: '60px auto' }}>
        {status === 'loading' && <p className="t-hand muted">Laddar…</p>}

        {status === 'error' && (
          <div style={{ textAlign: 'center' }}>
            <GloAvatar size={110} float mood="sad" style={{ margin: '0 auto 14px' }} />
            <h1>Hoppsan</h1>
            <p className="t-hand muted" style={{ marginBottom: 22 }}>{error || 'Den här länken fungerar inte längre.'}</p>
            <Link to={user ? '/lists' : '/'} className="btn btn-primary">Tillbaka</Link>
          </div>
        )}

        {status === 'joined' && (
          <div style={{ textAlign: 'center' }}>
            <GloAvatar size={110} float mood="wink" style={{ margin: '0 auto 14px' }} />
            <h1>Klart!</h1>
            <p className="t-hand muted">{multi ? 'Områdena finns' : 'Området finns'} nu i din Plugga. Skickar dig dit…</p>
          </div>
        )}

        {status === 'preview' && u && (
          <>
            <div className="row" style={{ gap: 14, alignItems: 'center', marginBottom: 18 }}>
              <GloAvatar size={68} float mood="wink" />
              <div>
                <p className="t-hand muted" style={{ margin: 0, fontSize: 15 }}>
                  <strong>@{preview.creator.username}</strong> delar {multi ? `${units.length} områden` : 'ett område'} med dig
                </p>
                <h1 style={{ margin: '4px 0 0', fontSize: 30 }}>
                  {multi
                    ? (preview.title || `${units.length} områden`)
                    : <><span aria-hidden="true">{u.emoji}</span> {preview.title || u.title}</>}
                </h1>
              </div>
            </div>

            {multi ? (
              <div className="stack" style={{ gap: 8, marginBottom: 18, maxHeight: 320, overflowY: 'auto' }}>
                {units.map((x) => (
                  <div key={x.code} className="card" style={{ background: 'var(--paper-deep)', padding: 12 }}>
                    <strong><span aria-hidden="true">{x.emoji}</span> {x.code} {x.title}</strong>
                    <p className="t-hand muted" style={{ margin: '2px 0 0', fontSize: 14 }}>{x.subjectLabel} · {x.termLabel} · {countText(x)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="card" style={{ background: 'var(--paper-deep)', marginBottom: 18 }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span className="pill">{u.subjectLabel}</span>
                  <span className="pill">{u.termLabel}</span>
                </div>
                {preview.title && preview.title !== u.title && <p style={{ margin: '10px 0 0', fontWeight: 700 }}>{u.title}</p>}
                <p className="t-hand" style={{ margin: '10px 0 0', fontSize: 16 }}>{countText(u)}</p>
              </div>
            )}

            {user ? (
              <>
                <p className="t-hand muted" style={{ fontSize: 14, marginBottom: 14 }}>
                  Du får en egen kopia: du övar med din egen statistik och kan ta bort det du inte vill ha. Har du redan en kopia får du bara det nya.
                </p>
                <button type="button" className="btn btn-primary btn-lg btn-block" onClick={join} disabled={joining}>
                  {joining ? 'Lägger till…' : multi ? `Lägg till alla ${units.length} i min Plugga` : 'Lägg till i min Plugga'}
                </button>
              </>
            ) : (
              <>
                <p className="t-hand muted" style={{ fontSize: 14, marginBottom: 14 }}>
                  Skapa ett konto (eller logga in) så får du {multi ? 'områdena' : 'området'} i Glosan som en egen kopia — ingen egen AI behövs.
                </p>
                <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <Link to={`/register?studyInvite=${code}`} onClick={rememberInvite} className="btn btn-primary" style={{ flex: 1, textAlign: 'center' }}>
                    Skapa konto
                  </Link>
                  <Link to={`/login?studyInvite=${code}`} onClick={rememberInvite} className="btn" style={{ flex: 1, textAlign: 'center' }}>
                    Jag har konto
                  </Link>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
