import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { getProfile } from '../api/me';

const Ctx = createContext(null);

export function GamificationProvider({ children }) {
  const { user, apiFetch } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setProfile(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const p = await getProfile(apiFetch);
      setProfile(p);
    } catch (e) {
      console.error('Failed to load profile:', e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user, apiFetch]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <Ctx.Provider value={{ profile, loading, error, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useGamification() {
  return useContext(Ctx) || { profile: null, loading: false, error: null, refresh: () => {} };
}
