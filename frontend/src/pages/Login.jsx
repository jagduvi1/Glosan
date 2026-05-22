import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../contexts/AuthContext';
import GloAvatar from '../components/GloAvatar';
import { useDocumentTitle } from '../utils/useDocumentTitle';

export default function Login() {
  useDocumentTitle('Logga in');
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const result = await login(username, password);
    setBusy(false);
    if (result.success) navigate('/lists');
    else setError(result.error);
  };

  return (
    <div className="paper-texture" style={{ minHeight: '100vh' }}>
      <Helmet>
        <title>Logga in — Glosan</title>
        <meta name="description" content="Logga in på Glosan och fortsätt öva dina glosor, samla XP och utmana kompisar i live-dueller." />
        <link rel="canonical" href="https://glosan.app/login" />
      </Helmet>
      <nav className="navbar" style={{ background: 'transparent', borderBottom: 'none' }}>
        <div className="nav-inner">
          <img src="/assets/logo-wordmark.svg" height={44} alt="Glosan" />
          <div className="row" style={{ gap: 12 }}>
            <span className="muted t-hand" style={{ fontSize: 16 }}>Nytt här?</span>
            <Link to="/register" className="btn btn-sm">Skapa konto</Link>
          </div>
        </div>
      </nav>

      <div className="auth-grid">
        <div style={{ position: 'relative', textAlign: 'center' }}>
          <div className="card card-lg" style={{ background: 'var(--mustard-soft)', transform: 'rotate(-3deg)', padding: 40 }}>
            <div className="t-hand" style={{ fontSize: 22, color: 'var(--ink-soft)' }}>Glo har skissat —</div>
            <div style={{ fontFamily: 'var(--font-headline)', fontSize: 52, lineHeight: 1.05, margin: '4px 0' }}>
              dina <span className="mark-highlight">ord</span> väntar.
            </div>
            <p className="t-hand" style={{ fontSize: 19, margin: '12px 0 0', color: 'var(--ink-soft)' }}>
              Logga in och kör vidare där du slutade.
            </p>
          </div>
          <div style={{ position: 'absolute', right: -20, bottom: -50, zIndex: 2 }}>
            <GloAvatar size={150} float tilt={-6} />
          </div>
          <img src="/assets/flame-streak.svg" width="56" alt="" style={{ position: 'absolute', left: -16, top: -28, transform: 'rotate(-12deg)' }} />
        </div>

        <form className="card card-lg" onSubmit={onSubmit} style={{ padding: 36 }}>
          <h1 style={{ fontSize: 38, marginBottom: 4 }}>Välkommen tillbaka</h1>
          <p className="t-hand muted" style={{ fontSize: 18, margin: '0 0 24px' }}>Logga in och kör vidare.</p>

          <label className="field" style={{ marginBottom: 16 }}>
            <span className="field-label">Användarnamn eller e-post</span>
            <input className="inp" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
          </label>
          <label className="field" style={{ marginBottom: 22 }}>
            <span className="field-label">Lösenord</span>
            <input className="inp" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>

          {error && <p className="error" style={{ marginBottom: 16 }}>{error}</p>}

          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
            {busy ? 'Loggar in…' : 'Logga in →'}
          </button>

          <p className="t-hand muted" style={{ marginTop: 20, fontSize: 15, textAlign: 'center' }}>
            Inget konto? <Link to="/register">Skapa ett här →</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
