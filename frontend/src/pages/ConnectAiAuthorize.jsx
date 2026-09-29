import { useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import GloAvatar from '../components/GloAvatar';
import GoogleLoginButton from '../components/GoogleLoginButton';
import { approveMcpConnection, fetchMcpClientInfo } from '../api/mcp';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import { hasFeature } from '../utils/features';

// Samtyckessidan för MCP-connectorn (OAuth 2.1). Backendens
// GET /api/mcp/oauth/authorize validerar förfrågan och skickar hit browsern med
// parametrarna. Användaren godkänner, vi POST:ar till /approve som mintar en
// kod, och browsern skickas till AI-klientens redirect_uri. Allt valideras om
// på servern — den här sidan är UX, inte en säkerhetsgräns. Porterad från
// Cellarions ConnectAiAuthorize.
//
// Utloggad: inloggningen visas DIREKT här (i stället för att studsa via
// /login) så OAuth-parametrarna ligger kvar i URL:en. Google-varvet är en full
// sidladdning, så där stashas hela sökvägen och /login/callback tar oss hit.
//
// Vem som ansluter hämtas från servern (GET /api/mcp/oauth/client), aldrig ur
// URL:en: vem som helst kan registrera en app som heter "Claude", så sidan
// visar också vart man skickas och varnar tydligt när värden är okänd.

const LEVELS = {
  read: {
    title: 'Bara läsa',
    desc: 'Den kan se dina listor, glosor och resultat — men aldrig ändra något.',
    studyDesc: 'Den kan se dina listor, glosor, pluggområden och resultat — men aldrig ändra något.'
  },
  write: {
    title: 'Läsa och skapa',
    desc: 'Den kan också skapa listor (t.ex. från ett foto), lägga till, rätta och radera glosor.',
    studyDesc: 'Den kan också skapa listor och pluggområden (t.ex. från foton av boken), lägga till, rätta och radera — och rätta dina papperslösningar.'
  }
};
const GRANTABLE = ['read', 'write'];

export default function ConnectAiAuthorize() {
  useDocumentTitle('Koppla din AI');
  const { user, loading, apiFetch, login } = useAuth();
  const [params] = useSearchParams();
  const location = useLocation();

  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  const codeChallenge = params.get('code_challenge');
  const codeChallengeMethod = params.get('code_challenge_method') || 'S256';
  const scope = params.get('scope') || '';
  const state = params.get('state') || '';
  const resource = params.get('resource') || '';
  // { client_name, redirect_host, trust } från servern; null = okänd klient.
  const [client, setClient] = useState(undefined);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // Samma tolkning som serverns grantedScopes: tom förfrågan = allt vi
  // erbjuder; annars snittet med det vi kan ge, med read som golv.
  const requested = scope.split(/\s+/).filter((s) => s && s !== 'offline_access');
  let offered = requested.length === 0 ? GRANTABLE : GRANTABLE.filter((s) => requested.includes(s));
  // write innebär read (som på servern).
  if (offered.includes('write') && !offered.includes('read')) offered = ['read', ...offered];
  if (offered.length === 0) offered = ['read'];
  // Nivåerna är prefix av erbjudandet ("Bara läsa" … "Läsa och skapa"), så
  // användaren kan bara smalna av, aldrig vidga. Förval: hela erbjudandet.
  const levels = offered.map((_, i) => offered.slice(0, i + 1));
  const [levelIndex, setLevelIndex] = useState(levels.length - 1);
  const grantScopes = levels[Math.min(levelIndex, levels.length - 1)];

  const requestValid = clientId && redirectUri && codeChallenge && codeChallengeMethod === 'S256';

  useEffect(() => {
    if (!requestValid) return undefined;
    let active = true;
    fetchMcpClientInfo(clientId, redirectUri)
      .then((info) => {
        if (!active) return;
        setClient(info);
        // En okänd app får börja på "Bara läsa" — att ge mer är ett aktivt val.
        if (info?.trust === 'unknown') setLevelIndex(0);
      })
      .catch(() => { if (active) setClient(null); });
    return () => { active = false; };
  }, [requestValid, clientId, redirectUri]);

  const decide = async (approved) => {
    setSubmitting(true);
    setError('');
    try {
      const redirect = await approveMcpConnection(apiFetch, {
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
        scope,
        state,
        resource,
        approved,
        ...(approved ? { scopes: grantScopes } : {})
      });
      // Full sidnavigering — redirect_uri är AI-klientens externa callback.
      window.location.href = redirect;
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  const submitLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoggingIn(true);
    const result = await login(username, password);
    setLoggingIn(false);
    // Vid lyckad inloggning sätter AuthContext `user` och sidan ritas om
    // till samtyckesvyn.
    if (!result.success) setLoginError(result.error || 'Inloggningen misslyckades.');
  };

  const shell = (children) => (
    <div className="paper-texture" style={{ minHeight: '100vh', padding: '48px 16px' }}>
      <div className="card card-lg" style={{ maxWidth: 520, margin: '0 auto', padding: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <img src="/assets/logo-wordmark.svg" height={40} alt="Glosan" />
        </div>
        {children}
      </div>
    </div>
  );

  if (!requestValid || client === null) {
    return shell(
      <p className="error">
        Länken är ogiltig eller ofullständig. Starta anslutningen igen från din AI-assistent.
      </p>
    );
  }

  if (loading || client === undefined) return shell(<p className="t-hand muted">Laddar…</p>);

  const redirectHost = client.redirect_host;
  // En okänd app kan heta vad som helst — då visas värden i stället för namnet.
  const who = client.trust === 'unknown' ? `En app på ${redirectHost}` : (client.client_name || 'En AI-assistent');
  const unknownWarning = client.trust === 'unknown' && (
    <div className="card" role="alert" style={{ background: 'var(--berry-soft)', borderColor: 'var(--berry-deep)', marginBottom: 16, padding: 14 }}>
      <strong>Okänd app.</strong> Glosan känner inte igen <strong>{redirectHost}</strong>
      {client.client_name ? <> (den kallar sig "{client.client_name}")</> : null}. Godkänn bara om du själv
      just startade kopplingen i en app du litar på — annars: tryck Avbryt.
    </div>
  );

  if (!user) {
    return shell(
      <>
        {unknownWarning}
        <h1 style={{ fontSize: 30, margin: '8px 0 4px' }}>Logga in för att koppla din AI</h1>
        <p className="t-hand muted" style={{ fontSize: 17, margin: '0 0 22px' }}>
          Logga in på ditt Glosan-konto för att godkänna anslutningen.
        </p>
        <GoogleLoginButton redirectTo={`${location.pathname}${location.search}`} />
        <form onSubmit={submitLogin}>
          <label className="field" style={{ marginBottom: 16 }}>
            <span className="field-label">Användarnamn eller e-post</span>
            <input className="inp" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
          </label>
          <label className="field" style={{ marginBottom: 22 }}>
            <span className="field-label">Lösenord</span>
            <input className="inp" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          {loginError && <p className="error" style={{ marginBottom: 16 }}>{loginError}</p>}
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={loggingIn}>
            {loggingIn ? 'Loggar in…' : 'Logga in →'}
          </button>
        </form>
      </>
    );
  }

  const study = hasFeature(user, 'study');
  return shell(
    <>
      <div className="row" style={{ gap: 12, alignItems: 'center', margin: '8px 0 12px' }}>
        <GloAvatar size={56} mood="wink" tilt={-6} />
        <h1 style={{ fontSize: 28, margin: 0 }}>Koppla din AI till Glosan</h1>
      </div>
      {unknownWarning}
      <p style={{ fontSize: 17, marginTop: 0 }}>
        <strong>{who}</strong> vill komma åt ditt Glosan-konto (<strong>{user.username}</strong>). Välj hur mycket den får göra:
      </p>

      <div className="stack" role="radiogroup" aria-label="Behörighet" style={{ gap: 10, marginBottom: 16 }}>
        {levels.map((scopes, i) => {
          const top = scopes[scopes.length - 1];
          const selected = i === Math.min(levelIndex, levels.length - 1);
          return (
            <label
              key={top}
              className="card"
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
                padding: 14,
                cursor: 'pointer',
                background: selected ? 'var(--mustard-soft)' : 'var(--bg-elev)'
              }}
            >
              <input
                type="radio"
                name="access-level"
                checked={selected}
                onChange={() => setLevelIndex(i)}
                disabled={submitting}
                style={{ marginTop: 4 }}
              />
              <span>
                <strong>{LEVELS[top].title}</strong>
                <span className="t-hand muted" style={{ display: 'block', fontSize: 15 }}>{study ? LEVELS[top].studyDesc : LEVELS[top].desc}</span>
              </span>
            </label>
          );
        })}
      </div>

      <p className="t-hand muted" style={{ fontSize: 15 }}>
        Du kan koppla bort AI:n när som helst under Profil. Den når dina listor, glosor{study ? ', pluggområden' : ''} och
        resultat — aldrig ditt lösenord eller din e-post.
      </p>
      <p className="t-hand muted" style={{ fontSize: 14 }}>
        När du godkänt skickas du tillbaka till <strong>{redirectHost}</strong>
        {client.trust === 'local' ? ' (en app på den här datorn)' : ''}.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="row" style={{ gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="btn" type="button" onClick={() => decide(false)} disabled={submitting}>
          Avbryt
        </button>
        <button className="btn btn-primary" type="button" onClick={() => decide(true)} disabled={submitting}>
          {submitting ? 'Kopplar…' : 'Godkänn'}
        </button>
      </div>
    </>
  );
}
