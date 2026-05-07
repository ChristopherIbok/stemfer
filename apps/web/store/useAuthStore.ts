'use client';
import { create }   from 'zustand';
import { persist }  from 'zustand/middleware';
import type { User } from '@stemfer/shared/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://stemfer-api.ibokchris.workers.dev';

interface AuthState {
  user:    User | null;
  token:   string | null;
  loading: boolean;

  setAuth:     (token: string, user: User) => void;
  logout:      () => void;
  refreshUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user:    null,
      token:   null,
      loading: false,

      setAuth(token, user) {
        localStorage.setItem('stemfer_token', token);
        set({ token, user, loading: false });
      },

      logout() {
        localStorage.removeItem('stemfer_token');
        /* Best-effort logout on server (revoke session, log activity) */
        const token = get().token;
        if (token) {
          fetch(`${API}/auth/logout`, {
            method:  'POST',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {});
        }
        set({ user: null, token: null, loading: false });
      },

      async refreshUser() {
        const token = get().token ?? localStorage.getItem('stemfer_token');
        if (!token) {
          set({ user: null, token: null, loading: false });
          return;
        }

        set({ loading: true });
        try {
          const res = await fetch(`${API}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (res.status === 401) {
            /* Token expired or invalid — clear session */
            localStorage.removeItem('stemfer_token');
            set({ user: null, token: null, loading: false });
            return;
          }

          if (!res.ok) {
            /* Transient server error — keep token, don't force logout */
            set({ loading: false });
            return;
          }

          const user = await res.json() as User;
          set({ user, token, loading: false });
        } catch {
          /* Network error — keep token, retry next time */
          set({ loading: false });
        }
      },
    }),
    {
      name:        'stemfer-auth',
      partialize:  s => ({ token: s.token }),
    }
  )
);
