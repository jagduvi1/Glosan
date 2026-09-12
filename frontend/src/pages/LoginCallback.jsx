import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { takePostLoginRedirect } from '../utils/postLoginRedirect';

// Landningssida för Google-rundresan. Backend har redan satt httpOnly-
// refresh-cookien och AuthProvider kör sin session-restore vid mount INNAN
// routes renderas (appen gatear på `loading`), så när vi hamnar här är
// `user` redan satt vid lyckad inloggning — ingen token åker någonsin i
// URL:en. Felkoderna kommer från backend via ?error=.
const ERROR_MESSAGES = {
  no_verified_email: 'Google-kontot saknar en verifierad e-postadress, så vi kunde inte logga in dig.',
  access_denied: 'Inloggningen avbröts.',
  not_configured: 'Google-inloggning är inte påslagen på den här servern.',
  invalid_state: 'Vi kunde inte verifiera inloggningen. Börja om från inloggningssidan.',
  server_error: 'Något gick fel vid inloggningen. Försök igen.'
};

export default function LoginCallback() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const error = params.get('error');

  // Redirect-stashen är engångs och StrictMode dubbelkör mount-effekter i
  // dev: körning ett konsumerar och navigerar, körning två hittar inget och
  // skulle skriva över med /lists. Kör en gång per mount-cykel.
  const ranRef = useRef(false);
  const signedIn = Boolean(user);

  useEffect(() => {
    if (error) return; // visa felkortet nedan
    if (ranRef.current) return;
    ranRef.current = true;
    navigate(signedIn ? (takePostLoginRedirect() || '/lists') : '/login', { replace: true });
  }, [error, signedIn, navigate]);

  return (
    <div className="paper-texture" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="card card-lg" style={{ padding: 32, maxWidth: 420, textAlign: 'center' }}>
        {error ? (
          <>
            <p className="error" style={{ marginBottom: 20 }}>
              {ERROR_MESSAGES[error] || ERROR_MESSAGES.server_error}
            </p>
            <button className="btn btn-primary btn-block" onClick={() => navigate('/login', { replace: true })}>
              Tillbaka till inloggningen
            </button>
          </>
        ) : (
          <p className="t-hand muted" style={{ fontSize: 18, margin: 0 }}>Loggar in dig…</p>
        )}
      </div>
    </div>
  );
}
