import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import GloAvatar from '../components/GloAvatar';
import { useAuth } from '../contexts/AuthContext';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import { requestMagicLink, consumeMagicLink } from '../api/email';

// Den här sidan har två lägen:
// 1. Med ?token=... — konsumera token och logga in
// 2. Utan token — visa formulär för att be om en magic-link
export default function MagicLink() {
  useDocumentTitle('Logga in med länk');
  const navigate = useNavigate();
  const { applyExternalToken } = useAuth();
  const [params] = useSearchParams();
  const token = params.get('token');
  const triedRef = useRef(false);

  const [status, setStatus] = useState(token ? 'consuming' : 'form');
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!token || triedRef.current) return;
    triedRef.current = true;
    if (!applyExternalToken) {
      setError('Inloggning misslyckades — auth-kontext saknas. Ladda om sidan.');
      setStatus('bad');
      return;
    }
    consumeMagicLink(token)
      .then(({ token: accessToken, user }) => {
        applyExternalToken(accessToken, user);
        navigate('/lists', { replace: true });
      })
      .catch((err) => {
        setError(err.message);
        setStatus('bad');
      });
  }, [token, navigate, applyExternalToken]);

  const onRequest = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await requestMagicLink(email.trim());
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
        <title>Logga in med länk — Glosan</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className="card card-lg" style={{ maxWidth: 460, margin: '80px auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <GloAvatar size={96} float mood={status === 'bad' ? 'sad' : 'default'} />
        </div>
        {status === 'consuming' && (
          <>
            <h1 style={{ textAlign: 'center', marginBottom: 8 }}>Loggar in …</h1>
            <p className="t-hand muted" style={{ textAlign: 'center' }}>Glo verifierar länken.</p>
          </>
        )}
        {status === 'bad' && (
          <>
            <h1 style={{ textAlign: 'center', marginBottom: 8 }}>Länken funkar inte</h1>
            <p className="t-hand muted" style={{ textAlign: 'center', marginBottom: 22 }}>
              {error || 'Länken kan vara förbrukad eller utgått (15 min). Begär en ny nedan.'}
            </p>
            <div style={{ textAlign: 'center' }}>
              <Link to="/magic-link"><button className="btn btn-primary">Begär ny länk</button></Link>
            </div>
          </>
        )}
        {status === 'form' && (
          sent ? (
            <>
              <h1 style={{ textAlign: 'center', marginBottom: 8 }}>Kolla din mail</h1>
              <p className="t-hand muted" style={{ textAlign: 'center', marginBottom: 22 }}>
                Om kontot finns har vi precis skickat en inloggningslänk till {email}. Länken är giltig i 15 minuter.
              </p>
              <div style={{ textAlign: 'center' }}>
                <Link to="/login"><button className="btn">Tillbaka till login</button></Link>
              </div>
            </>
          ) : (
            <>
              <h1 style={{ textAlign: 'center', marginBottom: 8 }}>Logga in utan lösenord</h1>
              <p className="t-hand muted" style={{ textAlign: 'center', marginBottom: 22 }}>
                Skriv in din email så skickar Glo en magisk länk som loggar in dig direkt.
              </p>
              <form onSubmit={onRequest} className="stack">
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
                  {busy ? 'Skickar…' : 'Skicka inloggningslänk'}
                </button>
              </form>
              <p className="t-hand muted" style={{ textAlign: 'center', marginTop: 18, fontSize: 14 }}>
                Föredrar lösenord? <Link to="/login">Logga in vanligt</Link>
              </p>
            </>
          )
        )}
      </div>
    </div>
  );
}
