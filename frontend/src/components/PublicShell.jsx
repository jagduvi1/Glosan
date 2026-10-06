import { Link } from 'react-router-dom';

// Ramen runt publika sidor när man inte är inloggad (guiden /koppla-ai, Om
// Glosan): loggan leder till framsidan, och en Logga in-knapp. Inloggad visas
// samma sidor i Layout i stället.
export default function PublicShell({ children }) {
  return (
    <div className="paper-texture" style={{ minHeight: '100vh' }}>
      <nav className="navbar" style={{ background: 'transparent', borderBottom: 'none' }}>
        <div className="nav-inner">
          <Link to="/"><img src="/assets/logo-wordmark.svg" height={44} alt="Glosan" /></Link>
          <div className="row" style={{ gap: 12 }}>
            <Link to="/login"><button className="btn btn-sm btn-ghost" type="button">Logga in</button></Link>
          </div>
        </div>
      </nav>
      <main style={{ padding: '16px 16px 48px' }}>{children}</main>
    </div>
  );
}
