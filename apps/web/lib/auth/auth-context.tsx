'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiPost, setAccessToken } from './api-client';
import { me as fetchMe, type MeResponse } from './auth-api';
import { IdleLockOverlay } from '../../components/auth/IdleLockOverlay';

interface AuthContextValue {
  user: MeResponse | null;
  isLoading: boolean;
  refreshUser: () => Promise<void>;
  clearUser: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const current = await fetchMe();
      setUser(current);
    } catch {
      setUser(null);
    }
  }, []);

  const clearUser = useCallback(() => {
    setAccessToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    // The access token lives in memory only (see api-client.ts) — a full
    // page load always starts with none, so recover a session from the
    // httpOnly refresh cookie (if any) before deciding whether the user is
    // signed in.
    let cancelled = false;
    (async () => {
      try {
        const res = await apiPost<{ accessToken: string }>('/auth/refresh', undefined, { skipAuthRetry: true });
        setAccessToken(res.accessToken);
        if (!cancelled) await refreshUser();
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshUser]);

  const value = useMemo(() => ({ user, isLoading, refreshUser, clearUser }), [user, isLoading, refreshUser, clearUser]);

  return (
    <AuthContext.Provider value={value}>
      {children}
      {user ? <IdleLockOverlay user={user} onLockedOut={clearUser} /> : null}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
