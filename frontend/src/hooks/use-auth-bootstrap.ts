'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { isPortalAuthEnabled } from '@/lib/portal-mode';
import { isStaticDataMode } from '@/lib/static-mode';
import { usePortalAuthStore } from '@/store/portal-auth-store';
import { useAppStore } from '@/store/app-store';
import { UserInfo } from '@/types';

const AUTO_LOGIN =
  !isPortalAuthEnabled() && process.env.NEXT_PUBLIC_AUTO_LOGIN !== 'false';
const DEFAULT_USER = process.env.NEXT_PUBLIC_DEFAULT_USER || 'ops';
const DEFAULT_PASSWORD = process.env.NEXT_PUBLIC_DEFAULT_PASSWORD || 'ops123';

export function useAuthBootstrap(): boolean {
  const [ready, setReady] = useState(false);
  const setUser = useAppStore((s) => s.setUser);
  const portalEmail = usePortalAuthStore((s) => s.email);
  const portalAdmin = usePortalAuthStore((s) => s.isAdmin);
  const portalReady = usePortalAuthStore((s) => s.ready);

  useEffect(() => {
    if (isPortalAuthEnabled() && !portalReady) return;

    let active = true;

    async function bootstrap() {
      if (isPortalAuthEnabled()) {
        if (portalEmail) {
          const portalRole = portalAdmin ? 'admin' : 'read_only';
          if (!isStaticDataMode()) {
            try {
              const { access_token, user } = await api.login(DEFAULT_USER, DEFAULT_PASSWORD);
              if (active) {
                setUser(
                  {
                    ...(user as UserInfo),
                    username: portalEmail,
                    id: portalEmail,
                    role: portalAdmin ? 'admin' : (user as UserInfo).role,
                  },
                  access_token
                );
              }
              return;
            } catch {
              localStorage.removeItem('dp_token');
            }
          }
          if (active) {
            setUser(
              { id: portalEmail, username: portalEmail, role: portalRole },
              usePortalAuthStore.getState().memoryToken ?? 'portal'
            );
          }
        } else if (active) {
          setUser(null, null);
        }
        return;
      }

      if (isStaticDataMode()) {
        if (active) {
          setUser(
            { id: 'leadership', username: 'leadership', role: 'read_only' } as UserInfo,
            'static'
          );
        }
        return;
      }

      const stored = localStorage.getItem('dp_token');
      if (stored) {
        try {
          const user = await api.getMe();
          if (active) setUser(user, stored);
          return;
        } catch {
          localStorage.removeItem('dp_token');
        }
      }

      if (AUTO_LOGIN) {
        try {
          const { access_token, user } = await api.login(DEFAULT_USER, DEFAULT_PASSWORD);
          if (active) setUser(user as UserInfo, access_token);
        } catch {
          /* Backend unavailable */
        }
      }
    }

    bootstrap().finally(() => {
      if (active) setReady(true);
    });

    return () => {
      active = false;
    };
  }, [portalAdmin, portalEmail, portalReady, setUser]);

  if (isPortalAuthEnabled() && !portalReady) {
    return false;
  }

  return ready;
}

export async function loginUser(username: string, password: string): Promise<boolean> {
  try {
    const { access_token, user } = await api.login(username, password);
    useAppStore.getState().setUser(user as UserInfo, access_token);
    return true;
  } catch {
    return false;
  }
}

/**
 * Upload / sheet-refresh UI.
 * - Static leadership builds: always off (no backend).
 * - Portal auth: only emails in PORTAL_ADMIN_EMAILS.
 * - Local ops (no portal): on unless NEXT_PUBLIC_ENABLE_UPLOAD=false.
 */
export function canUpload(): boolean {
  if (isStaticDataMode()) return false;
  if (process.env.NEXT_PUBLIC_ENABLE_UPLOAD === 'false') return false;
  if (isPortalAuthEnabled()) {
    return usePortalAuthStore.getState().isAdmin;
  }
  return true;
}
