import { createContext, useState, useContext, useEffect, useRef, useCallback } from 'react';
import { createApiFetch } from '../utils/apiFetch';

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  const tokenRef = useRef(null);
  useEffect(() => { tokenRef.current = token; }, [token]);

  const storeToken = (t) => {
    setToken(t);
    tokenRef.current = t;
  };

  const clearToken = () => {
    setToken(null);
    tokenRef.current = null;
  };

  const handleRefresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json();
      storeToken(data.token);
      return data.token;
    } catch {
      return null;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {}
      });
    } catch { /* best effort */ }
    clearToken();
    setUser(null);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const apiFetch = useCallback(
    createApiFetch(() => tokenRef.current, handleRefresh, logout),
    []
  );

  const fetchUserProfile = useCallback(async (authToken) => {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${authToken}` },
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        clearToken();
        setUser(null);
      }
    } catch {
      clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const t = await handleRefresh();
      if (t) {
        await fetchUserProfile(t);
      } else {
        setLoading(false);
      }
    })();
  }, [handleRefresh, fetchUserProfile]);

  const register = async (username, email, password, ageConsent) => {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, email, password, ageConsent })
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.error || 'Registrering misslyckades' };
      storeToken(data.token);
      setUser(data.user);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  const login = async (username, password) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.error || 'Inloggning misslyckades' };
      storeToken(data.token);
      setUser(data.user);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  const value = { user, token, loading, register, login, logout, apiFetch };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
