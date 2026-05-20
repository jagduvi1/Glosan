import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const initial = (user?.username || '?').trim().charAt(0).toUpperCase();
  const isOnLists = location.pathname.startsWith('/lists');

  return (
    <div className="paper-texture" style={{ minHeight: '100vh' }}>
      <nav className="navbar">
        <div className="nav-inner">
          <Link to="/lists" style={{ display: 'flex', alignItems: 'center', gap: 10 }} aria-label="Glosan startsida">
            <img src="/assets/logo-wordmark.svg" height={40} alt="Glosan" />
          </Link>
          <div className="nav-links">
            <Link to="/lists" className={`nav-link ${isOnLists ? 'active' : ''}`}>Mina listor</Link>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn btn-sm btn-ghost" onClick={handleLogout}>Logga ut</button>
            {user && (
              <span
                className="avatar"
                title={user.username}
                style={{ width: 38, height: 38, background: 'var(--coral)', fontSize: 17 }}
              >
                {initial}
              </span>
            )}
          </div>
        </div>
      </nav>
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '28px 24px 60px' }}>{children}</main>
    </div>
  );
}
