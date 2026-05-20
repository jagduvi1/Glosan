import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGamification } from '../contexts/GamificationContext';
import { StreakPill, XpPill } from './Pill';
import AvatarDisplay from './AvatarDisplay';

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { profile } = useGamification();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const isOnLists = location.pathname.startsWith('/lists');
  const isOnProfile = location.pathname.startsWith('/profile');
  const isOnDictionary = location.pathname.startsWith('/ordbok');
  const isOnFriends = location.pathname.startsWith('/kompisar');
  const isOnAdmin = location.pathname.startsWith('/admin');
  const isAdmin = user?.roles?.includes('admin');

  return (
    <div className="paper-texture" style={{ minHeight: '100vh' }}>
      <nav className="navbar">
        <div className="nav-inner">
          <Link to="/lists" style={{ display: 'flex', alignItems: 'center', gap: 10 }} aria-label="Glosan startsida">
            <img src="/assets/logo-wordmark.svg" height={40} alt="Glosan" />
          </Link>
          <div className="nav-links">
            <Link to="/lists" className={`nav-link ${isOnLists ? 'active' : ''}`}>Mina listor</Link>
            <Link to="/ordbok" className={`nav-link ${isOnDictionary ? 'active' : ''}`}>Ordbok</Link>
            <Link to="/kompisar" className={`nav-link ${isOnFriends ? 'active' : ''}`}>Kompisar</Link>
            <Link to="/profile" className={`nav-link ${isOnProfile ? 'active' : ''}`}>Profil</Link>
            {isAdmin && (
              <Link to="/admin" className={`nav-link ${isOnAdmin ? 'active' : ''}`}>Admin</Link>
            )}
          </div>
          <div className="row" style={{ gap: 10 }}>
            {profile && profile.streak.current > 0 && <StreakPill n={profile.streak.current} />}
            {profile && profile.xp > 0 && <XpPill n={profile.xp} />}
            <button className="btn btn-sm btn-ghost" onClick={handleLogout}>Logga ut</button>
            {user && (
              <Link to="/profile" aria-label={`Profil för ${user.username}`} title={user.username} style={{ display: 'inline-flex', cursor: 'pointer' }}>
                <AvatarDisplay
                  avatar={profile?.avatar}
                  username={user.username}
                  size={38}
                />
              </Link>
            )}
          </div>
        </div>
      </nav>
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '28px 24px 60px' }}>{children}</main>
      <footer
        style={{
          maxWidth: 960,
          margin: '0 auto',
          padding: '16px 24px 32px',
          borderTop: '1.5px dashed var(--paper-edge)',
          fontFamily: 'var(--font-hand)',
          fontSize: 14,
          color: 'var(--ink-soft)',
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap'
        }}
      >
        <Link to="/integritet" style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>Integritetspolicy</Link>
      </footer>
    </div>
  );
}
