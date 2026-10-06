import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { getProfile } from '../api/me';

const Ctx = createContext(null);

// Dagen i svensk tid — samma dagar som streaken räknas i (services/gamification.js).
const swedishDay = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });

export function GamificationProvider({ children }) {
  const { user, apiFetch } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fetchedDay = useRef(null);

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
      fetchedDay.current = swedishDay();
    } catch (e) {
      console.error('Failed to load profile:', e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user, apiFetch]);

  useEffect(() => { refresh(); }, [refresh]);

  // Appen öppen över natten: när fliken visas igen en ny dag hämtas profilen
  // om, så att flamman (streak och "övat idag") stämmer för den nya dagen.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && fetchedDay.current && fetchedDay.current !== swedishDay()) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  return (
    <Ctx.Provider value={{ profile, loading, error, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useGamification() {
  return useContext(Ctx) || { profile: null, loading: false, error: null, refresh: () => {} };
}
