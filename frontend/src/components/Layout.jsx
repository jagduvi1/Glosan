import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div>
      <header style={headerStyle}>
        <div style={headerInnerStyle}>
          <Link to="/lists" style={brandStyle}>Glosan</Link>
          <nav style={navStyle}>
            <Link to="/lists">Mina listor</Link>
            {user && <span className="muted">{user.username}</span>}
            <button onClick={handleLogout}>Logga ut</button>
          </nav>
        </div>
      </header>
      <main className="container">{children}</main>
    </div>
  );
}

const headerStyle = {
  background: 'var(--color-surface)',
  borderBottom: '1px solid var(--color-border)',
};

const headerInnerStyle = {
  maxWidth: 960,
  margin: '0 auto',
  padding: '0.75rem 1rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const brandStyle = {
  fontWeight: 700,
  fontSize: '1.25rem',
  color: 'var(--color-primary)',
};

const navStyle = {
  display: 'flex',
  gap: '1rem',
  alignItems: 'center',
};
