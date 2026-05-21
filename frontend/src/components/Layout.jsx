import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGamification } from '../contexts/GamificationContext';
import { StreakPill, XpPill, QuotaPill } from './Pill';
import AvatarDisplay from './AvatarDisplay';

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { profile } = useGamification();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Stäng menyn när vi navigerar bort
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

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
          <Link to="/lists" className="nav-logo" aria-label="Glosan startsida">
            <img src="/assets/logo-wordmark.svg" height={40} alt="Glosan" />
          </Link>
          <div className="nav-links nav-links-desktop">
            <Link to="/lists" className={`nav-link ${isOnLists ? 'active' : ''}`}>Mina listor</Link>
            <Link to="/ordbok" className={`nav-link ${isOnDictionary ? 'active' : ''}`}>Ordbok</Link>
            <Link to="/kompisar" className={`nav-link ${isOnFriends ? 'active' : ''}`}>Kompisar</Link>
            <Link to="/profile" className={`nav-link ${isOnProfile ? 'active' : ''}`}>Profil</Link>
            {isAdmin && (
              <Link to="/admin" className={`nav-link ${isOnAdmin ? 'active' : ''}`}>Admin</Link>
            )}
          </div>
          <div className="nav-actions">
            {profile?.aiUsage && (
              <Link to="/profile" aria-label="AI-anrop kvar" style={{ textDecoration: 'none' }} className="nav-pill-link">
                <QuotaPill used={profile.aiUsage.used} limit={profile.aiUsage.limit} />
              </Link>
            )}
            {profile && profile.streak.current > 0 && <StreakPill n={profile.streak.current} />}
            {profile && profile.xp > 0 && <span className="nav-pill-link"><XpPill n={profile.xp} /></span>}
            <button className="btn btn-sm btn-ghost nav-logout-desktop" onClick={handleLogout}>Logga ut</button>
            {user && (
              <Link to="/profile" aria-label={`Profil för ${user.username}`} title={user.username} style={{ display: 'inline-flex', cursor: 'pointer' }}>
                <AvatarDisplay
                  avatar={profile?.avatar}
                  username={user.username}
                  size={38}
                />
              </Link>
            )}
            <button
              className="nav-burger"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Visa meny"
              aria-expanded={menuOpen}
            >
              {menuOpen ? '✕' : '☰'}
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="nav-drawer">
            <Link to="/lists" className={`nav-link ${isOnLists ? 'active' : ''}`}>Mina listor</Link>
            <Link to="/ordbok" className={`nav-link ${isOnDictionary ? 'active' : ''}`}>Ordbok</Link>
            <Link to="/kompisar" className={`nav-link ${isOnFriends ? 'active' : ''}`}>Kompisar</Link>
            <Link to="/profile" className={`nav-link ${isOnProfile ? 'active' : ''}`}>Profil</Link>
            {isAdmin && (
              <Link to="/admin" className={`nav-link ${isOnAdmin ? 'active' : ''}`}>Admin</Link>
            )}
            <button className="btn btn-sm" onClick={handleLogout} style={{ marginTop: 6 }}>Logga ut</button>
          </div>
        )}
      </nav>
      <main className="app-main">{children}</main>
      <footer className="app-footer">
        <Link to="/integritet" style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>Integritetspolicy</Link>
      </footer>
    </div>
  );
}
