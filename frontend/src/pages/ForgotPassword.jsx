import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import GloAvatar from '../components/GloAvatar';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import { forgotPassword } from '../api/email';

export default function ForgotPassword() {
  useDocumentTitle('Glömt lösenord');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="paper-texture" style={{ minHeight: '100vh' }}>
      <Helmet>
        <title>Glömt lösenord — Glosan</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className="card card-lg" style={{ maxWidth: 460, margin: '80px auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <GloAvatar size={96} float />
        </div>
        {sent ? (
          <>
            <h1 style={{ marginBottom: 8, textAlign: 'center' }}>Kolla din mail</h1>
            <p className="t-hand muted" style={{ textAlign: 'center', marginBottom: 22 }}>
              Om kontot finns har vi just skickat en återställningslänk till {email}.
              Länken är giltig i 60 minuter.
            </p>
            <div style={{ textAlign: 'center' }}>
              <Link to="/login"><button className="btn">Tillbaka till login</button></Link>
            </div>
          </>
        ) : (
          <>
            <h1 style={{ marginBottom: 8, textAlign: 'center' }}>Glömt lösenord?</h1>
            <p className="t-hand muted" style={{ textAlign: 'center', marginBottom: 22 }}>
              Skriv in din email så skickar Glo en återställningslänk.
            </p>
            <form onSubmit={onSubmit} className="stack">
              <label className="field">
                <span className="field-label">Email</span>
                <input
                  className="inp"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  autoFocus
                />
              </label>
              {error && <p className="error">{error}</p>}
              <button className="btn btn-primary btn-block" disabled={busy || !email}>
                {busy ? 'Skickar…' : 'Skicka återställningslänk'}
              </button>
            </form>
            <p className="t-hand muted" style={{ textAlign: 'center', marginTop: 18, fontSize: 14 }}>
              Kommer du på lösenordet? <Link to="/login">Logga in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
