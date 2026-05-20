import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import GloAvatar from '../components/GloAvatar';
import Sparkle from '../components/Sparkle';

const BENEFITS = [
  'Oändligt antal egna listor',
  'AI tolkar klistrad text från Google Docs / Word',
  'Quiz, flashkort och rekord per lista',
  'Funkar på datorn och i mobilen'
];

function strengthSegments(pw) {
  const len = pw.length;
  if (len === 0) return 0;
  if (len < 6) return 1;
  if (len < 10) return 2;
  if (len < 14) return 3;
  return 4;
}

const SEG_COLORS = ['var(--berry)', 'var(--mustard)', 'var(--leaf)', 'var(--leaf-deep)'];

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const result = await register(username, email, password);
    setBusy(false);
    if (result.success) navigate('/lists');
    else setError(result.error);
  };

  const filled = strengthSegments(password);

  return (
    <div className="paper-texture" style={{ minHeight: '100vh' }}>
      <nav className="navbar" style={{ background: 'transparent', borderBottom: 'none' }}>
        <div className="nav-inner">
          <img src="/assets/logo-wordmark.svg" height={44} alt="Glosan" />
          <div className="row" style={{ gap: 12 }}>
            <span className="muted t-hand" style={{ fontSize: 16 }}>Har redan ett konto?</span>
            <Link to="/login" className="btn btn-sm">Logga in</Link>
          </div>
        </div>
      </nav>

      <div className="auth-grid">
        <div>
          <span className="pill tilt-l" style={{ background: 'var(--mustard)', marginBottom: 18 }}>
            <Sparkle size={14} /> Gratis · 30 sek
          </span>
          <h1 style={{ fontSize: 46, lineHeight: 1.05, margin: '0 0 18px' }}>
            Skapa konto.<br />Kör <span className="mark-highlight">igång</span>.
          </h1>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {BENEFITS.map((b, i) => (
              <li key={i} className="row" style={{ gap: 12, marginBottom: 12, alignItems: 'flex-start' }}>
                <span
                  style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: 'var(--leaf)', color: 'var(--paper)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    border: '2px solid var(--ink)', flex: 'none', fontWeight: 800, fontSize: 14
                  }}
                >✓</span>
                <span style={{ fontSize: 17 }}>{b}</span>
              </li>
            ))}
          </ul>

          <div style={{ position: 'relative', marginTop: 32, paddingLeft: 8 }}>
            <GloAvatar size={120} float tilt={-4} />
            <span
              className="sticker tilt-r"
              style={{ position: 'absolute', top: 16, left: 110, background: 'var(--paper)' }}
            >
              psst — det är gratis
            </span>
          </div>
        </div>

        <form className="card card-lg" onSubmit={onSubmit} style={{ padding: 32 }}>
          <h2 style={{ marginBottom: 4 }}>Hoppa in</h2>
          <p className="t-hand muted" style={{ fontSize: 17, margin: '0 0 22px' }}>tre fält. Inget mer.</p>

          <label className="field" style={{ marginBottom: 14 }}>
            <span className="field-label">Användarnamn</span>
            <input className="inp" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required minLength={3} />
          </label>
          <label className="field" style={{ marginBottom: 14 }}>
            <span className="field-label">E-post</span>
            <input className="inp" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field" style={{ marginBottom: 6 }}>
            <span className="field-label">Lösenord</span>
            <input className="inp" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} />
          </label>

          <div className="row" style={{ gap: 6, marginBottom: 8, marginTop: 8 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                style={{
                  flex: 1, height: 6, borderRadius: 999,
                  background: i < filled ? SEG_COLORS[Math.min(i, 3)] : 'var(--paper-edge)',
                  border: '1.5px solid var(--ink)'
                }}
              />
            ))}
          </div>
          <p className="t-hand muted" style={{ fontSize: 13, margin: '0 0 18px' }}>
            Minst 10 tecken — gärna stor + liten + siffra.
          </p>

          {error && <p className="error" style={{ marginBottom: 16 }}>{error}</p>}

          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
            {busy ? 'Skapar konto…' : 'Skapa konto →'}
          </button>

          <p className="t-hand muted" style={{ marginTop: 14, fontSize: 14, textAlign: 'center', lineHeight: 1.4 }}>
            Genom att skapa konto godkänner du våra villkor.
          </p>
        </form>
      </div>
    </div>
  );
}
