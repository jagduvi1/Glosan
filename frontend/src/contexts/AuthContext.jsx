import { createContext, useState, useContext, useEffect, useRef, useCallback, useMemo } from 'react';
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

  // EN refresh i taget: servern roterar refresh-cookien, och två anrop med
  // samma cookie kunde logga ut eleven (Plugga-sidorna laddar parallellt).
  // Alla som får 401 samtidigt väntar på samma förfrågan.
  const refreshInFlight = useRef(null);
  const handleRefresh = useCallback(() => {
    if (!refreshInFlight.current) {
      refreshInFlight.current = (async () => {
        try {
          const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
          if (!res.ok) return null;
          const data = await res.json();
          storeToken(data.token);
          return data.token;
        } catch {
          return null;
        } finally {
          refreshInFlight.current = null;
        }
      })();
    }
    return refreshInFlight.current;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {}
      });
    } catch { /* best effort */ }
    // Provutkast (Plugga) ska inte ligga kvar på en delad skoldator.
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith('glosan.test.')) localStorage.removeItem(key);
      }
    } catch { /* privat läge */ }
    clearToken();
    setUser(null);
  }, []);

  // useMemo (inte useCallback) eftersom createApiFetch returnerar en
  // ny funktion vi vill cacha — annars skapas en ny apiFetch vid varje
  // render. handleRefresh och logout är memoiserade med tom dep-array
  // så de är stabila och apiFetch byggs i praktiken bara en gång.
  const apiFetch = useMemo(
    () => createApiFetch(() => tokenRef.current, handleRefresh, logout),
    [handleRefresh, logout]
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

  // Applicera tokens från ett externt login-flöde (t.ex. magic-link
   // som redan har anropat backend och fått tillbaka { token, user }).
  const applyExternalToken = useCallback((accessToken, externalUser) => {
    storeToken(accessToken);
    setUser(externalUser);
    setLoading(false);
  }, []);

  // Läs om användaren från servern — t.ex. när en Plugga-inbjudan just slagit
  // på en funktionsflagga, så att menyn och sidorna följer med utan omloggning.
  const refreshUser = useCallback(async () => {
    try {
      const res = await apiFetch('/api/auth/me');
      if (!res.ok) return null;
      const data = await res.json();
      setUser(data.user);
      return data.user;
    } catch {
      return null;
    }
  }, [apiFetch]);

  // En modul slogs av medan sidan var öppen (api/study.js säger till) — läs
  // om användaren så att menyn och de dolda sidorna följer med.
  useEffect(() => {
    const onFeatureOff = () => { refreshUser(); };
    window.addEventListener('glosan:feature-off', onFeatureOff);
    return () => window.removeEventListener('glosan:feature-off', onFeatureOff);
  }, [refreshUser]);

  const value = { user, token, loading, register, login, logout, apiFetch, applyExternalToken, refreshUser };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
