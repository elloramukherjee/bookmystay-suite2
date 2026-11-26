import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { refreshAccessToken, tokenStore } from '../services/api';
import { authService } from '../services/auth.service';
import type { HotelSummary, Permission, User } from '../types/api';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  status: Status;
  user: User | null;
  hotel: HotelSummary | null;
  permissions: ReadonlySet<Permission>;
  can: (...perms: Permission[]) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-fetch /auth/me (e.g. after the owner renames the hotel). */
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Presence hint only (not a credential): lets anonymous guests skip a pointless /auth/refresh call
 * on every public page load. The real session is the httpOnly cookie.
 */
const SESSION_HINT = 'bms_session_hint';
const hint = {
  get: () => {
    try {
      return localStorage.getItem(SESSION_HINT) === '1';
    } catch {
      return false;
    }
  },
  set: (on: boolean) => {
    try {
      if (on) localStorage.setItem(SESSION_HINT, '1');
      else localStorage.removeItem(SESSION_HINT);
    } catch {
      /* storage unavailable (private mode) — harmless */
    }
  },
};

const EMPTY = new Set<Permission>();

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [hotel, setHotel] = useState<HotelSummary | null>(null);
  const [permissions, setPermissions] = useState<ReadonlySet<Permission>>(EMPTY);

  const clear = useCallback(() => {
    tokenStore.set(null);
    hint.set(false);
    setUser(null);
    setHotel(null);
    setPermissions(EMPTY);
    setStatus('anonymous');
    queryClient.clear();
  }, [queryClient]);

  const loadMe = useCallback(async () => {
    const me = await authService.me();
    setUser(me.user);
    setHotel(me.hotel);
    setPermissions(new Set(me.permissions));
    setStatus('authenticated');
  }, []);

  useEffect(() => {
    tokenStore.onExpired(clear);
    let cancelled = false;
    (async () => {
      if (!hint.get()) {
        setStatus('anonymous');
        return;
      }
      const token = await refreshAccessToken();
      if (cancelled) return;
      if (!token) {
        clear();
        return;
      }
      try {
        await loadMe();
      } catch {
        if (!cancelled) clear();
      }
    })();
    return () => {
      cancelled = true;
      tokenStore.onExpired(null);
    };
  }, [clear, loadMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await authService.login(email, password);
      tokenStore.set(res.accessToken);
      hint.set(true);
      await loadMe();
    },
    [loadMe],
  );

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } finally {
      clear();
    }
  }, [clear]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      hotel,
      permissions,
      can: (...perms) => perms.every((p) => permissions.has(p)),
      login,
      logout,
      reload: loadMe,
    }),
    [status, user, hotel, permissions, login, logout, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
