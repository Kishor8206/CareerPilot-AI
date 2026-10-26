import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser, LoginResponse, UserRole } from '@careerpilot/shared';
import { apiGet, apiPost, setAccessToken, setUnauthenticatedHandler } from '@/services/api';

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  status: 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

  login: (email: string, password: string) => Promise<AuthUser>;
  register: (payload: Record<string, unknown>) => Promise<AuthUser>;
  logout: () => Promise<void>;
  /** Re-hydrates the session on app boot, using the refresh cookie. */
  bootstrap: () => Promise<void>;
  refreshUser: () => Promise<void>;
  hasRole: (...roles: UserRole[]) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      status: 'idle',

      async login(email, password) {
        set({ status: 'loading' });
        try {
          const data = await apiPost<LoginResponse>('/auth/login', { email, password });
          setAccessToken(data.tokens.accessToken);
          set({ user: data.user, accessToken: data.tokens.accessToken, status: 'authenticated' });
          return data.user;
        } catch (error) {
          set({ status: 'unauthenticated', user: null, accessToken: null });
          throw error;
        }
      },

      async register(payload) {
        set({ status: 'loading' });
        try {
          const data = await apiPost<LoginResponse>('/auth/register', payload);
          setAccessToken(data.tokens.accessToken);
          set({ user: data.user, accessToken: data.tokens.accessToken, status: 'authenticated' });
          return data.user;
        } catch (error) {
          set({ status: 'unauthenticated' });
          throw error;
        }
      },

      async logout() {
        try {
          await apiPost('/auth/logout');
        } catch {
          // A failed logout call must still clear local state, or the user is
          // stuck in a broken session.
        }
        setAccessToken(null);
        set({ user: null, accessToken: null, status: 'unauthenticated' });
      },

      async bootstrap() {
        const { accessToken } = get();
        set({ status: 'loading' });

        // The persisted access token is short-lived; try it first, and fall
        // back to the refresh cookie if it has expired.
        if (accessToken) {
          setAccessToken(accessToken);
          try {
            const user = await apiGet<AuthUser>('/auth/me');
            set({ user, status: 'authenticated' });
            return;
          } catch {
            // Fall through to the refresh attempt.
          }
        }

        try {
          const data = await apiPost<LoginResponse>('/auth/refresh', {});
          setAccessToken(data.tokens.accessToken);
          set({ user: data.user, accessToken: data.tokens.accessToken, status: 'authenticated' });
        } catch {
          setAccessToken(null);
          set({ user: null, accessToken: null, status: 'unauthenticated' });
        }
      },

      async refreshUser() {
        try {
          const user = await apiGet<AuthUser>('/auth/me');
          set({ user });
        } catch {
          // Leave the existing user in place; the interceptor handles a real 401.
        }
      },

      hasRole(...roles) {
        const role = get().user?.role;
        return Boolean(role && roles.includes(role));
      },
    }),
    {
      name: 'careerpilot-auth',
      // Only the token is persisted. The user object is re-fetched on boot so a
      // role or verification change takes effect immediately.
      partialize: (state) => ({ accessToken: state.accessToken }),
    },
  ),
);

// Wire the API client's 401 fallback to the store, so an unrecoverable session
// clears itself rather than leaving the UI in a half-authenticated state.
setUnauthenticatedHandler(() => {
  setAccessToken(null);
  useAuthStore.setState({ user: null, accessToken: null, status: 'unauthenticated' });
});
