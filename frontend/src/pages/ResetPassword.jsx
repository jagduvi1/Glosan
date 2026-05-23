import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import GloAvatar from '../components/GloAvatar';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import { resetPassword } from '../api/email';

export default function ResetPassword() {
  useDocumentTitle('Återställ lösenord');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Lösenorden matchar inte.');
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="paper-texture" style={{ minHeight: '100vh' }}>
        <div className="card card-lg" style={{ maxWidth: 460, margin: '80px auto', textAlign: 'center' }}>
          <GloAvatar size={96} float mood="sad" style={{ margin: '0 auto 14px' }} />
          <h1 style={{ marginBottom: 8 }}>Saknar token</h1>
          <p className="t-hand muted">Öppna länken från ditt återställningsmail för att fortsätta.</p>
          <Link to="/login" style={{ display: 'inline-block', marginTop: 18 }}><button className="btn">Tillbaka</button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="paper-texture" style={{ minHeight: '100vh' }}>
      <Helmet>
        <title>Återställ lösenord — Glosan</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className="card card-lg" style={{ maxWidth: 460, margin: '80px auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <GloAvatar size={96} float mood={done ? 'wink' : 'default'} />
        </div>
        {done ? (
          <>
            <h1 style={{ marginBottom: 8, textAlign: 'center' }}>Klart!</h1>
            <p className="t-hand muted" style={{ textAlign: 'center' }}>
              Ditt lösenord är uppdaterat. Vi skickar dig till login om ett ögonblick …
            </p>
          </>
        ) : (
          <>
            <h1 style={{ marginBottom: 8, textAlign: 'center' }}>Välj nytt lösenord</h1>
            <p className="t-hand muted" style={{ textAlign: 'center', marginBottom: 22 }}>
              Minst 10 tecken med en stor bokstav, liten bokstav och en siffra.
            </p>
            <form onSubmit={onSubmit} className="stack">
              <label className="field">
                <span className="field-label">Nytt lösenord</span>
                <input
                  className="inp"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={10}
                  autoFocus
                  autoComplete="new-password"
                />
              </label>
              <label className="field">
                <span className="field-label">Bekräfta lösenord</span>
                <input
                  className="inp"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={10}
                  autoComplete="new-password"
                />
              </label>
              {error && <p className="error">{error}</p>}
              <button className="btn btn-primary btn-block" disabled={busy || !password}>
                {busy ? 'Uppdaterar…' : 'Spara nytt lösenord'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
