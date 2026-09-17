/**
 * Store Zustand pour l'état d'authentification.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types';
import { authApi } from '../services/api';

interface AuthState {
  user: User | null;
  loading: boolean;
  setUser: (user: User | null) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      loading: false,

      setUser: (user) => set({ user }),

      login: async (email, password) => {
        set({ loading: true });
        try {
          const res = await authApi.login(email, password);
          set({ user: res.data.user, loading: false });
        } catch (err) {
          set({ loading: false });
          throw err;
        }
      },

      logout: async () => {
        await authApi.logout();
        set({ user: null });
      },

      fetchMe: async () => {
        try {
          const res = await authApi.me();
          set({ user: res.data });
        } catch {
          set({ user: null });
        }
      },
    }),
    {
      name: 'ikanai-auth',
      partialize: (state) => ({ user: state.user }),
    }
  )
);
