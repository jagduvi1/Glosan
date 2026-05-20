import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGamification } from '../contexts/GamificationContext';
import { StreakPill, XpPill } from './Pill';

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { profile } = useGamification();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const initial = (user?.username || '?').trim().charAt(0).toUpperCase();
  const isOnLists = location.pathname.startsWith('/lists');
  const isOnProfile = location.pathname.startsWith('/profile');

  return (
    <div className="paper-texture" style={{ minHeight: '100vh' }}>
      <nav className="navbar">
        <div className="nav-inner">
          <Link to="/lists" style={{ display: 'flex', alignItems: 'center', gap: 10 }} aria-label="Glosan startsida">
            <img src="/assets/logo-wordmark.svg" height={40} alt="Glosan" />
          </Link>
          <div className="nav-links">
            <Link to="/lists" className={`nav-link ${isOnLists ? 'active' : ''}`}>Mina listor</Link>
            <Link to="/profile" className={`nav-link ${isOnProfile ? 'active' : ''}`}>Profil</Link>
          </div>
          <div className="row" style={{ gap: 10 }}>
            {profile && profile.streak.current > 0 && <StreakPill n={profile.streak.current} />}
            {profile && profile.xp > 0 && <XpPill n={profile.xp} />}
            <button className="btn btn-sm btn-ghost" onClick={handleLogout}>Logga ut</button>
            {user && (
              <Link to="/profile" aria-label={`Profil för ${user.username}`}>
                <span
                  className="avatar"
                  title={user.username}
                  style={{ width: 38, height: 38, background: 'var(--coral)', fontSize: 17, cursor: 'pointer' }}
                >
                  {initial}
                </span>
              </Link>
            )}
          </div>
        </div>
      </nav>
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '28px 24px 60px' }}>{children}</main>
    </div>
  );
}
