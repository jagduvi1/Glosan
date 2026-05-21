import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGamification } from '../contexts/GamificationContext';
import { StreakPill, XpPill, QuotaPill } from './Pill';
import AvatarDisplay from './AvatarDisplay';
import ConfettiBurst from './ConfettiBurst';
import EmojiBurst from './EmojiBurst';
import EasterEggListModal from './EasterEggListModal';
import { useKonamiCode } from '../utils/useKonamiCode';
import { useLogoOutfit } from '../utils/useLogoOutfit';
import { useSeasonalTheme } from '../utils/useSeasonalTheme';
import { useTextSequence } from '../utils/useTextSequence';
import { markEggFound } from '../utils/easterEggs';

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { profile } = useGamification();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confettiTrigger, setConfettiTrigger] = useState(0);
  const [starTrigger, setStarTrigger] = useState(0);
  const [magicTrigger, setMagicTrigger] = useState(0);
  const [partyTrigger, setPartyTrigger] = useState(0);
  const [showPartyBanner, setShowPartyBanner] = useState(false);
  const [showEggList, setShowEggList] = useState(false);
  const xpClicksRef = useRef(0);
  const { onClick: onLogoClick, outfit } = useLogoOutfit();
  const { season, accessory: seasonAccessory, message: seasonMessage, lateNight } = useSeasonalTheme();

  // Säsongs-accessory tar över användarens valda outfit under helgdagen
  const headAccessory = seasonAccessory || outfit;

  // Påskägg: Konami-koden ger en regnbåge-konfetti över sidan
  useKonamiCode(() => {
    setConfettiTrigger((t) => t + 1);
    markEggFound('konami');
  });

  // Påskägg: skriv "abracadabra" var som helst → magiska gnistor
  useTextSequence('abracadabra', () => {
    setMagicTrigger((t) => t + 1);
    markEggFound('abracadabra');
  });

  // Påskägg: IDKFA (Doom-fuskkod, "ge mig allt") triggar samtliga effekter
  // på en gång — konfetti, stjärnor, magi, kanelbullar och en banner.
  useTextSequence('idkfa', () => {
    setConfettiTrigger((t) => t + 1);
    setStarTrigger((t) => t + 1);
    setMagicTrigger((t) => t + 1);
    setPartyTrigger((t) => t + 1);
    setShowPartyBanner(true);
    setTimeout(() => setShowPartyBanner(false), 3500);
    markEggFound('idkfa');
  });

  // Logga säsongs- och nattlägets-egg när de upptäcks visuellt
  useEffect(() => {
    if (season) markEggFound('season');
    if (lateNight && !season) markEggFound('night-mode');
  }, [season, lateNight]);

  // Logga outfit-egg och gyllene streak när villkoren uppfylls
  useEffect(() => { if (outfit) markEggFound('logo-outfit'); }, [outfit]);
  useEffect(() => {
    if (profile?.streak?.current >= 30) markEggFound('streak-30');
  }, [profile?.streak?.current]);

  const onXpPillClick = () => {
    xpClicksRef.current += 1;
    if (xpClicksRef.current >= 20) {
      xpClicksRef.current = 0;
      setStarTrigger((t) => t + 1);
      markEggFound('xp-burst');
    }
  };

  // Layout monteras om för varje route, så footer-räknaren lagras i
  // localStorage med en timestamp. Gamla klick (>30 s) räknas inte.
  const onFooterClick = (e) => {
    const FOOTER_KEY = 'glo-footer-clicks';
    const WINDOW_MS = 30_000;
    let cur = { count: 0, ts: 0 };
    try {
      const raw = localStorage.getItem(FOOTER_KEY);
      if (raw) cur = JSON.parse(raw);
    } catch { /* ignore */ }
    const now = Date.now();
    const recent = cur.ts && (now - cur.ts) < WINDOW_MS;
    const next = recent ? cur.count + 1 : 1;
    if (next >= 7) {
      e.preventDefault();
      try { localStorage.removeItem(FOOTER_KEY); } catch { /* ignore */ }
      setShowEggList(true);
      markEggFound('footer-list');
    } else {
      try { localStorage.setItem(FOOTER_KEY, JSON.stringify({ count: next, ts: now })); } catch { /* ignore */ }
    }
  };

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
      <ConfettiBurst trigger={confettiTrigger} />
      <EmojiBurst trigger={starTrigger} emoji={['⭐', '✨']} count={30} duration={2800} />
      <EmojiBurst trigger={magicTrigger} emoji={['✨', '💫', '🪄', '⭐']} count={36} duration={3200} />
      <EmojiBurst trigger={partyTrigger} emoji={['🥐', '🎉', '🎊', '🍩', '🦄', '🌈']} count={50} duration={3500} />
      {showPartyBanner && (
        <div className="idkfa-banner pop-in" role="status" aria-live="polite">
          🎉 IDKFA — allt på en gång! 🎉
        </div>
      )}
      {showEggList && <EasterEggListModal onClose={() => setShowEggList(false)} />}
      <nav className="navbar">
        <div className="nav-inner">
          <Link to="/lists" className="nav-logo" aria-label="Glosan startsida" onClick={onLogoClick}>
            {headAccessory && (
              <span className="nav-logo-outfit" aria-hidden="true">{headAccessory}</span>
            )}
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
            {seasonMessage && (
              <span className="pill nav-pill-link" style={{ background: 'var(--mustard-soft)' }} title={seasonMessage}>
                {seasonMessage}
              </span>
            )}
            {lateNight && !seasonMessage && (
              <span className="pill nav-pill-link" style={{ background: 'var(--plum-soft)' }} title="Nattläge">
                🌙 borde du inte sova?
              </span>
            )}
            {profile?.aiUsage && (
              <Link to="/profile" aria-label="AI-anrop kvar" style={{ textDecoration: 'none' }} className="nav-pill-link">
                <QuotaPill used={profile.aiUsage.used} limit={profile.aiUsage.limit} />
              </Link>
            )}
            {profile && profile.streak.current > 0 && <StreakPill n={profile.streak.current} />}
            {profile && profile.xp > 0 && (
              <span className="nav-pill-link" onClick={onXpPillClick} style={{ cursor: 'pointer' }}>
                <XpPill n={profile.xp} />
              </span>
            )}
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
        <Link
          to="/integritet"
          style={{ color: 'var(--ink-soft)', fontWeight: 400 }}
          onClick={onFooterClick}
        >
          Integritetspolicy
        </Link>
      </footer>
    </div>
  );
}
