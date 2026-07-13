'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAppStore } from '@/store/app-store';
import { UserInfo } from '@/types';

const AUTO_LOGIN = process.env.NEXT_PUBLIC_AUTO_LOGIN !== 'false';
const DEFAULT_USER = process.env.NEXT_PUBLIC_DEFAULT_USER || 'ops';
const DEFAULT_PASSWORD = process.env.NEXT_PUBLIC_DEFAULT_PASSWORD || 'ops123';

export function useAuthBootstrap(): boolean {
  const [ready, setReady] = useState(false);
  const setUser = useAppStore((s) => s.setUser);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
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
          // Backend unavailable — app still loads in read-only mode
        }
      }
    }

    bootstrap().finally(() => {
      if (active) setReady(true);
    });

    return () => {
      active = false;
    };
  }, [setUser]);

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

export function canUpload(): boolean {
  const user = useAppStore.getState().user;
  return user?.role === 'admin' || user?.role === 'operations';
}
