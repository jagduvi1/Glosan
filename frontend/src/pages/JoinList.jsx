import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import GloAvatar from '../components/GloAvatar';
import Flag from '../components/Flag';
import { useAuth } from '../contexts/AuthContext';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import { fetchInvitePreview, acceptListInvite } from '../api/listInvites';
import { LANG_TO_FLAG } from '../utils/lang';

export default function JoinList() {
  useDocumentTitle('Acceptera lista');
  const { code } = useParams();
  const navigate = useNavigate();
  const { user, apiFetch } = useAuth();
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | preview | accepted | error
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState(false);
  const triedRef = useRef(false);

  useEffect(() => {
    fetchInvitePreview(code)
      .then((data) => {
        setPreview(data);
        setStatus('preview');
      })
      .catch((err) => {
        setError(err.message);
        setStatus('error');
      });
  }, [code]);

  const onAccept = async () => {
    if (!user) {
      // Spara koden så Register/Login kan acceptera efteråt
      try { sessionStorage.setItem('pending-invite', code); } catch { /* ignore */ }
      navigate(`/register?invite=${code}`);
      return;
    }
    if (triedRef.current) return;
    triedRef.current = true;
    setAccepting(true);
    try {
      const result = await acceptListInvite(apiFetch, code);
      setStatus('accepted');
      setTimeout(() => navigate(`/lists/${result.listId}`), 1500);
    } catch (err) {
      setError(err.message);
      setStatus('error');
      triedRef.current = false;
    } finally {
      setAccepting(false);
    }
  };

  // Auto-accepta om redan inloggad och har stale invite från registreringen
  useEffect(() => {
    if (status !== 'preview' || !user || triedRef.current) return;
    const pending = (() => {
      try { return sessionStorage.getItem('pending-invite'); } catch { return null; }
    })();
    if (pending === code) {
      try { sessionStorage.removeItem('pending-invite'); } catch { /* ignore */ }
      onAccept();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, user]);

  return (
    <div className="paper-texture" style={{ minHeight: '100vh' }}>
      <Helmet>
        <title>Acceptera delad lista — Glosan</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className="card card-lg" style={{ maxWidth: 540, margin: '60px auto' }}>
        {status === 'loading' && <p className="t-hand muted">Laddar inbjudan…</p>}

        {status === 'error' && (
          <div style={{ textAlign: 'center' }}>
            <GloAvatar size={120} float mood="sad" style={{ margin: '0 auto 14px' }} />
            <h1>Hoppsan</h1>
            <p className="t-hand muted" style={{ marginBottom: 22 }}>
              {error || 'Den här länken funkar inte längre.'}
            </p>
            <Link to={user ? '/lists' : '/'}><button className="btn btn-primary">Tillbaka</button></Link>
          </div>
        )}

        {status === 'accepted' && (
          <div style={{ textAlign: 'center' }}>
            <GloAvatar size={120} float mood="wink" style={{ margin: '0 auto 14px' }} />
            <h1>Klart! Listan är din.</h1>
            <p className="t-hand muted">Skickar dig till listan…</p>
          </div>
        )}

        {status === 'preview' && preview && (
          <>
            <div className="row" style={{ gap: 14, alignItems: 'center', marginBottom: 18 }}>
              <GloAvatar size={72} float mood="wink" />
              <div>
                <p className="t-hand muted" style={{ margin: 0, fontSize: 15 }}>
                  <strong>@{preview.creator.username}</strong> vill dela en lista med dig
                </p>
                <h1 style={{ margin: '4px 0 0' }}>{preview.list.title}</h1>
              </div>
            </div>

            <div className="card" style={{ background: 'var(--paper-deep)', marginBottom: 18 }}>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                {LANG_TO_FLAG[preview.list.sourceLang] && <Flag code={LANG_TO_FLAG[preview.list.sourceLang]} />}
                <span className="pill">{preview.list.sourceLang} → {preview.list.targetLang}</span>
                <span className="pill" style={{ background: 'var(--mustard-soft)' }}>
                  {preview.list.glosCount} glosor
                </span>
              </div>
              {preview.list.description && (
                <p style={{ margin: '8px 0 0', fontSize: 15 }}>{preview.list.description}</p>
              )}
            </div>

            {user ? (
              <>
                <p className="t-hand muted" style={{ fontSize: 14, marginBottom: 14 }}>
                  En kopia av listan läggs till på ditt konto. Du och @{preview.creator.username} blir vänner.
                </p>
                <button className="btn btn-primary btn-lg btn-block" onClick={onAccept} disabled={accepting}>
                  {accepting ? 'Lägger till…' : `Acceptera och spara på mitt konto`}
                </button>
              </>
            ) : (
              <>
                <p className="t-hand muted" style={{ fontSize: 14, marginBottom: 14 }}>
                  Registrera ett konto (eller logga in) så får du listan kopierad till dig och blir vän med @{preview.creator.username}.
                </p>
                <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <Link to={`/register?invite=${code}`} style={{ flex: 1, textDecoration: 'none' }}>
                    <button className="btn btn-primary btn-block">Skapa konto</button>
                  </Link>
                  <Link to={`/login?invite=${code}`} style={{ flex: 1, textDecoration: 'none' }}>
                    <button className="btn btn-block">Jag har konto</button>
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
