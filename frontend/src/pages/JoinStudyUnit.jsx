import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import GloAvatar from '../components/GloAvatar';
import { useAuth } from '../contexts/AuthContext';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import { fetchStudyInvitePreview, acceptStudyInvite } from '../api/study';

// /p/<kod> — någon delar ett område i Plugga (QR-koden i "Dela"). Publik
// förhandsvisning; den som går med läggs till i området (ingen kopia) och
// får Plugga påslaget. Inte inloggad → skapa konto/logga in och kom tillbaka
// hit, då går man med automatiskt.

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

  useEffect(() => {
    fetchStudyInvitePreview(code)
      .then((data) => { setPreview(data); setStatus('preview'); })
      .catch((e) => { setError(e.message); setStatus('error'); });
  }, [code]);

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
      redirectTimer.current = setTimeout(() => navigate(`/plugga/omrade/${r.unitId}`), 1200);
    } catch (e) {
      setError(e.message);
      setStatus('error');
      tried.current = false;
    } finally {
      setJoining(false);
    }
  }, [apiFetch, code, navigate, refreshUser]);

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

  const u = preview?.unit;

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
            <p className="t-hand muted">Området finns nu i din Plugga. Skickar dig dit…</p>
          </div>
        )}

        {status === 'preview' && u && (
          <>
            <div className="row" style={{ gap: 14, alignItems: 'center', marginBottom: 18 }}>
              <GloAvatar size={68} float mood="wink" />
              <div>
                <p className="t-hand muted" style={{ margin: 0, fontSize: 15 }}>
                  <strong>@{preview.creator.username}</strong> delar ett område med dig
                </p>
                <h1 style={{ margin: '4px 0 0', fontSize: 30 }}>
                  <span aria-hidden="true">{u.emoji}</span> {u.title}
                </h1>
              </div>
            </div>

            <div className="card" style={{ background: 'var(--paper-deep)', marginBottom: 18 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="pill">{u.subjectLabel}</span>
                <span className="pill">{u.termLabel}</span>
              </div>
              <p className="t-hand" style={{ margin: '10px 0 0', fontSize: 16 }}>
                {[
                  u.pages ? `${u.pages} ${u.pages === 1 ? 'genomgång' : 'genomgångar'}` : null,
                  `${u.cards} kort`,
                  `${u.exercises} övningar`
                ].filter(Boolean).join(' · ')}
              </p>
            </div>

            {user ? (
              <>
                <p className="t-hand muted" style={{ fontSize: 14, marginBottom: 14 }}>
                  Du övar med din egen statistik. Rättar @{preview.creator.username} något ser du det direkt.
                </p>
                <button type="button" className="btn btn-primary btn-lg btn-block" onClick={join} disabled={joining}>
                  {joining ? 'Lägger till…' : 'Lägg till i min Plugga'}
                </button>
              </>
            ) : (
              <>
                <p className="t-hand muted" style={{ fontSize: 14, marginBottom: 14 }}>
                  Skapa ett konto (eller logga in) så får du området i Glosan — ingen egen AI behövs.
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
