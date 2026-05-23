import { useEffect, useState, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import GloAvatar from '../components/GloAvatar';
import { useAuth } from '../contexts/AuthContext';
import { verifyEmail } from '../api/email';
import { useDocumentTitle } from '../utils/useDocumentTitle';

export default function VerifyEmail() {
  useDocumentTitle('Bekräfta email');
  const { apiFetch } = useAuth();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [status, setStatus] = useState(token ? 'loading' : 'missing'); // loading | ok | bad | missing
  const [error, setError] = useState('');
  const triedRef = useRef(false);

  useEffect(() => {
    if (!token || triedRef.current) return;
    triedRef.current = true;
    verifyEmail(apiFetch, token)
      .then(() => setStatus('ok'))
      .catch((err) => {
        setError(err.message);
        setStatus('bad');
      });
  }, [token, apiFetch]);

  return (
    <div className="paper-texture" style={{ minHeight: '100vh' }}>
      <Helmet>
        <title>Bekräfta email — Glosan</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className="card card-lg" style={{ maxWidth: 520, margin: '80px auto', textAlign: 'center' }}>
        <GloAvatar
          size={120}
          float
          mood={status === 'ok' ? 'wink' : status === 'bad' ? 'sad' : 'default'}
          style={{ margin: '0 auto 16px' }}
        />
        {status === 'loading' && (
          <>
            <h1 style={{ marginBottom: 8 }}>Bekräftar din email …</h1>
            <p className="t-hand muted">Glo läser i mailet.</p>
          </>
        )}
        {status === 'ok' && (
          <>
            <h1 style={{ marginBottom: 8 }}>Klart! Din email är bekräftad.</h1>
            <p className="t-hand muted" style={{ marginBottom: 24 }}>
              Tack — nu syns du som verifierad och pingen är borta.
            </p>
            <Link to="/lists">
              <button className="btn btn-primary btn-lg">Till mina listor →</button>
            </Link>
          </>
        )}
        {status === 'bad' && (
          <>
            <h1 style={{ marginBottom: 8 }}>Den länken funkar inte</h1>
            <p className="t-hand muted" style={{ marginBottom: 24 }}>
              {error || 'Länken kan vara förbrukad eller utgått (24h-gräns). Logga in och be om en ny från banneret.'}
            </p>
            <Link to="/login">
              <button className="btn btn-primary">Logga in</button>
            </Link>
          </>
        )}
        {status === 'missing' && (
          <>
            <h1 style={{ marginBottom: 8 }}>Saknar token</h1>
            <p className="t-hand muted" style={{ marginBottom: 24 }}>
              Den här sidan måste öppnas via länken i ditt bekräftelse-mail.
            </p>
            <Link to="/login">
              <button className="btn">Tillbaka</button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
