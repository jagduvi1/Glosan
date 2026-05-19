import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
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
    <div className="container" style={{ maxWidth: 420 }}>
      <h1>Glosan</h1>
      <p className="muted">Logga in</p>
      <form onSubmit={onSubmit} className="card stack">
        <label>
          Användarnamn eller e-post
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        </label>
        <label>
          Lösenord
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Loggar in…' : 'Logga in'}
        </button>
        <p className="muted">Nytt konto? <Link to="/register">Skapa ett här</Link></p>
      </form>
    </div>
  );
}
