import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

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

  return (
    <div className="container" style={{ maxWidth: 420 }}>
      <h1>Glosan</h1>
      <p className="muted">Skapa konto</p>
      <form onSubmit={onSubmit} className="card stack">
        <label>
          Användarnamn
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required minLength={3} />
        </label>
        <label>
          E-post
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Lösenord
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} />
          <span className="muted">Minst 10 tecken med stor och liten bokstav samt siffra.</span>
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Skapar…' : 'Skapa konto'}
        </button>
        <p className="muted">Har du redan ett konto? <Link to="/login">Logga in</Link></p>
      </form>
    </div>
  );
}
