import { create } from 'zustand';
import { isPortalAuthEnabled } from '@/lib/portal-mode';

interface PortalAuthState {
  email: string | null;
  isAdmin: boolean;
  memoryToken: string | null;
  ready: boolean;
  setSession: (
    email: string,
    memoryToken: string | null,
    isAdmin?: boolean
  ) => void;
  clearSession: () => void;
  bootstrap: () => Promise<void>;
}

export const usePortalAuthStore = create<PortalAuthState>((set) => ({
  email: null,
  isAdmin: false,
  memoryToken: null,
  ready: false,
  setSession: (email, memoryToken, isAdmin = false) =>
    set({ email, memoryToken, isAdmin, ready: true }),
  clearSession: () =>
    set({ email: null, memoryToken: null, isAdmin: false, ready: true }),
  bootstrap: async () => {
    if (!isPortalAuthEnabled()) {
      set({ ready: true });
      return;
    }

    try {
      const headers: Record<string, string> = {};
      const mem = usePortalAuthStore.getState().memoryToken;
      if (mem) headers.Authorization = `Bearer ${mem}`;

      const res = await fetch('/api/auth/me', { headers, credentials: 'include' });
      if (res.ok) {
        const data = (await res.json()) as { email: string; is_admin?: boolean };
        set({
          email: data.email,
          isAdmin: Boolean(data.is_admin),
          ready: true,
        });
        return;
      }
    } catch {
      /* ignore */
    }
    set({ email: null, memoryToken: null, isAdmin: false, ready: true });
  },
}));

export function getPortalAuthToken(): string | null {
  return usePortalAuthStore.getState().memoryToken;
}
